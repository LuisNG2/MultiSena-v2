namespace MultiVentasPOS.Models
{
    public class Categoria
    {
        public int IdCategoria { get; set; }
        public string Nombre { get; set; } = string.Empty;
        public string? Descripcion { get; set; }
        public List<Producto> Productos { get; set; } = new List<Producto>();
    }
}