using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MultiVentasPOS.Data;
using MultiVentasPOS.Models;
using System.Security.Claims;

namespace MultiVentasPOS.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class CategoriasController : ControllerBase
    {
        private readonly AppDbContext _context;
        private readonly ILogger<CategoriasController> _logger;

        public CategoriasController(AppDbContext context, ILogger<CategoriasController> logger)
        {
            _context = context;
            _logger = logger;
        }

        // GET: api/Categorias
        [HttpGet]
        [Authorize]
        public async Task<IActionResult> GetAll()
        {
            _logger.LogInformation("GetAll categorias called. User={User}", User.Identity?.Name ?? "anonymous");

            var categorias = await _context.Categorias
                .Select(c => new CategoriaDto
                {
                    IdCategoria = c.IdCategoria,
                    Nombre = c.Nombre,
                    Descripcion = c.Descripcion
                })
                .ToListAsync();

            return Ok(categorias);
        }

        // GET: api/Categorias/5
        [HttpGet("{id:int}")]
        [Authorize]
        public async Task<IActionResult> GetById(int id)
        {
            var categoria = await _context.Categorias
                .Where(c => c.IdCategoria == id)
                .Select(c => new CategoriaDto
                {
                    IdCategoria = c.IdCategoria,
                    Nombre = c.Nombre,
                    Descripcion = c.Descripcion
                })
                .FirstOrDefaultAsync();

            if (categoria == null) return NotFound();
            return Ok(categoria);
        }

        // POST: api/Categorias
        // Requiere rol Admin (ejemplo: IdRol = 1). Ajusta según tu convención de roles.
        [HttpPost]
        [Authorize(Roles = "1")]
        public async Task<IActionResult> Create([FromBody] CreateCategoriaRequest req)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);

            try
            {

                var categoria = new Categoria
                {
                    Nombre = req.Nombre.Trim(),
                    Descripcion = string.IsNullOrWhiteSpace(req.Descripcion) ? null : req.Descripcion.Trim()
                };         

                _context.Categorias.Add(categoria);
                await _context.SaveChangesAsync();

                var dto = new CategoriaDto
                {
                    IdCategoria = categoria.IdCategoria,
                    Nombre = categoria.Nombre,
                    Descripcion = categoria.Descripcion
                };

                return CreatedAtAction(nameof(GetById), new { id = categoria.IdCategoria }, dto);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error creating categoria. Nombre={Nombre}", req.Nombre);
                return StatusCode(500, "Error interno al crear la categoría");
            }
        }

        // PUT: api/Categorias/5
        [HttpPut("{id:int}")]
        [Authorize(Roles = "1")]
        public async Task<IActionResult> Update(int id, [FromBody] UpdateCategoriaRequest req)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);
            var categoria = await _context.Categorias.FindAsync(id);
            if (categoria == null) return NotFound();

            categoria.Nombre = req.Nombre ?? categoria.Nombre;
            categoria.Descripcion = req.Descripcion ?? categoria.Descripcion;

            try
            {
                _context.Categorias.Update(categoria);
                await _context.SaveChangesAsync();
                return NoContent();
            }
            catch (DbUpdateConcurrencyException ex)
            {
                _logger.LogWarning(ex, "Concurrency issue updating categoria Id={Id}", id);
                if (!_context.Categorias.Any(e => e.IdCategoria == id)) return NotFound();
                throw;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error updating categoria Id={Id}", id);
                return StatusCode(500, "Error interno al actualizar la categoría");
            }
        }

            [HttpDelete("{id:int}")]
    [Authorize(Roles = "1")]
    public async Task<IActionResult> Delete(int id)
            {
                var categoria = await _context.Categorias.FindAsync(id);
                if (categoria == null)
                    return NotFound(new { message = "Categoría no encontrada." });

                // ⬇️ NUEVO: Validar que no tenga productos asociados
                var cantidadProductos = await _context.Productos.CountAsync(p => p.IdCategoria == id);
                if (cantidadProductos > 0)
                {
                    return Conflict(new
                    {
                        message = $"No se puede eliminar la categoría '{categoria.Nombre}' porque tiene {cantidadProductos} producto(s) asociado(s). Primero reasigna o elimina esos productos."
                    });
                }

                try
                {
                    _context.Categorias.Remove(categoria);
                    await _context.SaveChangesAsync();

                    _logger.LogInformation("Categoría eliminada: {Id} - {Nombre}", id, categoria.Nombre);
                    return NoContent();
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error deleting categoria Id={Id}", id);
                    return StatusCode(500, new { message = "Error interno al eliminar la categoría." });
                }
            }
        }

    // DTOs y Requests
    public class CategoriaDto
    {
        public int IdCategoria { get; set; }
        public string Nombre { get; set; }
        public string? Descripcion { get; set; }
    }

    public class CreateCategoriaRequest
    {
        [System.ComponentModel.DataAnnotations.Required]
        [System.ComponentModel.DataAnnotations.StringLength(100)]
        public string Nombre { get; set; }

        [System.ComponentModel.DataAnnotations.StringLength(500)]
        public string? Descripcion { get; set; }
    }

    public class UpdateCategoriaRequest
    {
        [System.ComponentModel.DataAnnotations.StringLength(100)]
        public string Nombre { get; set; }

        [System.ComponentModel.DataAnnotations.StringLength(500)]
        public string? Descripcion { get; set; }
    }
}
