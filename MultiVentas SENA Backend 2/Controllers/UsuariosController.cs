using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using MultiVentasPOS.Data;
using MultiVentasPOS.Models;

namespace MultiVentasPOS.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize(Roles = "1")]   // ← TODO el controller solo para Admin
    public class UsuariosController : ControllerBase
    {
        private readonly AppDbContext _context;
        private readonly ILogger<UsuariosController> _logger;

        public UsuariosController(AppDbContext context, ILogger<UsuariosController> logger)
        {
            _context = context;
            _logger = logger;
        }

        // ============================================================
        // GET: api/Usuarios
        // ============================================================
        [HttpGet]
        public async Task<IActionResult> GetAll()
        {
            var usuarios = await _context.Usuarios
                .Include(u => u.Rol)
                .Select(u => new
                {
                    u.IdUsuario,
                    u.Nombre,
                    u.Correo,
                    u.IdRol,
                    Rol = u.Rol != null ? u.Rol.NombreRol : null,
                    u.Estado,
                    u.FechaCreacion,
                    u.FechaActualizacion
                })
                .ToListAsync();

            return Ok(usuarios);
        }

        // ============================================================
        // GET: api/Usuarios/5
        // ============================================================
        [HttpGet("{id:int}")]
        public async Task<IActionResult> GetById(int id)
        {
            var usuario = await _context.Usuarios
                .Include(u => u.Rol)
                .Where(u => u.IdUsuario == id)
                .Select(u => new
                {
                    u.IdUsuario,
                    u.Nombre,
                    u.Correo,
                    u.IdRol,
                    Rol = u.Rol != null ? u.Rol.NombreRol : null,
                    u.Estado,
                    u.FechaCreacion,
                    u.FechaActualizacion
                })
                .FirstOrDefaultAsync();

            if (usuario == null) return NotFound(new { message = "Usuario no encontrado." });
            return Ok(usuario);
        }

        // ============================================================
        // PUT: api/Usuarios/5
        // ============================================================
        [HttpPut("{id:int}")]
        public async Task<IActionResult> Update(int id, [FromBody] UpdateUserRequest req)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);

            var usuario = await _context.Usuarios.FindAsync(id);
            if (usuario == null) return NotFound(new { message = "Usuario no encontrado." });

            // Obtener id del admin que hace la petición
            var adminIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (!int.TryParse(adminIdClaim, out int adminId))
                return Unauthorized(new { message = "Usuario no identificado." });

            // 🛡️ Protecciones
            // 1) Un admin no puede quitarse el rol a sí mismo (evita quedarse sin admin)
            if (adminId == id && req.IdRol.HasValue && req.IdRol.Value != 1)
                return BadRequest(new { message = "No puedes cambiar tu propio rol." });

            // 2) Un admin no puede desactivarse a sí mismo
            if (adminId == id && req.Estado == "Inactivo")
                return BadRequest(new { message = "No puedes desactivar tu propio usuario." });

            // Validar que el nuevo rol exista
            if (req.IdRol.HasValue)
            {
                var rolExiste = await _context.Roles.AnyAsync(r => r.IdRol == req.IdRol.Value);
                if (!rolExiste)
                    return BadRequest(new { message = "El rol indicado no existe." });
            }

            // Validar correo duplicado si se está cambiando
            if (!string.IsNullOrWhiteSpace(req.Correo) && req.Correo != usuario.Correo)
            {
                var dup = await _context.Usuarios
                    .AnyAsync(u => u.IdUsuario != id && u.Correo == req.Correo);
                if (dup)
                    return Conflict(new { message = "El correo ya está en uso por otro usuario." });
            }

            // Actualizar solo si viene valor
            if (!string.IsNullOrWhiteSpace(req.Nombre))
                usuario.Nombre = req.Nombre.Trim();

            if (!string.IsNullOrWhiteSpace(req.Correo))
                usuario.Correo = req.Correo.Trim();

            if (!string.IsNullOrWhiteSpace(req.Password))
                usuario.ContrasenaHash = HashPassword(req.Password);

            if (req.IdRol.HasValue)
                usuario.IdRol = req.IdRol.Value;

            if (!string.IsNullOrWhiteSpace(req.Estado))
            {
                if (req.Estado != "Activo" && req.Estado != "Inactivo")
                    return BadRequest(new { message = "Estado inválido. Use 'Activo' o 'Inactivo'." });
                usuario.Estado = req.Estado;
            }

            usuario.FechaActualizacion = DateTime.UtcNow;

            await _context.SaveChangesAsync();

            _logger.LogInformation("Usuario {Id} actualizado por admin {AdminId}", id, adminId);
            return NoContent();
        }

        // ============================================================
            // POST: api/Usuarios
            // Crear un usuario nuevo (solo admin)
            // ============================================================
            [HttpPost]
            public async Task<IActionResult> Create([FromBody] CreateUserRequest req)
            {
                if (!ModelState.IsValid) return BadRequest(ModelState);

                // Validaciones básicas
                if (string.IsNullOrWhiteSpace(req.Nombre))
                    return BadRequest(new { message = "El nombre es obligatorio." });

                if (string.IsNullOrWhiteSpace(req.Correo))
                    return BadRequest(new { message = "El correo es obligatorio." });

                if (string.IsNullOrWhiteSpace(req.Password) || req.Password.Length < 6)
                    return BadRequest(new { message = "La contraseña debe tener al menos 6 caracteres." });

                // Correo duplicado
                if (await _context.Usuarios.AnyAsync(u => u.Correo == req.Correo))
                    return Conflict(new { message = "El correo ya está registrado." });

                // Validar rol
                var rol = await _context.Roles.FindAsync(req.IdRol);
                if (rol == null)
                    return BadRequest(new { message = $"El rol con IdRol={req.IdRol} no existe." });

                // Validar estado
                var estadoFinal = string.IsNullOrWhiteSpace(req.Estado) ? "Activo" : req.Estado.Trim();
                if (estadoFinal != "Activo" && estadoFinal != "Inactivo")
                    return BadRequest(new { message = "Estado inválido. Use 'Activo' o 'Inactivo'." });

                // Crear
                var usuario = new Usuario
                {
                    Nombre = req.Nombre.Trim(),
                    Correo = req.Correo.Trim(),
                    ContrasenaHash = HashPassword(req.Password),
                    IdRol = req.IdRol,
                    Estado = estadoFinal,
                    FechaCreacion = DateTime.UtcNow,
                    FechaActualizacion = DateTime.UtcNow
                };

                _context.Usuarios.Add(usuario);
                await _context.SaveChangesAsync();

                _logger.LogInformation("Usuario creado: {Id} - {Correo}", usuario.IdUsuario, usuario.Correo);

                return Ok(new
                {
                    usuario.IdUsuario,
                    usuario.Nombre,
                    usuario.Correo,
                    usuario.IdRol,
                    Rol = rol.NombreRol,
                    usuario.Estado,
                    usuario.FechaCreacion
                });
            }

        // ============================================================
        // DELETE: api/Usuarios/5
        // ============================================================
        [HttpDelete("{id:int}")]
        public async Task<IActionResult> Delete(int id)
        {
            var usuario = await _context.Usuarios.FindAsync(id);
            if (usuario == null) return NotFound(new { message = "Usuario no encontrado." });

            var adminIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (!int.TryParse(adminIdClaim, out int adminId))
                return Unauthorized(new { message = "Usuario no identificado." });

            // 🛡️ 1) No puedes eliminarte a ti mismo
            if (adminId == id)
                return BadRequest(new { message = "No puedes eliminar tu propio usuario." });

            // 🛡️ 2) No puedes eliminar al último administrador activo
            var adminsRestantes = await _context.Usuarios
                .CountAsync(u => u.IdRol == 1 && u.Estado == "Activo" && u.IdUsuario != id);

            if (usuario.IdRol == 1 && adminsRestantes == 0)
                return BadRequest(new { message = "No puedes eliminar al último administrador activo." });

            // 🛡️ 3) No eliminar si tiene ventas asociadas (integridad)
            var tieneVentas = await _context.Ventas.AnyAsync(v => v.IdUsuario == id);
            if (tieneVentas)
                return Conflict(new { message = "No se puede eliminar: el usuario tiene ventas registradas. Desactívalo en su lugar." });

            // 🛡️ 4) No eliminar si tiene movimientos de inventario
            var tieneMovimientos = await _context.MovimientosInventario.AnyAsync(m => m.IdUsuario == id);
            if (tieneMovimientos)
                return Conflict(new { message = "No se puede eliminar: el usuario tiene movimientos de inventario. Desactívalo en su lugar." });

            _context.Usuarios.Remove(usuario);
            await _context.SaveChangesAsync();

            _logger.LogWarning("Usuario {Id} eliminado por admin {AdminId}", id, adminId);
            return NoContent();
        }

        // -----------------------
        // Helpers
        // -----------------------
        private string HashPassword(string password)
        {
            if (string.IsNullOrEmpty(password)) return string.Empty;
            using var sha = System.Security.Cryptography.SHA256.Create();
            var bytes = System.Text.Encoding.UTF8.GetBytes(password);
            var hash = sha.ComputeHash(bytes);
            return Convert.ToBase64String(hash);
        }
    }

    public class CreateUserRequest
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

        [System.ComponentModel.DataAnnotations.Required]
        public int IdRol { get; set; }

        public string? Estado { get; set; } = "Activo";
    }

    public class UpdateUserRequest
    {
        [System.ComponentModel.DataAnnotations.StringLength(100)]
        public string? Nombre { get; set; }

        [System.ComponentModel.DataAnnotations.EmailAddress]
        [System.ComponentModel.DataAnnotations.StringLength(100)]
        public string? Correo { get; set; }

        [System.ComponentModel.DataAnnotations.StringLength(100, MinimumLength = 6)]
        public string? Password { get; set; }

        public int? IdRol { get; set; }
        public string? Estado { get; set; }
    }
}