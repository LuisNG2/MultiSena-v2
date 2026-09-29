namespace MultiVentasPOS.Models
{
    using System.ComponentModel.DataAnnotations.Schema;

    public class Usuario
    {
        public int IdUsuario { get; set; }
        public string Nombre { get; set; } = string.Empty;
        public string Correo { get; set; } = string.Empty;

        [NotMapped]
        [System.Text.Json.Serialization.JsonIgnore]
        public string? Password { get; set; }

        public string ContrasenaHash { get; set; } = string.Empty;
        public int IdRol { get; set; }
        public string Estado { get; set; } = "Activo";
        public DateTime FechaCreacion { get; set; }
        public DateTime FechaActualizacion { get; set; }

        public Rol? Rol { get; set; }
        public List<Venta> Ventas { get; set; } = new List<Venta>();
        public List<MovimientoInventario> Movimientos { get; set; } = new List<MovimientoInventario>();
    }
}