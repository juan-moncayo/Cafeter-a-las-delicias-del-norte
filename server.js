const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de la base de datos PostgreSQL
const pool = new Pool({
    connectionString: 'postgresql://postgres:opCoXoxBaIBzyGGzwLPVCfFTitpUJePn@metro.proxy.rlwy.net:31829/railway',
    ssl: {
        rejectUnauthorized: false
    }
});

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Configuración de zona horaria para Colombia
process.env.TZ = 'America/Bogota';

// ==================== FUNCIÓN PARA CREAR TABLAS ====================
async function inicializarBaseDatos() {
    try {
        console.log('☕ Inicializando base de datos - Cafetería las Delicias del Norte...');
        
        // Crear tabla productos si no existe
        await pool.query(`
            CREATE TABLE IF NOT EXISTS productos (
                id SERIAL PRIMARY KEY,
                nombre VARCHAR(100) NOT NULL UNIQUE,
                precio DECIMAL(10,2) NOT NULL CHECK (precio >= 0),
                activo BOOLEAN DEFAULT true,
                fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Crear tabla gastos si no existe
        await pool.query(`
            CREATE TABLE IF NOT EXISTS gastos (
                id SERIAL PRIMARY KEY,
                concepto VARCHAR(200) NOT NULL,
                monto DECIMAL(10,2) NOT NULL CHECK (monto >= 0),
                descripcion TEXT,
                fecha_gasto DATE NOT NULL DEFAULT CURRENT_DATE,
                hora_gasto TIME NOT NULL DEFAULT CURRENT_TIME,
                activo BOOLEAN DEFAULT true,
                fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Crear tabla ventas si no existe
        await pool.query(`
            CREATE TABLE IF NOT EXISTS ventas (
                id SERIAL PRIMARY KEY,
                producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
                cantidad INTEGER NOT NULL DEFAULT 1 CHECK (cantidad > 0),
                precio_unitario DECIMAL(10,2) NOT NULL CHECK (precio_unitario >= 0),
                total DECIMAL(10,2) NOT NULL CHECK (total >= 0),
                fecha_venta DATE NOT NULL DEFAULT CURRENT_DATE,
                hora_venta TIME NOT NULL DEFAULT CURRENT_TIME,
                fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Crear índices si no existen
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_ventas_fecha ON ventas(fecha_venta);
            CREATE INDEX IF NOT EXISTS idx_ventas_producto ON ventas(producto_id);
            CREATE INDEX IF NOT EXISTS idx_productos_activo ON productos(activo);
            CREATE INDEX IF NOT EXISTS idx_gastos_fecha ON gastos(fecha_gasto);
            CREATE INDEX IF NOT EXISTS idx_gastos_activo ON gastos(activo);
        `);

        // Verificar si hay productos de cafetería, si no, crearlos
        const productosExistentes = await pool.query('SELECT COUNT(*) FROM productos');
        if (parseInt(productosExistentes.rows[0].count) === 0) {
            console.log('☕ Creando productos de cafetería...');
            await pool.query(`
                INSERT INTO productos (nombre, precio) VALUES 
                ('Café Americano', 2500),
                ('Café con Leche', 3000),
                ('Cappuccino', 3500),
                ('Latte', 4000),
                ('Mocca', 4500),
                ('Café Expreso', 2000),
                ('Café Cortado', 2800),
                ('Croissant Simple', 3000),
                ('Croissant con Jamón y Queso', 5000),
                ('Pan Tostado', 2000),
                ('Pan con Mantequilla', 2500),
                ('Empanada de Pollo', 3500),
                ('Empanada de Carne', 3500),
                ('Sandwich de Pollo', 6000),
                ('Sandwich de Jamón y Queso', 5500),
                ('Torta de Chocolate', 4000),
                ('Torta de Zanahoria', 3500),
                ('Cheesecake', 4500),
                ('Galletas Artesanales', 1500),
                ('Muffin de Arándanos', 3000),
                ('Brownie', 3500),
                ('Agua Botella', 1500),
                ('Jugo Natural de Naranja', 3500),
                ('Jugo Natural de Lulo', 4000),
                ('Jugo Natural de Maracuyá', 4000),
                ('Gaseosa Coca Cola', 2500),
                ('Gaseosa Pepsi', 2500),
                ('Té Verde', 2800),
                ('Té de Manzanilla', 2800),
                ('Chocolate Caliente', 3200)
            `);
            
            // Insertar gastos de ejemplo típicos de cafetería
            await pool.query(`
                INSERT INTO gastos (concepto, monto, descripcion) VALUES 
                ('Compra de café en grano', 45000, 'Café colombiano premium 1kg'),
                ('Ingredientes de panadería', 32000, 'Harina, azúcar, mantequilla'),
                ('Servicios públicos', 85000, 'Luz del local - mes actual'),
                ('Compra de leche', 18000, 'Leche fresca para bebidas'),
                ('Productos de aseo', 15000, 'Detergente y productos de limpieza')
            `);
            
            console.log('✅ Productos y gastos de cafetería creados');
        }

        console.log('✅ Base de datos de cafetería inicializada correctamente');
        return true;
    } catch (error) {
        console.error('❌ Error inicializando base de datos:', error);
        return false;
    }
}

// Ruta principal - servir el HTML
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== RUTAS PARA PRODUCTOS ====================

// Obtener todos los productos activos
app.get('/api/productos', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM productos WHERE activo = true ORDER BY nombre'
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener productos:', error);
        res.status(500).json({ error: 'Error al obtener productos de la cafetería' });
    }
});

// Crear nuevo producto
app.post('/api/productos', async (req, res) => {
    const { nombre, precio } = req.body;
    
    if (!nombre || !precio) {
        return res.status(400).json({ error: 'Nombre y precio son requeridos' });
    }

    // Validar precio mínimo para cafetería (1000 COP)
    if (precio < 1000) {
        return res.status(400).json({ error: 'El precio mínimo debe ser $1,000 COP' });
    }

    try {
        const result = await pool.query(
            'INSERT INTO productos (nombre, precio) VALUES ($1, $2) RETURNING *',
            [nombre.trim(), Math.round(parseFloat(precio))] // Redondear precio
        );
        
        console.log(`✅ Nuevo producto creado: ${nombre} - $${precio}`);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        if (error.code === '23505') { // Violación de unicidad
            res.status(400).json({ error: 'Ya existe un producto con ese nombre' });
        } else {
            console.error('Error al crear producto:', error);
            res.status(500).json({ error: 'Error al crear producto' });
        }
    }
});

// Actualizar producto
app.put('/api/productos/:id', async (req, res) => {
    const { id } = req.params;
    const { nombre, precio } = req.body;
    
    if (!nombre || !precio) {
        return res.status(400).json({ error: 'Nombre y precio son requeridos' });
    }

    if (precio < 1000) {
        return res.status(400).json({ error: 'El precio mínimo debe ser $1,000 COP' });
    }

    try {
        const result = await pool.query(
            'UPDATE productos SET nombre = $1, precio = $2, fecha_actualizacion = CURRENT_TIMESTAMP WHERE id = $3 AND activo = true RETURNING *',
            [nombre.trim(), Math.round(parseFloat(precio)), id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }
        
        console.log(`✅ Producto actualizado: ${nombre} - $${precio}`);
        res.json(result.rows[0]);
    } catch (error) {
        if (error.code === '23505') {
            res.status(400).json({ error: 'Ya existe un producto con ese nombre' });
        } else {
            console.error('Error al actualizar producto:', error);
            res.status(500).json({ error: 'Error al actualizar producto' });
        }
    }
});

// Eliminar producto (soft delete)
app.delete('/api/productos/:id', async (req, res) => {
    const { id } = req.params;

    try {
        // Verificar si el producto tiene ventas
        const ventasResult = await pool.query(
            'SELECT COUNT(*) FROM ventas WHERE producto_id = $1',
            [id]
        );
        
        const tieneVentas = parseInt(ventasResult.rows[0].count) > 0;
        
        if (tieneVentas) {
            // Si tiene ventas, hacer soft delete
            const result = await pool.query(
                'UPDATE productos SET activo = false WHERE id = $1 AND activo = true RETURNING *',
                [id]
            );
            
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Producto no encontrado' });
            }
            
            console.log(`⚠️ Producto desactivado (tiene ventas): ${result.rows[0].nombre}`);
            res.json({ 
                message: 'Producto desactivado (tiene ventas asociadas)', 
                producto: result.rows[0] 
            });
        } else {
            // Si no tiene ventas, eliminar completamente
            const result = await pool.query(
                'DELETE FROM productos WHERE id = $1 RETURNING *',
                [id]
            );
            
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Producto no encontrado' });
            }
            
            console.log(`🗑️ Producto eliminado: ${result.rows[0].nombre}`);
            res.json({ 
                message: 'Producto eliminado completamente', 
                producto: result.rows[0] 
            });
        }
    } catch (error) {
        console.error('Error al eliminar producto:', error);
        res.status(500).json({ error: 'Error al eliminar producto' });
    }
});

// ==================== RUTAS PARA VENTAS ====================

// Obtener ventas del día actual (con zona horaria de Colombia)
app.get('/api/ventas', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT v.*, p.nombre as producto_nombre 
            FROM ventas v 
            JOIN productos p ON v.producto_id = p.id 
            WHERE v.fecha_venta = CURRENT_DATE 
            ORDER BY v.fecha_creacion DESC
        `);
        
        console.log(`📊 Consultadas ${result.rows.length} ventas del día`);
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener ventas:', error);
        res.status(500).json({ error: 'Error al obtener ventas del día' });
    }
});

// Crear nueva venta
app.post('/api/ventas', async (req, res) => {
    const { producto_id, cantidad = 1 } = req.body;
    
    if (!producto_id) {
        return res.status(400).json({ error: 'ID del producto es requerido' });
    }

    if (cantidad <= 0 || cantidad > 100) {
        return res.status(400).json({ error: 'La cantidad debe estar entre 1 y 100' });
    }

    try {
        // Obtener el precio actual del producto
        const productoResult = await pool.query(
            'SELECT precio, nombre FROM productos WHERE id = $1 AND activo = true',
            [producto_id]
        );
        
        if (productoResult.rows.length === 0) {
            return res.status(404).json({ error: 'Producto no encontrado o inactivo' });
        }
        
        const { precio, nombre } = productoResult.rows[0];
        const total = Math.round(precio * cantidad); // Redondear total
        
        const result = await pool.query(`
            INSERT INTO ventas (producto_id, cantidad, precio_unitario, total) 
            VALUES ($1, $2, $3, $4) 
            RETURNING *
        `, [producto_id, cantidad, precio, total]);
        
        console.log(`💰 Venta registrada: ${cantidad}x ${nombre} = $${total}`);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error al crear venta:', error);
        res.status(500).json({ error: 'Error al registrar venta' });
    }
});

// Eliminar venta
app.delete('/api/ventas/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query(
            'DELETE FROM ventas WHERE id = $1 RETURNING *, (SELECT nombre FROM productos WHERE id = producto_id) as producto_nombre',
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Venta no encontrada' });
        }
        
        const venta = result.rows[0];
        console.log(`🗑️ Venta eliminada: ${venta.producto_nombre} - $${venta.total}`);
        res.json({ message: 'Venta eliminada correctamente', venta: venta });
    } catch (error) {
        console.error('Error al eliminar venta:', error);
        res.status(500).json({ error: 'Error al eliminar venta' });
    }
});

// ==================== RUTAS PARA GASTOS ====================

// Obtener gastos del día actual
app.get('/api/gastos', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM gastos 
            WHERE fecha_gasto = CURRENT_DATE AND activo = true
            ORDER BY fecha_creacion DESC
        `);
        
        console.log(`💸 Consultados ${result.rows.length} gastos del día`);
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener gastos:', error);
        res.status(500).json({ error: 'Error al obtener gastos del día' });
    }
});

// Crear nuevo gasto
app.post('/api/gastos', async (req, res) => {
    const { concepto, monto, descripcion = '' } = req.body;
    
    if (!concepto || !monto) {
        return res.status(400).json({ error: 'Concepto y monto son requeridos' });
    }

    if (monto < 0 || monto > 1000000) {
        return res.status(400).json({ error: 'El monto debe estar entre $0 y $1,000,000 COP' });
    }

    try {
        const result = await pool.query(`
            INSERT INTO gastos (concepto, monto, descripcion) 
            VALUES ($1, $2, $3) 
            RETURNING *
        `, [concepto.trim(), Math.round(parseFloat(monto)), descripcion.trim()]);
        
        console.log(`💸 Gasto registrado: ${concepto} - $${monto}`);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error al crear gasto:', error);
        res.status(500).json({ error: 'Error al registrar gasto' });
    }
});

// Actualizar gasto
app.put('/api/gastos/:id', async (req, res) => {
    const { id } = req.params;
    const { concepto, monto, descripcion = '' } = req.body;
    
    if (!concepto || !monto) {
        return res.status(400).json({ error: 'Concepto y monto son requeridos' });
    }

    if (monto < 0 || monto > 1000000) {
        return res.status(400).json({ error: 'El monto debe estar entre $0 y $1,000,000 COP' });
    }

    try {
        const result = await pool.query(`
            UPDATE gastos SET concepto = $1, monto = $2, descripcion = $3 
            WHERE id = $4 AND activo = true 
            RETURNING *
        `, [concepto.trim(), Math.round(parseFloat(monto)), descripcion.trim(), id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Gasto no encontrado' });
        }
        
        console.log(`✅ Gasto actualizado: ${concepto} - $${monto}`);
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error al actualizar gasto:', error);
        res.status(500).json({ error: 'Error al actualizar gasto' });
    }
});

// Eliminar gasto (soft delete)
app.delete('/api/gastos/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query(
            'UPDATE gastos SET activo = false WHERE id = $1 AND activo = true RETURNING *',
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Gasto no encontrado' });
        }
        
        console.log(`🗑️ Gasto eliminado: ${result.rows[0].concepto}`);
        res.json({ message: 'Gasto eliminado correctamente', gasto: result.rows[0] });
    } catch (error) {
        console.error('Error al eliminar gasto:', error);
        res.status(500).json({ error: 'Error al eliminar gasto' });
    }
});

// ==================== RUTAS PARA REPORTES ====================

// Reporte de ventas diarias por producto
app.get('/api/reportes/diario', async (req, res) => {
    const { fecha } = req.query;
    
    try {
        console.log('📊 Generando reporte diario para:', fecha || 'HOY');
        
        const result = await pool.query(`
            SELECT 
                p.nombre as producto,
                p.precio as precio_actual,
                SUM(v.cantidad) as cantidad_vendida,
                COUNT(v.id) as numero_transacciones,
                SUM(v.total) as total_ventas,
                AVG(v.precio_unitario) as precio_promedio
            FROM ventas v
            JOIN productos p ON v.producto_id = p.id
            WHERE v.fecha_venta = ${fecha ? '$1' : 'CURRENT_DATE'}
            GROUP BY p.id, p.nombre, p.precio
            ORDER BY total_ventas DESC
        `, fecha ? [fecha] : []);
        
        console.log(`📈 Reporte generado: ${result.rows.length} productos`);
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener reporte diario:', error);
        res.status(500).json({ error: 'Error al generar reporte diario' });
    }
});

// Estadísticas generales del día (incluye gastos)
app.get('/api/reportes/estadisticas', async (req, res) => {
    const { fecha } = req.query;
    
    try {
        const ventasResult = await pool.query(`
            SELECT 
                COUNT(DISTINCT producto_id) as productos_diferentes,
                COUNT(*) as total_transacciones,
                SUM(cantidad) as cantidad_total_vendida,
                SUM(total) as ingresos_totales,
                AVG(total) as venta_promedio,
                MIN(total) as venta_minima,
                MAX(total) as venta_maxima
            FROM ventas
            WHERE fecha_venta = ${fecha ? '$1' : 'CURRENT_DATE'}
        `, fecha ? [fecha] : []);

        const gastosResult = await pool.query(`
            SELECT 
                COALESCE(SUM(monto), 0) as total_gastos,
                COUNT(*) as total_gastos_registros
            FROM gastos
            WHERE fecha_gasto = ${fecha ? '$1' : 'CURRENT_DATE'} AND activo = true
        `, fecha ? [fecha] : []);

        const ventas = ventasResult.rows[0];
        const gastos = gastosResult.rows[0];

        const response = {
            ...ventas,
            total_gastos: parseFloat(gastos.total_gastos) || 0,
            total_gastos_registros: parseInt(gastos.total_gastos_registros) || 0,
            ganancia_neta: (parseFloat(ventas.ingresos_totales) || 0) - (parseFloat(gastos.total_gastos) || 0)
        };

        console.log(`📊 Estadísticas: $${response.ingresos_totales} ingresos, $${response.total_gastos} gastos`);
        res.json(response);
    } catch (error) {
        console.error('Error al obtener estadísticas:', error);
        res.status(500).json({ error: 'Error al generar estadísticas' });
    }
});

// ==================== REPORTES AVANZADOS INTEGRADOS ====================
// Funciones de reportes avanzados integradas directamente

// Dashboard principal
async function getDashboardDataIntegrado(req, res) {
    try {
        console.log('☕ Generando dashboard principal integrado...');
        
        // Estadísticas del día actual
        const hoyStats = await pool.query(`
            SELECT 
                COALESCE(COUNT(*), 0) as transacciones_hoy,
                COALESCE(SUM(cantidad), 0) as unidades_hoy,
                COALESCE(SUM(total), 0) as ingresos_hoy,
                COALESCE(COUNT(DISTINCT producto_id), 0) as productos_vendidos_hoy
            FROM ventas 
            WHERE fecha_venta = CURRENT_DATE
        `);

        // Gastos del día
        const gastosHoy = await pool.query(`
            SELECT COALESCE(SUM(monto), 0) as gastos_hoy
            FROM gastos 
            WHERE fecha_gasto = CURRENT_DATE AND activo = true
        `);

        // Estadísticas de ayer
        const ayerStats = await pool.query(`
            SELECT 
                COALESCE(COUNT(*), 0) as transacciones_ayer,
                COALESCE(SUM(cantidad), 0) as unidades_ayer,
                COALESCE(SUM(total), 0) as ingresos_ayer
            FROM ventas 
            WHERE fecha_venta = CURRENT_DATE - INTERVAL '1 day'
        `);

        const gastosAyer = await pool.query(`
            SELECT COALESCE(SUM(monto), 0) as gastos_ayer
            FROM gastos 
            WHERE fecha_gasto = CURRENT_DATE - INTERVAL '1 day' AND activo = true
        `);

        // Top productos
        const topProductos = await pool.query(`
            SELECT 
                p.nombre,
                COALESCE(SUM(v.cantidad), 0) as total_cantidad,
                COALESCE(SUM(v.total), 0) as total_ingresos
            FROM productos p
            LEFT JOIN ventas v ON p.id = v.producto_id 
                AND v.fecha_venta >= CURRENT_DATE - INTERVAL '7 days'
            WHERE p.activo = true
            GROUP BY p.id, p.nombre
            ORDER BY total_ingresos DESC
            LIMIT 5
        `);

        // Tendencia 7 días
        const tendencia7Dias = await pool.query(`
            SELECT 
                fecha_venta,
                COALESCE(SUM(total), 0) as ingresos
            FROM ventas
            WHERE fecha_venta >= CURRENT_DATE - INTERVAL '6 days'
            GROUP BY fecha_venta
            ORDER BY fecha_venta
        `);

        const hoyData = hoyStats.rows[0] || {};
        const gastosHoyData = gastosHoy.rows[0] || {};
        const ayerData = ayerStats.rows[0] || {};
        const gastosAyerData = gastosAyer.rows[0] || {};

        const response = {
            hoy: {
                transacciones_hoy: parseInt(hoyData.transacciones_hoy) || 0,
                unidades_hoy: parseInt(hoyData.unidades_hoy) || 0,
                ingresos_hoy: parseFloat(hoyData.ingresos_hoy) || 0,
                productos_vendidos_hoy: parseInt(hoyData.productos_vendidos_hoy) || 0,
                gastos_hoy: parseFloat(gastosHoyData.gastos_hoy) || 0,
                ganancia_neta_hoy: (parseFloat(hoyData.ingresos_hoy) || 0) - (parseFloat(gastosHoyData.gastos_hoy) || 0)
            },
            ayer: {
                transacciones_ayer: parseInt(ayerData.transacciones_ayer) || 0,
                unidades_ayer: parseInt(ayerData.unidades_ayer) || 0,
                ingresos_ayer: parseFloat(ayerData.ingresos_ayer) || 0,
                gastos_ayer: parseFloat(gastosAyerData.gastos_ayer) || 0,
                ganancia_neta_ayer: (parseFloat(ayerData.ingresos_ayer) || 0) - (parseFloat(gastosAyerData.gastos_ayer) || 0)
            },
            topProductos: topProductos.rows,
            tendencia30Dias: tendencia7Dias.rows,
            metadata: {
                cafeteria: "Las Delicias del Norte",
                timestamp: new Date().toISOString()
            }
        };

        console.log(`📊 Dashboard integrado generado exitosamente`);
        res.json(response);

    } catch (error) {
        console.error('❌ Error en dashboard integrado:', error);
        res.status(500).json({ 
            error: 'Error al obtener dashboard integrado',
            details: error.message
        });
    }
}

// Reporte semanal integrado
async function getReporteSemanalIntegrado(req, res) {
    try {
        console.log('📅 Generando reporte semanal integrado...');
        
        const ventasSemana = await pool.query(`
            SELECT 
                fecha_venta,
                TO_CHAR(fecha_venta, 'Day') as nombre_dia,
                COALESCE(SUM(total), 0) as ingresos,
                COALESCE(COUNT(*), 0) as transacciones
            FROM ventas
            WHERE fecha_venta >= CURRENT_DATE - INTERVAL '6 days'
            GROUP BY fecha_venta
            ORDER BY fecha_venta
        `);

        const response = {
            ventasPorDia: ventasSemana.rows,
            periodo: {
                inicio: new Date(Date.now() - 6*24*60*60*1000).toISOString().split('T')[0],
                fin: new Date().toISOString().split('T')[0]
            },
            timestamp: new Date().toISOString()
        };

        res.json(response);

    } catch (error) {
        console.error('❌ Error en reporte semanal integrado:', error);
        res.status(500).json({ 
            error: 'Error al obtener reporte semanal',
            details: error.message
        });
    }
}

// Predicciones integradas
async function getPrediccionesIntegrado(req, res) {
    try {
        console.log('🔮 Generando predicciones integradas...');
        
        const promedios = await pool.query(`
            SELECT 
                COALESCE(AVG(ingresos_dia), 0) as promedio_ingresos_diarios,
                COALESCE(AVG(unidades_dia), 0) as promedio_unidades_diarias
            FROM (
                SELECT 
                    fecha_venta,
                    SUM(total) as ingresos_dia,
                    SUM(cantidad) as unidades_dia
                FROM ventas
                WHERE fecha_venta >= CURRENT_DATE - INTERVAL '6 days'
                GROUP BY fecha_venta
            ) as stats_diarias
        `);

        const promediosData = promedios.rows[0] || {};
        
        const response = {
            promediosDiarios: promediosData,
            prediccionesSemanales: {
                ingresosSemana: Math.round((parseFloat(promediosData.promedio_ingresos_diarios) || 0) * 7),
                unidadesSemana: Math.round((parseFloat(promediosData.promedio_unidades_diarias) || 0) * 7)
            },
            prediccionesMensuales: {
                ingresosMes: Math.round((parseFloat(promediosData.promedio_ingresos_diarios) || 0) * 30),
                unidadesMes: Math.round((parseFloat(promediosData.promedio_unidades_diarias) || 0) * 30)
            },
            timestamp: new Date().toISOString()
        };

        res.json(response);

    } catch (error) {
        console.error('❌ Error en predicciones integradas:', error);
        res.status(500).json({ 
            error: 'Error al obtener predicciones',
            details: error.message
        });
    }
}

// Usar funciones integradas si el módulo externo falla
if (!reportesAvanzados || typeof reportesAvanzados.getDashboardData !== 'function') {
    console.log('⚠️ Usando reportes integrados como fallback');
    
    app.get('/api/reportes/avanzados/dashboard', getDashboardDataIntegrado);
    app.get('/api/reportes/avanzados/semanal', getReporteSemanalIntegrado);
    app.get('/api/reportes/avanzados/predicciones', getPrediccionesIntegrado);
    
    // Rutas simplificadas para las otras funciones
    app.get('/api/reportes/avanzados/mensual', (req, res) => {
        res.json({
            mensaje: 'Función en desarrollo',
            timestamp: new Date().toISOString()
        });
    });
    
    app.get('/api/reportes/avanzados/tendencias', (req, res) => {
        res.json({
            mensaje: 'Función en desarrollo', 
            timestamp: new Date().toISOString()
        });
    });
    
    app.get('/api/reportes/avanzados/comparativo', (req, res) => {
        res.json({
            mensaje: 'Función en desarrollo',
            timestamp: new Date().toISOString()
        });
    });
}

// Ruta para la página de reportes avanzados
app.get('/reportes-avanzados', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'reportes-avanzados.html'));
});

// ==================== MIDDLEWARE DE SEGURIDAD BÁSICA ====================

// Middleware para registrar todas las acciones importantes
app.use((req, res, next) => {
    if (req.method !== 'GET') {
        const timestamp = new Date().toLocaleString('es-CO', {
            timeZone: 'America/Bogota',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        console.log(`📝 [${timestamp}] ${req.method} ${req.originalUrl}`);
    }
    next();
});

// Middleware para validar horario de operación (opcional)
const validarHorarioOperacion = (req, res, next) => {
    const now = new Date();
    const colombiaTime = new Date(now.toLocaleString("en-US", {timeZone: "America/Bogota"}));
    const hour = colombiaTime.getHours();
    
    // Cafetería opera de 6 AM a 12 PM
    if (hour < 6 || hour >= 12) {
        // Solo advertir, no bloquear (para permitir gestión fuera de horario)
        console.log(`⚠️ Acceso fuera del horario de operación: ${hour}:${colombiaTime.getMinutes()}`);
    }
    
    next();
};

// Aplicar validación de horario solo a operaciones críticas
app.use('/api/ventas', validarHorarioOperacion);

// ==================== RUTA PARA INFORMACIÓN DEL SISTEMA ====================
app.get('/api/info', (req, res) => {
    const now = new Date();
    const colombiaTime = new Date(now.toLocaleString("en-US", {timeZone: "America/Bogota"}));
    
    res.json({
        nombre: "Cafetería las Delicias del Norte",
        version: "2.0.0",
        horario: "6:00 AM - 12:00 PM",
        zona_horaria: "America/Bogota",
        hora_actual: colombiaTime.toLocaleString('es-CO'),
        en_operacion: colombiaTime.getHours() >= 6 && colombiaTime.getHours() < 12,
        estado: "Activo ☕"
    });
});

// ==================== INICIAR SERVIDOR ====================
async function iniciarServidor() {
    try {
        // Verificar conexión a base de datos
        await pool.query('SELECT NOW() as fecha_conexion');
        console.log('✅ Conexión a la base de datos exitosa');
        
        // Inicializar estructura de base de datos
        const dbInicializada = await inicializarBaseDatos();
        
        if (!dbInicializada) {
            console.error('❌ No se pudo inicializar la base de datos');
            process.exit(1);
        }

        // Iniciar servidor
        app.listen(PORT, () => {
            const now = new Date().toLocaleString('es-CO', {
                timeZone: 'America/Bogota'
            });
            
            console.log('\n' + '='.repeat(60));
            console.log('☕ CAFETERÍA LAS DELICIAS DEL NORTE ☕');
            console.log('='.repeat(60));
            console.log(`🚀 Servidor corriendo en puerto: ${PORT}`);
            console.log(`🕐 Hora Colombia: ${now}`);
            console.log(`📍 Zona horaria: America/Bogota`);
            console.log(`⏰ Horario de operación: 6:00 AM - 12:00 PM`);
            console.log(`🌐 Accesible en Railway`);
            console.log(`💻 Sistema listo para gestionar ventas y gastos`);
            console.log('='.repeat(60) + '\n');
        });

        // Log de inicio exitoso con productos disponibles
        const productosCount = await pool.query('SELECT COUNT(*) FROM productos WHERE activo = true');
        console.log(`📦 Productos activos en sistema: ${productosCount.rows[0].count}`);
        
        // Mostrar estadísticas del día actual
        setTimeout(async () => {
            try {
                const ventasHoy = await pool.query('SELECT COUNT(*) FROM ventas WHERE fecha_venta = CURRENT_DATE');
                const gastosHoy = await pool.query('SELECT COUNT(*) FROM gastos WHERE fecha_gasto = CURRENT_DATE AND activo = true');
                console.log(`📊 Ventas hoy: ${ventasHoy.rows[0].count} | Gastos hoy: ${gastosHoy.rows[0].count}`);
            } catch (error) {
                // Silenciar error de estadísticas iniciales
            }
        }, 2000);

    } catch (error) {
        console.error('❌ Error al iniciar el servidor:', error.message);
        console.log('💡 Verifica que la base de datos esté disponible');
        process.exit(1);
    }
}

// ==================== MANEJO DE ERRORES ====================
process.on('uncaughtException', (err) => {
    console.error('❌ Error crítico no capturado:', err);
    console.log('🔄 Intentando continuar...');
});

process.on('unhandledRejection', (err) => {
    console.error('❌ Promesa rechazada:', err);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('🛑 Cerrando servidor...');
    await pool.end();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('\n🛑 Cerrando servidor por interrupción...');
    await pool.end();
    process.exit(0);
});

// ==================== INICIAR APLICACIÓN ====================
iniciarServidor();