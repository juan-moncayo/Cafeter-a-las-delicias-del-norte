-- =====================================================
-- SCRIPT DE CONFIGURACIÓN DE BASE DE DATOS
-- Sistema de Ventas Simple
-- =====================================================

-- Eliminar tablas si existen (para reiniciar limpio)
DROP TABLE IF EXISTS gastos CASCADE;
DROP TABLE IF EXISTS ventas CASCADE;
DROP TABLE IF EXISTS productos CASCADE;

-- Eliminar funciones si existen
DROP FUNCTION IF EXISTS actualizar_fecha_modificacion() CASCADE;

-- Eliminar vistas si existen
DROP VIEW IF EXISTS reporte_diario CASCADE;
DROP VIEW IF EXISTS estadisticas_diarias CASCADE;

-- =====================================================
-- CREAR TABLAS
-- =====================================================

-- Tabla de productos
CREATE TABLE productos (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    precio DECIMAL(10,2) NOT NULL CHECK (precio >= 0),
    activo BOOLEAN DEFAULT true,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de gastos
CREATE TABLE gastos (
    id SERIAL PRIMARY KEY,
    concepto VARCHAR(200) NOT NULL,
    monto DECIMAL(10,2) NOT NULL CHECK (monto >= 0),
    descripcion TEXT,
    fecha_gasto DATE NOT NULL DEFAULT CURRENT_DATE,
    hora_gasto TIME NOT NULL DEFAULT CURRENT_TIME,
    activo BOOLEAN DEFAULT true,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de ventas
CREATE TABLE ventas (
    id SERIAL PRIMARY KEY,
    producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
    cantidad INTEGER NOT NULL DEFAULT 1 CHECK (cantidad > 0),
    precio_unitario DECIMAL(10,2) NOT NULL CHECK (precio_unitario >= 0),
    total DECIMAL(10,2) NOT NULL CHECK (total >= 0),
    fecha_venta DATE NOT NULL DEFAULT CURRENT_DATE,
    hora_venta TIME NOT NULL DEFAULT CURRENT_TIME,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- CREAR ÍNDICES PARA MEJORAR RENDIMIENTO
-- =====================================================

CREATE INDEX idx_ventas_fecha ON ventas(fecha_venta);
CREATE INDEX idx_ventas_producto ON ventas(producto_id);
CREATE INDEX idx_ventas_fecha_producto ON ventas(fecha_venta, producto_id);
CREATE INDEX idx_productos_activo ON productos(activo);
CREATE INDEX idx_productos_nombre ON productos(nombre);
CREATE INDEX idx_gastos_fecha ON gastos(fecha_gasto);
CREATE INDEX idx_gastos_activo ON gastos(activo);

-- =====================================================
-- CREAR TRIGGERS Y FUNCIONES
-- =====================================================

-- Función para actualizar fecha de modificación
CREATE OR REPLACE FUNCTION actualizar_fecha_modificacion()
RETURNS TRIGGER AS $
BEGIN
    NEW.fecha_actualizacion = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$ language 'plpgsql';

-- Trigger para actualizar fecha_actualizacion en productos
CREATE TRIGGER trigger_actualizar_productos
    BEFORE UPDATE ON productos
    FOR EACH ROW
    EXECUTE FUNCTION actualizar_fecha_modificacion();

-- Trigger para validar que el total sea correcto
CREATE OR REPLACE FUNCTION validar_total_venta()
RETURNS TRIGGER AS $
BEGIN
    -- Calcular el total correcto
    NEW.total = NEW.cantidad * NEW.precio_unitario;
    RETURN NEW;
END;
$ language 'plpgsql';

CREATE TRIGGER trigger_validar_total
    BEFORE INSERT OR UPDATE ON ventas
    FOR EACH ROW
    EXECUTE FUNCTION validar_total_venta();

-- =====================================================
-- CREAR VISTAS PARA REPORTES
-- =====================================================

-- Vista para reportes diarios por producto
CREATE OR REPLACE VIEW reporte_diario AS
SELECT 
    v.fecha_venta,
    p.id as producto_id,
    p.nombre as producto,
    p.precio as precio_actual_producto,
    SUM(v.cantidad) as cantidad_vendida,
    SUM(v.total) as total_ventas,
    AVG(v.precio_unitario) as precio_promedio,
    MIN(v.precio_unitario) as precio_minimo,
    MAX(v.precio_unitario) as precio_maximo
FROM ventas v
JOIN productos p ON v.producto_id = p.id
GROUP BY v.fecha_venta, p.id, p.nombre, p.precio
ORDER BY v.fecha_venta DESC, total_ventas DESC;

-- Vista para estadísticas generales diarias (incluye gastos)
CREATE OR REPLACE VIEW estadisticas_diarias AS
SELECT 
    fecha,
    COALESCE(ingresos_ventas, 0) as ingresos_ventas,
    COALESCE(total_gastos, 0) as total_gastos,
    COALESCE(ingresos_ventas, 0) - COALESCE(total_gastos, 0) as ganancia_neta,
    COALESCE(total_transacciones, 0) as total_transacciones,
    COALESCE(productos_diferentes, 0) as productos_diferentes,
    COALESCE(total_unidades, 0) as total_unidades,
    COALESCE(venta_promedio, 0) as venta_promedio,
    COALESCE(venta_minima, 0) as venta_minima,
    COALESCE(venta_maxima, 0) as venta_maxima
FROM (
    SELECT DISTINCT fecha_venta as fecha FROM ventas
    UNION 
    SELECT DISTINCT fecha_gasto as fecha FROM gastos
) fechas
LEFT JOIN (
    SELECT 
        fecha_venta as fecha,
        COUNT(*) as total_transacciones,
        COUNT(DISTINCT producto_id) as productos_diferentes,
        SUM(cantidad) as total_unidades,
        SUM(total) as ingresos_ventas,
        AVG(total) as venta_promedio,
        MIN(total) as venta_minima,
        MAX(total) as venta_maxima
    FROM ventas
    GROUP BY fecha_venta
) ventas_stats ON fechas.fecha = ventas_stats.fecha
LEFT JOIN (
    SELECT 
        fecha_gasto as fecha,
        SUM(monto) as total_gastos
    FROM gastos
    WHERE activo = true
    GROUP BY fecha_gasto
) gastos_stats ON fechas.fecha = gastos_stats.fecha
ORDER BY fecha DESC;

-- =====================================================
-- INSERTAR DATOS DE EJEMPLO
-- =====================================================

-- Insertar productos de ejemplo
INSERT INTO productos (nombre, precio) VALUES 
('Merengón', 3500.00),
('Yogurt Natural', 2800.00),
('Agua Botella 500ml', 1500.00),
('Gaseosa Coca Cola', 2200.00),
('Chocolate Jet', 1800.00);

-- Insertar gastos de ejemplo
INSERT INTO gastos (concepto, monto, descripcion) VALUES 
('Compra ingredientes', 15000.00, 'Compra de leche y azúcar'),
('Transporte', 5000.00, 'Gasolina para entregas'),
('Servicios públicos', 8000.00, 'Luz del local');

-- Insertar algunas ventas de ejemplo para hoy
INSERT INTO ventas (producto_id, cantidad, precio_unitario) VALUES 
(1, 2, 3500.00),  -- 2 Merengones
(2, 1, 2800.00),  -- 1 Yogurt
(3, 3, 1500.00),  -- 3 Aguas
(1, 1, 3500.00),  -- 1 Merengón más
(4, 2, 2200.00);  -- 2 Gaseosas

-- =====================================================
-- VERIFICAR INSTALACIÓN
-- =====================================================

-- Mostrar resumen de las tablas creadas
SELECT 
    'productos' as tabla,
    COUNT(*) as registros
FROM productos
UNION ALL
SELECT 
    'gastos' as tabla,
    COUNT(*) as registros
FROM gastos
UNION ALL
SELECT 
    'ventas' as tabla,
    COUNT(*) as registros
FROM ventas;

-- Mostrar productos creados
SELECT 
    id,
    nombre,
    precio,
    fecha_creacion
FROM productos
ORDER BY id;

-- Mostrar gastos creados
SELECT 
    id,
    concepto,
    monto,
    fecha_gasto
FROM gastos
ORDER BY id;

-- Mostrar estadísticas del día con ganancias
SELECT * FROM estadisticas_diarias WHERE fecha = CURRENT_DATE;

-- =====================================================
-- MENSAJE DE CONFIRMACIÓN
-- =====================================================

SELECT 'Base de datos configurada correctamente con gestión de gastos!' as mensaje;