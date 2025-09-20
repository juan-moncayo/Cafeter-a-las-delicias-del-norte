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
    const fechaConsulta = fecha || 'CURRENT_DATE';
    
    try {
        const result = await pool.query(`
            SELECT 
                p.nombre as producto,
                p.precio as precio_actual,
                COUNT(v.id) as cantidad_vendida,
                SUM(v.total) as total_ventas,
                AVG(v.precio_unitario) as precio_promedio
            FROM ventas v
            JOIN productos p ON v.producto_id = p.id
            WHERE v.fecha_venta = ${fecha ? '$1' : 'CURRENT_DATE'}
            GROUP BY p.id, p.nombre, p.precio
            ORDER BY total_ventas DESC
        `, fecha ? [fecha] : []);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener reporte diario:', error);
        res.status(500).json({ error: 'Error al obtener reporte diario' });
    }
});

// Estadísticas generales del día
app.get('/api/reportes/estadisticas', async (req, res) => {
    const { fecha } = req.query;
    
    try {
        const result = await pool.query(`
            SELECT 
                COUNT(DISTINCT producto_id) as productos_diferentes,
                COUNT(*) as total_ventas,
                SUM(cantidad) as total_unidades,
                SUM(total) as ingresos_totales,
                AVG(total) as venta_promedio,
                MIN(total) as venta_minima,
                MAX(total) as venta_maxima
            FROM ventas
            WHERE fecha_venta = ${fecha ? '$1' : 'CURRENT_DATE'}
        `, fecha ? [fecha] : []);
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error al obtener estadísticas:', error);
        res.status(500).json({ error: 'Error al obtener estadísticas' });
    }
});

// ==================== INICIAR SERVIDOR ====================
app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    console.log('📊 Sistema de Ventas Simple - Listo para usar!');
    console.log('🔗 Conectando a la base de datos...');
    
    // Probar conexión a la base de datos
    pool.query('SELECT NOW() as fecha_conexion', (err, res) => {
        if (err) {
            console.error('❌ Error conectando a la base de datos:', err.message);
            console.log('💡 Verifica que la base de datos esté disponible');
        } else {
            console.log('✅ Conexión a la base de datos exitosa');
            console.log(`📅 Conectado en: ${res.rows[0].fecha_conexion}`);
        }
    });
});

// Manejo de errores no capturados
process.on('uncaughtException', (err) => {
    console.error('❌ Error no capturado:', err);
});

process.on('unhandledRejection', (err) => {
    console.error('❌ Promesa rechazada:', err);
});