// ============================================================
// Escaner.js - Detección de lector de código de barras
//
// Los lectores de código de barras se comportan como teclados
// muy rápidos. Este módulo detecta esa velocidad y dispara un
// callback cuando se completa un escaneo.
// ============================================================

const Escaner = (() => {

    // Configuración
    const UMBRAL_MS = 50;      // tiempo máximo entre teclas para ser "escáner"
    const MIN_LONGITUD = 4;    // mínimo de caracteres para considerarlo válido
    const TIMEOUT_MS = 100;    // si pasa este tiempo sin teclas, se resetea

    let buffer = '';
    let tiempoUltimaTecla = 0;
    let tiemposTeclas = [];
    let timeoutReset = null;
    let onEscanearCallback = null;
    let activo = false;

        /**
         * Inicia el listener global de teclado.
         * @param {Function} onEscanear - callback(codigo) que se llama al detectar un escaneo
         */
        function iniciar(onEscanear) {
            if (activo) return;
            activo = true;
            onEscanearCallback = onEscanear;

            document.addEventListener('keydown', manejarKeydown, true);
            console.log('📷 Escáner de código de barras activo');
        }

    function detener() {
        activo = false;
        document.removeEventListener('keydown', manejarKeydown, true);
        resetear();
    }

    function resetear() {
        buffer = '';
        tiemposTeclas = [];
        tiempoUltimaTecla = 0;
        if (timeoutReset) {
            clearTimeout(timeoutReset);
            timeoutReset = null;
        }
    }

    function manejarKeydown(e) {
        // 🆕 Validación defensiva: si no hay e.key, ignorar
        if (!e || !e.key) return;
        // Si el foco está en un input de texto y el usuario está escribiendo lento → ignorar
        const ahora = Date.now();
        const deltaMs = tiempoUltimaTecla ? (ahora - tiempoUltimaTecla) : 0;

        // Enter = fin de escaneo (los lectores suelen mandar Enter al final)
        if (e.key === 'Enter') {
            if (buffer.length >= MIN_LONGITUD && esEscaneo(tiemposTeclas)) {
                e.preventDefault();
                e.stopPropagation();

                const codigo = buffer.trim();
                console.log(`📷 Escaneo detectado: "${codigo}"`);

                if (typeof onEscanearCallback === 'function') {
                    onEscanearCallback(codigo);
                }

                resetear();
                return;
            }
            // Si no es escaneo, dejar pasar el Enter normal
            resetear();
            return;
        }

        // Ignorar teclas modificadoras y de control
        if (e.key.length !== 1) return;
        if (e.ctrlKey || e.altKey || e.metaKey) return;

        // Si el delta es mayor al umbral → probablemente humano, resetear
        if (deltaMs > UMBRAL_MS * 3) {
            buffer = '';
            tiemposTeclas = [];
        }

        buffer += e.key;
        tiemposTeclas.push(deltaMs);
        tiempoUltimaTecla = ahora;

        // Auto-reset si pasa mucho tiempo sin teclas
        if (timeoutReset) clearTimeout(timeoutReset);
        timeoutReset = setTimeout(resetear, TIMEOUT_MS);
    }

    /**
     * Heurística: ¿los tiempos entre teclas parecen de un escáner?
     */
    function esEscaneo(tiempos) {
        if (tiempos.length < MIN_LONGITUD) return false;

        // Ignorar el primer delta (siempre es 0)
        const deltas = tiempos.slice(1);
        if (deltas.length === 0) return false;

        // Promedio de tiempo entre teclas
        const promedio = deltas.reduce((a, b) => a + b, 0) / deltas.length;

        // Si el promedio es < 50ms → es un escáner
        return promedio < UMBRAL_MS;
    }

    return {
        iniciar,
        detener,
        resetear,
        // Expuesto para pruebas
        _config: { UMBRAL_MS, MIN_LONGITUD, TIMEOUT_MS }
    };
})();