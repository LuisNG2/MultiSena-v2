public class DetalleVentaDto
{
    public int IdDetalle { get; set; }
    public int IdVenta { get; set; } // Added this property to fix the error  
    public int IdProducto { get; set; }
    public int Cantidad { get; set; }
    public decimal PrecioUnitarioHistorico { get; set; }
    public decimal ImpuestoUnitarioHistorico { get; set; }
    public decimal SubtotalLinea { get; set; }
}
