-- =====================================================
-- SCRIPT DE CONFIGURACIÓN DE BASE DE DATOS
-- CAFETERÍA LAS DELICIAS DEL NORTE
-- Sistema de Ventas y Control de Gastos
-- Zona Horaria: America/Bogota
-- Horario: 6:00 AM - 12:00 PM
-- =====================================================

-- Configurar zona horaria para Colombia
SET timezone = 'America/Bogota';

-- Eliminar tablas si existen (para reiniciar limpio)
DROP TABLE IF EXISTS gastos CASCADE;
DROP TABLE IF EXISTS ventas CASCADE;
DROP TABLE IF EXISTS productos CASCADE;

-- Eliminar funciones si existen
DROP FUNCTION IF EXISTS actualizar_fecha_modificacion() CASCADE;
DROP FUNCTION IF EXISTS validar_total_venta() CASCADE;
DROP FUNCTION IF EXISTS validar_horario_operacion() CASCADE;

-- Eliminar vistas si existen
DROP VIEW IF EXISTS reporte_diario CASCADE;
DROP VIEW IF EXISTS estadisticas_diarias CASCADE;
DROP VIEW IF EXISTS productos_mas_vendidos CASCADE;
DROP VIEW IF EXISTS resumen_horarios CASCADE;

-- =====================================================
-- CREAR TABLAS PRINCIPALES
-- =====================================================

-- Tabla de productos de cafetería
CREATE TABLE productos (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    precio DECIMAL(10,2) NOT NULL CHECK (precio >= 1000), -- Mínimo $1,000 COP
    categoria VARCHAR(50) DEFAULT 'General',
    activo BOOLEAN DEFAULT true,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT precio_maximo CHECK (precio <= 50000) -- Máximo $50,000 COP
);

-- Tabla de gastos de la cafetería
CREATE TABLE gastos (
    id SERIAL PRIMARY KEY,
    concepto VARCHAR(200) NOT NULL,
    monto DECIMAL(10,2) NOT NULL CHECK (monto >= 0),
    descripcion TEXT,
    categoria VARCHAR(50) DEFAULT 'General',
    fecha_gasto DATE NOT NULL DEFAULT CURRENT_DATE,
    hora_gasto TIME NOT NULL DEFAULT CURRENT_TIME,
    activo BOOLEAN DEFAULT true,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    usuario_registro VARCHAR(100) DEFAULT 'Sistema',
    
    CONSTRAINT monto_maximo CHECK (monto <= 1000000) -- Máximo $1,000,000 COP
);

-- Tabla de ventas
CREATE TABLE ventas (
    id SERIAL PRIMARY KEY,
    producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
    cantidad INTEGER NOT NULL DEFAULT 1 CHECK (cantidad > 0 AND cantidad <= 100),
    precio_unitario DECIMAL(10,2) NOT NULL CHECK (precio_unitario >= 0),
    total DECIMAL(10,2) NOT NULL CHECK (total >= 0),
    fecha_venta DATE NOT NULL DEFAULT CURRENT_DATE,
    hora_venta TIME NOT NULL DEFAULT CURRENT_TIME,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    usuario_registro VARCHAR(100) DEFAULT 'Sistema',
    notas TEXT
);

-- =====================================================
-- CREAR ÍNDICES PARA OPTIMIZACIÓN
-- =====================================================

-- Índices para ventas
CREATE INDEX idx_ventas_fecha ON ventas(fecha_venta);
CREATE INDEX idx_ventas_producto ON ventas(producto_id);
CREATE INDEX idx_ventas_fecha_producto ON ventas(fecha_venta, producto_id);
CREATE INDEX idx_ventas_hora ON ventas(hora_venta);
CREATE INDEX idx_ventas_total ON ventas(total);

-- Índices para productos
CREATE INDEX idx_productos_activo ON productos(activo);
CREATE INDEX idx_productos_nombre ON productos(nombre);
CREATE INDEX idx_productos_categoria ON productos(categoria);
CREATE INDEX idx_productos_precio ON productos(precio);

-- Índices para gastos
CREATE INDEX idx_gastos_fecha ON gastos(fecha_gasto);
CREATE INDEX idx_gastos_activo ON gastos(activo);
CREATE INDEX idx_gastos_categoria ON gastos(categoria);
CREATE INDEX idx_gastos_monto ON gastos(monto);
CREATE INDEX idx_gastos_concepto ON gastos(concepto);

-- =====================================================
-- CREAR TRIGGERS Y FUNCIONES ESPECIALIZADAS
-- =====================================================

-- Función para actualizar fecha de modificación
CREATE OR REPLACE FUNCTION actualizar_fecha_modificacion()
RETURNS TRIGGER AS $$
BEGIN
    NEW.fecha_actualizacion = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger para actualizar fecha_actualizacion en productos
CREATE TRIGGER trigger_actualizar_productos
    BEFORE UPDATE ON productos
    FOR EACH ROW
    EXECUTE FUNCTION actualizar_fecha_modificacion();

-- Función para validar y calcular total de venta
CREATE OR REPLACE FUNCTION validar_total_venta()
RETURNS TRIGGER AS $$
BEGIN
    -- Calcular el total correcto (redondeado)
    NEW.total = ROUND(NEW.cantidad * NEW.precio_unitario);
    
    -- Validar que no sea una venta excesiva
    IF NEW.total > 500000 THEN
        RAISE EXCEPTION 'El total de la venta ($%) supera el límite máximo ($500,000)', NEW.total;
    END IF;
    
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger para validar total en ventas
CREATE TRIGGER trigger_validar_total
    BEFORE INSERT OR UPDATE ON ventas
    FOR EACH ROW
    EXECUTE FUNCTION validar_total_venta();

-- Función para validar horario de operación (6 AM - 12 PM Colombia)
CREATE OR REPLACE FUNCTION validar_horario_operacion()
RETURNS TRIGGER AS $$
DECLARE
    hora_actual INTEGER;
BEGIN
    -- Obtener hora actual en Colombia
    hora_actual := EXTRACT(HOUR FROM (NOW() AT TIME ZONE 'America/Bogota'));
    
    -- Registrar en log que se intenta una operación fuera de horario
    IF hora_actual < 6 OR hora_actual >= 12 THEN
        RAISE NOTICE 'ATENCIÓN: Operación registrada fuera del horario de la cafetería (6AM-12PM). Hora actual: %', 
            TO_CHAR(NOW() AT TIME ZONE 'America/Bogota', 'HH24:MI');
    END IF;
    
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Aplicar validación de horario a ventas (opcional, solo log)
CREATE TRIGGER trigger_horario_ventas
    BEFORE INSERT ON ventas
    FOR EACH ROW
    EXECUTE FUNCTION validar_horario_operacion();

-- =====================================================
-- CREAR VISTAS ESPECIALIZADAS PARA CAFETERÍA
-- =====================================================

-- Vista para reportes diarios completos
CREATE OR REPLACE VIEW reporte_diario AS
SELECT 
    v.fecha_venta,
    p.id as producto_id,
    p.nombre as producto,
    p.categoria,
    p.precio as precio_actual_producto,
    SUM(v.cantidad) as cantidad_vendida,
    SUM(v.total) as total_ventas,
    COUNT(v.id) as numero_transacciones,
    AVG(v.precio_unitario) as precio_promedio,
    MIN(v.precio_unitario) as precio_minimo,
    MAX(v.precio_unitario) as precio_maximo,
    MIN(v.hora_venta) as primera_venta,
    MAX(v.hora_venta) as ultima_venta
FROM ventas v
JOIN productos p ON v.producto_id = p.id
GROUP BY v.fecha_venta, p.id, p.nombre, p.categoria, p.precio
ORDER BY v.fecha_venta DESC, total_ventas DESC;

-- Vista para estadísticas diarias (incluye gastos y ganancias)
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
    COALESCE(venta_maxima, 0) as venta_maxima,
    COALESCE(primera_venta, '06:00:00') as primera_venta_hora,
    COALESCE(ultima_venta, '06:00:00') as ultima_venta_hora,
    CASE 
        WHEN COALESCE(ingresos_ventas, 0) - COALESCE(total_gastos, 0) > 0 THEN 'Ganancia'
        WHEN COALESCE(ingresos_ventas, 0) - COALESCE(total_gastos, 0) = 0 THEN 'Equilibrio'
        ELSE 'Pérdida'
    END as estado_financiero
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
        MAX(total) as venta_maxima,
        MIN(hora_venta) as primera_venta,
        MAX(hora_venta) as ultima_venta
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

-- Vista para productos más vendidos (ranking)
CREATE OR REPLACE VIEW productos_mas_vendidos AS
SELECT 
    p.id,
    p.nombre,
    p.categoria,
    p.precio,
    COALESCE(SUM(v.cantidad), 0) as total_vendido,
    COALESCE(SUM(v.total), 0) as ingresos_generados,
    COALESCE(COUNT(v.id), 0) as transacciones,
    COALESCE(AVG(v.total), 0) as ticket_promedio,
    CASE 
        WHEN COALESCE(SUM(v.cantidad), 0) = 0 THEN 'Sin ventas'
        WHEN COALESCE(SUM(v.cantidad), 0) < 10 THEN 'Bajo'
        WHEN COALESCE(SUM(v.cantidad), 0) < 50 THEN 'Medio'
        ELSE 'Alto'
    END as rendimiento,
    p.activo
FROM productos p
LEFT JOIN ventas v ON p.id = v.producto_id 
    AND v.fecha_venta >= CURRENT_DATE - INTERVAL '30 days'
WHERE p.activo = true
GROUP BY p.id, p.nombre, p.categoria, p.precio, p.activo
ORDER BY total_vendido DESC, ingresos_generados DESC;

-- Vista para análisis de horarios de venta
CREATE OR REPLACE VIEW resumen_horarios AS
SELECT 
    EXTRACT(HOUR FROM hora_venta) as hora,
    TO_CHAR(CAST(EXTRACT(HOUR FROM hora_venta) || ':00' AS TIME), 'HH12:MI AM') as hora_formato,
    COUNT(*) as transacciones,
    SUM(cantidad) as unidades_vendidas,
    SUM(total) as ingresos,
    AVG(total) as ticket_promedio,
    COUNT(DISTINCT producto_id) as productos_diferentes,
    CASE 
        WHEN EXTRACT(HOUR FROM hora_venta) BETWEEN 6 AND 8 THEN 'Mañana Temprano'
        WHEN EXTRACT(HOUR FROM hora_venta) BETWEEN 9 AND 10 THEN 'Media Mañana'
        WHEN EXTRACT(HOUR FROM hora_venta) BETWEEN 11 AND 12 THEN 'Antes de Cierre'
        ELSE 'Fuera de Horario'
    END as periodo
FROM ventas
WHERE fecha_venta >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY EXTRACT(HOUR FROM hora_venta)
ORDER BY hora;

-- =====================================================
-- INSERTAR PRODUCTOS DE CAFETERÍA COLOMBIANA
-- =====================================================

-- Productos de café y bebidas calientes
INSERT INTO productos (nombre, precio, categoria) VALUES 
('Café Americano', 2500, 'Bebidas Calientes'),
('Café con Leche', 3000, 'Bebidas Calientes'),
('Cappuccino', 3500, 'Bebidas Calientes'),
('Latte', 4000, 'Bebidas Calientes'),
('Mocca', 4500, 'Bebidas Calientes'),
('Café Expreso', 2000, 'Bebidas Calientes'),
('Café Cortado', 2800, 'Bebidas Calientes'),
('Café con Crema', 3200, 'Bebidas Calientes'),
('Chocolate Caliente', 3200, 'Bebidas Calientes'),
('Chocolate con Leche', 3500, 'Bebidas Calientes'),
('Café Descafeinado', 2800, 'Bebidas Calientes'),
('Café Irlandés', 5000, 'Bebidas Calientes');

-- Bebidas frías
INSERT INTO productos (nombre, precio, categoria) VALUES 
('Jugo Natural de Naranja', 3500, 'Bebidas Frías'),
('Jugo Natural de Lulo', 4000, 'Bebidas Frías'),
('Jugo Natural de Maracuyá', 4000, 'Bebidas Frías'),
('Jugo de Mango', 3800, 'Bebidas Frías'),
('Limonada Natural', 3000, 'Bebidas Frías'),
('Limonada de Coco', 4200, 'Bebidas Frías'),
('Agua Botella 500ml', 1500, 'Bebidas Frías'),
('Gaseosa Coca Cola', 2500, 'Bebidas Frías'),
('Gaseosa Pepsi', 2500, 'Bebidas Frías'),
('Gaseosa Sprite', 2500, 'Bebidas Frías'),
('Té Helado', 3200, 'Bebidas Frías');

-- Tés e infusiones
INSERT INTO productos (nombre, precio, categoria) VALUES 
('Té Verde', 2800, 'Tés e Infusiones'),
('Té Negro', 2800, 'Tés e Infusiones'),
('Té de Manzanilla', 2800, 'Tés e Infusiones'),
('Té de Hierbas', 3000, 'Tés e Infusiones'),
('Aromática de Canela', 2500, 'Tés e Infusiones'),
('Aromática de Menta', 2500, 'Tés e Infusiones');

-- Panadería y pastelería
INSERT INTO productos (nombre, precio, categoria) VALUES 
('Croissant Simple', 3000, 'Panadería'),
('Croissant con Jamón y Queso', 5000, 'Panadería'),
('Croissant de Chocolate', 4000, 'Panadería'),
('Pan Tostado', 2000, 'Panadería'),
('Pan con Mantequilla', 2500, 'Panadería'),
('Pan con Mermelada', 3000, 'Panadería'),
('Tostadas Francesas', 4500, 'Panadería'),
('Bagel Simple', 3500, 'Panadería'),
('Bagel con Queso Crema', 4500, 'Panadería');

-- Platos principales
INSERT INTO productos (nombre, precio, categoria) VALUES 
('Empanada de Pollo', 3500, 'Comidas'),
('Empanada de Carne', 3500, 'Comidas'),
('Empanada de Queso', 3000, 'Comidas'),
('Sandwich de Pollo', 6000, 'Comidas'),
('Sandwich de Jamón y Queso', 5500, 'Comidas'),
('Sandwich Vegetariano', 5000, 'Comidas'),
('Quesadilla', 4500, 'Comidas'),
('Wrap de Pollo', 6500, 'Comidas'),
('Ensalada César', 7000, 'Comidas'),
('Sopa del Día', 5500, 'Comidas');

-- Postres y dulces
INSERT INTO productos (nombre, precio, categoria) VALUES 
('Torta de Chocolate', 4000, 'Postres'),
('Torta de Zanahoria', 3500, 'Postres'),
('Cheesecake', 4500, 'Postres'),
('Tres Leches', 4200, 'Postres'),
('Tiramisu', 5000, 'Postres'),
('Brownie', 3500, 'Postres'),
('Galletas Artesanales', 1500, 'Postres'),
('Muffin de Arándanos', 3000, 'Postres'),
('Muffin de Chocolate', 3000, 'Postres'),
('Donas Glaseadas', 2800, 'Postres'),
('Alfajor', 2200, 'Postres'),
('Ponqué de Vainilla', 3000, 'Postres');

-- =====================================================
-- INSERTAR GASTOS TÍPICOS DE CAFETERÍA
-- =====================================================

INSERT INTO gastos (concepto, monto, descripcion, categoria) VALUES 
('Compra de café en grano', 45000, 'Café colombiano premium - 1kg', 'Ingredientes'),
('Ingredientes de panadería', 32000, 'Harina, azúcar, mantequilla para producción diaria', 'Ingredientes'),
('Compra de leche', 18000, 'Leche fresca para bebidas - 5 litros', 'Ingredientes'),
('Azúcar y endulzantes', 12000, 'Azúcar blanca y edulcorantes artificiales', 'Ingredientes'),
('Frutas para jugos', 25000, 'Naranja, lulo, maracuyá frescos', 'Ingredientes'),

('Servicios públicos', 85000, 'Luz del local - mes actual', 'Servicios'),
('Internet y telefonía', 35000, 'Plan de internet para el sistema de ventas', 'Servicios'),
('Agua potable', 20000, 'Servicio de acueducto mensual', 'Servicios'),

('Productos de aseo', 15000, 'Detergente y productos de limpieza', 'Limpieza'),
('Papel higiénico y servilletas', 8000, 'Insumos para baños y mesas', 'Limpieza'),

('Transporte', 10000, 'Gasolina para entregas a domicilio', 'Operación'),
('Mantenimiento equipo', 25000, 'Revisión de máquina de café', 'Mantenimiento'),
('Capacitación personal', 40000, 'Curso de barismo para empleados', 'Personal');

-- =====================================================
-- INSERTAR ALGUNAS VENTAS DE EJEMPLO
-- =====================================================

-- Ventas de ejemplo para hoy (diferentes horarios)
INSERT INTO ventas (producto_id, cantidad, precio_unitario, hora_venta, notas) VALUES 
-- Ventas de la mañana temprano (6-8 AM)
(1, 2, 2500, '06:15:00', 'Primer cliente del día'), -- Café Americano
(2, 1, 3000, '06:30:00', 'Para llevar'), -- Café con Leche
(25, 1, 3000, '06:45:00', 'Con mermelada'), -- Pan con Mantequilla
(1, 3, 2500, '07:00:00', 'Oficinistas'), -- Café Americano
(21, 2, 3000, '07:15:00', 'Desayuno completo'), -- Croissant Simple

-- Ventas de media mañana (8-10 AM)
(3, 2, 3500, '08:30:00', 'Cappuccino doble'), -- Cappuccino
(32, 1, 3500, '08:45:00', 'Cliente regular'), -- Empanada de Pollo
(13, 1, 3500, '09:00:00', 'Jugo recién hecho'), -- Jugo de Naranja
(4, 1, 4000, '09:30:00', 'Con arte latte'), -- Latte
(41, 1, 4000, '09:45:00', 'Postre especial'), -- Torta de Chocolate

-- Ventas antes del cierre (10-12 PM)
(22, 1, 5000, '10:15:00', 'Combo desayuno'), -- Croissant con Jamón y Queso
(5, 1, 4500, '10:30:00', 'Mocca con crema'), -- Mocca
(36, 1, 6000, '11:00:00', 'Almuerzo temprano'), -- Sandwich de Pollo
(15, 2, 4000, '11:30:00', 'Jugos para llevar'), -- Jugo de Maracuyá
(43, 1, 4500, '11:45:00', 'Último postre del día'); -- Cheesecake

-- =====================================================
-- VERIFICACIÓN Y ESTADÍSTICAS INICIALES
-- =====================================================

-- Mostrar resumen de las tablas creadas
SELECT 
    'productos' as tabla,
    COUNT(*) as registros,
    'Productos de cafetería disponibles' as descripcion
FROM productos
WHERE activo = true
UNION ALL
SELECT 
    'gastos' as tabla,
    COUNT(*) as registros,
    'Gastos típicos registrados' as descripcion
FROM gastos
WHERE activo = true
UNION ALL
SELECT 
    'ventas' as tabla,
    COUNT(*) as registros,
    'Ventas de ejemplo del día' as descripcion
FROM ventas
WHERE fecha_venta = CURRENT_DATE
ORDER BY tabla;

-- Mostrar productos por categoría
SELECT 
    categoria,
    COUNT(*) as productos,
    MIN(precio) as precio_minimo,
    MAX(precio) as precio_maximo,
    AVG(precio) as precio_promedio
FROM productos
WHERE activo = true
GROUP BY categoria
ORDER BY categoria;

-- Mostrar estadísticas del día actual
SELECT 
    fecha,
    ingresos_ventas,
    total_gastos,
    ganancia_neta,
    total_transacciones,
    productos_diferentes,
    estado_financiero,
    primera_venta_hora,
    ultima_venta_hora
FROM estadisticas_diarias 
WHERE fecha = CURRENT_DATE;

-- Mostrar los 10 productos más populares
SELECT 
    nombre,
    categoria,
    precio,
    total_vendido,
    ingresos_generados,
    rendimiento
FROM productos_mas_vendidos
LIMIT 10;

-- Mostrar análisis de horarios (últimos 7 días)
SELECT 
    hora_formato,
    periodo,
    transacciones,
    ingresos,
    ticket_promedio
FROM resumen_horarios
ORDER BY hora;

-- =====================================================
-- MENSAJE DE CONFIRMACIÓN FINAL
-- =====================================================

SELECT 
    '☕ CAFETERÍA LAS DELICIAS DEL NORTE ☕' as mensaje,
    'Base de datos configurada exitosamente' as estado,
    'Horario: 6:00 AM - 12:00 PM' as horario,
    'Zona: America/Bogota' as zona_horaria,
    TO_CHAR(NOW() AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD HH12:MI AM') as fecha_configuracion;

-- Mostrar información del sistema
SELECT 
    version() as postgresql_version,
    current_database() as base_datos,
    current_user as usuario,
    inet_server_addr() as servidor,
    inet_server_port() as puerto;

-- =====================================================
-- COMENTARIOS Y NOTAS IMPORTANTES
-- =====================================================

-- NOTAS PARA EL ADMINISTRADOR:
-- 1. La cafetería opera de 6:00 AM a 12:00 PM (horario Colombia)
-- 2. Los precios están en pesos colombianos (COP)
-- 3. Se incluyen 60+ productos típicos de cafetería colombiana
-- 4. Las vistas automáticas facilitan la generación de reportes
-- 5. Los triggers validan automáticamente datos y horarios
-- 6. Se puede expandir agregando más categorías y productos

-- PRODUCTOS INCLUIDOS:
-- - 12 bebidas calientes (café, chocolate, etc.)
-- - 11 bebidas frías (jugos naturales, gaseosas)
-- - 6 tés e infusiones
-- - 9 productos de panadería
-- - 10 comidas principales
-- - 12 postres y dulces

-- FUNCIONALIDADES ESPECIALES:
-- - Validación automática de totales
-- - Control de horarios de operación
-- - Reportes automáticos por día, producto y horario
-- - Categorización automática de productos
-- - Análisis de rendimiento por producto