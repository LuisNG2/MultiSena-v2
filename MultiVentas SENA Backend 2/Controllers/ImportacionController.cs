using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ClosedXML.Excel;
using System.Globalization;
using System.Security.Claims;
using MultiVentasPOS.Data;
using MultiVentasPOS.Models;

namespace MultiVentasPOS.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize(Roles = "1")]   // solo admin
    public class ImportacionController : ControllerBase
    {
        private readonly AppDbContext _context;
        private readonly ILogger<ImportacionController> _logger;

        private const int MAX_FILAS = 25000;

        public ImportacionController(AppDbContext context, ILogger<ImportacionController> logger)
        {
            _context = context;
            _logger = logger;
        }

        // ============================================================
        // POST: api/Importacion/productos/preview
        // ============================================================
        [HttpPost("productos/preview")]
        [RequestSizeLimit(20_000_000)]
        public async Task<IActionResult> PreviewProductos(IFormFile archivo)
        {
            if (archivo == null || archivo.Length == 0)
                return BadRequest(new { message = "No se recibió archivo." });

            var ext = Path.GetExtension(archivo.FileName).ToLowerInvariant();
            if (ext != ".xlsx" && ext != ".xls")
                return BadRequest(new { message = "Formato no soportado. Use .xlsx o .xls" });

            List<ProductoImportDto> filas;
            try
            {
                filas = LeerExcelProductos(archivo);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error al leer el Excel");
                return BadRequest(new { message = "No se pudo leer el archivo. Verifica el formato." });
            }

            if (filas.Count == 0)
                return BadRequest(new { message = "El archivo no tiene filas válidas." });

            if (filas.Count > MAX_FILAS)
                return BadRequest(new { message = $"El archivo tiene {filas.Count} filas. Máximo permitido: {MAX_FILAS}." });

            var resultado = await ValidarFilas(filas);

            return Ok(new
            {
                totalFilas = filas.Count,
                validas = resultado.Validas,
                conErrores = resultado.ConErrores,
                resumen = new
                {
                    nuevos = resultado.Nuevos,
                    actualizables = resultado.Actualizables,
                    duplicadosEnArchivo = resultado.DuplicadosEnArchivo,
                    errores = resultado.Errores
                },
                filas = resultado.Filas.Select(f => new
                {
                    f.Fila,
                    f.CodigoInterno,
                    f.Sku,
                    f.Nombre,
                    f.Categoria,
                    f.PrecioVenta,
                    f.StockActual,
                    f.EsValida,
                    f.Errores,
                    f.ExisteEnBd
                })
            });
        }

        // ============================================================
// POST: api/Importacion/productos/confirmar
// ============================================================
[HttpPost("productos/confirmar")]
[RequestSizeLimit(20_000_000)]
public async Task<IActionResult> ConfirmarProductos([FromForm] string modo, IFormFile archivo)
{
    if (archivo == null || archivo.Length == 0)
        return BadRequest(new { message = "No se recibió archivo." });

    if (modo != "crear" && modo != "actualizar" && modo != "ambos")
        return BadRequest(new { message = "Modo inválido. Use 'crear', 'actualizar' o 'ambos'." });

    var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
    if (!int.TryParse(userIdClaim, out int idUsuario))
        return Unauthorized(new { message = "Usuario no identificado." });

    List<ProductoImportDto> filas;
    try
    {
        filas = LeerExcelProductos(archivo);
    }
    catch (Exception ex)
    {
        _logger.LogError(ex, "Error al leer el Excel en confirmar");
        return BadRequest(new { message = "No se pudo leer el archivo." });
    }

    var validacion = await ValidarFilas(filas);
    var filasAProcesar = validacion.Filas.Where(f => f.EsValida).ToList();

    if (filasAProcesar.Count == 0)
        return BadRequest(new { message = "No hay filas válidas para procesar." });

    int creados = 0;
    int actualizados = 0;
    int errores = 0;
    var detalleErrores = new List<object>();

    // ============================================================
    // Precargas
    // ============================================================
    var codigosEnArchivo = filasAProcesar.Select(f => f.CodigoInterno).Distinct().ToList();
    var productosExistentes = await _context.Productos
        .Where(p => codigosEnArchivo.Contains(p.CodigoInterno))
        .ToDictionaryAsync(p => p.CodigoInterno, StringComparer.OrdinalIgnoreCase);

    var categoriasExistentes = await _context.Categorias
        .ToDictionaryAsync(c => c.Nombre.ToLower(), c => c.IdCategoria);

    var skusEnBd = await _context.Productos
        .Where(p => p.Sku != null)
        .ToDictionaryAsync(p => p.Sku!, p => p.CodigoInterno, StringComparer.OrdinalIgnoreCase);

    // Buffer para movimientos que necesitan el IdProducto del producto creado
    var movimientosPendientes = new List<(Producto prod, MovimientoInventario mov)>();

    // ============================================================
    // PROCESAMIENTO POR LOTES
    // ============================================================
    const int TAMANO_LOTE = 100;
    int contadorLote = 0;
    int indiceFila = 0;

    foreach (var fila in filasAProcesar)
    {
        indiceFila++;

        try
        {
            // -------- Resolver categoría --------
            int? idCategoria = null;
            if (!string.IsNullOrWhiteSpace(fila.Categoria))
            {
                var keyCat = fila.Categoria.Trim().ToLower();
                if (categoriasExistentes.TryGetValue(keyCat, out var idCat))
                {
                    idCategoria = idCat;
                }
                else
                {
                    var nuevaCat = new Categoria
                    {
                        Nombre = fila.Categoria.Trim(),
                        Descripcion = null
                    };
                    _context.Categorias.Add(nuevaCat);
                    await _context.SaveChangesAsync();
                    categoriasExistentes[keyCat] = nuevaCat.IdCategoria;
                    idCategoria = nuevaCat.IdCategoria;
                }
            }

            // -------- ¿Existe el producto por código? --------
            var existe = productosExistentes.TryGetValue(fila.CodigoInterno, out var prodExistente);

            if (existe && prodExistente is not null)
            {
                // ========== ACTUALIZAR ==========
                if (modo == "actualizar" || modo == "ambos")
                {
                    var stockAnterior = prodExistente.StockActual;
                    var skuExcel = string.IsNullOrWhiteSpace(fila.Sku) ? null : fila.Sku.Trim();

                    if (skuExcel == null)
                    {
                        prodExistente.Sku = null;
                    }
                    else if (skusEnBd.ContainsKey(skuExcel))
                    {
                        // Ya existe → IGNORAR
                    }
                    else
                    {
                        prodExistente.Sku = skuExcel;
                        skusEnBd[skuExcel] = fila.CodigoInterno;
                    }

                    prodExistente.Nombre = fila.Nombre;
                    prodExistente.IdCategoria = idCategoria;
                    prodExistente.PrecioVenta = fila.PrecioVenta;
                    prodExistente.StockActual = fila.StockActual;
                    prodExistente.StockMinimo = fila.StockMinimo ?? prodExistente.StockMinimo;
                    prodExistente.ImpuestoPorcentaje = fila.ImpuestoPorcentaje ?? prodExistente.ImpuestoPorcentaje;
                    prodExistente.Estado = string.IsNullOrWhiteSpace(fila.Estado) ? prodExistente.Estado : fila.Estado;
                    prodExistente.FechaActualizacion = DateTime.UtcNow;

                    if (stockAnterior != fila.StockActual)
                    {
                        // Movimiento de actualización: aquí SÍ conocemos el IdProducto
                        _context.MovimientosInventario.Add(new MovimientoInventario
                        {
                            IdProducto = prodExistente.IdProducto,
                            IdUsuario = idUsuario,
                            TipoMovimiento = "Ajuste_Inventario",
                            Cantidad = fila.StockActual - stockAnterior,
                            StockAnterior = stockAnterior,
                            StockNuevo = fila.StockActual,
                            ReferenciaExterna = "IMPORT",
                            FechaMovimiento = DateTime.UtcNow,
                            Nota = "Importación masiva (actualización)"
                        });
                    }

                    actualizados++;
                }
            }
            else
            {
                // ========== CREAR ==========
                if (modo == "crear" || modo == "ambos")
                {
                    var skuExcel = string.IsNullOrWhiteSpace(fila.Sku) ? null : fila.Sku.Trim();

                    if (skuExcel != null && skusEnBd.ContainsKey(skuExcel))
                    {
                        throw new Exception($"SKU '{skuExcel}' ya está en uso por otro producto ({skusEnBd[skuExcel]}).");
                    }

                    var nuevoProd = new Producto
                    {
                        CodigoInterno = fila.CodigoInterno,
                        Sku = skuExcel,
                        Nombre = fila.Nombre,
                        IdCategoria = idCategoria,
                        PrecioVenta = fila.PrecioVenta,
                        StockActual = fila.StockActual,
                        StockMinimo = fila.StockMinimo ?? 5,
                        ImpuestoPorcentaje = fila.ImpuestoPorcentaje ?? 0,
                        Estado = string.IsNullOrWhiteSpace(fila.Estado) ? "Activo" : fila.Estado,
                        FechaCreacion = DateTime.UtcNow,
                        FechaActualizacion = DateTime.UtcNow
                    };

                    _context.Productos.Add(nuevoProd);

                    if (!string.IsNullOrWhiteSpace(nuevoProd.Sku))
                        skusEnBd[nuevoProd.Sku] = nuevoProd.CodigoInterno;

                    // 🆕 Guardar movimiento en buffer (NO agregarlo al contexto aún)
                    if (nuevoProd.StockActual > 0)
                    {
                        movimientosPendientes.Add((nuevoProd, new MovimientoInventario
                        {
                            IdUsuario = idUsuario,
                            TipoMovimiento = "Entrada_Compra",
                            Cantidad = nuevoProd.StockActual,
                            StockAnterior = 0,
                            StockNuevo = nuevoProd.StockActual,
                            ReferenciaExterna = "IMPORT",
                            FechaMovimiento = DateTime.UtcNow,
                            Nota = "Importación masiva (creación)"
                        }));
                    }

                    creados++;
                }
            }

            contadorLote++;

            // ============================================================
            // GUARDAR CADA 100 FILAS
            // ============================================================
            if (contadorLote >= TAMANO_LOTE)
            {
                await _context.SaveChangesAsync();   // ← aquí se asignan IdProducto a los productos

                // 🆕 Ahora sí, agregar los movimientos con IdProducto real
                foreach (var (prod, mov) in movimientosPendientes)
                {
                    mov.IdProducto = prod.IdProducto;
                    _context.MovimientosInventario.Add(mov);
                }
                movimientosPendientes.Clear();
                await _context.SaveChangesAsync();   // guardar los movimientos

                _logger.LogInformation(
                    "Lote guardado: {Creados} creados, {Actualizados} actualizados. Progreso: {Actual}/{Total}",
                    creados, actualizados, indiceFila, filasAProcesar.Count);

                contadorLote = 0;
            }
        }
        catch (DbUpdateException dbEx)
        {
            errores++;
            var mensaje = dbEx.InnerException?.Message ?? dbEx.Message;

            // Limpiar entidades pendientes
            foreach (var entry in _context.ChangeTracker.Entries().ToList())
            {
                if (entry.State != EntityState.Unchanged && entry.State != EntityState.Detached)
                {
                    entry.State = EntityState.Detached;
                }
            }
            movimientosPendientes.Clear();

            if (mensaje.Contains("UQ_Productos_Sku_Filtered") || mensaje.Contains("Sku", StringComparison.OrdinalIgnoreCase))
            {
                detalleErrores.Add(new
                {
                    fila.Fila,
                    fila.CodigoInterno,
                    error = $"El SKU '{fila.Sku}' ya está en uso."
                });
            }
            else if (mensaje.Contains("UQ_Productos_CodigoInterno") || mensaje.Contains("CodigoInterno", StringComparison.OrdinalIgnoreCase))
            {
                detalleErrores.Add(new
                {
                    fila.Fila,
                    fila.CodigoInterno,
                    error = $"El código '{fila.CodigoInterno}' ya existe."
                });
            }
            else
            {
                detalleErrores.Add(new
                {
                    fila.Fila,
                    fila.CodigoInterno,
                    error = mensaje.Length > 200 ? mensaje.Substring(0, 200) + "..." : mensaje
                });
            }

            _logger.LogWarning(dbEx, "Error de BD importando fila {Fila} ({Codigo})", fila.Fila, fila.CodigoInterno);
            contadorLote = 0;
        }
        catch (Exception ex)
        {
            errores++;
            detalleErrores.Add(new
            {
                fila.Fila,
                fila.CodigoInterno,
                error = ex.Message
            });

            foreach (var entry in _context.ChangeTracker.Entries().ToList())
            {
                if (entry.State != EntityState.Unchanged && entry.State != EntityState.Detached)
                {
                    entry.State = EntityState.Detached;
                }
            }
            movimientosPendientes.Clear();

            _logger.LogError(ex, "Error importando fila {Fila} ({Codigo})", fila.Fila, fila.CodigoInterno);
            contadorLote = 0;
        }
    }

    // ============================================================
    // GUARDAR EL ÚLTIMO LOTE INCOMPLETO
    // ============================================================
    if (contadorLote > 0)
    {
        try
        {
            await _context.SaveChangesAsync();   // ← productos pendientes

            // Movimientos pendientes del último lote
            foreach (var (prod, mov) in movimientosPendientes)
            {
                mov.IdProducto = prod.IdProducto;
                _context.MovimientosInventario.Add(mov);
            }
            movimientosPendientes.Clear();

            await _context.SaveChangesAsync();   // ← movimientos

            _logger.LogInformation("Lote final guardado ({Filas} filas).", contadorLote);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error guardando el lote final");
            errores += contadorLote;
        }
    }

    _logger.LogInformation(
        "Importación masiva completada: {Creados} creados, {Actualizados} actualizados, {Errores} errores. Usuario: {User}",
        creados, actualizados, errores, idUsuario);

    return Ok(new
    {
        message = "Importación completada.",
        creados,
        actualizados,
        errores,
        total = filasAProcesar.Count,
        detalleErrores
    });
}

        // ============================================================
        // GET: api/Importacion/productos/plantilla
        // ============================================================
        [HttpGet("productos/plantilla")]
        [AllowAnonymous]
        public IActionResult DescargarPlantilla()
        {
            using var workbook = new XLWorkbook();
            var ws = workbook.Worksheets.Add("Productos");

            ws.Cell(1, 1).Value = "CodigoInterno";
            ws.Cell(1, 2).Value = "Sku";
            ws.Cell(1, 3).Value = "Nombre";
            ws.Cell(1, 4).Value = "Categoria";
            ws.Cell(1, 5).Value = "PrecioVenta";
            ws.Cell(1, 6).Value = "StockActual";
            ws.Cell(1, 7).Value = "StockMinimo";
            ws.Cell(1, 8).Value = "ImpuestoPorcentaje";
            ws.Cell(1, 9).Value = "Estado";

            var headerRange = ws.Range(1, 1, 1, 9);
            headerRange.Style.Font.Bold = true;
            headerRange.Style.Fill.BackgroundColor = XLColor.FromHtml("#2563eb");
            headerRange.Style.Font.FontColor = XLColor.White;
            headerRange.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;

            ws.Cell(2, 1).Value = "L001";
            ws.Cell(2, 2).Value = "7701234567890";
            ws.Cell(2, 3).Value = "Leche Alquería 1L";
            ws.Cell(2, 4).Value = "Lácteos";
            ws.Cell(2, 5).Value = 4500;
            ws.Cell(2, 6).Value = 100;
            ws.Cell(2, 7).Value = 10;
            ws.Cell(2, 8).Value = 19;
            ws.Cell(2, 9).Value = "Activo";

            ws.Columns().AdjustToContents();

            using var ms = new MemoryStream();
            workbook.SaveAs(ms);
            ms.Position = 0;

            return File(
                ms.ToArray(),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "plantilla-productos.xlsx"
            );
        }

        // ============================================================
        // HELPERS PRIVADOS
        // ============================================================

        private List<ProductoImportDto> LeerExcelProductos(IFormFile archivo)
        {
            var resultado = new List<ProductoImportDto>();

            using var stream = archivo.OpenReadStream();
            using var workbook = new XLWorkbook(stream);
            var ws = workbook.Worksheets.First();

            var filasUsadas = ws.RangeUsed();
            if (filasUsadas == null) return resultado;

            var totalFilas = filasUsadas.LastRow().RowNumber();

            for (int fila = 2; fila <= totalFilas; fila++)
            {
                var codigo = ws.Cell(fila, 1).GetString().Trim();
                if (string.IsNullOrWhiteSpace(codigo)) continue;

                var dto = new ProductoImportDto
                {
                    Fila = fila,
                    CodigoInterno = codigo,
                    Sku = ws.Cell(fila, 2).GetString().Trim(),
                    Nombre = ws.Cell(fila, 3).GetString().Trim(),
                    Categoria = ws.Cell(fila, 4).GetString().Trim(),
                    PrecioVenta = ParseDecimal(ws.Cell(fila, 5).GetString()),
                    StockActual = (int)ParseDecimal(ws.Cell(fila, 6).GetString()),
                    StockMinimo = (int?)ParseDecimal(ws.Cell(fila, 7).GetString()),
                    ImpuestoPorcentaje = ParseDecimal(ws.Cell(fila, 8).GetString()),
                    Estado = ws.Cell(fila, 9).GetString().Trim()
                };

                resultado.Add(dto);
            }

            return resultado;
        }

        private decimal ParseDecimal(string valor)
        {
            if (string.IsNullOrWhiteSpace(valor)) return 0;
            valor = valor.Replace(",", ".").Replace("$", "").Trim();
            return decimal.TryParse(valor, NumberStyles.Any, CultureInfo.InvariantCulture, out var d) ? d : 0;
        }

        // ============================================================
        // VALIDACIÓN (Opción D: SKU libre si el producto existe por código)
        // ============================================================
        private async Task<ValidacionResultado> ValidarFilas(List<ProductoImportDto> filas)
        {
            var resultado = new ValidacionResultado();

            var codigosVistos = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var skusVistos = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var duplicadosEnArchivo = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            // -------- PASO 1: validar cada fila individualmente y duplicados en archivo --------
            foreach (var fila in filas)
            {
                var errores = new List<string>();

                if (string.IsNullOrWhiteSpace(fila.CodigoInterno))
                    errores.Add("CodigoInterno vacío");

                if (string.IsNullOrWhiteSpace(fila.Nombre))
                    errores.Add("Nombre vacío");

                if (fila.PrecioVenta <= 0)
                    errores.Add("PrecioVenta debe ser mayor a 0");

                if (fila.StockActual < 0)
                    errores.Add("StockActual no puede ser negativo");

                if (!string.IsNullOrWhiteSpace(fila.Estado) && fila.Estado != "Activo" && fila.Estado != "Inactivo")
                    errores.Add("Estado inválido. Use 'Activo' o 'Inactivo'");

                // Duplicado de código
                if (!string.IsNullOrWhiteSpace(fila.CodigoInterno))
                {
                    if (!codigosVistos.Add(fila.CodigoInterno))
                    {
                        errores.Add("Código duplicado en el archivo");
                        duplicadosEnArchivo.Add(fila.CodigoInterno);
                    }
                }

                // Duplicado de SKU en el archivo
                if (!string.IsNullOrWhiteSpace(fila.Sku))
                {
                    var skuNorm = fila.Sku.Trim();
                    if (!skusVistos.Add(skuNorm))
                    {
                        errores.Add($"SKU duplicado en el archivo: {skuNorm}");
                        duplicadosEnArchivo.Add(skuNorm);
                    }
                }

                fila.Errores = errores;
                fila.EsValida = errores.Count == 0;

                resultado.Filas.Add(fila);
            }

            // -------- PASO 2: detectar colisiones con la BD --------
            var codigosValidos = resultado.Filas
                .Where(f => f.EsValida)
                .Select(f => f.CodigoInterno)
                .Distinct()
                .ToList();

            var existentesCod = await _context.Productos
                .Where(p => codigosValidos.Contains(p.CodigoInterno))
                .Select(p => p.CodigoInterno)
                .ToListAsync();

            var existentesSet = new HashSet<string>(existentesCod, StringComparer.OrdinalIgnoreCase);

            // Detectar SKUs que ya existen en BD
            var skusValidos = resultado.Filas
                .Where(f => f.EsValida && !string.IsNullOrWhiteSpace(f.Sku))
                .Select(f => f.Sku!.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            var skusEnBd = await _context.Productos
                .Where(p => p.Sku != null && skusValidos.Contains(p.Sku))
                .Select(p => new { p.Sku, p.CodigoInterno })
                .ToListAsync();

            var skusEnBdDict = skusEnBd
                .GroupBy(x => x.Sku!, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.First().CodigoInterno, StringComparer.OrdinalIgnoreCase);

            // -------- PASO 3: clasificar cada fila --------
            foreach (var fila in resultado.Filas)
            {
                if (!fila.EsValida) continue;

                if (existentesSet.Contains(fila.CodigoInterno))
                {
                    // PRODUCTO EXISTENTE → se actualizará
                    // (no validamos SKU contra otros productos porque el Excel sobrescribe)
                    fila.ExisteEnBd = true;
                    resultado.Actualizables++;
                }
                else
                {
                    // PRODUCTO NUEVO → validar SKU contra BD
                    if (!string.IsNullOrWhiteSpace(fila.Sku))
                    {
                        var skuNorm = fila.Sku.Trim();
                        if (skusEnBdDict.TryGetValue(skuNorm, out var codigoDelOtro))
                        {
                            fila.EsValida = false;
                            fila.Errores.Add($"SKU '{skuNorm}' ya está asignado a otro producto ({codigoDelOtro}). Cambia el SKU o usa el código existente.");
                        }
                        else
                        {
                            fila.ExisteEnBd = false;
                            resultado.Nuevos++;
                        }
                    }
                    else
                    {
                        fila.ExisteEnBd = false;
                        resultado.Nuevos++;
                    }
                }
            }

            resultado.Validas = resultado.Filas.Count(f => f.EsValida);
            resultado.ConErrores = resultado.Filas.Count(f => !f.EsValida);
            resultado.DuplicadosEnArchivo = duplicadosEnArchivo.Count;
            resultado.Errores = resultado.ConErrores;

            return resultado;
        }
    }

    // ============================================================
    // DTOs
    // ============================================================
    public class ProductoImportDto
    {
        public int Fila { get; set; }
        public string CodigoInterno { get; set; } = "";
        public string Sku { get; set; } = "";
        public string Nombre { get; set; } = "";
        public string Categoria { get; set; } = "";
        public decimal PrecioVenta { get; set; }
        public int StockActual { get; set; }
        public int? StockMinimo { get; set; }
        public decimal? ImpuestoPorcentaje { get; set; }
        public string? Estado { get; set; }

        public bool EsValida { get; set; } = true;
        public List<string> Errores { get; set; } = new();
        public bool ExisteEnBd { get; set; }
    }

    public class ValidacionResultado
    {
        public List<ProductoImportDto> Filas { get; set; } = new();
        public int Validas { get; set; }
        public int ConErrores { get; set; }
        public int Nuevos { get; set; }
        public int Actualizables { get; set; }
        public int DuplicadosEnArchivo { get; set; }
        public int Errores { get; set; }
    }
}