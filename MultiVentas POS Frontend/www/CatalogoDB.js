// ============================================================
// CatalogoDB.js — Almacenamiento del catálogo en IndexedDB
// Reemplaza el uso de localStorage para el catálogo completo.
// ============================================================

const CatalogoDB = (() => {
    const DB_NAME = 'multiventas_pos';
    const DB_VERSION = 1;
    const STORE_PRODUCTOS = 'productos';
    const STORE_META = 'meta';
    const CACHE_TTL = 24 * 60 * 60 * 1000;   // 24 horas

    let _db = null;
    let _todosLosProductos = null;
    let _cargando = false;

    /* ============================================================
       1. ABRIR/CREAR LA BASE DE DATOS
       ============================================================ */
    function abrirDB() {
        return new Promise((resolve, reject) => {
            if (_db) return resolve(_db);

            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                _db = request.result;
                resolve(_db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Store de productos con índices
                if (!db.objectStoreNames.contains(STORE_PRODUCTOS)) {
                    const store = db.createObjectStore(STORE_PRODUCTOS, {
                        keyPath: 'idProducto'
                    });
                    store.createIndex('sku', 'sku', { unique: false });
                    store.createIndex('codigoInterno', 'codigoInterno', { unique: false });
                    store.createIndex('nombre', 'nombre', { unique: false });
                    store.createIndex('categoriaNombre', 'categoriaNombre', { unique: false });
                }

                // Store de metadatos
                if (!db.objectStoreNames.contains(STORE_META)) {
                    db.createObjectStore(STORE_META, { keyPath: 'key' });
                }
            };
        });
    }

    /* ============================================================
       2. GUARDAR CATÁLOGO COMPLETO
       ============================================================ */
    async function guardarCompleto(productos) {
        if (!Array.isArray(productos) || productos.length === 0) {
            console.warn('⚠️ No hay productos para guardar');
            return false;
        }

        try {
            const db = await abrirDB();

            await new Promise((resolve, reject) => {
                const tx = db.transaction([STORE_PRODUCTOS, STORE_META], 'readwrite');
                const storeProductos = tx.objectStore(STORE_PRODUCTOS);
                const storeMeta = tx.objectStore(STORE_META);

                // Limpiar productos viejos
                storeProductos.clear();

                // Insertar todos los productos
                for (const p of productos) {
                    storeProductos.put(p);
                }

                // Guardar metadatos
                storeMeta.put({
                    key: 'catalogo_meta',
                    version: 1,
                    fecha: Date.now(),
                    total: productos.length
                });

                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
                tx.onabort = () => reject(tx.error);
            });

            _todosLosProductos = productos;
            console.log(`💾 Catálogo guardado en IndexedDB (${productos.length} productos)`);
            return true;
        } catch (e) {
            console.error('❌ Error guardando en IndexedDB:', e);
            return false;
        }
    }

    /* ============================================================
       3. CARGAR CATÁLOGO COMPLETO (con validación de TTL)
       ============================================================ */
    async function cargarCompleto() {
        if (_cargando) return _todosLosProductos;
        if (_todosLosProductos && _todosLosProductos.length > 0) {
            return _todosLosProductos;
        }

        _cargando = true;

        try {
            const db = await abrirDB();

            // Verificar TTL primero
            const meta = await new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_META, 'readonly');
                const store = tx.objectStore(STORE_META);
                const req = store.get('catalogo_meta');
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });

            if (meta) {
                const edad = Date.now() - meta.fecha;
                if (edad > CACHE_TTL) {
                    console.log('🕐 Caché IndexedDB expirado');
                    await limpiarCache();
                    return null;
                }
            }

            // Cargar todos los productos
            const productos = await new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_PRODUCTOS, 'readonly');
                const store = tx.objectStore(STORE_PRODUCTOS);
                const req = store.getAll();

                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => reject(req.error);
            });

            if (productos.length === 0) return null;

            _todosLosProductos = productos;
            console.log(`📦 Catálogo cargado de IndexedDB (${productos.length} productos)`);
            return productos;

        } catch (e) {
            console.error('❌ Error cargando de IndexedDB:', e);
            return null;
        } finally {
            _cargando = false;
        }
    }

    /* ============================================================
       4. BÚSQUEDA POR SKU (usa índice)
       ============================================================ */
    async function buscarPorSku(sku) {
        if (!sku) return null;
        const skuNorm = String(sku).trim();

        try {
            const db = await abrirDB();

            // Intentar con índice de SKU
            const porSku = await new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_PRODUCTOS, 'readonly');
                const index = tx.objectStore(STORE_PRODUCTOS).index('sku');
                const req = index.get(skuNorm);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });

            if (porSku) return porSku;

            // Fallback: buscar por código interno
            const porCodigo = await new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_PRODUCTOS, 'readonly');
                const index = tx.objectStore(STORE_PRODUCTOS).index('codigoInterno');
                const req = index.get(skuNorm);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });

            return porCodigo || null;
        } catch (e) {
            console.error('❌ Error buscando por SKU:', e);
            return null;
        }
    }

    /* ============================================================
       5. LIMPIAR CACHÉ
       ============================================================ */
    async function limpiarCache() {
        try {
            const db = await abrirDB();
            await new Promise((resolve, reject) => {
                const tx = db.transaction([STORE_PRODUCTOS, STORE_META], 'readwrite');
                tx.objectStore(STORE_PRODUCTOS).clear();
                tx.objectStore(STORE_META).clear();
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
            _todosLosProductos = null;
            console.log('🗑 Caché IndexedDB limpiada');
        } catch (e) {
            console.error('❌ Error limpiando caché:', e);
        }
    }

    /* ============================================================
       6. INFO DEL CACHÉ
       ============================================================ */
    async function infoCache() {
        try {
            const db = await abrirDB();

            const meta = await new Promise((resolve) => {
                const tx = db.transaction(STORE_META, 'readonly');
                const req = tx.objectStore(STORE_META).get('catalogo_meta');
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve(null);
            });

            const total = await new Promise((resolve) => {
                const tx = db.transaction(STORE_PRODUCTOS, 'readonly');
                const req = tx.objectStore(STORE_PRODUCTOS).count();
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve(0);
            });

            return {
                existe: !!meta,
                total,
                fecha: meta?.fecha ? new Date(meta.fecha) : null,
                edadMinutos: meta ? Math.round((Date.now() - meta.fecha) / 60000) : 0
            };
        } catch (e) {
            return { existe: false, total: 0 };
        }
    }

    /* ============================================================
       7. API PÚBLICA
       ============================================================ */
    return {
        guardarCompleto,
        cargarCompleto,
        buscarPorSku,
        buscarPorTexto,           // 🆕
        limpiarCache,
        infoCache,
        estaCargado: () => !!_todosLosProductos && _todosLosProductos.length > 0,
        getProductos: () => _todosLosProductos
    };
        /* ============================================================
        8. BÚSQUEDA POR TEXTO en el catálogo completo
        Usa el motor Buscador.js pero sobre los 18,573 productos
        del IndexedDB. Retorna array de productos coincidentes.
        ============================================================ */
        async function buscarPorTexto(query, limite = 50) {
            if (!query || query.trim().length < 2) return [];

            // 1. Asegurar que el catálogo esté en memoria
            if (!_todosLosProductos || _todosLosProductos.length === 0) {
                await cargarCompleto();
            }
            if (!_todosLosProductos || _todosLosProductos.length === 0) return [];

            // 2. Convertir a items de búsqueda
            const items = _todosLosProductos.map(p => ({
                idProducto: p.idProducto,
                nombre: p.nombre || '',
                sku: p.sku || p.codigoInterno || '',
                categoria: p.categoriaNombre || '',
                vecesVendido: p.vecesVendido || 0,
                _ref: p
            }));

            // 3. Usar el motor Buscador.js
            if (typeof Buscador === 'undefined') {
                console.warn('⚠️ Buscador.js no está cargado, usando fallback');
                const q = query.trim().toLowerCase();
                return _todosLosProductos
                    .filter(p => 
                        (p.nombre || '').toLowerCase().includes(q) ||
                        (p.sku || '').toLowerCase().includes(q) ||
                        (p.codigoInterno || '').toLowerCase().includes(q)
                    )
                    .slice(0, limite);
            }

            const encontrados = Buscador.buscar(query, items, { minScore: 25 });
            
            // 4. Devolver los productos completos ordenados por relevancia
            return encontrados
                .slice(0, limite)
                .map(r => r._ref);
        }
})();