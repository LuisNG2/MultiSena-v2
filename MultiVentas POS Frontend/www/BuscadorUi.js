// ============================================================
// BuscadorUI.js — Interfaz universal potenciada
//
// Aprovecha al 100% las capacidades del motor Buscador.js:
//   - Fonética española
//   - Damerau-Levenshtein
//   - Trigramas
//   - Scoring ponderado
//
// Features de UI:
//   - Atajo global "/" para enfocar buscador
//   - Resaltado visual de coincidencias
//   - Contador de resultados en vivo
//   - Historial de búsquedas (últimas 5)
//   - Panel de sugerencias dropdown
//   - Navegación con flechas
//   - Debounce + cancelación
//   - Botón clear contextual
//   - 🆕 Búsqueda predictiva con Enter
//   - 🆕 Cantidad automática ("arroz 3")
//   - 🆕 Teclas numéricas 1-5
//   - 🆕 Deduplicación de resultados
// ============================================================

const BuscadorUI = (() => {

    const registrados = new WeakMap();
    const HISTORIAL_KEY = 'pos_busquedas_recientes';
    const MAX_HISTORIAL = 5;
    const MIN_LEN_HISTORIAL = 3;

    // Mapeo de texto de encabezado → campo del motor
    const MAPEO_COLUMNAS = [
        { patron: /c[oó]digo|sku/i,                   campo: 'sku' },
        { patron: /nombre|producto|cliente|usuario/i, campo: 'nombre' },
        { patron: /categor[ií]a|tipo|ciudad|barrio/i, campo: 'categoria' },
    ];

    /* =========================================================
     * HISTORIAL DE BÚSQUEDAS
     * ========================================================= */
    function guardarBusqueda(termino) {
        if (!termino || termino.length < MIN_LEN_HISTORIAL) return;
        try {
            let historial = JSON.parse(localStorage.getItem(HISTORIAL_KEY) || '[]');
            historial = historial.filter(h => h.toLowerCase() !== termino.toLowerCase());
            historial.unshift(termino);
            historial = historial.slice(0, MAX_HISTORIAL);
            localStorage.setItem(HISTORIAL_KEY, JSON.stringify(historial));
        } catch { /* ignorar */ }
    }

    function obtenerHistorial() {
        try { return JSON.parse(localStorage.getItem(HISTORIAL_KEY) || '[]'); }
        catch { return []; }
    }

    /* =========================================================
     * INIT GLOBAL
     * ========================================================= */
    function init() {
        const inputs = document.querySelectorAll('input[data-buscador]:not([data-buscador-ready])');
        inputs.forEach(input => {
            input.setAttribute('data-buscador-ready', 'true');
            conectarInput(input);
        });

        if (inputs.length > 0) {
            console.log(`🔍 BuscadorUI: ${inputs.length} buscadores inicializados`);
        }

        // Atajo global "/" para enfocar el buscador de la vista activa
        if (!document._buscadorAtajoGlobal) {
            document._buscadorAtajoGlobal = true;
            document.addEventListener('keydown', (e) => {
                if (e.key !== '/') return;
                if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

                const vistaActiva = document.querySelector('.vista:not([hidden])');
                const buscadorVistaActiva = vistaActiva?.querySelector('input[data-buscador]');
                const fallback = document.querySelector('input[data-buscador]:not([hidden])');
                const target = buscadorVistaActiva || fallback;

                if (target && target.offsetParent !== null) {
                    e.preventDefault();
                    target.focus();
                    target.select?.();
                }
            });
        }
    }

    /* =========================================================
     * CONECTAR INPUT
     * ========================================================= */
    function conectarInput(input) {
        const contenedor = encontrarContenedor(input);
        if (!contenedor) {
            console.warn('⚠️ BuscadorUI: no se encontró tabla para', input.id);
            return;
        }

        const esTabla = contenedor.tagName === 'TBODY' || contenedor.tagName === 'TABLE';
        const columnasMap = esTabla ? mapearColumnas(contenedor) : null;

        const contadorId = input.dataset.contador;
        const contador = contadorId ? document.getElementById(contadorId) : null;
        const clearBtn = input.parentElement?.querySelector('.clear-btn');
        const sugerenciasPanel = crearPanelSugerencias(input);

        let htmlOriginal = '';
        let elementosContados = 0;
        let ultimoQuery = '';
        let aplicandoFiltro = false;
        let filtroCategoria = '';

        let debounceTimer = null;
        let versionActual = 0;

        /* ============================================
         * DETECCIÓN DE LECTOR DE CÓDIGO DE BARRAS
         * ============================================ */
        let tecleandoRapido = false;
        let timerEscaneoInactividad = null;
        let ultimaTecla = 0;
        const VELOCIDAD_LECTOR_MS = 30;
        const ESPERA_FIN_ESCANEO_MS = 80;
        const LONGITUD_MINIMA_ESCANEO = 8;

        function fueEscaneado() {
            return tecleandoRapido;
        }

        function programarFinEscaneo() {
            clearTimeout(timerEscaneoInactividad);
            timerEscaneoInactividad = setTimeout(() => {
                const valor = input.value.trim();
                if (tecleandoRapido && valor.length >= LONGITUD_MINIMA_ESCANEO) {
                    console.log('🔫 BuscadorUI: fin de escaneo detectado (sin Enter)');
                    ejecutarAccionScan();
                }
                tecleandoRapido = false;
            }, ESPERA_FIN_ESCANEO_MS);
        }

        /* ============================================
         * HELPERS INTERNOS
         * ============================================ */

        function obtenerElementos() {
            if (esTabla) return Array.from(contenedor.querySelectorAll('tr'));
            return Array.from(contenedor.querySelectorAll('.producto'));
        }

        function esElementoMensaje(el) {
            if (!el) return true;
            const texto = (el.textContent || '').toLowerCase();
            return texto.includes('cargando') ||
                   texto.includes('no hay') ||
                   texto.includes('no se encontr') ||
                   texto.includes('error al') ||
                   texto.includes('sin resultado') ||
                   texto.trim() === '';
        }

        function capturarElementos() {
            const todos = obtenerElementos();
            const reales = todos.filter(e => !esElementoMensaje(e));

            if (reales.length > 0 && reales.length >= elementosContados) {
                htmlOriginal = reales.map(e => e.outerHTML).join('');
                elementosContados = reales.length;
            }
        }

        function restaurarTodo() {
            aplicandoFiltro = true;
            contenedor.innerHTML = htmlOriginal;
            aplicandoFiltro = false;
            if (contador) contador.textContent = '';
        }

        function filaAItem(fila) {
            if (!esTabla) {
                return {
                    nombre: fila.dataset.nombre || '',
                    sku: fila.dataset.sku || '',
                    categoria: fila.dataset.categoria || '',
                    extra: '',
                    vecesVendido: parseInt(fila.dataset.vecesVendido || '0', 10)
                };
            }

            const celdas = fila.querySelectorAll('td');
            const item = { nombre: '', sku: '', categoria: '', extra: '', vecesVendido: 0 };

            columnasMap.forEach(({ indice, campo }) => {
                const texto = celdas[indice]?.textContent?.trim() || '';
                if (campo === 'extra') {
                    item.extra += ' ' + texto;
                } else {
                    item[campo] = item[campo] ? item[campo] + ' ' + texto : texto;
                }
            });

            item.vecesVendido = parseInt(fila.dataset.vecesVendido || '0', 10);
            item.extra = item.extra.trim();
            return item;
        }

        /* ============================================
         * APLICAR FILTRO (con deduplicación)
         * ============================================ */

        function aplicar(query) {
            const q = (query || '').trim();
            ultimoQuery = q;

            if (!q && !filtroCategoria) {
                restaurarTodo();
                ocultarSugerencias();
                return;
            }

            if (elementosContados === 0) capturarElementos();
            if (elementosContados === 0) {
                if (contador) contador.textContent = '';
                return;
            }

            aplicandoFiltro = true;
            contenedor.innerHTML = htmlOriginal;

            const elementos = obtenerElementos();

            // 🆕 Deduplicar elementos por id_producto / sku
            // (evita que el mismo producto aparezca 2 veces si el HTML tiene clones)
            const elementosUnicos = [];
            const vistos = new Set();
            elementos.forEach(el => {
                const key = el.dataset.idProducto || el.dataset.id || el.dataset.sku;
                if (key && vistos.has(key)) {
                    // Es un duplicado → eliminarlo del DOM
                    el.remove();
                    return;
                }
                if (key) vistos.add(key);
                elementosUnicos.push(el);
            });

            // 🆕 Construir items deduplicados por id_producto
            const itemsMap = new Map();
            elementosUnicos.forEach(el => {
                const idProducto = el.dataset.idProducto || el.dataset.id;
                const key = idProducto || el.dataset.sku;
                if (!key) return;
                if (itemsMap.has(key)) return;

                const itemData = filaAItem(el);
                if (itemData) {
                    itemsMap.set(key, { ...itemData, _el: el });
                }
            });
            const items = Array.from(itemsMap.values());

            // Filtro por categoría
            let itemsFiltrados = items;
            if (filtroCategoria) {
                const catNorm = Buscador.normalizar(filtroCategoria);
                itemsFiltrados = items.filter(i =>
                    Buscador.normalizar(i.categoria).includes(catNorm)
                );
            }

            // Búsqueda
            let encontrados;
            if (q) {
                encontrados = Buscador.buscar(q, itemsFiltrados, { minScore: 25 });
            } else {
                encontrados = itemsFiltrados.map(i => ({ ...i, _score: 0, _coincidencias: [] }));
            }

            // 🆕 Deduplicar los resultados finales por _el
            const encontradosUnicos = [];
            const elementosVistos = new Set();
            encontrados.forEach(item => {
                if (item._el && !elementosVistos.has(item._el)) {
                    elementosVistos.add(item._el);
                    encontradosUnicos.push(item);
                }
            });
            encontrados = encontradosUnicos;

            // Exponer resultados para Enter y teclas numéricas
            input._ultimosEncontrados = encontrados;

            const encontradosMap = new Map(encontrados.map(e => [e._el, e]));
            const encontradosSet = new Set(encontrados.map(e => e._el));

            const visibles = [];
            elementosUnicos.forEach(el => {
                if (encontradosSet.has(el)) {
                    visibles.push(el);
                } else {
                    el.remove();
                }
            });

            if (q && typeof Buscador.resaltar === 'function') {
                visibles.forEach(el => {
                    const item = encontradosMap.get(el);
                    if (item && item._coincidencias) {
                        resaltarEnElemento(el, item._coincidencias);
                    }
                });
            }

            if (visibles.length === 0) mostrarMensajeSinResultados();

            aplicandoFiltro = false;

            actualizarContador(visibles.length, q);

            if (q && q.length >= 2) {
                mostrarSugerencias(encontrados.slice(0, 5));
            } else {
                ocultarSugerencias();
            }
        }

        /* ============================================
         * RESALTADO
         * ============================================ */

        function resaltarEnElemento(el, coincidencias) {
            const zonas = el.querySelectorAll('td, .prod-nombre, .prod-sku, h3, .sugerencia-nombre');
            zonas.forEach(zona => {
                if (zona.querySelector('.busqueda-match')) return;

                Array.from(zona.childNodes).forEach(nodo => {
                    if (nodo.nodeType !== 3) return;
                    const texto = nodo.textContent;
                    if (!texto.trim()) return;

                    const htmlNuevo = Buscador.resaltar(texto, coincidencias);
                    if (htmlNuevo !== texto) {
                        const span = document.createElement('span');
                        span.innerHTML = htmlNuevo;
                        nodo.parentNode.replaceChild(span, nodo);
                    }
                });
            });
        }

        /* ============================================
         * CONTADOR Y MENSAJES
         * ============================================ */

        function actualizarContador(cantidad, q) {
            if (!contador) return;

            if (!q && !filtroCategoria) {
                contador.textContent = '';
                contador.classList.remove('sin-resultados');
                return;
            }

            if (cantidad === 0) {
                contador.textContent = 'Sin resultados';
                contador.classList.add('sin-resultados');
            } else if (cantidad === 1) {
                contador.textContent = '1 resultado';
                contador.classList.remove('sin-resultados');
            } else {
                contador.textContent = `${cantidad} resultados`;
                contador.classList.remove('sin-resultados');
            }
        }

        function mostrarMensajeSinResultados() {
            const colspan = esTabla
                ? (contenedor.closest('table')?.querySelector('thead tr')?.children.length || 99)
                : null;

            if (esTabla) {
                contenedor.insertAdjacentHTML(
                    'beforeend',
                    `<tr data-elemento-mensaje="true">
                        <td colspan="${colspan}" style="text-align:center; padding:40px 20px; color:var(--text-muted);">
                            <div style="font-size: 36px; margin-bottom: 8px; opacity: 0.5;">🔍</div>
                            <div style="font-size: 15px; font-weight: 600; color: var(--text-main); margin-bottom: 4px;">
                                No se encontraron resultados
                            </div>
                            <div style="font-size: 12px;">Prueba con otro término</div>
                        </td>
                    </tr>`
                );
            } else {
                contenedor.insertAdjacentHTML(
                    'beforeend',
                    `<p style="text-align:center; padding:40px 20px; color:var(--text-muted); width:100%;">
                        <span style="font-size:36px; display:block; margin-bottom:8px; opacity:0.5;">🔍</span>
                        No se encontraron productos
                    </p>`
                );
            }
        }

        /* ============================================
         * SUGERENCIAS
         * ============================================ */

        function crearPanelSugerencias(input) {
            const panel = document.createElement('div');
            panel.className = 'buscador-sugerencias';
            panel.style.display = 'none';
            input.parentElement.style.position = 'relative';
            input.parentElement.appendChild(panel);
            return panel;
        }

        function mostrarSugerencias(items) {
            if (!sugerenciasPanel || items.length === 0) {
                ocultarSugerencias();
                return;
            }

            sugerenciasPanel.innerHTML = items.map((item, i) => {
                const nombreResaltado = typeof Buscador.resaltar === 'function'
                    ? Buscador.resaltar(item.nombre || '', item._coincidencias || [])
                    : (item.nombre || '');

                return `
                    <div class="sugerencia-item" data-index="${i}">
                        <span class="sugerencia-indice">${i + 1}</span>
                        <span class="sugerencia-nombre">${nombreResaltado}</span>
                        <span class="sugerencia-sku">${escapeHtml(item.sku || '')}</span>
                    </div>
                `;
            }).join('');

            sugerenciasPanel.style.display = 'block';

            sugerenciasPanel.querySelectorAll('.sugerencia-item').forEach((el, i) => {
                el.addEventListener('click', () => seleccionarSugerencia(items[i]));
                el.addEventListener('mouseenter', () => {
                    sugerenciasPanel.querySelectorAll('.sugerencia-item.active')
                        .forEach(x => x.classList.remove('active'));
                    el.classList.add('active');
                });
            });
        }

        function seleccionarSugerencia(item) {
            if (!item || !item._el) return;

            item._el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            item._el.classList.add('buscador-destacado');
            setTimeout(() => item._el.classList.remove('buscador-destacado'), 1500);

            ocultarSugerencias();
        }

        function ocultarSugerencias() {
            if (sugerenciasPanel) sugerenciasPanel.style.display = 'none';
        }

        document.addEventListener('click', (e) => {
            if (!input.parentElement.contains(e.target)) ocultarSugerencias();
        });

        /* ============================================
         * ACCIÓN DE ESCANEO
         * ============================================ */

        function ejecutarAccionScan() {
            const onScanName = input.dataset.onScan;
            const valor = input.value.trim();
            if (!valor) return;

            const encontrados = input._ultimosEncontrados || [];

            if (onScanName && typeof window[onScanName] === 'function') {
                try {
                    window[onScanName](valor, encontrados, input);
                } catch (e) {
                    console.error('❌ BuscadorUI: error en callback', onScanName, e);
                }
            } else {
                const primerResultado = contenedor.querySelector('[data-id-producto], [data-sku]');
                if (primerResultado) {
                    const botonAgregar = primerResultado.querySelector('.agregar, button[data-accion]');
                    if (botonAgregar) {
                        botonAgregar.click();
                        console.log('🔫 BuscadorUI: código escaneado → agregado');
                    } else {
                        primerResultado.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        primerResultado.classList.add('buscador-destacado');
                        setTimeout(() => primerResultado.classList.remove('buscador-destacado'), 1500);
                    }
                } else {
                    if (typeof toast === 'function') {
                        toast(`Código "${valor}" no encontrado`, 'error');
                    }
                }
            }

            setTimeout(() => {
                input.value = '';
                aplicar('');
                input.focus();
            }, 250);
        }

        /* ============================================
         * AGREGAR AL CARRITO (búsqueda predictiva)
         * ============================================ */

        function agregarPrimeroAlCarrito(encontrados, input) {
            if (!encontrados || encontrados.length === 0) return;

            const primero = encontrados[0];
            const elemento = primero._el;

            if (!elemento) return;

            const { cantidad } = (typeof Buscador.extraerCantidad === 'function')
                ? Buscador.extraerCantidad(input.value)
                : { cantidad: 1 };

            const btnAgregar = elemento.querySelector('.agregar');
            if (btnAgregar && !btnAgregar.disabled) {
                for (let i = 0; i < cantidad; i++) {
                    btnAgregar.click();
                }

                if (typeof toast === 'function') {
                    const nombre = primero.nombre || 'Producto';
                    if (cantidad > 1) {
                        toast(`✅ ${cantidad}× "${nombre}" agregado`);
                    } else {
                        toast(`✅ "${nombre}" agregado`);
                    }
                }

                const fila = elemento.querySelector('tr') || elemento.closest('tr');
                if (fila) {
                    fila.classList.add('flash-agregado');
                    setTimeout(() => fila.classList.remove('flash-agregado'), 900);
                }

                input.value = '';
                aplicar('');
                input.focus();
            } else {
                if (typeof toast === 'function') {
                    toast(`"${primero.nombre}" sin stock o no disponible`, 'error');
                }
            }
        }

        function agregarProductoPorIndice(encontrados, indice, input) {
            if (!encontrados || indice < 0 || indice >= encontrados.length) return;

            const item = encontrados[indice];
            const elemento = item._el;

            if (!elemento) return;

            const { cantidad } = (typeof Buscador.extraerCantidad === 'function')
                ? Buscador.extraerCantidad(input.value)
                : { cantidad: 1 };

            const btnAgregar = elemento.querySelector('.agregar');
            if (btnAgregar && !btnAgregar.disabled) {
                for (let i = 0; i < cantidad; i++) {
                    btnAgregar.click();
                }

                if (typeof toast === 'function') {
                    toast(`✅ ${item.nombre} agregado (${indice + 1})`);
                }

                elemento.classList.add('buscador-destacado');
                setTimeout(() => elemento.classList.remove('buscador-destacado'), 1500);

                input.value = '';
                aplicar('');
                input.focus();
            } else {
                if (typeof toast === 'function') {
                    toast(`"${item.nombre}" sin stock`, 'error');
                }
            }
        }

        /* ============================================
         * EVENTOS
         * ============================================ */

        input.addEventListener('input', (e) => {
            const valor = e.target.value;

            if (debounceTimer) clearTimeout(debounceTimer);
            const version = ++versionActual;

            if (tecleandoRapido) {
                programarFinEscaneo();
            }

            debounceTimer = setTimeout(() => {
                if (version !== versionActual) return;
                aplicar(valor);

                if (valor && valor.length >= MIN_LEN_HISTORIAL) {
                    clearTimeout(input._saveTimer);
                    input._saveTimer = setTimeout(() => guardarBusqueda(valor), 800);
                }
            }, fueEscaneado() ? 0 : 120);
        });

        input.addEventListener('keydown', (e) => {
            const ahora = Date.now();
            const diff = ahora - ultimaTecla;
            ultimaTecla = ahora;

            if (diff < VELOCIDAD_LECTOR_MS && diff > 0) {
                tecleandoRapido = true;
            }
            clearTimeout(input._resetTecleo);
            input._resetTecleo = setTimeout(() => {
                tecleandoRapido = false;
            }, 500);

            // ENTER
            if (e.key === 'Enter') {
                const sugerenciaActiva = sugerenciasPanel.querySelector('.sugerencia-item.active');

                if (sugerenciaActiva) {
                    e.preventDefault();
                    sugerenciaActiva.click();
                    return;
                }

                if (fueEscaneado()) {
                    e.preventDefault();
                    clearTimeout(timerEscaneoInactividad);
                    ejecutarAccionScan();
                    return;
                }

                const encontrados = input._ultimosEncontrados || [];
                if (encontrados.length > 0) {
                    e.preventDefault();
                    agregarPrimeroAlCarrito(encontrados, input);
                    return;
                }

                e.preventDefault();
                return;
            }

            // TECLAS NUMÉRICAS 1-5
            if (['1', '2', '3', '4', '5'].includes(e.key)) {
                const encontrados = input._ultimosEncontrados || [];
                const sugerenciasVisibles = sugerenciasPanel.style.display === 'block';

                if (e.ctrlKey && encontrados.length >= parseInt(e.key, 10)) {
                    e.preventDefault();
                    const indice = parseInt(e.key, 10) - 1;
                    agregarProductoPorIndice(encontrados, indice, input);
                    return;
                }

                if (encontrados.length >= parseInt(e.key, 10) && sugerenciasVisibles) {
                    const valorActual = input.value;
                    const patronCantidadFinal = /\s+\d*$/;
                    if (patronCantidadFinal.test(valorActual)) return;

                    e.preventDefault();
                    const indice = parseInt(e.key, 10) - 1;
                    agregarProductoPorIndice(encontrados, indice, input);
                    return;
                }

                if (encontrados.length >= parseInt(e.key, 10) && input.value === '') {
                    e.preventDefault();
                    const indice = parseInt(e.key, 10) - 1;
                    agregarProductoPorIndice(encontrados, indice, input);
                    return;
                }
            }

            // ESCAPE
            if (e.key === 'Escape') {
                input.value = '';
                aplicar('');
                ocultarSugerencias();
                setTimeout(() => {
                    input.focus();
                    input.select?.();
                }, 0);
                return;
            }

            // FLECHAS
            if (sugerenciasPanel.style.display === 'block') {
                const items = sugerenciasPanel.querySelectorAll('.sugerencia-item');
                if (items.length === 0) return;
                const activo = sugerenciasPanel.querySelector('.sugerencia-item.active');

                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    const idx = activo ? Array.from(items).indexOf(activo) : -1;
                    if (idx < items.length - 1) {
                        activo?.classList.remove('active');
                        items[idx + 1].classList.add('active');
                        items[idx + 1].scrollIntoView({ block: 'nearest' });
                    }
                }

                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    const idx = activo ? Array.from(items).indexOf(activo) : items.length;
                    if (idx > 0) {
                        activo?.classList.remove('active');
                        items[idx - 1].classList.add('active');
                        items[idx - 1].scrollIntoView({ block: 'nearest' });
                    }
                }
            }
        });

        // FOCUS: historial
        input.addEventListener('focus', () => {
            if (input.value) return;

            const historial = obtenerHistorial();
            if (historial.length === 0) return;

            sugerenciasPanel.innerHTML = `
                <div class="sugerencia-titulo">🕐 Búsquedas recientes</div>
                ${historial.map(h => `
                    <div class="sugerencia-item historial-item" data-historial="${escapeHtml(h)}">
                        <span class="sugerencia-nombre">${escapeHtml(h)}</span>
                        <span class="sugerencia-sku">↻</span>
                    </div>
                `).join('')}
            `;

            sugerenciasPanel.style.display = 'block';

            sugerenciasPanel.querySelectorAll('.historial-item').forEach(el => {
                el.addEventListener('click', () => {
                    const term = el.dataset.historial;
                    input.value = term;
                    aplicar(term);
                    ocultarSugerencias();
                });
            });
        });

        // BOTÓN CLEAR
        if (clearBtn && !clearBtn._attached) {
            clearBtn._attached = true;
            clearBtn.addEventListener('click', () => {
                input.value = '';
                aplicar('');
                ocultarSugerencias();
                input.focus();
            });
        }

        const toggleClear = () => {
            if (clearBtn) clearBtn.style.display = input.value ? 'flex' : 'none';
        };
        input.addEventListener('input', toggleClear);
        toggleClear();

        // OBSERVER
        let mutacionTimeout = null;
        const observer = new MutationObserver(() => {
            if (aplicandoFiltro) return;
            if (mutacionTimeout) clearTimeout(mutacionTimeout);
            mutacionTimeout = setTimeout(() => {
                const actuales = obtenerElementos().filter(e => !esElementoMensaje(e));
                if (actuales.length > elementosContados) {
                    elementosContados = 0;
                    capturarElementos();
                    if (ultimoQuery) aplicar(ultimoQuery);
                }
            }, 50);
        });
        observer.observe(contenedor, { childList: true, subtree: false });

        capturarElementos();

        registrados.set(input, { contenedor, observer, input });

        // API PÚBLICA
        input._buscadorAPI = {
            refresh: () => {
                elementosContados = 0;
                capturarElementos();
                aplicar(input.value);
            },
            clear: () => {
                input.value = '';
                aplicar('');
                toggleClear();
            },
            filtrarCategoria: (cat) => {
                filtroCategoria = cat;
                aplicar(input.value);
            },
            simularScan: (codigo) => {
                input.value = codigo;
                tecleandoRapido = true;
                aplicar(codigo);
                setTimeout(() => ejecutarAccionScan(), 100);
            }
        };
    }

    /* =========================================================
     * UTILIDADES
     * ========================================================= */
    function encontrarContenedor(input) {
        const tablaId = input.dataset.tabla;
        if (tablaId) {
            const t = document.getElementById(tablaId);
            if (t) {
                if (t.tagName === 'TABLE') return t.querySelector('tbody') || t;
                return t;
            }
        }

        const contenedores = ['.vista', '.panel', 'form', 'section', 'article', 'main'];
        for (const sel of contenedores) {
            const contenedor = input.closest(sel);
            if (contenedor) {
                const tbody = contenedor.querySelector('table tbody');
                if (tbody) return tbody;
                const grid = contenedor.querySelector('.productos, [data-cards]');
                if (grid) return grid;
            }
        }
        return null;
    }

    function mapearColumnas(tbody) {
        const tabla = tbody.closest('table');
        if (!tabla) return [{ indice: 0, campo: 'nombre' }];

        const headers = Array.from(tabla.querySelectorAll('thead th'));
        const resultado = [];

        headers.forEach((th, idx) => {
            const textoHeader = (th.textContent || '').trim().toLowerCase();

            if (textoHeader.includes('accion') ||
                textoHeader.includes('acción') ||
                textoHeader.includes('opera') ||
                textoHeader.includes('opciones')) {
                return;
            }

            let campo = 'extra';
            for (const { patron, campo: c } of MAPEO_COLUMNAS) {
                if (patron.test(textoHeader)) {
                    campo = c;
                    break;
                }
            }
            resultado.push({ indice: idx, campo });
        });

        if (resultado.length === 0) {
            for (let i = 0; i < headers.length; i++) {
                resultado.push({ indice: i, campo: i === 1 ? 'nombre' : 'extra' });
            }
        }
        return resultado;
    }

    function escapeHtml(texto) {
        const div = document.createElement('div');
        div.textContent = texto == null ? '' : String(texto);
        return div.innerHTML;
    }

    return { init, conectarInput };
})();