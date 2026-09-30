// ============================================================
// api.js - Cliente HTTP con refresh automático de token
// ============================================================

// 1. Intentamos obtener la IP guardada por el usuario, si no hay, usamos una por defecto
//const ipGuardada = localStorage.getItem('api_ip') || 'http://localhost:5014';

// 2. Construimos la URL base dinámica
//const API_BASE_URL = 'http://${ipGuardada}/api';

const API_BASE_URL = (() => {
    const host = window.location.hostname;
    return `http://${host}:5014/api`;
})();
//const API_BASE_URL = 'http://192.168.101.4:5014/api';
//const API_BASE_URL = 'http://localhost:5014/api';
//const API_URL = 'http://192.168.101.4:5014/api'; 
//const API_BASE_URL = 'http://192.168.101.4:5014/api';

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
// Intentar renovar el access token usando el refresh token
// ------------------------------------------------------------
let _refreshing = null;   // Promise compartida para evitar múltiples refresh simultáneos

async function refreshAccessToken() {
    // Si ya hay un refresh en curso, esperar a ese
    if (_refreshing) return _refreshing;

    _refreshing = (async () => {
        const refreshToken = localStorage.getItem('pos_refresh_token');
        if (!refreshToken) return null;

        try {
            const resp = await fetch(`${API_BASE_URL}/Auth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken })
            });

            if (!resp.ok) return null;

            const data = await resp.json();
            const newAccess = data.accessToken || data.token;
            if (!newAccess) return null;

            // Guardar nuevos tokens
            localStorage.setItem('pos_token', newAccess);
            if (data.refreshToken) {
                localStorage.setItem('pos_refresh_token', data.refreshToken);
            }

            console.log('🔄 Token renovado automáticamente');
            return newAccess;

        } catch (e) {
            console.warn('Error al renovar token', e);
            return null;
        } finally {
            _refreshing = null;
        }
    })();

    return _refreshing;
}

// ------------------------------------------------------------
// Cerrar sesión (fallback si el refresh falla)
// ------------------------------------------------------------
function handleUnauthorized() {
    localStorage.removeItem('pos_token');
    localStorage.removeItem('pos_refresh_token');
    localStorage.removeItem('pos_usuario');

    if (typeof toast === 'function') {
        toast('Sesión expirada. Inicia sesión nuevamente.', 'error');
    }

    setTimeout(() => window.location.reload(), 1200);
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
// FETCH PRINCIPAL con reintento automático en 401
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
            if (_retry) {
                const newToken = await refreshAccessToken();
                if (newToken) {
                    // Reintentar la petición original con el token nuevo
                    return apiFetch(endpoint, options, false);
                }
            }
            // Si no se pudo renovar, cerrar sesión
            handleUnauthorized();
            return { ok: false, status: 401, data: null };
        }

        // 403 → sin permisos
        if (response.status === 403) {
            const msg = 'No tienes permisos para realizar esta acción.';
            if (typeof toast === 'function') toast(msg, 'error');
            return { ok: false, status: 403, data: { message: msg } };
        }

        // 204 → sin body
        if (response.status === 204) return { ok: true, status: 204, data: null };

        // Otros errores
        if (!response.ok) {
            const msg = await extractErrorMessage(response);
            if (typeof toast === 'function') toast(msg, 'error');
            return { ok: false, status: response.status, data: { message: msg } };
        }

        // 200 OK
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            const data = await response.json();
            return { ok: true, status: response.status, data };
        }

        const text = await response.text();
        return { ok: true, status: response.status, data: text };

    } catch (error) {
        clearTimeout(timeoutId);

        if (error.name === 'AbortError') {
            const msg = 'La petición tardó demasiado.';
            if (typeof toast === 'function') toast(msg, 'error');
            return { ok: false, status: 0, data: { message: msg } };
        }

        console.error('API Error:', error);
        const msg = 'No se pudo conectar con el servidor.';
        if (typeof toast === 'function') toast(msg, 'error');
        return { ok: false, status: 0, data: { message: msg } };
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