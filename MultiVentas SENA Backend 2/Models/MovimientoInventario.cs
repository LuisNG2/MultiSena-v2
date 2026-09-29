namespace MultiVentasPOS.Models
{
    public class MovimientoInventario
    {
        public int IdMovimiento { get; set; }
        public int IdProducto { get; set; }
        public int IdUsuario { get; set; }
        public string TipoMovimiento { get; set; } = string.Empty;
        public int Cantidad { get; set; }
        public int StockAnterior { get; set; }
        public int StockNuevo { get; set; }
        public string? ReferenciaExterna { get; set; }
        public DateTime FechaMovimiento { get; set; }
        public string? Nota { get; set; }

        public Producto? Producto { get; set; }
        public Usuario? Usuario { get; set; }
    }
}