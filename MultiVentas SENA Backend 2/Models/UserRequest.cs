namespace MultiVentasPOS.Models
{
    using System.ComponentModel.DataAnnotations;

    public class UserRequest
    {
        [Required] public string Nombre { get; set; }
        [Required][EmailAddress] public string Correo { get; set; }
        [Required][StringLength(100, MinimumLength = 6)] public string Password { get; set; }
        [Required] public int IdRol { get; set; }
        public string Estado { get; set; } = "Activo";
    }

    public class UpdateUserRequest
    {
        public string Nombre { get; set; }
        [EmailAddress] public string Correo { get; set; }
        [StringLength(100, MinimumLength = 6)] public string Password { get; set; }
        public int? IdRol { get; set; }
        public string Estado { get; set; }
    }

    public class LoginRequest
    {
        [Required][EmailAddress] public string Correo { get; set; }
        [Required] public string Password { get; set; }
    }
}