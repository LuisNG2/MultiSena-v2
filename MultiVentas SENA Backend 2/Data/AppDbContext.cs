using Microsoft.EntityFrameworkCore;
using MultiVentasPOS.Models;

namespace MultiVentasPOS.Data
{
    public class AppDbContext : DbContext
    {
        public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
        {
        }

        // ============================================================
        // DbSets
        // ============================================================
        public DbSet<Producto> Productos { get; set; }
        public DbSet<Categoria> Categorias { get; set; }
        public DbSet<Usuario> Usuarios { get; set; }
        public DbSet<Rol> Roles { get; set; }
        public DbSet<Cliente> Clientes { get; set; }
        public DbSet<Venta> Ventas { get; set; }
        public DbSet<DetalleVenta> DetallesVenta { get; set; }
        public DbSet<MovimientoInventario> MovimientosInventario { get; set; }
        public DbSet<RefreshToken> RefreshTokens { get; set; }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);

            // ============================================
            // PRODUCTOS
            // ============================================
            modelBuilder.Entity<Producto>(entity =>
            {
                entity.ToTable("productos");
                entity.HasKey(e => e.IdProducto);

                entity.Property(e => e.IdProducto).HasColumnName("id_producto");
                entity.Property(e => e.CodigoInterno).HasColumnName("codigo_interno").HasMaxLength(50).IsRequired();
                entity.Property(e => e.Sku).HasColumnName("sku").HasMaxLength(100);
                entity.Property(e => e.Nombre).HasColumnName("nombre").HasMaxLength(150).IsRequired();
                entity.Property(e => e.IdCategoria).HasColumnName("id_categoria");
                entity.Property(e => e.Proveedor).HasColumnName("proveedor").HasMaxLength(100);
                entity.Property(e => e.PrecioVenta).HasColumnName("precio_venta").HasPrecision(12, 2);
                entity.Property(e => e.CostoBase).HasColumnName("costo_base").HasPrecision(12, 2);
                entity.Property(e => e.StockActual).HasColumnName("stock_actual");
                entity.Property(e => e.StockMinimo).HasColumnName("stock_minimo");
                entity.Property(e => e.ImpuestoPorcentaje).HasColumnName("impuesto_porcentaje").HasPrecision(5, 2);
                entity.Property(e => e.VecesVendido).HasColumnName("veces_vendido");
                entity.Property(e => e.Estado).HasColumnName("estado").HasMaxLength(20);
                entity.Property(e => e.FechaCreacion).HasColumnName("fecha_creacion");
                entity.Property(e => e.FechaActualizacion).HasColumnName("fecha_actualizacion");

                entity.HasOne(p => p.Categoria)
                      .WithMany(c => c.Productos)
                      .HasForeignKey(p => p.IdCategoria)
                      .OnDelete(DeleteBehavior.SetNull);
            });

            // ============================================
            // CATEGORIAS
            // ============================================
            modelBuilder.Entity<Categoria>(entity =>
            {
                entity.ToTable("categorias");
                entity.HasKey(e => e.IdCategoria);

                entity.Property(e => e.IdCategoria).HasColumnName("id_categoria");
                entity.Property(e => e.Nombre).HasColumnName("nombre").HasMaxLength(50).IsRequired();
                entity.Property(e => e.Descripcion).HasColumnName("descripcion").HasMaxLength(200);
            });

            // ============================================
            // USUARIOS
            // ============================================
            modelBuilder.Entity<Usuario>(entity =>
            {
                entity.ToTable("usuarios");
                entity.HasKey(e => e.IdUsuario);

                entity.Property(e => e.IdUsuario).HasColumnName("id_usuario");
                entity.Property(e => e.Nombre).HasColumnName("nombre").HasMaxLength(100).IsRequired();
                entity.Property(e => e.Correo).HasColumnName("correo").HasMaxLength(100).IsRequired();
                entity.Property(e => e.ContrasenaHash).HasColumnName("contrasena_hash").HasMaxLength(255).IsRequired();
                entity.Property(e => e.IdRol).HasColumnName("id_rol");
                entity.Property(e => e.Estado).HasColumnName("estado").HasMaxLength(20);
                entity.Property(e => e.FechaCreacion).HasColumnName("fecha_creacion");
                entity.Property(e => e.FechaActualizacion).HasColumnName("fecha_actualizacion");

                entity.HasOne(u => u.Rol)
                      .WithMany(r => r.Usuarios)
                      .HasForeignKey(u => u.IdRol)
                      .OnDelete(DeleteBehavior.Restrict);
            });

            // ============================================
            // ROLES
            // ============================================
            modelBuilder.Entity<Rol>(entity =>
            {
                entity.ToTable("roles");
                entity.HasKey(e => e.IdRol);

                entity.Property(e => e.IdRol).HasColumnName("id_rol");
                entity.Property(e => e.NombreRol).HasColumnName("nombre_rol").HasMaxLength(50).IsRequired();
                entity.Property(e => e.Descripcion).HasColumnName("descripcion").HasMaxLength(255);
                entity.Property(e => e.FechaCreacion).HasColumnName("fecha_creacion");
            });

            // ============================================
            // CLIENTES
            // ============================================
            modelBuilder.Entity<Cliente>(entity =>
            {
                entity.ToTable("clientes");
                entity.HasKey(e => e.IdCliente);

                entity.Property(e => e.IdCliente).HasColumnName("id_cliente");
                entity.Property(e => e.Documento).HasColumnName("documento").HasMaxLength(20);
                entity.Property(e => e.Nombre).HasColumnName("nombre").HasMaxLength(100).IsRequired();
                entity.Property(e => e.Correo).HasColumnName("correo").HasMaxLength(100);
                entity.Property(e => e.Telefono).HasColumnName("telefono").HasMaxLength(20);
                entity.Property(e => e.Ciudad).HasColumnName("ciudad").HasMaxLength(50);
                entity.Property(e => e.Direccion).HasColumnName("direccion").HasMaxLength(200);
                entity.Property(e => e.TipoCliente).HasColumnName("tipo_cliente").HasMaxLength(20);
                entity.Property(e => e.FechaCreacion).HasColumnName("fecha_creacion");

                entity.HasMany(c => c.Ventas)
                      .WithOne(v => v.Cliente)
                      .HasForeignKey(v => v.IdCliente)
                      .OnDelete(DeleteBehavior.Restrict);
            });

            // ============================================
            // VENTAS
            // ============================================
            modelBuilder.Entity<Venta>(entity =>
            {
                entity.ToTable("ventas");
                entity.HasKey(e => e.IdVenta);

                entity.Property(e => e.IdVenta).HasColumnName("id_venta");
                entity.Property(e => e.CodigoFactura).HasColumnName("codigo_factura").HasMaxLength(50);
                entity.Property(e => e.FechaVenta).HasColumnName("fecha_venta");
                entity.Property(e => e.IdUsuario).HasColumnName("id_usuario");
                entity.Property(e => e.IdCliente).HasColumnName("id_cliente");
                entity.Property(e => e.Subtotal).HasColumnName("subtotal").HasPrecision(12, 2);
                entity.Property(e => e.ImpuestosTotal).HasColumnName("impuestos_total").HasPrecision(12, 2);
                entity.Property(e => e.DescuentoTotal).HasColumnName("descuento_total").HasPrecision(12, 2);
                entity.Property(e => e.TotalFinal).HasColumnName("total_final").HasPrecision(12, 2);
                entity.Property(e => e.MetodoPago).HasColumnName("metodo_pago").HasMaxLength(20);
                entity.Property(e => e.Estado).HasColumnName("estado").HasMaxLength(20);
                entity.Property(e => e.Nota).HasColumnName("nota");

                entity.HasOne(v => v.Usuario)
                      .WithMany(u => u.Ventas)
                      .HasForeignKey(v => v.IdUsuario)
                      .OnDelete(DeleteBehavior.Restrict);

                entity.HasMany(v => v.DetallesVenta)
                      .WithOne(d => d.Venta)
                      .HasForeignKey(d => d.IdVenta)
                      .OnDelete(DeleteBehavior.Cascade);
            });

            // ============================================
            // DETALLE VENTA
            // ============================================
            modelBuilder.Entity<DetalleVenta>(entity =>
            {
                entity.ToTable("detalle_venta");
                entity.HasKey(e => e.IdDetalle);

                entity.Property(e => e.IdDetalle).HasColumnName("id_detalle");
                entity.Property(e => e.IdVenta).HasColumnName("id_venta");
                entity.Property(e => e.IdProducto).HasColumnName("id_producto");
                entity.Property(e => e.Cantidad).HasColumnName("cantidad");
                entity.Property(e => e.PrecioUnitarioHistorico).HasColumnName("precio_unitario_historico").HasPrecision(12, 2);
                entity.Property(e => e.ImpuestoUnitarioHistorico).HasColumnName("impuesto_unitario_historico").HasPrecision(12, 2);
                entity.Property(e => e.SubtotalLinea).HasColumnName("subtotal_linea").HasPrecision(12, 2);

                entity.HasOne(d => d.Producto)
                      .WithMany(p => p.DetallesVenta)
                      .HasForeignKey(d => d.IdProducto)
                      .OnDelete(DeleteBehavior.Restrict);
            });

            // ============================================
            // MOVIMIENTOS INVENTARIO
            // ============================================
            modelBuilder.Entity<MovimientoInventario>(entity =>
            {
                entity.ToTable("movimientos_inventario");
                entity.HasKey(e => e.IdMovimiento);

                entity.Property(e => e.IdMovimiento).HasColumnName("id_movimiento");
                entity.Property(e => e.IdProducto).HasColumnName("id_producto");
                entity.Property(e => e.IdUsuario).HasColumnName("id_usuario");
                entity.Property(e => e.TipoMovimiento).HasColumnName("tipo_movimiento").HasMaxLength(30).IsRequired();
                entity.Property(e => e.Cantidad).HasColumnName("cantidad");
                entity.Property(e => e.StockAnterior).HasColumnName("stock_anterior");
                entity.Property(e => e.StockNuevo).HasColumnName("stock_nuevo");
                entity.Property(e => e.ReferenciaExterna).HasColumnName("referencia_externa").HasMaxLength(100);
                entity.Property(e => e.FechaMovimiento).HasColumnName("fecha_movimiento");
                entity.Property(e => e.Nota).HasColumnName("nota");

                entity.HasOne(m => m.Producto)
                      .WithMany(p => p.Movimientos)
                      .HasForeignKey(m => m.IdProducto)
                      .OnDelete(DeleteBehavior.Restrict);

                entity.HasOne(m => m.Usuario)
                      .WithMany(u => u.Movimientos)
                      .HasForeignKey(m => m.IdUsuario)
                      .OnDelete(DeleteBehavior.Restrict);
            });

            // ============================================
            // REFRESH TOKENS
            // ============================================
            modelBuilder.Entity<RefreshToken>(entity =>
            {
                entity.ToTable("refresh_tokens");
                entity.HasKey(e => e.IdRefreshToken);

                entity.Property(e => e.IdRefreshToken).HasColumnName("id_refresh_token");
                entity.Property(e => e.IdUsuario).HasColumnName("id_usuario");
                entity.Property(e => e.Token).HasColumnName("token").HasMaxLength(500).IsRequired();
                entity.Property(e => e.FechaExpiracion).HasColumnName("fecha_expiracion");
                entity.Property(e => e.FechaCreacion).HasColumnName("fecha_creacion");
                entity.Property(e => e.Revocado).HasColumnName("revocado");
                entity.Property(e => e.FechaRevocado).HasColumnName("fecha_revocado");

                entity.HasOne(e => e.Usuario)
                      .WithMany()
                      .HasForeignKey(e => e.IdUsuario)
                      .OnDelete(DeleteBehavior.Cascade);

                entity.HasIndex(e => e.Token).HasDatabaseName("IX_RefreshTokens_Token");
            });
        }
    }
}