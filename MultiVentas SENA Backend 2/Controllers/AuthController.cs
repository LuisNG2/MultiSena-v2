using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authorization;
using MultiVentasPOS.Data;
using MultiVentasPOS.Models;

namespace MultiVentasPOS.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class AuthController : ControllerBase
    {
        private readonly AppDbContext _context;
        private readonly IConfiguration _config;

        // Tiempos de vida (configurables desde appsettings)
        private readonly int _accessTokenMinutos;
        private readonly int _refreshTokenDias;

         private readonly ILogger<AuthController> _logger;   // ← NUEVO

        // ============================================================
        // Rate limiting en memoria para /login
        // 5 intentos por minuto por IP+correo
        // ============================================================
        private static readonly Dictionary<string, (int intentos, DateTime expira)> _intentosLogin = new();
        private static readonly object _lockLogin = new();

        private bool LoginPermitido(string key)
        {
            lock (_lockLogin)
            {
                // Limpieza ocasional para evitar memory leak
                if (_intentosLogin.Count > 1000)
                {
                    var ahora = DateTime.UtcNow;
                    var expirados = _intentosLogin
                        .Where(kv => kv.Value.expira < ahora)
                        .Select(kv => kv.Key)
                        .ToList();
                    foreach (var k in expirados) _intentosLogin.Remove(k);
                }

                if (!_intentosLogin.TryGetValue(key, out var entry) || entry.expira < DateTime.UtcNow)
                {
                    _intentosLogin[key] = (1, DateTime.UtcNow.AddMinutes(1));
                    return true;
                }

                if (entry.intentos >= 5)
                    return false;

                _intentosLogin[key] = (entry.intentos + 1, entry.expira);
                return true;
            }
        }

        private void ResetIntentos(string key)
        {
            lock (_lockLogin) { _intentosLogin.Remove(key); }
        }



        public AuthController(AppDbContext context, IConfiguration config, ILogger<AuthController> logger)
        {
            _context = context;
            _config = config;
            _logger = logger;

            _accessTokenMinutos = int.TryParse(_config["Jwt:AccessTokenMinutos"], out var min) ? min : 60;
            _refreshTokenDias = int.TryParse(_config["Jwt:RefreshTokenDias"], out var dias) ? dias : 7;
        }

       [HttpPost("register")]
        [Authorize(Roles = "1")]
        public async Task<IActionResult> Register([FromBody] UserRequest req)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);

            // Validar correo duplicado
            if (await _context.Usuarios.AnyAsync(u => u.Correo == req.Correo))
                return BadRequest(new { message = "El correo ya está registrado" });

            // Validar que el rol exista
            var rol = await _context.Roles.FindAsync(req.IdRol);
            if (rol == null)
                return BadRequest(new { message = $"El rol con IdRol={req.IdRol} no existe." });

            // Validar estado permitido
            var estadoFinal = string.IsNullOrWhiteSpace(req.Estado) ? "Activo" : req.Estado.Trim();
            if (estadoFinal != "Activo" && estadoFinal != "Inactivo")
                return BadRequest(new { message = "Estado inválido. Use 'Activo' o 'Inactivo'." });

            var usuario = new Usuario
            {
                Nombre = req.Nombre,
                Correo = req.Correo,
                ContrasenaHash = HashPassword(req.Password),
                IdRol = req.IdRol,
                Estado = estadoFinal,
                FechaCreacion = DateTime.UtcNow,
                FechaActualizacion = DateTime.UtcNow
            };

            _context.Usuarios.Add(usuario);
            await _context.SaveChangesAsync();

            return Ok(new { message = "Usuario registrado correctamente", usuario.IdUsuario });
        }

       [HttpPost("login")]
            [AllowAnonymous]
            public async Task<IActionResult> Login([FromBody] LoginRequest request)
            {
                if (request == null) return BadRequest(new { message = "Datos inválidos" });

                // Rate limiting
                var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
                var rateKey = $"{ip}:{request.Correo}";

                if (!LoginPermitido(rateKey))
                {
                    _logger.LogWarning("Rate limit login excedido. IP={Ip}, Correo={Correo}", ip, request.Correo);
                    return StatusCode(429, new { message = "Demasiados intentos. Intenta de nuevo en 1 minuto." });
                }

                var user = await _context.Usuarios.FirstOrDefaultAsync(u => u.Correo == request.Correo);
                if (user == null) return Unauthorized(new { message = "Credenciales inválidas" });

                if (user.Estado != "Activo")
                    return Unauthorized(new { message = "Usuario inactivo. Contacte al administrador." });

                var hash = HashPassword(request.Password);
                if (user.ContrasenaHash != hash)
                    return Unauthorized(new { message = "Credenciales inválidas" });

                var accessToken = GenerarAccessToken(user);
                var refreshToken = await GenerarRefreshToken(user.IdUsuario);

                // ✅ Resetear intentos fallidos al loguear correctamente
                ResetIntentos(rateKey);

                return Ok(new
                {
                    accessToken,
                    refreshToken,
                    expiresIn = _accessTokenMinutos * 60,
                    token = accessToken,
                    user.IdUsuario,
                    user.Nombre,
                    user.Correo,
                    user.IdRol
                });
            }


            // ============================================================
            // GET: api/Auth/necesita-bootstrap
            // Indica si el sistema necesita crear el primer usuario.
            // ============================================================
            [HttpGet("necesita-bootstrap")]
            [AllowAnonymous]
            public async Task<IActionResult> NecesitaBootstrap()
            {
                var existeAlguno = await _context.Usuarios.AnyAsync();
                return Ok(new { necesitaBootstrap = !existeAlguno });
            }

            // ============================================================
            // POST: api/Auth/bootstrap
            // Crea el PRIMER usuario administrador.
            // Solo funciona si NO existe ningún usuario en la base de datos.
            // Una vez creado el primer usuario, este endpoint queda bloqueado.
            // ============================================================
            [HttpPost("bootstrap")]
            [AllowAnonymous]
            public async Task<IActionResult> Bootstrap([FromBody] BootstrapRequest req)
            {
                // 1. Verificar que NO exista ningún usuario
                var existeAlguno = await _context.Usuarios.AnyAsync();
                if (existeAlguno)
                {
                    return Conflict(new
                    {
                        message = "El sistema ya tiene usuarios registrados. Use el login normal."
                    });
                }

                // 2. Validaciones básicas
                if (!ModelState.IsValid) return BadRequest(ModelState);

                if (string.IsNullOrWhiteSpace(req.Nombre))
                    return BadRequest(new { message = "El nombre es obligatorio." });

                if (string.IsNullOrWhiteSpace(req.Correo))
                    return BadRequest(new { message = "El correo es obligatorio." });

                if (string.IsNullOrWhiteSpace(req.Password) || req.Password.Length < 6)
                    return BadRequest(new { message = "La contraseña debe tener al menos 6 caracteres." });

                // 3. Verificar que exista el rol Administrador (id_rol = 1)
                var rolAdmin = await _context.Roles.FirstOrDefaultAsync(r => r.IdRol == 1);
                if (rolAdmin == null)
                {
                    return StatusCode(500, new
                    {
                        message = "Error de configuración: el rol Administrador (IdRol=1) no existe. " +
                                "Ejecute el seed de la base de datos primero."
                    });
                }

                // 4. Crear el admin
                var admin = new Usuario
                {
                    Nombre = req.Nombre.Trim(),
                    Correo = req.Correo.Trim(),
                    ContrasenaHash = HashPassword(req.Password),
                    IdRol = 1,                              // ← FORZADO a Admin
                    Estado = "Activo",
                    FechaCreacion = DateTime.UtcNow,
                    FechaActualizacion = DateTime.UtcNow
                };

                _context.Usuarios.Add(admin);
                await _context.SaveChangesAsync();

                _logger.LogWarning(
                    "🔐 BOOTSTRAP: Primer administrador creado. Id={Id}, Correo={Correo}. " +
                    "Este endpoint ahora está bloqueado.",
                    admin.IdUsuario, admin.Correo);

                // 5. Devolver tokens para que el usuario ya quede logueado
                var accessToken = GenerarAccessToken(admin);
                var refreshToken = await GenerarRefreshToken(admin.IdUsuario);

                return Ok(new
                {
                    message = "Primer administrador creado correctamente. El endpoint de bootstrap ahora está bloqueado.",
                    accessToken,
                    refreshToken,
                    expiresIn = _accessTokenMinutos * 60,
                    token = accessToken,
                    admin.IdUsuario,
                    admin.Nombre,
                    admin.Correo,
                    admin.IdRol
                });
            }

            // DTO
            public class BootstrapRequest
            {
                [System.ComponentModel.DataAnnotations.Required]
                [System.ComponentModel.DataAnnotations.StringLength(100)]
                public string Nombre { get; set; } = string.Empty;

                [System.ComponentModel.DataAnnotations.Required]
                [System.ComponentModel.DataAnnotations.EmailAddress]
                [System.ComponentModel.DataAnnotations.StringLength(100)]
                public string Correo { get; set; } = string.Empty;

                [System.ComponentModel.DataAnnotations.Required]
                [System.ComponentModel.DataAnnotations.StringLength(100, MinimumLength = 6)]
                public string Password { get; set; } = string.Empty;
            }

        // ============================================================
        // POST: api/Auth/refresh
        // ============================================================
        [HttpPost("refresh")]
        [AllowAnonymous]
        public async Task<IActionResult> Refresh([FromBody] RefreshRequest request)
        {
            if (request == null || string.IsNullOrWhiteSpace(request.RefreshToken))
                return BadRequest(new { message = "Refresh token requerido" });

            var refreshTokenDb = await _context.RefreshTokens
                .Include(rt => rt.Usuario)
                .FirstOrDefaultAsync(rt => rt.Token == request.RefreshToken);

            if (refreshTokenDb == null)
                return Unauthorized(new { message = "Refresh token inválido" });

            if (refreshTokenDb.Revocado)
                return Unauthorized(new { message = "Refresh token revocado" });

            if (refreshTokenDb.FechaExpiracion < DateTime.UtcNow)
                return Unauthorized(new { message = "Refresh token expirado. Inicia sesión nuevamente." });

            var user = refreshTokenDb.Usuario;
            if (user == null || user.Estado != "Activo")
                return Unauthorized(new { message = "Usuario inactivo o eliminado" });

            // Rotación: revocar el refresh token viejo
            refreshTokenDb.Revocado = true;
            refreshTokenDb.FechaRevocado = DateTime.UtcNow;

            var nuevoAccessToken = GenerarAccessToken(user);
            var nuevoRefreshToken = await GenerarRefreshToken(user.IdUsuario);

            return Ok(new
            {
                accessToken = nuevoAccessToken,
                refreshToken = nuevoRefreshToken,
                expiresIn = _accessTokenMinutos * 60,
                token = nuevoAccessToken,
                user.IdUsuario,
                user.Nombre,
                user.Correo,
                user.IdRol
            });
        }

        // ============================================================
        // POST: api/Auth/logout
        // ============================================================
        [HttpPost("logout")]
        [Authorize]
        public async Task<IActionResult> Logout([FromBody] RefreshRequest? request)
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (!int.TryParse(userIdClaim, out int idUsuario))
                return Unauthorized(new { message = "Usuario no identificado" });

            if (request?.RefreshToken != null)
            {
                // Revocar solo ese refresh token
                var token = await _context.RefreshTokens
                    .FirstOrDefaultAsync(rt => rt.Token == request.RefreshToken && rt.IdUsuario == idUsuario);

                if (token != null)
                {
                    token.Revocado = true;
                    token.FechaRevocado = DateTime.UtcNow;
                }
            }
            else
            {
                // Revocar TODOS los refresh tokens del usuario
                var tokens = await _context.RefreshTokens
                    .Where(rt => rt.IdUsuario == idUsuario && !rt.Revocado)
                    .ToListAsync();

                foreach (var t in tokens)
                {
                    t.Revocado = true;
                    t.FechaRevocado = DateTime.UtcNow;
                }
            }

            await _context.SaveChangesAsync();
            return Ok(new { message = "Sesión cerrada correctamente" });
        }

        // ============================================================
        // HELPERS
        // ============================================================

        private string GenerarAccessToken(Usuario user)
        {
            var claims = new[]
            {
                new Claim(ClaimTypes.NameIdentifier, user.IdUsuario.ToString()),
                new Claim(ClaimTypes.Email, user.Correo),
                new Claim(ClaimTypes.Role, user.IdRol.ToString()),
                new Claim("nombre", user.Nombre)
            };

            var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_config["Jwt:Key"]!));
            var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

            var token = new JwtSecurityToken(
                issuer: _config["Jwt:Issuer"],
                audience: _config["Jwt:Audience"],
                claims: claims,
                expires: DateTime.UtcNow.AddMinutes(_accessTokenMinutos),
                signingCredentials: creds
            );

            return new JwtSecurityTokenHandler().WriteToken(token);
        }

        private async Task<string> GenerarRefreshToken(int idUsuario)
        {
            // String aleatorio URL-safe de 64 bytes
            var bytes = new byte[64];
            using (var rng = RandomNumberGenerator.Create())
            {
                rng.GetBytes(bytes);
            }
            var token = Convert.ToBase64String(bytes)
                .Replace("+", "-")
                .Replace("/", "_")
                .Replace("=", "");

            var refreshToken = new RefreshToken
            {
                IdUsuario = idUsuario,
                Token = token,
                FechaCreacion = DateTime.UtcNow,
                FechaExpiracion = DateTime.UtcNow.AddDays(_refreshTokenDias),
                Revocado = false
            };

            _context.RefreshTokens.Add(refreshToken);
            await _context.SaveChangesAsync();

            return token;
        }

        private string HashPassword(string password)
        {
            using (var sha = SHA256.Create())
            {
                var bytes = Encoding.UTF8.GetBytes(password);
                var hash = sha.ComputeHash(bytes);
                return Convert.ToBase64String(hash);
            }
        }
    }

    // ============================================================
    // DTOs
    // ============================================================
    public class RefreshRequest
    {
        public string? RefreshToken { get; set; }
    }
}