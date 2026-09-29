namespace MultiVentasPOS.Models
{
    public class Cliente
    {
        public int IdCliente { get; set; }

        public string? Documento { get; set; }

        public string Nombre { get; set; } = string.Empty;   // ← inicializado

        public string? Correo { get; set; }
        public string? Telefono { get; set; }
        public string? Ciudad { get; set; }
        public string? Direccion { get; set; }

        public string TipoCliente { get; set; } = "Nuevo";   // ← inicializado

        public DateTime FechaCreacion { get; set; }

        public List<Venta> Ventas { get; set; } = new List<Venta>();
    }
}