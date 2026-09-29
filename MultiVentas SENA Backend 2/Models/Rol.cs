namespace MultiVentasPOS.Models
{
    public class Rol
    {
        public int IdRol { get; set; }
        public string NombreRol { get; set; } = string.Empty;
        public string? Descripcion { get; set; }
        public DateTime FechaCreacion { get; set; }
        public List<Usuario> Usuarios { get; set; } = new List<Usuario>();
    }
}