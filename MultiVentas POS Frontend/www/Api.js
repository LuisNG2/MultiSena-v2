// ============================================================
// api.js - Cliente HTTP con refresh automático de token
// ============================================================

const API_BASE_URL = (() => {
    // 🆕 Si hay una IP configurada manualmente, usarla
    const ipGuardada = localStorage.getItem('api_ip');
    if (ipGuardada) {
        return `http://${ipGuardada}/api`;
    }
    
    const host = window.location.hostname;
    return `http://${host}:5014/api`;
})();

const API_TIMEOUT = 15000;

// ------------------------------------------------------------
// Headers con access token
// ------------------------------------------------------------
function getAuthHeaders() {
    const token = localStorage.getItem('pos_token');
    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return headers;
}

// ------------------------------------------------------------
// 🆕 SISTEMA DE REFRESH CON COLA
// Evita que peticiones concurrentes hagan logout cuando el
// token se renueva.
// ------------------------------------------------------------
let _refreshing = null;
let _refreshPromise = null;
const _peticionesPendientes = [];

/**
 * Renueva el access token. Si ya hay un refresh en curso,
 * devuelve la misma promesa para que todas las peticiones
 * esperen al mismo resultado.
 */
async function refreshAccessToken() {
    // Si ya hay un refresh en curso, esperar el mismo
    if (_refreshPromise) {
        return _refreshPromise;
    }

    _refreshPromise = (async () => {
        const refreshToken = localStorage.getItem('pos_refresh_token');
        if (!refreshToken) {
            console.warn('⚠️ No hay refresh token disponible');
            return null;
        }

        try {
            console.log('🔄 Renovando token...');
            const resp = await fetch(`${API_BASE_URL}/Auth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken })
            });

            if (!resp.ok) {
                console.warn(`⚠️ Refresh falló con HTTP ${resp.status}`);
                return null;
            }

            const data = await resp.json();
            const newAccess = data.accessToken || data.token;
            if (!newAccess) {
                console.warn('⚠️ Respuesta de refresh sin token');
                return null;
            }

            localStorage.setItem('pos_token', newAccess);
            if (data.refreshToken) {
                localStorage.setItem('pos_refresh_token', data.refreshToken);
            }

            console.log('✅ Token renovado automáticamente');
            return newAccess;

        } catch (e) {
            console.warn('❌ Error al renovar token:', e);
            return null;
        } finally {
            _refreshPromise = null;
            _refreshing = null;
        }
    })();

    _refreshing = _refreshPromise;
    return _refreshPromise;
}

// ------------------------------------------------------------
// Cerrar sesión
// ------------------------------------------------------------
function handleUnauthorized() {
    // 🆕 Evitar logout múltiple
    if (window._logoutEnProceso) return;
    window._logoutEnProceso = true;

    console.warn('🔒 Sesión expirada. Redirigiendo a login...');

    localStorage.removeItem('pos_token');
    localStorage.removeItem('pos_refresh_token');
    localStorage.removeItem('pos_usuario');

    if (typeof toast === 'function') {
        toast('Sesión expirada. Inicia sesión nuevamente.', 'error');
    }

    setTimeout(() => {
        window._logoutEnProceso = false;
        window.location.reload();
    }, 1200);
}

// ------------------------------------------------------------
// Extraer mensaje de error
// ------------------------------------------------------------
async function extractErrorMessage(response) {
    try {
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            const data = await response.json();
            if (data.message) return data.message;
            if (data.errors) {
                const errores = [];
                for (const campo in data.errors) {
                    if (Array.isArray(data.errors[campo])) errores.push(...data.errors[campo]);
                    else errores.push(data.errors[campo]);
                }
                return errores.join(', ') || 'Error de validación';
            }
            return JSON.stringify(data);
        }
        const text = await response.text();
        return text || `Error ${response.status}`;
    } catch {
        return `Error ${response.status}: ${response.statusText}`;
    }
}

// ------------------------------------------------------------
// Helper: construir respuesta unificada con headers
// ------------------------------------------------------------
function buildResponse(ok, status, data, response) {
    return {
        ok,
        status,
        data,
        headers: response?.headers || null
    };
}

// ------------------------------------------------------------
// 🆕 FETCH PRINCIPAL con reintento inteligente en 401
// ------------------------------------------------------------
async function apiFetch(endpoint, options = {}, _retry = true) {
    const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

    const config = {
        method: options.method || 'GET',
        headers: { ...getAuthHeaders(), ...(options.headers || {}) },
        signal: controller.signal,
        ...(options.body && { body: options.body })
    };

    try {
        const response = await fetch(url, config);
        clearTimeout(timeoutId);

        // ⬇️ 401 → intentar renovar el token y reintentar UNA vez
        if (response.status === 401) {
            // 🆕 Si ya hay un refresh en curso, esperarlo
            // y luego reintentar la petición
            if (_refreshPromise) {
                console.log(`⏳ [${options.method || 'GET'}] ${endpoint} esperando refresh...`);
                const newToken = await _refreshPromise;
                if (newToken) {
                    return apiFetch(endpoint, options, false);
                }
            }

            if (_retry) {
                console.log(`🔄 [${options.method || 'GET'}] ${endpoint} → 401, renovando token...`);
                const newToken = await refreshAccessToken();
                if (newToken) {
                    console.log(`✅ [${options.method || 'GET'}] ${endpoint} → reintentando con nuevo token`);
                    return apiFetch(endpoint, options, false);
                }
                // Si no se pudo renovar, es sesión expirada
                console.warn(`❌ [${options.method || 'GET'}] ${endpoint} → refresh falló`);
            }
            
            // 🆕 Solo hacer logout si NO estamos en medio de un refresh
            if (!_refreshPromise) {
                handleUnauthorized();
            }
            return buildResponse(false, 401, null, response);
        }

        // 403 → sin permisos
        if (response.status === 403) {
            const msg = 'No tienes permisos para realizar esta acción.';
            if (typeof toast === 'function') toast(msg, 'error');
            return buildResponse(false, 403, { message: msg }, response);
        }

        // 204 → sin body
        if (response.status === 204) {
            return buildResponse(true, 204, null, response);
        }

        // Otros errores
        if (!response.ok) {
            const msg = await extractErrorMessage(response);
            if (typeof toast === 'function') toast(msg, 'error');
            return buildResponse(false, response.status, { message: msg }, response);
        }

        // 200 OK
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            const data = await response.json();
            return buildResponse(true, response.status, data, response);
        }

        const text = await response.text();
        return buildResponse(true, response.status, text, response);

    } catch (error) {
        clearTimeout(timeoutId);

        if (error.name === 'AbortError') {
            const msg = 'La petición tardó demasiado.';
            if (typeof toast === 'function') toast(msg, 'error');
            return { ok: false, status: 0, data: { message: msg }, headers: null };
        }

        console.error('API Error:', error);
        const msg = 'No se pudo conectar con el servidor.';
        if (typeof toast === 'function') toast(msg, 'error');
        return { ok: false, status: 0, data: { message: msg }, headers: null };
    }
}

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------
const api = {
    get: (endpoint) => apiFetch(endpoint, { method: 'GET' }),
    post: (endpoint, body) => apiFetch(endpoint, { method: 'POST', body: JSON.stringify(body) }),
    put: (endpoint, body) => apiFetch(endpoint, { method: 'PUT', body: JSON.stringify(body) }),
    delete: (endpoint) => apiFetch(endpoint, { method: 'DELETE' })
};