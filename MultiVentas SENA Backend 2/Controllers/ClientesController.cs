using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authorization;
using MultiVentasPOS.Data;
using MultiVentasPOS.Models;

namespace MultiVentasPOS.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class ClientesController : ControllerBase
    {
        private readonly AppDbContext _context;
        private readonly ILogger<ClientesController> _logger;

        private static readonly string[] TiposClienteValidos =
            { "Frecuente", "Nuevo", "Corporativo" };

        public ClientesController(AppDbContext context, ILogger<ClientesController> logger)
        {
            _context = context;
            _logger = logger;
        }

        // ============================================================
        // GET: api/Clientes
        // ============================================================
        [HttpGet]
        public async Task<ActionResult<IEnumerable<ClienteDto>>> GetAll(
            [FromQuery] int page = 1,
            [FromQuery] int pageSize = 50)
        {
            page = Math.Max(1, page);
            pageSize = Math.Clamp(pageSize, 1, 200);

            var query = _context.Clientes
                .AsNoTracking()
                .OrderBy(c => c.IdCliente);

            var total = await query.CountAsync();

            var items = await query
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .Select(c => new ClienteDto
                {
                    IdCliente = c.IdCliente,
                    Documento = c.Documento,
                    Nombre = c.Nombre,
                    Correo = c.Correo,
                    Telefono = c.Telefono,
                    Ciudad = c.Ciudad,
                    Direccion = c.Direccion,
                    TipoCliente = c.TipoCliente,
                    FechaCreacion = c.FechaCreacion
                })
                .ToListAsync();

            Response.Headers["X-Total-Count"] = total.ToString();
            return Ok(items);
        }

        // ============================================================
        // GET: api/Clientes/5
        // ============================================================
        [HttpGet("{id:int}")]
        public async Task<ActionResult<ClienteDto>> Get(int id)
        {
            var cliente = await _context.Clientes
                .AsNoTracking()
                .Where(x => x.IdCliente == id)
                .Select(x => new ClienteDto
                {
                    IdCliente = x.IdCliente,
                    Documento = x.Documento,
                    Nombre = x.Nombre,
                    Correo = x.Correo,
                    Telefono = x.Telefono,
                    Ciudad = x.Ciudad,
                    Direccion = x.Direccion,
                    TipoCliente = x.TipoCliente,
                    FechaCreacion = x.FechaCreacion
                })
                .FirstOrDefaultAsync();

            if (cliente == null)
                return NotFound(new { message = "Cliente no encontrado." });

            return Ok(cliente);
        }

        // ============================================================
        // GET: api/Clientes/search?q=term
        // ============================================================
        [HttpGet("search")]
        public async Task<ActionResult<IEnumerable<ClienteDto>>> Search([FromQuery] string q)
        {
            if (string.IsNullOrWhiteSpace(q))
                return BadRequest(new { message = "Debe indicar un texto para buscar." });

            q = q.Trim();

            var results = await _context.Clientes
                .AsNoTracking()
                .Where(c =>
                    c.Nombre.Contains(q) ||
                    (c.Documento != null && c.Documento.Contains(q)) ||
                    (c.Correo != null && c.Correo.Contains(q)) ||
                    (c.Telefono != null && c.Telefono.Contains(q)))
                .OrderBy(c => c.Nombre)
                .Take(50)
                .Select(c => new ClienteDto
                {
                    IdCliente = c.IdCliente,
                    Documento = c.Documento,
                    Nombre = c.Nombre,
                    Correo = c.Correo,
                    Telefono = c.Telefono,
                    Ciudad = c.Ciudad,
                    Direccion = c.Direccion,
                    TipoCliente = c.TipoCliente,
                    FechaCreacion = c.FechaCreacion
                })
                .ToListAsync();

            return Ok(results);
        }

        // ============================================================
        // POST: api/Clientes
        // ============================================================
        [HttpPost]
        [Authorize(Roles = "1")]
        public async Task<ActionResult<ClienteDto>> Create([FromBody] ClienteCreateDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);

            // Documento → null si vacío
            string? documento = null;
            if (dto.Documento != null && !string.IsNullOrWhiteSpace(dto.Documento))
                documento = dto.Documento.Trim();

            // Validar duplicado de documento
            if (documento != null)
            {
                var existe = await _context.Clientes.AnyAsync(c => c.Documento == documento);
                if (existe)
                    return Conflict(new { message = "Ya existe un cliente con ese documento." });
            }

            // Correo → null si vacío
            string? correo = null;
            if (dto.Correo != null && !string.IsNullOrWhiteSpace(dto.Correo))
                correo = dto.Correo.Trim();

            // Teléfono → null si vacío
            string? telefono = null;
            if (dto.Telefono != null && !string.IsNullOrWhiteSpace(dto.Telefono))
                telefono = dto.Telefono.Trim();

            // Ciudad → null si vacío
            string? ciudad = null;
            if (dto.Ciudad != null && !string.IsNullOrWhiteSpace(dto.Ciudad))
                ciudad = dto.Ciudad.Trim();

            // Dirección → null si vacío
            string? direccion = null;
            if (dto.Direccion != null && !string.IsNullOrWhiteSpace(dto.Direccion))
                direccion = dto.Direccion.Trim();

            // Tipo de cliente → default 'Nuevo'
            var tipoCliente = "Nuevo";
            if (dto.TipoCliente != null && !string.IsNullOrWhiteSpace(dto.TipoCliente))
            {
                tipoCliente = dto.TipoCliente.Trim();
                if (!TiposClienteValidos.Contains(tipoCliente))
                    return BadRequest(new { 
                        message = "TipoCliente inválido. Valores permitidos: Frecuente, Nuevo, Corporativo." 
                    });
            }

            var ahora = DateTime.UtcNow;

            var cliente = new Cliente
            {
                Documento = documento,
                Nombre = dto.Nombre.Trim(),
                Correo = correo,
                Telefono = telefono,
                Ciudad = ciudad,
                Direccion = direccion,
                TipoCliente = tipoCliente,
                FechaCreacion = ahora
            };

            _context.Clientes.Add(cliente);
            await _context.SaveChangesAsync();

            _logger.LogInformation("Cliente creado: {IdCliente} - {Nombre}",
                cliente.IdCliente, cliente.Nombre);

            var result = new ClienteDto
            {
                IdCliente = cliente.IdCliente,
                Documento = cliente.Documento,
                Nombre = cliente.Nombre,
                Correo = cliente.Correo,
                Telefono = cliente.Telefono,
                Ciudad = cliente.Ciudad,
                Direccion = cliente.Direccion,
                TipoCliente = cliente.TipoCliente,
                FechaCreacion = cliente.FechaCreacion
            };

            return CreatedAtAction(nameof(Get), new { id = cliente.IdCliente }, result);
        }

        // ============================================================
        // PUT: api/Clientes/5
        // ============================================================
        [HttpPut("{id:int}")]
        [Authorize(Roles = "1")]
        public async Task<IActionResult> Update(int id, [FromBody] ClienteUpdateDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);

            var cliente = await _context.Clientes.FindAsync(id);
            if (cliente == null)
                return NotFound(new { message = "Cliente no encontrado." });

            // Documento
            if (dto.Documento != null)
            {
                if (!string.IsNullOrWhiteSpace(dto.Documento))
                {
                    var doc = dto.Documento.Trim();
                    var dup = await _context.Clientes
                        .AnyAsync(c => c.IdCliente != id && c.Documento == doc);
                    if (dup)
                        return Conflict(new { message = "El documento ya pertenece a otro cliente." });
                    cliente.Documento = doc;
                }
                else
                {
                    cliente.Documento = null;
                }
            }

            // Nombre
            if (dto.Nombre != null)
            {
                if (string.IsNullOrWhiteSpace(dto.Nombre))
                    return BadRequest(new { message = "El nombre no puede estar vacío." });
                cliente.Nombre = dto.Nombre.Trim();
            }

            // Correo
            if (dto.Correo != null)
            {
                if (string.IsNullOrWhiteSpace(dto.Correo))
                    cliente.Correo = null;
                else
                    cliente.Correo = dto.Correo.Trim();
            }

            // Teléfono
            if (dto.Telefono != null)
            {
                if (string.IsNullOrWhiteSpace(dto.Telefono))
                    cliente.Telefono = null;
                else
                    cliente.Telefono = dto.Telefono.Trim();
            }

            // Ciudad
            if (dto.Ciudad != null)
            {
                if (string.IsNullOrWhiteSpace(dto.Ciudad))
                    cliente.Ciudad = null;
                else
                    cliente.Ciudad = dto.Ciudad.Trim();
            }

            // Dirección
            if (dto.Direccion != null)
            {
                if (string.IsNullOrWhiteSpace(dto.Direccion))
                    cliente.Direccion = null;
                else
                    cliente.Direccion = dto.Direccion.Trim();
            }

            // Tipo de cliente
            if (dto.TipoCliente != null)
            {
                if (string.IsNullOrWhiteSpace(dto.TipoCliente))
                    return BadRequest(new { message = "El tipo de cliente no puede estar vacío." });

                var tipoCliente = dto.TipoCliente.Trim();
                if (!TiposClienteValidos.Contains(tipoCliente))
                    return BadRequest(new { 
                        message = "TipoCliente inválido. Valores permitidos: Frecuente, Nuevo, Corporativo." 
                    });

                cliente.TipoCliente = tipoCliente;
            }

            await _context.SaveChangesAsync();

            _logger.LogInformation("Cliente actualizado: {IdCliente}", id);
            return NoContent();
        }

        // ============================================================
        // DELETE: api/Clientes/5
        // ============================================================
        [HttpDelete("{id:int}")]
        [Authorize(Roles = "1")]
        public async Task<IActionResult> Delete(int id)
        {
            var cliente = await _context.Clientes.FindAsync(id);
            if (cliente == null)
                return NotFound(new { message = "Cliente no encontrado." });

            var tieneVentas = await _context.Ventas.AnyAsync(v => v.IdCliente == id);
            if (tieneVentas)
                return Conflict(new { 
                    message = "No se puede eliminar: el cliente tiene ventas asociadas." 
                });

            _context.Clientes.Remove(cliente);
            await _context.SaveChangesAsync();

            _logger.LogInformation("Cliente eliminado: {IdCliente}", id);
            return NoContent();
        }
    }

    #region DTOs
    public class ClienteDto
    {
        public int IdCliente { get; set; }
        public string? Documento { get; set; }
        public string Nombre { get; set; } = string.Empty;
        public string? Correo { get; set; }
        public string? Telefono { get; set; }
        public string? Ciudad { get; set; }
        public string? Direccion { get; set; }
        public string TipoCliente { get; set; } = "Nuevo";
        public DateTime FechaCreacion { get; set; }
    }

    public class ClienteCreateDto
    {
        public string? Documento { get; set; }
        public string Nombre { get; set; } = string.Empty;
        public string? Correo { get; set; }
        public string? Telefono { get; set; }
        public string? Ciudad { get; set; }
        public string? Direccion { get; set; }
        public string? TipoCliente { get; set; }
    }

    public class ClienteUpdateDto
    {
        public string? Documento { get; set; }
        public string? Nombre { get; set; }
        public string? Correo { get; set; }
        public string? Telefono { get; set; }
        public string? Ciudad { get; set; }
        public string? Direccion { get; set; }
        public string? TipoCliente { get; set; }
    }
    #endregion
}