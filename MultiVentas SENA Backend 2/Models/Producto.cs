namespace MultiVentasPOS.Models
{
    public class Producto
    {
        public int IdProducto { get; set; }
        public string CodigoInterno { get; set; } = string.Empty;
        public string? Sku { get; set; }
        public string Nombre { get; set; } = string.Empty;
        public int? IdCategoria { get; set; }
        public string? Proveedor { get; set; }
        public decimal PrecioVenta { get; set; }
        public decimal? CostoBase { get; set; }
        public int StockActual { get; set; }
        public int StockMinimo { get; set; }
        public decimal ImpuestoPorcentaje { get; set; }
        public int VecesVendido { get; set; }
        public string? Estado { get; set; }
        public DateTime FechaCreacion { get; set; }
        public DateTime FechaActualizacion { get; set; }

        public Categoria? Categoria { get; set; }
        public List<DetalleVenta> DetallesVenta { get; set; } = new List<DetalleVenta>();
        public List<MovimientoInventario> Movimientos { get; set; } = new List<MovimientoInventario>();
    }
}