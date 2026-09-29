using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MultiVentasPOS.Data;

namespace MultiVentasPOS.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]   // cualquier usuario autenticado puede listar roles (lo necesita el front)
    public class RolesController : ControllerBase
    {
        private readonly AppDbContext _context;

        public RolesController(AppDbContext context)
        {
            _context = context;
        }

        // GET: api/Roles
        [HttpGet]
        public async Task<IActionResult> GetAll()
        {
            var roles = await _context.Roles
                .Select(r => new
                {
                    r.IdRol,
                    r.NombreRol,
                    r.Descripcion
                })
                .OrderBy(r => r.IdRol)
                .ToListAsync();

            return Ok(roles);
        }
    }
}