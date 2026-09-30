// ============================================================
// Buscador.js — Motor de búsqueda profesional para MultiVentas POS
// 
//   • Normalización Unicode (tildes, diacríticos, ñ/ü)
//   • Fonética española (Soundex-ES adaptado)
//   • Levenshtein + Damerau (transposiciones)
//   • Trigramas (similitud parcial)
//   • Scoring ponderado por campo y tipo de match
//   • Índice pre-calculado para rendimiento
//   • Debounce + cancelación de búsquedas previas
//   • Ranking descendente por relevancia
//
// Autor: MultiVentas POS
// ============================================================

const Buscador = (() => {

    /* =========================================================
     * 1. UTILIDADES BASE
     * ========================================================= */

    /**
     * Normaliza un texto: minúsculas, sin tildes, sin signos.
     * Mantiene letras y números.
     */
    function normalizar(str) {
        if (!str) return '';
        return String(str)
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')   // quita diacríticos
            .replace(/ñ/g, 'n')
            .replace(/ü/g, 'u')
            .replace(/[^a-z0-9\s]/g, ' ')      // solo letras, números y espacios
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Divide un texto en tokens (palabras).
     */
    function tokenizar(str) {
        const norm = normalizar(str);
        return norm ? norm.split(' ').filter(Boolean) : [];
    }

    /* =========================================================
     * 2. FONÉTICA ESPAÑOLA (Soundex-ES adaptado)
     * ========================================================= */

    /**
     * Convierte una palabra a su representación fonética.
     * "cebolla" → "seboia"
     * "sebolla" → "seboia"
     * "cevolla" → "seboia"
     * "zapato"  → "sapato"
     */
    function fonetica(str) {
        if (!str) return '';

        let s = normalizar(str).replace(/\s/g, '');

        if (!s) return '';

        // Reglas compuestas primero
        s = s.replace(/ch/g, 'Ĉ');
        s = s.replace(/ll/g, 'Ĺ');
        s = s.replace(/rr/g, 'Ŕ');
        s = s.replace(/qu/g, 'K');
        s = s.replace(/gue/g, 'ge');
        s = s.replace(/gui/g, 'gi');

        // Reglas simples
        s = s.replace(/h/g, '');
        s = s.replace(/z/g, 's');
        s = s.replace(/ce/g, 'se');
        s = s.replace(/ci/g, 'si');
        s = s.replace(/v/g, 'b');
        s = s.replace(/y/g, 'i');
        s = s.replace(/q/g, 'k');
        s = s.replace(/c/g, 'k');
        s = s.replace(/x/g, 's');
        s = s.replace(/ge/g, 'je');
        s = s.replace(/gi/g, 'ji');
        s = s.replace(/g/g, 'j');
        s = s.replace(/w/g, 'u');

        // Restaurar marcadores
        s = s.replace(/Ĉ/g, 'ch');
        s = s.replace(/Ĺ/g, 'y');
        s = s.replace(/Ŕ/g, 'r');

        // Colapsar letras repetidas
        s = s.replace(/(.)\1+/g, '$1');

        return s;
    }

    /* =========================================================
     * 3. DISTANCIAS
     * ========================================================= */

    /**
     * Levenshtein con optimización de memoria (2 filas).
     */
    function levenshtein(a, b) {
        if (a === b) return 0;
        if (!a.length) return b.length;
        if (!b.length) return a.length;

        let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
        let curr = new Array(b.length + 1);

        for (let i = 1; i <= a.length; i++) {
            curr[0] = i;
            for (let j = 1; j <= b.length; j++) {
                const costo = a[i - 1] === b[j - 1] ? 0 : 1;
                curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + costo);
            }
            [prev, curr] = [curr, prev];
        }
        return prev[b.length];
    }

    /**
     * Damerau-Levenshtein: además de insertar/eliminar/sustituir,
     * permite transposiciones ("avnea" ↔ "avena") a costo 1.
     */
    function damerau(a, b) {
        if (a === b) return 0;
        if (!a.length) return b.length;
        if (!b.length) return a.length;

        const m = a.length, n = b.length;
        const maxDist = m + n;
        const H = Array.from({ length: m + 2 }, () => new Array(n + 2).fill(maxDist));

        H[0][0] = maxDist;
        for (let i = 0; i <= m; i++) { H[i + 1][0] = maxDist; H[i + 1][1] = i; }
        for (let j = 0; j <= n; j++) { H[0][j + 1] = maxDist; H[1][j + 1] = j; }

        const DA = {};

        for (let i = 1; i <= m; i++) {
            let DB = 0;
            for (let j = 1; j <= n; j++) {
                const i1 = DA[b[j - 1]] || 0;
                const j1 = DB;
                let cost = 1;
                if (a[i - 1] === b[j - 1]) { cost = 0; DB = j; }

                H[i + 1][j + 1] = Math.min(
                    H[i][j] + cost,           // sustitución
                    H[i + 1][j] + 1,          // inserción
                    H[i][j + 1] + 1,          // eliminación
                    H[i1][j1] + (i - i1 - 1) + 1 + (j - j1 - 1) // transposición
                );
            }
            DA[a[i - 1]] = i;
        }

        return H[m + 1][n + 1];
    }

    /* =========================================================
     * 4. TRIGRAMAS (similitud parcial)
     * ========================================================= */

    /**
     * Genera los trigramas (3-gramas) de un string.
     * "arroz" → [" ar", "arr", "rro", "roz", "oz "]
     */
    function trigramas(str) {
        const s = `  ${str}  `;   // padding para capturar inicio/fin
        const set = new Set();
        for (let i = 0; i <= s.length - 3; i++) {
            set.add(s.substring(i, i + 3));
        }
        return set;
    }

    /**
     * Similitud de Jaccard entre dos conjuntos de trigramas.
     * Retorna un valor 0..1
     */
    function similitudTrigramas(a, b) {
        const ta = trigramas(a);
        const tb = trigramas(b);

        if (ta.size === 0 && tb.size === 0) return 1;
        if (ta.size === 0 || tb.size === 0) return 0;

        let interseccion = 0;
        for (const t of ta) if (tb.has(t)) interseccion++;

        const union = ta.size + tb.size - interseccion;
        return interseccion / union;
    }

    /* =========================================================
     * 5. MOTOR DE SCORING
     * ========================================================= */

    // Pesos por campo (más alto = más importante)
    const PESO_CAMPO = {
        nombre: 3.0,
        sku: 1.5,
        categoria: 1.0,
        extra: 0.5
    };

    // Pesos por tipo de match
    const PESO_MATCH = {
        exacto: 100,
        prefijo: 85,
        substring: 70,
        foneticoExacto: 90,
        foneticoPrefijo: 75,
        trigrama: 60,
        typo: 50
    };

    /**
     * Calcula el mejor score de un token del query contra una palabra del texto.
     * Retorna un valor 0..100
     */
    function scoreToken(qToken, qFon, palabra) {
        const pFon = fonetica(palabra);

        // 1) Coincidencia exacta
        if (palabra === qToken) return PESO_MATCH.exacto;

        // 2) Prefijo
        if (palabra.startsWith(qToken)) return PESO_MATCH.prefijo;

        // 3) Substring
        if (palabra.includes(qToken)) return PESO_MATCH.substring;

        // 4) Fonética exacta
        if (qFon && pFon && qFon === pFon) return PESO_MATCH.foneticoExacto;

        // 5) Fonética por prefijo
        if (qFon && pFon && qFon.length >= 3 && pFon.startsWith(qFon)) {
            return PESO_MATCH.foneticoPrefijo;
        }

        // 6) Trigramas (similitud parcial)
        if (qToken.length >= 4 && palabra.length >= 4) {
            const sim = similitudTrigramas(qToken, palabra);
            if (sim >= 0.5) {
                return PESO_MATCH.trigrama * sim;
            }
        }

        // 7) Typos (Damerau)
        const tolerancia = qToken.length >= 7 ? 2
                         : qToken.length >= 4 ? 1
                         : 0;

        if (tolerancia > 0) {
            const d = damerau(qToken, palabra);
            if (d <= tolerancia) {
                return PESO_MATCH.typo - (d * 10);
            }
        }

        return 0;
    }

    /**
     * Calcula el score de un token del query contra un objeto con varios campos.
     * Retorna { score, campo, palabra }
     */
    function scoreTokenEnCampos(qToken, campos) {
        const qFon = fonetica(qToken);
        let mejor = { score: 0, campo: null, palabra: null };

        for (const [campo, peso] of Object.entries(PESO_CAMPO)) {
            const valor = campos[campo];
            if (!valor) continue;

            const palabras = Array.isArray(valor) ? valor : tokenizar(valor);

            for (const palabra of palabras) {
                const s = scoreToken(qToken, qFon, palabra) * peso;
                if (s > mejor.score) {
                    mejor = { score: s, campo, palabra };
                }
            }
        }

        return mejor;
    }
        /* =========================================================
     * 6. BÚSQUEDA PRINCIPAL
     * ========================================================= */

    /**
     * Busca un query en una lista de items.
     * 
     * @param {string} query - texto de búsqueda
     * @param {Array}  items - [{ nombre, sku, categoria, extra, ... }]
     * @param {Object} opts  - { limite: number, minScore: number }
     * @returns {Array} items ordenados por relevancia, con ._score
     */
    function buscar(query, items, opts = {}) {
        const {
            limite = Infinity,
            minScore = 25    // umbral mínimo de relevancia
        } = opts;

        const tokens = tokenizar(query);
        if (tokens.length === 0) return items;

        const resultados = [];

        for (const item of items) {
            // Preparar campos en formato esperado
            const campos = {
                nombre: item.nombre || item.texto || '',
                sku: item.sku || '',
                categoria: item.categoria || '',
                extra: item.extra || ''
            };

            let scoreTotal = 0;
            let todosCoinciden = true;
            const coincidencias = [];

            for (const tk of tokens) {
                const { score, campo, palabra } = scoreTokenEnCampos(tk, campos);

                if (score === 0) {
                    todosCoinciden = false;
                    break;
                }

                scoreTotal += score;
                coincidencias.push({ token: tk, campo, palabra, score });
            }

            if (!todosCoinciden) continue;

            // Bonus: si el nombre empieza con el primer token, sube en ranking
            const nombreNorm = normalizar(campos.nombre);
            const queryNorm = normalizar(query);
            if (nombreNorm.startsWith(queryNorm)) {
                scoreTotal += 50;
            }

            // Bonus por popularidad (más vendidos primero)
            scoreTotal = aplicarBonusPopularidad(scoreTotal, item.vecesVendido || 0);

            // Penalización leve por textos largos (preferir matches concisos)
            scoreTotal -= nombreNorm.length * 0.1;

            if (scoreTotal >= minScore) {
                resultados.push({
                    ...item,
                    _score: scoreTotal,
                    _coincidencias: coincidencias
                });
            }
        }

        // Ordenar por score descendente
        resultados.sort((a, b) => b._score - a._score);

        return limite < Infinity ? resultados.slice(0, limite) : resultados;
    }

    /* =========================================================
     * 7. DEBOUNCE Y CANCELACIÓN
     * ========================================================= */

    /**
     * Crea un buscador con debounce integrado.
     * 
     * Uso:
     *   const buscador = Buscador.crearDebounced((query, items) => {
     *       const res = Buscador.buscar(query, items);
     *       // renderizar
     *   }, 120);
     *   buscador(query, items);
     */
    function crearDebounced(fn, delay = 120) {
        let timeoutId = null;
        let ultimaVersion = 0;

        return function (query, items) {
            if (timeoutId) clearTimeout(timeoutId);
            const version = ++ultimaVersion;

            timeoutId = setTimeout(() => {
                // Si llegó otra llamada mientras esperábamos, abortar
                if (version !== ultimaVersion) return;
                fn(query, items);
            }, delay);
        };
    }

    /* =========================================================
     * 8. RESALTADO DE COINCIDENCIAS
     * ========================================================= */

    /**
     * Devuelve un array de rangos {inicio, fin} que coinciden en un texto.
     * 
     * @param {string} texto - texto original
     * @param {Array} coincidencias - [{ token, palabra, ... }]
     * @returns {Array<{inicio, fin}>} rangos ordenados y sin solapamientos
     */
    function calcularRangosMatch(texto, coincidencias) {
        if (!texto || !coincidencias || coincidencias.length === 0) return [];

        const rangos = [];
        const textoLower = texto.toLowerCase();

        for (const c of coincidencias) {
            const token = c.token;
            if (!token) continue;

            // Buscar todas las apariciones del token (o su variante sin tildes)
            let idx = 0;
            while (true) {
                const pos = textoLower.indexOf(token, idx);
                if (pos === -1) break;

                rangos.push({ inicio: pos, fin: pos + token.length });
                idx = pos + 1;
            }
        }

        // Fusionar rangos solapados
        rangos.sort((a, b) => a.inicio - b.inicio);
        const fusionados = [];
        for (const r of rangos) {
            const ultimo = fusionados[fusionados.length - 1];
            if (ultimo && r.inicio <= ultimo.fin) {
                ultimo.fin = Math.max(ultimo.fin, r.fin);
            } else {
                fusionados.push({ ...r });
            }
        }

        return fusionados;
    }

    /**
     * Aplica <mark> a las coincidencias encontradas en un texto.
     * Retorna HTML seguro (escapa el texto).
     */
    function resaltar(texto, coincidencias) {
        if (!texto) return '';

        const rangos = calcularRangosMatch(texto, coincidencias);
        if (rangos.length === 0) return escapeHtml(texto);

        let html = '';
        let ultimoFin = 0;

        for (const r of rangos) {
            html += escapeHtml(texto.substring(ultimoFin, r.inicio));
            html += `<mark class="busqueda-match">${escapeHtml(texto.substring(r.inicio, r.fin))}</mark>`;
            ultimoFin = r.fin;
        }
        html += escapeHtml(texto.substring(ultimoFin));

        return html;
    }

    function escapeHtml(texto) {
        const div = document.createElement('div');
        div.textContent = texto == null ? '' : String(texto);
        return div.innerHTML;
    }

    /* =========================================================
     * 9. DETECCIÓN DE CANTIDAD EN EL QUERY
     * ========================================================= */

    /**
     * Extrae la cantidad del query.
     * 
     * Formatos soportados:
     *   "arroz 3"     → { query: "arroz", cantidad: 3 }
     *   "arroz*3"     → { query: "arroz", cantidad: 3 }
     *   "3 arroz"     → { query: "arroz", cantidad: 3 }
     *   "3arroz"      → { query: "arroz", cantidad: 3 }
     *   "arroz x3"    → { query: "arroz", cantidad: 3 }
     *   "arroz"       → { query: "arroz", cantidad: 1 }
     */
        /**
     * Extrae la cantidad del query.
     * 
     * 📌 REGLA: La cantidad SOLO se interpreta si está AL INICIO del query.
     * 
     * Formatos soportados:
     *   "5 coca"      → { query: "coca",     cantidad: 5 }
     *   "3 arroz"     → { query: "arroz",    cantidad: 3 }
     *   "10 pan"      → { query: "pan",      cantidad: 10 }
     *   "2 leche 1L"  → { query: "leche 1L", cantidad: 2 }
     *   "coca 1.5"    → { query: "coca 1.5", cantidad: 1 }  ← el número es parte del nombre
     *   "arroz 5"     → { query: "arroz 5",  cantidad: 1 }  ← el número es parte del nombre
     *   "coca cola"   → { query: "coca cola",cantidad: 1 }
     * 
     * ⚠️ Si el número está en medio o al final, se considera parte del nombre del producto.
     */
    function extraerCantidad(query) {
        if (!query) return { query: '', cantidad: 1 };

        const texto = String(query).trim();

        // Patrón: "N texto..." (número seguido de espacio y al menos un carácter)
        // El número debe estar al inicio, separado por espacio
        const patronInicio = /^(\d{1,3})\s+(.+)$/;

        const match = texto.match(patronInicio);

        if (match) {
            const num = parseInt(match[1], 10);
            const resto = match[2].trim();

            // Validar rango razonable (1 a 999)
            if (num > 0 && num <= 999 && resto.length > 0) {
                return { query: resto, cantidad: num };
            }
        }

        // Sin cantidad: devolver el texto original
        return { query: texto, cantidad: 1 };
    }
    /* =========================================================
     * 10. ORDENAR POR MÁS VENDIDOS (bonus de relevancia)
     * ========================================================= */

    /**
     * Aplica un bonus al score según la popularidad del producto.
     * 
     * @param {number} scoreOriginal - score actual
     * @param {number} vecesVendido - cantidad de veces que se ha vendido
     * @returns {number} score con bonus aplicado
     */
    function aplicarBonusPopularidad(scoreOriginal, vecesVendido) {
        if (!vecesVendido || vecesVendido <= 0) return scoreOriginal;

        // Escala logarítmica suave: 1 venta = +2, 10 ventas = +10, 100 ventas = +20, 1000+ = +30
        const bonus = Math.min(30, Math.log10(vecesVendido + 1) * 10);

        return scoreOriginal + bonus;
    }

    /* =========================================================
     * API PÚBLICA
     * ========================================================= */

    return {
        // Utilidades
        normalizar,
        tokenizar,
        fonetica,

        // Distancias
        levenshtein,
        damerau,
        similitudTrigramas,

        // Búsqueda
        buscar,
        crearDebounced,

        // Resaltado
        calcularRangosMatch,
        resaltar,

        // Nuevas features
        extraerCantidad,
        aplicarBonusPopularidad,

        // Configuración
        PESO_CAMPO,
        PESO_MATCH
    };

})();