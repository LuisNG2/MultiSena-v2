USE MultiVentasPOS;
GO

SET NOCOUNT ON;
GO

PRINT '====================================================';
PRINT 'INSERTANDO DATOS DE PRUEBA';
PRINT '====================================================';
GO

---- ============================================================
---- 1. USUARIOS DE PRUEBA
---- ============================================================
--PRINT '→ Insertando usuarios...';

---- IMPORTANTE: el hash corresponde a SHA256 en Base64
---- admin@multiventas.com    → Admin123!
---- cajero@multiventas.com   → Cajero123!
---- vendedor@multiventas.com → Vende123!

--DECLARE @rolAdmin INT = (SELECT id_rol FROM roles WHERE nombre_rol = 'Administrador');
--DECLARE @rolCajero INT = (SELECT id_rol FROM roles WHERE nombre_rol = 'Cajero');

---- Admin (hash SHA256 Base64 de "Admin123!")
--IF NOT EXISTS (SELECT 1 FROM usuarios WHERE correo = 'admin@multiventas.com')
--BEGIN
--    INSERT INTO usuarios (nombre, correo, contrasena_hash, id_rol, estado, fecha_creacion, fecha_actualizacion)
--    VALUES ('Administrador Principal', 'admin@multiventas.com', 
--            'XohImNoUpT/ozVN0lvTeYzTXVKL6x9/VKvzH6lDNx3A=', 
--            @rolAdmin, 'Activo', GETDATE(), GETDATE());
--    PRINT '  ✓ admin@multiventas.com (Admin123!)';
--END

---- Cajero
--IF NOT EXISTS (SELECT 1 FROM usuarios WHERE correo = 'cajero@multiventas.com')
--BEGIN
--    INSERT INTO usuarios (nombre, correo, contrasena_hash, id_rol, estado, fecha_creacion, fecha_actualizacion)
--    VALUES ('Carlos Cajero', 'cajero@multiventas.com', 
--            'L8Xy3DDbT4V6O0WmB8i2lYqTHd9x5FvJ7KpN6RnE2Mc=', 
--            @rolCajero, 'Activo', GETDATE(), GETDATE());
--    PRINT '  ✓ cajero@multiventas.com (Cajero123!)';
--END

---- Vendedor
--IF NOT EXISTS (SELECT 1 FROM usuarios WHERE correo = 'vendedor@multiventas.com')
--BEGIN
--    INSERT INTO usuarios (nombre, correo, contrasena_hash, id_rol, estado, fecha_creacion, fecha_actualizacion)
--    VALUES ('María Vendedora', 'vendedor@multiventas.com', 
--            'vG7T4O0WmB8i2lYqTHd9x5FvJ7KpN6RnE2McXohImNo=', 
--            @rolCajero, 'Activo', GETDATE(), GETDATE());
--    PRINT '  ✓ vendedor@multiventas.com (Vende123!)';
--END
--GO

-- ============================================================
-- 2. CLIENTES DE PRUEBA
-- ============================================================
PRINT '→ Insertando clientes...';

IF NOT EXISTS (SELECT 1 FROM clientes WHERE documento = '1234567890')
    INSERT INTO clientes (documento, nombre, correo, telefono, ciudad, direccion, tipo_cliente, fecha_creacion)
    VALUES ('1234567890', 'Juan Pérez', 'juan.perez@example.com', '3001234567', 
            'Bogotá', 'Calle 45 #12-34', 'Frecuente', GETDATE());

IF NOT EXISTS (SELECT 1 FROM clientes WHERE documento = '9876543210')
    INSERT INTO clientes (documento, nombre, correo, telefono, ciudad, direccion, tipo_cliente, fecha_creacion)
    VALUES ('9876543210', 'María González', 'maria.gonzalez@example.com', '3009876543', 
            'Medellín', 'Carrera 80 #20-15', 'Frecuente', GETDATE());

IF NOT EXISTS (SELECT 1 FROM clientes WHERE documento = '900123456-7')
    INSERT INTO clientes (documento, nombre, correo, telefono, ciudad, direccion, tipo_cliente, fecha_creacion)
    VALUES ('900123456-7', 'Supermercado El Éxito S.A.', 'compras@exito.com', '6012345678', 
            'Bogotá', 'Calle 80 #50-20', 'Corporativo', GETDATE());

IF NOT EXISTS (SELECT 1 FROM clientes WHERE documento = '1122334455')
    INSERT INTO clientes (documento, nombre, correo, telefono, ciudad, direccion, tipo_cliente, fecha_creacion)
    VALUES ('1122334455', 'Pedro Ramírez', NULL, '3105556677', 
            'Cali', NULL, 'Nuevo', GETDATE());

IF NOT EXISTS (SELECT 1 FROM clientes WHERE documento = '5544332211')
    INSERT INTO clientes (documento, nombre, correo, telefono, ciudad, direccion, tipo_cliente, fecha_creacion)
    VALUES ('5544332211', 'Laura Torres', 'laura.torres@example.com', NULL, 
            'Barranquilla', 'Av. 20 #10-05', 'Nuevo', GETDATE());

PRINT '  ✓ 5 clientes insertados.';
GO

-- ============================================================
-- 3. CATEGORÍAS ADICIONALES
-- ============================================================
PRINT '→ Insertando categorías adicionales...';

IF NOT EXISTS (SELECT 1 FROM categorias WHERE nombre = 'Snacks')
    INSERT INTO categorias (nombre, descripcion) VALUES ('Snacks', 'Papas, chocolates, galletas y más');

IF NOT EXISTS (SELECT 1 FROM categorias WHERE nombre = 'Carnes')
    INSERT INTO categorias (nombre, descripcion) VALUES ('Carnes', 'Carnes y embutidos');

IF NOT EXISTS (SELECT 1 FROM categorias WHERE nombre = 'Frutas y Verduras')
    INSERT INTO categorias (nombre, descripcion) VALUES ('Frutas y Verduras', 'Frescos del día');

IF NOT EXISTS (SELECT 1 FROM categorias WHERE nombre = 'Panadería')
    INSERT INTO categorias (nombre, descripcion) VALUES ('Panadería', 'Pan y productos de panadería');

PRINT '  ✓ Categorías adicionales insertadas.';
GO

-- ============================================================
-- 4. PRODUCTOS DE PRUEBA
-- ============================================================
PRINT '→ Insertando productos...';

DECLARE @catGeneral INT = (SELECT id_categoria FROM categorias WHERE nombre = 'General');
DECLARE @catBebidas INT = (SELECT id_categoria FROM categorias WHERE nombre = 'Bebidas');
DECLARE @catAbarrotes INT = (SELECT id_categoria FROM categorias WHERE nombre = 'Abarrotes');
DECLARE @catAseo INT = (SELECT id_categoria FROM categorias WHERE nombre = 'Aseo');
DECLARE @catLacteos INT = (SELECT id_categoria FROM categorias WHERE nombre = 'Lácteos');
DECLARE @catSnacks INT = (SELECT id_categoria FROM categorias WHERE nombre = 'Snacks');
DECLARE @catPanaderia INT = (SELECT id_categoria FROM categorias WHERE nombre = 'Panadería');

-- ABARROTES
INSERT INTO productos (codigo_interno, sku, nombre, id_categoria, proveedor, precio_venta, costo_base, stock_actual, stock_minimo, impuesto_porcentaje, estado)
SELECT * FROM (VALUES
    ('A001', '7701234567890', 'Arroz Diana 500g', @catAbarrotes, 'Diana', 2500.00, 1800.00, 100, 10, 19.00, 'Activo'),
    ('A002', '7701234567891', 'Frijol Bolo Rojo 500g', @catAbarrotes, 'Bolo', 4500.00, 3200.00, 80, 10, 19.00, 'Activo'),
    ('A003', '7701234567892', 'Aceite Girasol 1L', @catAbarrotes, 'Premier', 8500.00, 6200.00, 50, 5, 19.00, 'Activo'),
    ('A004', '7701234567893', 'Azúcar Manuelita 1kg', @catAbarrotes, 'Manuelita', 3800.00, 2800.00, 120, 15, 19.00, 'Activo'),
    ('A005', '7701234567894', 'Sal Refisal 500g', @catAbarrotes, 'Refisal', 1500.00, 1000.00, 200, 20, 19.00, 'Activo'),
    ('A006', '7701234567895', 'Café Águila Roja 250g', @catAbarrotes, 'Águila Roja', 7800.00, 5500.00, 60, 10, 19.00, 'Activo'),
    ('A007', '7701234567896', 'Pasta Doria 500g', @catAbarrotes, 'Doria', 3200.00, 2200.00, 90, 10, 19.00, 'Activo')
) AS v(codigo_interno, sku, nombre, id_categoria, proveedor, precio_venta, costo_base, stock_actual, stock_minimo, impuesto_porcentaje, estado)
WHERE NOT EXISTS (SELECT 1 FROM productos p WHERE p.codigo_interno = v.codigo_interno);

-- BEBIDAS
INSERT INTO productos (codigo_interno, sku, nombre, id_categoria, proveedor, precio_venta, costo_base, stock_actual, stock_minimo, impuesto_porcentaje, estado)
SELECT * FROM (VALUES
    ('B001', '7702234567890', 'Coca-Cola 1.5L', @catBebidas, 'Coca-Cola', 5500.00, 3800.00, 150, 20, 19.00, 'Activo'),
    ('B002', '7702234567891', 'Pepsi 1.5L', @catBebidas, 'Pepsi', 5200.00, 3600.00, 100, 15, 19.00, 'Activo'),
    ('B003', '7702234567892', 'Agua Cristal 1L', @catBebidas, 'Cristal', 2000.00, 1200.00, 300, 30, 19.00, 'Activo'),
    ('B004', '7702234567893', 'Jugo Hit Mora 500ml', @catBebidas, 'Hit', 2800.00, 1900.00, 80, 10, 19.00, 'Activo'),
    ('B005', '7702234567894', 'Cerveza Águila 330ml', @catBebidas, 'Bavaria', 3500.00, 2200.00, 200, 24, 19.00, 'Activo'),
    ('B006', '7702234567895', 'Malta Pony 330ml', @catBebidas, 'Bavaria', 2500.00, 1600.00, 100, 15, 19.00, 'Activo')
) AS v(codigo_interno, sku, nombre, id_categoria, proveedor, precio_venta, costo_base, stock_actual, stock_minimo, impuesto_porcentaje, estado)
WHERE NOT EXISTS (SELECT 1 FROM productos p WHERE p.codigo_interno = v.codigo_interno);

-- LÁCTEOS
INSERT INTO productos (codigo_interno, sku, nombre, id_categoria, proveedor, precio_venta, costo_base, stock_actual, stock_minimo, impuesto_porcentaje, estado)
SELECT * FROM (VALUES
    ('L001', '7703234567890', 'Leche Alquería 1L', @catLacteos, 'Alquería', 4500.00, 3200.00, 80, 10, 19.00, 'Activo'),
    ('L002', '7703234567891', 'Yogurt Alpina Fresa 1L', @catLacteos, 'Alpina', 6500.00, 4800.00, 60, 8, 19.00, 'Activo'),
    ('L003', '7703234567892', 'Queso Campesino 250g', @catLacteos, 'Colanta', 8500.00, 6200.00, 40, 5, 19.00, 'Activo'),
    ('L004', '7703234567893', 'Mantequilla Colanta 250g', @catLacteos, 'Colanta', 9800.00, 7200.00, 30, 5, 19.00, 'Activo'),
    ('L005', '7703234567894', 'Leche en Polvo Klim 400g', @catLacteos, 'Nestlé', 18500.00, 14000.00, 25, 3, 19.00, 'Activo')
) AS v(codigo_interno, sku, nombre, id_categoria, proveedor, precio_venta, costo_base, stock_actual, stock_minimo, impuesto_porcentaje, estado)
WHERE NOT EXISTS (SELECT 1 FROM productos p WHERE p.codigo_interno = v.codigo_interno);

-- ASEO
INSERT INTO productos (codigo_interno, sku, nombre, id_categoria, proveedor, precio_venta, costo_base, stock_actual, stock_minimo, impuesto_porcentaje, estado)
SELECT * FROM (VALUES
    ('S001', '7704234567890', 'Jabón Rey 300g', @catAseo, 'Rey', 3800.00, 2600.00, 120, 15, 19.00, 'Activo'),
    ('S002', '7704234567891', 'Detergente Fab 1kg', @catAseo, 'Fab', 12500.00, 9200.00, 60, 8, 19.00, 'Activo'),
    ('S003', '7704234567892', 'Suavizante Downy 1L', @catAseo, 'Downy', 11500.00, 8500.00, 50, 6, 19.00, 'Activo'),
    ('S004', '7704234567893', 'Limpiador Fabuloso 1L', @catAseo, 'Fabuloso', 8900.00, 6400.00, 70, 8, 19.00, 'Activo'),
    ('S005', '7704234567894', 'Papel Higiénico Familia x4', @catAseo, 'Familia', 8500.00, 6200.00, 100, 12, 19.00, 'Activo')
) AS v(codigo_interno, sku, nombre, id_categoria, proveedor, precio_venta, costo_base, stock_actual, stock_minimo, impuesto_porcentaje, estado)
WHERE NOT EXISTS (SELECT 1 FROM productos p WHERE p.codigo_interno = v.codigo_interno);

-- SNACKS
INSERT INTO productos (codigo_interno, sku, nombre, id_categoria, proveedor, precio_venta, costo_base, stock_actual, stock_minimo, impuesto_porcentaje, estado)
SELECT * FROM (VALUES
    ('K001', '7705234567890', 'Papas Margarita 105g', @catSnacks, 'Margarita', 3500.00, 2300.00, 150, 20, 19.00, 'Activo'),
    ('K002', '7705234567891', 'Chocorramo', @catSnacks, 'Ramo', 2500.00, 1600.00, 80, 10, 19.00, 'Activo'),
    ('K003', '7705234567892', 'Galletas Festival x12', @catSnacks, 'Festival', 6500.00, 4800.00, 60, 8, 19.00, 'Activo'),
    ('K004', '7705234567893', 'Chocolatina Jet', @catSnacks, 'Jet', 1200.00, 700.00, 200, 30, 19.00, 'Activo'),
    ('K005', '7705234567894', 'Maní La Especial 50g', @catSnacks, 'La Especial', 2200.00, 1400.00, 100, 15, 19.00, 'Activo')
) AS v(codigo_interno, sku, nombre, id_categoria, proveedor, precio_venta, costo_base, stock_actual, stock_minimo, impuesto_porcentaje, estado)
WHERE NOT EXISTS (SELECT 1 FROM productos p WHERE p.codigo_interno = v.codigo_interno);

-- PANADERÍA
INSERT INTO productos (codigo_interno, sku, nombre, id_categoria, proveedor, precio_venta, costo_base, stock_actual, stock_minimo, impuesto_porcentaje, estado)
SELECT * FROM (VALUES
    ('P001', '7706234567890', 'Pan Tajado Blanco', @catPanaderia, 'Bimbo', 4500.00, 3200.00, 40, 5, 19.00, 'Activo'),
    ('P002', '7706234567891', 'Pan Integral Bimbo', @catPanaderia, 'Bimbo', 5200.00, 3800.00, 35, 5, 19.00, 'Activo'),
    ('P003', '7706234567892', 'Tostadas Ramo x12', @catPanaderia, 'Ramo', 3800.00, 2600.00, 50, 8, 19.00, 'Activo')
) AS v(codigo_interno, sku, nombre, id_categoria, proveedor, precio_venta, costo_base, stock_actual, stock_minimo, impuesto_porcentaje, estado)
WHERE NOT EXISTS (SELECT 1 FROM productos p WHERE p.codigo_interno = v.codigo_interno);

PRINT '  ✓ Productos insertados.';
GO

-- ============================================================
-- 5. VERIFICACIÓN
-- ============================================================
PRINT '';
PRINT '====================================================';
PRINT 'VERIFICACIÓN';
PRINT '====================================================';

SELECT 'usuarios' AS Tabla, COUNT(*) AS Filas FROM usuarios
UNION ALL SELECT 'roles', COUNT(*) FROM roles
UNION ALL SELECT 'clientes', COUNT(*) FROM clientes
UNION ALL SELECT 'categorias', COUNT(*) FROM categorias
UNION ALL SELECT 'productos', COUNT(*) FROM productos
UNION ALL SELECT 'ventas', COUNT(*) FROM ventas
UNION ALL SELECT 'detalle_venta', COUNT(*) FROM detalle_venta
UNION ALL SELECT 'movimientos_inventario', COUNT(*) FROM movimientos_inventario;

PRINT '';
PRINT '✓ Datos de prueba insertados correctamente.';
PRINT '====================================================';
GO

USE MultiVentasPOS;
GO

DECLARE @idUsuario INT = (SELECT TOP 1 id_usuario FROM usuarios);
DECLARE @idCliente1 INT = (SELECT TOP 1 id_cliente FROM clientes);
DECLARE @idCliente2 INT = (SELECT TOP 1 id_cliente FROM clientes WHERE tipo_cliente = 'Corporativo');

-- Venta 1: cliente frecuente, efectivo
DECLARE @venta1 INT;

INSERT INTO ventas (codigo_factura, fecha_venta, id_usuario, id_cliente, subtotal, impuestos_total, descuento_total, total_final, metodo_pago, estado, nota)
VALUES ('FAC-20260922-0001', GETDATE(), @idUsuario, @idCliente1, 13000, 2470, 0, 15470, 'Efectivo', 'Completada', 'Venta de prueba 1');
SET @venta1 = SCOPE_IDENTITY();

INSERT INTO detalle_venta (id_venta, id_producto, cantidad, precio_unitario_historico, impuesto_unitario_historico, subtotal_linea)
VALUES 
    (@venta1, 1, 2, 2500, 475, 5950),
    (@venta1, 8, 1, 5500, 1045, 6545),
    (@venta1, 12, 1, 2000, 380, 2380);

-- Venta 2: cliente corporativo, tarjeta
DECLARE @venta2 INT;

INSERT INTO ventas (codigo_factura, fecha_venta, id_usuario, id_cliente, subtotal, impuestos_total, descuento_total, total_final, metodo_pago, estado, nota)
VALUES ('FAC-20260922-0002', GETDATE(), @idUsuario, @idCliente2, 25000, 4750, 0, 29750, 'Tarjeta', 'Completada', 'Compra mayorista');
SET @venta2 = SCOPE_IDENTITY();

INSERT INTO detalle_venta (id_venta, id_producto, cantidad, precio_unitario_historico, impuesto_unitario_historico, subtotal_linea)
VALUES 
    (@venta2, 2, 3, 4500, 855, 16065),
    (@venta2, 6, 1, 7800, 1482, 9282),
    (@venta2, 14, 1, 4500, 855, 5355);

PRINT '✓ 2 ventas de ejemplo insertadas.';
GO

USE MultiVentasPOS;
GO

---- Verificar que el rol Administrador exista (id_rol = 1)
--DECLARE @idRolAdmin INT = (SELECT id_rol FROM roles WHERE nombre_rol = 'Administrador');

--IF @idRolAdmin IS NULL
--BEGIN
--    PRINT 'ERROR: No existe el rol Administrador. Ejecuta primero el seed.';
--    RETURN;
--END

--IF NOT EXISTS (SELECT 1 FROM usuarios WHERE correo = 'admin@multiventas.com')
--BEGIN
--    INSERT INTO usuarios (nombre, correo, contrasena_hash, id_rol, estado, fecha_creacion, fecha_actualizacion)
--    VALUES (
--        'Administrador',
--        'admin@multiventas.com',
--        'jGl25bVBBBW96Qi9Te4V37Fnqchz/Eu4qB9vKrRIqRg=',  -- SHA256("Admin123") en Base64
--        @idRolAdmin,
--        'Activo',
--        GETUTCDATE(),
--        GETUTCDATE()
--    );
--    PRINT '✓ Usuario admin creado: admin@multiventas.com / Admin123';
--END
--ELSE
--BEGIN
--    PRINT 'El usuario admin ya existe.';
--END
--GO

-- Verificar
SELECT id_usuario, nombre, correo, id_rol, estado FROM usuarios;
GO