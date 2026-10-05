-- ============================================================
--  SISTEMA: MultiVentasPOS
--  PROYECTO: SENA
--  DESCRIPCIÓN: Script de creación completo con validaciones
--  IDEMPOTENTE: Puede ejecutarse múltiples veces sin error
--  IMPORTANTE: Conéctate a 'master' antes de ejecutar este script
-- ============================================================
USE master;
--DROP DATABASE MultiVentasPOS;

SET NOCOUNT ON;
GO

PRINT '====================================================';
PRINT 'INICIO: Creación de base de datos MultiVentasPOS';
PRINT 'Fecha: ' + CONVERT(VARCHAR(20), GETDATE(), 120);
PRINT '====================================================';
GO

-- ============================================================
-- PASO 1: VERIFICAR SERVIDOR
-- ============================================================
PRINT '→ Verificando servidor SQL Server...';

IF SERVERPROPERTY('ProductVersion') IS NULL
BEGIN
    RAISERROR('ERROR: No hay conexión activa al servidor SQL Server.', 16, 1);
    RETURN;
END

PRINT '  Servidor: ' + CAST(SERVERPROPERTY('ServerName') AS VARCHAR(100));
PRINT '  Versión:  ' + CAST(SERVERPROPERTY('ProductVersion') AS VARCHAR(50));
PRINT '  Edición:  ' + CAST(SERVERPROPERTY('Edition') AS VARCHAR(100));
PRINT '  BD actual: ' + DB_NAME();
GO

-- ============================================================
-- PASO 2: CREAR BASE DE DATOS (si no existe)
-- ============================================================
PRINT '→ Verificando base de datos MultiVentasPOS...';

IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = N'MultiVentasPOS')
BEGIN
    PRINT '  No existe. Creándola...';
    CREATE DATABASE MultiVentasPOS;
    PRINT '  ✓ Base de datos MultiVentasPOS creada.';
END
ELSE
BEGIN
    PRINT '  Ya existe. Sin cambios.';
END
GO

-- ============================================================
-- PASO 3: CAMBIAR CONTEXTO A LA BD
-- ============================================================
USE MultiVentasPOS;
GO

PRINT '→ Base de datos activa: ' + DB_NAME();
GO

-- ============================================================
-- PASO 4: CREAR TABLAS (en orden de dependencias)
-- ============================================================

-- ------------------------------------------------------------
-- 4.1. TABLA: roles
-- ------------------------------------------------------------
PRINT '→ Tabla roles...';
IF OBJECT_ID('dbo.roles', 'U') IS NULL
BEGIN
    CREATE TABLE roles (
        id_rol          INT IDENTITY(1,1) NOT NULL,
        nombre_rol      VARCHAR(50) NOT NULL,
        descripcion     VARCHAR(255) NULL,
        fecha_creacion  DATETIME NOT NULL 
            CONSTRAINT DF_Roles_FechaCreacion DEFAULT GETUTCDATE(),
        CONSTRAINT PK_Roles PRIMARY KEY (id_rol),
        CONSTRAINT UQ_Roles_NombreRol UNIQUE (nombre_rol)
    );
    PRINT '  ✓ Creada.';
END
ELSE
    PRINT '  Ya existía.';
GO

-- ------------------------------------------------------------
-- 4.2. TABLA: usuarios
-- ------------------------------------------------------------
PRINT '→ Tabla usuarios...';
IF OBJECT_ID('dbo.usuarios', 'U') IS NULL
BEGIN
    CREATE TABLE usuarios (
        id_usuario           INT IDENTITY(1,1) NOT NULL,
        nombre               VARCHAR(100) NOT NULL,
        correo               VARCHAR(100) NOT NULL,
        contrasena_hash      VARCHAR(255) NOT NULL,
        id_rol               INT NOT NULL,
        estado               VARCHAR(20) NOT NULL 
            CONSTRAINT DF_Usuarios_Estado DEFAULT 'Activo'
            CONSTRAINT CHK_Usuarios_Estado CHECK (estado IN ('Activo', 'Inactivo')),
        fecha_creacion       DATETIME NOT NULL 
            CONSTRAINT DF_Usuarios_FechaCreacion DEFAULT GETUTCDATE(),
        fecha_actualizacion  DATETIME NOT NULL 
            CONSTRAINT DF_Usuarios_FechaActualizacion DEFAULT GETUTCDATE(),
        CONSTRAINT PK_Usuarios PRIMARY KEY (id_usuario),
        CONSTRAINT UQ_Usuarios_Correo UNIQUE (correo),
        CONSTRAINT FK_Usuarios_Roles FOREIGN KEY (id_rol) REFERENCES roles(id_rol)
    );
    PRINT '  ✓ Creada.';
END
ELSE
    PRINT '  Ya existía.';
GO

-- ------------------------------------------------------------
-- 4.3. TABLA: clientes
-- ------------------------------------------------------------
PRINT '→ Tabla clientes...';
IF OBJECT_ID('dbo.clientes', 'U') IS NULL
BEGIN
    CREATE TABLE clientes (
        id_cliente       INT IDENTITY(1,1) NOT NULL,
        documento        VARCHAR(20) NULL,
        nombre           VARCHAR(100) NOT NULL,
        correo           VARCHAR(100) NULL,
        telefono         VARCHAR(20) NULL,
        ciudad           VARCHAR(50) NULL,
        direccion        VARCHAR(200) NULL,
        tipo_cliente     VARCHAR(20) NOT NULL
            CONSTRAINT DF_Clientes_TipoCliente DEFAULT 'Nuevo'
            CONSTRAINT CHK_Clientes_TipoCliente CHECK (tipo_cliente IN ('Frecuente', 'Nuevo', 'Corporativo')),
        fecha_creacion   DATETIME NOT NULL 
            CONSTRAINT DF_Clientes_FechaCreacion DEFAULT GETUTCDATE(),
        CONSTRAINT PK_Clientes PRIMARY KEY (id_cliente),
        CONSTRAINT UQ_Clientes_Documento UNIQUE (documento)
    );
    PRINT '  ✓ Creada.';
END
ELSE
    PRINT '  Ya existía.';
GO

-- ------------------------------------------------------------
-- 4.4. TABLA: categorias
-- ------------------------------------------------------------
PRINT '→ Tabla categorias...';
IF OBJECT_ID('dbo.categorias', 'U') IS NULL
BEGIN
    CREATE TABLE categorias (
        id_categoria  INT IDENTITY(1,1) NOT NULL,
        nombre        VARCHAR(50) NOT NULL,
        descripcion   VARCHAR(200) NULL,
        CONSTRAINT PK_Categorias PRIMARY KEY (id_categoria),
        CONSTRAINT UQ_Categorias_Nombre UNIQUE (nombre)
    );
    PRINT '  ✓ Creada.';
END
ELSE
    PRINT '  Ya existía.';
GO

-- ------------------------------------------------------------
-- 4.5. TABLA: productos
-- ------------------------------------------------------------
PRINT '→ Tabla productos...';
IF OBJECT_ID('dbo.productos', 'U') IS NULL
BEGIN
    CREATE TABLE productos (
        id_producto          INT IDENTITY(1,1) NOT NULL,
        codigo_interno       VARCHAR(50) NOT NULL,
        sku                  VARCHAR(100) NULL,
        nombre               VARCHAR(150) NOT NULL,
        id_categoria         INT NULL,
        proveedor            VARCHAR(100) NULL,
        precio_venta         DECIMAL(12,2) NOT NULL,
        costo_base           DECIMAL(12,2) NULL,
        stock_actual         INT NOT NULL 
            CONSTRAINT DF_Productos_StockActual DEFAULT 0,
        stock_minimo         INT NOT NULL 
            CONSTRAINT DF_Productos_StockMinimo DEFAULT 5,
        impuesto_porcentaje  DECIMAL(5,2) NOT NULL 
            CONSTRAINT DF_Productos_Impuesto DEFAULT 0.00,
        veces_vendido        INT NOT NULL 
            CONSTRAINT DF_Productos_VecesVendido DEFAULT 0,
        estado               VARCHAR(20) NOT NULL
            CONSTRAINT DF_Productos_Estado DEFAULT 'Activo'
            CONSTRAINT CHK_Productos_Estado CHECK (estado IN ('Activo', 'Inactivo')),
        fecha_creacion       DATETIME NOT NULL 
            CONSTRAINT DF_Productos_FechaCreacion DEFAULT GETUTCDATE(),
        fecha_actualizacion  DATETIME NOT NULL 
            CONSTRAINT DF_Productos_FechaActualizacion DEFAULT GETUTCDATE(),
        CONSTRAINT PK_Productos PRIMARY KEY (id_producto),
        CONSTRAINT UQ_Productos_CodigoInterno UNIQUE (codigo_interno),
        CONSTRAINT FK_Productos_Categorias FOREIGN KEY (id_categoria) 
            REFERENCES categorias(id_categoria) ON DELETE SET NULL
    );

    CREATE INDEX IX_Productos_Sku    ON productos(sku);
    CREATE INDEX IX_Productos_Nombre ON productos(nombre);

    PRINT '  ✓ Creada.';
END
ELSE
    PRINT '  Ya existía.';
GO

-- ------------------------------------------------------------
-- 4.6. TABLA: ventas
-- ------------------------------------------------------------
PRINT '→ Tabla ventas...';
IF OBJECT_ID('dbo.ventas', 'U') IS NULL
BEGIN
    CREATE TABLE ventas (
        id_venta           INT IDENTITY(1,1) NOT NULL,
        codigo_factura     VARCHAR(50) NULL,
        fecha_venta        DATETIME NOT NULL 
            CONSTRAINT DF_Ventas_FechaVenta DEFAULT GETUTCDATE(),
        id_usuario         INT NOT NULL,
        id_cliente         INT NULL,
        subtotal           DECIMAL(12,2) NOT NULL,
        impuestos_total    DECIMAL(12,2) NOT NULL 
            CONSTRAINT DF_Ventas_Impuestos DEFAULT 0,
        descuento_total    DECIMAL(12,2) NOT NULL 
            CONSTRAINT DF_Ventas_Descuento DEFAULT 0,
        total_final        DECIMAL(12,2) NOT NULL,
        metodo_pago        VARCHAR(20) NOT NULL
            CONSTRAINT DF_Ventas_MetodoPago DEFAULT 'Efectivo'
            CONSTRAINT CHK_Ventas_MetodoPago CHECK (metodo_pago IN 
                ('Efectivo', 'Tarjeta', 'Transferencia', 'Mixto')),
        estado             VARCHAR(20) NOT NULL
            CONSTRAINT DF_Ventas_Estado DEFAULT 'Completada'
            CONSTRAINT CHK_Ventas_Estado CHECK (estado IN ('Completada', 'Anulada')),
        nota               NVARCHAR(MAX) NULL,
        CONSTRAINT PK_Ventas PRIMARY KEY (id_venta),
        CONSTRAINT UQ_Ventas_CodigoFactura UNIQUE (codigo_factura),
        CONSTRAINT FK_Ventas_Usuarios FOREIGN KEY (id_usuario) 
            REFERENCES usuarios(id_usuario),
        CONSTRAINT FK_Ventas_Clientes FOREIGN KEY (id_cliente) 
            REFERENCES clientes(id_cliente)
    );
    PRINT '  ✓ Creada.';
END
ELSE
    PRINT '  Ya existía.';
GO

-- ------------------------------------------------------------
-- 4.7. TABLA: detalle_venta
-- ------------------------------------------------------------
PRINT '→ Tabla detalle_venta...';
IF OBJECT_ID('dbo.detalle_venta', 'U') IS NULL
BEGIN
    CREATE TABLE detalle_venta (
        id_detalle                    INT IDENTITY(1,1) NOT NULL,
        id_venta                      INT NOT NULL,
        id_producto                   INT NOT NULL,
        cantidad                      INT NOT NULL,
        precio_unitario_historico     DECIMAL(12,2) NOT NULL,
        impuesto_unitario_historico   DECIMAL(12,2) NOT NULL 
            CONSTRAINT DF_Detalle_Impuesto DEFAULT 0,
        subtotal_linea                DECIMAL(12,2) NOT NULL,
        CONSTRAINT PK_DetalleVenta PRIMARY KEY (id_detalle),
        CONSTRAINT FK_DetalleVenta_Ventas FOREIGN KEY (id_venta) 
            REFERENCES ventas(id_venta) ON DELETE CASCADE,
        CONSTRAINT FK_DetalleVenta_Productos FOREIGN KEY (id_producto) 
            REFERENCES productos(id_producto)
    );
    PRINT '  ✓ Creada.';
END
ELSE
    PRINT '  Ya existía.';
GO

-- ------------------------------------------------------------
-- 4.8. TABLA: movimientos_inventario
-- ------------------------------------------------------------
PRINT '→ Tabla movimientos_inventario...';
IF OBJECT_ID('dbo.movimientos_inventario', 'U') IS NULL
BEGIN
    CREATE TABLE movimientos_inventario (
        id_movimiento         INT IDENTITY(1,1) NOT NULL,
        id_producto           INT NOT NULL,
        id_usuario            INT NOT NULL,
        tipo_movimiento       VARCHAR(30) NOT NULL
            CONSTRAINT CHK_Movimientos_Tipo CHECK (tipo_movimiento IN 
                ('Entrada_Compra', 'Salida_Venta', 'Salida_Merma', 
                 'Ajuste_Inventario', 'Devolucion')),
        cantidad              INT NOT NULL,
        stock_anterior        INT NOT NULL,
        stock_nuevo           INT NOT NULL,
        referencia_externa    VARCHAR(100) NULL,
        fecha_movimiento      DATETIME NOT NULL 
            CONSTRAINT DF_Movimientos_Fecha DEFAULT GETUTCDATE(),
        nota                  NVARCHAR(MAX) NULL,
        CONSTRAINT PK_Movimientos PRIMARY KEY (id_movimiento),
        CONSTRAINT FK_Movimientos_Productos FOREIGN KEY (id_producto) 
            REFERENCES productos(id_producto),
        CONSTRAINT FK_Movimientos_Usuarios FOREIGN KEY (id_usuario) 
            REFERENCES usuarios(id_usuario)
    );
    PRINT '  ✓ Creada.';
END
ELSE
    PRINT '  Ya existía.';
GO

-- ------------------------------------------------------------
-- 4.9. TABLA: refresh_tokens
-- ------------------------------------------------------------
PRINT '→ Tabla refresh_tokens...';
IF OBJECT_ID('dbo.refresh_tokens', 'U') IS NULL
BEGIN
    CREATE TABLE refresh_tokens (
        id_refresh_token  INT IDENTITY(1,1) NOT NULL,
        id_usuario        INT NOT NULL,
        token             VARCHAR(500) NOT NULL,
        fecha_expiracion  DATETIME NOT NULL,
        fecha_creacion    DATETIME NOT NULL 
            CONSTRAINT DF_RefreshTokens_FechaCreacion DEFAULT GETUTCDATE(),
        revocado          BIT NOT NULL 
            CONSTRAINT DF_RefreshTokens_Revocado DEFAULT 0,
        fecha_revocado    DATETIME NULL,

        CONSTRAINT PK_RefreshTokens PRIMARY KEY (id_refresh_token),
        CONSTRAINT UQ_RefreshTokens_Token UNIQUE (token),
        CONSTRAINT FK_RefreshTokens_Usuarios 
            FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario) ON DELETE CASCADE
    );

    CREATE INDEX IX_RefreshTokens_Token ON refresh_tokens(token);
    CREATE INDEX IX_RefreshTokens_Usuario ON refresh_tokens(id_usuario, revocado);

    PRINT '  ✓ Creada.';
END
ELSE
    PRINT '  Ya existía.';
GO

-- ============================================================
-- PASO 5: DATOS INICIALES (SEED)
-- ============================================================
PRINT '';
PRINT '→ Insertando datos iniciales...';

-- Roles
IF NOT EXISTS (SELECT 1 FROM roles WHERE nombre_rol = 'Administrador')
BEGIN
    INSERT INTO roles (nombre_rol, descripcion) 
    VALUES ('Administrador', 'Acceso total al sistema');
    PRINT '  ✓ Rol Administrador insertado.';
END

IF NOT EXISTS (SELECT 1 FROM roles WHERE nombre_rol = 'Cajero')
BEGIN
    INSERT INTO roles (nombre_rol, descripcion) 
    VALUES ('Cajero', 'Acceso a ventas y consultas');
    PRINT '  ✓ Rol Cajero insertado.';
END

-- Categorías
IF NOT EXISTS (SELECT 1 FROM categorias WHERE nombre = 'General')
    INSERT INTO categorias (nombre, descripcion) VALUES ('General', 'Productos varios');

IF NOT EXISTS (SELECT 1 FROM categorias WHERE nombre = 'Bebidas')
    INSERT INTO categorias (nombre, descripcion) VALUES ('Bebidas', 'Bebidas y refrescos');

IF NOT EXISTS (SELECT 1 FROM categorias WHERE nombre = 'Abarrotes')
    INSERT INTO categorias (nombre, descripcion) VALUES ('Abarrotes', 'Granos y víveres');

IF NOT EXISTS (SELECT 1 FROM categorias WHERE nombre = 'Aseo')
    INSERT INTO categorias (nombre, descripcion) VALUES ('Aseo', 'Productos de limpieza');

IF NOT EXISTS (SELECT 1 FROM categorias WHERE nombre = 'Lácteos')
    INSERT INTO categorias (nombre, descripcion) VALUES ('Lácteos', 'Lácteos y derivados');

PRINT '  ✓ Categorías base insertadas.';
PRINT '';
PRINT '  NOTA: El usuario admin se debe crear desde POST /api/Auth/register';
GO

-- ============================================================
-- PASO 6: AJUSTE DEL CONSTRAINT UNIQUE DE SKU
--         (permite múltiples NULL, mantiene unicidad cuando hay valor)
-- ============================================================
USE MultiVentasPOS;
GO

-- 6.1. Encontrar y eliminar el constraint UNIQUE de sku si existe
DECLARE @constraintName NVARCHAR(200);

SELECT @constraintName = i.name
FROM sys.indexes i
INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
WHERE i.object_id = OBJECT_ID('productos')
  AND i.is_unique = 1
  AND i.has_filter = 0
  AND c.name = 'sku';

IF @constraintName IS NULL
BEGIN
    PRINT 'No se encontró constraint UNIQUE en sku. Nada que hacer.';
END
ELSE
BEGIN
    PRINT 'Constraint encontrado: ' + @constraintName;

    EXEC('ALTER TABLE productos DROP CONSTRAINT ' + @constraintName);
    PRINT '  ✓ Constraint eliminado.';
END
GO

-- 6.2. Crear filtered unique index
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes 
    WHERE name = 'UQ_Productos_Sku_Filtered' 
      AND object_id = OBJECT_ID('productos')
)
BEGIN
    CREATE UNIQUE INDEX UQ_Productos_Sku_Filtered 
    ON productos(sku)
    WHERE sku IS NOT NULL;

    PRINT '  ✓ Índice filtrado UQ_Productos_Sku_Filtered creado.';
END
ELSE
    PRINT 'El índice filtrado ya existe.';
GO

-- 6.3. Verificar índices únicos en productos
SELECT 
    i.name AS IndexName,
    i.is_unique AS EsUnico,
    i.has_filter AS TieneFiltro,
    i.filter_definition AS Filtro,
    c.name AS Columna
FROM sys.indexes i
INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
WHERE i.object_id = OBJECT_ID('productos')
  AND i.is_unique = 1;
GO

-- ============================================================
-- PASO 7: VERIFICACIÓN FINAL
-- ============================================================
PRINT '';
PRINT '====================================================';
PRINT 'VERIFICACIÓN FINAL';
PRINT '====================================================';

SELECT 
    t.name AS Tabla,
    p.rows AS Filas
FROM sys.tables t
INNER JOIN sys.partitions p 
    ON t.object_id = p.object_id AND p.index_id IN (0,1)
WHERE t.name IN ('roles','usuarios','clientes','categorias',
                 'productos','ventas','detalle_venta','movimientos_inventario',
                 'refresh_tokens')
ORDER BY t.name;
GO

PRINT '';
PRINT '✓ Script completado exitosamente.';
PRINT '  Todas las tablas y datos seed fueron creados/verificados.';
PRINT '====================================================';
GO
USE MultiVentasPOS;
GO

-- Migrar el default de fecha_creacion de refresh_tokens a UTC
DECLARE @cn NVARCHAR(200);
SELECT @cn = dc.name
FROM sys.default_constraints dc
INNER JOIN sys.tables t ON dc.parent_object_id = t.object_id
INNER JOIN sys.columns c ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
WHERE t.name = 'refresh_tokens' AND c.name = 'fecha_creacion';

IF @cn IS NOT NULL
BEGIN
    EXEC('ALTER TABLE refresh_tokens DROP CONSTRAINT ' + @cn);
    ALTER TABLE refresh_tokens 
        ADD CONSTRAINT DF_RefreshTokens_FechaCreacion DEFAULT GETUTCDATE() FOR fecha_creacion;
    PRINT '✓ Default de refresh_tokens.fecha_creacion migrado a GETUTCDATE()';
END
GO


CREATE INDEX IX_Productos_Catalogo 
ON Productos (Estado, Veces_Vendido DESC, Nombre ASC) 
INCLUDE (Id_Categoria, Codigo_Interno, Sku, Precio_Venta, Stock_Actual);
Go