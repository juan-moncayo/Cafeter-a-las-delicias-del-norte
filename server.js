const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de la base de datos PostgreSQL
const pool = new Pool({
    connectionString: 'postgresql://postgres:NodFNNsyBPAIrSVfForbJcbuDOyZbCOZ@switchback.proxy.rlwy.net:39449/railway',
    ssl: {
        rejectUnauthorized: false
    }
});

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// ==================== FUNCIÓN PARA CREAR TABLAS ====================
async function inicializarBaseDatos() {
    try {
        console.log('🔧 Verificando estructura de base de datos...');
        
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
            CREATE INDEX IF NOT EXISTS idx_ventas_fecha ON ventas(fecha_venta)
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_ventas_producto ON ventas(producto_id)
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_productos_activo ON productos(activo)
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_gastos_fecha ON gastos(fecha_gasto)
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_gastos_activo ON gastos(activo)
        `);

        // Verificar si hay productos de ejemplo, si no, crearlos
        const productosExistentes = await pool.query('SELECT COUNT(*) FROM productos');
        if (parseInt(productosExistentes.rows[0].count) === 0) {
            console.log('📦 Creando productos de ejemplo...');
            await pool.query(`
                INSERT INTO productos (nombre, precio) VALUES 
                ('Merengón', 3500.00),
                ('Yogurt Natural', 2800.00),
                ('Agua Botella 500ml', 1500.00),
                ('Gaseosa Coca Cola', 2200.00),
                ('Chocolate Jet', 1800.00)
            `);
            console.log('✅ Productos de ejemplo creados');
        }

        console.log('✅ Base de datos inicializada correctamente');
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
        res.status(500).json({ error: 'Error al obtener productos' });
    }
});

// Crear nuevo producto
app.post('/api/productos', async (req, res) => {
    const { nombre, precio } = req.body;
    
    if (!nombre || !precio) {
        return res.status(400).json({ error: 'Nombre y precio son requeridos' });
    }

    try {
        const result = await pool.query(
            'INSERT INTO productos (nombre, precio) VALUES ($1, $2) RETURNING *',
            [nombre, parseFloat(precio)]
        );
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

    try {
        const result = await pool.query(
            'UPDATE productos SET nombre = $1, precio = $2 WHERE id = $3 AND activo = true RETURNING *',
            [nombre, parseFloat(precio), id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }
        
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

// Obtener ventas del día actual
app.get('/api/ventas', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT v.*, p.nombre as producto_nombre 
            FROM ventas v 
            JOIN productos p ON v.producto_id = p.id 
            WHERE v.fecha_venta = CURRENT_DATE 
            ORDER BY v.fecha_creacion DESC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener ventas:', error);
        res.status(500).json({ error: 'Error al obtener ventas' });
    }
});

// Crear nueva venta
app.post('/api/ventas', async (req, res) => {
    const { producto_id, cantidad = 1 } = req.body;
    
    if (!producto_id) {
        return res.status(400).json({ error: 'ID del producto es requerido' });
    }

    try {
        // Obtener el precio actual del producto
        const productoResult = await pool.query(
            'SELECT precio FROM productos WHERE id = $1 AND activo = true',
            [producto_id]
        );
        
        if (productoResult.rows.length === 0) {
            return res.status(404).json({ error: 'Producto no encontrado o inactivo' });
        }
        
        const precio = productoResult.rows[0].precio;
        const total = precio * cantidad;
        
        const result = await pool.query(`
            INSERT INTO ventas (producto_id, cantidad, precio_unitario, total) 
            VALUES ($1, $2, $3, $4) 
            RETURNING *
        `, [producto_id, cantidad, precio, total]);
        
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error al crear venta:', error);
        res.status(500).json({ error: 'Error al crear venta' });
    }
});

// Eliminar venta
app.delete('/api/ventas/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query(
            'DELETE FROM ventas WHERE id = $1 RETURNING *',
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Venta no encontrada' });
        }
        
        res.json({ message: 'Venta eliminada', venta: result.rows[0] });
    } catch (error) {
        console.error('Error al eliminar venta:', error);
        res.status(500).json({ error: 'Error al eliminar venta' });
    }
});

// ==================== RUTAS PARA REPORTES ====================

// Reporte de ventas diarias por producto
app.get('/api/reportes/diario', async (req, res) => {
    const { fecha } = req.query;
    
    try {
        console.log('🔍 Consultando reporte diario para fecha:', fecha || 'HOY');
        
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
        
        console.log('📊 Resultado del reporte:', result.rows);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener reporte diario:', error);
        res.status(500).json({ error: 'Error al obtener reporte diario' });
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

        res.json(response);
    } catch (error) {
        console.error('Error al obtener estadísticas:', error);
        res.status(500).json({ error: 'Error al obtener estadísticas' });
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
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener gastos:', error);
        res.status(500).json({ error: 'Error al obtener gastos' });
    }
});

// Crear nuevo gasto
app.post('/api/gastos', async (req, res) => {
    const { concepto, monto, descripcion = '' } = req.body;
    
    if (!concepto || !monto) {
        return res.status(400).json({ error: 'Concepto y monto son requeridos' });
    }

    try {
        const result = await pool.query(`
            INSERT INTO gastos (concepto, monto, descripcion) 
            VALUES ($1, $2, $3) 
            RETURNING *
        `, [concepto, parseFloat(monto), descripcion]);
        
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error al crear gasto:', error);
        res.status(500).json({ error: 'Error al crear gasto' });
    }
});

// Actualizar gasto
app.put('/api/gastos/:id', async (req, res) => {
    const { id } = req.params;
    const { concepto, monto, descripcion = '' } = req.body;
    
    if (!concepto || !monto) {
        return res.status(400).json({ error: 'Concepto y monto son requeridos' });
    }

    try {
        const result = await pool.query(`
            UPDATE gastos SET concepto = $1, monto = $2, descripcion = $3 
            WHERE id = $4 AND activo = true 
            RETURNING *
        `, [concepto, parseFloat(monto), descripcion, id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Gasto no encontrado' });
        }
        
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
        
        res.json({ message: 'Gasto eliminado', gasto: result.rows[0] });
    } catch (error) {
        console.error('Error al eliminar gasto:', error);
        res.status(500).json({ error: 'Error al eliminar gasto' });
    }
});

// ==================== REPORTES AVANZADOS ====================
// Importar el módulo de reportes avanzados
const reportesAvanzados = require('./reportes-avanzados');

// Rutas para reportes avanzados
app.get('/api/reportes/avanzados/dashboard', reportesAvanzados.getDashboardData);
app.get('/api/reportes/avanzados/semanal', reportesAvanzados.getReporteSemanal);
app.get('/api/reportes/avanzados/mensual', reportesAvanzados.getReporteMensual);
app.get('/api/reportes/avanzados/predicciones', reportesAvanzados.getPredicciones);
app.get('/api/reportes/avanzados/tendencias', reportesAvanzados.getTendencias);
app.get('/api/reportes/avanzados/comparativo', reportesAvanzados.getComparativo);

// Ruta para la página de reportes avanzados
app.get('/reportes-avanzados', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'reportes-avanzados.html'));
});

// ==================== INICIAR SERVIDOR ====================
async function iniciarServidor() {
    try {
        // Primero verificar conexión e inicializar base de datos
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
            console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
            console.log('📊 Sistema de Ventas Simple - Listo para usar!');
            console.log('🌐 Accesible en Railway');
        });

    } catch (error) {
        console.error('❌ Error al iniciar el servidor:', error.message);
        console.log('💡 Verifica que la base de datos esté disponible');
        process.exit(1);
    }
}

// Manejo de errores no capturados
process.on('uncaughtException', (err) => {
    console.error('❌ Error no capturado:', err);
});

process.on('unhandledRejection', (err) => {
    console.error('❌ Promesa rechazada:', err);
});

// Iniciar el servidor
iniciarServidor();