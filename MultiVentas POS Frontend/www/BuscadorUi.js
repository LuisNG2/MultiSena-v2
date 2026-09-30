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
//   - Búsqueda predictiva con Enter
//   - Cantidad automática ("arroz 3", "3 arroz", "arroz*3")
//   - Detección de lector de código de barras
//   - Deduplicación de resultados
//   - 🚫 SIN atajos de teclas 1-5 (eliminados por bugs)
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

            // 🆕 Refrescar stock también al restaurar
            if (typeof refrescarStockCatalogo === 'function') {
                setTimeout(() => refrescarStockCatalogo(), 0);
            }
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

            // Deduplicar elementos por id_producto / sku
            const elementosUnicos = [];
            const vistos = new Set();
            elementos.forEach(el => {
                const key = el.dataset.idProducto || el.dataset.id || el.dataset.sku;
                if (key && vistos.has(key)) {
                    el.remove();
                    return;
                }
                if (key) vistos.add(key);
                elementosUnicos.push(el);
            });

            // Construir items deduplicados por id_producto
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

            // Búsqueda (extrayendo cantidad del query si aplica)
            let encontrados;
            if (q) {
                const { query: queryLimpio } = (typeof Buscador.extraerCantidad === 'function')
                    ? Buscador.extraerCantidad(q)
                    : { query: q };
                encontrados = Buscador.buscar(queryLimpio || q, itemsFiltrados, { minScore: 25 });
            } else {
                encontrados = itemsFiltrados.map(i => ({ ...i, _score: 0, _coincidencias: [] }));
            }

            // Deduplicar los resultados finales por _el
            const encontradosUnicos = [];
            const elementosVistos = new Set();
            encontrados.forEach(item => {
                if (item._el && !elementosVistos.has(item._el)) {
                    elementosVistos.add(item._el);
                    encontradosUnicos.push(item);
                }
            });
            encontrados = encontradosUnicos;

            // Exponer resultados para Enter
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
            // 🆕 Refrescar el stock dinámico después de aplicar el filtro
            if (typeof refrescarStockCatalogo === 'function') {
                setTimeout(() => refrescarStockCatalogo(), 0);
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

        function agregarPrimeroAlCarrito(encontrados) {
            if (!encontrados || encontrados.length === 0) return;
            agregarItemAlCarrito(encontrados[0], input.value);
                    }

                            /**
                     * Agrega un item al carrito SUMANDO cantidades si ya existe.
                     * Respeta el stock disponible y muestra UN SOLO toast.
                     */
                    function agregarItemAlCarrito(item, textoQuery) {
                if (!item || !item._el) return;

                const elemento = item._el;
                const btnAgregar = elemento.querySelector('.agregar');

                if (!btnAgregar || btnAgregar.disabled) {
                    if (typeof toast === 'function') {
                        toast(`"${item.nombre}" sin stock`, 'error');
                    }
                    return;
                }

                // Extraer cantidad del query
                const { cantidad: cantidadSolicitada } = (typeof Buscador.extraerCantidad === 'function')
                    ? Buscador.extraerCantidad(textoQuery || input.value)
                    : { cantidad: 1 };

                const ventaId = estado.pestañaActiva || 'venta1';
                const sku = String(elemento.dataset.sku || '').trim();
                const nombre = item.nombre || 'Producto';

                if (!sku || !estado.carritos[ventaId]) return;

                // 🆕 Calcular stock total en BD (prioridad: stockBase > caché de productos > dataset.stock)
                let stockTotalBD = 0;

                const stockBase = parseInt(elemento.dataset.stockBase || '0', 10);
                if (stockBase > 0) {
                    stockTotalBD = stockBase;
                } else {
                    // Fallback: buscar en el caché de productos en memoria
                    const producto = (estado.productos || []).find(p => {
                        const pSku = String(p.sku || p.codigoInterno || '').trim().toUpperCase();
                        return pSku === sku.toUpperCase();
                    });

                    if (producto && producto.stockActual != null) {
                        stockTotalBD = producto.stockActual;
                    } else {
                        stockTotalBD = parseInt(elemento.dataset.stock || '0', 10);
                    }
                }

                // 🆕 Ver si ya está en el carrito actual (normalizando SKUs)
                const itemCarrito = estado.carritos[ventaId].find(i =>
                    String(i.sku || '').trim().toUpperCase() === sku.toUpperCase()
                );
                const cantidadActual = itemCarrito ? itemCarrito.cantidad : 0;

                // 🆕 Calcular cuánto está reservado en TODOS los carritos
                let reservadoTotal = 0;
                for (const vid in estado.carritos) {
                    const c = estado.carritos[vid] || [];
                    for (const i of c) {
                        if (String(i.sku || '').trim().toUpperCase() === sku.toUpperCase()) {
                            reservadoTotal += parseInt(i.cantidad, 10) || 0;
                        }
                    }
                }

                // Espacio disponible = stock BD - reservado en OTROS carritos
                const reservadoOtros = reservadoTotal - cantidadActual;
                const espacioDisponible = stockTotalBD - reservadoOtros;

                // 🎯 Validación: si NO cabe al menos 1 unidad, bloquear
                if (espacioDisponible < 1) {
                    if (typeof toast === 'function') {
                        const detalle = reservadoOtros > 0
                            ? ` (${reservadoOtros} en otros carritos)`
                            : '';
                        toast(`"${nombre}" sin stock disponible${detalle}`, 'error');
                    }
                    input.value = '';
                    aplicar('');
                    input.focus();
                    return;
                }

                const cantidadFinal = Math.min(cantidadSolicitada, espacioDisponible);
                const recortado = cantidadFinal < cantidadSolicitada;

                // Sumar o crear el item en el carrito
                if (itemCarrito) {
                    itemCarrito.cantidad += cantidadFinal;
                } else {
                    const idProducto = parseInt(elemento.dataset.idProducto, 10);
                    const precio = parseFloat(elemento.dataset.precio) || 0;

                    estado.carritos[ventaId].push({
                        idProducto,
                        sku,
                        nombre,
                        precio,
                        cantidad: cantidadFinal,
                        stock: stockTotalBD
                    });
                }

                // Refrescar UI
                if (typeof renderCarrito === 'function') renderCarrito(ventaId);
                if (typeof guardarEstado === 'function') guardarEstado();
                if (typeof actualizarConteos === 'function') actualizarConteos();
                if (typeof refrescarStockCatalogo === 'function') refrescarStockCatalogo();

                // Toast
                if (typeof toast === 'function') {
                    const total = cantidadActual + cantidadFinal;

                    if (recortado) {
                        toast(`⚠️ "${nombre}" — solo había ${espacioDisponible}. Total: ${total}`, 'error');
                    } else if (cantidadFinal > 1) {
                        if (cantidadActual > 0) {
                            toast(`✅ +${cantidadFinal}× "${nombre}" (total: ${total})`);
                        } else {
                            toast(`✅ ${cantidadFinal}× "${nombre}" agregado`);
                        }
                    } else {
                        if (cantidadActual > 0) {
                            toast(`✅ +1 "${nombre}" (total: ${total})`);
                        } else {
                            toast(`✅ "${nombre}" agregado`);
                        }
                    }
                }

                // Flash visual
                const fila = elemento.closest('tr') || elemento;
                fila.classList.add('flash-agregado');
                setTimeout(() => fila.classList.remove('flash-agregado'), 900);

                // Limpiar input
                input.value = '';
                aplicar('');
                input.focus();
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

            // Detectar tecleo rápido (lector de código de barras)
            if (diff < VELOCIDAD_LECTOR_MS && diff > 0) {
                tecleandoRapido = true;
            }
            clearTimeout(input._resetTecleo);
            input._resetTecleo = setTimeout(() => {
                tecleandoRapido = false;
            }, 500);

            // ============================================================
            // ENTER
            // ============================================================
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
                    agregarPrimeroAlCarrito(encontrados);
                    return;
                }

                e.preventDefault();
                return;
            }
        
            // ============================================================
            // ATAJOS NUMÉRICOS 1-5 (con actualización dinámica de stock)
            // ============================================================
            
            if (['1', '2', '3', '4', '5'].includes(e.key) && e.ctrlKey && !e.altKey && !e.metaKey) {
                const indice = parseInt(e.key, 10) - 1;
                const encontrados = input._ultimosEncontrados || [];

                if (encontrados.length > indice) {
                    e.preventDefault();
                    agregarItemAlCarrito(encontrados[indice], input.value);
                    return;
                }
            }
            // ============================================================
            // ESCAPE
            // ============================================================
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

            // ============================================================
            // FLECHAS (navegación en sugerencias)
            // ============================================================
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

        // ============================================================
        // FOCUS: mostrar historial de búsquedas
        // ============================================================
             // 🚫 HISTORIAL DESACTIVADO
        // Si quieres reactivarlo, descomenta este bloque.
        /*
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
        */
        // ============================================================
        // BOTÓN CLEAR
        // ============================================================
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

        // ============================================================
        // OBSERVER: detectar cambios en la tabla (por CRUD)
        // ============================================================
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

        // ============================================================
        // API PÚBLICA
        // ============================================================
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