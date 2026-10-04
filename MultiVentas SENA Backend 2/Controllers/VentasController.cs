using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;      
using Microsoft.AspNetCore.Authorization;
using System.Security.Claims;
using MultiVentasPOS.Data;
using MultiVentasPOS.Models;

namespace MultiVentasPOS.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class VentasController : ControllerBase
    {
        private readonly AppDbContext _context;
        private readonly ILogger<VentasController> _logger;

        private static readonly string[] MetodosPagoValidos =
            { "Efectivo", "Tarjeta", "Transferencia", "Mixto" };

        public VentasController(AppDbContext context, ILogger<VentasController> logger)
        {
            _context = context;
            _logger = logger;
        }

        // ============================================================
        // GET: api/Ventas?page=1&pageSize=20&desde=2026-01-01&hasta=2026-12-31
        // ============================================================
        [HttpGet]
        public async Task<ActionResult<IEnumerable<VentaResumenDto>>> GetAll(
            [FromQuery] int page = 1,
            [FromQuery] int pageSize = 20,
            [FromQuery] DateTime? desde = null,
            [FromQuery] DateTime? hasta = null,
            [FromQuery] string? estado = null)
        {
            page = Math.Max(1, page);
            pageSize = Math.Clamp(pageSize, 1, 100);

            var query = _context.Ventas
                .AsNoTracking()
                .Include(v => v.Usuario)
                .Include(v => v.Cliente)
                .AsQueryable();

            if (desde.HasValue)
                query = query.Where(v => v.FechaVenta >= desde.Value);

            if (hasta.HasValue)
                query = query.Where(v => v.FechaVenta <= hasta.Value);

            if (!string.IsNullOrWhiteSpace(estado))
                query = query.Where(v => v.Estado == estado);

            var total = await query.CountAsync();

            var items = await query
                .OrderByDescending(v => v.FechaVenta)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .Select(v => new VentaResumenDto
                {
                    IdVenta = v.IdVenta,
                    CodigoFactura = v.CodigoFactura,
                    FechaVenta = v.FechaVenta,
                    IdUsuario = v.IdUsuario,
                    UsuarioNombre = v.Usuario != null ? v.Usuario.Nombre : null,
                    IdCliente = v.IdCliente,
                    ClienteNombre = v.Cliente != null ? v.Cliente.Nombre : null,
                    Subtotal = v.Subtotal,
                    ImpuestosTotal = v.ImpuestosTotal,
                    DescuentoTotal = v.DescuentoTotal,
                    TotalFinal = v.TotalFinal,
                    MetodoPago = v.MetodoPago,
                    Estado = v.Estado,
                    CantidadItems = v.DetallesVenta.Count()
                })
                .ToListAsync();

            Response.Headers["X-Total-Count"] = total.ToString();
            return Ok(items);
        }

        // ============================================================
        // GET: api/Ventas/5
        // ============================================================
        [HttpGet("{id:int}")]
        public async Task<ActionResult<VentaDetalleDto>> Get(int id)
        {
            var venta = await _context.Ventas
                .AsNoTracking()
                .Include(v => v.Usuario)
                .Include(v => v.Cliente)
                .Include(v => v.DetallesVenta)
                    .ThenInclude(d => d.Producto)
                .Where(v => v.IdVenta == id)
                .Select(v => new VentaDetalleDto
                {
                    IdVenta = v.IdVenta,
                    CodigoFactura = v.CodigoFactura,
                    FechaVenta = v.FechaVenta,
                    IdUsuario = v.IdUsuario,
                    UsuarioNombre = v.Usuario != null ? v.Usuario.Nombre : null,
                    IdCliente = v.IdCliente,
                    ClienteNombre = v.Cliente != null ? v.Cliente.Nombre : null,
                    ClienteDocumento = v.Cliente != null ? v.Cliente.Documento : null,
                    Subtotal = v.Subtotal,
                    ImpuestosTotal = v.ImpuestosTotal,
                    DescuentoTotal = v.DescuentoTotal,
                    TotalFinal = v.TotalFinal,
                    MetodoPago = v.MetodoPago,
                    Estado = v.Estado,
                    Nota = v.Nota,
                    Detalles = v.DetallesVenta.Select(d => new DetalleVentaDto
                    {
                        IdDetalle = d.IdDetalle,
                        IdProducto = d.IdProducto,
                        ProductoNombre = d.Producto != null ? d.Producto.Nombre : null,
                        ProductoCodigo = d.Producto != null ? d.Producto.CodigoInterno : null,
                        Cantidad = d.Cantidad,
                        PrecioUnitarioHistorico = d.PrecioUnitarioHistorico,
                        ImpuestoUnitarioHistorico = d.ImpuestoUnitarioHistorico,
                        SubtotalLinea = d.SubtotalLinea
                    }).ToList()
                })
                .FirstOrDefaultAsync();

            if (venta == null)
                return NotFound(new { message = "Venta no encontrada." });

            return Ok(venta);
        }

        [HttpGet("agrupado")]
        public async Task<IActionResult> GetAgrupado(
            [FromQuery] int? anio = null,
            [FromQuery] int? mes = null,
            [FromQuery] string? estado = null,
            [FromQuery] string? buscar = null)
        {
            // ------------------------------------------------------------
            // 1. Determinar rango de fechas (en UTC para la query)
            // ------------------------------------------------------------
            DateTime desde;
            DateTime hasta = DateTime.UtcNow;

            if (anio.HasValue)
            {
                desde = new DateTime(anio.Value, 1, 1, 0, 0, 0, DateTimeKind.Utc);
                hasta = new DateTime(anio.Value, 12, 31, 23, 59, 59, DateTimeKind.Utc);

                if (mes.HasValue)
                {
                    desde = new DateTime(anio.Value, mes.Value, 1, 0, 0, 0, DateTimeKind.Utc);
                    hasta = desde.AddMonths(1).AddSeconds(-1);
                }
            }
            else
            {
                hasta = DateTime.UtcNow;
                desde = new DateTime(hasta.Year, hasta.Month, 1, 0, 0, 0, DateTimeKind.Utc).AddMonths(-11);
            }

            // ------------------------------------------------------------
            // 2. Query base
            // ------------------------------------------------------------
            var query = _context.Ventas
                .AsNoTracking()
                .Include(v => v.Usuario)
                .Include(v => v.Cliente)
                .Where(v => v.FechaVenta >= desde && v.FechaVenta <= hasta);

            if (!string.IsNullOrWhiteSpace(estado))
                query = query.Where(v => v.Estado == estado);

            if (!string.IsNullOrWhiteSpace(buscar))
            {
                var b = buscar.Trim().ToLower();
                query = query.Where(v =>
                    (v.CodigoFactura != null && v.CodigoFactura.ToLower().Contains(b)) ||
                    (v.Cliente != null && v.Cliente.Nombre.ToLower().Contains(b)) ||
                    (v.Usuario != null && v.Usuario.Nombre.ToLower().Contains(b)));
            }

            // ------------------------------------------------------------
            // 3. Traer datos crudos
            // ------------------------------------------------------------
            var ventasRaw = await query
                .OrderByDescending(v => v.FechaVenta)
                .Select(v => new
                {
                    v.IdVenta,
                    v.CodigoFactura,
                    v.FechaVenta,
                    v.TotalFinal,
                    v.MetodoPago,
                    v.Estado,
                    ClienteNombre = v.Cliente != null ? v.Cliente.Nombre : null,
                    UsuarioNombre = v.Usuario != null ? v.Usuario.Nombre : null,
                    CantidadItems = v.DetallesVenta.Sum(d => d.Cantidad)
                })
                .ToListAsync();

            // ============================================================
            // 🆕 4. CONVERTIR A HORA COLOMBIA ANTES DE AGRUPAR
            // Zona horaria Colombia: UTC-5
            // ============================================================
            var zonaColombia = TimeZoneInfo.FindSystemTimeZoneById("SA Pacific Standard Time");
            // En Linux/Mac podría ser "America/Bogota"
            // Usa un try/catch si es necesario

            var ventas = ventasRaw.Select(v => new
            {
                v.IdVenta,
                v.CodigoFactura,
                // 🆕 Convertir a hora Colombia
                FechaVenta = TimeZoneInfo.ConvertTimeFromUtc(
                    DateTime.SpecifyKind(v.FechaVenta, DateTimeKind.Utc),
                    zonaColombia
                ),
                v.TotalFinal,
                v.MetodoPago,
                v.Estado,
                v.ClienteNombre,
                v.UsuarioNombre,
                v.CantidadItems
            }).ToList();

            // ------------------------------------------------------------
            // 5. Agrupar en memoria usando HORA COLOMBIA
            // ------------------------------------------------------------
            var agrupado = ventas
                .GroupBy(v => v.FechaVenta.Year)
                .OrderByDescending(g => g.Key)
                .Select(gAnio => new
                {
                    anio = gAnio.Key,
                    totalVentas = gAnio.Count(),
                    totalMonto = gAnio.Sum(v => v.TotalFinal),
                    meses = gAnio
                        .GroupBy(v => v.FechaVenta.Month)
                        .OrderByDescending(g => g.Key)
                        .Select(gMes => new
                        {
                            mes = gMes.Key,
                            mesNombre = new DateTime(gAnio.Key, gMes.Key, 1)
                                .ToString("MMMM", new System.Globalization.CultureInfo("es-CO")),
                            totalVentas = gMes.Count(),
                            totalMonto = gMes.Sum(v => v.TotalFinal),
                            dias = gMes
                                .GroupBy(v => v.FechaVenta.Day)
                                .OrderByDescending(g => g.Key)
                                .Select(gDia => new
                                {
                                    dia = gDia.Key,
                                    totalVentas = gDia.Count(),
                                    totalMonto = gDia.Sum(v => v.TotalFinal),
                                    ventas = gDia
                                        .OrderByDescending(v => v.FechaVenta)
                                        .Select(v => new
                                        {
                                            v.IdVenta,
                                            v.CodigoFactura,
                                            FechaVenta = v.FechaVenta,   // Ya está en hora Colombia
                                            v.TotalFinal,
                                            v.MetodoPago,
                                            v.Estado,
                                            v.ClienteNombre,
                                            v.UsuarioNombre,
                                            v.CantidadItems
                                        })
                                        .ToList()
                                })
                                .ToList()
                        })
                        .ToList()
                })
                .ToList();

            // ------------------------------------------------------------
            // 6. Años disponibles
            // ------------------------------------------------------------
            var aniosDisponibles = ventas
                .Select(v => v.FechaVenta.Year)
                .Distinct()
                .OrderByDescending(y => y)
                .ToList();

            return Ok(new
            {
                rango = new { desde, hasta },
                aniosDisponibles,
                agrupado
            });
        }
        [HttpPost]
        public async Task<ActionResult<VentaDetalleDto>> Create([FromBody] VentaCreateDto dto)
        {
            // ============================================================
            // 1. Validaciones previas (sin tocar la BD)
            // ============================================================
            if (!ModelState.IsValid) return BadRequest(ModelState);

            if (dto.Detalles == null || dto.Detalles.Count == 0)
                return BadRequest(new { message = "La venta debe tener al menos un producto." });

            var metodoPago = string.IsNullOrWhiteSpace(dto.MetodoPago)
                ? "Efectivo"
                : dto.MetodoPago.Trim();

            if (!MetodosPagoValidos.Contains(metodoPago))
                return BadRequest(new
                {
                    message = "Método de pago inválido. Valores permitidos: Efectivo, Tarjeta, Transferencia, Mixto."
                });

            // Usuario desde el token
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(userIdClaim) || !int.TryParse(userIdClaim, out int idUsuario))
                return Unauthorized(new { message = "Usuario no identificado en el token." });

            // Validar cliente si viene
            if (dto.IdCliente.HasValue)
            {
                var clienteExiste = await _context.Clientes
                    .AnyAsync(c => c.IdCliente == dto.IdCliente.Value);
                if (!clienteExiste)
                    return BadRequest(new { message = "El cliente indicado no existe." });
            }

            // ============================================================
            // 2. ABRIR TRANSACCIÓN ANTES de leer productos
            // ============================================================
            using var transaction = await _context.Database.BeginTransactionAsync();

            try
            {
                var idsProductos = dto.Detalles.Select(d => d.IdProducto).Distinct().ToList();

                // --------------------------------------------------------
                // 3. Leer productos CON BLOQUEO PESIMISTA
                //    UPDLOCK  → nadie más puede modificarlos hasta el commit
                //    ROWLOCK  → bloqueo a nivel de fila, no de tabla
                // --------------------------------------------------------
                var idsList = string.Join(",", idsProductos);
                #pragma warning disable EF1002
                var productos = await _context.Productos
                    .FromSqlRaw($@"
                        SELECT * FROM productos WITH (UPDLOCK, ROWLOCK)
                        WHERE id_producto IN ({idsList})
                    ")
                    .ToDictionaryAsync(p => p.IdProducto);
                    #pragma warning restore EF1002
                // --------------------------------------------------------
                // 4. Validar existencia
                // --------------------------------------------------------
                var faltantes = idsProductos.Where(id => !productos.ContainsKey(id)).ToList();
                if (faltantes.Any())
                {
                    await transaction.RollbackAsync();
                    return BadRequest(new
                    {
                        message = $"Los siguientes productos no existen: {string.Join(", ", faltantes)}"
                    });
                }

                // --------------------------------------------------------
                // 5. Validar cantidad, estado y stock (ya con las filas bloqueadas)
                // --------------------------------------------------------
                foreach (var d in dto.Detalles)
                {
                    if (d.Cantidad <= 0)
                    {
                        await transaction.RollbackAsync();
                        return BadRequest(new
                        {
                            message = $"La cantidad del producto {d.IdProducto} debe ser mayor a 0."
                        });
                    }

                    var prod = productos[d.IdProducto];

                    if (prod.Estado != "Activo")
                    {
                        await transaction.RollbackAsync();
                        return BadRequest(new
                        {
                            message = $"El producto '{prod.Nombre}' está inactivo y no se puede vender."
                        });
                    }

                    if (prod.StockActual < d.Cantidad)
                    {
                        await transaction.RollbackAsync();
                        return BadRequest(new
                        {
                            message = $"Stock insuficiente de '{prod.Nombre}'. " +
                                    $"Disponible: {prod.StockActual}, solicitado: {d.Cantidad}."
                        });
                    }
                }

                // ============================================================
                // 6. Calcular totales
                // ============================================================
                decimal subtotal = 0;
                decimal impuestosTotal = 0;
                var detallesParaCrear = new List<DetalleVenta>();

                foreach (var d in dto.Detalles)
                {
                    var prod = productos[d.IdProducto];
                    var precioUnitario = prod.PrecioVenta;
                    var impuestoUnitario = prod.PrecioVenta * (prod.ImpuestoPorcentaje / 100m);
                    var subtotalLinea = (precioUnitario + impuestoUnitario) * d.Cantidad;

                    subtotal += precioUnitario * d.Cantidad;
                    impuestosTotal += impuestoUnitario * d.Cantidad;

                    detallesParaCrear.Add(new DetalleVenta
                    {
                        IdProducto = d.IdProducto,
                        Cantidad = d.Cantidad,
                        PrecioUnitarioHistorico = precioUnitario,
                        ImpuestoUnitarioHistorico = impuestoUnitario,
                        SubtotalLinea = subtotalLinea
                    });
                }

                var descuentoTotal = dto.DescuentoTotal ?? 0m;
                var totalFinal = subtotal + impuestosTotal - descuentoTotal;

                if (totalFinal < 0)
                {
                    await transaction.RollbackAsync();
                    return BadRequest(new { message = "El descuento no puede superar el total." });
                }

                // ============================================================
                // 7. Crear la venta
                // ============================================================
                var venta = new Venta
                {
                    CodigoFactura = GenerarCodigoFactura(),
                    FechaVenta = DateTime.UtcNow,
                    IdUsuario = idUsuario,
                    IdCliente = dto.IdCliente,
                    Subtotal = subtotal,
                    ImpuestosTotal = impuestosTotal,
                    DescuentoTotal = descuentoTotal,
                    TotalFinal = totalFinal,
                    MetodoPago = metodoPago,
                    Estado = "Completada",
                    Nota = string.IsNullOrWhiteSpace(dto.Nota) ? null : dto.Nota.Trim(),
                    DetallesVenta = detallesParaCrear
                };

                _context.Ventas.Add(venta);
                await _context.SaveChangesAsync();

                // ============================================================
                // 8. Actualizar stock + veces_vendido + movimientos
                // ============================================================
                foreach (var d in dto.Detalles)
                {
                    var prod = productos[d.IdProducto];
                    var stockAnterior = prod.StockActual;
                    var stockNuevo = stockAnterior - d.Cantidad;

                    prod.StockActual = stockNuevo;
                    prod.VecesVendido += d.Cantidad;
                    prod.FechaActualizacion = DateTime.UtcNow;

                    _context.MovimientosInventario.Add(new MovimientoInventario
                    {
                        IdProducto = prod.IdProducto,
                        IdUsuario = idUsuario,
                        TipoMovimiento = "Salida_Venta",
                        Cantidad = -d.Cantidad,
                        StockAnterior = stockAnterior,
                        StockNuevo = stockNuevo,
                        ReferenciaExterna = venta.CodigoFactura,
                        FechaMovimiento = DateTime.UtcNow,
                        Nota = $"Venta {venta.CodigoFactura}"
                    });
                }

                await _context.SaveChangesAsync();

                // ============================================================
                // 9. Commit
                // ============================================================
                await transaction.CommitAsync();

                _logger.LogInformation(
                    "Venta creada: {CodigoFactura}, Total: {TotalFinal}, Ítems: {Items}",
                    venta.CodigoFactura, venta.TotalFinal, dto.Detalles.Count);

                // Devolver el detalle completo
                return await Get(venta.IdVenta);
            }
            catch (Exception ex)
            {
                await transaction.RollbackAsync();
                _logger.LogError(ex, "Error al crear la venta");
                return StatusCode(500, new
                {
                    message = "Error al procesar la venta. Se revirtieron los cambios."
                });
            }
        }
        // ============================================================
        // PUT: api/Ventas/5/anular
        // ============================================================
        [HttpPut("{id:int}/anular")]
        [Authorize(Roles = "1")]
        public async Task<IActionResult> Anular(int id, [FromBody] AnularVentaDto? dto)
        {
            var venta = await _context.Ventas
                .Include(v => v.DetallesVenta)
                .FirstOrDefaultAsync(v => v.IdVenta == id);

            if (venta == null)
                return NotFound(new { message = "Venta no encontrada." });

            if (venta.Estado == "Anulada")
                return BadRequest(new { message = "La venta ya está anulada." });

            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(userIdClaim) || !int.TryParse(userIdClaim, out int idUsuario))
                return Unauthorized(new { message = "Usuario no identificado." });

            using var transaction = await _context.Database.BeginTransactionAsync();

            try
            {
                // 1. Cambiar estado
                venta.Estado = "Anulada";
                if (!string.IsNullOrWhiteSpace(dto?.Motivo))
                    venta.Nota = (venta.Nota ?? "") + $" | ANULADA: {dto.Motivo.Trim()}";

                // 2. Devolver stock + registrar movimientos
                foreach (var detalle in venta.DetallesVenta)
                {
                    var prod = await _context.Productos.FindAsync(detalle.IdProducto);
                    if (prod == null) continue;

                    var stockAnterior = prod.StockActual;
                    var stockNuevo = stockAnterior + detalle.Cantidad;

                    prod.StockActual = stockNuevo;
                    prod.VecesVendido = Math.Max(0, prod.VecesVendido - detalle.Cantidad);
                    prod.FechaActualizacion = DateTime.UtcNow;

                    _context.MovimientosInventario.Add(new MovimientoInventario
                    {
                        IdProducto = prod.IdProducto,
                        IdUsuario = idUsuario,
                        TipoMovimiento = "Devolucion",
                        Cantidad = detalle.Cantidad,
                        StockAnterior = stockAnterior,
                        StockNuevo = stockNuevo,
                        ReferenciaExterna = venta.CodigoFactura,
                        FechaMovimiento = DateTime.UtcNow,
                        Nota = $"Anulación de venta {venta.CodigoFactura}"
                    });
                }

                await _context.SaveChangesAsync();
                await transaction.CommitAsync();

                _logger.LogInformation("Venta anulada: {CodigoFactura}", venta.CodigoFactura);
                return NoContent();
            }
            catch (Exception ex)
            {
                await transaction.RollbackAsync();
                _logger.LogError(ex, "Error al anular la venta {Id}", id);
                return StatusCode(500, new { 
                    message = "Error al anular la venta. Se revirtieron los cambios." 
                });
            }
        }

        // ============================================================
        // HELPERS
        // ============================================================
        private static string GenerarCodigoFactura()
        {
            return $"FAC-{DateTime.UtcNow:yyyyMMddHHmmss}-{Guid.NewGuid().ToString("N").Substring(0, 4).ToUpper()}";
        }
    }

    #region DTOs

    // Para listado
    public class VentaResumenDto
    {
        public int IdVenta { get; set; }
        public string? CodigoFactura { get; set; }
        public DateTime FechaVenta { get; set; }
        public int IdUsuario { get; set; }
        public string? UsuarioNombre { get; set; }
        public int? IdCliente { get; set; }
        public string? ClienteNombre { get; set; }
        public decimal Subtotal { get; set; }
        public decimal ImpuestosTotal { get; set; }
        public decimal DescuentoTotal { get; set; }
        public decimal TotalFinal { get; set; }
        public string MetodoPago { get; set; } = "Efectivo";
        public string Estado { get; set; } = "Completada";
        public int CantidadItems { get; set; }
    }

    // Para detalle
    public class VentaDetalleDto
    {
        public int IdVenta { get; set; }
        public string? CodigoFactura { get; set; }
        public DateTime FechaVenta { get; set; }
        public int IdUsuario { get; set; }
        public string? UsuarioNombre { get; set; }
        public int? IdCliente { get; set; }
        public string? ClienteNombre { get; set; }
        public string? ClienteDocumento { get; set; }
        public decimal Subtotal { get; set; }
        public decimal ImpuestosTotal { get; set; }
        public decimal DescuentoTotal { get; set; }
        public decimal TotalFinal { get; set; }
        public string MetodoPago { get; set; } = "Efectivo";
        public string Estado { get; set; } = "Completada";
        public string? Nota { get; set; }
        public List<DetalleVentaDto> Detalles { get; set; } = new List<DetalleVentaDto>();
    }

    public class DetalleVentaDto
    {
        public int IdDetalle { get; set; }
        public int IdProducto { get; set; }
        public string? ProductoNombre { get; set; }
        public string? ProductoCodigo { get; set; }
        public int Cantidad { get; set; }
        public decimal PrecioUnitarioHistorico { get; set; }
        public decimal ImpuestoUnitarioHistorico { get; set; }
        public decimal SubtotalLinea { get; set; }
    }

    // Para crear
    public class VentaCreateDto
    {
        public int? IdCliente { get; set; }
        public string? MetodoPago { get; set; }
        public decimal? DescuentoTotal { get; set; }
        public string? Nota { get; set; }
        public List<DetalleVentaCreateDto> Detalles { get; set; } = new List<DetalleVentaCreateDto>();
    }

    public class DetalleVentaCreateDto
    {
        public int IdProducto { get; set; }
        public int Cantidad { get; set; }
    }

    // Para anular
    public class AnularVentaDto
    {
        public string? Motivo { get; set; }
    }

    #endregion
}