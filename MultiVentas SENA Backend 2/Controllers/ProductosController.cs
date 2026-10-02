using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Logging;
using System.Security.Claims;
using System.Threading.Tasks;
using System.Collections.Generic;
using System.Linq;
using System;
using MultiVentasPOS.Data;
using MultiVentasPOS.Models;

namespace MultiVentasPOS.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class ProductosController : ControllerBase
    {
        private readonly AppDbContext _context;
        private readonly ILogger<ProductosController> _logger;

        public ProductosController(AppDbContext context, ILogger<ProductosController> logger)
        {
            _context = context;
            _logger = logger;
        }

        

        // ============================================================
        // GET: api/Productos?page=1&pageSize=50
        // ============================================================
        [HttpGet]
        public async Task<ActionResult<IEnumerable<ProductoDto>>> GetAll(
            [FromQuery] int page = 1,
            [FromQuery] int pageSize = 50)
        {
            page = Math.Max(1, page);
            pageSize = Math.Clamp(pageSize, 1, 500);

            var query = _context.Productos
                .AsNoTracking()
                .Include(p => p.Categoria)
                .OrderBy(p => p.IdProducto);

            var total = await query.CountAsync();

            var items = await query
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .Select(p => new ProductoDto
                {
                    IdProducto = p.IdProducto,
                    CodigoInterno = p.CodigoInterno,
                    Sku = p.Sku,
                    Nombre = p.Nombre,
                    IdCategoria = p.IdCategoria,
                    CategoriaNombre = p.Categoria != null ? p.Categoria.Nombre : null,
                    Proveedor = p.Proveedor,
                    PrecioVenta = p.PrecioVenta,
                    CostoBase = p.CostoBase,
                    StockActual = p.StockActual,
                    StockMinimo = p.StockMinimo,
                    ImpuestoPorcentaje = p.ImpuestoPorcentaje,
                    VecesVendido = p.VecesVendido,
                    Estado = p.Estado,
                    FechaCreacion = p.FechaCreacion,
                    FechaActualizacion = p.FechaActualizacion
                })
                .ToListAsync();

            Response.Headers["X-Total-Count"] = total.ToString();
            return Ok(items);
        }

        // ============================================================
        // GET: api/Productos/catalogo?page=1&pageSize=300&categoriaId=&buscar=
        // Endpoint optimizado para el catálogo del POS.
        // - Proyección liviana (solo campos necesarios)
        // - Paginación eficiente
        // - Búsqueda server-side
        // ============================================================
        [HttpGet("catalogo")]
        public async Task<IActionResult> GetCatalogo(
            [FromQuery] int page = 1,
            [FromQuery] int pageSize = 300,
            [FromQuery] int? categoriaId = null,
            [FromQuery] string? buscar = null)
        {
            page = Math.Max(1, page);
            pageSize = Math.Clamp(pageSize, 1, 500);  // máximo 500 por request

            var query = _context.Productos
                .AsNoTracking()
                .Where(p => p.Estado == "Activo");

            // Filtro por categoría
            if (categoriaId.HasValue)
                query = query.Where(p => p.IdCategoria == categoriaId.Value);

            // Búsqueda server-side
            if (!string.IsNullOrWhiteSpace(buscar))
            {
                var b = buscar.Trim();
                query = query.Where(p =>
                    p.Nombre.Contains(b) ||
                    p.CodigoInterno.Contains(b) ||
                    (p.Sku != null && p.Sku.Contains(b)));
            }

            var total = await query.CountAsync();

            var items = await query
                .OrderByDescending(p => p.VecesVendido)   // los más vendidos primero
                .ThenBy(p => p.Nombre)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .Select(p => new
                {
                    p.IdProducto,
                    p.CodigoInterno,
                    p.Sku,
                    p.Nombre,
                    p.IdCategoria,
                    CategoriaNombre = p.Categoria != null ? p.Categoria.Nombre : null,
                    p.PrecioVenta,
                    p.StockActual,
                    p.StockMinimo,
                    p.VecesVendido
                })
                .ToListAsync();

            Response.Headers["X-Total-Count"] = total.ToString();
            Response.Headers["X-Page"] = page.ToString();
            Response.Headers["X-Page-Size"] = pageSize.ToString();
            Response.Headers["X-Total-Pages"] = ((int)Math.Ceiling(total / (double)pageSize)).ToString();

            return Ok(new
            {
                items,
                total,
                page,
                pageSize,
                totalPages = (int)Math.Ceiling(total / (double)pageSize),
                hayMas = page * pageSize < total
            });
        }

        // ============================================================
        // GET: api/Productos/categorias-resumen
        // Devuelve SOLO las categorías con conteo de productos activos.
        // Mucho más liviano que traer todos los productos.
        // ============================================================
        [HttpGet("categorias-resumen")]
        public async Task<IActionResult> GetCategoriasResumen()
        {
            var resumen = await _context.Categorias
                .AsNoTracking()
                .Select(c => new
                {
                    c.IdCategoria,
                    c.Nombre,
                    CantidadProductos = c.Productos.Count(p => p.Estado == "Activo")
                })
                .OrderBy(c => c.Nombre)
                .ToListAsync();

            return Ok(resumen);
        }

        // ============================================================
        // GET: api/Productos/5
        // ============================================================
        [HttpGet("{id:int}")]
        public async Task<ActionResult<ProductoDto>> Get(int id)
        {
            var p = await _context.Productos
                .AsNoTracking()
                .Include(x => x.Categoria)
                .Where(x => x.IdProducto == id)
                .Select(x => new ProductoDto
                {
                    IdProducto = x.IdProducto,
                    CodigoInterno = x.CodigoInterno,
                    Sku = x.Sku,
                    Nombre = x.Nombre,
                    IdCategoria = x.IdCategoria,
                    CategoriaNombre = x.Categoria != null ? x.Categoria.Nombre : null,
                    Proveedor = x.Proveedor,
                    PrecioVenta = x.PrecioVenta,
                    CostoBase = x.CostoBase,
                    StockActual = x.StockActual,
                    StockMinimo = x.StockMinimo,
                    ImpuestoPorcentaje = x.ImpuestoPorcentaje,
                    VecesVendido = x.VecesVendido,
                    Estado = x.Estado,
                    FechaCreacion = x.FechaCreacion,
                    FechaActualizacion = x.FechaActualizacion
                })
                .FirstOrDefaultAsync();

            if (p == null) return NotFound();
            return Ok(p);
        }

        // ============================================================
        // POST: api/Productos
        // ============================================================
        [HttpPost]
        [Authorize(Roles = "1")]
        public async Task<ActionResult<ProductoDto>> Create([FromBody] ProductoCreateDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);

            // Validaciones de negocio
                if (string.IsNullOrWhiteSpace(dto.CodigoInterno))
                    return BadRequest(new { message = "El código interno es obligatorio." });

                if (string.IsNullOrWhiteSpace(dto.Nombre))
                    return BadRequest(new { message = "El nombre es obligatorio." });

                if (dto.PrecioVenta <= 0)
                    return BadRequest(new { message = "El precio de venta debe ser mayor a 0." });

                if (dto.StockActual < 0)
                    return BadRequest(new { message = "El stock no puede ser negativo." });

            // Extraer idUsuario del JWT
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(userIdClaim) || !int.TryParse(userIdClaim, out int idUsuario))
                return Unauthorized(new { message = "Usuario no identificado." });

            // Validar unicidad de codigo_interno
            if (!string.IsNullOrWhiteSpace(dto.CodigoInterno))
            {
                var exists = await _context.Productos.AnyAsync(x => x.CodigoInterno == dto.CodigoInterno);
                if (exists) return Conflict(new { message = "CodigoInterno ya existe." });
            }

            // Validar categoría si viene
            if (dto.IdCategoria.HasValue)
            {
                var catExiste = await _context.Categorias.AnyAsync(c => c.IdCategoria == dto.IdCategoria.Value);
                if (!catExiste) return BadRequest(new { message = "La categoría indicada no existe." });
            }

            var producto = new Producto
            {
                CodigoInterno = dto.CodigoInterno,
                Sku = dto.Sku,
                Nombre = dto.Nombre,
                IdCategoria = dto.IdCategoria,
                Proveedor = dto.Proveedor,
                PrecioVenta = dto.PrecioVenta,
                CostoBase = dto.CostoBase,
                StockActual = dto.StockActual,
                StockMinimo = dto.StockMinimo ?? 5,
                ImpuestoPorcentaje = dto.ImpuestoPorcentaje ?? 0m,
                VecesVendido = dto.VecesVendido ?? 0,
                Estado = string.IsNullOrWhiteSpace(dto.Estado) ? "Activo" : dto.Estado,
                FechaCreacion = DateTime.UtcNow,
                FechaActualizacion = DateTime.UtcNow
            };

            // TRANSACCIÓN: crear producto + registrar stock inicial
            using var transaction = await _context.Database.BeginTransactionAsync();
            try
            {
                _context.Productos.Add(producto);
                await _context.SaveChangesAsync();

                // Registrar el stock inicial como movimiento
                if (producto.StockActual > 0)
                {
                    _context.MovimientosInventario.Add(new MovimientoInventario
                    {
                        IdProducto = producto.IdProducto,
                        IdUsuario = idUsuario,
                        TipoMovimiento = "Ajuste_Inventario",
                        Cantidad = producto.StockActual,
                        StockAnterior = 0,
                        StockNuevo = producto.StockActual,
                        ReferenciaExterna = null,
                        FechaMovimiento = DateTime.UtcNow,
                        Nota = "Stock inicial al crear producto"
                    });
                    await _context.SaveChangesAsync();
                }

                await transaction.CommitAsync();
            }
            catch (Exception ex)
            {
                await transaction.RollbackAsync();
                _logger.LogError(ex, "Error al crear producto");
                return StatusCode(500, new { message = "Error al crear el producto." });
            }

            // Segunda consulta para traer la categoría en la respuesta
            var result = await _context.Productos
                .AsNoTracking()
                .Include(p => p.Categoria)
                .Where(p => p.IdProducto == producto.IdProducto)
                .Select(p => new ProductoDto
                {
                    IdProducto = p.IdProducto,
                    CodigoInterno = p.CodigoInterno,
                    Sku = p.Sku,
                    Nombre = p.Nombre,
                    IdCategoria = p.IdCategoria,
                    CategoriaNombre = p.Categoria != null ? p.Categoria.Nombre : null,
                    Proveedor = p.Proveedor,
                    PrecioVenta = p.PrecioVenta,
                    CostoBase = p.CostoBase,
                    StockActual = p.StockActual,
                    StockMinimo = p.StockMinimo,
                    ImpuestoPorcentaje = p.ImpuestoPorcentaje,
                    VecesVendido = p.VecesVendido,
                    Estado = p.Estado,
                    FechaCreacion = p.FechaCreacion,
                    FechaActualizacion = p.FechaActualizacion
                })
                .FirstOrDefaultAsync();

            _logger.LogInformation(
                "Producto creado: {IdProducto} - {Nombre} (stock inicial: {Stock})",
                producto.IdProducto, producto.Nombre, producto.StockActual);

            return CreatedAtAction(nameof(Get), new { id = producto.IdProducto }, result);
        }

        // ============================================================
        // PUT: api/Productos/5
        // ============================================================
        [HttpPut("{id:int}")]
        [Authorize(Roles = "1")]
        public async Task<IActionResult> Update(int id, [FromBody] ProductoUpdateDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);

            if (dto.PrecioVenta.HasValue && dto.PrecioVenta.Value <= 0)
                return BadRequest(new { message = "El precio de venta debe ser mayor a 0." });

            if (dto.StockActual.HasValue && dto.StockActual.Value < 0)
                return BadRequest(new { message = "El stock no puede ser negativo." });

            var producto = await _context.Productos.FindAsync(id);
            if (producto == null) return NotFound();

            // Extraer idUsuario del JWT
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(userIdClaim) || !int.TryParse(userIdClaim, out int idUsuario))
                return Unauthorized(new { message = "Usuario no identificado." });

            // Validar duplicado de codigo_interno
            if (!string.IsNullOrWhiteSpace(dto.CodigoInterno))
            {
                var dup = await _context.Productos
                    .AnyAsync(p => p.IdProducto != id && p.CodigoInterno == dto.CodigoInterno);
                if (dup) return Conflict(new { message = "El codigo_interno ya pertenece a otro producto." });
                producto.CodigoInterno = dto.CodigoInterno;
            }

            // Categoría (permite actualizarla, cambiarla o poner null)
            if (dto.ActualizarCategoria)
            {
                if (dto.IdCategoria.HasValue)
                {
                    var catExiste = await _context.Categorias
                        .AnyAsync(c => c.IdCategoria == dto.IdCategoria.Value);
                    if (!catExiste)
                        return BadRequest(new { message = "La categoría indicada no existe." });

                    producto.IdCategoria = dto.IdCategoria.Value;
                }
                else
                {
                    producto.IdCategoria = null;
                }
            }

            // Detectar cambio de stock
            bool huboCambioStock = false;
            int stockAnterior = producto.StockActual;
            int stockNuevo = stockAnterior;

            if (dto.StockActual.HasValue && dto.StockActual.Value != producto.StockActual)
            {
                stockNuevo = dto.StockActual.Value;
                producto.StockActual = stockNuevo;
                huboCambioStock = true;
            }

            // Otros campos
            if (dto.Sku != null) producto.Sku = dto.Sku;
            if (dto.Nombre != null) producto.Nombre = dto.Nombre;
            if (dto.Proveedor != null) producto.Proveedor = dto.Proveedor;
            if (dto.PrecioVenta.HasValue) producto.PrecioVenta = dto.PrecioVenta.Value;
            if (dto.CostoBase.HasValue) producto.CostoBase = dto.CostoBase.Value;
            if (dto.StockMinimo.HasValue) producto.StockMinimo = dto.StockMinimo.Value;
            if (dto.ImpuestoPorcentaje.HasValue) producto.ImpuestoPorcentaje = dto.ImpuestoPorcentaje.Value;
            if (dto.VecesVendido.HasValue) producto.VecesVendido = dto.VecesVendido.Value;
            if (dto.Estado != null) producto.Estado = dto.Estado;

            producto.FechaActualizacion = DateTime.UtcNow;

            // TRANSACCIÓN: actualizar producto + registrar movimiento si aplica
            using var transaction = await _context.Database.BeginTransactionAsync();
            try
            {
                await _context.SaveChangesAsync();

                if (huboCambioStock)
                {
                    _context.MovimientosInventario.Add(new MovimientoInventario
                    {
                        IdProducto = producto.IdProducto,
                        IdUsuario = idUsuario,
                        TipoMovimiento = "Ajuste_Inventario",
                        Cantidad = stockNuevo - stockAnterior,
                        StockAnterior = stockAnterior,
                        StockNuevo = stockNuevo,
                        ReferenciaExterna = null,
                        FechaMovimiento = DateTime.UtcNow,
                        Nota = "Ajuste manual desde edición de producto"
                    });
                    await _context.SaveChangesAsync();
                }

                await transaction.CommitAsync();
            }
            catch (DbUpdateConcurrencyException)
            {
                await transaction.RollbackAsync();
                if (!ProductoExists(id)) return NotFound();
                throw;
            }
            catch (Exception ex)
            {
                await transaction.RollbackAsync();
                _logger.LogError(ex, "Error al actualizar producto {Id}", id);
                return StatusCode(500, new { message = "Error al actualizar el producto." });
            }

            if (huboCambioStock)
            {
                _logger.LogInformation(
                    "Ajuste de inventario: Producto {Id} pasó de {Ant} a {Nuevo} (usuario {User})",
                    producto.IdProducto, stockAnterior, stockNuevo, idUsuario);
            }

            _logger.LogInformation("Producto actualizado: {IdProducto}", id);
            return NoContent();
        }

        // ============================================================
        // DELETE: api/Productos/5
        // ============================================================
        [HttpDelete("{id:int}")]
        [Authorize(Roles = "1")]
        public async Task<IActionResult> Delete(int id)
        {
            var producto = await _context.Productos.FindAsync(id);
            if (producto == null) return NotFound();

            var hasDetalles = await _context.DetallesVenta.AnyAsync(d => d.IdProducto == id);
            if (hasDetalles)
                return Conflict(new { message = "No se puede eliminar: existen detalles de venta asociados." });

            _context.Productos.Remove(producto);
            await _context.SaveChangesAsync();

            _logger.LogInformation("Producto eliminado: {IdProducto}", id);
            return NoContent();
        }

        // ============================================================
        // GET: api/Productos/buscar?q=term&limite=50
        // Búsqueda optimizada para el POS híbrido.
        // - Coincidencia exacta por SKU/código primero (escáner)
        // - Luego coincidencia parcial por nombre/código/SKU
        // ============================================================
        [HttpGet("buscar")]
        public async Task<IActionResult> Buscar(
            [FromQuery] string q,
            [FromQuery] int limite = 50)
        {
            if (string.IsNullOrWhiteSpace(q) || q.Trim().Length < 2)
                return BadRequest(new { message = "La búsqueda debe tener al menos 2 caracteres." });

            q = q.Trim();
            limite = Math.Clamp(limite, 1, 100);

            // 1. Búsqueda EXACTA por SKU o código (escáner)
            var porCodigo = await _context.Productos
                .AsNoTracking()
                .Where(p => p.Estado == "Activo" &&
                    (p.CodigoInterno == q || p.Sku == q))
                .Select(p => new
                {
                    p.IdProducto, p.CodigoInterno, p.Sku, p.Nombre,
                    p.IdCategoria,
                    CategoriaNombre = p.Categoria != null ? p.Categoria.Nombre : null,
                    p.PrecioVenta, p.StockActual, p.StockMinimo, p.VecesVendido
                })
                .Take(5)
                .ToListAsync();

            // 2. Búsqueda parcial
            var porNombre = await _context.Productos
                .AsNoTracking()
                .Where(p => p.Estado == "Activo" &&
                    (p.Nombre.Contains(q) ||
                        p.CodigoInterno.Contains(q) ||
                        (p.Sku != null && p.Sku.Contains(q))))
                .OrderByDescending(p => p.VecesVendido)
                .ThenBy(p => p.Nombre)
                .Take(limite)
                .Select(p => new
                {
                    p.IdProducto, p.CodigoInterno, p.Sku, p.Nombre,
                    p.IdCategoria,
                    CategoriaNombre = p.Categoria != null ? p.Categoria.Nombre : null,
                    p.PrecioVenta, p.StockActual, p.StockMinimo, p.VecesVendido
                })
                .ToListAsync();

            // 3. Combinar (sin duplicados)
            var idsExactos = porCodigo.Select(x => x.IdProducto).ToHashSet();
            var resultados = porCodigo
                .Concat(porNombre.Where(x => !idsExactos.Contains(x.IdProducto)))
                .Take(limite)
                .ToList();

            return Ok(new { query = q, total = resultados.Count, resultados });
        }        
                // ============================================================
        // GET: api/Productos/search?q=term
        // ============================================================
        [HttpGet("search")]
        public async Task<ActionResult<IEnumerable<ProductoDto>>> Search([FromQuery] string q)
        {
            if (string.IsNullOrWhiteSpace(q) || q.Trim().Length < 2)
                return BadRequest(new { message = "La búsqueda debe tener al menos 2 caracteres." });

            q = q.Trim();

            var results = await _context.Productos
                .AsNoTracking()
                .Include(p => p.Categoria)
                .Where(p => p.Estado == "Activo" &&              // ← NUEVO
                        (p.Nombre.Contains(q) ||
                            p.CodigoInterno.Contains(q) ||
                            (p.Sku != null && p.Sku.Contains(q))))
                .OrderBy(p => p.Nombre)
                .Take(50)
                .Select(p => new ProductoDto
                {
                    IdProducto = p.IdProducto,
                    CodigoInterno = p.CodigoInterno,
                    Sku = p.Sku,
                    Nombre = p.Nombre,
                    IdCategoria = p.IdCategoria,
                    CategoriaNombre = p.Categoria != null ? p.Categoria.Nombre : null,
                    Proveedor = p.Proveedor,
                    PrecioVenta = p.PrecioVenta,
                    CostoBase = p.CostoBase,
                    StockActual = p.StockActual,
                    StockMinimo = p.StockMinimo,
                    ImpuestoPorcentaje = p.ImpuestoPorcentaje,
                    VecesVendido = p.VecesVendido,
                    Estado = p.Estado,
                    FechaCreacion = p.FechaCreacion,
                    FechaActualizacion = p.FechaActualizacion
                })
                .ToListAsync();

            return Ok(results);
        }

        [HttpGet("top")]
            [Authorize]
            public async Task<ActionResult<IEnumerable<ProductoDto>>> GetTopProductos(
                [FromQuery] int limite = 1000)
            {
                limite = Math.Clamp(limite, 10, 2000);

                var hace30Dias = DateTime.UtcNow.AddDays(-30);

                // -------- 1. IDs con ventas + score ordenado (en SQL) --------
                var scoresRaw = await _context.DetallesVenta
                    .AsNoTracking()
                    .Where(d => d.Venta != null && d.Venta.Estado == "Completada")
                    .GroupBy(d => d.IdProducto)
                    .Select(g => new
                    {
                        IdProducto = g.Key,
                        Frecuencia = g.Select(d => d.IdVenta).Distinct().Count(),
                        CantidadTotal = g.Sum(d => d.Cantidad),
                        CantidadReciente = g
                            .Where(d => d.Venta!.FechaVenta >= hace30Dias)
                            .Sum(d => (int?)d.Cantidad) ?? 0
                    })
                    .ToListAsync();

                // Ordenar por score en memoria (ya son pocos: < 20k)
                var idsTopConVentas = scoresRaw
                    .OrderByDescending(s =>
                        (s.Frecuencia * 0.5) +
                        (s.CantidadTotal * 0.3 / 10.0) +
                        (s.CantidadReciente * 0.2 / 5.0))
                    .Select(s => s.IdProducto)
                    .ToList();

                // -------- 2. Cargar los productos del top --------
                var dictScore = scoresRaw.ToDictionary(s => s.IdProducto);

                var productosConVentas = await _context.Productos
                    .AsNoTracking()
                    .Include(p => p.Categoria)
                    .Where(p => p.Estado == "Activo" && idsTopConVentas.Contains(p.IdProducto))
                    .ToListAsync();

                // Ordenar según score
                var productosConVentasOrdenados = productosConVentas
                    .OrderByDescending(p =>
                    {
                        if (!dictScore.TryGetValue(p.IdProducto, out var s)) return 0;
                        return (s.Frecuencia * 0.5) +
                            (s.CantidadTotal * 0.3 / 10.0) +
                            (s.CantidadReciente * 0.2 / 5.0);
                    })
                    .ToList();

                // -------- 3. Rellenar con productos sin ventas hasta llegar al límite --------
                var resultado = productosConVentasOrdenados;

                if (resultado.Count < limite)
                {
                    var faltantes = limite - resultado.Count;
                    var idsYaIncluidos = resultado.Select(p => p.IdProducto).ToHashSet();

                    var productosSinVentas = await _context.Productos
                        .AsNoTracking()
                        .Include(p => p.Categoria)
                        .Where(p => p.Estado == "Activo" && !idsYaIncluidos.Contains(p.IdProducto))
                        .OrderByDescending(p => p.VecesVendido)
                        .ThenByDescending(p => p.FechaCreacion)
                        .Take(faltantes)
                        .ToListAsync();

                    resultado.AddRange(productosSinVentas);
                }

                // -------- 4. Mapear a DTO --------
                var dtos = resultado.Select(p => new ProductoDto
                {
                    IdProducto = p.IdProducto,
                    CodigoInterno = p.CodigoInterno,
                    Sku = p.Sku,
                    Nombre = p.Nombre,
                    IdCategoria = p.IdCategoria,
                    CategoriaNombre = p.Categoria?.Nombre,
                    Proveedor = p.Proveedor,
                    PrecioVenta = p.PrecioVenta,
                    CostoBase = p.CostoBase,
                    StockActual = p.StockActual,
                    StockMinimo = p.StockMinimo,
                    ImpuestoPorcentaje = p.ImpuestoPorcentaje,
                    VecesVendido = p.VecesVendido,
                    Estado = p.Estado,
                    FechaCreacion = p.FechaCreacion,
                    FechaActualizacion = p.FechaActualizacion
                }).ToList();

                _logger.LogInformation(
                    "Top productos: {ConVentas} con ventas, {SinVentas} sin ventas, total {Total}",
                    productosConVentasOrdenados.Count,
                    resultado.Count - productosConVentasOrdenados.Count,
                    dtos.Count);

                return Ok(dtos);
            }

                // ============================================================
        // GET: api/Productos/generar-codigo?nombre=xxx&idCategoria=1
        // Genera un código interno único basado en el nombre y categoría.
        // Formato: [CAT]-[NOM]-[NNN]
        //   CAT: 3 letras de la categoría (o "GEN")
        //   NOM: 3 letras del nombre (o "PROD")
        //   NNN: número secuencial (001, 002, ...)
        // 
        // Usa bloqueo transaccional para garantizar unicidad incluso
        // bajo concurrencia.
        // ============================================================
        [HttpGet("generar-codigo")]
        [Authorize(Roles = "1")]
        public async Task<IActionResult> GenerarCodigo(
            [FromQuery] string nombre,
            [FromQuery] int? idCategoria)
        {
            if (string.IsNullOrWhiteSpace(nombre))
                return BadRequest(new { message = "El nombre es obligatorio." });

            // -------- 1. Prefijo de categoría --------
            string prefijoCat = "GEN";
            if (idCategoria.HasValue)
            {
                var cat = await _context.Categorias
                    .AsNoTracking()
                    .FirstOrDefaultAsync(c => c.IdCategoria == idCategoria.Value);
                if (cat != null && !string.IsNullOrWhiteSpace(cat.Nombre))
                {
                    prefijoCat = LimpiarParaCodigo(cat.Nombre).PadRight(3).Substring(0, 3);
                }
            }

            // -------- 2. Prefijo del nombre --------
            string prefijoNom = "PROD";
            var nombreLimpio = LimpiarParaCodigo(nombre);
            if (!string.IsNullOrEmpty(nombreLimpio))
            {
                prefijoNom = nombreLimpio.Length >= 3
                    ? nombreLimpio.Substring(0, 3)
                    : nombreLimpio.PadRight(3, 'X');
            }

            string prefijo = $"{prefijoCat}-{prefijoNom}";

            // -------- 3. Buscar el siguiente secuencial con BLOQUEO --------
            // Usamos una transacción serializable para evitar condiciones de carrera.
            using var transaction = await _context.Database.BeginTransactionAsync(
                System.Data.IsolationLevel.Serializable);

            try
            {
                // Buscar todos los códigos con este prefijo (bloqueando las filas)
                var codigosExistentes = await _context.Productos
                    .FromSqlRaw($@"
                        SELECT * FROM productos WITH (UPDLOCK, ROWLOCK)
                        WHERE codigo_interno LIKE @p0
                    ", $"{prefijo}-%")
                    .Select(p => p.CodigoInterno)
                    .ToListAsync();

                int siguiente = 1;
                if (codigosExistentes.Any())
                {
                    var numeros = codigosExistentes
                        .Select(c =>
                        {
                            var partes = c.Split('-');
                            var ultimo = partes.LastOrDefault() ?? "0";
                            return int.TryParse(ultimo, out var n) ? n : 0;
                        })
                        .Where(n => n > 0)
                        .ToList();

                    if (numeros.Any())
                        siguiente = numeros.Max() + 1;
                }

                // -------- 4. Generar candidato y verificar que no exista --------
                const int MAX_INTENTOS = 100;
                string? codigoGenerado = null;

                for (int i = 0; i < MAX_INTENTOS; i++)
                {
                    var candidato = $"{prefijo}-{siguiente:D3}";

                    var existe = await _context.Productos
                        .AnyAsync(p => p.CodigoInterno == candidato);

                    if (!existe)
                    {
                        codigoGenerado = candidato;
                        break;
                    }

                    siguiente++;
                }

                // -------- 5. Fallback con timestamp si no encuentra --------
                if (codigoGenerado == null)
                {
                    var timestamp = DateTime.UtcNow.Ticks.ToString("X").Substring(10, 6);
                    codigoGenerado = $"{prefijo}-{timestamp}";
                    _logger.LogWarning(
                        "No se encontró código único después de {Intentos} intentos. " +
                        "Usando fallback: {Codigo}",
                        MAX_INTENTOS, codigoGenerado);
                }

                await transaction.CommitAsync();

                _logger.LogInformation(
                    "Código generado: {Codigo} para '{Nombre}' (categoría {IdCat})",
                    codigoGenerado, nombre, idCategoria);

                return Ok(new
                {
                    codigo = codigoGenerado,
                    prefijo = prefijo,
                    secuencial = siguiente
                });
            }
            catch (Exception ex)
            {
                await transaction.RollbackAsync();
                _logger.LogError(ex, "Error generando código para '{Nombre}'", nombre);
                return StatusCode(500, new { message = "Error al generar el código." });
            }
        }

        // ============================================================
        // HELPER: Limpia un texto para usar en un código
        // (sin tildes, sin signos, sin espacios, mayúsculas)
        // ============================================================
        private static string LimpiarParaCodigo(string str)
        {
            if (string.IsNullOrWhiteSpace(str)) return string.Empty;

            // Quitar tildes
            var normalized = str.Normalize(System.Text.NormalizationForm.FormD);
            var sb = new System.Text.StringBuilder();
            foreach (var c in normalized)
            {
                var categoria = System.Globalization.CharUnicodeInfo.GetUnicodeCategory(c);
                if (categoria != System.Globalization.UnicodeCategory.NonSpacingMark)
                {
                    sb.Append(c);
                }
            }
            var sinTildes = sb.ToString().Normalize(System.Text.NormalizationForm.FormC);

            // Reemplazar ñ, quitar no-alfanuméricos, mayúsculas
            var limpio = System.Text.RegularExpressions.Regex.Replace(
                sinTildes.Replace("ñ", "n").Replace("Ñ", "N"),
                "[^a-zA-Z0-9]",
                ""
            ).ToUpperInvariant();

            return limpio;
        }

        private bool ProductoExists(int id) => _context.Productos.Any(e => e.IdProducto == id);
    }

    #region DTOs
    public class ProductoDto
    {
        public int IdProducto { get; set; }
        public string CodigoInterno { get; set; } = string.Empty;
        public string? Sku { get; set; }
        public string Nombre { get; set; } = string.Empty;
        public int? IdCategoria { get; set; }
        public string? CategoriaNombre { get; set; }
        public string? Proveedor { get; set; }
        public decimal PrecioVenta { get; set; }
        public decimal? CostoBase { get; set; }
        public int StockActual { get; set; }
        public int? StockMinimo { get; set; }
        public decimal? ImpuestoPorcentaje { get; set; }
        public int? VecesVendido { get; set; }
        public string? Estado { get; set; }
        public DateTime? FechaCreacion { get; set; }
        public DateTime? FechaActualizacion { get; set; }
    }

    public class ProductoCreateDto
    {
        public string CodigoInterno { get; set; } = string.Empty;
        public string? Sku { get; set; }
        public string Nombre { get; set; } = string.Empty;
        public int? IdCategoria { get; set; }
        public string? Proveedor { get; set; }
        public decimal PrecioVenta { get; set; }
        public decimal? CostoBase { get; set; }
        public int StockActual { get; set; }
        public int? StockMinimo { get; set; }
        public decimal? ImpuestoPorcentaje { get; set; }
        public int? VecesVendido { get; set; } = 0;
        public string? Estado { get; set; }
    }

    public class ProductoUpdateDto
    {
        public string? CodigoInterno { get; set; }
        public string? Sku { get; set; }
        public string? Nombre { get; set; }

        // Indica si el cliente quiere actualizar la categoría (permite enviar null)
        public bool ActualizarCategoria { get; set; } = false;

        public int? IdCategoria { get; set; }
        public string? Proveedor { get; set; }
        public decimal? PrecioVenta { get; set; }
        public decimal? CostoBase { get; set; }
        public int? StockActual { get; set; }
        public int? StockMinimo { get; set; }
        public decimal? ImpuestoPorcentaje { get; set; }
        public int? VecesVendido { get; set; }
        public string? Estado { get; set; }
    }
    #endregion
}