const { Pool } = require('pg');

// Usar la misma configuración de base de datos
const pool = new Pool({
    connectionString: 'postgresql://postgres:NodFNNsyBPAIrSVfForbJcbuDOyZbCOZ@switchback.proxy.rlwy.net:39449/railway',
    ssl: {
        rejectUnauthorized: false
    }
});

// ==================== DASHBOARD PRINCIPAL ====================
async function getDashboardData(req, res) {
    try {
        // Estadísticas del día actual
        const hoyStats = await pool.query(`
            SELECT 
                COUNT(*) as transacciones_hoy,
                SUM(cantidad) as unidades_hoy,
                SUM(total) as ingresos_hoy,
                COUNT(DISTINCT producto_id) as productos_vendidos_hoy
            FROM ventas 
            WHERE fecha_venta = CURRENT_DATE
        `);

        // Estadísticas de ayer para comparación
        const ayerStats = await pool.query(`
            SELECT 
                COUNT(*) as transacciones_ayer,
                SUM(cantidad) as unidades_ayer,
                SUM(total) as ingresos_ayer
            FROM ventas 
            WHERE fecha_venta = CURRENT_DATE - INTERVAL '1 day'
        `);

        // Top productos del mes
        const topProductos = await pool.query(`
            SELECT 
                p.nombre,
                SUM(v.cantidad) as total_cantidad,
                SUM(v.total) as total_ingresos,
                COUNT(v.id) as total_transacciones
            FROM ventas v
            JOIN productos p ON v.producto_id = p.id
            WHERE v.fecha_venta >= DATE_TRUNC('month', CURRENT_DATE)
            GROUP BY p.id, p.nombre
            ORDER BY total_ingresos DESC
            LIMIT 5
        `);

        // Ventas por hora del día actual
        const ventasPorHora = await pool.query(`
            SELECT 
                EXTRACT(HOUR FROM hora_venta) as hora,
                COUNT(*) as transacciones,
                SUM(cantidad) as unidades,
                SUM(total) as ingresos
            FROM ventas
            WHERE fecha_venta = CURRENT_DATE
            GROUP BY EXTRACT(HOUR FROM hora_venta)
            ORDER BY hora
        `);

        // Últimos 30 días para gráfico de tendencia
        const tendencia30Dias = await pool.query(`
            SELECT 
                fecha_venta,
                COUNT(*) as transacciones,
                SUM(cantidad) as unidades,
                SUM(total) as ingresos
            FROM ventas
            WHERE fecha_venta >= CURRENT_DATE - INTERVAL '30 days'
            GROUP BY fecha_venta
            ORDER BY fecha_venta
        `);

        const response = {
            hoy: hoyStats.rows[0],
            ayer: ayerStats.rows[0],
            topProductos: topProductos.rows,
            ventasPorHora: ventasPorHora.rows,
            tendencia30Dias: tendencia30Dias.rows,
            timestamp: new Date().toISOString()
        };

        res.json(response);
    } catch (error) {
        console.error('Error en getDashboardData:', error);
        res.status(500).json({ error: 'Error al obtener datos del dashboard' });
    }
}

// ==================== REPORTE SEMANAL ====================
async function getReporteSemanal(req, res) {
    try {
        const { fecha } = req.query;
        const fechaBase = fecha || 'CURRENT_DATE';

        // Ventas por día de la semana
        const ventasSemana = await pool.query(`
            SELECT 
                fecha_venta,
                EXTRACT(DOW FROM fecha_venta) as dia_semana,
                TO_CHAR(fecha_venta, 'Day') as nombre_dia,
                COUNT(*) as transacciones,
                SUM(cantidad) as unidades_vendidas,
                SUM(total) as ingresos,
                AVG(total) as ticket_promedio
            FROM ventas
            WHERE fecha_venta >= ${fechaBase}::date - INTERVAL '6 days'
            AND fecha_venta <= ${fechaBase}::date
            GROUP BY fecha_venta, EXTRACT(DOW FROM fecha_venta)
            ORDER BY fecha_venta
        `, fecha ? [fecha] : []);

        // Productos más vendidos de la semana
        const topProductosSemana = await pool.query(`
            SELECT 
                p.nombre,
                p.precio,
                SUM(v.cantidad) as unidades_vendidas,
                SUM(v.total) as ingresos_totales,
                COUNT(v.id) as transacciones,
                AVG(v.precio_unitario) as precio_promedio
            FROM ventas v
            JOIN productos p ON v.producto_id = p.id
            WHERE v.fecha_venta >= ${fechaBase}::date - INTERVAL '6 days'
            AND v.fecha_venta <= ${fechaBase}::date
            GROUP BY p.id, p.nombre, p.precio
            ORDER BY ingresos_totales DESC
        `, fecha ? [fecha] : []);

        // Comparación con semana anterior
        const semanaAnterior = await pool.query(`
            SELECT 
                COUNT(*) as transacciones_anterior,
                SUM(cantidad) as unidades_anterior,
                SUM(total) as ingresos_anterior
            FROM ventas
            WHERE fecha_venta >= ${fechaBase}::date - INTERVAL '13 days'
            AND fecha_venta <= ${fechaBase}::date - INTERVAL '7 days'
        `, fecha ? [fecha] : []);

        const response = {
            periodoInicio: fecha ? new Date(fecha + 'T00:00:00Z').toISOString().split('T')[0] : new Date(Date.now() - 6*24*60*60*1000).toISOString().split('T')[0],
            periodoFin: fecha || new Date().toISOString().split('T')[0],
            ventasPorDia: ventasSemana.rows,
            topProductos: topProductosSemana.rows,
            comparacionSemanaAnterior: semanaAnterior.rows[0],
            timestamp: new Date().toISOString()
        };

        res.json(response);
    } catch (error) {
        console.error('Error en getReporteSemanal:', error);
        res.status(500).json({ error: 'Error al obtener reporte semanal' });
    }
}

// ==================== REPORTE MENSUAL ====================
async function getReporteMensual(req, res) {
    try {
        const { mes, año } = req.query;
        const fechaActual = new Date();
        const mesActual = mes || (fechaActual.getMonth() + 1);
        const añoActual = año || fechaActual.getFullYear();

        // Ventas por día del mes
        const ventasDelMes = await pool.query(`
            SELECT 
                fecha_venta,
                EXTRACT(DAY FROM fecha_venta) as dia,
                COUNT(*) as transacciones,
                SUM(cantidad) as unidades_vendidas,
                SUM(total) as ingresos
            FROM ventas
            WHERE EXTRACT(MONTH FROM fecha_venta) = $1
            AND EXTRACT(YEAR FROM fecha_venta) = $2
            GROUP BY fecha_venta
            ORDER BY fecha_venta
        `, [mesActual, añoActual]);

        // Ventas por semana del mes
        const ventasPorSemana = await pool.query(`
            SELECT 
                EXTRACT(WEEK FROM fecha_venta) as semana,
                COUNT(*) as transacciones,
                SUM(cantidad) as unidades_vendidas,
                SUM(total) as ingresos,
                MIN(fecha_venta) as inicio_semana,
                MAX(fecha_venta) as fin_semana
            FROM ventas
            WHERE EXTRACT(MONTH FROM fecha_venta) = $1
            AND EXTRACT(YEAR FROM fecha_venta) = $2
            GROUP BY EXTRACT(WEEK FROM fecha_venta)
            ORDER BY semana
        `, [mesActual, añoActual]);

        // Top productos del mes
        const topProductosMes = await pool.query(`
            SELECT 
                p.nombre,
                SUM(v.cantidad) as unidades_vendidas,
                SUM(v.total) as ingresos_totales,
                COUNT(v.id) as transacciones,
                AVG(v.total) as ticket_promedio
            FROM ventas v
            JOIN productos p ON v.producto_id = p.id
            WHERE EXTRACT(MONTH FROM v.fecha_venta) = $1
            AND EXTRACT(YEAR FROM v.fecha_venta) = $2
            GROUP BY p.id, p.nombre
            ORDER BY ingresos_totales DESC
        `, [mesActual, añoActual]);

        // Comparación con mes anterior
        const mesAnterior = mesActual === 1 ? 12 : mesActual - 1;
        const añoMesAnterior = mesActual === 1 ? añoActual - 1 : añoActual;

        const comparacionMesAnterior = await pool.query(`
            SELECT 
                COUNT(*) as transacciones_anterior,
                SUM(cantidad) as unidades_anterior,
                SUM(total) as ingresos_anterior
            FROM ventas
            WHERE EXTRACT(MONTH FROM fecha_venta) = $1
            AND EXTRACT(YEAR FROM fecha_venta) = $2
        `, [mesAnterior, añoMesAnterior]);

        const response = {
            mes: mesActual,
            año: añoActual,
            ventasPorDia: ventasDelMes.rows,
            ventasPorSemana: ventasPorSemana.rows,
            topProductos: topProductosMes.rows,
            comparacionMesAnterior: comparacionMesAnterior.rows[0],
            timestamp: new Date().toISOString()
        };

        res.json(response);
    } catch (error) {
        console.error('Error en getReporteMensual:', error);
        res.status(500).json({ error: 'Error al obtener reporte mensual' });
    }
}

// ==================== PREDICCIONES ====================
async function getPredicciones(req, res) {
    try {
        // Predicción simple basada en promedio de últimos 30 días
        const promediosDiarios = await pool.query(`
            SELECT 
                AVG(ingresos_dia) as promedio_ingresos_diarios,
                AVG(unidades_dia) as promedio_unidades_diarias,
                AVG(transacciones_dia) as promedio_transacciones_diarias
            FROM (
                SELECT 
                    fecha_venta,
                    SUM(total) as ingresos_dia,
                    SUM(cantidad) as unidades_dia,
                    COUNT(*) as transacciones_dia
                FROM ventas
                WHERE fecha_venta >= CURRENT_DATE - INTERVAL '30 days'
                GROUP BY fecha_venta
            ) as ventas_diarias
        `);

        // Tendencia por día de la semana
        const tendenciaDiaSemana = await pool.query(`
            SELECT 
                EXTRACT(DOW FROM fecha_venta) as dia_semana,
                TO_CHAR(fecha_venta, 'Day') as nombre_dia,
                AVG(total_dia) as promedio_ingresos,
                AVG(unidades_dia) as promedio_unidades
            FROM (
                SELECT 
                    fecha_venta,
                    SUM(total) as total_dia,
                    SUM(cantidad) as unidades_dia
                FROM ventas
                WHERE fecha_venta >= CURRENT_DATE - INTERVAL '60 days'
                GROUP BY fecha_venta
            ) as ventas_por_dia
            GROUP BY EXTRACT(DOW FROM fecha_venta)
            ORDER BY dia_semana
        `);

        // Predicción por producto basada en tendencia
        const prediccionesProductos = await pool.query(`
            SELECT 
                p.nombre,
                p.precio,
                COALESCE(AVG(ventas_diarias.unidades_dia), 0) as promedio_unidades_diarias,
                COALESCE(AVG(ventas_diarias.ingresos_dia), 0) as promedio_ingresos_diarios,
                COUNT(ventas_diarias.fecha_venta) as dias_con_ventas
            FROM productos p
            LEFT JOIN (
                SELECT 
                    producto_id,
                    fecha_venta,
                    SUM(cantidad) as unidades_dia,
                    SUM(total) as ingresos_dia
                FROM ventas
                WHERE fecha_venta >= CURRENT_DATE - INTERVAL '30 days'
                GROUP BY producto_id, fecha_venta
            ) as ventas_diarias ON p.id = ventas_diarias.producto_id
            WHERE p.activo = true
            GROUP BY p.id, p.nombre, p.precio
            ORDER BY promedio_ingresos_diarios DESC NULLS LAST
        `);

        const promedios = promediosDiarios.rows[0] || {
            promedio_ingresos_diarios: 0,
            promedio_unidades_diarias: 0,
            promedio_transacciones_diarias: 0
        };
        
        // Calcular predicciones para próximos 7 días
        const prediccionesSemanales = {
            ingresosSemana: (parseFloat(promedios.promedio_ingresos_diarios) || 0) * 7,
            unidadesSemana: Math.round((parseFloat(promedios.promedio_unidades_diarias) || 0) * 7),
            transaccionesSemana: Math.round((parseFloat(promedios.promedio_transacciones_diarias) || 0) * 7)
        };

        // Predicciones mensuales
        const prediccionesMensuales = {
            ingresosMes: (parseFloat(promedios.promedio_ingresos_diarios) || 0) * 30,
            unidadesMes: Math.round((parseFloat(promedios.promedio_unidades_diarias) || 0) * 30),
            transaccionesMes: Math.round((parseFloat(promedios.promedio_transacciones_diarias) || 0) * 30)
        };

        const response = {
            promediosDiarios: promedios,
            prediccionesSemanales,
            prediccionesMensuales,
            tendenciaPorDiaSemana: tendenciaDiaSemana.rows,
            prediccionesPorProducto: prediccionesProductos.rows,
            timestamp: new Date().toISOString()
        };

        res.json(response);
    } catch (error) {
        console.error('Error en getPredicciones:', error);
        res.status(500).json({ error: 'Error al obtener predicciones' });
    }
}

// ==================== ANÁLISIS DE TENDENCIAS ====================
async function getTendencias(req, res) {
    try {
        // Tendencias de los últimos 3 meses
        const tendenciasTrimestrales = await pool.query(`
            SELECT 
                DATE_TRUNC('month', fecha_venta) as mes,
                COUNT(*) as transacciones,
                SUM(cantidad) as unidades_vendidas,
                SUM(total) as ingresos,
                AVG(total) as ticket_promedio,
                COUNT(DISTINCT producto_id) as productos_vendidos
            FROM ventas
            WHERE fecha_venta >= CURRENT_DATE - INTERVAL '3 months'
            GROUP BY DATE_TRUNC('month', fecha_venta)
            ORDER BY mes
        `);

        // Crecimiento por producto en los últimos 3 meses
        const crecimientoProductos = await pool.query(`
            SELECT 
                p.nombre,
                COALESCE(SUM(v.cantidad), 0) as total_unidades,
                COALESCE(SUM(v.total), 0) as total_ingresos,
                COUNT(DISTINCT DATE_TRUNC('month', v.fecha_venta)) as meses_activos
            FROM productos p
            LEFT JOIN ventas v ON p.id = v.producto_id 
                AND v.fecha_venta >= CURRENT_DATE - INTERVAL '3 months'
            WHERE p.activo = true
            GROUP BY p.id, p.nombre
            ORDER BY total_ingresos DESC
        `);

        // Horarios pico (análisis por hora)
        const horariosPico = await pool.query(`
            SELECT 
                EXTRACT(HOUR FROM hora_venta) as hora,
                COUNT(*) as transacciones,
                SUM(cantidad) as unidades,
                SUM(total) as ingresos,
                AVG(total) as ticket_promedio
            FROM ventas
            WHERE fecha_venta >= CURRENT_DATE - INTERVAL '30 days'
            GROUP BY EXTRACT(HOUR FROM hora_venta)
            ORDER BY transacciones DESC
        `);

        // Patrones de venta por día de la semana
        const patronesDiaSemana = await pool.query(`
            SELECT 
                EXTRACT(DOW FROM fecha_venta) as dia_semana,
                TO_CHAR(fecha_venta, 'Day') as nombre_dia,
                COUNT(*) as transacciones,
                SUM(cantidad) as unidades,
                SUM(total) as ingresos,
                AVG(total) as ticket_promedio
            FROM ventas
            WHERE fecha_venta >= CURRENT_DATE - INTERVAL '60 days'
            GROUP BY EXTRACT(DOW FROM fecha_venta)
            ORDER BY dia_semana
        `);

        const response = {
            tendenciasTrimestrales: tendenciasTrimestrales.rows,
            crecimientoProductos: crecimientoProductos.rows,
            horariosPico: horariosPico.rows,
            patronesDiaSemana: patronesDiaSemana.rows,
            timestamp: new Date().toISOString()
        };

        res.json(response);
    } catch (error) {
        console.error('Error en getTendencias:', error);
        res.status(500).json({ error: 'Error al obtener tendencias' });
    }
}

// ==================== REPORTES COMPARATIVOS ====================
async function getComparativo(req, res) {
    try {
        const { tipo = 'mensual', periodo1, periodo2 } = req.query;

        let query1, query2, params1 = [], params2 = [];

        if (tipo === 'mensual') {
            // Comparar mes actual vs mes anterior
            query1 = `
                SELECT 
                    COUNT(*) as transacciones,
                    SUM(cantidad) as unidades,
                    SUM(total) as ingresos,
                    AVG(total) as ticket_promedio,
                    COUNT(DISTINCT producto_id) as productos_vendidos
                FROM ventas
                WHERE EXTRACT(MONTH FROM fecha_venta) = EXTRACT(MONTH FROM CURRENT_DATE)
                AND EXTRACT(YEAR FROM fecha_venta) = EXTRACT(YEAR FROM CURRENT_DATE)
            `;

            query2 = `
                SELECT 
                    COUNT(*) as transacciones,
                    SUM(cantidad) as unidades,
                    SUM(total) as ingresos,
                    AVG(total) as ticket_promedio,
                    COUNT(DISTINCT producto_id) as productos_vendidos
                FROM ventas
                WHERE fecha_venta >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month'
                AND fecha_venta < DATE_TRUNC('month', CURRENT_DATE)
            `;
        } else if (tipo === 'semanal') {
            // Comparar semana actual vs semana anterior
            query1 = `
                SELECT 
                    COUNT(*) as transacciones,
                    SUM(cantidad) as unidades,
                    SUM(total) as ingresos,
                    AVG(total) as ticket_promedio
                FROM ventas
                WHERE fecha_venta >= CURRENT_DATE - EXTRACT(DOW FROM CURRENT_DATE)::integer
                AND fecha_venta <= CURRENT_DATE
            `;

            query2 = `
                SELECT 
                    COUNT(*) as transacciones,
                    SUM(cantidad) as unidades,
                    SUM(total) as ingresos,
                    AVG(total) as ticket_promedio
                FROM ventas
                WHERE fecha_venta >= CURRENT_DATE - EXTRACT(DOW FROM CURRENT_DATE)::integer - 7
                AND fecha_venta <= CURRENT_DATE - EXTRACT(DOW FROM CURRENT_DATE)::integer - 1
            `;
        }

        const [resultado1, resultado2] = await Promise.all([
            pool.query(query1, params1),
            pool.query(query2, params2)
        ]);

        const datos1 = resultado1.rows[0];
        const datos2 = resultado2.rows[0];

        // Calcular variaciones porcentuales
        const calcularVariacion = (actual, anterior) => {
            if (!anterior || anterior === 0) return actual > 0 ? 100 : 0;
            return ((actual - anterior) / anterior) * 100;
        };

        const comparacion = {
            transacciones: {
                actual: parseInt(datos1.transacciones) || 0,
                anterior: parseInt(datos2.transacciones) || 0,
                variacion: calcularVariacion(datos1.transacciones, datos2.transacciones)
            },
            unidades: {
                actual: parseInt(datos1.unidades) || 0,
                anterior: parseInt(datos2.unidades) || 0,
                variacion: calcularVariacion(datos1.unidades, datos2.unidades)
            },
            ingresos: {
                actual: parseFloat(datos1.ingresos) || 0,
                anterior: parseFloat(datos2.ingresos) || 0,
                variacion: calcularVariacion(datos1.ingresos, datos2.ingresos)
            },
            ticketPromedio: {
                actual: parseFloat(datos1.ticket_promedio) || 0,
                anterior: parseFloat(datos2.ticket_promedio) || 0,
                variacion: calcularVariacion(datos1.ticket_promedio, datos2.ticket_promedio)
            }
        };

        const response = {
            tipo,
            comparacion,
            timestamp: new Date().toISOString()
        };

        res.json(response);
    } catch (error) {
        console.error('Error en getComparativo:', error);
        res.status(500).json({ error: 'Error al obtener comparativo' });
    }
}

module.exports = {
    getDashboardData,
    getReporteSemanal,
    getReporteMensual,
    getPredicciones,
    getTendencias,
    getComparativo
};