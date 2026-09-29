namespace MultiVentasPOS.Models
{
    public class DetalleVenta
    {
        public int IdDetalle { get; set; }
        public int IdVenta { get; set; }
        public int IdProducto { get; set; }
        public int Cantidad { get; set; }
        public decimal PrecioUnitarioHistorico { get; set; }
        public decimal ImpuestoUnitarioHistorico { get; set; }
        public decimal SubtotalLinea { get; set; }

        public Venta? Venta { get; set; }
        public Producto? Producto { get; set; }
    }
}