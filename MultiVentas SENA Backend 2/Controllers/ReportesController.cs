using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authorization;
using MultiVentasPOS.Data;

namespace MultiVentasPOS.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class ReportesController : ControllerBase
    {
        private readonly AppDbContext _context;

        public ReportesController(AppDbContext context)
        {
            _context = context;
        }

        // ============================================================
// GET: api/Reportes/dashboard?periodo=hoy|semana|mes|año
// ============================================================
[HttpGet("dashboard")]
public async Task<ActionResult<DashboardDto>> GetDashboard([FromQuery] string periodo = "mes")
{
    var hoy = DateTime.UtcNow;
    DateTime inicio;
    DateTime fin = hoy;

    // Determinar el rango según el período
    switch (periodo.ToLower())
    {
        case "hoy":
            inicio = hoy.Date;
            break;
        case "semana":
            // Últimos 7 días
            inicio = hoy.Date.AddDays(-6);
            break;
        case "año":
        case "anio":
            inicio = new DateTime(hoy.Year, 1, 1, 0, 0, 0, DateTimeKind.Utc);
            break;
        case "mes":
        default:
            inicio = new DateTime(hoy.Year, hoy.Month, 1, 0, 0, 0, DateTimeKind.Utc);
            break;
    }

    // ---------- Resumen general ----------
    var ventasDelPeriodo = await _context.Ventas
        .AsNoTracking()
        .Where(v => v.FechaVenta >= inicio 
                 && v.FechaVenta <= fin 
                 && v.Estado == "Completada")
        .ToListAsync();

    decimal ingresos = ventasDelPeriodo.Sum(v => v.TotalFinal);
    int cantidadVentas = ventasDelPeriodo.Count;
    decimal ticketPromedio = cantidadVentas > 0 ? ingresos / cantidadVentas : 0;

    var productosVendidos = await _context.DetallesVenta
        .AsNoTracking()
        .Where(d => d.Venta != null 
                 && d.Venta.FechaVenta >= inicio 
                 && d.Venta.FechaVenta <= fin 
                 && d.Venta.Estado == "Completada")
        .SumAsync(d => (int?)d.Cantidad) ?? 0;

    // ---------- Ventas por día (según período) ----------
    // Para "hoy" mostramos últimas 24h por hora (aquí simplificado a días)
    // Para "semana" mostramos 7 días
    // Para "mes" mostramos todos los días del mes (o hasta hoy)
    // Para "año" mostramos los 12 meses

    var ventasPorFecha = new List<VentasPorDiaDto>();

    if (periodo.ToLower() == "año" || periodo.ToLower() == "anio")
    {
        // Agrupar por mes
        var ventasMes = await _context.Ventas
            .AsNoTracking()
            .Where(v => v.FechaVenta >= inicio 
                     && v.FechaVenta <= fin 
                     && v.Estado == "Completada")
            .GroupBy(v => new { v.FechaVenta.Year, v.FechaVenta.Month })
            .Select(g => new
            {
                g.Key.Year,
                g.Key.Month,
                Total = g.Sum(v => v.TotalFinal),
                Cantidad = g.Count()
            })
            .OrderBy(x => x.Year).ThenBy(x => x.Month)
            .ToListAsync();

        for (int m = 1; m <= 12; m++)
        {
            var ventaMesItem = ventasMes.FirstOrDefault(v => v.Month == m);
            var fechaRef = new DateTime(hoy.Year, m, 1);
            ventasPorFecha.Add(new VentasPorDiaDto
            {
                Fecha = fechaRef.ToString("yyyy-MM"),
                FechaCorta = fechaRef.ToString("MMM"),
                Total = ventaMesItem?.Total ?? 0,
                Cantidad = ventaMesItem?.Cantidad ?? 0
            });
        }
    }
    else
    {
        // Agrupar por día
        var ventasDia = await _context.Ventas
            .AsNoTracking()
            .Where(v => v.FechaVenta >= inicio 
                     && v.FechaVenta <= fin 
                     && v.Estado == "Completada")
            .GroupBy(v => v.FechaVenta.Date)
            .Select(g => new
            {
                Fecha = g.Key,
                Total = g.Sum(v => v.TotalFinal),
                Cantidad = g.Count()
            })
            .OrderBy(x => x.Fecha)
            .ToListAsync();

        var fechaIter = inicio.Date;
        var fechaFin = hoy.Date;
        while (fechaIter <= fechaFin)
        {
            var ventaDiaItem = ventasDia.FirstOrDefault(v => v.Fecha == fechaIter);
            ventasPorFecha.Add(new VentasPorDiaDto
            {
                Fecha = fechaIter.ToString("yyyy-MM-dd"),
                FechaCorta = fechaIter.ToString("ddd dd"),
                Total = ventaDiaItem?.Total ?? 0,
                Cantidad = ventaDiaItem?.Cantidad ?? 0
            });
            fechaIter = fechaIter.AddDays(1);
        }
    }

    // ---------- Top 5 productos ----------
    var topProductos = await _context.DetallesVenta
        .AsNoTracking()
        .Where(d => d.Venta != null 
                 && d.Venta.FechaVenta >= inicio 
                 && d.Venta.FechaVenta <= fin 
                 && d.Venta.Estado == "Completada")
        .GroupBy(d => d.IdProducto)
        .Select(g => new
        {
            IdProducto = g.Key,
            CantidadVendida = g.Sum(d => d.Cantidad),
            TotalGenerado = g.Sum(d => d.SubtotalLinea)
        })
        .OrderByDescending(x => x.CantidadVendida)
        .Take(5)
        .ToListAsync();

    var idsProductos = topProductos.Select(t => t.IdProducto).ToList();
    var productos = await _context.Productos
        .AsNoTracking()
        .Where(p => idsProductos.Contains(p.IdProducto))
        .ToDictionaryAsync(p => p.IdProducto, p => p.Nombre);

    var topProductosDto = topProductos.Select(t => new TopProductoDto
    {
        IdProducto = t.IdProducto,
        Nombre = productos.ContainsKey(t.IdProducto) ? productos[t.IdProducto] : "N/A",
        CantidadVendida = t.CantidadVendida,
        TotalGenerado = t.TotalGenerado
    }).ToList();

    // ---------- Ventas por método de pago ----------
    var ventasPorMetodo = await _context.Ventas
        .AsNoTracking()
        .Where(v => v.FechaVenta >= inicio 
                 && v.FechaVenta <= fin 
                 && v.Estado == "Completada")
        .GroupBy(v => v.MetodoPago)
        .Select(g => new VentasPorMetodoDto
        {
            Metodo = g.Key,
            Cantidad = g.Count(),
            Total = g.Sum(v => v.TotalFinal)
        })
        .ToListAsync();

    // ---------- Últimas 5 ventas ----------
    var ultimasVentas = await _context.Ventas
        .AsNoTracking()
        .Include(v => v.Cliente)
        .Include(v => v.Usuario)
        .Include(v => v.DetallesVenta)
        .Where(v => v.Estado == "Completada")
        .OrderByDescending(v => v.FechaVenta)
        .Take(5)
        .Select(v => new UltimaVentaDto
        {
            IdVenta = v.IdVenta,
            CodigoFactura = v.CodigoFactura,
            FechaVenta = v.FechaVenta,
            ClienteNombre = v.Cliente != null ? v.Cliente.Nombre : "Anónimo",
            UsuarioNombre = v.Usuario != null ? v.Usuario.Nombre : "N/A",
            TotalFinal = v.TotalFinal,
            CantidadItems = v.DetallesVenta.Sum(d => d.Cantidad)
        })
        .ToListAsync();

    // ---------- Construir respuesta ----------
    var dto = new DashboardDto
    {
        Periodo = periodo,
        FechaInicio = inicio,
        FechaFin = fin,
        IngresosMes = ingresos,
        CantidadVentasMes = cantidadVentas,
        TicketPromedio = ticketPromedio,
        ProductosVendidosMes = productosVendidos,
        VentasPorDia = ventasPorFecha,
        TopProductos = topProductosDto,
        VentasPorMetodo = ventasPorMetodo,
        UltimasVentas = ultimasVentas
    };

    return Ok(dto);
}

        // ============================================================
        // GET: api/Reportes/ventas-por-fecha
        // ============================================================
        [HttpGet("ventas-por-fecha")]
        public async Task<ActionResult<object>> GetVentasPorFecha(
            [FromQuery] DateTime? desde,
            [FromQuery] DateTime? hasta)
        {
            var fechaDesde = desde ?? DateTime.UtcNow.AddDays(-30);
            var fechaHasta = hasta ?? DateTime.UtcNow;

            var ventas = await _context.Ventas
                .AsNoTracking()
                .Where(v => v.FechaVenta >= fechaDesde 
                         && v.FechaVenta <= fechaHasta 
                         && v.Estado == "Completada")
                .GroupBy(v => v.FechaVenta.Date)
                .Select(g => new
                {
                    Fecha = g.Key,
                    Total = g.Sum(v => v.TotalFinal),
                    Cantidad = g.Count()
                })
                .OrderBy(x => x.Fecha)
                .ToListAsync();

            return Ok(ventas);
        }
    }

    // ============================================================
    // DTOs
    // ============================================================
    public class DashboardDto
{
    public string Periodo { get; set; } = "mes";              // ← NUEVO
    public DateTime FechaInicio { get; set; }                  // ← NUEVO
    public DateTime FechaFin { get; set; }                     // ← NUEVO
    public decimal IngresosMes { get; set; }
    public int CantidadVentasMes { get; set; }
    public decimal TicketPromedio { get; set; }
    public int ProductosVendidosMes { get; set; }
    public List<VentasPorDiaDto> VentasPorDia { get; set; } = new();
    public List<TopProductoDto> TopProductos { get; set; } = new();
    public List<VentasPorMetodoDto> VentasPorMetodo { get; set; } = new();
    public List<UltimaVentaDto> UltimasVentas { get; set; } = new();
}

    public class VentasPorDiaDto
    {
        public string Fecha { get; set; } = string.Empty;
        public string FechaCorta { get; set; } = string.Empty;
        public decimal Total { get; set; }
        public int Cantidad { get; set; }
    }

    public class TopProductoDto
    {
        public int IdProducto { get; set; }
        public string Nombre { get; set; } = string.Empty;
        public int CantidadVendida { get; set; }
        public decimal TotalGenerado { get; set; }
    }

    public class VentasPorMetodoDto
    {
        public string Metodo { get; set; } = string.Empty;
        public int Cantidad { get; set; }
        public decimal Total { get; set; }
    }

    public class UltimaVentaDto
    {
        public int IdVenta { get; set; }
        public string? CodigoFactura { get; set; }
        public DateTime FechaVenta { get; set; }
        public string ClienteNombre { get; set; } = "Anónimo";
        public string UsuarioNombre { get; set; } = "N/A";
        public decimal TotalFinal { get; set; }
        public int CantidadItems { get; set; }
    }
}