/* ===== CONFIG ===== */
const AUTH_KEY = 'pos_usuario';
const TOKEN_KEY = 'pos_token';
const REFRESH_KEY = 'pos_refresh_token';

async function login(usuario, clave) {
    try {
        const resp = await fetch(`${API_BASE_URL}/Auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                correo: usuario,
                password: clave
            })
        });

        if (!resp.ok) return null;

        const data = await resp.json();
        const accessToken = data.accessToken || data.token;
        if (!accessToken) return null;

        // 🆕 Si había un usuario distinto antes, limpiar su estado
        const usuarioAnterior = localStorage.getItem(AUTH_KEY);
        if (usuarioAnterior) {
            try {
                const prev = JSON.parse(usuarioAnterior);
                if (prev.id !== data.idUsuario) {
                    console.log('🔄 Usuario distinto detectado, limpiando estado anterior');
                    if (typeof limpiarEstadoSesion === 'function') {
                        limpiarEstadoSesion();
                    }
                }
            } catch {}
        }

        // Guardar tokens
        localStorage.setItem(TOKEN_KEY, accessToken);
        if (data.refreshToken) {
            localStorage.setItem(REFRESH_KEY, data.refreshToken);
        }

        // Guardar usuario
        const payload = {
            id: data.idUsuario,
            nombre: data.nombre,
            correo: data.correo,
            rol: data.idRol,
            ts: Date.now()
        };
        localStorage.setItem(AUTH_KEY, JSON.stringify(payload));

        return payload;

    } catch (error) {
        console.error(error);
        return null;
    }
}

/* ===== BOOTSTRAP (Primer usuario) ===== */

async function verificarBootstrap() {
    try {
        const resp = await fetch(`${API_BASE_URL}/Auth/necesita-bootstrap`);
        if (!resp.ok) return false;

        const data = await resp.json();
        return data.necesitaBootstrap === true;
    } catch (e) {
        console.warn('No se pudo verificar bootstrap:', e);
        return false;
    }
}

function showBootstrapModal() {
    const modal = document.getElementById('modalBootstrap');
    if (!modal) return;
    showModal(modal);
    const appRoot = document.getElementById('contenedor');
    if (appRoot) appRoot.style.filter = 'blur(2px)';
}

function hideBootstrapModal() {
    const modal = document.getElementById('modalBootstrap');
    if (!modal) return;
    hideModal(modal);
    const appRoot = document.getElementById('contenedor');
    if (appRoot) appRoot.style.filter = '';
}

function initBootstrap() {
    const form = document.getElementById('formBootstrap');
    const error = document.getElementById('bootstrapError');

    if (!form || form._listenerAttached) return;
    form._listenerAttached = true;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const nombre = document.getElementById('bootNombre').value.trim();
        const correo = document.getElementById('bootCorreo').value.trim();
        const password = document.getElementById('bootPassword').value;
        const password2 = document.getElementById('bootPassword2').value;

        // Validaciones del lado del cliente
        if (!nombre || !correo || !password) {
            error.style.display = 'block';
            error.textContent = 'Todos los campos son obligatorios.';
            return;
        }

        if (password.length < 6) {
            error.style.display = 'block';
            error.textContent = 'La contraseña debe tener al menos 6 caracteres.';
            return;
        }

        if (password !== password2) {
            error.style.display = 'block';
            error.textContent = 'Las contraseñas no coinciden.';
            return;
        }

        error.style.display = 'none';

        // Enviar al backend
        try {
            const resp = await fetch(`${API_BASE_URL}/Auth/bootstrap`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nombre, correo, password })
            });

            if (!resp.ok) {
                const data = await resp.json().catch(() => ({}));
                error.style.display = 'block';
                error.textContent = data.message || `Error ${resp.status}`;
                return;
            }

            const data = await resp.json();

            // Guardar tokens (el backend ya nos devolvió sesión iniciada)
            localStorage.setItem(TOKEN_KEY, data.accessToken);
            if (data.refreshToken) {
                localStorage.setItem(REFRESH_KEY, data.refreshToken);
            }

            const payload = {
                id: data.idUsuario,
                nombre: data.nombre,
                correo: data.correo,
                rol: data.idRol,
                ts: Date.now()
            };
            localStorage.setItem(AUTH_KEY, JSON.stringify(payload));

            // Cerrar modal y arrancar la app
            hideBootstrapModal();

            if (typeof toast === 'function') {
                toast(`✅ Bienvenido, ${data.nombre}. Sistema configurado.`, 'success');
            }

            // Actualizar header y menú de usuarios
            const headerUser = document.getElementById('headerUserName');
            if (headerUser) headerUser.textContent = data.nombre;


            if (typeof actualizarMenuUsuarios === 'function') {
                actualizarMenuUsuarios();
            }

            // Cargar productos y vista de ventas
            if (typeof cargarProductosDesdeAPI === 'function') {
                await cargarProductosDesdeAPI();
            }
            if (typeof cargarVista === 'function') {
                cargarVista('ventas');
            }

        } catch (err) {
            console.error(err);
            error.style.display = 'block';
            error.textContent = 'No se pudo conectar con el servidor.';
        }
    });
}

/* ===== ESTADO ===== */
function isAuthenticated() {
    return !!localStorage.getItem(TOKEN_KEY);
}

function getCurrentUser() {
    try {
        return JSON.parse(localStorage.getItem(AUTH_KEY));
    } catch {
        return null;
    }
}

async function logout() {
    const refreshToken = localStorage.getItem(REFRESH_KEY);

    // Confirmación (opcional pero recomendada)
    if (!confirm('¿Seguro que deseas cerrar sesión?')) return;

    // 1. Intentar revocar el refresh token en el backend
    if (refreshToken) {
        try {
            await fetch(`${API_BASE_URL}/Auth/logout`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + localStorage.getItem(TOKEN_KEY)
                },
                body: JSON.stringify({ refreshToken })
            });
        } catch (e) {
            console.warn('Error al cerrar sesión en el backend', e);
        }
    }

    // 2. Limpiar estado de negocio (carritos, historial, etc.)
    if (typeof limpiarEstadoSesion === 'function') {
        limpiarEstadoSesion();
    }

    // 3. Limpiar credenciales
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(AUTH_KEY);

    // 4. Recargar para volver al login
    window.location.reload();
}

/* ===== LOGIN API ===== */
async function login(usuario, clave) {
    try {
        const resp = await fetch(`${API_BASE_URL}/Auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ correo: usuario, password: clave })
        });

        if (!resp.ok) return null;

        const data = await resp.json();
        const accessToken = data.accessToken || data.token;
        if (!accessToken) return null;

        localStorage.setItem(TOKEN_KEY, accessToken);
        if (data.refreshToken) {
            localStorage.setItem(REFRESH_KEY, data.refreshToken);
        }

        const payload = {
            id: data.idUsuario,
            nombre: data.nombre,
            correo: data.correo,
            rol: data.idRol,
            ts: Date.now()
        };
        localStorage.setItem(AUTH_KEY, JSON.stringify(payload));

        return payload;
    } catch (error) {
        console.error(error);
        return null;
    }
}

/* ===== UI LOGIN ===== */
function showLoginModal() {
    const modal = document.getElementById('modalLogin');
    if (!modal) return;
    showModal(modal);
    const appRoot = document.getElementById('contenedor');
    if (appRoot) appRoot.style.filter = 'blur(2px)';
}

function hideLoginModal() {
    const modal = document.getElementById('modalLogin');
    if (!modal) return;
    hideModal(modal);
    const appRoot = document.getElementById('contenedor');
    if (appRoot) appRoot.style.filter = '';
}

/* ===== INIT LOGIN ===== */
function initAuth() {
    const form = document.getElementById('formLogin');
    const error = document.getElementById('loginError');
    const cerrar = document.getElementById('cerrarLogin');

     // ------------------------------------------------------------
    // Botón cerrar (X) del login
    // - Si hay sesión → cierra
    // - Si NO hay sesión → no cierra, muestra aviso
    // ------------------------------------------------------------
    if (cerrar && !cerrar._listenerAttached) {
        cerrar._listenerAttached = true;
        cerrar.addEventListener('click', () => {
            if (isAuthenticated()) {
                hideLoginModal();
                return;
            }

            // Sin sesión → no se puede cerrar
            if (typeof toast === 'function') {
                toast('Debes iniciar sesión para continuar', 'error');
            }

            // Feedback visual: hacer vibrar el modal
            const modalContent = document.querySelector('#modalLogin .modal-content');
            if (modalContent) {
                modalContent.classList.add('shake');
                setTimeout(() => modalContent.classList.remove('shake'), 400);
            }

            // Opcional: enfocar el primer input
            const inputUsuario = document.getElementById('loginUsuario');
            if (inputUsuario) inputUsuario.focus();
        });
    }

    // ------------------------------------------------------------
    // Cerrar con tecla ESC (mismo comportamiento)
    // ------------------------------------------------------------
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;

        const modalLogin = document.getElementById('modalLogin');
        if (!modalLogin || !modalLogin.classList.contains('open')) return;

        if (isAuthenticated()) {
            hideLoginModal();
        } else if (typeof toast === 'function') {
            toast('Debes iniciar sesión para continuar', 'error');
        }
    });

    if (cerrar) {
        cerrar.addEventListener('click', () => {
            if (!isAuthenticated()) return;
            hideLoginModal();
        });
    }

    if (form && !form._listenerAttached) {
        form._listenerAttached = true;

        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const usuario = document.getElementById('loginUsuario').value.trim();
            const clave = document.getElementById('loginClave').value.trim();

            const user = await login(usuario, clave);

            if (user) {
                error.style.display = 'none';
                hideLoginModal();

                const headerUser = document.getElementById('headerUserName');
                if (headerUser) headerUser.textContent = user.nombre;

                // 🆕 NUEVO: actualizar menú según rol
                if (typeof actualizarMenuUsuarios === 'function') {
                    actualizarMenuUsuarios();
                }

                // 1) Cargar productos PRIMERO (con await)
                if (typeof cargarProductosDesdeAPI === 'function') {
                    await cargarProductosDesdeAPI();
                }

                // 2) Luego cambiar de vista
                if (typeof cargarVista === 'function') {
                    cargarVista('ventas');
                }
                 // 🆕 Filtrar accesos rápidos
                if (typeof filtrarAccesosRapidosPorRol === 'function') {
                    filtrarAccesosRapidosPorRol();
                }

                // 🆕 Renderizar accesos rápidos después del login
                if (typeof renderAccesosRapidos === 'function') {
                    setTimeout(() => renderAccesosRapidos(), 300);
                }
                
            } else {
                error.style.display = 'block';
                error.textContent = 'Usuario o contraseña incorrectos';
            }
        });
    }
}

/**
 * Muestra u oculta el ítem de Usuarios en el sidebar según el rol.
 */
function actualizarMenuUsuarios() {
    const usuario = getCurrentUser();
    const menuUsuarios = document.getElementById('menuUsuarios');

    if (!menuUsuarios) return;

    // Solo admin (rol 1) ve el menú
    if (usuario && usuario.rol === 1) {
        menuUsuarios.hidden = false;
    } else {
        menuUsuarios.hidden = true;
    }
}

/* ===== START APP ===== */
document.addEventListener('DOMContentLoaded', async () => {
    console.log("Auth iniciado");

    initAuth();
    initBootstrap();   // ← NUEVO: preparar el form de bootstrap

    // 1. Verificar si hay usuarios en la BD
    const necesitaBootstrap = await verificarBootstrap();

    if (necesitaBootstrap) {
        console.log("🚀 Sistema sin usuarios → mostrar bootstrap");
        showBootstrapModal();
        return;   // no mostramos el login normal
    }

    // 2. Flujo normal: verificar si hay sesión
    const token = localStorage.getItem(TOKEN_KEY);

    if (!token) {
        console.log("No hay token → mostrar login");
        showLoginModal();
        return;
    }

    console.log("Usuario autenticado");

    const user = getCurrentUser();
    const headerUser = document.getElementById('headerUserName');
    if (headerUser && user) {
        headerUser.textContent = user.nombre;
    }
 
    if (typeof actualizarMenuUsuarios === 'function') {
        actualizarMenuUsuarios();
    }

    if (typeof cargarVista === 'function') {
        cargarVista('ventas');
    }
    
});


