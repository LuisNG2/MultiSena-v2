namespace MultiVentasPOS.Models
{
    public class RefreshToken
    {
        public int IdRefreshToken { get; set; }
        public int IdUsuario { get; set; }
        public string Token { get; set; } = string.Empty;
        public DateTime FechaExpiracion { get; set; }
        public DateTime FechaCreacion { get; set; }
        public bool Revocado { get; set; } = false;
        public DateTime? FechaRevocado { get; set; }

        // Navegación
        public Usuario? Usuario { get; set; }
    }
}