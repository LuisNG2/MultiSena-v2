namespace MultiVentasPOS.Models
{
    public class Venta
    {
        public int IdVenta { get; set; }
        public string? CodigoFactura { get; set; }
        public DateTime FechaVenta { get; set; }
        public int IdUsuario { get; set; }
        public int? IdCliente { get; set; }
        public decimal Subtotal { get; set; }
        public decimal ImpuestosTotal { get; set; }
        public decimal DescuentoTotal { get; set; }
        public decimal TotalFinal { get; set; }
        public string MetodoPago { get; set; } = "Efectivo";
        public string Estado { get; set; } = "Completada";
        public string? Nota { get; set; }

        public Usuario? Usuario { get; set; }
        public Cliente? Cliente { get; set; }
        public List<DetalleVenta> DetallesVenta { get; set; } = new List<DetalleVenta>();
    }
}