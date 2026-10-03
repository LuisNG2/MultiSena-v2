// ============================================================
// App.js - MultiVentas POS
// Lógica principal del frontend
// ============================================================

/* ============================================================
   1. UTILIDADES
   ============================================================ */

function formatearFechaColombia(fechaISO) {
    if (!fechaISO) return '-';

    let iso = String(fechaISO);

    if (iso.endsWith('Z') || iso.match(/[+-]\d{2}:\d{2}$/)) {
        // ya tiene zona
    } else if (iso.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) {
        iso = iso + 'Z';
    } else if (iso.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/)) {
        iso = iso.replace(' ', 'T') + 'Z';
    }

    try {
        const fecha = new Date(iso);
        if (isNaN(fecha.getTime())) return fechaISO;

        return fecha.toLocaleString('es-CO', {
            timeZone: 'America/Bogota',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    } catch {
        return fechaISO;
    }
}

const formato = n => `$${Number(n || 0).toLocaleString('es-CO')}`;
const IMPUESTO = 0.19;

function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

/* ============================================================
   2. ESTADO GLOBAL
   ============================================================ */

const estado = {
    carritos: { venta1: [] },
    pestañaActiva: 'venta1',
    vistaCatalogo: 'lista',
    terminoBusqueda: '',
    historial: [],
    nombres: {},
    clientes: [],
    productos: [],
    _ventasInited: false,
    _clientesInited: false,
    _creatingVenta: false,
    _cargandoProductos: false,
    

    // 🆕 Flags del caché del top
    _ultimaCargaTop: 0,
    _productosCacheInvalidado: false
};

const STORAGE_KEYS = {
    APP: 'pos_estado',
    SPLIT_RATIO: 'split_ratio',
    SPLIT_PX: 'split_ratio_px',
    THEME: 'pos_tema',
    DRAG_POS: 'pos_cart_position'
};
/* ============================================================
   CACHÉ DEL TOP 1000 PRODUCTOS — Búsqueda local inteligente
   ============================================================ */
    const TOP_CACHE_KEY = 'pos_top_productos_cache_v3';
    const TOP_CACHE_TTL = 60 * 60 * 1000;
    const TOP_LIMITE = 2000;

    let _topProductos = [];
    let _topCargando = false;

    /* ============================================================
   🆕 CONTROL DE CARGA ÚNICA DEL TOP 2000
   Evita llamadas duplicadas al endpoint /Productos/top
   ============================================================ */
    const _controlCargaTop = {
        promesaEnCurso: null,
        ultimaCargaExitosa: 0
    };

    async function cargarTopUnaVez(forzar = false) {
    const ahora = Date.now();
    const CACHE_TTL = 5 * 60 * 1000;

    if (_controlCargaTop.promesaEnCurso) {
        console.log('⏭ Top ya se está cargando...');
        return _controlCargaTop.promesaEnCurso;
    }

    if (!forzar &&
        estado.productos.length > 0 &&
        !estado._productosCacheInvalidado &&
        (ahora - _controlCargaTop.ultimaCargaExitosa) < CACHE_TTL) {
        console.log(`⚡ Top en caché válido (${estado.productos.length} productos)`);
        return estado.productos;
    }

    _controlCargaTop.promesaEnCurso = (async () => {
        try {
            console.log('📥 Cargando top 2000 (promesa única)...');
            const resp = await api.get('/Productos/top?limite=2000');

            if (!resp.ok) {
                console.warn('⚠️ Error cargando top');
                return null;
            }

            const productos = (resp.data || []).filter(p => p.estado === 'Activo');

            // ============================================================
            // 🆕 LIMPIEZA AUTOMÁTICA SI LA BD ESTÁ VACÍA
            // ============================================================
            if (productos.length === 0) {
                console.warn('🚨 La base de datos está VACÍA. Limpiando todos los cachés...');

                // Limpiar IndexedDB
                if (typeof CatalogoDB !== 'undefined') {
                    await CatalogoDB.limpiarCache();
                    console.log('   ✅ IndexedDB limpiado');
                }

                // Limpiar LocalStorage
                localStorage.removeItem('pos_top_productos_cache_v3');
                localStorage.removeItem('pos_catalogo_completo');
                localStorage.removeItem('pos_catalogo_meta');
                localStorage.removeItem('pos_hash_productos');
                localStorage.removeItem('pos_version_catalogo');
                console.log('   ✅ LocalStorage limpiado');

                // Limpiar caché de búsquedas
                if (typeof _busquedaCacheGlobal !== 'undefined') {
                    _busquedaCacheGlobal.clear();
                    console.log('   ✅ Caché de búsquedas limpiado');
                }

                // Limpiar estado (excepto tokens y usuario)
                estado.productos = [];
                estado.carritos = { venta1: [] };
                estado.historial = [];
                estado._productosCacheInvalidado = true;
                console.log('   ✅ Estado limpiado');

                // Limpiar el DOM
                const contenedor = document.getElementById('catalogoProductos');
                if (contenedor) {
                    contenedor.innerHTML = `
                        <div style="grid-column:1/-1; text-align:center; padding:60px 20px; color:var(--text-muted);">
                            <div style="font-size:48px; opacity:0.5; margin-bottom:12px;">📦</div>
                            <div style="font-weight:600; font-size:16px; margin-bottom:6px;">
                                No hay productos en el catálogo
                            </div>
                            <div style="font-size:13px;">
                                La base de datos está vacía. Importa productos para comenzar.
                            </div>
                        </div>`;
                    console.log('   ✅ DOM limpiado');
                }

                // Resetear control de carga
                _controlCargaTop.ultimaCargaExitosa = 0;

                // Mostrar notificación al usuario
                if (typeof toast === 'function') {
                    toast('⚠️ No hay productos en el catálogo', 'error');
                }

                return [];
            }

            // ============================================================
            // DETECCIÓN DE CAMBIOS DRÁSTICOS
            // ============================================================
            const productosViejos = estado.productos.length;
            if (productosViejos > 0) {
                const ratio = Math.abs(productos.length - productosViejos) / productosViejos;
                if (ratio > 0.20) {
                    console.log(`🚨 Cambio drástico detectado: ${productosViejos} → ${productos.length} (${(ratio * 100).toFixed(1)}%)`);
                    console.log('🔄 Invalidando IndexedDB para resincronizar...');
                    
                    if (typeof CatalogoDB !== 'undefined') {
                        await CatalogoDB.limpiarCache();
                    }
                }
            }

            estado.productos = productos;
            estado._ultimaCargaTop = Date.now();
            estado._productosCacheInvalidado = false;
            _controlCargaTop.ultimaCargaExitosa = Date.now();

            console.log(`✅ Top cargado: ${productos.length} productos`);
            return productos;
        } catch (e) {
            console.error('❌ Error en cargarTopUnaVez:', e);
            return null;
        } finally {
            _controlCargaTop.promesaEnCurso = null;
        }
    })();

    return _controlCargaTop.promesaEnCurso;
}
/* ============================================================
   3. PERSISTENCIA
   ============================================================ */

function guardarEstado() {
    try {
        const copia = {
            carritos: estado.carritos,
            pestañaActiva: estado.pestañaActiva,
            vistaCatalogo: estado.vistaCatalogo,
            terminoBusqueda: estado.terminoBusqueda,
            historial: estado.historial,
            nombres: estado.nombres
        };
        localStorage.setItem(STORAGE_KEYS.APP, JSON.stringify(copia));
    } catch (e) {
        console.warn('guardarEstado error', e);
    }
}

function restaurarEstado() {
    try {
        const data = localStorage.getItem(STORAGE_KEYS.APP);
        if (!data) return;
        const parsed = JSON.parse(data);
        estado.carritos = parsed.carritos || { venta1: [] };
        estado.pestañaActiva = parsed.pestañaActiva || 'venta1';
        estado.vistaCatalogo = parsed.vistaCatalogo || 'lista';
        estado.terminoBusqueda = parsed.terminoBusqueda || '';
        estado.historial = parsed.historial || [];
        estado.nombres = parsed.nombres || {};
    } catch (e) {
        console.warn('restaurarEstado error', e);
    }
}

function borrarEstadoManual() {
    if (!confirm('¿Seguro que deseas borrar todo el almacenamiento de la app?')) return;
    Object.values(STORAGE_KEYS).forEach(k => localStorage.removeItem(k));
    estado.carritos = { venta1: [] };
    estado.pestañaActiva = 'venta1';
    estado.historial = [];
    estado.nombres = {};
    guardarEstado();
    cargarVista('ventas');
}

function limpiarEstadoSesion() {
    localStorage.removeItem(STORAGE_KEYS.APP);

    estado.carritos = { venta1: [] };
    estado.pestañaActiva = 'venta1';
    estado.vistaCatalogo = 'lista';
    estado.terminoBusqueda = '';
    estado.historial = [];
    estado.nombres = {};
    estado.productos = [];
    estado.clientes = [];
    estado._ventasInited = false;
    estado._clientesInited = false;
    estado._cargandoProductos = false;

    // 🆕 Resetear control de carga del top
    estado._ultimaCargaTop = 0;
    estado._productosCacheInvalidado = true;
    _controlCargaTop.promesaEnCurso = null;
    _controlCargaTop.ultimaCargaExitosa = 0;

    // 🆕 Resetear banderas del catálogo completo
    window._catalogoCompletoSolicitado = false;
    window._catalogoCompletoCargado = false;

    // Limpiar UI de tabs (excepto venta1)
    const tabs = document.getElementById('tabs');
    if (tabs) {
        tabs.querySelectorAll('.tab[data-id]').forEach(t => {
            if (t.dataset.id !== 'venta1') t.remove();
        });
        const tabVenta1 = tabs.querySelector('.tab[data-id="venta1"] .label');
        if (tabVenta1) tabVenta1.textContent = 'Venta 1';
    }

    const contenedorVentas = document.getElementById('contenedor-ventas');
    if (contenedorVentas) {
        contenedorVentas.querySelectorAll('.venta').forEach(v => {
            if (v.id !== 'venta1') v.remove();
        });
    }

    console.log('🧹 Estado de sesión limpiado');
}
/* ============================================================
   4. TOASTS Y MODALES
   ============================================================ */

function toast(msg, type = 'success') {
    const cont = document.getElementById('toastContainer');
    if (!cont) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    cont.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
        el.classList.remove('show');
        setTimeout(() => el.remove(), 300);
    }, 2500);
}

function showModal(modal) {
    if (!modal) return;
    modal.style.display = 'flex';
    requestAnimationFrame(() => modal.classList.add('open'));

    const fab = document.getElementById('cartFab');
    if (fab) fab.classList.add('oculto');   // 🆕 clase en vez de display
}

function hideModal(modal) {
    if (!modal) return;
    modal.classList.remove('open');
    setTimeout(() => {
        if (!modal.classList.contains('open')) modal.style.display = 'none';

        const fab = document.getElementById('cartFab');
        const hayModalesAbiertos = document.querySelectorAll('.modal.open').length > 0;
        if (fab && !hayModalesAbiertos) {
            fab.classList.remove('oculto');
        }
    }, 250);
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal.open').forEach(m => {
            if (m.dataset.noEsc !== 'true') hideModal(m);
        });
    }
});

// ============================================================
// REGISTRO DE USO DE VISTAS (para accesos rápidos dinámicos)
// ============================================================

const STORAGE_USO_VISTAS = 'pos_uso_vistas';

/**
 * Registra que el usuario visitó una vista.
 * Los conteos se guardan por usuario (usando su id).
 */
function registrarUsoVista(idVista) {
    // No registrar vistas de contenido informativo
    const vistasIgnoradas = ['acerca', 'quienes', 'contacto', 'tratamiento', 'config'];
    if (vistasIgnoradas.includes(idVista)) return;

    try {
        // Obtener el usuario actual
        const usuarioStr = localStorage.getItem('pos_usuario');
        if (!usuarioStr) return;

        const usuario = JSON.parse(usuarioStr);
        const idUsuario = usuario.id || usuario.idUsuario;
        if (!idUsuario) return;

        // Obtener el registro global de uso
        const usoGlobal = JSON.parse(localStorage.getItem(STORAGE_USO_VISTAS) || '{}');
        const usoUsuario = usoGlobal[idUsuario] || {};

        // Incrementar contador
        usoUsuario[idVista] = (usoUsuario[idVista] || 0) + 1;

        // Guardar
        usoGlobal[idUsuario] = usoUsuario;
        localStorage.setItem(STORAGE_USO_VISTAS, JSON.stringify(usoGlobal));

        //console.log(`📊 Uso registrado: usuario ${idUsuario} → "${idVista}" (${usoUsuario[idVista]} veces)`);
    } catch (e) {
        console.warn('Error registrando uso de vista:', e);
    }
}

/**
 * Obtiene el top N de vistas más usadas por el usuario actual.
 */
function obtenerTopVistas(n = 3) {
    try {
        const usuarioStr = localStorage.getItem('pos_usuario');
        if (!usuarioStr) return [];

        const usuario = JSON.parse(usuarioStr);
        const idUsuario = usuario.id || usuario.idUsuario;
        if (!idUsuario) return [];

        const usoGlobal = JSON.parse(localStorage.getItem(STORAGE_USO_VISTAS) || '{}');
        const usoUsuario = usoGlobal[idUsuario] || {};

        // Ordenar por frecuencia descendente
        const top = Object.entries(usoUsuario)
            .sort(([, a], [, b]) => b - a)
            .slice(0, n)
            .map(([vista]) => vista);

        return top;
    } catch (e) {
        console.warn('Error obteniendo top vistas:', e);
        return [];
    }
}

/* ============================================================
   5. NAVEGACIÓN DE VISTAS
   ============================================================ */

function nombreVista(id) {
    const map = {
        inicio: '🏠 Inicio',
        ventas: '💳 Ventas',
        historial: '🕓 Historial',
        inventario: '📦 Inventario',
        categorias: '🍡 Categorías',
        clientes: '👥 Clientes',
        usuarios: '👤 Usuarios',
        fidelizacion: '🔝 Fidelización',
        reportes: '📊 Reportes',
        config: '⚙️ Configuración',
        acerca: 'ℹ️ Acerca de',
        quienes: '👥 Quiénes somos',
        contacto: '📞 Contacto',
        tratamiento: '📄 Tratamiento de datos'
    };
    return map[id] || 'Vista';
}

function cargarVista(idVista) {
    registrarUsoVista(idVista);
    document.querySelectorAll('.vista').forEach(v => v.hidden = true);

    const vista = document.getElementById(`vista-${idVista}`);
    const titulo = document.getElementById('titulo-vista');

    if (!vista) {
        if (titulo) titulo.textContent = 'Vista no disponible';
        return;
    }

    vista.hidden = false;
    if (titulo) titulo.textContent = nombreVista(idVista);

    if (typeof resaltarMenuActivo === 'function') {
        resaltarMenuActivo(idVista);
    }

    if (idVista === 'ventas') initVentas();
    if (idVista === 'historial') renderHistorial();
    if (idVista === 'clientes') initClientes();
    if (idVista === 'inventario') initInventario();
    if (idVista === 'categorias') initCategorias();
    if (idVista === 'usuarios') initUsuarios();
    if (idVista === 'inicio') initReportes();

    // Reconectar buscadores después de renderizar
    setTimeout(() => {
        if (typeof BuscadorUI !== 'undefined') {
            BuscadorUI.init();
        }
    }, 150);

    // 🆕 Refrescar stock después de un momento al cambiar de vista
    if (idVista === 'ventas') {
        setTimeout(() => {
            if (typeof refrescarStockCatalogo === 'function') {
                refrescarStockCatalogo();
            }
        }, 150);
    }
}

// 🆕 Invalidar caché del top
estado._productosCacheInvalidado = true;
/* ============================================================
   6. PRODUCTOS DESDE LA API
   ============================================================ */

/* ==================== PRODUCTOS DESDE LA API (TOP 1000) ==================== */

/* ============================================================
   CATÁLOGO DE PRODUCTOS — Carga paginada + scroll infinito
   ============================================================ */

const CATALOGO_PAGE_SIZE = 300;

let _catalogoEstado = {
    pagina: 1,
    total: 0,
    hayMas: true,
    cargando: false,
    categoriaId: null,
    busqueda: '',
    observer: null,
    _scrollIniciado: false
};

/* ============================================================
   PRECARGA DEL TOP 1000 — Usa /Productos/top existente
   ============================================================ */

/* ============================================================
   🆕 Precarga del top 2000 — YA NO HACE PETICIÓN
   Solo se encarga de mantener sincronizado el caché de localStorage
   con lo que ya está en memoria. La petición la hace cargarTopUnaVez().
   ============================================================ */
async function precargarTop1000() {
    const token = localStorage.getItem('pos_token');
    if (!token) return;

    // Si ya está en memoria, solo sincronizar localStorage
    if (estado.productos.length > 0) {
        try {
            localStorage.setItem(TOP_CACHE_KEY, JSON.stringify({
                ts: Date.now(),
                data: estado.productos
            }));
        } catch (e) {
            console.warn('No se pudo guardar el top en caché:', e);
        }
        return;
    }

    // Si no hay nada en memoria, usar el sistema único
    await cargarTopUnaVez(false);
}

function limpiarCacheTop() {
    _topProductos = [];
    localStorage.removeItem(TOP_CACHE_KEY);
    console.log('🗑 Caché del top limpiado');
}

/* ============================================================
   Búsqueda LOCAL (SOLO memoria — usa estado.productos)
   ============================================================ */
function buscarLocal(query) {
    if (!query || query.trim().length < 2) return [];
    const q = query.trim();

    const mapa = new Map();
    
    // ✅ Usar SOLO estado.productos (que sí tiene los 2000)
    for (const p of estado.productos || []) {
        mapa.set(p.idProducto, p);
    }

    if (mapa.size === 0) return [];

    const items = [];
    for (const p of mapa.values()) {
        items.push({
            idProducto: p.idProducto,
            nombre: p.nombre,
            sku: p.sku || p.codigoInterno || '',
            categoria: p.categoriaNombre || '',
            vecesVendido: p.vecesVendido || 0,
            _ref: p
        });
    }

    const encontrados = Buscador.buscar(q, items, { minScore: 25 });
    return encontrados.slice(0, 100);
}
/* ============================================================
   BÚSQUEDA HÍBRIDA EN 3 CAPAS — SIN RECARGAR EL TOP
   1. Memoria (TOP 2000)             → 1-5ms
   2. Catálogo completo IndexedDB    → 5-20ms
   3. Servidor (último recurso)      → 50-200ms
   ============================================================ */
const _busquedaCacheGlobal = new Map();
let _busquedaAbortControllerGlobal = null;

async function buscarEnServidor(query, silencioso = false) {
    const q = query.trim();
    if (q.length < 2) return;

    const cacheKey = q.toLowerCase();
    if (_busquedaCacheGlobal.has(cacheKey)) {
        mostrarResultadosBusqueda(_busquedaCacheGlobal.get(cacheKey));
        return;
    }

    if (_busquedaAbortControllerGlobal) _busquedaAbortControllerGlobal.abort();
    _busquedaAbortControllerGlobal = new AbortController();

    try {
        // ============================================================
        // CAPA 1: Búsqueda local en memoria (TOP 2000)
        // ============================================================
        const locales = buscarLocal(q);
        if (locales.length >= 5) {
            console.log(`✅ "${q}": ${locales.length} resultados en memoria`);
            cachearYMostrar(cacheKey, locales);
            return;
        }

        // ============================================================
        // CAPA 2: Catálogo completo en IndexedDB
        // ============================================================
        if (typeof CatalogoDB !== 'undefined' && 
            typeof CatalogoDB.buscarPorTexto === 'function') {
            try {
                console.log(`🔍 "${q}": buscando en IndexedDB...`);
                const t0 = performance.now();
                
                const enIndexedDB = await CatalogoDB.buscarPorTexto(q, 50);
                const tiempo = Math.round(performance.now() - t0);

                if (enIndexedDB && enIndexedDB.length > 0) {
                    const resultados = enIndexedDB.map(p => ({
                        idProducto: p.idProducto,
                        nombre: p.nombre,
                        sku: p.sku || p.codigoInterno || '',
                        categoria: p.categoriaNombre || '',
                        vecesVendido: p.vecesVendido || 0,
                        _ref: p
                    }));

                    const idsVistos = new Set(resultados.map(r => r.idProducto));
                    const combinados = [
                        ...resultados,
                        ...locales.filter(l => !idsVistos.has(l.idProducto))
                    ];

                    console.log(`✅ "${q}": ${combinados.length} resultados (IndexedDB en ${tiempo}ms)`);
                    cachearYMostrar(cacheKey, combinados);
                    return;
                }
            } catch (e) {
                console.warn('⚠️ Error buscando en IndexedDB:', e);
            }
        }

        // ============================================================
        // CAPA 3: Servidor (último recurso) — SOLO busca, NO recarga
        // ============================================================
        console.log(`🔍 "${q}": consultando servidor...`);
        
        const resp = await api.get(`/Productos/buscar?q=${encodeURIComponent(q)}&limite=50`);
        if (!resp.ok) {
            if (locales.length > 0) cachearYMostrar(cacheKey, locales);
            return;
        }

        const resultadosRaw = resp.data.resultados || resp.data || [];
        const resultados = resultadosRaw.map(p => ({
            idProducto: p.idProducto,
            nombre: p.nombre,
            sku: p.sku || p.codigoInterno || '',
            categoria: p.categoriaNombre || '',
            vecesVendido: p.vecesVendido || 0,
            _ref: p
        }));

        if (resultados.length === 0 && locales.length > 0) {
            cachearYMostrar(cacheKey, locales);
            return;
        }

        cachearYMostrar(cacheKey, resultados);

    } catch (e) {
        if (e.name !== 'AbortError') console.warn('Error buscando:', e);
    }
}

function cachearYMostrar(cacheKey, resultados) {
    // Limitar caché a 50 entradas (era 20, muy poco)
    if (_busquedaCacheGlobal.size >= 50) {
        const primeraClave = _busquedaCacheGlobal.keys().next().value;
        _busquedaCacheGlobal.delete(primeraClave);
    }
    _busquedaCacheGlobal.set(cacheKey, resultados);
    mostrarResultadosBusqueda(resultados);
}

/* ============================================================
   Helper: cachear y mostrar resultados
   ============================================================ */
function cachearYMostrar(cacheKey, resultados) {
    if (_busquedaCacheGlobal.size >= 20) {
        const primeraClave = _busquedaCacheGlobal.keys().next().value;
        _busquedaCacheGlobal.delete(primeraClave);
    }
    _busquedaCacheGlobal.set(cacheKey, resultados);
    mostrarResultadosBusqueda(resultados);
}

/* ============================================================
   🆕 Helper: cachear y mostrar
   ============================================================ */
function cachearYMostrar(cacheKey, resultados) {
    // Limitar tamaño del caché
    if (_busquedaCacheGlobal.size >= 20) {
        const primeraClave = _busquedaCacheGlobal.keys().next().value;
        _busquedaCacheGlobal.delete(primeraClave);
    }
    _busquedaCacheGlobal.set(cacheKey, resultados);
    mostrarResultadosBusqueda(resultados);
}

/* ============================================================
   RENDER DE RESULTADOS EN EL CATÁLOGO
   ============================================================ */
// En App.js, modifica mostrarResultadosBusqueda para que no dependa de variables globales:
function mostrarResultadosBusqueda(resultados) {
    const contenedor = document.getElementById('catalogoProductos');
    if (!contenedor) return;

    if (resultados.length === 0) {
        contenedor.innerHTML = `
            <div style="grid-column:1/-1; text-align:center; padding:40px 20px; color:var(--text-muted);">
                <div style="font-size:36px; opacity:0.5; margin-bottom:8px;">🔍</div>
                <div style="font-weight:600;">Sin resultados</div>
            </div>`;
        return;
    }

    const vistos = new Set();
    const unicos = resultados.filter(r => {
        if (vistos.has(r.idProducto)) return false;
        vistos.add(r.idProducto);
        return true;
    });

    contenedor.innerHTML = unicos.map(r => renderCardProducto(r._ref || r)).join('');

    // Actualizar el dropdown de sugerencias (si existe)
    const panel = window._sugerenciasPanelCatalogo;
    const input = window._inputBuscadorCatalogo;
    if (panel && input && input.value.trim().length >= 2) {
        const top5 = unicos.slice(0, 5);
        panel.innerHTML = top5.map((item, i) => {
            const nombreHtml = typeof Buscador.resaltar === 'function'
                ? Buscador.resaltar(item.nombre || '', item._coincidencias || [])
                : escapeHtml(item.nombre || '');
            return `
                <div class="sugerencia-item" data-index="${i}">
                    <span class="sugerencia-indice">${i + 1}</span>
                    <span class="sugerencia-nombre">${nombreHtml}</span>
                    <span class="sugerencia-sku">${escapeHtml(item.sku || '')}</span>
                </div>
            `;
        }).join('');
        panel.style.display = top5.length > 0 ? 'block' : 'none';

        panel.querySelectorAll('.sugerencia-item').forEach((el, i) => {
            el.onclick = (e) => {
                e.stopPropagation();
                const item = top5[i];
                if (item && item._ref) {
                    const card = document.querySelector(`.producto[data-id-producto="${item._ref.idProducto}"]`);
                    if (card) {
                        const btn = card.querySelector('.agregar');
                        if (btn && !btn.disabled) btn.click();
                    }
                }
                panel.style.display = 'none';
            };
        });
    } else if (panel) {
        panel.style.display = 'none';
    }

    if (typeof refrescarStockCatalogo === 'function') {
        setTimeout(() => refrescarStockCatalogo(), 0);
    }
}
async function cargarProductosDesdeAPI(forzar = false) {
    if (estado._cargandoProductos) {
        console.log('⏳ Carga de productos ya en curso');
        return;
    }

    const token = localStorage.getItem('pos_token');
    if (!token) return;

    const contenedor = document.getElementById('catalogoProductos');
    if (!contenedor) return;

    estado._cargandoProductos = true;

    try {
        const productos = await cargarTopUnaVez(forzar);

        // 🆕 Si no hay productos, mostrar mensaje y salir
        if (!productos || productos.length === 0) {
            contenedor.innerHTML = `
                <div style="grid-column:1/-1; text-align:center; padding:60px 20px; color:var(--text-muted);">
                    <div style="font-size:48px; opacity:0.5; margin-bottom:12px;">📦</div>
                    <div style="font-weight:600; font-size:16px; margin-bottom:6px;">
                        No hay productos en el catálogo
                    </div>
                    <div style="font-size:13px;">
                        Importa productos para comenzar a vender
                    </div>
                </div>`;
            return;
        }

        contenedor.innerHTML = productos.map(p => renderCardProducto(p)).join('');

        if (estado.terminoBusqueda) {
            filtrarCatalogo(estado.terminoBusqueda);
        }

        if (typeof refrescarStockCatalogo === 'function') {
            refrescarStockCatalogo();
        }

        refrescarBuscador();

        if (!window._catalogoCompletoSolicitado && productos.length > 0) {
            window._catalogoCompletoSolicitado = true;
            cargarCatalogoCompletoEnBackground();
        }

    } finally {
        estado._cargandoProductos = false;
    }
}
function refrescarBuscador() {
    if (typeof BuscadorUI === 'undefined') return;

    const input = document.getElementById('buscador');
    if (!input) return;

    // 🆕 Si tiene API y método refresh, usarlo
    if (input._buscadorAPI && typeof input._buscadorAPI.refresh === 'function') {
        setTimeout(() => {
            // ⚠️ CRÍTICO: Re-verificar DENTRO del setTimeout
            // porque _buscadorAPI puede haber cambiado
            const inputActual = document.getElementById('buscador');
            if (!inputActual) return;
            
            if (inputActual._buscadorAPI && 
                typeof inputActual._buscadorAPI.refresh === 'function') {
                try {
                    inputActual._buscadorAPI.refresh();
                } catch (e) {
                    console.warn('⚠️ Error refrescando buscador:', e);
                    // Fallback: reinicializar de cero
                    inputActual.removeAttribute('data-buscador-ready');
                    inputActual._buscadorAPI = null;
                    setTimeout(() => BuscadorUI.init(), 50);
                }
            }
        }, 50);
        return;
    }

    // 🆕 Si no tiene API, reinicializar
    input.removeAttribute('data-buscador-ready');
    input._buscadorAPI = null;
    setTimeout(() => BuscadorUI.init(), 50);
}
/**
 * Extrae el HTML de un producto a una función separada.
 * Útil porque se usa en varios lugares.
 */
function renderCardProducto(p) {
    const precioFmt = formato(p.precioVenta);
    const sku = p.sku || p.codigoInterno;
    const stockColor = p.stockActual <= p.stockMinimo ? '#dc2626' : '#16a34a';
    const agotado = p.stockActual <= 0;

    return `
        <div class="producto"
            data-id-producto="${p.idProducto}"
            data-nombre="${escapeHtml(p.nombre)}"
            data-precio="${p.precioVenta}"
            data-sku="${escapeHtml(sku)}"
            data-stock="${p.stockActual}"
            data-stock-base="${p.stockActual}"
            data-categoria="${escapeHtml(p.categoriaNombre || '')}">
            <div class="prod-info">
                <span class="prod-nombre" title="${escapeHtml(p.nombre)}">${escapeHtml(p.nombre)}</span>
                <span class="prod-sku">${escapeHtml(sku)}</span>
            </div>
            <div class="prod-precio">${precioFmt}</div>
            <div class="prod-stock" style="color:${stockColor};">
                ${agotado ? '⛔ Agotado' : `📦 ${p.stockActual} disponibles`}
            </div>
            <button class="btn agregar" ${agotado ? 'disabled' : ''}>
                ${agotado ? 'Agotado' : '+ Agregar'}
            </button>
        </div>
    `;
}

/**
 * 🆕 Carga el catálogo completo (todos los productos) en background.
 * NO bloquea la UI. Se guarda en localStorage.
 */
/* ============================================================
   🆕 Catálogo completo en background — UNA SOLA VEZ por sesión
   ============================================================ */
async function cargarCatalogoCompletoEnBackground() {
    // 🆕 Solo ejecutar una vez por sesión
    if (window._catalogoCompletoCargado) {
        console.log('⏭ Catálogo completo ya cargado en esta sesión');
        return;
    }

    if (typeof Catalogo === 'undefined') {
        console.warn('⚠️ Catalogo.js no está cargado');
        return;
    }

    window._catalogoCompletoCargado = true;
    console.log('📥 Iniciando carga del catálogo completo en segundo plano...');

    try {
        const todos = await Catalogo.cargarCompleto();
        if (todos && todos.length > 0) {
            console.log(`✅ Catálogo completo listo en background (${todos.length} productos)`);

            if (typeof toast === 'function') {
                toast(`📥 Catálogo completo listo (${todos.length} productos)`, 'success');
            }
        }
    } catch (err) {
        console.warn('⚠️ Error cargando catálogo en background:', err);
        // Permitir reintento si falló
        window._catalogoCompletoCargado = false;
    }
}
function renderCardProducto(p) {
    const precioFmt = formato(p.precioVenta);
    const sku = p.sku || p.codigoInterno;
    const stockColor = p.stockActual <= p.stockMinimo ? '#dc2626' : '#16a34a';
    const agotado = p.stockActual <= 0;

    return `
        <div class="producto"
            data-id-producto="${p.idProducto}"
            data-nombre="${escapeHtml(p.nombre)}"
            data-precio="${p.precioVenta}"
            data-sku="${escapeHtml(sku)}"
            data-categoria="${escapeHtml(p.categoriaNombre || '')}"
            data-stock="${p.stockActual}"
            data-stock-base="${p.stockActual}"
            data-veces-vendido="${p.vecesVendido || 0}">
            <div class="prod-info">
                <span class="prod-nombre" title="${escapeHtml(p.nombre)}">${escapeHtml(p.nombre)}</span>
                <span class="prod-sku">SKU: ${escapeHtml(sku)}</span>
            </div>
            <div class="prod-precio">${precioFmt}</div>
            <div class="prod-stock" style="color:${stockColor};">
                ${agotado ? '⛔ Agotado' : `📦 ${p.stockActual} disponibles`}
            </div>
            <button class="btn agregar" ${agotado ? 'disabled' : ''}>
                ${agotado ? 'Agotado' : '+ Agregar'}
            </button>
        </div>
    `;
}

function mostrarIndicadorCargaMas(contenedor) {
    if (contenedor.querySelector('.catalogo-cargando-mas')) return;
    contenedor.insertAdjacentHTML('beforeend', `
        <div class="catalogo-cargando-mas" style="grid-column: 1 / -1; text-align: center; padding: 20px; color: #64748b;">
            <span style="display:inline-block; width:20px; height:20px; border:2px solid #cbd5e1; border-top-color: var(--color-primario); border-radius:50%; animation: spin 0.6s linear infinite; vertical-align: middle; margin-right: 8px;"></span>
            Cargando más productos...
        </div>
        <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
    `);
}

function quitarIndicadorCargaMas(contenedor) {
    contenedor.querySelector('.catalogo-cargando-mas')?.remove();
}

function actualizarInfoCatalogo() {
    const info = document.getElementById('catalogoInfo');
    if (info) {
        info.textContent = `${estado.productos.length} de ${_catalogoEstado.total} productos`;
    }
}

function configurarScrollInfinito(contenedor) {
    const scroller = contenedor.closest('.productos') || contenedor;

    if (_catalogoEstado.observer) _catalogoEstado.observer.disconnect();

    // 🆕 Solo activar scroll infinito si:
    //   - El contenedor tiene suficiente contenido para hacer scroll
    //   - El usuario ya ha interactuado (evita autoload al inicio)
    if (scroller.scrollHeight <= scroller.clientHeight * 1.5) {
        console.log('⏭ Scroll infinito desactivado: poco contenido');
        return;
    }

    _catalogoEstado.observer = new IntersectionObserver((entries) => {
        entries.forEach(e => {
            if (e.isIntersecting && _catalogoEstado.hayMas && !_catalogoEstado.cargando) {
                // 🆕 Verificar que el usuario haya hecho scroll manualmente
                if (!_catalogoEstado._scrollIniciado) return;

                // 🆕 Esperar un poquito entre páginas para no saturar
                setTimeout(() => {
                    if (_catalogoEstado.hayMas && !_catalogoEstado.cargando) {
                        cargarProductosDesdeAPI(false);
                    }
                }, 200);
            }
        });
    }, {
        root: scroller,
        rootMargin: '100px'   // reducir de 200px a 100px
    });

    const ultimoProducto = contenedor.querySelector('.producto:last-of-type');
    if (ultimoProducto) _catalogoEstado.observer.observe(ultimoProducto);

    // 🆕 Detectar el primer scroll del usuario
    if (!scroller._scrollDetector) {
        scroller._scrollDetector = true;
        scroller.addEventListener('scroll', () => {
            _catalogoEstado._scrollIniciado = true;
        }, { passive: true, once: false });
    }
}

/* ============================================================
   Filtro por categoría — SIN recargar el TOP
   Filtra en memoria usando estado.productos
   ============================================================ */
async function aplicarFiltroCategoria(categoriaId) {
    _catalogoEstado.categoriaId = categoriaId || null;

    const contenedor = document.getElementById('catalogoProductos');
    if (!contenedor) return;

    const productos = estado.productos || [];
    let filtrados = categoriaId 
        ? productos.filter(p => p.idCategoria === categoriaId)
        : productos;

    if (filtrados.length === 0) {
        contenedor.innerHTML = `
            <div style="grid-column:1/-1; text-align:center; padding:40px 20px; color:var(--text-muted);">
                <div style="font-size:36px; opacity:0.5; margin-bottom:8px;">📂</div>
                <div style="font-weight:600;">No hay productos en esta categoría</div>
            </div>`;
        return;
    }

    contenedor.innerHTML = filtrados.map(p => renderCardProducto(p)).join('');

    // Aplicar búsqueda activa encima del filtro
    if (estado.terminoBusqueda?.trim()) {
        filtrarCatalogo(estado.terminoBusqueda);
    }

    if (typeof refrescarStockCatalogo === 'function') refrescarStockCatalogo();
    if (typeof refrescarBuscador === 'function') refrescarBuscador();

    console.log(`📂 Filtro aplicado: ${filtrados.length} productos (categoría ${categoriaId || 'todas'})`);
}

/* ============================================================
   Búsqueda server-side con debounce
   NO recarga el TOP, solo busca resultados específicos
   ============================================================ */
let _busquedaServerSideTimeout = null;

function buscarProductosServerSide(termino) {
    clearTimeout(_busquedaServerSideTimeout);
    
    _busquedaServerSideTimeout = setTimeout(async () => {
        _catalogoEstado.busqueda = termino || '';

        // 🆕 NO recargar el top, delegar a buscarEnServidor
        if (!termino || termino.trim().length < 2) {
            // Si está vacío, solo re-renderizar desde memoria
            rerenderizarCatalogoDesdeMemoria();
            return;
        }

        // Buscar sin recargar el top
        await buscarEnServidor(termino);
    }, 400);
}

/* ==================== CARGAR TODOS LOS PRODUCTOS ==================== */

async function cargarTodosLosProductos() {
    const token = localStorage.getItem('pos_token');
    if (!token) {
        toast('Debes iniciar sesión', 'error');
        return;
    }

    if (!confirm('Esto cargará TODOS los productos. Puede tardar unos segundos. ¿Continuar?')) return;

    if (estado._cargandoProductos) {
        toast('Ya hay una carga en curso', 'error');
        return;
    }

    const contenedor = document.getElementById('catalogoProductos');
    if (!contenedor) return;

    estado._cargandoProductos = true;
    contenedor.innerHTML = `<p style="text-align:center;color:#64748b;padding:20px;">Cargando todos los productos...</p>`;

    try {
        // Cargar en lotes de 500
        let todos = [];
        let page = 1;
        const pageSize = 500;

        while (true) {
            const resp = await api.get(`/Productos?page=${page}&pageSize=${pageSize}`);
            if (!resp.ok) break;

            const lote = resp.data || [];
            if (lote.length === 0) break;

            todos = todos.concat(lote.filter(p => p.estado === 'Activo'));
            page++;

            if (lote.length < pageSize) break;

            // Límite de seguridad
            if (page > 100) {
                console.warn('⚠️ Límite de páginas alcanzado');
                break;
            }
        }

        if (todos.length === 0) {
            contenedor.innerHTML = `<p style="text-align:center;color:#64748b;padding:20px;">No hay productos activos.</p>`;
            toast('No hay productos para mostrar', 'error');
            return;
        }

        // Guardar en memoria + resetear flags de caché
        estado.productos = todos;
        estado._ultimaCargaTop = Date.now();
        estado._productosCacheInvalidado = false;

        // Re-renderizar
        contenedor.innerHTML = todos.map(p => {
            const precioFmt = formato(p.precioVenta);
            const sku = p.sku || p.codigoInterno;
            const stockColor = p.stockActual <= p.stockMinimo ? '#dc2626' : '#16a34a';
            const agotado = p.stockActual <= 0;

            return `
                <div class="producto"
                    data-id-producto="${p.idProducto}"
                    data-nombre="${escapeHtml(p.nombre)}"
                    data-precio="${p.precioVenta}"
                    data-sku="${escapeHtml(sku)}"
                    data-stock="${p.stockActual}"
                    data-stock-base="${p.stockActual}"
                    data-categoria="${escapeHtml(p.categoriaNombre || '')}">
                    <div class="prod-info">
                        <span class="prod-nombre" title="${escapeHtml(p.nombre)}">${escapeHtml(p.nombre)}</span>
                        <span class="prod-sku">${escapeHtml(sku)}</span>
                    </div>
                    <div class="prod-precio">${precioFmt}</div>
                    <div class="prod-stock" style="color:${stockColor};">
                        ${agotado ? '⛔ Agotado' : `📦 ${p.stockActual} disponibles`}
                    </div>
                    <button class="btn agregar" ${agotado ? 'disabled' : ''}>
                        ${agotado ? 'Agotado' : '+ Agregar'}
                    </button>
                </div>
            `;
        }).join('');

        // Aplicar filtro de búsqueda activo
        if (estado.terminoBusqueda) {
            filtrarCatalogo(estado.terminoBusqueda);
        }

        // Refrescar stock dinámico
        if (typeof refrescarStockCatalogo === 'function') {
            refrescarStockCatalogo();
        }

        console.log(`✅ ${todos.length} productos cargados (todos)`);
        toast(`✅ ${todos.length} productos cargados`);

    } catch (err) {
        console.error('❌ Error al cargar todos los productos:', err);
        contenedor.innerHTML = `<p style="text-align:center;color:#dc2626;padding:20px;">Error al cargar productos.</p>`;
        toast('Error al cargar productos', 'error');
    } finally {
        estado._cargandoProductos = false;
    }
}

// Enganchar el botón
document.addEventListener('DOMContentLoaded', () => {
    const btnTodos = document.getElementById('btnCargarTodos');
    if (btnTodos && !btnTodos._attached) {
        btnTodos._attached = true;
        btnTodos.addEventListener('click', cargarTodosLosProductos);
    }
});

// ============================================================
// Poblar el select de categorías con las categorías únicas
// ============================================================
async function poblarFiltroCategorias() {
    const select = document.getElementById('filtroCategoria');
    if (!select) return;

    // 🆕 Solo poblar una vez por sesión
    if (select._cargado) {
        console.log('⏭ Categorías ya cargadas, se omite');
        return;
    }

    const seleccionActual = select.value;

    try {
        const resp = await api.get('/Productos/categorias-resumen');
        if (!resp.ok) {
            console.warn('⚠️ No se pudieron cargar las categorías');
            return;
        }

        const categorias = resp.data || [];

        select.innerHTML = '<option value="">📂 Todas las categorías</option>' +
            categorias
                .filter(c => c.cantidadProductos > 0)
                .map(c =>
                    `<option value="${c.idCategoria}">${escapeHtml(c.nombre)} (${c.cantidadProductos})</option>`
                ).join('');

        select.value = seleccionActual;
        select._cargado = true;
        console.log(`📂 ${categorias.length} categorías cargadas`);
    } catch (e) {
        console.error('❌ Error poblando categorías:', e);
    }
}
/* ============================================================
   7. BUSCADOR DEL CATÁLOGO DE VENTAS
   ============================================================ */

function filtrarCatalogo(texto) {
    const contenedor = document.getElementById('catalogoProductos');
    if (!contenedor) return;

    const q = (texto || '').trim();

    if (!q) {
        contenedor.querySelectorAll('.producto').forEach(card => {
            card.style.display = '';
        });
        return;
    }

    const cards = Array.from(contenedor.querySelectorAll('.producto'));
    if (cards.length === 0) return;

    const items = cards.map(card => ({
        nombre: card.dataset.nombre || '',
        sku: card.dataset.sku || '',
        categoria: card.dataset.categoria || '',
        _card: card
    }));

    const encontrados = Buscador.buscar(q, items, { minScore: 25 });
    const encontradosSet = new Set(encontrados.map(e => e._card));

    cards.forEach(card => {
        card.style.display = encontradosSet.has(card) ? '' : 'none';
    });
}

async function initVentas() {
    const token = localStorage.getItem('pos_token');
    if (!token) return;

    // Reset SOLO la primera vez por sesión
    if (!estado._ventasInited) {
        _catalogoEstado = {
            pagina: 1, total: 0, hayMas: true, cargando: false,
            categoriaId: null, busqueda: '', observer: null, _scrollIniciado: false
        };
    }

    // ============================================================
    // 🆕 SOLO CARGAR SI ES NECESARIO
    // ============================================================
    const contenedor = document.getElementById('catalogoProductos');
    const necesitaCargar = !estado.productos.length || estado._productosCacheInvalidado;

    if (necesitaCargar) {
        console.log('📥 Cargando productos (necesario)');
        await cargarProductosDesdeAPI(true);
    } else if (contenedor && contenedor.children.length === 0) {
        // Ya hay productos en memoria → solo renderizar
        console.log(`⚡ Renderizando ${estado.productos.length} productos desde memoria`);
        contenedor.innerHTML = estado.productos.map(p => renderCardProducto(p)).join('');
        if (typeof refrescarStockCatalogo === 'function') refrescarStockCatalogo();
    } else {
        console.log(`⏭ Productos ya renderizados (${estado.productos.length} en memoria)`);
    }

    // Poblar filtro de categorías (solo una vez)
    await poblarFiltroCategorias();

    // Configurar el buscador
    if (typeof BuscadorUI !== 'undefined') {
        const inputBuscador = document.getElementById('buscador');
        if (inputBuscador) {
            inputBuscador.removeAttribute('data-buscador-ready');
            inputBuscador._buscadorAPI = null;
        }
        setTimeout(() => BuscadorUI.init(), 150);
    }

    setTimeout(() => {
        if (typeof refrescarStockCatalogo === 'function') refrescarStockCatalogo();
    }, 500);

    if (estado._ventasInited) {
        crearVentaUI('venta1', 1);
        activarPestaña(estado.pestañaActiva || 'venta1');
        return;
    }

    estado._ventasInited = true;
    if (!estado.carritos.venta1) estado.carritos.venta1 = [];

    setupTabsListener();
    setupCatalogoListener();
    setupContenedorVentasListener();
    setupNuevaVentaBtn();
    setupCerrarTodasBtn();
    setupBuscadorCatalogo();
    setupToggleVista();

    crearVentaUI('venta1', 1);
    initSplitter();
    activarPestaña(estado.pestañaActiva || 'venta1');
}
function setupTabsListener() {
    const tabs = document.getElementById('tabs');
    if (!tabs || tabs._listenerAttached) return;
    tabs._listenerAttached = true;

    tabs.addEventListener('click', e => {
        const tabEl = e.target.closest('.tab');
        if (!tabEl) return;

        if (e.target.closest('.label')?.isContentEditable) {
            e.stopPropagation();
            return;
        }

        if (tabEl.id === 'nuevaVenta') {
            crearVentaNueva();
            return;
        }

        if (e.target.classList.contains('cerrar')) {
            e.stopPropagation();
            cerrarTabConConfirmacion(tabEl);
            return;
        }

        if (tabEl.dataset.id) activarPestaña(tabEl.dataset.id);
    });

    tabs.addEventListener('dblclick', e => {
        const label = e.target.closest('.label');
        if (!label) return;
        e.stopPropagation();
        label.setAttribute('contenteditable', 'true');
        label.focus();
        const range = document.createRange();
        range.selectNodeContents(label);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    });

    tabs.addEventListener('blur', e => {
        if (!e.target.classList.contains('label')) return;
        e.target.setAttribute('contenteditable', 'false');
        const tabEl = e.target.closest('.tab');
        const id = tabEl?.dataset.id;
        const nuevo = e.target.textContent.trim();
        if (id && nuevo) {
            estado.nombres[id] = nuevo;
            guardarEstado();
            const h3 = document.getElementById(id)?.querySelector('h3');
            if (h3) h3.textContent = nuevo;
        }
    }, true);

    tabs.addEventListener('keydown', e => {
        if (e.target.classList.contains('label') && e.key === 'Enter') {
            e.preventDefault();
            e.target.blur();
        }
    });
}

function cerrarTabConConfirmacion(tabEl) {
    const id = tabEl.dataset.id;
    const carrito = estado.carritos[id] || [];
    const nombre = estado.nombres?.[id] || tabEl.querySelector('.label')?.textContent || id;

    if (id === 'venta1') {
        if (carrito.length === 0 || confirm('¿Limpiar Venta 1?')) {
            estado.carritos[id] = [];
            renderCarrito(id);
            guardarEstado();
            refrescarStockCatalogo();
            toast('Venta 1 limpiada');
        }
        return;
    }

    if (carrito.length === 0 || confirm(`¿Cerrar ${nombre}? Se perderán ${carrito.length} producto(s).`)) {
        cerrarPestaña(id);
        toast(`Se cerró ${nombre}`);
    }
}

function setupCatalogoListener() {
    const catalogo = document.querySelector('.catalogo');
    if (!catalogo || catalogo._listenerAttached) return;
    catalogo._listenerAttached = true;

    catalogo.addEventListener('click', e => {
        if (!e.target.classList.contains('agregar')) return;
        const card = e.target.closest('.producto');
        if (!card) return;

        const idProducto = parseInt(card.dataset.idProducto, 10);
        const nombre = card.dataset.nombre;
        const precio = parseFloat(card.dataset.precio) || 0;
        const sku = card.dataset.sku;
        const stock = parseInt(card.dataset.stock, 10) || 0;

        const ventaId = estado.pestañaActiva || 'venta1';
        agregarProducto(ventaId, { idProducto, nombre, precio, sku, stock });
    });
}

function setupContenedorVentasListener() {
    if (document._contenedorVentasListenerAttached) return;
    document._contenedorVentasListenerAttached = true;

    document.addEventListener('click', (e) => {
        const ventaId = estado.pestañaActiva || 'venta1';

        if (e.target.classList.contains('qty-btn')) {
            const fila = e.target.closest('tr');
            const sku = fila?.dataset.sku;
            const tipo = e.target.dataset.tipo;
            if (sku) actualizarCantidad(ventaId, sku, tipo);
            return;
        }

        if (e.target.classList.contains('action-del')) {
            const fila = e.target.closest('tr');
            const sku = fila?.dataset.sku;
            if (sku) eliminarProducto(ventaId, sku);
            return;
        }

        if (e.target.classList.contains('finalize')) {
            finalizarVenta(ventaId);
            return;
        }
    });
}

function setupNuevaVentaBtn() {
    // El listener está en tabs (por ID nuevaVenta)
}

function setupCerrarTodasBtn() {
    const btn = document.getElementById('cerrarTodas');
    if (!btn || btn._listenerAttached) return;
    btn._listenerAttached = true;

    btn.addEventListener('click', () => {
        const ids = Object.keys(estado.carritos).filter(id => id.startsWith('venta'));
        const conProductos = ids.filter(id => (estado.carritos[id] || []).length > 0);

        if (ids.length === 0) {
            toast('No hay pestañas para cerrar', 'error');
            return;
        }

        const msg = conProductos.length > 0
            ? `Se cerrarán ${ids.length} pestañas (${conProductos.length} con productos). ¿Continuar?`
            : `¿Cerrar las ${ids.length} pestañas?`;

        if (!confirm(msg)) return;

        for (const id of ids) {
            if (id === 'venta1') {
                estado.carritos[id] = [];
                renderCarrito(id);
            } else {
                delete estado.carritos[id];
                delete estado.nombres[id];
                document.querySelector(`.tab[data-id="${id}"]`)?.remove();
                document.getElementById(id)?.remove();
            }
        }

        guardarEstado();
        actualizarConteos();
        activarPestaña('venta1');
        toast('✅ Pestañas cerradas');
    });
}

function setupBuscadorCatalogo() {
    const buscador = document.getElementById('buscador');
    const btnClear = document.getElementById('btnClearSearch');
    if (!buscador || buscador._listenerAttached) return;
    buscador._listenerAttached = true;

    // ============================================================
    // 🆕 DECLARAR VARIABLES DE DEBOUNCE (AQUÍ, fuera del listener)
    // ============================================================
    let _busquedaTimeout = null;              // Debounce para servidor
    let _busquedaIndexedDBTimeout = null;     // Debounce para IndexedDB
    let indiceNavegacion = -1;                // Navegación con teclado

    // ============================================================
    // 1. FILTRO DE CATEGORÍA — Server-side
    // ============================================================
    const selectCategoria = document.getElementById('filtroCategoria');
    if (selectCategoria && !selectCategoria._catAttached) {
        selectCategoria._catAttached = true;
        selectCategoria.addEventListener('change', (e) => {
            const catId = e.target.value ? parseInt(e.target.value, 10) : null;
            aplicarFiltroCategoria(catId);
        });
    }

    // ============================================================
    // 2. ESTADO INICIAL DEL INPUT
    // ============================================================
    buscador.value = estado.terminoBusqueda || '';
    if (btnClear) {
        btnClear.style.display = buscador.value ? 'block' : 'none';
    }

    // ============================================================
    // LISTENER PRINCIPAL DEL BUSCADOR
    // ============================================================
    buscador.addEventListener('input', () => {
        const valor = buscador.value.trim();

        estado.terminoBusqueda = buscador.value;
        guardarEstado();

        if (btnClear) btnClear.style.display = valor ? 'block' : 'none';
        indiceNavegacion = -1;

        // ============================================================
        // CASO 1: BUSCADOR VACÍO → RESTAURAR TOP DESDE MEMORIA
        // 🆕 NO llama a la API. Solo re-renderiza.
        // ============================================================
        if (!valor) {
            clearTimeout(_busquedaTimeout);
            clearTimeout(_busquedaIndexedDBTimeout);
            _catalogoEstado.busqueda = '';

            console.log('🔄 Restaurando catálogo completo desde memoria...');
            rerenderizarCatalogoDesdeMemoria();   // 🆕 Helper que veremos abajo
            return;
        }

        // ============================================================
        // CASO 2: ESCANEO DE CÓDIGO DE BARRAS → servidor directo
        // ============================================================
        if (valor.length >= 8 && /^\d+$/.test(valor)) {
            clearTimeout(_busquedaTimeout);
            clearTimeout(_busquedaIndexedDBTimeout);
            buscarEnServidor(valor);
            return;
        }

        // ============================================================
        // CASO 3: BÚSQUEDA LOCAL INSTANTÁNEA (memoria)
        // ============================================================
        const locales = buscarLocal(valor);

        if (locales.length >= 3) {
            mostrarResultadosBusqueda(locales);
            clearTimeout(_busquedaTimeout);
            // Buscar más en background (silencioso)
            _busquedaTimeout = setTimeout(() => buscarEnServidor(valor, true), 500);
            return;
        }

        if (locales.length > 0) {
            mostrarResultadosBusqueda(locales);
        }

        // ============================================================
        // CASO 4: BÚSQUEDA EN INDEXEDDB (con debounce)
        // ============================================================
        if (locales.length === 0 && valor.length >= 3) {
            clearTimeout(_busquedaIndexedDBTimeout);
            _busquedaIndexedDBTimeout = setTimeout(async () => {
                if (typeof CatalogoDB === 'undefined' || 
                    typeof CatalogoDB.buscarPorTexto !== 'function') {
                    return;
                }

                console.log(`🔍 Buscando en IndexedDB: "${valor}"...`);
                const t0 = performance.now();

                try {
                    const resultadosDB = await CatalogoDB.buscarPorTexto(valor, 50);
                    const tiempo = Math.round(performance.now() - t0);

                    if (resultadosDB && resultadosDB.length > 0) {
                        console.log(`✅ IndexedDB: ${resultadosDB.length} resultados en ${tiempo}ms`);

                        const formateados = resultadosDB.map(p => ({
                            idProducto: p.idProducto,
                            nombre: p.nombre,
                            sku: p.sku || p.codigoInterno || '',
                            categoria: p.categoriaNombre || '',
                            vecesVendido: p.vecesVendido || 0,
                            _ref: p
                        }));

                        mostrarResultadosBusqueda(formateados);
                    } else {
                        console.log(`⚠️ IndexedDB: 0 resultados en ${tiempo}ms`);
                        mostrarSinResultados();
                    }
                } catch (e) {
                    console.warn('⚠️ Error buscando en IndexedDB:', e);
                }
            }, 200);
        }

        // ============================================================
        // CASO 5: SERVIDOR (fallback final)
        // ============================================================
        clearTimeout(_busquedaTimeout);
        _busquedaTimeout = setTimeout(() => buscarEnServidor(valor), 400);
    });
    // ============================================================
    // BOTÓN CLEAR — Restaura el top SIN llamar a la API
    // ============================================================
    if (btnClear && !btnClear._clearAttached) {
        btnClear._clearAttached = true;
        btnClear.addEventListener('click', () => {
            console.log('🧹 Limpiando búsqueda, restaurando desde memoria...');

            buscador.value = '';
            estado.terminoBusqueda = '';
            btnClear.style.display = 'none';
            guardarEstado();

            _catalogoEstado.busqueda = '';

            // 🆕 SOLO re-renderizar desde memoria (NO llamar a la API)
            rerenderizarCatalogoDesdeMemoria();

            buscador.focus();
        });
    }


    // ============================================================
    // 5. NAVEGACIÓN CON TECLADO (↑ ↓ Enter Escape)
    //    NOTA: El dropdown de sugerencias lo maneja BuscadorUI.js
    // ============================================================
   
    buscador.addEventListener('keydown', (e) => {
        const contenedor = document.getElementById('catalogoProductos');
        if (!contenedor) return;

        const productosVisibles = Array.from(contenedor.querySelectorAll('.producto'))
            .filter(c => c.style.display !== 'none');

        // --- ArrowDown ---
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (productosVisibles.length === 0) return;

            indiceNavegacion = Math.min(indiceNavegacion + 1, productosVisibles.length - 1);
            resaltarProducto(productosVisibles[indiceNavegacion]);
            return;
        }

        // --- ArrowUp ---
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (productosVisibles.length === 0) return;

            indiceNavegacion = Math.max(indiceNavegacion - 1, 0);
            resaltarProducto(productosVisibles[indiceNavegacion]);
            return;
        }

        // --- Enter ---
        if (e.key === 'Enter') {
            e.preventDefault();

            if (indiceNavegacion >= 0 && indiceNavegacion < productosVisibles.length) {
                const card = productosVisibles[indiceNavegacion];
                const btn = card.querySelector('.agregar');

                if (btn && !btn.disabled) {
                    btn.click();
                    indiceNavegacion = -1;
                    buscador.focus();
                    buscador.select();
                } else if (btn && btn.disabled) {
                    toast('Producto agotado', 'error');
                }
            }
            return;
        }        
        // ESCAPE — Restaura el top SIN llamar a la API
        // ============================================================
        if (e.key === 'Escape') {
            console.log('⌨️ Escape presionado, restaurando desde memoria...');

            buscador.value = '';
            estado.terminoBusqueda = '';
            if (btnClear) btnClear.style.display = 'none';
            guardarEstado();

            _catalogoEstado.busqueda = '';

            // 🆕 SOLO re-renderizar desde memoria (NO llamar a la API)
            rerenderizarCatalogoDesdeMemoria();

            indiceNavegacion = -1;
            return;
        }
    });

    // ============================================================
    // 6. HELPER: Resaltar producto navegado
    // ============================================================
    function resaltarProducto(card) {
        document.querySelectorAll('.producto.kbd-active')
            .forEach(c => c.classList.remove('kbd-active'));
        if (!card) return;
        card.classList.add('kbd-active');
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // ============================================================
    // 7. HINT VISUAL DEL BUSCADOR
    // ============================================================
    const hint = document.getElementById('buscadorHint');
    const buscadorEl = document.getElementById('buscador');

    if (hint && buscadorEl && !hint._attached) {
        hint._attached = true;

        function actualizarHint() {
            const estaVacio = buscadorEl.value.trim().length === 0;
            const tieneFoco = document.activeElement === buscadorEl;
            const nuncaUsado = !localStorage.getItem('pos_hint_visto');

            if (estaVacio && (tieneFoco || nuncaUsado)) {
                hint.classList.remove('oculto');
            } else {
                hint.classList.add('oculto');
            }
        }

        buscadorEl.addEventListener('focus', () => {
            localStorage.setItem('pos_hint_visto', '1');
            actualizarHint();
        });

        hint.classList.add('oculto');

        buscadorEl.addEventListener('focus', actualizarHint);

        buscadorEl.addEventListener('blur', () => {
            hint.classList.add('oculto');
        });

        buscadorEl.addEventListener('input', actualizarHint);

        if (buscadorEl.value.trim().length > 0) {
            hint.classList.add('oculto');
        }
    }
}

function setupToggleVista() {
    const btn = document.getElementById('btnToggle');
    const productosList = document.querySelector('#productos .productos');
    if (!btn || !productosList || btn._listenerAttached) return;
    btn._listenerAttached = true;

    productosList.classList.remove('grid', 'lista');
    productosList.classList.add(estado.vistaCatalogo === 'lista' ? 'lista' : 'grid');
    btn.textContent = estado.vistaCatalogo === 'lista' ? '🔲 Vista grid' : '📋 Vista lista';

    btn.addEventListener('click', () => {
        const esGrid = productosList.classList.contains('grid');
        const nueva = esGrid ? 'lista' : 'grid';
        productosList.classList.toggle('grid', !esGrid);
        productosList.classList.toggle('lista', esGrid);
        estado.vistaCatalogo = nueva;
        btn.textContent = nueva === 'lista' ? '🔲 Vista grid' : '📋 Vista lista';
        guardarEstado();
    });
}

function crearVentaUI(idVenta, numero) {
    const tabs = document.getElementById('tabs');
    const contenedorVentas = document.getElementById('contenedor-ventas');
    if (!tabs || !contenedorVentas) return;

    const tabExists = Boolean(document.querySelector(`.tab[data-id="${idVenta}"]`));
    const containerExists = Boolean(document.getElementById(idVenta));

    if (tabExists && containerExists) return;

    const nombre = estado.nombres?.[idVenta] || `Venta ${numero}`;

    if (!tabExists) {
        const nuevaTab = document.createElement('li');
        nuevaTab.className = 'tab';
        nuevaTab.dataset.id = idVenta;

        const cerrarBtn = idVenta === 'venta1' ? '' : '<span class="cerrar" title="Cerrar">✕</span>';

        nuevaTab.innerHTML = `
            <span class="label" contenteditable="false" tabindex="0" title="Doble clic para renombrar">${escapeHtml(nombre)}</span>
            <span class="badge" data-badge="${idVenta}">0</span>
            ${cerrarBtn}
        `;

        const nuevaVentaBtn = document.getElementById('nuevaVenta');
        if (nuevaVentaBtn) tabs.insertBefore(nuevaTab, nuevaVentaBtn);
        else tabs.appendChild(nuevaTab);
    }

    if (!containerExists) {
        const ventaDiv = document.createElement('div');
        ventaDiv.className = 'venta';
        ventaDiv.id = idVenta;
        ventaDiv.innerHTML = `
            <div class="carrito">
                <div class="contenido-carrito">
                    <h3>${escapeHtml(nombre)}</h3>
                    <table class="tabla-carrito">
                        <thead>
                            <tr>
                                <th>Producto</th>
                                <th>Precio</th>
                                <th>Cantidad</th>
                                <th>Subtotal</th>
                                <th>Acción</th>
                            </tr>
                        </thead>
                        <tbody class="carrito-body"></tbody>
                    </table>
                </div>
                <div class="resumen">
                    <p class="impuesto">Impuesto (19%): <strong>$0</strong></p>
                    <p class="total">Total: <strong>$0</strong></p>
                </div>
                <div style="display:flex; gap:8px; justify-content:flex-end;">
                    <button class="btn finalize">Finalizar Venta</button>
                </div>
            </div>
        `;
        contenedorVentas.appendChild(ventaDiv);
    }

    renderCarrito(idVenta);
    actualizarConteos();    
}

function crearVentaNueva() {
    if (estado._creatingVenta) return;
    estado._creatingVenta = true;
    setTimeout(() => estado._creatingVenta = false, 300);

    const existentes = Object.keys(estado.carritos)
        .filter(k => k.startsWith('venta'))
        .map(numeroDesdeId);

    let siguiente = existentes.length ? Math.max(...existentes) + 1 : 2;
    while (existentes.includes(siguiente)) siguiente++;

    const idVenta = `venta${siguiente}`;
    estado.carritos[idVenta] = [];
    crearVentaUI(idVenta, siguiente);
    activarPestaña(idVenta);
    guardarEstado();
}

function activarPestaña(id) {
    crearVentaUI(id, numeroDesdeId(id));

    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.venta').forEach(v => v.classList.remove('active'));

    document.querySelector(`.tab[data-id="${id}"]`)?.classList.add('active');
    document.getElementById(id)?.classList.add('active');

    estado.pestañaActiva = id;
    renderCarrito(id);
    guardarEstado();
    actualizarConteos();    
}

function cerrarPestaña(id) {
    document.querySelector(`.tab[data-id="${id}"]`)?.remove();
    document.getElementById(id)?.remove();
    delete estado.carritos[id];
    delete estado.nombres[id];

    if (estado.pestañaActiva === id) {
        const otraTab = document.querySelector('.tab[data-id]');
        activarPestaña(otraTab?.dataset.id || 'venta1');
    }
    guardarEstado();
    actualizarConteos();
    refrescarStockCatalogo();
}

function numeroDesdeId(idVenta) {
    const n = parseInt(String(idVenta).replace('venta', ''), 10);
    return isNaN(n) ? 1 : n;
}

/* ============================================================
   9. CARRITO
   ============================================================ */

function agregarProducto(idVenta, { idProducto, nombre, precio, sku, stock }) {
    // ---------------------------------------------------------
    // 1. Validaciones básicas
    // ---------------------------------------------------------
    if (!idVenta || !sku) {
        console.warn('⚠️ agregarProducto: idVenta o sku faltantes');
        return;
    }

    const carrito = estado.carritos[idVenta] || (estado.carritos[idVenta] = []);
    const skuNorm = String(sku).trim().toUpperCase();

    // ---------------------------------------------------------
    // 2. Determinar stock total en BD
    //    Prioridad: parámetro stock > caché de productos > 0
    // ---------------------------------------------------------
    let stockTotalBD = parseInt(stock, 10) || 0;

    if (stockTotalBD <= 0) {
        // Fallback: buscar en el caché de productos (estado.productos)
        const productoCache = (estado.productos || []).find(p => {
            const pSku = String(p.sku || p.codigoInterno || '').trim().toUpperCase();
            return pSku === skuNorm;
        });
        if (productoCache && productoCache.stockActual != null) {
            stockTotalBD = productoCache.stockActual;
        }
    }

    // ---------------------------------------------------------
    // 3. Buscar el item en el carrito actual (normalizando SKUs)
    // ---------------------------------------------------------
    const item = carrito.find(x =>
        String(x.sku || '').trim().toUpperCase() === skuNorm
    );
    const cantidadActual = item ? parseInt(item.cantidad, 10) || 0 : 0;

    // ---------------------------------------------------------
    // 4. Calcular cuánto está reservado en TODOS los carritos
    // ---------------------------------------------------------
    let reservadoTotal = 0;
    for (const vid in estado.carritos) {
        const c = estado.carritos[vid] || [];
        for (const i of c) {
            if (String(i.sku || '').trim().toUpperCase() === skuNorm) {
                reservadoTotal += parseInt(i.cantidad, 10) || 0;
            }
        }
    }

    // Reservado en OTROS carritos (excluyendo este)
    const reservadoOtros = reservadoTotal - cantidadActual;

    // Espacio disponible para este carrito
    const espacioDisponible = stockTotalBD - reservadoOtros;

    // ---------------------------------------------------------
    // 5. Validación: al menos 1 unidad debe caber
    // ---------------------------------------------------------
    if (espacioDisponible < 1) {
        const detalle = reservadoOtros > 0
            ? ` (${reservadoOtros} en otros carritos)`
            : '';
        toast(`"${nombre || 'Producto'}" sin stock disponible${detalle}`, 'error');
        return;
    }

    // ---------------------------------------------------------
    // 6. Agregar o sumar
    // ---------------------------------------------------------
    if (item) {
        // Ya existe en el carrito → sumar 1
        item.cantidad += 1;
    } else {
        // Crear nuevo item
        carrito.push({
            idProducto: parseInt(idProducto, 10) || 0,
            sku: skuNorm,              // guardamos normalizado
            nombre: nombre || 'Producto',
            precio: parseFloat(precio) || 0,
            cantidad: 1,
            stock: stockTotalBD
        });
    }

    // ---------------------------------------------------------
    // 7. Refrescar UI
    // ---------------------------------------------------------
    renderCarrito(idVenta);
    guardarEstado();
    actualizarConteos();

    if (typeof refrescarStockCatalogo === 'function') {
        refrescarStockCatalogo();
    }
}
/* ==================== STOCK DINÁMICO ==================== */

/**
 * Calcula cuántas unidades de un producto están reservadas en TODOS los carritos.
 * @param {string} sku - SKU del producto
 * @returns {number} Cantidad reservada
 */
/**
 * Calcula cuántas unidades de un producto están reservadas en TODOS los carritos.
 * Robusta contra: Proxies, SKUs numéricos/string, carritos corruptos.
 * @param {string|number} sku - SKU del producto
 * @returns {number} Cantidad reservada
 */
function stockReservadoEnCarritos(sku) {
    if (sku == null) return 0;

    // Normalizar el SKU a string para comparación consistente
    const skuBuscado = String(sku).trim();
    if (!skuBuscado) return 0;

    let total = 0;

    try {
        const carritos = estado.carritos || {};

        for (const ventaId in carritos) {
            const carrito = carritos[ventaId];
            if (!carrito) continue;

            // Convertir a array (funciona con Proxy, arrays nativos, y hasta iterables)
            let items = [];
            try {
                if (Array.isArray(carrito)) {
                    items = carrito;
                } else if (typeof carrito[Symbol.iterator] === 'function') {
                    items = Array.from(carrito);
                } else if (typeof carrito.length === 'number') {
                    items = Array.from(carrito);
                }
            } catch (e) {
                console.warn(`⚠️ stockReservadoEnCarritos: carrito ${ventaId} no accesible`, e);
                continue;
            }

            // Buscar el item por SKU (comparando como strings)
            for (const item of items) {
                if (!item || item.sku == null) continue;

                const itemSku = String(item.sku).trim();
                if (itemSku === skuBuscado) {
                    const cantidad = parseInt(item.cantidad, 10) || 0;
                    total += cantidad;
                }
            }
        }
    } catch (e) {
        console.error('❌ stockReservadoEnCarritos error:', e);
        return 0;
    }

    return total;
}
/**
 * Calcula el stock disponible real de un producto.
 * = stock en BD - stock en todos los carritos
 * @param {object} producto - { sku, stockActual }
 * @returns {number} Stock disponible (nunca negativo)
 */
function stockDisponible(producto) {
    const sku = producto.sku || producto.codigoInterno;
    if (!sku) return producto.stockActual || 0;
    const reservado = stockReservadoEnCarritos(sku);
    return Math.max(0, (producto.stockActual || 0) - reservado);
}

/**
 * Refresca el stock mostrado en TODAS las tarjetas del catálogo.
 * Se llama cada vez que cambia cualquier carrito.
 */
function refrescarStockCatalogo() {
    const contenedor = document.getElementById('catalogoProductos');
    if (!contenedor) return;

    contenedor.querySelectorAll('.producto').forEach(card => {
        const sku = card.dataset.sku;
        const stockBase = parseInt(card.dataset.stockBase || card.dataset.stock, 10) || 0;

        // Calcular stock disponible
        const reservado = stockReservadoEnCarritos(sku);
        const disponible = Math.max(0, stockBase - reservado);

        // Actualizar texto de stock
        const stockEl = card.querySelector('.prod-stock');
        if (stockEl) {
            if (disponible <= 0) {
                stockEl.textContent = '⛔ Sin stock';
                stockEl.style.color = '#dc2626';
                stockEl.style.background = 'rgba(220, 38, 38, 0.10)';
            } else {
                stockEl.textContent = `📦 ${disponible} disponibles`;
                const color = disponible <= 10 ? '#dc2626' : '#16a34a';
                stockEl.style.color = color;
                stockEl.style.background = disponible <= 10
                    ? 'rgba(220, 38, 38, 0.10)'
                    : 'rgba(22, 163, 74, 0.10)';
            }
        }

        // Actualizar botón
        const btn = card.querySelector('.agregar');
        if (btn) {
            if (disponible <= 0) {
                btn.disabled = true;
                btn.textContent = 'Sin stock';
            } else {
                btn.disabled = false;
                btn.textContent = '+ Agregar';
            }
        }
    });

    // 🆕 Notificar a BuscadorUI que el HTML cambió
    // (para que actualice su htmlOriginal y no restaure versiones viejas)
    if (typeof BuscadorUI !== 'undefined' && typeof BuscadorUI.refrescarHtml === 'function') {
        BuscadorUI.refrescarHtml();
    }
}

function actualizarCantidad(idVenta, sku, tipo) {
    const carrito = estado.carritos[idVenta] || [];
    const item = carrito.find(x => x.sku === sku);
    if (!item) return;

    if (tipo === 'mas') {
        // 🆕 Validar contra el stock REAL disponible (restando otros carritos)
        const stockTotalBD = item.stock != null ? item.stock : 0;

        // Calcular cuánto está reservado en OTROS carritos (excluyendo este)
        let reservadoOtros = 0;
        for (const vid in estado.carritos) {
            if (vid === idVenta) continue;   // saltar el carrito actual
            const c = estado.carritos[vid] || [];
            const i = c.find(x => x.sku === sku);
            if (i) reservadoOtros += i.cantidad;
        }

        const disponibleParaEste = stockTotalBD - reservadoOtros;

        // Si la nueva cantidad superaría el disponible → bloquear
        if (item.cantidad + 1 > disponibleParaEste) {
            toast(`Stock máximo alcanzado. Disponible: ${disponibleParaEste} (${reservadoOtros} en otros carritos)`, 'error');
            return;
        }

        item.cantidad += 1;
    }

    if (tipo === 'menos') {
        item.cantidad = Math.max(1, item.cantidad - 1);
    }

    renderCarrito(idVenta);
    guardarEstado();
    actualizarConteos();
    refrescarStockCatalogo();
}

function eliminarProducto(idVenta, sku) {
    const carrito = estado.carritos[idVenta] || [];
    const item = carrito.find(x => x.sku === sku);

    if (!item) return;

    let mensaje = `¿Eliminar "${item.nombre}" del carrito?`;

    if (item.cantidad > 1) {
        mensaje = `¿Eliminar "${item.nombre}" del carrito?\n\n` +
                  `Cantidad actual: ${item.cantidad}\n` +
                  `Se eliminarán las ${item.cantidad} unidades.`;
    }

    if (!confirm(mensaje)) return;

    estado.carritos[idVenta] = carrito.filter(x => x.sku !== sku);
    renderCarrito(idVenta);
    guardarEstado();
    actualizarConteos();
    refrescarStockCatalogo();

    toast(`🗑 "${item.nombre}" eliminado del carrito`, 'success');
}

function renderCarrito(idVenta) {
    const ventaDiv = document.getElementById(idVenta);
    if (!ventaDiv) return;

    const tbody = ventaDiv.querySelector('.carrito-body');
    const impuestoEl = ventaDiv.querySelector('.impuesto strong');
    const totalEl = ventaDiv.querySelector('.total strong');
    if (!tbody) return;

    tbody.innerHTML = '';
    const carrito = estado.carritos[idVenta] || [];
    let total = 0;

    carrito.forEach(item => {
        const subtotal = item.precio * item.cantidad;
        total += subtotal;

        const tr = document.createElement('tr');
        tr.dataset.sku = item.sku;
        tr.innerHTML = `
            <td>${escapeHtml(item.nombre)}</td>
            <td>${formato(item.precio)}</td>
            <td>
                <div class="cantidad-control">
                    <button class="qty-btn" data-tipo="menos">−</button>
                    <span class="qty">${item.cantidad}</span>
                    <button class="qty-btn" data-tipo="mas">+</button>
                </div>
            </td>
            <td class="subtotal">${formato(subtotal)}</td>
            <td><button class="action-del">Eliminar</button></td>
        `;
        tbody.appendChild(tr);
    });

    const impuesto = Math.round(total * IMPUESTO);
    const totalFinal = total + impuesto;

    if (impuestoEl) impuestoEl.textContent = formato(impuesto);
    if (totalEl) totalEl.textContent = formato(totalFinal);

    const tab = document.querySelector(`.tab[data-id="${idVenta}"]`);
    if (tab) tab.classList.toggle('filled', carrito.length > 0);

    actualizarConteos();
}

function actualizarConteos() {
    document.querySelectorAll('.tab .badge').forEach(b => b.textContent = '0');
    Object.keys(estado.carritos).forEach(id => {
        const items = (estado.carritos[id] || []).reduce((s, i) => s + i.cantidad, 0);
        const badge = document.querySelector(`[data-badge="${id}"]`);
        if (badge) badge.textContent = String(items);
    });

    const ventaId = estado.pestañaActiva || 'venta1';
    const carrito = estado.carritos[ventaId] || [];
    const totalItems = carrito.reduce((s, i) => s + i.cantidad, 0);
    const countEl = document.getElementById('cartCount');
    if (countEl) countEl.textContent = totalItems > 0 ? totalItems : '';
}

/* ============================================================
   10. ESCÁNER DE CÓDIGO DE BARRAS
   ============================================================ */

/* ============================================================
   ESCÁNER DE CÓDIGO DE BARRAS — Versión con IndexedDB
   Busca en este orden:
   1. Catálogo IndexedDB (índice rápido por SKU)
   2. TOP 2000 en memoria
   3. Servidor (último recurso)
   ============================================================ */
async function manejarEscaneo(codigo) {
    if (!codigo) return;

    const codigoLimpio = codigo.trim().toUpperCase();
    console.log(`📷 Buscando: "${codigoLimpio}"`);

    // Verificar sesión
    if (!localStorage.getItem('pos_token')) {
        console.warn('⚠️ Sin sesión activa');
        return;
    }

    // Verificar carrito activo
    const ventaId = estado.pestañaActiva || 'venta1';
    if (!estado.carritos[ventaId]) {
        toast('No hay un carrito activo', 'error');
        return;
    }

    let producto = null;
    let origenBusqueda = 'desconocido';

    // ============================================================
    // 1. BUSCAR EN CATÁLOGO INDEXEDDB (con índice, muy rápido)
    // ============================================================
    if (typeof Catalogo !== 'undefined' && typeof Catalogo.buscarPorSku === 'function') {
        try {
            producto = await Catalogo.buscarPorSku(codigoLimpio);
            if (producto) {
                origenBusqueda = 'IndexedDB';
                console.log('✅ Encontrado en IndexedDB');
            }
        } catch (e) {
            console.warn('⚠️ Error consultando IndexedDB:', e);
        }
    }

    // ============================================================
    // 2. FALLBACK: BUSCAR EN EL TOP 2000 (memoria)
    // ============================================================
    if (!producto) {
        producto = estado.productos.find(p => {
            const s = (p.sku || '').trim().toUpperCase();
            const c = (p.codigoInterno || '').trim().toUpperCase();
            return s === codigoLimpio || c === codigoLimpio;
        }) || null;

        if (producto) {
            origenBusqueda = 'TOP en memoria';
            console.log('✅ Encontrado en TOP 2000 (memoria)');
        }
    }

    // ============================================================
    // 3. FALLBACK: BUSCAR EN EL SERVIDOR (último recurso)
    // ============================================================
    if (!producto) {
        console.log('🔍 Consultando servidor...');
        try {
            const resp = await api.get(`/Productos/search?q=${encodeURIComponent(codigoLimpio)}`);
            if (resp.ok && Array.isArray(resp.data) && resp.data.length > 0) {
                // Buscar coincidencia exacta primero
                producto = resp.data.find(p =>
                    (p.sku && p.sku.toUpperCase() === codigoLimpio) ||
                    (p.codigoInterno && p.codigoInterno.toUpperCase() === codigoLimpio)
                );

                // Si no hay coincidencia exacta, tomar el primero
                if (!producto) producto = resp.data[0];

                if (producto) {
                    origenBusqueda = 'servidor';
                    console.log('✅ Encontrado en servidor');
                }
            }
        } catch (e) {
            console.warn('⚠️ Error consultando servidor:', e);
        }
    }

    // ============================================================
    // 4. PRODUCTO NO ENCONTRADO
    // ============================================================
    if (!producto) {
        console.warn(`❌ No se encontró: "${codigoLimpio}"`);
        toast(`❌ Producto no encontrado: ${codigoLimpio}`, 'error');
        reproducirBeep('error');
        return;
    }

    // ============================================================
    // 5. VALIDAR STOCK
    // ============================================================
    if (producto.stockActual <= 0) {
        toast(`⛔ "${producto.nombre}" está agotado`, 'error');
        reproducirBeep('error');
        return;
    }

    // ============================================================
    // 6. AGREGAR AL CARRITO
    // ============================================================
    agregarProducto(ventaId, {
        idProducto: producto.idProducto,
        nombre: producto.nombre,
        precio: producto.precioVenta,
        sku: producto.sku || producto.codigoInterno,
        stock: producto.stockActual
    });

    console.log(`🛒 Agregado desde ${origenBusqueda}: ${producto.nombre}`);
    toast(`✅ ${producto.nombre} agregado`, 'success');
    reproducirBeep('ok');
    destacarProductoEnCarrito(producto.sku || producto.codigoInterno);

    // ============================================================
    // 7. LIMPIAR EL BUSCADOR SI TIENE TEXTO
    // ============================================================
    const buscador = document.getElementById('buscador');
    if (buscador && buscador.value) {
        buscador.value = '';
        estado.terminoBusqueda = '';
        filtrarCatalogo('');
        guardarEstado();

        const btnClear = document.getElementById('btnClearSearch');
        if (btnClear) btnClear.style.display = 'none';
    }
}

function reproducirBeep(tipo = 'ok') {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.connect(gain);
        gain.connect(ctx.destination);

        if (tipo === 'ok') {
            osc.frequency.value = 1200;
            gain.gain.setValueAtTime(0.08, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
            osc.start();
            osc.stop(ctx.currentTime + 0.12);
        } else {
            osc.frequency.value = 300;
            gain.gain.setValueAtTime(0.10, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.20);
            osc.start();
            osc.stop(ctx.currentTime + 0.20);
        }
    } catch (e) {
        console.debug('No se pudo reproducir beep:', e);
    }
}

function destacarProductoEnCarrito(sku) {
    const ventaId = estado.pestañaActiva || 'venta1';
    const ventaDiv = document.getElementById(ventaId);
    if (!ventaDiv) return;

    const fila = ventaDiv.querySelector(`tr[data-sku="${sku}"]`);
    if (!fila) return;

    fila.classList.add('flash-agregado');
    setTimeout(() => fila.classList.remove('flash-agregado'), 900);
}

/* ============================================================
   11. FINALIZAR VENTA
   ============================================================ */

let _ventaIdEnProceso = null;

async function finalizarVenta(ventaId) {
    // 🆕 Declaración del carrito (esto faltaba)
    const carrito = estado.carritos[ventaId] || [];

    if (carrito.length === 0) {
        toast('El carrito está vacío', 'error');
        return;
    }

    // Verificar que todos los items tengan idProducto
    const sinId = carrito.filter(i => !i.idProducto);
    if (sinId.length > 0) {
        toast('Hay productos sin ID válido. Recarga el catálogo.', 'error');
        return;
    }

    _ventaIdEnProceso = ventaId;

    // 🆕 Cerrar el drawer si está abierto
    const drawer = document.getElementById('cartDrawer');
    const backdrop = document.getElementById('cartDrawerBackdrop');
    if (drawer && drawer.classList.contains('open')) {
        drawer.classList.remove('open');
        if (backdrop) backdrop.classList.remove('visible');
        document.body.style.overflow = '';
    }

    // Cargar clientes en el dropdown
    await cargarClientesEnModal();

    // Actualizar resumen
    actualizarResumenModal();

    // Mostrar modal
    const modal = document.getElementById('modalFinalizarVenta');
    showModal(modal);

    // Listener del descuento (para actualizar total en vivo)
    const inputDescuento = document.getElementById('finDescuento');
    if (inputDescuento) inputDescuento.oninput = actualizarResumenModal;
}

async function cargarClientesEnModal() {
    const select = document.getElementById('finCliente');
    if (!select) return;

    if (select.dataset.loaded === 'true') return;

    const resp = await api.get('/Clientes');
    if (!resp.ok) return;

    const clientes = resp.data || [];
    select.innerHTML = '<option value="">— Cliente anónimo —</option>' +
        clientes.map(c => `<option value="${c.idCliente}">${escapeHtml(c.nombre)}${c.documento ? ` (${escapeHtml(c.documento)})` : ''}</option>`).join('');

    select.dataset.loaded = 'true';
}

function actualizarResumenModal() {
    const ventaId = _ventaIdEnProceso;
    if (!ventaId) return;

    const carrito = estado.carritos[ventaId] || [];
    const items = carrito.reduce((s, i) => s + i.cantidad, 0);
    const subtotal = carrito.reduce((s, i) => s + i.precio * i.cantidad, 0);
    const impuesto = Math.round(subtotal * IMPUESTO);

    const descuentoInput = document.getElementById('finDescuento');
    let descuento = parseFloat(descuentoInput?.value) || 0;
    if (descuento > subtotal + impuesto) {
        descuento = subtotal + impuesto;
        if (descuentoInput) descuentoInput.value = descuento;
    }

    const total = subtotal + impuesto - descuento;

    document.getElementById('finResumenItems').textContent = items;
    document.getElementById('finResumenSubtotal').textContent = formato(subtotal);
    document.getElementById('finResumenImpuesto').textContent = formato(impuesto);
    document.getElementById('finResumenDescuento').textContent = `-${formato(descuento)}`;
    document.getElementById('finResumenTotal').textContent = formato(total);
}

async function confirmarVenta(e) {
    e.preventDefault();

    const ventaId = _ventaIdEnProceso;
    if (!ventaId) return;

    const carrito = estado.carritos[ventaId] || [];
    if (carrito.length === 0) {
        toast('El carrito está vacío', 'error');
        return;
    }

    const idClienteRaw = document.getElementById('finCliente').value;
    const metodoPago = document.getElementById('finMetodoPago').value;
    const descuento = parseFloat(document.getElementById('finDescuento').value) || 0;
    const nota = document.getElementById('finNota').value.trim();

    const ventaDto = {
        idCliente: idClienteRaw ? parseInt(idClienteRaw, 10) : null,
        metodoPago: metodoPago,
        descuentoTotal: descuento,
        nota: nota || null,
        detalles: carrito.map(i => ({
            idProducto: i.idProducto,
            cantidad: i.cantidad
        }))
    };

    const form = document.getElementById('formFinalizarVenta');
    const btnSubmit = form.querySelector('button[type="submit"]');
    const textoOriginal = btnSubmit.textContent;
    btnSubmit.disabled = true;
    btnSubmit.textContent = '⏳ Procesando...';

    const resp = await api.post('/Ventas', ventaDto);

    btnSubmit.disabled = false;
    btnSubmit.textContent = textoOriginal;

    if (!resp.ok) return;

    const venta = resp.data;
    console.log('Venta creada:', venta);

    hideModal(document.getElementById('modalFinalizarVenta'));

    toast(`✅ Venta ${venta.codigoFactura} registrada - Total: ${formato(venta.totalFinal)}`);

    estado.carritos[ventaId] = [];
    renderCarrito(ventaId);
    actualizarConteos();
    refrescarStockCatalogo();

    estado.historial.push({
        idVenta: venta.idVenta,
        codigoFactura: venta.codigoFactura,
        fecha: new Date(venta.fechaVenta).toLocaleString(),
        items: venta.detalles.reduce((s, d) => s + d.cantidad, 0),
        total: venta.totalFinal,
        cliente: venta.clienteNombre || 'Cliente anónimo'
    });
    guardarEstado();

    // 🆕 Invalidar caché y forzar UNA SOLA recarga del top
    estado._productosCacheInvalidado = true;
    estado._ultimaCargaTop = 0;
    _controlCargaTop.ultimaCargaExitosa = 0;

    // 🆕 UNA SOLA llamada (la promesa única deduplica si algo más la llama)
    await cargarProductosDesdeAPI(true);

    form.reset();
    _ventaIdEnProceso = null;
}

function setupFinalizarVentaModal() {
    const modal = document.getElementById('modalFinalizarVenta');
    const form = document.getElementById('formFinalizarVenta');
    const btnCancelar = document.getElementById('btnCancelarFinalizar');
    const cerrarBtn = document.getElementById('cerrarModalFinalizar');

    if (cerrarBtn) cerrarBtn.addEventListener('click', () => hideModal(modal));
    if (btnCancelar) btnCancelar.addEventListener('click', () => hideModal(modal));
    if (form && !form._listenerAttached) {
        form._listenerAttached = true;
        form.addEventListener('submit', confirmarVenta);
    }
}

/* ============================================================
   12. HISTORIAL DE VENTAS
   ============================================================ */

let _historialCache = [];

/* ============================================================
   12. HISTORIAL DE VENTAS — AGRUPADO (Año → Mes → Día)
   ============================================================ */

let _historialAgrupadoCache = null;
let _histAnioActual = null;

async function renderHistorial() {
    const contenedor = document.getElementById('historialAgrupado');
    const infoEl = document.getElementById('histTotalInfo');
    const selectAnio = document.getElementById('histAnio');
    if (!contenedor) return;

    contenedor.innerHTML = `<p style="text-align:center;padding:20px;color:#64748b;">Cargando...</p>`;

    // ---- Parámetros ----
    const estado = document.getElementById('histEstado')?.value || '';
    const buscar = document.getElementById('histBuscar')?.value.trim() || '';
    const desde = document.getElementById('histDesde')?.value || '';
    const hasta = document.getElementById('histHasta')?.value || '';
    const anioSeleccionado = selectAnio?.value || '';

    // ---- Construir query ----
    const params = new URLSearchParams();
    if (anioSeleccionado) params.append('anio', anioSeleccionado);
    if (estado) params.append('estado', estado);
    if (buscar) params.append('buscar', buscar);

    // ---- Llamar al endpoint agrupado ----
    const resp = await api.get(`/Ventas/agrupado?${params.toString()}`);
    if (!resp.ok) {
        contenedor.innerHTML = `<div class="hist-vacio"><span class="icono">⚠️</span>Error al cargar el historial</div>`;
        return;
    }

    const data = resp.data;
    _historialAgrupadoCache = data;

    // ---- Poblar selector de años (solo primera vez) ----
    if (selectAnio && !selectAnio._cargado) {
        const anios = data.aniosDisponibles || [];
        selectAnio.innerHTML = '<option value="">Últimos 12 meses</option>' +
            anios.map(a => `<option value="${a}">${a}</option>`).join('');
        selectAnio._cargado = true;
    }

    // ---- Aplicar filtro de fechas en cliente (opcional) ----
    let agrupado = data.agrupado || [];
    if (desde || hasta) {
        const fDesde = desde ? new Date(desde) : null;
        const fHasta = hasta ? new Date(hasta + 'T23:59:59') : null;

        agrupado = agrupado.map(g => ({
            ...g,
            meses: g.meses.map(m => ({
                ...m,
                dias: m.dias.map(d => ({
                    ...d,
                    ventas: d.ventas.filter(v => {
                        const f = new Date(v.fechaVenta);
                        if (fDesde && f < fDesde) return false;
                        if (fHasta && f > fHasta) return false;
                        return true;
                    })
                })).filter(d => d.ventas.length > 0)
            })).filter(m => m.dias.length > 0)
        })).filter(g => g.meses.length > 0);
    }

    // ---- Info global ----
    const totalVentas = agrupado.reduce((s, g) => s + g.totalVentas, 0);
    const totalMonto = agrupado.reduce((s, g) => s + g.totalMonto, 0);
    if (infoEl) {
        infoEl.textContent = `${totalVentas} ventas · ${formato(totalMonto)}`;
    }

    // ---- Sin resultados ----
    if (agrupado.length === 0) {
        contenedor.innerHTML = `
            <div class="hist-vacio">
                <span class="icono">🔍</span>
                <div style="font-weight:600;margin-bottom:4px;">No hay ventas que coincidan</div>
                <div style="font-size:12px;">Prueba con otros filtros</div>
            </div>`;
        return;
    }

    // ---- Render acordeones ----
    contenedor.innerHTML = agrupado.map(g => renderGrupoAnio(g)).join('');

    // ---- Listeners de expand/collapse ----
    contenedor.querySelectorAll('.hist-grupo-header, .hist-subgrupo-header').forEach(h => {
        h.addEventListener('click', (e) => {
            // No colapsar si el click fue en un botón de acción
            if (e.target.closest('button')) return;
            const padre = h.parentElement;
            padre.classList.toggle('abierto');
        });
    });

    // ---- Listener de "Ver detalle" ----
    contenedor.querySelectorAll('button[data-accion="ver"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            verDetalleVenta(parseInt(btn.dataset.id, 10));
        });
    });
}

function renderGrupoAnio(g) {
    const abierto = _histAnioActual === g.anio;
    return `
        <div class="hist-grupo ${abierto ? 'abierto' : ''}" data-anio="${g.anio}">
            <div class="hist-grupo-header">
                <div class="hist-grupo-titulo">
                    <span class="flecha">▶</span>
                    📅 ${g.anio}
                </div>
                <div class="hist-grupo-meta">
                    <span class="badge-cantidad">${g.totalVentas} ventas</span>
                    <span class="badge-total">${formato(g.totalMonto)}</span>
                </div>
            </div>
            <div class="hist-grupo-contenido">
                ${g.meses.map(m => renderGrupoMes(g.anio, m)).join('')}
            </div>
        </div>
    `;
}

function renderGrupoMes(anio, m) {
    return `
        <div class="hist-subgrupo">
            <div class="hist-subgrupo-header">
                <div class="hist-subgrupo-titulo">
                    <span class="flecha">▶</span>
                    📆 ${m.mesNombre}
                </div>
                <div class="hist-grupo-meta">
                    <span class="badge-cantidad">${m.totalVentas}</span>
                    <span class="badge-total">${formato(m.totalMonto)}</span>
                </div>
            </div>
            <div class="hist-subgrupo-contenido">
                ${m.dias.map(d => renderGrupoDia(anio, m.mes, d)).join('')}
            </div>
        </div>
    `;
}

function renderGrupoDia(anio, mes, d) {
    const fechaTxt = `${String(d.dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${anio}`;
    return `
        <div class="hist-subgrupo">
            <div class="hist-subgrupo-header">
                <div class="hist-subgrupo-titulo">
                    <span class="flecha">▶</span>
                    🗓️ ${fechaTxt}
                </div>
                <div class="hist-grupo-meta">
                    <span class="badge-cantidad">${d.totalVentas}</span>
                    <span class="badge-total">${formato(d.totalMonto)}</span>
                </div>
            </div>
            <div class="hist-subgrupo-contenido">
                ${d.ventas.map(v => renderVentaIndividual(v)).join('')}
            </div>
        </div>
    `;
}
function renderVentaIndividual(v) {
    const esAnulada = v.estado === 'Anulada';
    
    // Solución: Si la fecha no termina en Z, se la agregamos para indicarle a JS que es UTC
    const fechaString = v.fechaVenta.endsWith('Z') ? v.fechaVenta : `${v.fechaVenta}Z`;
    
    const hora = new Date(fechaString).toLocaleTimeString('es-CO', {
        timeZone: 'America/Bogota',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });

    return `
        <div class="hist-venta">
            <span class="v-factura" title="${escapeHtml(v.codigoFactura || '-')}">
                ${escapeHtml(v.codigoFactura || '-')}
            </span>
            <span class="v-cliente">
                ${escapeHtml(v.clienteNombre || 'Anónimo')}
                <span class="v-hora">· ${hora}</span>
            </span>
            <span class="v-items">${v.cantidadItems} ítems</span>
            <span class="v-total">${formato(v.totalFinal)}</span>
            <span class="v-estado ${esAnulada ? 'anulada' : 'completada'}">
                ${escapeHtml(v.estado)}
            </span>
            <div class="v-acciones">
                <button class="btn small" data-accion="ver" data-id="${v.idVenta}" title="Ver detalle">👁</button>
            </div>
        </div>
    `;
}


async function verDetalleVenta(idVenta) {
    const modal = document.getElementById('modalDetalleVenta');
    const cont = document.getElementById('detalleVentaContenido');
    if (!modal || !cont) return;

    cont.innerHTML = `<p style="text-align:center;color:#64748b;padding:20px;">Cargando...</p>`;
    showModal(modal);

    const resp = await api.get(`/Ventas/${idVenta}`);
    if (!resp.ok) {
        cont.innerHTML = `<p style="text-align:center;color:#dc2626;padding:20px;">Error al cargar el detalle</p>`;
        return;
    }

    const v = resp.data;
    const fecha = formatearFechaColombia(v.fechaVenta);
    const esAnulada = v.estado === 'Anulada';

    const btnAnular = document.getElementById('btnAnularVenta');
    if (btnAnular) {
        btnAnular.style.display = esAnulada ? 'none' : 'inline-block';
        btnAnular.dataset.id = v.idVenta;
    }

    cont.innerHTML = `
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:16px;">
            <div><strong>Factura:</strong> ${escapeHtml(v.codigoFactura || '-')}</div>
            <div><strong>Fecha:</strong> ${fecha}</div>
            <div><strong>Cliente:</strong> ${escapeHtml(v.clienteNombre || 'Anónimo')}</div>
            <div><strong>Usuario:</strong> ${escapeHtml(v.usuarioNombre || '-')}</div>
            <div><strong>Método:</strong> ${escapeHtml(v.metodoPago)}</div>
            <div><strong>Estado:</strong> 
                <span style="color:${esAnulada ? '#dc2626' : '#16a34a'}; font-weight:700;">
                    ${escapeHtml(v.estado)}
                </span>
            </div>
        </div>

        <table class="tabla-carrito" style="margin-bottom:16px;">
            <thead>
                <tr>
                    <th>Producto</th>
                    <th>SKU</th>
                    <th style="text-align:center;">Cant.</th>
                    <th style="text-align:right;">Precio</th>
                    <th style="text-align:right;">Subtotal</th>
                </tr>
            </thead>
            <tbody>
                ${(v.detalles || []).map(d => `
                    <tr>
                        <td>${escapeHtml(d.productoNombre || '-')}</td>
                        <td>${escapeHtml(d.productoCodigo || '-')}</td>
                        <td style="text-align:center;">${d.cantidad}</td>
                        <td style="text-align:right;">${formato(d.precioUnitarioHistorico)}</td>
                        <td style="text-align:right;">${formato(d.subtotalLinea)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>

        <div style="background:rgba(37,99,235,0.08); padding:12px; border-radius:8px;">
            <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                <span>Subtotal:</span><strong>${formato(v.subtotal)}</strong>
            </div>
            <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                <span>Impuestos:</span><strong>${formato(v.impuestosTotal)}</strong>
            </div>
            ${v.descuentoTotal > 0 ? `
                <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                    <span>Descuento:</span><strong style="color:#dc2626;">-${formato(v.descuentoTotal)}</strong>
                </div>
            ` : ''}
            <div style="display:flex; justify-content:space-between; border-top:1px solid #cbd5e1; padding-top:6px; margin-top:6px;">
                <span style="font-size:16px;">TOTAL:</span>
                <strong style="font-size:18px; color:#dc2626;">${formato(v.totalFinal)}</strong>
            </div>
        </div>

        ${v.nota ? `<p style="margin-top:12px; font-style:italic; color:#64748b;">📝 ${escapeHtml(v.nota)}</p>` : ''}
    `;
}

async function anularVenta(idVenta) {
    if (!confirm('¿Estás seguro de que deseas anular esta venta? El stock se devolverá.')) return;
    const motivo = prompt('Motivo de anulación (opcional):') || '';

    const btnAnular = document.getElementById('btnAnularVenta');
    btnAnular.disabled = true;
    btnAnular.textContent = '⏳ Anulando...';

    const resp = await api.put(`/Ventas/${idVenta}/anular`, { motivo });
    btnAnular.disabled = false;
    btnAnular.textContent = '🚫 Anular Venta';

    if (!resp.ok) return;

    toast('✅ Venta anulada correctamente');
    hideModal(document.getElementById('modalDetalleVenta'));
    await renderHistorial();          // 👈 ahora renderiza acordeones
    await cargarProductosDesdeAPI();
}

function setupHistorialListeners() {
    const btnFiltrar = document.getElementById('btnHistFiltrar');
    const btnLimpiar = document.getElementById('btnHistLimpiar');
    const btnExpandir = document.getElementById('btnHistExpandir');
    const btnContraer = document.getElementById('btnHistContraer');
    const selectAnio = document.getElementById('histAnio');

    if (btnFiltrar && !btnFiltrar._attached) {
        btnFiltrar._attached = true;
        btnFiltrar.addEventListener('click', () => {
            _histAnioActual = null;
            renderHistorial();
        });
    }

    if (btnLimpiar && !btnLimpiar._attached) {
        btnLimpiar._attached = true;
        btnLimpiar.addEventListener('click', () => {
            ['histDesde', 'histHasta', 'histBuscar'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
            const est = document.getElementById('histEstado');
            if (est) est.value = '';
            const anio = document.getElementById('histAnio');
            if (anio) anio.value = '';
            _histAnioActual = null;
            renderHistorial();
        });
    }

    if (btnExpandir && !btnExpandir._attached) {
        btnExpandir._attached = true;
        btnExpandir.addEventListener('click', () => {
            document.querySelectorAll('#historialAgrupado .hist-grupo, #historialAgrupado .hist-subgrupo')
                .forEach(el => el.classList.add('abierto'));
        });
    }

    if (btnContraer && !btnContraer._attached) {
        btnContraer._attached = true;
        btnContraer.addEventListener('click', () => {
            document.querySelectorAll('#historialAgrupado .hist-grupo, #historialAgrupado .hist-subgrupo')
                .forEach(el => el.classList.remove('abierto'));
        });
    }

    if (selectAnio && !selectAnio._attached) {
        selectAnio._attached = true;
        selectAnio.addEventListener('change', (e) => {
            _histAnioActual = parseInt(e.target.value, 10) || null;
            renderHistorial();
        });
    }

    // Buscador con debounce
    const inputBuscar = document.getElementById('histBuscar');
    if (inputBuscar && !inputBuscar._attached) {
        inputBuscar._attached = true;
        let t = null;
        inputBuscar.addEventListener('input', () => {
            clearTimeout(t);
            t = setTimeout(() => renderHistorial(), 400);
        });
    }

    // Botones de modal detalle
    const btnCerrar = document.getElementById('cerrarModalDetalleVenta');
    const btnCerrar2 = document.getElementById('btnCerrarDetalleVenta');
    const btnAnular = document.getElementById('btnAnularVenta');

    [btnCerrar, btnCerrar2].forEach(b => {
        if (b && !b._attached) {
            b._attached = true;
            b.addEventListener('click', () => hideModal(document.getElementById('modalDetalleVenta')));
        }
    });

    if (btnAnular && !btnAnular._attached) {
        btnAnular._attached = true;
        btnAnular.addEventListener('click', () => {
            const id = parseInt(btnAnular.dataset.id, 10);
            if (id) anularVenta(id);
        });
    }
}

/* ============================================================
   13. CLIENTES (CRUD)
   ============================================================ */

let _clientesCache = [];
let _editandoClienteId = null;

async function initClientes() {
    if (!localStorage.getItem('pos_token')) return;

    const tbody = document.querySelector('#tablaClientes tbody');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#64748b;padding:20px;">Cargando clientes...</td></tr>`;

    const resp = await api.get('/Clientes?page=1&pageSize=200');
    if (!resp.ok) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#dc2626;">Error al cargar clientes</td></tr>`;
        return;
    }

    _clientesCache = resp.data || [];
    renderTablaClientes();
    setupClientesListeners();
}

function renderTablaClientes() {
    const tbody = document.querySelector('#tablaClientes tbody');
    if (!tbody) return;

    if (_clientesCache.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#64748b;padding:20px;">No hay clientes registrados</td></tr>`;
        return;
    }

    tbody.innerHTML = _clientesCache.map(c => `
        <tr data-id="${c.idCliente}">
            <td>${escapeHtml(c.nombre)}</td>
            <td>${escapeHtml(c.correo || '-')}</td>
            <td>${escapeHtml(c.telefono || '-')}</td>
            <td>${escapeHtml(c.ciudad || '-')}</td>
            <td>${escapeHtml(c.tipoCliente || 'Nuevo')}</td>
            <td>
                <button class="btn-accion editar" data-accion="editar" data-id="${c.idCliente}">
                    ✏️ <span class="texto">Editar</span>
                </button>
                <button class="btn-accion eliminar" data-accion="eliminar" data-id="${c.idCliente}">
                    🗑 <span class="texto">Eliminar</span>
                </button>
            </td>
        </tr>
    `).join('');

    const resumen = document.getElementById('resumenClientes');
    if (resumen) {
        const total = _clientesCache.length;
        const frecuentes = _clientesCache.filter(c => c.tipoCliente === 'Frecuente').length;
        const nuevos = _clientesCache.filter(c => c.tipoCliente === 'Nuevo').length;
        const corporativos = _clientesCache.filter(c => c.tipoCliente === 'Corporativo').length;

        resumen.innerHTML = `
            <div class="card-resumen azul"><h4>Total Clientes</h4><p>${total}</p></div>
            <div class="card-resumen celeste"><h4>Frecuentes</h4><p>${frecuentes}</p></div>
            <div class="card-resumen verde"><h4>Nuevos</h4><p>${nuevos}</p></div>
            <div class="card-resumen gris"><h4>Corporativos</h4><p>${corporativos}</p></div>
        `;
    }
}

function setupClientesListeners() {
    const tbody = document.querySelector('#tablaClientes tbody');
    const btnNuevo = document.getElementById('btnNuevoCliente');
    const btnCancelar = document.getElementById('btnCancelarCliente');
    const cerrar = document.getElementById('cerrarModalCliente');
    const form = document.getElementById('formCliente');
    const modal = document.getElementById('modalCliente');

    if (tbody && !tbody._listenerAttached) {
        tbody._listenerAttached = true;
        tbody.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-accion]');
            if (!btn) return;

            const id = parseInt(btn.dataset.id, 10);
            if (btn.dataset.accion === 'editar') abrirModalCliente(id);
            if (btn.dataset.accion === 'eliminar') eliminarCliente(id);
        });
    }

    if (btnNuevo && !btnNuevo._listenerAttached) {
        btnNuevo._listenerAttached = true;
        btnNuevo.addEventListener('click', () => abrirModalCliente(null));
    }

    if (cerrar && !cerrar._listenerAttached) {
        cerrar._listenerAttached = true;
        cerrar.addEventListener('click', () => hideModal(modal));
    }
    if (btnCancelar && !btnCancelar._listenerAttached) {
        btnCancelar._listenerAttached = true;
        btnCancelar.addEventListener('click', () => hideModal(modal));
    }

    if (form && !form._listenerAttached) {
        form._listenerAttached = true;
        form.addEventListener('submit', guardarCliente);
    }
}

function abrirModalCliente(idCliente) {
    const modal = document.getElementById('modalCliente');
    const titulo = document.getElementById('tituloModalCliente');
    const form = document.getElementById('formCliente');

    form.reset();
    _editandoClienteId = idCliente;

    if (idCliente == null) {
        titulo.textContent = 'Nuevo Cliente';
        document.getElementById('cliTipo').value = 'Nuevo';
    } else {
        titulo.textContent = 'Editar Cliente';
        const c = _clientesCache.find(x => x.idCliente === idCliente);
        if (c) {
            document.getElementById('cliDocumento').value = c.documento || '';
            document.getElementById('cliNombre').value = c.nombre || '';
            document.getElementById('cliCorreo').value = c.correo || '';
            document.getElementById('cliTelefono').value = c.telefono || '';
            document.getElementById('cliCiudad').value = c.ciudad || '';
            document.getElementById('cliDireccion').value = c.direccion || '';
            document.getElementById('cliTipo').value = c.tipoCliente || 'Nuevo';
        }
    }

    showModal(modal);
}

async function guardarCliente(e) {
    e.preventDefault();

    const esEdicion = _editandoClienteId != null;

    const dto = {
        documento: document.getElementById('cliDocumento').value.trim() || null,
        nombre: document.getElementById('cliNombre').value.trim(),
        correo: document.getElementById('cliCorreo').value.trim() || null,
        telefono: document.getElementById('cliTelefono').value.trim() || null,
        ciudad: document.getElementById('cliCiudad').value.trim() || null,
        direccion: document.getElementById('cliDireccion').value.trim() || null,
        tipoCliente: document.getElementById('cliTipo').value
    };

    if (!dto.nombre) {
        toast('El nombre es obligatorio', 'error');
        return;
    }

    const btnGuardar = document.getElementById('btnGuardarCliente');
    const textoOriginal = btnGuardar.textContent;
    btnGuardar.disabled = true;
    btnGuardar.textContent = '⏳ Guardando...';

    let resp;
    if (esEdicion) {
        resp = await api.put(`/Clientes/${_editandoClienteId}`, dto);
    } else {
        resp = await api.post('/Clientes', dto);
    }

    btnGuardar.disabled = false;
    btnGuardar.textContent = textoOriginal;

    if (!resp.ok) return;

    toast(esEdicion ? '✅ Cliente actualizado' : '✅ Cliente creado');
    hideModal(document.getElementById('modalCliente'));
    await initClientes();
}

async function eliminarCliente(idCliente) {
    const c = _clientesCache.find(x => x.idCliente === idCliente);
    if (!c) return;

    const msg = `¿Eliminar el cliente "${c.nombre}"?\n\n` +
                `Documento: ${c.documento || 'N/A'}\n` +
                `Esta acción no se puede deshacer.`;

    if (!confirm(msg)) return;

    const resp = await api.delete(`/Clientes/${idCliente}`);
    if (!resp.ok) return;

    toast('✅ Cliente eliminado');
    await initClientes();
}

/* ============================================================
   14. CATEGORÍAS (CRUD)
   ============================================================ */

let _categoriasCache = [];
let _editandoCategoriaId = null;

async function initCategorias() {
    if (!localStorage.getItem('pos_token')) return;
    const tbody = document.querySelector('#tablaCategorias tbody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:20px;color:#64748b;">Cargando...</td></tr>`;

    // ✅ Ya NO traemos todos los productos. Usamos el endpoint resumen.
    const resp = await api.get('/Productos/categorias-resumen');
    if (!resp.ok) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#dc2626;">Error al cargar categorías</td></tr>`;
        return;
    }

    _categoriasCache = resp.data || [];
    renderTablaCategorias();
    setupCategoriasListeners();
}

function renderTablaCategorias() {
    const tbody = document.querySelector('#tablaCategorias tbody');
    if (!tbody) return;

    if (_categoriasCache.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#64748b;padding:20px;">No hay categorías</td></tr>`;
        return;
    }

    tbody.innerHTML = _categoriasCache.map(c => {
        const cantidadProductos = c.cantidadProductos || 0;   // 👈 viene del server
        return `
            <tr data-id="${c.idCategoria}">
                <td>${c.idCategoria}</td>
                <td><strong>${escapeHtml(c.nombre)}</strong></td>
                <td>${escapeHtml(c.descripcion || '-')}</td>
                <td style="text-align:center;">
                    <span class="badge-count ${cantidadProductos === 0 ? 'zero' : ''}">
                        ${cantidadProductos} ${cantidadProductos === 1 ? 'producto' : 'productos'}
                    </span>
                </td>
                <td>
                    <div class="acciones">
                        <button class="btn-accion editar" data-accion="editar" data-id="${c.idCategoria}">
                            ✏️ <span class="texto">Editar</span>
                        </button>
                        <button class="btn-accion eliminar" data-accion="eliminar" data-id="${c.idCategoria}">
                            🗑 <span class="texto">Eliminar</span>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
     // 🆕 Refrescar el buscador
    const inputCat = document.getElementById('buscarCategoria');
    if (inputCat && inputCat._buscadorAPI) {
        inputCat._buscadorAPI.refresh();
    }
}


function setupCategoriasListeners() {
    const tbody = document.querySelector('#tablaCategorias tbody');
    const btnNueva = document.getElementById('btnNuevaCategoria');
    const cerrar = document.getElementById('cerrarModalCategoria');
    const btnCancelar = document.getElementById('btnCancelarCategoria');
    const form = document.getElementById('formCategoria');
    const modal = document.getElementById('modalCategoria');

    if (tbody && !tbody._listenerAttached) {
        tbody._listenerAttached = true;
        tbody.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-accion]');
            if (!btn) return;
            const id = parseInt(btn.dataset.id, 10);
            if (btn.dataset.accion === 'editar') abrirModalCategoria(id);
            if (btn.dataset.accion === 'eliminar') eliminarCategoria(id);
        });
    }

    if (btnNueva && !btnNueva._listenerAttached) {
        btnNueva._listenerAttached = true;
        btnNueva.addEventListener('click', () => abrirModalCategoria(null));
    }

    if (cerrar && !cerrar._listenerAttached) {
        cerrar._listenerAttached = true;
        cerrar.addEventListener('click', () => hideModal(modal));
    }
    if (btnCancelar && !btnCancelar._listenerAttached) {
        btnCancelar._listenerAttached = true;
        btnCancelar.addEventListener('click', () => hideModal(modal));
    }

    if (form && !form._listenerAttached) {
        form._listenerAttached = true;
        form.addEventListener('submit', guardarCategoria);
    }
}

function abrirModalCategoria(idCategoria) {
    const modal = document.getElementById('modalCategoria');
    const titulo = document.getElementById('tituloModalCategoria');
    const form = document.getElementById('formCategoria');

    form.reset();
    _editandoCategoriaId = idCategoria;

    if (idCategoria == null) {
        titulo.textContent = 'Nueva Categoría';
    } else {
        titulo.textContent = 'Editar Categoría';
        const c = _categoriasCache.find(x => x.idCategoria === idCategoria);
        if (c) {
            document.getElementById('catNombre').value = c.nombre || '';
            document.getElementById('catDescripcion').value = c.descripcion || '';
        }
    }

    showModal(modal);
}

async function guardarCategoria(e) {
    e.preventDefault();

    const esEdicion = _editandoCategoriaId != null;
    const nombre = document.getElementById('catNombre').value.trim();
    const descripcion = document.getElementById('catDescripcion').value.trim();

    if (!nombre) {
        toast('El nombre es obligatorio', 'error');
        return;
    }

    const dto = {
        nombre: nombre,
        descripcion: descripcion || null
    };

    const btnGuardar = document.getElementById('btnGuardarCategoria');
    const textoOriginal = btnGuardar.textContent;
    btnGuardar.disabled = true;
    btnGuardar.textContent = '⏳ Guardando...';

    let resp;
    if (esEdicion) {
        resp = await api.put(`/Categorias/${_editandoCategoriaId}`, dto);
    } else {
        resp = await api.post('/Categorias', dto);
    }

    btnGuardar.disabled = false;
    btnGuardar.textContent = textoOriginal;

    if (!resp.ok) return;

    toast(esEdicion ? '✅ Categoría actualizada' : '✅ Categoría creada');
    hideModal(document.getElementById('modalCategoria'));

    await initCategorias();

    const selectProdCat = document.getElementById('prodCategoria');
    if (selectProdCat) {
        selectProdCat.dataset.loaded = 'false';
    }
}

async function eliminarCategoria(idCategoria) {
    const c = _categoriasCache.find(x => x.idCategoria === idCategoria);
    if (!c) return;

    if (!confirm(`¿Eliminar la categoría "${c.nombre}"?`)) return;

    const resp = await api.delete(`/Categorias/${idCategoria}`);

    if (!resp.ok) {
        if (resp.status === 409) {
            toast(resp.data?.message || 'No se puede eliminar: tiene productos asociados.', 'error');
        }
        return;
    }

    toast('✅ Categoría eliminada');
    await initCategorias();
    await cargarProductosDesdeAPI();

    const selectProdCat = document.getElementById('prodCategoria');
    if (selectProdCat) {
        selectProdCat.dataset.loaded = 'false';
    }
}

/* ============================================================
   15. INVENTARIO (CRUD)
   ============================================================ */

let _productosCache = [];
let _editandoProductoId = null;

/* ============================================================
   ESTADO DEL INVENTARIO (Scroll infinito)
   ============================================================ */
const INVENTARIO_PAGE_SIZE = 500;

let _inventarioEstado = {
    pagina: 1,
    total: 0,
    hayMas: true,
    cargando: false,
    busqueda: '',
    observer: null,
    _scrollIniciado: false
};

async function initInventario() {
    if (!localStorage.getItem('pos_token')) return;

    const tbody = document.getElementById('tablaProductosBody');
    if (!tbody) return;

    // 🆕 Reset del estado de paginación
    _inventarioEstado = {
        pagina: 1,
        total: 0,
        hayMas: true,
        cargando: false,
        busqueda: '',
        observer: null,
        _scrollIniciado: false
    };

    _productosCache = [];

    // Dejar el body con un mensaje de carga
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#64748b;padding:20px;">Cargando productos...</td></tr>`;

    // Setup de listeners (solo la primera vez)
    setupInventarioListeners();

    // 🆕 Cargar primera página
    await cargarPaginaInventario(true);

    // 🆕 Configurar scroll infinito
    configurarScrollInventario();

    // 🆕 Refrescar buscador
    setTimeout(() => {
        if (typeof BuscadorUI !== 'undefined') BuscadorUI.init();
        const input = document.getElementById('buscarProducto');
        if (input && input._buscadorAPI) input._buscadorAPI.refresh();
    }, 150);
}

/**
 * Carga una página de productos para inventario.
 * @param {boolean} reset - Si true, reemplaza todo (carga inicial). Si false, concatena (scroll).
 */
async function cargarPaginaInventario(reset = false) {
    const tbody = document.getElementById('tablaProductosBody');
    const loader = document.getElementById('inventarioLoader');
    const info = document.getElementById('inventarioInfo');
    if (!tbody) return;

    if (_inventarioEstado.cargando) return;
    if (!reset && !_inventarioEstado.hayMas) return;

    _inventarioEstado.cargando = true;
    if (loader && !reset) loader.style.display = 'block';

    // Filtro de búsqueda server-side
    const params = new URLSearchParams({
        page: _inventarioEstado.pagina,
        pageSize: INVENTARIO_PAGE_SIZE
    });
    if (_inventarioEstado.busqueda) {
        params.append('buscar', _inventarioEstado.busqueda);
    }

    try {
        // El endpoint /Productos soporta page y pageSize.
        // Si quieres búsqueda server-side, hay que agregarla al backend o usar
        // /Productos/search. Por ahora cargamos todo y filtramos en cliente.
        const resp = await api.get(`/Productos?page=${_inventarioEstado.pagina}&pageSize=${INVENTARIO_PAGE_SIZE}`);

        if (!resp.ok) {
            if (reset) {
                tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#dc2626;">Error al cargar productos</td></tr>`;
            }
            return;
        }

        const productos = resp.data || [];

        // 🆕 Leer total desde headers (X-Total-Count del backend)
        let total = productos.length;
        try {
            const headerTotal = resp.headers?.get?.('x-total-count');
            if (headerTotal) total = parseInt(headerTotal, 10) || productos.length;
        } catch (e) {
            console.warn('No se pudo leer X-Total-Count:', e);
        }

        // Acumular
        _productosCache = reset ? productos : [..._productosCache, ...productos];
        _inventarioEstado.total = total;
        _inventarioEstado.pagina++;
                if (total > 0) {
            _inventarioEstado.hayMas = _productosCache.length < total;
        } else {
            _inventarioEstado.hayMas = productos.length === INVENTARIO_PAGE_SIZE;
        }

        // Render
        if (reset) {
            tbody.innerHTML = productos.length === 0
                ? `<tr><td colspan="6" style="text-align:center;color:#64748b;padding:20px;">No hay productos</td></tr>`
                : productos.map(p => renderFilaInventario(p)).join('');
        } else {
            tbody.insertAdjacentHTML('beforeend', productos.map(p => renderFilaInventario(p)).join(''));
        }

        // Actualizar resumen
        renderResumenInventario();

        // Actualizar info
        if (info) {
            info.textContent = `${_productosCache.length} de ${total} productos`;
        }

        console.log(`✅ Inventario: ${productos.length} productos (página ${_inventarioEstado.pagina - 1}, total ${total})`);
    } finally {
        _inventarioEstado.cargando = false;
        if (loader) loader.style.display = 'none';
    }
}

/**
 * Configura el IntersectionObserver del scroll infinito en inventario.
 */
function configurarScrollInventario() {
    const scroller = document.getElementById('inventarioScroll');
    const sentinel = document.getElementById('inventarioSentinel');
    if (!scroller || !sentinel) return;

    // Desconectar observer previo
    if (_inventarioEstado.observer) _inventarioEstado.observer.disconnect();

    _inventarioEstado.observer = new IntersectionObserver((entries) => {
        entries.forEach(e => {
            if (e.isIntersecting && _inventarioEstado.hayMas && !_inventarioEstado.cargando) {
                // Solo cargar si el usuario ya hizo scroll manual
                if (!_inventarioEstado._scrollIniciado) return;

                setTimeout(() => {
                    if (_inventarioEstado.hayMas && !_inventarioEstado.cargando) {
                        cargarPaginaInventario(false);
                    }
                }, 150);
            }
        });
    }, {
        root: scroller,
        rootMargin: '200px'
    });

    _inventarioEstado.observer.observe(sentinel);

    // Detectar el primer scroll del usuario
    if (!scroller._scrollDetector) {
        scroller._scrollDetector = true;
        scroller.addEventListener('scroll', () => {
            _inventarioEstado._scrollIniciado = true;
        }, { passive: true });
    }
}

function renderFilaInventario(p) {
    let stockClass = 'high-stock';
    if (p.stockActual < 10) stockClass = 'low-stock';
    else if (p.stockActual < 50) stockClass = 'medium-stock';

    return `
        <tr class="${stockClass}" data-id="${p.idProducto}">
            <td>${escapeHtml(p.codigoInterno)}</td>
            <td>${escapeHtml(p.nombre)}</td>
            <td>${escapeHtml(p.categoriaNombre || '-')}</td>
            <td style="text-align:right;">${formato(p.precioVenta)}</td>
            <td style="text-align:center;">${p.stockActual}</td>
            <td>
                <button class="btn-accion editar" data-accion="editar" data-id="${p.idProducto}">
                    ✏️ <span class="texto">Editar</span>
                </button>
                <button class="btn-accion eliminar" data-accion="eliminar" data-id="${p.idProducto}">
                    🗑 <span class="texto">Eliminar</span>
                </button>
            </td>
        </tr>
    `;
}

function renderTablaInventario() {
    // Ya no se usa: la lógica ahora está en cargarPaginaInventario + renderFilaInventario
    // Mantener por compatibilidad con llamadas viejas
    const tbody = document.getElementById('tablaProductosBody');
    if (!tbody) return;

    if (_productosCache.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#64748b;padding:20px;">No hay productos</td></tr>`;
        return;
    }

    tbody.innerHTML = _productosCache.map(p => renderFilaInventario(p)).join('');
}

function renderResumenInventario() {
    const div = document.getElementById('resumenInventario');
    if (!div) return;

    // 🔔 Nota: estos totales reflejan SOLO los productos cargados hasta ahora,
    //       no todos los de la BD. Es correcto con scroll infinito.
    const total = _inventarioEstado.total || _productosCache.length;
    const valor = _productosCache.reduce((s, p) => s + (p.precioVenta * p.stockActual), 0);
    const bajoStock = _productosCache.filter(p => p.stockActual < 10).length;
    const sinStock = _productosCache.filter(p => p.stockActual === 0).length;

    div.innerHTML = `
        <div class="card-resumen azul"><h4>Total Productos</h4><p>${total}</p></div>
        <div class="card-resumen verde"><h4>Valor Inventario</h4><p>${formato(valor)}</p></div>
        <div class="card-resumen celeste"><h4>Bajo Stock</h4><p>${bajoStock}</p></div>
        <div class="card-resumen gris"><h4>Sin Stock</h4><p>${sinStock}</p></div>
    `;
}

function setupInventarioListeners() {
        const tbody = document.getElementById('tablaProductosBody');
    const btnNuevo = document.getElementById('btnNuevoProducto');
    const modal = document.getElementById('modalProducto');
    const form = document.getElementById('formProducto');
    const cerrar = document.getElementById('cerrarModalProducto');
    const btnCancelar = document.getElementById('btnCancelarProducto');

    if (tbody && !tbody._listenerAttached) {
        tbody._listenerAttached = true;
        tbody.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-accion]');
            if (!btn) return;
            const id = parseInt(btn.dataset.id, 10);

            if (btn.dataset.accion === 'editar') abrirModalProducto(id);
            if (btn.dataset.accion === 'eliminar') eliminarProductoDelInventario(id);
        });
    }

    if (btnNuevo && !btnNuevo._listenerAttached) {
        btnNuevo._listenerAttached = true;
        btnNuevo.addEventListener('click', () => abrirModalProducto(null));
    }

    if (cerrar && !cerrar._listenerAttached) {
        cerrar._listenerAttached = true;
        cerrar.addEventListener('click', () => hideModal(modal));
    }
    if (btnCancelar && !btnCancelar._listenerAttached) {
        btnCancelar._listenerAttached = true;
        btnCancelar.addEventListener('click', () => hideModal(modal));
    }

    if (form && !form._listenerAttached) {
        form._listenerAttached = true;
        form.addEventListener('submit', guardarProducto);
    }
}

async function cargarCategoriasEnModal() {
    const select = document.getElementById('prodCategoria');
    if (!select) return;

    const resp = await api.get('/Categorias');
    if (!resp.ok) return;

    const categorias = resp.data || [];

    select.innerHTML = '<option value="">— Sin categoría —</option>' +
        categorias.map(c =>
            `<option value="${c.idCategoria}">${escapeHtml(c.nombre)}</option>`
        ).join('');
}

async function abrirModalProducto(idProducto) {
    await cargarCategoriasEnModal();

    const modal = document.getElementById('modalProducto');
    const titulo = document.getElementById('tituloModalProducto');
    const form = document.getElementById('formProducto');

    form.reset();
    _editandoProductoId = idProducto;

    // Limpiar feedbacks
    const feedbackCodigo = document.getElementById('prodCodigoFeedback');
    const feedbackSku = document.getElementById('prodSkuFeedback');
    if (feedbackCodigo) feedbackCodigo.style.display = 'none';
    if (feedbackSku) feedbackSku.style.display = 'none';

    // Limpiar bordes
    document.getElementById('prodCodigo').style.borderColor = '';
    document.getElementById('prodSku').style.borderColor = '';

    if (idProducto == null) {
        titulo.textContent = 'Nuevo Producto';
        document.getElementById('prodCategoria').value = '';
    } else {
        titulo.textContent = 'Editar Producto';
        const p = _productosCache.find(x => x.idProducto === idProducto);
        if (p) {
            document.getElementById('prodCodigo').value = p.codigoInterno || '';
            document.getElementById('prodSku').value = p.sku || '';
            document.getElementById('prodNombre').value = p.nombre || '';
            document.getElementById('prodPrecio').value = p.precioVenta || 0;
            document.getElementById('prodStock').value = p.stockActual || 0;
            document.getElementById('prodCategoria').value = p.idCategoria || '';
        }
    }

    setupBusquedaProductoEnForm();

    showModal(modal);
}

/**
 * Configura la búsqueda automática al escribir en los campos de código/SKU.
 * El título del modal cambia dinámicamente entre "Nuevo Producto" y "Editar Producto".
 * Si el producto es nuevo, limpia los campos para crear.
 */
/**
 * Configura la búsqueda automática al escribir en los campos de código/SKU.
 * - Cambia el título del modal dinámicamente entre "Nuevo Producto" y "Editar Producto".
 * - Si el producto es nuevo, limpia los campos (excepto código y SKU).
 * - Incluye botón "🎲 Generar código" que verifica unicidad antes de asignar.
 */
/**
 * Configura la búsqueda automática al escribir en los campos de código/SKU.
 * - Cambia el título dinámicamente.
 * - Si el producto es nuevo Y el usuario escribió el código MANUALMENTE → limpia campos.
 * - Si el código viene del botón "Generar" → NO limpia campos.
 */
function setupBusquedaProductoEnForm() {
    const inputCodigo = document.getElementById('prodCodigo');
    const inputSku = document.getElementById('prodSku');
    const inputNombre = document.getElementById('prodNombre');
    const inputPrecio = document.getElementById('prodPrecio');
    const inputStock = document.getElementById('prodStock');
    const selectCategoria = document.getElementById('prodCategoria');
    const titulo = document.getElementById('tituloModalProducto');
    const feedbackCodigo = document.getElementById('prodCodigoFeedback');
    const feedbackSku = document.getElementById('prodSkuFeedback');
    const btnGenerar = document.getElementById('btnGenerarCodigo');

    if (!inputCodigo || !inputSku) return;

    let timeoutBusqueda = null;
    let versionBusqueda = 0;

    /**
     * Limpia los campos de datos del producto (excepto código y SKU).
     */
    function limpiarCamposProducto() {
        if (inputNombre) inputNombre.value = '';
        if (inputPrecio) inputPrecio.value = '';
        if (inputStock) inputStock.value = '';
        if (selectCategoria) selectCategoria.value = '';
    }

    function resetearANuevo() {
        _editandoProductoId = null;
        if (titulo) titulo.textContent = 'Nuevo Producto';
    }

    /**
     * Busca un producto por código o SKU.
     * @param {boolean} limpiarSiNuevo - Si es true, limpia los campos cuando es nuevo (solo cuando el usuario escribió el código manualmente)
     */
    function buscarYcargar(codigo, sku, limpiarSiNuevo = false) {
        if (timeoutBusqueda) clearTimeout(timeoutBusqueda);
        const version = ++versionBusqueda;

        timeoutBusqueda = setTimeout(async () => {
            if (version !== versionBusqueda) return;

            const codigoLimpio = (codigo || '').trim();
            const skuLimpio = (sku || '').trim();

            // ---- CASO 1: ambos vacíos → resetear a "Nuevo Producto" ----
            if (!codigoLimpio && !skuLimpio) {
                resetearANuevo();
                if (limpiarSiNuevo) limpiarCamposProducto();

                if (feedbackCodigo) feedbackCodigo.style.display = 'none';
                if (feedbackSku) feedbackSku.style.display = 'none';
                inputCodigo.style.borderColor = '';
                inputSku.style.borderColor = '';
                return;
            }

            // ---- Buscar producto en caché local ----
            let producto = (_productosCache || []).find(p => {
                const c = (p.codigoInterno || '').toUpperCase();
                const s = (p.sku || '').toUpperCase();
                return (codigoLimpio && c === codigoLimpio.toUpperCase()) ||
                       (skuLimpio && s === skuLimpio.toUpperCase());
            });

            // Si no está, consultar la API
            if (!producto) {
                const query = codigoLimpio || skuLimpio;
                try {
                    const resp = await api.get(`/Productos/search?q=${encodeURIComponent(query)}`);
                    if (resp.ok && Array.isArray(resp.data) && resp.data.length > 0) {
                        producto = resp.data.find(p => {
                            const c = (p.codigoInterno || '').toUpperCase();
                            const s = (p.sku || '').toUpperCase();
                            return (codigoLimpio && c === codigoLimpio.toUpperCase()) ||
                                   (skuLimpio && s === skuLimpio.toUpperCase());
                        });
                    }
                } catch (err) {
                    console.warn('Error buscando producto:', err);
                }
            }

            // ---- CASO 2: encontrado → cargar para editar ----
            if (producto) {
                if (_editandoProductoId === producto.idProducto) {
                    if (feedbackCodigo) feedbackCodigo.style.display = 'none';
                    if (feedbackSku) feedbackSku.style.display = 'none';
                    return;
                }

                _editandoProductoId = producto.idProducto;
                if (titulo) titulo.textContent = '✏️ Editar Producto';

                if (inputCodigo) inputCodigo.value = producto.codigoInterno || '';
                if (inputSku) inputSku.value = producto.sku || '';
                if (inputNombre) inputNombre.value = producto.nombre || '';
                if (inputPrecio) inputPrecio.value = producto.precioVenta || 0;
                if (inputStock) inputStock.value = producto.stockActual || 0;
                if (selectCategoria) selectCategoria.value = producto.idCategoria || '';

                if (feedbackCodigo) {
                    feedbackCodigo.style.display = 'block';
                    feedbackCodigo.textContent = '✅ Producto encontrado';
                    feedbackCodigo.style.color = '#16a34a';
                }
                if (feedbackSku) {
                    feedbackSku.style.display = 'block';
                    feedbackSku.textContent = '✅ Producto encontrado';
                    feedbackSku.style.color = '#16a34a';
                }
                inputCodigo.style.borderColor = '#16a34a';
                inputSku.style.borderColor = '#16a34a';

                if (typeof toast === 'function') {
                    toast(`📝 Editando "${producto.nombre}"`, 'success');
                }
                return;
            }

            // ---- CASO 3: no encontrado → modo "crear" ----
            resetearANuevo();

            // 🆕 Solo limpiar campos si el usuario escribió el código/SKU manualmente
            if (limpiarSiNuevo) {
                limpiarCamposProducto();
            }

            if (feedbackCodigo && codigoLimpio) {
                feedbackCodigo.style.display = 'block';
                feedbackCodigo.textContent = '🆕 Código disponible';
                feedbackCodigo.style.color = '#2563eb';
                inputCodigo.style.borderColor = '#2563eb';
            }
            if (feedbackSku && skuLimpio) {
                feedbackSku.style.display = 'block';
                feedbackSku.textContent = '🆕 SKU disponible';
                feedbackSku.style.color = '#2563eb';
                inputSku.style.borderColor = '#2563eb';
            }
        }, 400);
    }

    // ============================================================
    // LISTENERS de código y SKU
    // ============================================================
      if (!inputCodigo._busquedaAttached) {
        inputCodigo._busquedaAttached = true;
        inputCodigo.addEventListener('input', () => {
            // 🆕 Ignorar si el evento fue disparado por el botón "Generar"
            if (inputCodigo._skipBusqueda) {
                inputCodigo._skipBusqueda = false;
                return;
            }
            buscarYcargar(inputCodigo.value, inputSku.value, true);
        });
    }

    if (!inputSku._busquedaAttached) {
        inputSku._busquedaAttached = true;
        inputSku.addEventListener('input', () => {
            buscarYcargar(inputCodigo.value, inputSku.value, true);
        });
    }

    // ============================================================
    // BOTÓN "🎲 GENERAR CÓDIGO"
    // ============================================================
    if (btnGenerar && !btnGenerar._attached) {
        btnGenerar._attached = true;
        btnGenerar.addEventListener('click', async () => {
            const nombre = document.getElementById('prodNombre')?.value?.trim() || '';
            const catRaw = document.getElementById('prodCategoria')?.value;
            const idCategoria = catRaw ? parseInt(catRaw, 10) : null;

            if (!nombre) {
                toast('Escribe primero el nombre del producto', 'error');
                document.getElementById('prodNombre')?.focus();
                return;
            }

            const inputCodigoActual = document.getElementById('prodCodigo');
            if (inputCodigoActual.value.trim()) {
                if (!confirm(`¿Reemplazar "${inputCodigoActual.value}" por uno generado automáticamente?`)) {
                    return;
                }
            }

            btnGenerar.disabled = true;
            btnGenerar.textContent = '⏳ Generando...';

            try {
                const codigoGenerado = await generarCodigoInterno(nombre, idCategoria);

                // 🆕 Bloquear temporalmente el listener para que no dispare la búsqueda
                inputCodigoActual._skipBusqueda = true;
                inputCodigoActual.value = codigoGenerado;

                // Disparar input (el listener lo ignora por el flag)
                inputCodigoActual.dispatchEvent(new Event('input', { bubbles: true }));

                // Mostrar feedback verde directamente
                const feedbackCodigo = document.getElementById('prodCodigoFeedback');
                if (feedbackCodigo) {
                    feedbackCodigo.style.display = 'block';
                    feedbackCodigo.textContent = '🎲 Código generado';
                    feedbackCodigo.style.color = '#2563eb';
                }
                inputCodigoActual.style.borderColor = '#2563eb';

                toast(`🎲 Código generado: ${codigoGenerado}`, 'success');
            } catch (err) {
                console.error('Error generando código:', err);
                toast('Error al generar el código', 'error');
            } finally {
                btnGenerar.disabled = false;
                btnGenerar.textContent = '🎲 Generar';
            }
        });
    }
}
/**
 * Genera un código interno descriptivo y único.
 * 
 * Llama al backend (/Productos/generar-codigo) que garantiza unicidad
 * con bloqueo transaccional. Si el backend falla, usa un fallback local
 * basado en el caché de productos.
 * 
 * Formato: [CAT]-[NOM]-[NNN]
 *   CAT: 3 letras de la categoría (o "GEN")
 *   NOM: 3 letras del nombre (o "PROD")
 *   NNN: número secuencial (001, 002, ...)
 * 
 * @param {string} nombre - Nombre del producto (obligatorio)
 * @param {number|null} idCategoria - ID de la categoría (opcional)
 * @returns {Promise<string>} Código único garantizado
 */
async function generarCodigoInterno(nombre, idCategoria) {
    if (!nombre || !String(nombre).trim()) {
        throw new Error('El nombre es obligatorio para generar un código');
    }

    try {
        // -------- 1. Intentar con el backend --------
        const params = new URLSearchParams();
        params.append('nombre', String(nombre).trim());
        if (idCategoria != null) {
            params.append('idCategoria', String(idCategoria));
        }

        const resp = await api.get(`/Productos/generar-codigo?${params.toString()}`);

        if (resp.ok && resp.data && resp.data.codigo) {
            console.log(`🎲 Código generado por el servidor: ${resp.data.codigo}`);
            return resp.data.codigo;
        }

        console.warn('⚠️ El servidor no devolvió un código válido. Usando fallback local.');
        return generarCodigoInternoLocal(nombre, idCategoria);

    } catch (err) {
        console.warn('⚠️ Error al generar código desde el backend. Usando fallback local:', err);
        return generarCodigoInternoLocal(nombre, idCategoria);
    }
}

/**
 * Fallback local: genera un código único basado SOLO en el caché del navegador.
 * Menos robusto que el backend (puede fallar en concurrencia extrema), pero
 * funcional cuando el servidor no está disponible.
 * 
 * @param {string} nombre
 * @param {number|null} idCategoria
 * @returns {string}
 */
function generarCodigoInternoLocal(nombre, idCategoria) {
    // -------- 1. Prefijo de categoría --------
    let prefijoCat = 'GEN';
    if (idCategoria != null) {
        const cat = (_categoriasCache || []).find(c => c.idCategoria === idCategoria);
        if (cat && cat.nombre) {
            const catLimpia = limpiarParaCodigo(cat.nombre);
            prefijoCat = catLimpia.length >= 3
                ? catLimpia.substring(0, 3)
                : catLimpia.padEnd(3, 'X');
        }
    }

    // -------- 2. Prefijo del nombre --------
    let prefijoNom = 'PROD';
    if (nombre && String(nombre).trim()) {
        const nombreLimpio = limpiarParaCodigo(nombre);
        if (nombreLimpio.length >= 3) {
            prefijoNom = nombreLimpio.substring(0, 3);
        } else if (nombreLimpio.length > 0) {
            prefijoNom = nombreLimpio.padEnd(3, 'X');
        }
    }

    const prefijo = `${prefijoCat}-${prefijoNom}`;

    // -------- 3. Buscar el siguiente número secuencial --------
    const productosExistentes = (_productosCache || []).filter(p =>
        (p.codigoInterno || '').toUpperCase().startsWith((prefijo + '-').toUpperCase())
    );

    let siguiente = 1;
    if (productosExistentes.length > 0) {
        const numeros = productosExistentes
            .map(p => {
                const partes = String(p.codigoInterno || '').split('-');
                const ultimo = partes[partes.length - 1];
                const n = parseInt(ultimo, 10);
                return isNaN(n) ? 0 : n;
            })
            .filter(n => n > 0);

        if (numeros.length > 0) {
            siguiente = Math.max(...numeros) + 1;
        }
    }

    // -------- 4. Verificar unicidad en caché local --------
    const MAX_INTENTOS = 200;
    for (let i = 0; i < MAX_INTENTOS; i++) {
        const codigo = `${prefijo}-${String(siguiente).padStart(3, '0')}`;

        const existe = (_productosCache || []).some(p =>
            (p.codigoInterno || '').toUpperCase() === codigo.toUpperCase()
        );

        if (!existe) {
            console.log(`🎲 Código generado (fallback local): ${codigo}`);
            return codigo;
        }

        siguiente++;
    }

    // -------- 5. Fallback con timestamp si no encuentra --------
    const timestamp = Date.now().toString(36).toUpperCase().slice(-6);
    const codigoFallback = `${prefijo}-${timestamp}`;
    console.warn(`⚠️ Se usó fallback con timestamp: ${codigoFallback}`);
    return codigoFallback;
}

/**
 * Limpia un texto para usar en un código: sin tildes, sin signos, sin espacios.
 * Convierte "Arroz Diana 500g" → "ARROZDIA" o "Coca-Cola" → "COCACOLA"
 * 
 * @param {string} str
 * @returns {string}
 */
function limpiarParaCodigo(str) {
    if (!str) return '';
    return String(str)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')   // quitar tildes
        .replace(/ñ/gi, 'N')                // ñ → N
        .replace(/[^a-zA-Z0-9]/g, '')       // solo letras y números
        .toUpperCase();
}

async function guardarProducto(e) {
    e.preventDefault();

    const esEdicion = _editandoProductoId != null;

    const categoriaRaw = document.getElementById('prodCategoria').value;
    const idCategoria = categoriaRaw ? parseInt(categoriaRaw, 10) : null;

    let codigoRaw = document.getElementById('prodCodigo').value.trim();

    // 🆕 Auto-generar código si está vacío (solo al crear)
    if (!codigoRaw && !esEdicion) {
        const nombre = document.getElementById('prodNombre').value.trim();
        if (nombre) {
            codigoRaw = await generarCodigoInterno(nombre, idCategoria, true);
            document.getElementById('prodCodigo').value = codigoRaw;
            toast(`🎲 Código generado: ${codigoRaw}`, 'success');
        }
    }

    const skuRaw = document.getElementById('prodSku').value.trim();

    const dto = {
        codigoInterno: codigoRaw,
        sku: skuRaw || null,
        nombre: document.getElementById('prodNombre').value.trim(),
        idCategoria: idCategoria,
        actualizarCategoria: true,
        precioVenta: parseFloat(document.getElementById('prodPrecio').value) || 0,
        stockActual: parseInt(document.getElementById('prodStock').value, 10) || 0
    };

    if (!dto.codigoInterno || !dto.nombre) {
        toast('Código y nombre son obligatorios', 'error');
        return;
    }

    const btnGuardar = document.getElementById('btnGuardarProducto');
    const textoOriginal = btnGuardar.textContent;

    // 🆕 Hasta 3 intentos si hay colisión de código
    const MAX_INTENTOS = 3;
    let intentos = 0;
    let resp = null;

    while (intentos < MAX_INTENTOS) {
        intentos++;
        btnGuardar.disabled = true;
        btnGuardar.textContent = `⏳ Guardando... (${intentos}/${MAX_INTENTOS})`;

        if (esEdicion) {
            resp = await api.put(`/Productos/${_editandoProductoId}`, dto);
        } else {
            resp = await api.post('/Productos', {
                ...dto,
                stockMinimo: 5,
                impuestoPorcentaje: 19,
                estado: 'Activo'
            });
        }

        // ✅ Éxito → salir del loop
        if (resp.ok) break;

        // ⚠️ Si es conflicto de código, regenerar y reintentar
        if (resp.status === 409 && !esEdicion) {
            const mensaje = resp.data?.message || '';
            const esCodigoDuplicado = mensaje.toLowerCase().includes('codigo') ||
                                       mensaje.toLowerCase().includes('código');

            if (esCodigoDuplicado) {
                console.warn(`🔄 Código "${dto.codigoInterno}" en uso. Regenerando...`);

                const nombre = document.getElementById('prodNombre').value.trim();
                dto.codigoInterno = await generarCodigoInterno(nombre, idCategoria, true);
                document.getElementById('prodCodigo').value = dto.codigoInterno;

                toast(`🎲 Reintentando con: ${dto.codigoInterno}`, 'success');
                continue;   // volver a intentar
            }
        }

        // Otros errores → salir
        break;
    }

    btnGuardar.disabled = false;
    btnGuardar.textContent = textoOriginal;

    if (!resp || !resp.ok) {
        // El toast ya lo mostró apiFetch
        return;
    }

    toast(esEdicion ? '✅ Producto actualizado' : '✅ Producto creado');
    hideModal(document.getElementById('modalProducto'));

    window._productosCache = null;
    // 🆕 Invalidar caché del top
    estado._productosCacheInvalidado = true;

    await initInventario();
    await cargarProductosDesdeAPI();

    if (document.getElementById('vista-categorias')?.hidden === false) {
        await initCategorias();
    }
}

async function eliminarProductoDelInventario(idProducto) {
    if (!confirm('¿Eliminar este producto?')) return;

    const resp = await api.delete(`/Productos/${idProducto}`);
    if (!resp.ok) return;

    toast('✅ Producto eliminado');
    
    // 🆕 Invalidar caché
    estado._productosCacheInvalidado = true;
    
    await initInventario();
    await cargarProductosDesdeAPI();

    // 🆕 Si estamos en categorías, refrescar
    if (document.getElementById('vista-categorias')?.hidden === false) {
        await initCategorias();
    }
}

/* ============================================================
   16. USUARIOS (CRUD)
   ============================================================ */

let _usuariosCache = [];
let _rolesCache = [];
let _editandoUsuarioId = null;

async function initUsuarios() {
    if (!localStorage.getItem('pos_token')) return;

    const usuario = JSON.parse(localStorage.getItem('pos_usuario') || '{}');
    if (usuario.rol !== 1) {
        toast('Solo administradores pueden ver esta sección', 'error');
        return;
    }

    const tbody = document.querySelector('#tablaUsuarios tbody');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#64748b; padding:20px;">Cargando usuarios...</td></tr>`;

    const [respUsuarios, respRoles] = await Promise.all([
        api.get('/Usuarios'),
        api.get('/Roles')
    ]);

    if (!respUsuarios.ok) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#dc2626;">Error al cargar usuarios</td></tr>`;
        return;
    }

    _usuariosCache = respUsuarios.data || [];
    _rolesCache = respRoles.ok ? (respRoles.data || []) : [];

    renderTablaUsuarios();
    renderResumenUsuarios();
    setupUsuariosListeners();
}

function renderTablaUsuarios() {
    const tbody = document.querySelector('#tablaUsuarios tbody');
    if (!tbody) return;

    if (_usuariosCache.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#64748b; padding:20px;">No hay usuarios</td></tr>`;
        return;
    }

    const usuarioLogueado = JSON.parse(localStorage.getItem('pos_usuario') || '{}');

    tbody.innerHTML = _usuariosCache.map(u => {
        const esUnoMismo = u.idUsuario === usuarioLogueado.id;
        const estadoColor = u.estado === 'Activo' ? '#16a34a' : '#dc2626';
        const estadoBg = u.estado === 'Activo' ? 'rgba(22,163,74,0.15)' : 'rgba(220,38,38,0.15)';
        const fecha = formatearFechaColombia(u.fechaCreacion);

        return `
            <tr data-id="${u.idUsuario}">
                <td><strong>${escapeHtml(u.nombre)}</strong>${esUnoMismo ? ' <span style="color:#2563eb; font-size:11px;">(tú)</span>' : ''}</td>
                <td>${escapeHtml(u.correo)}</td>
                <td>${escapeHtml(u.rol || '-')}</td>
                <td style="text-align:center;">
                    <span style="color:${estadoColor}; background:${estadoBg}; padding:2px 8px; border-radius:4px; font-size:12px; font-weight:600;">
                        ${escapeHtml(u.estado)}
                    </span>
                </td>
                <td style="font-size:12px; color:#64748b;">${fecha}</td>
                <td>
                    <button class="btn-accion editar" data-accion="editar" data-id="${u.idUsuario}">
                        ✏️ <span class="texto">Editar</span>
                    </button>
                    <button class="btn-accion eliminar" data-accion="eliminar" data-id="${u.idUsuario}" ${esUnoMismo ? 'disabled title="No puedes eliminarte a ti mismo"' : ''}>
                        🗑 <span class="texto">Eliminar</span>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function renderResumenUsuarios() {
    const div = document.getElementById('resumenUsuarios');
    if (!div) return;

    const total = _usuariosCache.length;
    const activos = _usuariosCache.filter(u => u.estado === 'Activo').length;
    const inactivos = _usuariosCache.filter(u => u.estado === 'Inactivo').length;
    const admins = _usuariosCache.filter(u => u.idRol === 1).length;

    div.innerHTML = `
        <div class="card-resumen azul"><h4>Total Usuarios</h4><p>${total}</p></div>
        <div class="card-resumen verde"><h4>Activos</h4><p>${activos}</p></div>
        <div class="card-resumen celeste"><h4>Administradores</h4><p>${admins}</p></div>
        <div class="card-resumen gris"><h4>Inactivos</h4><p>${inactivos}</p></div>
    `;
}

function setupUsuariosListeners() {
    const tbody = document.querySelector('#tablaUsuarios tbody');
    const btnNuevo = document.getElementById('btnNuevoUsuario');
    const modal = document.getElementById('modalUsuario');
    const form = document.getElementById('formUsuario');
    const cerrar = document.getElementById('cerrarModalUsuario');
    const btnCancelar = document.getElementById('btnCancelarUsuario');

    if (tbody && !tbody._listenerAttached) {
        tbody._listenerAttached = true;
        tbody.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-accion]');
            if (!btn || btn.disabled) return;

            const id = parseInt(btn.dataset.id, 10);
            if (btn.dataset.accion === 'editar') abrirModalUsuario(id);
            if (btn.dataset.accion === 'eliminar') eliminarUsuario(id);
        });
    }

    if (btnNuevo && !btnNuevo._listenerAttached) {
        btnNuevo._listenerAttached = true;
        btnNuevo.addEventListener('click', () => abrirModalUsuario(null));
    }

    if (cerrar && !cerrar._listenerAttached) {
        cerrar._listenerAttached = true;
        cerrar.addEventListener('click', () => hideModal(modal));
    }
    if (btnCancelar && !btnCancelar._listenerAttached) {
        btnCancelar._listenerAttached = true;
        btnCancelar.addEventListener('click', () => hideModal(modal));
    }

    if (form && !form._listenerAttached) {
        form._listenerAttached = true;
        form.addEventListener('submit', guardarUsuario);
    }

    // Toggle password
    function setupTogglePassword(btnId, inputId) {
        const btn = document.getElementById(btnId);
        const input = document.getElementById(inputId);
        if (btn && !btn._attached) {
            btn._attached = true;
            btn.addEventListener('click', () => {
                const esPassword = input.type === 'password';
                input.type = esPassword ? 'text' : 'password';
                btn.textContent = esPassword ? '🙈' : '👁';
            });
        }
    }
    setupTogglePassword('togglePassword', 'usuPassword');
    setupTogglePassword('togglePassword2', 'usuPassword2');

    if (modal && !modal._backdropAttached) {
        modal._backdropAttached = true;
        modal.addEventListener('click', (e) => {
            if (e.target === modal) hideModal(modal);
        });
    }
}

function abrirModalUsuario(idUsuario) {
    const modal = document.getElementById('modalUsuario');
    const titulo = document.getElementById('tituloModalUsuario');
    const form = document.getElementById('formUsuario');
    const helpPass = document.getElementById('usuPasswordHelp');

    const inputPass = document.getElementById('usuPassword');
    const inputPass2 = document.getElementById('usuPassword2');
    const inputCorreo = document.getElementById('usuCorreo');
    const feedbackCorreo = document.getElementById('usuCorreoFeedback');
    const feedback2 = document.getElementById('usuPassword2Feedback');
    const password2Row = document.getElementById('usuPassword2Row');

    form.reset();
    _editandoUsuarioId = idUsuario;

    const selectRol = document.getElementById('usuRol');
    selectRol.innerHTML = '<option value="">— Selecciona un rol —</option>' +
        _rolesCache.map(r => `<option value="${r.idRol}">${escapeHtml(r.nombreRol)}</option>`).join('');

    if (feedbackCorreo) feedbackCorreo.style.display = 'none';
    if (feedback2) feedback2.style.display = 'none';
    if (inputCorreo) inputCorreo.style.borderColor = '';
    if (inputPass2) inputPass2.style.borderColor = '';

    if (idUsuario == null) {
        titulo.textContent = 'Nuevo Usuario';
        inputPass.required = true;
        inputPass2.required = true;
        document.getElementById('usuEstado').value = 'Activo';
        helpPass.style.display = 'none';
        password2Row.style.display = '';
    } else {
        titulo.textContent = 'Editar Usuario';
        inputPass.required = false;
        inputPass2.required = false;
        helpPass.style.display = 'block';
        password2Row.style.display = 'none';

        const u = _usuariosCache.find(x => x.idUsuario === idUsuario);
        if (u) {
            document.getElementById('usuNombre').value = u.nombre || '';
            document.getElementById('usuCorreo').value = u.correo || '';
            document.getElementById('usuRol').value = u.idRol || '';
            document.getElementById('usuEstado').value = u.estado || 'Activo';
        }
    }

    if (inputPass && !inputPass._mostrarConfirmarAttached) {
        inputPass._mostrarConfirmarAttached = true;
        inputPass.addEventListener('input', () => {
            if (_editandoUsuarioId != null) {
                password2Row.style.display = inputPass.value ? '' : 'none';
                if (!inputPass.value && feedback2) {
                    feedback2.style.display = 'none';
                    inputPass2.style.borderColor = '';
                }
            }
        });
    }

    if (inputCorreo && !inputCorreo._validacionAttached) {
        inputCorreo._validacionAttached = true;
        inputCorreo.addEventListener('input', () => {
            const valor = inputCorreo.value.trim();
            if (!valor) {
                feedbackCorreo.style.display = 'none';
                inputCorreo.style.borderColor = '';
                return;
            }

            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            const valido = emailRegex.test(valor);

            feedbackCorreo.style.display = 'block';
            if (valido) {
                feedbackCorreo.textContent = '✅ Correo válido';
                feedbackCorreo.style.color = '#16a34a';
                inputCorreo.style.borderColor = '#16a34a';
            } else {
                feedbackCorreo.textContent = '⚠️ Formato de correo inválido';
                feedbackCorreo.style.color = '#dc2626';
                inputCorreo.style.borderColor = '#dc2626';
            }
        });
    }

    function validarCoincidenciaPasswords() {
        const p1 = inputPass?.value || '';
        const p2 = inputPass2?.value || '';

        if (!p2) {
            feedback2.style.display = 'none';
            inputPass2.style.borderColor = '';
            return;
        }

        if (p1 === p2) {
            feedback2.style.display = 'block';
            feedback2.textContent = '✅ Las contraseñas coinciden';
            feedback2.style.color = '#16a34a';
            inputPass2.style.borderColor = '#16a34a';
        } else {
            feedback2.style.display = 'block';
            feedback2.textContent = '⚠️ Las contraseñas no coinciden';
            feedback2.style.color = '#dc2626';
            inputPass2.style.borderColor = '#dc2626';
        }
    }

    if (inputPass && !inputPass._coincidenciaAttached) {
        inputPass._coincidenciaAttached = true;
        inputPass.addEventListener('input', validarCoincidenciaPasswords);
    }

    if (inputPass2 && !inputPass2._coincidenciaAttached) {
        inputPass2._coincidenciaAttached = true;
        inputPass2.addEventListener('input', validarCoincidenciaPasswords);
    }

    showModal(modal);
}

async function guardarUsuario(e) {
    e.preventDefault();

    const esEdicion = _editandoUsuarioId != null;

    const nombre = document.getElementById('usuNombre').value.trim();
    const correo = document.getElementById('usuCorreo').value.trim();
    const password = document.getElementById('usuPassword').value.trim();
    const idRol = parseInt(document.getElementById('usuRol').value, 10);
    const estado = document.getElementById('usuEstado').value;

    if (!nombre) { toast('El nombre es obligatorio', 'error'); return; }
    if (!correo) { toast('El correo es obligatorio', 'error'); return; }
    if (!idRol) { toast('Selecciona un rol', 'error'); return; }

    const password2 = document.getElementById('usuPassword2')?.value || '';

    if (!esEdicion) {
        if (password !== password2) {
            toast('Las contraseñas no coinciden', 'error');
            document.getElementById('usuPassword2').focus();
            return;
        }
    } else {
        if (password && password !== password2) {
            toast('Las contraseñas no coinciden', 'error');
            document.getElementById('usuPassword2').focus();
            return;
        }
    }

    const dto = { nombre, correo, idRol, estado };
    if (password) dto.password = password;

    if (window._guardandoUsuario) return;
    window._guardandoUsuario = true;

    const btnGuardar = document.getElementById('btnGuardarUsuario');
    const textoOriginal = btnGuardar.textContent;
    btnGuardar.disabled = true;
    btnGuardar.textContent = '⏳ Guardando...';

    let resp;
    if (esEdicion) {
        resp = await api.put(`/Usuarios/${_editandoUsuarioId}`, dto);
    } else {
        resp = await api.post('/Usuarios', dto);
    }

    btnGuardar.disabled = false;
    btnGuardar.textContent = textoOriginal;
    window._guardandoUsuario = false;

    if (!resp.ok) return;

    toast(esEdicion ? '✅ Usuario actualizado' : '✅ Usuario creado');
    hideModal(document.getElementById('modalUsuario'));
    await initUsuarios();
}

async function eliminarUsuario(idUsuario) {
    const u = _usuariosCache.find(x => x.idUsuario === idUsuario);
    if (!u) return;

    const usuarioLogueado = JSON.parse(localStorage.getItem('pos_usuario') || '{}');
    if (u.idUsuario === usuarioLogueado.id) {
        toast('No puedes eliminar tu propio usuario', 'error');
        return;
    }

    const msg = `¿Eliminar el usuario "${u.nombre}"?\n\n` +
                `Correo: ${u.correo}\n` +
                `Rol: ${u.rol}\n\n` +
                `Esta acción no se puede deshacer.`;

    if (!confirm(msg)) return;

    const resp = await api.delete(`/Usuarios/${idUsuario}`);
    if (!resp.ok) return;

    toast('✅ Usuario eliminado');
    await initUsuarios();
}

/* ============================================================
   17. DASHBOARD / REPORTES
   ============================================================ */

let _graficoVentasSemana = null;
let _graficoMetodosPago = null;
let _periodoActual = 'mes';

async function initReportes() {
    if (!localStorage.getItem('pos_token')) return;

    setupFiltrosDashboard();
    await cargarDatosDashboard(_periodoActual);
}

function setupFiltrosDashboard() {
    const botones = document.querySelectorAll('.btn-periodo');
    if (botones.length === 0) return;
    if (botones[0]._listenerAttached) return;

    botones.forEach(btn => {
        btn._listenerAttached = true;
        btn.addEventListener('click', async () => {
            const periodo = btn.dataset.periodo;
            if (!periodo) return;

            botones.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            _periodoActual = periodo;
            await cargarDatosDashboard(periodo);
        });
    });
}

async function cargarDatosDashboard(periodo) {
    // Actualizar texto indicador
    const textoPeriodo = document.getElementById('dashPeriodoTexto');
    const etiquetas = {
        hoy: 'Mostrando datos de hoy',
        semana: 'Mostrando datos de los últimos 7 días',
        mes: 'Mostrando datos del mes actual',
        'año': 'Mostrando datos del año actual',
        anio: 'Mostrando datos del año actual'
    };
    if (textoPeriodo) {
        textoPeriodo.textContent = etiquetas[periodo] || 'Mostrando datos';
    }

    // 🆕 Actualizar los TÍTULOS de las tarjetas según el período
    actualizarTitulosTarjetas(periodo);

    // Mostrar indicador de carga
    document.querySelectorAll('#resumenReportes .card-resumen p').forEach(p => {
        p.style.opacity = '0.5';
    });

    // Llamar a la API
    const resp = await api.get(`/Reportes/dashboard?periodo=${periodo}`);
    if (!resp.ok) {
        toast('Error al cargar el dashboard', 'error');
        return;
    }

    const data = resp.data;
    console.log(`📊 Dashboard (${periodo}):`, data);

    // Actualizar UI
    actualizarTarjetasDashboard(data);
    renderizarGraficoVentasSemana(data.ventasPorDia, periodo);
    renderizarGraficoMetodosPago(data.ventasPorMetodo);
    renderizarTopProductos(data.topProductos);
    renderizarUltimasVentas(data.ultimasVentas);

    // Restaurar opacidad
    document.querySelectorAll('#resumenReportes .card-resumen p').forEach(p => {
        p.style.opacity = '1';
    });
}

// ============================================================
// Actualizar los títulos de las tarjetas según el período
// ============================================================
function actualizarTitulosTarjetas(periodo) {
    // Mapeo de período → sufijo del título
    const sufijos = {
        hoy: 'de Hoy',
        semana: 'de la Semana',
        mes: 'del Mes',
        'año': 'del Año',
        anio: 'del Año'
    };

    const sufijo = sufijos[periodo] || 'del Mes';

    // Actualizar cada título
    const ingresosTitulo = document.getElementById('dashIngresosTitulo');
    const ventasTitulo = document.getElementById('dashVentasTitulo');
    const ticketTitulo = document.getElementById('dashTicketTitulo');
    const productosTitulo = document.getElementById('dashProductosTitulo');

    if (ingresosTitulo) ingresosTitulo.textContent = `Ingresos ${sufijo}`;
    if (ventasTitulo) ventasTitulo.textContent = `Ventas ${sufijo}`;

    // Para ticket promedio y productos vendidos, usar paréntesis
    // "Ticket Promedio (Hoy)" en lugar de "Ticket Promedio de Hoy"
    const parentesis = {
        hoy: '(Hoy)',
        semana: '(Semana)',
        mes: '(Mes)',
        'año': '(Año)',
        anio: '(Año)'
    };

    const etiquetaParentesis = parentesis[periodo] || '(Mes)';

    if (ticketTitulo) ticketTitulo.textContent = `Ticket Promedio ${etiquetaParentesis}`;
    if (productosTitulo) productosTitulo.textContent = `Productos Vendidos ${etiquetaParentesis}`;
}

function actualizarTarjetasDashboard(data) {
    const ingresos = document.getElementById('dashIngresos');
    const ventas = document.getElementById('dashVentas');
    const ticket = document.getElementById('dashTicket');
    const productos = document.getElementById('dashProductos');

    if (ingresos) ingresos.textContent = formato(data.ingresosMes);
    if (ventas) ventas.textContent = data.cantidadVentasMes;
    if (ticket) ticket.textContent = formato(data.ticketPromedio);
    if (productos) productos.textContent = data.productosVendidosMes;
}

function renderizarGraficoVentasSemana(ventasPorDia, periodo) {
    const ctx = document.getElementById('graficoVentasSemana');
    if (!ctx) return;

    if (_graficoVentasSemana) _graficoVentasSemana.destroy();

    const titulo = ctx.parentElement.querySelector('h4');
    if (titulo) {
        const titulos = {
            hoy: '📈 Ventas de hoy',
            semana: '📈 Ventas de los últimos 7 días',
            mes: '📈 Ventas por día (mes actual)',
            'año': '📈 Ventas por mes (año actual)',
            anio: '📈 Ventas por mes (año actual)'
        };
        titulo.textContent = titulos[periodo] || '📈 Ventas';
    }

    const labels = ventasPorDia.map(v => v.fechaCorta);
    const totales = ventasPorDia.map(v => v.total);

    const colores = totales.map((t, i) => {
        if (t === 0) return '#cbd5e1';
        if (i === totales.length - 1 && periodo !== 'año' && periodo !== 'anio') return '#22c55e';
        return '#2563eb';
    });

    _graficoVentasSemana = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Ventas ($)',
                data: totales,
                backgroundColor: colores,
                borderRadius: 6,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const cantidad = ventasPorDia[context.dataIndex]?.cantidad || 0;
                            return [
                                'Total: ' + formato(context.raw),
                                'Ventas: ' + cantidad
                            ];
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return '$' + value.toLocaleString('es-CO');
                        }
                    }
                }
            }
        }
    });
}

function renderizarGraficoMetodosPago(ventasPorMetodo) {
    const ctx = document.getElementById('graficoMetodosPago');
    if (!ctx) return;

    if (_graficoMetodosPago) _graficoMetodosPago.destroy();

    if (!ventasPorMetodo || ventasPorMetodo.length === 0) {
        ctx.parentElement.innerHTML = '<p style="text-align:center;color:#64748b;padding:40px;">Sin ventas este mes</p>';
        return;
    }

    const labels = ventasPorMetodo.map(v => v.metodo);
    const totales = ventasPorMetodo.map(v => v.total);

    _graficoMetodosPago = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: totales,
                backgroundColor: ['#2563eb', '#22c55e', '#f59e0b', '#9333ea', '#dc2626'],
                borderWidth: 2,
                borderColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom' },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.raw || 0;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const porcentaje = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                            return `${label}: ${formato(value)} (${porcentaje}%)`;
                        }
                    }
                }
            }
        }
    });
}

function renderizarTopProductos(topProductos) {
    const tbody = document.querySelector('#tablaTopProductos tbody');
    if (!tbody) return;

    if (!topProductos || topProductos.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#64748b;padding:20px;">Sin ventas este mes</td></tr>`;
        return;
    }

    const medallas = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];

    tbody.innerHTML = topProductos.map((p, i) => `
        <tr>
            <td style="text-align:center;font-size:18px;">${medallas[i] || (i + 1)}</td>
            <td><strong>${escapeHtml(p.nombre)}</strong></td>
            <td style="text-align:center;">${p.cantidadVendida}</td>
            <td style="text-align:right;">${formato(p.totalGenerado)}</td>
        </tr>
    `).join('');
}

function renderizarUltimasVentas(ultimasVentas) {
    const tbody = document.querySelector('#tablaReportes tbody');
    if (!tbody) return;

    if (!ultimasVentas || ultimasVentas.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#64748b;padding:20px;">Sin ventas registradas</td></tr>`;
        return;
    }

    tbody.innerHTML = ultimasVentas.map(v => {
        const fecha = formatearFechaColombia(v.fechaVenta);
        return `
            <tr>
                <td>${fecha}</td>
                <td>${escapeHtml(v.clienteNombre)}</td>
                <td style="text-align:center;">${v.cantidadItems}</td>
                <td style="text-align:right;"><strong>${formato(v.totalFinal)}</strong></td>
            </tr>
        `;
    }).join('');
}

/* ============================================================
   18. SIDEBAR
   ============================================================ */

function setupSidebar() {
    const sidebarEl = document.querySelector('.sidebar');
    const btnMenu = document.getElementById('btnMenu');
    const overlay = document.getElementById('overlay');
    const btnFix = document.getElementById('btnFixSidebar');

    if (!sidebarEl) return;

    const modoGuardado = localStorage.getItem('pos_sidebar_modo') || 'auto';
    aplicarModo(modoGuardado);

    function aplicarModo(modo) {
        sidebarEl.classList.remove('modo-auto', 'modo-fijo');
        sidebarEl.classList.add(modo === 'fijo' ? 'modo-fijo' : 'modo-auto');

        if (btnFix) {
            if (modo === 'fijo') {
                btnFix.textContent = '📌';
                btnFix.title = 'Desfijar (sidebar se colapsa al salir el mouse)';
                btnFix.classList.add('activo');      // 🆕
            } else {
                btnFix.textContent = '📍';
                btnFix.title = 'Fijar sidebar expandido';
                btnFix.classList.remove('activo');   // 🆕
            }
        }
    }
    
    if (btnFix && !btnFix._listenerAttached) {
        btnFix._listenerAttached = true;
        btnFix.addEventListener('click', (e) => {
            e.stopPropagation();
            const esFijo = sidebarEl.classList.contains('modo-fijo');
            const nuevoModo = esFijo ? 'auto' : 'fijo';

            aplicarModo(nuevoModo);
            localStorage.setItem('pos_sidebar_modo', nuevoModo);

            if (typeof toast === 'function') {
                toast(
                    nuevoModo === 'fijo' ? '📌 Sidebar fijado' : '📍 Sidebar en modo auto',
                    'success'
                );
            }
        });
    }

    if (btnMenu && overlay) {
        btnMenu.addEventListener('click', (e) => {
            e.stopPropagation();
            sidebarEl.classList.toggle('active');
            overlay.classList.toggle('active');
        });

        overlay.addEventListener('click', () => {
            sidebarEl.classList.remove('active');
            overlay.classList.remove('active');
        });
    }

    if (!sidebarEl._navAttached) {
        sidebarEl._navAttached = true;

        sidebarEl.addEventListener('click', (e) => {
            const trigger = e.target.closest('.has-submenu > button');
            if (trigger) {
                e.preventDefault();
                const parent = trigger.parentElement;
                const abrir = !parent.classList.contains('open');

                sidebarEl.querySelectorAll('.has-submenu').forEach(li => {
                    if (li !== parent) {
                        li.classList.remove('open');
                        li.querySelector(':scope > button')?.setAttribute('aria-expanded', 'false');
                    }
                });

                parent.classList.toggle('open', abrir);
                trigger.setAttribute('aria-expanded', String(abrir));
                return;
            }

            const navItem = e.target.closest('[data-vista]');
            if (!navItem) return;

            e.preventDefault();
            cargarVista(navItem.dataset.vista);

            sidebarEl.classList.remove('active');
            overlay?.classList.remove('active');
        });
    }

    // ============================================================
    // SIDEBAR MÓVIL: tap para expandir/colapsar
    // ============================================================
    const isMobile = () => window.matchMedia('(max-width: 900px)').matches;

    if (!sidebarEl._tapAttached) {
        sidebarEl._tapAttached = true;

        sidebarEl.addEventListener('touchstart', (e) => {
            if (!isMobile()) return;
            const target = e.target.closest('button, a');
            if (!sidebarEl.classList.contains('expandido')) {
                sidebarEl.classList.add('expandido');
                e.preventDefault();
            }
        }, { passive: false });

        document.addEventListener('touchstart', (e) => {
            if (!isMobile()) return;
            if (!sidebarEl.contains(e.target) && sidebarEl.classList.contains('expandido')) {
                sidebarEl.classList.remove('expandido');
            }
        }, { passive: true });

        document.addEventListener('click', (e) => {
            if (!isMobile()) return;
            if (!sidebarEl.contains(e.target) && sidebarEl.classList.contains('expandido')) {
                sidebarEl.classList.remove('expandido');
            }
        });
    }

    // Limpiar estado al cambiar de breakpoint
    let _lastIsMobile = window.matchMedia('(max-width: 900px)').matches;
    window.addEventListener('resize', () => {
        const isMobile = window.matchMedia('(max-width: 900px)').matches;
        if (isMobile !== _lastIsMobile) {
            sidebarEl.classList.remove('active', 'expandido');
            document.getElementById('overlay')?.classList.remove('active');
            _lastIsMobile = isMobile;
        }
    });
   
}

function resaltarMenuActivo(idVista) {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;

    sidebar.querySelectorAll('[data-vista]').forEach(el => {
        el.classList.remove('active');
    });
    sidebar.querySelectorAll('.has-submenu').forEach(li => {
        li.classList.remove('has-active-child');
    });

    const itemActivo = sidebar.querySelector(`[data-vista="${idVista}"]`);
    if (!itemActivo) return;

    itemActivo.classList.add('active');

    const submenu = itemActivo.closest('.submenu');
    if (submenu) {
        const padre = submenu.closest('.has-submenu');
        if (padre) {
            padre.classList.add('has-active-child');
            padre.classList.add('open');
            padre.querySelector(':scope > button')?.setAttribute('aria-expanded', 'true');
        }
    }
}

/* ============================================================
   19. RELOJ Y CONEXIÓN
   ============================================================ */

function iniciarReloj() {
    const reloj = document.getElementById('relojHeader');
    if (!reloj) return;

    const actualizar = () => {
        const ahora = new Date();
        let h = ahora.getHours();
        const m = ahora.getMinutes().toString().padStart(2, '0');
        const ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12 || 12;
        reloj.textContent = `🕐 ${h.toString().padStart(2, '0')}:${m} ${ampm}`;
    };

    actualizar();
    setInterval(actualizar, 10000);
}

function actualizarEstadoConexion() {
    const el = document.getElementById('estadoConexion');
    if (!el) return;

    const actualizar = () => {
        const online = navigator.onLine;
        el.textContent = online ? '🟢 Conectado' : '🔴 Sin conexión';
        el.classList.toggle('online', online);
        el.classList.toggle('offline', !online);
    };

    actualizar();
    window.addEventListener('online', actualizar);
    window.addEventListener('offline', actualizar);
}

/* ============================================================
   20. SPLITTER
   ============================================================ */

function initSplitter() {
    const root = document.getElementById('splitRoot');
    const left = document.getElementById('productos');
    const right = document.getElementById('contenedor-ventas');
    const divider = document.querySelector('.split-divider');
    if (!root || !left || !right || !divider) return;

    function getConfig() {
        const w = window.innerWidth;
        if (w < 768) return { activo: false, modo: 'movil' };
        if (w < 1024) return {
            activo: true, modo: 'tablet',
            MIN_LEFT: 300, MIN_RIGHT: 300,
            MAX_LEFT_RATIO: 0.70, MIN_LEFT_RATIO: 0.30,
            DEFAULT_RATIO: 0.55
        };
        return {
            activo: true, modo: 'desktop',
            MIN_LEFT: 400, MIN_RIGHT: 380,
            MAX_LEFT_RATIO: 0.65, MIN_LEFT_RATIO: 0.35,
            DEFAULT_RATIO: 0.55
        };
    }

    let config = getConfig();

    function getTotal() {
        return Math.max(0, root.clientWidth - divider.offsetWidth);
    }

    function clampLeft(w, total) {
        const { MIN_LEFT, MIN_RIGHT, MAX_LEFT_RATIO, MIN_LEFT_RATIO } = config;
        const minLeft = Math.max(MIN_LEFT, total * MIN_LEFT_RATIO);
        const maxLeft = Math.min(total * MAX_LEFT_RATIO, total - MIN_RIGHT);

        if (minLeft > maxLeft) return Math.max(MIN_LEFT, total - MIN_RIGHT);
        return Math.max(minLeft, Math.min(maxLeft, Math.round(w)));
    }

    function applyLeft(px) {
        left.style.flex = `0 0 ${px}px`;
        right.style.flex = '1 1 auto';
    }

    function applyRatio(r) {
        if (!config.activo) return;
        const total = getTotal();
        if (total <= 0) return;
        applyLeft(clampLeft(r * total, total));
    }

    let persistedRatio = config.DEFAULT_RATIO;
    try {
        const saved = localStorage.getItem(STORAGE_KEYS.SPLIT_RATIO);
        if (saved) {
            const r = parseFloat(saved);
            if (!isNaN(r) && r > 0 && r < 1) persistedRatio = r;
        }
    } catch {}

    requestAnimationFrame(() => applyRatio(persistedRatio));

    let dragging = false, startX = 0, startLeft = 0;

    function onMove(e) {
        if (!dragging) return;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const dx = clientX - startX;
        const total = getTotal();
        applyLeft(clampLeft(startLeft + dx, total));
    }

    function endDrag() {
        if (!dragging) return;
        dragging = false;
        document.body.classList.remove('split-dragging');
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', endDrag);
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('touchend', endDrag);

        const total = getTotal();
        const leftWidth = left.getBoundingClientRect().width;
        const newRatio = total > 0 ? leftWidth / total : config.DEFAULT_RATIO;
        localStorage.setItem(STORAGE_KEYS.SPLIT_RATIO, newRatio.toFixed(3));
    }

    divider.addEventListener('mousedown', (e) => {
        if (!config.activo) return;
        e.preventDefault();
        dragging = true;
        startX = e.clientX;
        startLeft = left.getBoundingClientRect().width;
        document.body.classList.add('split-dragging');
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', endDrag);
    });

    divider.addEventListener('touchstart', (e) => {
        if (!config.activo) return;
        const t = e.touches[0];
        if (!t) return;
        dragging = true;
        startX = t.clientX;
        startLeft = left.getBoundingClientRect().width;
        document.body.classList.add('split-dragging');
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('touchend', endDrag);
    }, { passive: true });

    divider.addEventListener('dblclick', () => {
        if (!config.activo) return;
        localStorage.removeItem(STORAGE_KEYS.SPLIT_RATIO);
        persistedRatio = config.DEFAULT_RATIO;
        applyRatio(persistedRatio);
    });

    let resizeTimeout;
    window.addEventListener('resize', () => {
        if (dragging) return;
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            const nuevaConfig = getConfig();
            if (nuevaConfig.modo !== config.modo) {
                config = nuevaConfig;
                left.style.flex = '';
                right.style.flex = '';
                if (config.activo) {
                    requestAnimationFrame(() => applyRatio(persistedRatio));
                }
            } else {
                config = nuevaConfig;
                if (config.activo) {
                    const total = getTotal();
                    const leftWidth = left.getBoundingClientRect().width;
                    applyLeft(clampLeft(leftWidth, total));
                }
            }
        }, 150);

         const fab = document.getElementById('cartFab');
            const drawer = document.querySelector('.cart-drawer');
            const backdrop = document.querySelector('.cart-drawer-backdrop');
            const esDesktop = window.innerWidth > 900 && !document.documentElement.classList.contains('split-catalogo-full');

            if (fab) {
                fab.style.display = esDesktop ? 'none' : 'flex';
            }

            // Cerrar el drawer si pasamos a desktop
            if (esDesktop) {
                drawer?.classList.remove('open');
                backdrop?.classList.remove('visible');
            }

            // Cerrar el drawer y el FAB al cambiar de tamaño
            window.addEventListener('resize', () => {
                const esDesktop = window.innerWidth > 900;

                if (esDesktop) {
                    // Ocultar FAB
                    const fab = document.getElementById('cartFab');
                    if (fab) fab.style.display = 'none';

                    // Cerrar cualquier drawer abierto
                    document.querySelector('.cart-drawer')?.classList.remove('open');
                    document.querySelector('.cart-drawer-backdrop')?.classList.remove('visible');

                    // Cerrar carritos con .visible
                    document.querySelectorAll('.carrito.visible').forEach(c => c.classList.remove('visible'));
                }
            });
    });
}

/* ============================================================
   21. DRAWER DEL CARRITO (MÓVIL)
   ============================================================ */

function setupCartDrawer() {
    const fab = document.getElementById('cartFab');
    const drawer = document.getElementById('cartDrawer');
    const backdrop = document.getElementById('cartDrawerBackdrop');
    const cerrarBtn = document.getElementById('cerrarCartDrawer');
    const drawerBody = document.getElementById('cartDrawerBody');
    const contenedorOriginal = document.getElementById('contenedor-ventas');

    if (!fab || !drawer || !backdrop || !drawerBody || !contenedorOriginal) {
        console.warn('⚠️ Drawer del carrito: faltan elementos en el DOM');
        return;
    }

    const ventaOriginalPadre = new WeakMap();

    function abrirDrawer() {
        const ventaId = estado.pestañaActiva || 'venta1';
        const ventaEl = document.getElementById(ventaId);

        if (!ventaEl) {
            toast('No hay carrito activo', 'error');
            return;
        }

        if (!ventaOriginalPadre.has(ventaEl)) {
            ventaOriginalPadre.set(ventaEl, ventaEl.parentElement);
        }

        drawerBody.appendChild(ventaEl);
        ventaEl.classList.add('active');
        ventaEl.style.display = 'block';

        drawer.classList.add('open');
        backdrop.classList.add('visible');
        document.body.style.overflow = 'hidden';

        if (typeof renderCarrito === 'function') {
            renderCarrito(ventaId);
        }
    }

    function cerrarDrawer() {
        drawerBody.querySelectorAll('.venta').forEach(ventaEl => {
            const padreOriginal = ventaOriginalPadre.get(ventaEl);
            if (padreOriginal) {
                padreOriginal.appendChild(ventaEl);
            }
            ventaEl.style.display = '';
        });

        drawer.classList.remove('open');
        backdrop.classList.remove('visible');
        document.body.style.overflow = '';
    }

    if (!fab._drawerAttached) {
        fab._drawerAttached = true;
        fab.addEventListener('click', abrirDrawer);
    }

    if (cerrarBtn && !cerrarBtn._drawerAttached) {
        cerrarBtn._drawerAttached = true;
        cerrarBtn.addEventListener('click', cerrarDrawer);
    }

    if (backdrop && !backdrop._drawerAttached) {
        backdrop._drawerAttached = true;
        backdrop.addEventListener('click', cerrarDrawer);
    }

    if (!document._drawerEscAttached) {
        document._drawerEscAttached = true;
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && drawer.classList.contains('open')) {
                cerrarDrawer();
            }
        });
    }

    window.addEventListener('resize', () => {
        if (window.innerWidth >= 768 && drawer.classList.contains('open')) {
            cerrarDrawer();
        }
    });
}

/* ============================================================
   22. FAB ARRASTRABLE
   ============================================================ */

function makeDraggable(buttonId, storageKey) {
    const btn = document.getElementById(buttonId);
    if (!btn) return;

    let isDragging = false, offsetX = 0, offsetY = 0;

    const saved = localStorage.getItem(storageKey);
    if (saved) {
        try {
            const { x, y } = JSON.parse(saved);
            btn.style.left = `${x}px`;
            btn.style.top = `${y}px`;
            btn.style.right = 'auto';
            btn.style.bottom = 'auto';
        } catch {}
    }

    btn.addEventListener('mousedown', e => {
        isDragging = true;
        offsetX = e.clientX - btn.getBoundingClientRect().left;
        offsetY = e.clientY - btn.getBoundingClientRect().top;
    });

    document.addEventListener('mousemove', e => {
        if (!isDragging) return;
        let x = e.clientX - offsetX;
        let y = e.clientY - offsetY;
        const maxX = window.innerWidth - btn.offsetWidth;
        const maxY = window.innerHeight - btn.offsetHeight;
        x = Math.max(0, Math.min(x, maxX));
        y = Math.max(0, Math.min(y, maxY));
        btn.style.left = `${x}px`;
        btn.style.top = `${y}px`;
        btn.style.right = 'auto';
        btn.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            localStorage.setItem(storageKey, JSON.stringify({
                x: btn.offsetLeft,
                y: btn.offsetTop
            }));
        }
    });

    window.addEventListener('resize', () => {
        btn.style.left = '';
        btn.style.top = '';
        btn.style.right = '25px';
        btn.style.bottom = '25px';
        localStorage.removeItem(storageKey);
    });
}

/* ============================================================
   23. TEMA OSCURO
   ============================================================ */

function initTema() {
    const btnTema = document.getElementById('btnTema');
    const html = document.documentElement;
    const temaGuardado = localStorage.getItem(STORAGE_KEYS.THEME);

    if (temaGuardado === 'dark') {
        html.setAttribute('data-theme', 'dark');
        if (btnTema) btnTema.textContent = '☀️';
    }

    if (btnTema && !btnTema._listenerAttached) {
        btnTema._listenerAttached = true;
        btnTema.addEventListener('click', () => {
            const esOscuro = html.getAttribute('data-theme') === 'dark';
            if (esOscuro) {
                html.setAttribute('data-theme', 'light');
                btnTema.textContent = '🌙';
                localStorage.setItem(STORAGE_KEYS.THEME, 'light');
            } else {
                html.setAttribute('data-theme', 'dark');
                btnTema.textContent = '☀️';
                localStorage.setItem(STORAGE_KEYS.THEME, 'dark');
            }
        });
    }
}

/* ============================================================
   24. IMPORTACIÓN MASIVA
   ============================================================ */

let _importArchivoSeleccionado = null;
let _progressInterval = null;

function setupImportacionListeners() {
    const btnImportar = document.getElementById('btnImportarProductos');
    const modal = document.getElementById('modalImportar');
    const cerrar = document.getElementById('cerrarModalImportar');
    const btnCancelar = document.getElementById('btnCancelarImportar');
    const btnVolver = document.getElementById('btnVolverImportar');
    const btnCerrar = document.getElementById('btnCerrarImportar');
    const inputArchivo = document.getElementById('importArchivo');
    const btnPreview = document.getElementById('btnPreviewImportar');
    const btnConfirmar = document.getElementById('btnConfirmarImportar');
    const btnPlantilla = document.getElementById('btnDescargarPlantilla');

    if (!btnImportar || !modal) return;

    if (!btnImportar._importAttached) {
        btnImportar._importAttached = true;
        btnImportar.addEventListener('click', () => {
            resetearImportModal();
            showModal(modal);
        });
    }

    [cerrar, btnCancelar, btnCerrar].forEach(btn => {
        if (btn && !btn._importAttached) {
            btn._importAttached = true;
            btn.addEventListener('click', () => hideModal(modal));
        }
    });

    if (btnVolver && !btnVolver._importAttached) {
        btnVolver._importAttached = true;
        btnVolver.addEventListener('click', () => {
            document.getElementById('importPaso1').style.display = 'block';
            document.getElementById('importPaso2').style.display = 'none';
            document.getElementById('importPaso3').style.display = 'none';
        });
    }

    if (inputArchivo && !inputArchivo._importAttached) {
        inputArchivo._importAttached = true;
        inputArchivo.addEventListener('change', (e) => {
            const file = e.target.files[0];
            _importArchivoSeleccionado = file || null;

            const nombreEl = document.getElementById('importNombreArchivo');
            if (file) {
                nombreEl.textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
                btnPreview.disabled = false;
            } else {
                nombreEl.textContent = 'Sin archivo seleccionado';
                btnPreview.disabled = true;
            }
        });
    }

    if (btnPlantilla && !btnPlantilla._importAttached) {
        btnPlantilla._importAttached = true;
        btnPlantilla.addEventListener('click', async (e) => {
            e.preventDefault();
            try {
                const token = localStorage.getItem('pos_token');
                const resp = await fetch(`${API_BASE_URL}/Importacion/productos/plantilla`, {
                    headers: { 'Authorization': 'Bearer ' + token }
                });

                if (!resp.ok) {
                    toast('Error al descargar la plantilla', 'error');
                    return;
                }

                const blob = await resp.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'plantilla-productos.xlsx';
                a.click();
                URL.revokeObjectURL(url);
                toast('✅ Plantilla descargada');
            } catch (err) {
                console.error(err);
                toast('Error al descargar la plantilla', 'error');
            }
        });
    }

    if (btnPreview && !btnPreview._importAttached) {
        btnPreview._importAttached = true;
        btnPreview.addEventListener('click', previsualizarImportacion);
    }

    if (btnConfirmar && !btnConfirmar._importAttached) {
        btnConfirmar._importAttached = true;
        btnConfirmar.addEventListener('click', confirmarImportacion);
    }
}

function resetearImportModal() {
    _importArchivoSeleccionado = null;
    document.getElementById('importPaso1').style.display = 'block';
    document.getElementById('importPaso2').style.display = 'none';
    document.getElementById('importPaso3').style.display = 'none';
    document.getElementById('importNombreArchivo').textContent = 'Sin archivo seleccionado';
    document.getElementById('importArchivo').value = '';
    document.getElementById('btnPreviewImportar').disabled = true;
}

async function previsualizarImportacion() {
    if (!_importArchivoSeleccionado) {
        toast('Selecciona un archivo primero', 'error');
        return;
    }

    const btn = document.getElementById('btnPreviewImportar');
    const textoOriginal = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ Analizando...';

    mostrarProgreso('📤 Preparando análisis...', 0, `${_importArchivoSeleccionado.name}`);

    try {
        const formData = new FormData();
        formData.append('archivo', _importArchivoSeleccionado);

        await new Promise(r => setTimeout(r, 150));
        actualizarProgreso(20, '📖 Leyendo Excel...', '');

        const token = localStorage.getItem('pos_token');
        const resp = await fetch(`${API_BASE_URL}/Importacion/productos/preview`, {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token },
            body: formData
        });

        if (!resp.ok) {
            ocultarProgreso();
            const err = await resp.json().catch(() => ({}));
            toast(err.message || 'Error al procesar el archivo', 'error');
            return;
        }

        actualizarProgreso(80, '🔍 Validando filas...', '');

        const data = await resp.json();

        actualizarProgreso(100, '✅ Análisis completado', `${data.totalFilas} filas procesadas`);
        await new Promise(r => setTimeout(r, 400));
        ocultarProgreso();

        renderizarPreviewImportacion(data);

        document.getElementById('importPaso1').style.display = 'none';
        document.getElementById('importPaso2').style.display = 'block';

    } catch (err) {
        console.error(err);
        ocultarProgreso();
        toast('Error al procesar el archivo', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = textoOriginal;
    }
}

function renderizarPreviewImportacion(data) {
    const resumen = document.getElementById('importResumen');
    const ok = (data.resumen.nuevos || 0) + (data.resumen.actualizables || 0);

    resumen.innerHTML = `
        <div class="resumen-grid" style="grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px;">
            <div class="card-resumen azul"><h4>Total</h4><p>${data.totalFilas}</p></div>
            <div class="card-resumen verde"><h4>Válidas</h4><p>${ok}</p></div>
            <div class="card-resumen celeste"><h4>Nuevas</h4><p>${data.resumen.nuevos}</p></div>
            <div class="card-resumen gris"><h4>Actualizar</h4><p>${data.resumen.actualizables}</p></div>
            <div class="card-resumen" style="background: linear-gradient(135deg, #dc2626, #991b1b);"><h4>Errores</h4><p>${data.resumen.errores}</p></div>
        </div>
    `;

    const cont = document.getElementById('importTablaPreview');

    const filasHtml = (data.filas || []).map(f => {
        const estado = f.esValida
            ? (f.existeEnBd
                ? '<span style="color:#f59e0b; font-weight:600;">🔄 Actualizar</span>'
                : '<span style="color:#16a34a; font-weight:600;">➕ Crear</span>')
            : '<span style="color:#dc2626; font-weight:600;">❌ Error</span>';

        const erroresTexto = (f.errores && f.errores.length > 0)
            ? `<div style="font-size: 10px; color: #dc2626; margin-top: 2px;">${f.errores.join(' • ')}</div>`
            : '';

        const estiloFila = f.esValida ? '' : 'background: rgba(220,38,38,0.08);';

        return `
            <tr style="${estiloFila}">
                <td style="text-align:center;">${f.fila}</td>
                <td>${escapeHtml(f.codigoInterno || '')}${erroresTexto}</td>
                <td>${escapeHtml(f.nombre || '')}</td>
                <td>${escapeHtml(f.categoria || '-')}</td>
                <td style="text-align:right;">${formato(f.precioVenta)}</td>
                <td style="text-align:center;">${f.stockActual}</td>
                <td style="text-align:center;">${estado}</td>
            </tr>
        `;
    }).join('');

    cont.innerHTML = `
        <table class="tabla-carrito" style="font-size: 12px; margin: 0; width: 100%;">
            <thead style="position: sticky; top: 0; background: var(--bg-panel); z-index: 1;">
                <tr>
                    <th style="width: 50px;">Fila</th>
                    <th>Código</th>
                    <th>Nombre</th>
                    <th>Categoría</th>
                    <th style="text-align:right;">Precio</th>
                    <th style="text-align:center; width: 70px;">Stock</th>
                    <th style="text-align:center; width: 100px;">Estado</th>
                </tr>
            </thead>
            <tbody>${filasHtml}</tbody>
        </table>
    `;

    const btnConfirmar = document.getElementById('btnConfirmarImportar');
    if (btnConfirmar) {
        if (ok === 0) {
            btnConfirmar.disabled = true;
            btnConfirmar.textContent = '⛔ No hay filas válidas';
        } else {
            btnConfirmar.disabled = false;
            btnConfirmar.textContent = `✅ Confirmar importación (${ok})`;
        }
    }
}

async function confirmarImportacion() {
    if (!_importArchivoSeleccionado) {
        toast('No hay archivo seleccionado', 'error');
        return;
    }

    const modoInput = document.querySelector('input[name="importModo"]:checked');
    const modo = modoInput ? modoInput.value : 'ambos';

    if (!confirm(`¿Confirmas la importación en modo "${modo}"?\n\nEsta acción modificará la base de datos.`)) {
        return;
    }

    const btn = document.getElementById('btnConfirmarImportar');
    const textoOriginal = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ Importando...';

    mostrarProgreso('💾 Preparando importación...', 0, 'No cierres esta ventana');

    try {
        const formData = new FormData();
        formData.append('archivo', _importArchivoSeleccionado);
        formData.append('modo', modo);

        const token = localStorage.getItem('pos_token');

        const resp = await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', `${API_BASE_URL}/Importacion/productos/confirmar`);

            xhr.upload.onload = () => {
                mostrarProgreso('⚙️ Procesando en el servidor...', null,
                    'Esto puede tardar 1-5 minutos según el tamaño del archivo');
            };

            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve({
                        ok: true,
                        status: xhr.status,
                        json: () => Promise.resolve(JSON.parse(xhr.responseText))
                    });
                } else {
                    resolve({
                        ok: false,
                        status: xhr.status,
                        json: () => Promise.resolve(JSON.parse(xhr.responseText || '{}'))
                    });
                }
            };

            xhr.onerror = () => reject(new Error('Error de red'));

            xhr.setRequestHeader('Authorization', 'Bearer ' + token);
            xhr.send(formData);
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            ocultarProgreso();
            toast(err.message || 'Error al importar', 'error');
            btn.disabled = false;
            btn.textContent = textoOriginal;
            return;
        }

        actualizarProgreso(100, '✅ Importación completada', '');

        const data = await resp.json();

        await new Promise(r => setTimeout(r, 600));
        ocultarProgreso();

        renderizarResultadoImportacion(data);

        document.getElementById('importPaso2').style.display = 'none';
        document.getElementById('importPaso3').style.display = 'block';

        if (typeof initInventario === 'function') await initInventario();
        if (typeof cargarProductosDesdeAPI === 'function') await cargarProductosDesdeAPI();

    } catch (err) {
        console.error(err);
        ocultarProgreso();
        toast('Error al importar el archivo', 'error');
        btn.disabled = false;
        btn.textContent = textoOriginal;
    }
}

function renderizarResultadoImportacion(data) {
    const cont = document.getElementById('importResultado');
    const exitosos = (data.creados || 0) + (data.actualizados || 0);

    let erroresHtml = '';
    if (data.detalleErrores && data.detalleErrores.length > 0) {
        erroresHtml = `
            <details style="margin-top: 16px; background: rgba(220,38,38,0.08); padding: 12px; border-radius: 8px;">
                <summary style="cursor: pointer; font-weight: 600; color: #dc2626;">
                    ⚠️ Ver detalle de ${data.detalleErrores.length} error(es)
                </summary>
                <ul style="margin: 8px 0 0 20px; font-size: 12px; color: #64748b;">
                    ${data.detalleErrores.map(e => `
                        <li>Fila ${e.fila} (${escapeHtml(e.codigoInterno || '')}): ${escapeHtml(e.error || 'Error desconocido')}</li>
                    `).join('')}
                </ul>
            </details>
        `;
    }

    cont.innerHTML = `
        <div style="text-align: center; padding: 20px 0;">
            <div style="font-size: 48px; margin-bottom: 12px;">${exitosos > 0 ? '✅' : '⚠️'}</div>
            <h3 style="margin: 0 0 8px;">${exitosos > 0 ? '¡Importación completada!' : 'No se importó nada'}</h3>
            <p style="color: #64748b; font-size: 13px; margin: 0;">
                Se procesaron ${data.total || 0} fila(s) del archivo.
            </p>
        </div>

        <div class="resumen-grid" style="grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; margin-top: 16px;">
            <div class="card-resumen verde"><h4>Creados</h4><p>${data.creados || 0}</p></div>
            <div class="card-resumen celeste"><h4>Actualizados</h4><p>${data.actualizados || 0}</p></div>
            <div class="card-resumen" style="background: linear-gradient(135deg, #dc2626, #991b1b);"><h4>Errores</h4><p>${data.errores || 0}</p></div>
        </div>

        ${erroresHtml}
    `;
}

function mostrarProgreso(texto = 'Procesando...', porcentaje = null, detalle = '') {
    const cont = document.getElementById('importBarraProgreso');
    const fill = document.getElementById('importBarraFill');
    const textEl = document.getElementById('importProgresoTexto');
    const pctEl = document.getElementById('importProgresoPorcentaje');
    const detEl = document.getElementById('importProgresoDetalle');

    if (!cont || !fill) return;

    cont.style.display = 'block';
    textEl.textContent = texto;
    detEl.textContent = detalle;

    if (_progressInterval) {
        clearInterval(_progressInterval);
        _progressInterval = null;
    }

    if (porcentaje === null || porcentaje === undefined) {
        pctEl.textContent = '';
        fill.style.width = '0%';

        let fakeProgress = 0;
        _progressInterval = setInterval(() => {
            const incremento = fakeProgress < 50 ? 3 : fakeProgress < 80 ? 1 : 0.3;
            fakeProgress = Math.min(90, fakeProgress + incremento);
            fill.style.width = fakeProgress + '%';
        }, 200);
    } else {
        const pct = Math.max(0, Math.min(100, porcentaje));
        pctEl.textContent = pct + '%';
        fill.style.width = pct + '%';
        fill.style.transition = 'width 0.3s ease';
    }
}

function actualizarProgreso(porcentaje, texto = null, detalle = null) {
    const fill = document.getElementById('importBarraFill');
    const pctEl = document.getElementById('importProgresoPorcentaje');
    const textEl = document.getElementById('importProgresoTexto');
    const detEl = document.getElementById('importProgresoDetalle');

    if (!fill) return;

    if (_progressInterval) {
        clearInterval(_progressInterval);
        _progressInterval = null;
    }

    const pct = Math.max(0, Math.min(100, porcentaje));
    pctEl.textContent = pct + '%';
    fill.style.width = pct + '%';

    if (texto !== null) textEl.textContent = texto;
    if (detalle !== null) detEl.textContent = detalle;
}

function ocultarProgreso() {
    const cont = document.getElementById('importBarraProgreso');
    const fill = document.getElementById('importBarraFill');

    if (_progressInterval) {
        clearInterval(_progressInterval);
        _progressInterval = null;
    }

    if (cont) cont.style.display = 'none';
    if (fill) fill.style.width = '0%';
}
/* ============================================================
   CALLBACK del escáner cuando se dispara desde el catálogo
   (después de escribir un código y presionar Enter)
   ============================================================ */
async function onScanCatalogo(codigo, encontrados, input) {
    console.log('🔫 Código escaneado:', codigo, '| Resultados:', encontrados?.length || 0);

    if (!codigo) return;

    // Si hay resultados del buscador, usar el primero
    if (encontrados && encontrados.length > 0) {
        const item = encontrados[0];
        const elemento = item._el;

        if (elemento) {
            const btnAgregar = elemento.querySelector('.agregar');
            if (btnAgregar && !btnAgregar.disabled) {
                btnAgregar.click();
                toast(`✅ "${item.nombre}" agregado al carrito`);
                return;
            } else {
                toast(`"${item.nombre}" sin stock o no disponible`, 'error');
                return;
            }
        }
    }

    // Si no hay resultados locales, delegar a manejarEscaneo (busca en IndexedDB/servidor)
    await manejarEscaneo(codigo);

    // Limpiar input
    if (input) {
        input.value = '';
        if (typeof filtrarCatalogo === 'function') filtrarCatalogo('');
    }
}
function mostrarBotonCarritoSiAplica(vistaId) {
    const existente = document.getElementById('cartFab');
    const esDesktop = window.innerWidth > 900 && !document.documentElement.classList.contains('split-catalogo-full');

    // 🆕 En desktop, SIEMPRE ocultar el FAB
    if (esDesktop) {
        if (existente) existente.style.display = 'none';
        return;
    }

    // 🆕 En otras vistas, quitar el FAB
    if (vistaId !== 'ventas') {
        if (existente) existente.remove();
        return;
    }

    // Móvil: crear o mostrar el FAB
    if (!existente) {
        const btn = document.createElement('button');
        btn.id = 'cartFab';
        btn.innerHTML = '🛒';
        btn.title = 'Ver carrito';
        btn.style.position = 'fixed';
        btn.style.right = '25px';
        btn.style.bottom = '25px';
        btn.style.zIndex = 9999;
        btn.style.display = 'flex';
        btn.style.alignItems = 'center';
        btn.style.justifyContent = 'center';
        document.body.appendChild(btn);
        conectarFabCarrito();
    } else {
        existente.style.display = 'flex';
    }
}

function conectarFabCarrito() {
    const cartFabEl = document.getElementById('cartFab');
    if (!cartFabEl || cartFabEl._listenerAttached) return;

    cartFabEl._listenerAttached = true;

    cartFabEl.addEventListener('click', () => {
        // Verificar si estamos en móvil
        const esMobile = window.innerWidth <= 900 
                      || document.documentElement.classList.contains('split-catalogo-full');

        if (esMobile) {
            // Móvil: abrir el drawer
            if (typeof openDrawer === 'function') {
                openDrawer();
            } else {
                // Fallback: mostrar el carrito con la clase .visible
                const ventaId = estado?.pestañaActiva || 'venta1';
                const ventaDiv = document.getElementById(ventaId);
                const carrito = ventaDiv?.querySelector('.carrito');
                if (carrito) carrito.classList.toggle('visible');
            }
        } else {
            // Desktop: NO hacer nada (el FAB ni se ve)
            console.log('ℹ️ FAB clickeado en desktop — ignorado');
        }
    });
}

function openDrawer() {
    let drawer = document.querySelector('.cart-drawer');
    let backdrop = document.querySelector('.cart-drawer-backdrop');

    if (!drawer) {
        drawer = document.createElement('aside');
        drawer.className = 'cart-drawer';
        drawer.innerHTML = `
            <div class="drawer-header">
                <span>🛒 Carrito</span>
                <button class="drawer-close">✕</button>
            </div>
            <div class="drawer-body"></div>
        `;
        document.body.appendChild(drawer);
        drawer.querySelector('.drawer-close').onclick = closeDrawer;
    }

    if (!backdrop) {
        backdrop = document.createElement('div');
        backdrop.className = 'cart-drawer-backdrop';
        backdrop.onclick = closeDrawer;
        document.body.appendChild(backdrop);
    }

    const ventaId = estado?.pestañaActiva || 'venta1';
    const ventaDiv = document.getElementById(ventaId);
    const carrito = ventaDiv?.querySelector('.carrito');
    const drawerBody = drawer.querySelector('.drawer-body');

    if (carrito && drawerBody) {
        // Guardar el padre original
        carrito._padreOriginal = carrito.parentElement;
        carrito._siguienteHermano = carrito.nextElementSibling;
        
        // Forzar visibilidad total
        carrito.style.cssText = `
            display: flex !important;
            flex-direction: column !important;
            visibility: visible !important;
            opacity: 1 !important;
            position: static !important;
            width: 100% !important;
            background: #1e293b !important;
            border-radius: 10px !important;
            padding: 14px !important;
            box-sizing: border-box !important;
        `;

        // MOVER al drawer
        drawerBody.innerHTML = '';
        drawerBody.appendChild(carrito);
        
        console.log('✅ Carrito MOVIDO al drawer');
    }

    drawer.classList.add('open');
    backdrop.classList.add('visible');
}

function closeDrawer() {
    const drawer = document.querySelector('.cart-drawer');
    const carrito = drawer?.querySelector('.carrito');

    // Devolver el carrito a su padre original
    if (carrito && carrito._padreOriginal) {
        if (carrito._siguienteHermano) {
            carrito._padreOriginal.insertBefore(carrito, carrito._siguienteHermano);
        } else {
            carrito._padreOriginal.appendChild(carrito);
        }
        
        // Resetear estilos
        carrito.style.cssText = '';
    }

    drawer?.classList.remove('open');
    document.querySelector('.cart-drawer-backdrop')?.classList.remove('visible');
}

// ============================================================
// CATÁLOGO DE ACCESOS RÁPIDOS DISPONIBLES
// ============================================================
const CATALOGO_ACCESOS = {
    // Vistas de Ventas
    ventas: {
        emoji: '🆕',
        label: 'Nueva Venta',
        roles: [1, 2]   // admin y cajero
    },
    historial: {
        emoji: '🕐',
        label: 'Historial',
        roles: [1, 2]
    },

    // Vistas de Inventario (solo admin)
    inventario: {
        emoji: '📦',
        label: 'Inventario',
        roles: [1]
    },
    categorias: {
        emoji: '🏷️',
        label: 'Categorías',
        roles: [1]
    },

    // Vistas de Clientes
    clientes: {
        emoji: '👥',
        label: 'Clientes',
        roles: [1, 2]
    },

    // Vistas administrativas (solo admin)
    inicio: {
        emoji: '📊',
        label: 'Dashboard',
        roles: [1]
    },
    usuarios: {
        emoji: '👤',
        label: 'Usuarios',
        roles: [1]
    },
    reportes: {
        emoji: '📈',
        label: 'Reportes',
        roles: [1]
    }
};

// Accesos por defecto (si el usuario no tiene historial)
const ACCESOS_DEFAULT = ['ventas', 'historial', 'inventario'];

// ============================================================
// RENDERIZAR ACCESOS RÁPIDOS DINÁMICAMENTE
// ============================================================
function renderAccesosRapidos() {
    const contenedor = document.querySelector('.sidebar-quick-actions');
    if (!contenedor) {
        // Silenciar la advertencia (no es un error, solo informativo)
        return;
    }

    // 1. Obtener el usuario y su rol
    let usuario = null;
    try {
        usuario = JSON.parse(localStorage.getItem('pos_usuario'));
    } catch (e) { /* ignorar */ }

    const idRol = usuario ? parseInt(usuario.rol || usuario.idRol || 1, 10) : 1;

    // 2. Obtener las top 3 vistas del usuario
    let topVistas = obtenerTopVistas(3);

    // 3. Si no hay historial, usar las vistas por defecto
    if (topVistas.length === 0) {
        topVistas = [...ACCESOS_DEFAULT];
    }

    // 4. Filtrar por rol y por catálogo
    const accesosValidos = topVistas
        .filter(vistaId => {
            const acceso = CATALOGO_ACCESOS[vistaId];
            return acceso && acceso.roles.includes(idRol);
        })
        .slice(0, 3);

    // 5. Si quedan menos de 3, completar con las por defecto
    if (accesosValidos.length < 3) {
        for (const vistaId of ACCESOS_DEFAULT) {
            if (accesosValidos.length >= 3) break;
            const acceso = CATALOGO_ACCESOS[vistaId];
            if (acceso && acceso.roles.includes(idRol) && !accesosValidos.includes(vistaId)) {
                accesosValidos.push(vistaId);
            }
        }
    }

    // 6. Renderizar los botones
    contenedor.innerHTML = accesosValidos.map(vistaId => {
        const acc = CATALOGO_ACCESOS[vistaId];
        return `
            <button class="quick-action" 
                    title="${escapeHtml(acc.label)}" 
                    data-vista="${vistaId}">
                ${acc.emoji} <span class="quick-label">${escapeHtml(acc.label)}</span>
            </button>
        `;
    }).join('');

    // 7. Agregar listeners de click
    contenedor.querySelectorAll('.quick-action').forEach(btn => {
        btn.addEventListener('click', () => {
            const vista = btn.dataset.vista;
            if (vista) {
                cargarVista(vista);

                // Actualizar el estado activo del menú
                document.querySelectorAll('.sidebar [data-vista]').forEach(b => b.classList.remove('active'));
                document.querySelector(`.sidebar [data-vista="${vista}"]`)?.classList.add('active');
            }
        });
    });

    console.log(`⚡ Accesos rápidos renderizados: ${accesosValidos.join(', ')}`);
}

/* ============================================================
   AUTO-REFRESCO DE STOCK (v2 — con instrumentación de arrays)
   ============================================================ */
(function setupAutoRefrescoStock() {
    if (typeof Proxy === 'undefined') {
        console.warn('⚠️ Proxy no soportado');
        return;
    }

    // Debounce
    let timeoutRefresco = null;
    function refrescarDebounced() {
        if (timeoutRefresco) clearTimeout(timeoutRefresco);
        timeoutRefresco = setTimeout(() => {
            if (typeof refrescarStockCatalogo === 'function') {
                refrescarStockCatalogo();
            }
        }, 30);
    }

    // 🆕 Exponer globalmente para que otros módulos la usen
    window._refrescarStockDebounced = refrescarDebounced;

    // Envolver un array de carrito con Proxy
    function envolverCarrito(arr) {
        return new Proxy(arr, {
            set(target, prop, value) {
                const result = Reflect.set(target, prop, value);
                // Si es un índice numérico (nuevo item o reemplazo)
                if (typeof prop === 'string' && /^\d+$/.test(prop)) {
                    refrescarDebounced();
                }
                // Si es un cambio en el array (length, etc)
                if (prop === 'length') {
                    refrescarDebounced();
                }
                return result;
            },
            deleteProperty(target, prop) {
                const result = Reflect.deleteProperty(target, prop);
                refrescarDebounced();
                return result;
            }
        });
    }

    // 🆕 Envolver los items (para detectar `item.cantidad += 1`)
    function envolverItem(item, carritoArray) {
        return new Proxy(item, {
            set(target, prop, value) {
                const result = Reflect.set(target, prop, value);
                // Si cambia la cantidad, refrescar
                if (prop === 'cantidad') {
                    refrescarDebounced();
                }
                return result;
            }
        });
    }

    // Envolver un array completo (cada item + el array en sí)
    function envolverCarritoCompleto(arr) {
        // Envolver cada item del array
        for (let i = 0; i < arr.length; i++) {
            arr[i] = envolverItem(arr[i]);
        }
        return envolverCarrito(arr);
    }

    // Envolver todos los carritos existentes
    Object.keys(estado.carritos).forEach(vid => {
        estado.carritos[vid] = envolverCarritoCompleto(estado.carritos[vid]);
    });

    // Envolver el objeto `carritos` para detectar nuevos carritos
    const carritosOriginal = estado.carritos;
    estado.carritos = new Proxy(carritosOriginal, {
        set(target, prop, value) {
            // Si es un array nuevo → envolverlo
            if (Array.isArray(value)) {
                value = envolverCarritoCompleto(value);
            }
            const result = Reflect.set(target, prop, value);
            refrescarDebounced();
            return result;
        },
        get(target, prop) {
            // Al leer un carrito, si no está envuelto, envolverlo
            const valor = target[prop];
            if (Array.isArray(valor) && !valor._esProxy) {
                const envuelto = envolverCarritoCompleto(valor);
                envuelto._esProxy = true;
                target[prop] = envuelto;
                return envuelto;
            }
            return valor;
        },
        deleteProperty(target, prop) {
            const result = Reflect.deleteProperty(target, prop);
            refrescarDebounced();
            return result;
        }
    });

    console.log('✅ Auto-refresco de stock v2 activado');
})();

// 🆕 Comando de diagnóstico
window._diagStock = () => {
    const cards = document.querySelectorAll('#catalogoProductos .producto');
    console.log(`📦 Tarjetas: ${cards.length}`);
    let problemas = 0;

    cards.forEach(c => {
        const sku = c.dataset.sku;
        const base = parseInt(c.dataset.stockBase || '0', 10);
        const reservado = stockReservadoEnCarritos(sku);
        const esperado = Math.max(0, base - reservado);
        const visibleTxt = c.querySelector('.prod-stock')?.textContent || '';
        const visibleMatch = visibleTxt.match(/\d+/);
        const visible = visibleMatch ? parseInt(visibleMatch[0], 10) : 0;

        const ok = esperado === visible;
        if (!ok) problemas++;

        if (reservado > 0 || !ok) {
            console.log(
                `  ${ok ? '✅' : '❌'} ${sku} | base: ${base} | reservado: ${reservado} | esperado: ${esperado} | visible: "${visibleTxt.trim()}"`
            );
        }
    });

    if (problemas === 0) {
        console.log('✅ Todo consistente');
    } else {
        console.warn(`⚠️ ${problemas} tarjetas desactualizadas`);
    }
};

window._verificarConsistenciaStock = () => {
    const cards = document.querySelectorAll('#catalogoProductos .producto');
    const problemas = [];

    cards.forEach(c => {
        const sku = c.dataset.sku;
        const base = parseInt(c.dataset.stockBase || '0', 10);
        const reservado = stockReservadoEnCarritos(sku);
        const esperado = Math.max(0, base - reservado);
        const visibleTxt = c.querySelector('.prod-stock')?.textContent || '';
        const visibleMatch = visibleTxt.match(/\d+/);
        const visible = visibleMatch ? parseInt(visibleMatch[0], 10) : 0;

        if (esperado !== visible) {
            problemas.push({ sku, base, reservado, esperado, visible });
        }
    });

    if (problemas.length === 0) {
        console.log('✅ Todo consistente. Todas las tarjetas están actualizadas.');
    } else {
        console.warn(`⚠️ ${problemas.length} tarjetas desactualizadas:`);
        console.table(problemas);
        console.log('💡 Ejecutando refrescarStockCatalogo()...');
        refrescarStockCatalogo();
    }
};
async function cargarCatalogoCompletoEnBackground() {
    // 🆕 Solo ejecutar una vez por sesión
    if (window._catalogoCompletoCargado) {
        console.log('⏭ Catálogo completo ya cargado en esta sesión');
        return;
    }

    if (typeof Catalogo === 'undefined') {
        console.warn('⚠️ Catalogo.js no está cargado');
        return;
    }

    window._catalogoCompletoCargado = true;
    console.log('📥 Iniciando carga del catálogo completo en segundo plano...');

    try {
        const todos = await Catalogo.cargarCompleto();
        if (todos && todos.length > 0) {
            console.log(`✅ Catálogo completo listo en background (${todos.length} productos)`);

            if (typeof toast === 'function') {
                toast(`📥 Catálogo completo listo (${todos.length} productos)`, 'success');
            }
        }
    } catch (err) {
        console.warn('⚠️ Error cargando catálogo en background:', err);
        window._catalogoCompletoCargado = false; // Permitir reintento
    }
}

/* ============================================================
   🆕 API PÚBLICA PARA INVALIDAR CACHÉ DEL TOP
   Útil desde otros módulos o para debug manual.
   ============================================================ */
window.invalidarCacheTop = function () {
    estado._productosCacheInvalidado = true;
    estado._ultimaCargaTop = 0;
    _controlCargaTop.ultimaCargaExitosa = 0;
    console.log('🔄 Caché del top invalidado manualmente');
};

window.recargarTop = async function () {
    window.invalidarCacheTop();
    return await cargarProductosDesdeAPI(true);
};

window.verEstadoCacheTop = function () {
    console.table({
        'Productos en memoria': estado.productos.length,
        'Cache invalidado': estado._productosCacheInvalidado,
        'Última carga': new Date(_controlCargaTop.ultimaCargaExitosa).toLocaleTimeString(),
        'Promesa en curso': _controlCargaTop.promesaEnCurso ? 'SÍ' : 'NO'
    });
};

/* ============================================================
   🆕 PANEL DE DEBUG (solo en desarrollo)
   ============================================================ */
if (location.hostname === '127.0.0.1' || location.hostname === 'localhost') {
    window.debug = {
        // Estado del caché
        cache: async () => await CatalogoDB.infoCache(),
        
        // Estado de la app
        estado: () => ({
            productos: estado.productos.length,
            carrito: estado.carritos.venta1?.length || 0,
            tabActiva: estado.pestañaActiva,
            cacheInvalidado: estado._productosCacheInvalidado
        }),
        
        // Buscar producto
        buscar: async (sku) => {
            const p = await CatalogoDB.buscarPorSku(sku);
            console.log(p || '❌ No encontrado');
            return p;
        },
        
        // Benchmarks
        bench: async () => {
            console.log('=== BENCHMARK ===');
            
            console.time('Guardar 18k');
            await CatalogoDB.guardarCompleto(await CatalogoDB.getProductos());
            console.timeEnd('Guardar 18k');
            
            console.time('Buscar x100');
            for (let i = 0; i < 100; i++) {
                await CatalogoDB.buscarPorSku('L2745');
            }
            console.timeEnd('Buscar x100');
        },
        
        // Limpiar
        limpiar: async () => {
            await CatalogoDB.limpiarCache();
            console.log('✅ Caché limpiada');
        },
        
        // Ayuda
        help: () => {
            console.log(`
            🛠️ Comandos de debug:
            debug.cache()      → Ver info del IndexedDB
            debug.estado()     → Ver estado de la app
            debug.buscar(sku)  → Buscar producto por SKU
            debug.bench()      → Benchmark de guardado/búsqueda
            debug.limpiar()    → Limpiar caché
            `);
        }    };
    
    console.log('🛠️ Debug panel listo. Escribe debug.help() para ver comandos.');
}
/* ============================================================
   🆕 Restaura el catálogo completo desde memoria
   Aplica filtros activos (categoría, búsqueda) sin llamar a la API
   ============================================================ */
function rerenderizarCatalogoDesdeMemoria() {
    const contenedor = document.getElementById('catalogoProductos');
    if (!contenedor) return;

    // Si no hay productos en memoria, mostrar mensaje
    if (!estado.productos || estado.productos.length === 0) {
        console.warn('⚠️ No hay productos en memoria para restaurar');
        contenedor.innerHTML = `
            <div style="grid-column:1/-1; text-align:center; padding:40px 20px; color:var(--text-muted);">
                <div style="font-size:36px; opacity:0.5; margin-bottom:8px;">📦</div>
                <div style="font-weight:600;">No hay productos para mostrar</div>
            </div>`;
        return;
    }

    // Aplicar filtro de categoría si está activo
    let productos = estado.productos;
    const catId = _catalogoEstado.categoriaId;

    if (catId) {
        productos = productos.filter(p => p.idCategoria === catId);
        console.log(`📂 Filtro categoría activo: ${productos.length} productos`);
    }

    // Renderizar
    contenedor.innerHTML = productos.map(p => renderCardProducto(p)).join('');

    // Refrescar stock
    if (typeof refrescarStockCatalogo === 'function') {
        refrescarStockCatalogo();
    }

    // Refrescar buscador
    if (typeof refrescarBuscador === 'function') {
        refrescarBuscador();
    }

    console.log(`✅ Catálogo restaurado: ${productos.length} productos (memoria)`);
}
/* ============================================================
   🆕 Muestra mensaje de "sin resultados"
   ============================================================ */
function mostrarSinResultados() {
    const contenedor = document.getElementById('catalogoProductos');
    if (!contenedor) return;

    contenedor.innerHTML = `
        <div style="grid-column:1/-1; text-align:center; padding:60px 20px; color:var(--text-muted);">
            <div style="font-size:48px; opacity:0.5; margin-bottom:12px;">🔍</div>
            <div style="font-weight:600; font-size:16px; margin-bottom:6px;">
                Sin resultados
            </div>
            <div style="font-size:13px;">
                No se encontraron productos que coincidan con tu búsqueda
            </div>
        </div>`;
}
/* ============================================================
   🆕 API PÚBLICA: limpiar todos los cachés
   Uso: window.limpiarTodo() en la consola
   ============================================================ */
window.limpiarTodo = async function() {
    if (!confirm('🧹 ¿Limpiar TODOS los cachés?\n\nEsto incluye:\n- Memoria\n- IndexedDB\n- LocalStorage\n- SessionStorage\n- Cache API\n\nSe recargará la página.')) {
        return;
    }

    console.log('🧹 Limpieza total iniciada...');

    // Memoria
    estado.productos = [];
    estado.carritos = { venta1: [] };
    estado.historial = [];
    estado._productosCacheInvalidado = true;
    estado._ultimaCargaTop = 0;

    if (typeof _controlCargaTop !== 'undefined') {
        _controlCargaTop.promesaEnCurso = null;
        _controlCargaTop.ultimaCargaExitosa = 0;
    }

    if (typeof _busquedaCacheGlobal !== 'undefined') {
        _busquedaCacheGlobal.clear();
    }

    // IndexedDB
    if (typeof CatalogoDB !== 'undefined') {
        await CatalogoDB.limpiarCache();
    }

    // LocalStorage (solo claves de caché, NO tokens)
    const claves = [
        'pos_top_productos_cache_v3',
        'pos_catalogo_completo',
        'pos_catalogo_meta',
        'pos_estado',
        'pos_hash_productos',
        'pos_version_catalogo',
        'pos_busquedas_recientes'
    ];
    claves.forEach(k => localStorage.removeItem(k));

    // SessionStorage
    sessionStorage.clear();

    // Cache API
    if ('caches' in window) {
        const names = await caches.keys();
        await Promise.all(names.map(n => caches.delete(n)));
    }

    console.log('✅ Limpieza completa');
    if (typeof toast === 'function') toast('🧹 Cachés limpiados', 'success');

    setTimeout(() => window.location.reload(), 800);
};

window.diagnosticoCaches = async function() {
    console.log('═══════════════════════════════════════');
    console.log('📊 DIAGNÓSTICO DE CACHÉS');
    console.log('═══════════════════════════════════════');

    // Memoria
    console.log('\n🧠 MEMORIA:');
    console.log('  estado.productos:', estado.productos.length);
    console.log('  cache invalidado:', estado._productosCacheInvalidado);

    // DOM
    const cont = document.getElementById('catalogoProductos');
    console.log('\n🌐 DOM:');
    console.log('  .producto en DOM:', cont?.querySelectorAll('.producto').length || 0);

    // IndexedDB
    console.log('\n💾 INDEXEDDB:');
    if (typeof CatalogoDB !== 'undefined') {
        const info = await CatalogoDB.infoCache();
        console.log('  existe:', info.existe);
        console.log('  total:', info.total);
    }

    // LocalStorage
    console.log('\n📦 LOCALSTORAGE:');
    console.log('  tamaño total:', JSON.stringify(localStorage).length, 'bytes');
    console.log('  top cache:', localStorage.getItem('pos_top_productos_cache_v3') ? 'existe' : 'vacío');
    console.log('  catálogo completo:', localStorage.getItem('pos_catalogo_completo') ? 'existe' : 'vacío');

    // Backend
    console.log('\n🌐 BACKEND:');
    try {
        const token = localStorage.getItem('pos_token');
        const resp = await fetch('http://127.0.0.1:5014/api/Productos/top?limite=1', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        const data = await resp.json();
        console.log('  productos en backend:', data.length);
    } catch (e) {
        console.log('  ❌ Error consultando backend');
    }

    console.log('\n═══════════════════════════════════════');
};

async function initConfig() {
    await window.diagnosticoCaches();
}
/* ============================================================
   25. INICIALIZACIÓN
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Iniciando MultiVentas POS...');

    // 1. Base
    restaurarEstado();
    iniciarReloj();
    actualizarEstadoConexion();
    initTema();
    setupSidebar();

    // 2. Modales y listeners globales
    setupFinalizarVentaModal();
    setupHistorialListeners();
    setupCartDrawer();
    setupImportacionListeners();

    // 3. Vista inicial
    cargarVista('ventas');

    // 4. Menú activo
    if (typeof resaltarMenuActivo === 'function') {
        resaltarMenuActivo(estado.pestañaActiva || 'ventas');
    }

    // 5. FAB
    if (document.getElementById('cartFab')) {
        makeDraggable('cartFab', STORAGE_KEYS.DRAG_POS);
    }

    // 6. Escáner
    if (typeof Escaner !== 'undefined') {
        Escaner.iniciar((codigo) => {
            manejarEscaneo(codigo);
        });
    }
    
    if (typeof BuscadorUI !== 'undefined') {
        setTimeout(() => BuscadorUI.init(), 500);
    }

   
  // 🆕 Renderizar accesos rápidos dinámicos
    setTimeout(() => renderAccesosRapidos(), 300);

    document.addEventListener('DOMContentLoaded', () => {
    // ... código existente ...

    // 🆕 Enganchar el botón "Cargar todos"
    const btnCargarTodos = document.getElementById('btnCargarTodos');
    if (btnCargarTodos && !btnCargarTodos._attached) {
        btnCargarTodos._attached = true;
        btnCargarTodos.addEventListener('click', cargarTodosLosProductos);
    }

        console.log('✅ App.js cargado correctamente');
    });

    console.log('✅ App.js cargado correctamente');
});