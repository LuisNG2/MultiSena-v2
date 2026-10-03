    // ============================================================
    // Catalogo.js — Usa IndexedDB para el catálogo completo
    // ============================================================

    const Catalogo = (() => {

        let _todosLosProductos = null;
        let _cargando = false;

        async function cargarCompleto() {
        if (_cargando) return _todosLosProductos;

        // 1. Intentar cargar de IndexedDB
        const enCache = await CatalogoDB.cargarCompleto();
        if (enCache && enCache.length > 0) {
            _todosLosProductos = enCache;
            return enCache;
        }

        // 2. Cargar del servidor
        _cargando = true;
        console.log('📥 Cargando catálogo completo desde el servidor...');

        try {
            const resp = await api.get('/Productos/sync-lite');
            if (!resp.ok) {
                console.warn('⚠️ Error cargando catálogo completo');
                return null;
            }

            _todosLosProductos = resp.data || [];

            // 🆕 Si la BD está vacía, limpiar IndexedDB
            if (_todosLosProductos.length === 0) {
                console.warn('🚨 Catálogo vacío en el servidor. Limpiando cachés...');
                await CatalogoDB.limpiarCache();
                return [];
            }

            await CatalogoDB.guardarCompleto(_todosLosProductos);
            console.log(`✅ Catálogo completo cargado (${_todosLosProductos.length} productos)`);
            return _todosLosProductos;

        } catch (err) {
            console.error('❌ Error cargando catálogo completo:', err);
            return null;
        } finally {
            _cargando = false;
        }
    }
    /* ============================================================
       2. BUSCAR POR SKU (usa índice de IndexedDB)
       ============================================================ */
    async function buscarPorSku(sku) {
        if (!sku) return null;

        // Primero intentar en memoria (más rápido)
        if (_todosLosProductos) {
            const skuNorm = String(sku).trim().toUpperCase();
            const encontrado = _todosLosProductos.find(p => {
                const s = String(p.sku || '').trim().toUpperCase();
                const c = String(p.codigoInterno || '').trim().toUpperCase();
                return s === skuNorm || c === skuNorm;
            });
            if (encontrado) return encontrado;
        }

        // Fallback: buscar en IndexedDB (usa índice, es rápido)
        return await CatalogoDB.buscarPorSku(sku);
    }

    /* ============================================================
       3. BÚSQUEDA LOCAL (por ahora en memoria)
       ============================================================ */
    function buscarLocal(query) {
        if (!_todosLosProductos || !query) return [];

        const items = _todosLosProductos.map(p => ({
            nombre: p.nombre || '',
            sku: p.sku || p.codigoInterno || '',
            categoria: p.categoriaNombre || '',
            _producto: p
        }));

        return Buscador.buscar(query, items, { minScore: 25 })
            .map(r => r._producto);
    }

    /* ============================================================
       4. BÚSQUEDA HÍBRIDA
       ============================================================ */
    async function buscarHibrido(query, opts = {}) {
        const { limite = 50 } = opts;

        const locales = buscarLocal(query);
        if (locales.length > 0) {
            console.log(`🔍 Búsqueda local: ${locales.length} resultados`);
            return locales.slice(0, limite);
        }

        console.log('🔍 Búsqueda local vacía, consultando servidor...');
        try {
            const resp = await api.get(`/Productos/search?q=${encodeURIComponent(query)}`);
            if (resp.ok && Array.isArray(resp.data)) {
                return resp.data.slice(0, limite);
            }
        } catch (err) {
            console.warn('Error buscando en servidor:', err);
        }

        return [];
    }

    /* ============================================================
       5. API PÚBLICA
       ============================================================ */
    return {
        cargarCompleto,
        buscarPorSku,
        buscarLocal,
        buscarHibrido,
        limpiarCache: () => CatalogoDB.limpiarCache(),
        infoCache: () => CatalogoDB.infoCache(),
        estaCargado: () => !!_todosLosProductos,
        getProductos: () => _todosLosProductos
    };
})();