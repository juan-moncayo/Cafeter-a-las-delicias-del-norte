const { Pool } = require('pg');

// Configuración de base de datos para Cafetería las Delicias del Norte
const pool = new Pool({
    connectionString: 'postgresql://postgres:opCoXoxBaIBzyGGzwLPVCfFTitpUJePn@metro.proxy.rlwy.net:31829/railway',
    ssl: {
        rejectUnauthorized: false
    }
});

// Configurar zona horaria Colombia
process.env.TZ = 'America/Bogota';

// ==================== DASHBOARD PRINCIPAL CAFETERÍA ====================
async function getDashboardData(req, res) {
    try {
        console.log('☕ Generando dashboard principal de la cafetería...');
        
        // Estadísticas del día actual (incluye gastos) - Horario Colombia
        const hoyStats = await pool.query(`
            SELECT 
                COALESCE(v.transacciones_hoy, 0) as transacciones_hoy,
                COALESCE(v.unidades_hoy, 0) as unidades_hoy,
                COALESCE(v.ingresos_hoy, 0) as ingresos_hoy,
                COALESCE(v.productos_vendidos_hoy, 0) as productos_vendidos_hoy,
                COALESCE(v.ticket_promedio, 0) as ticket_promedio,
                COALESCE(g.gastos_hoy, 0) as gastos_hoy,
                COALESCE(v.ingresos_hoy, 0) - COALESCE(g.gastos_hoy, 0) as ganancia_neta_hoy,
                v.primera_venta,
                v.ultima_venta
            FROM (
                SELECT 
                    COUNT(*) as transacciones_hoy,
                    SUM(cantidad) as unidades_hoy,
                    SUM(total) as ingresos_hoy,
                    COUNT(DISTINCT producto_id) as productos_vendidos_hoy,
                    AVG(total) as ticket_promedio,
                    MIN(hora_venta) as primera_venta,
                    MAX(hora_venta) as ultima_venta
                FROM ventas 
                WHERE fecha_venta = CURRENT_DATE
            ) v
            CROSS JOIN (
                SELECT 
                    COALESCE(SUM(monto), 0) as gastos_hoy
                FROM gastos 
                WHERE fecha_gasto = CURRENT_DATE AND activo = true
            ) g
        `);

        // Estadísticas de ayer para comparación
        const ayerStats = await pool.query(`
            SELECT 
                COALESCE(v.transacciones_ayer, 0) as transacciones_ayer,
                COALESCE(v.unidades_ayer, 0) as unidades_ayer,
                COALESCE(v.ingresos_ayer, 0) as ingresos_ayer,
                COALESCE(g.gastos_ayer, 0) as gastos_ayer,
                COALESCE(v.ingresos_ayer, 0) - COALESCE(g.gastos_ayer, 0) as ganancia_neta_ayer
            FROM (
                SELECT 
                    COUNT(*) as transacciones_ayer,
                    SUM(cantidad) as unidades_ayer,
                    SUM(total) as ingresos_ayer
                FROM ventas 
                WHERE fecha_venta = CURRENT_DATE - INTERVAL '1 day'
            ) v
            CROSS JOIN (
                SELECT 
                    COALESCE(SUM(monto), 0) as gastos_ayer
                FROM gastos 
                WHERE fecha_gasto = CURRENT_DATE - INTERVAL '1 day' AND activo = true
            ) g
        `);

        // Top productos del mes (específico para cafetería)
        const topProductos = await pool.query(`
            SELECT 
                p.nombre,
                p.categoria,
                p.precio,
                SUM(v.cantidad) as total_cantidad,
                SUM(v.total) as total_ingresos,
                COUNT(v.id) as total_transacciones,
                AVG(v.total) as ticket_promedio,
                CASE p.categoria
                    WHEN 'Bebidas Calientes' THEN '☕'
                    WHEN 'Bebidas Frías' THEN '🧃'
                    WHEN 'Panadería' THEN '🥐'
                    WHEN 'Comidas' THEN '🍽️'
                    WHEN 'Postres' THEN '🍰'
                    WHEN 'Tés e Infusiones' THEN '🫖'
                    ELSE '🍴'
                END as emoji
            FROM ventas v
            JOIN productos p ON v.producto_id = p.id
            WHERE v.fecha_venta >= DATE_TRUNC('month', CURRENT_DATE)
            GROUP BY p.id, p.nombre, p.categoria, p.precio
            ORDER BY total_ingresos DESC
            LIMIT 8
        `);

        // Ventas por hora del día (6 AM - 12 PM)
        const ventasPorHora = await pool.query(`
            SELECT 
                EXTRACT(HOUR FROM hora_venta) as hora,
                TO_CHAR(CAST(EXTRACT(HOUR FROM hora_venta) || ':00' AS TIME), 'HH12:MI AM') as hora_formato,
                COUNT(*) as transacciones,
                SUM(cantidad) as unidades,
                SUM(total) as ingresos,
                AVG(total) as ticket_promedio,
                CASE 
                    WHEN EXTRACT(HOUR FROM hora_venta) BETWEEN 6 AND 7 THEN 'Apertura'
                    WHEN EXTRACT(HOUR FROM hora_venta) BETWEEN 8 AND 9 THEN 'Rush Matutino'
                    WHEN EXTRACT(HOUR FROM hora_venta) BETWEEN 10 AND 11 THEN 'Media Mañana'
                    WHEN EXTRACT(HOUR FROM hora_venta) = 11 THEN 'Pre-Cierre'
                    ELSE 'Fuera de Horario'
                END as periodo
            FROM ventas
            WHERE fecha_venta = CURRENT_DATE
            GROUP BY EXTRACT(HOUR FROM hora_venta)
            ORDER BY hora
        `);

        // Últimos 30 días para gráfico de tendencia
        const tendencia30Dias = await pool.query(`
            SELECT 
                v.fecha_venta,
                COUNT(*) as transacciones,
                SUM(v.cantidad) as unidades,
                SUM(v.total) as ingresos,
                COALESCE(g.gastos_dia, 0) as gastos,
                SUM(v.total) - COALESCE(g.gastos_dia, 0) as ganancia_neta,
                COUNT(DISTINCT v.producto_id) as productos_vendidos
            FROM ventas v
            LEFT JOIN (
                SELECT fecha_gasto, SUM(monto) as gastos_dia
                FROM gastos 
                WHERE activo = true 
                GROUP BY fecha_gasto
            ) g ON v.fecha_venta = g.fecha_gasto
            WHERE v.fecha_venta >= CURRENT_DATE - INTERVAL '30 days'
            GROUP BY v.fecha_venta, g.gastos_dia
            ORDER BY v.fecha_venta
        `);

        // Análisis por categorías de productos
        const ventasPorCategoria = await pool.query(`
            SELECT 
                p.categoria,
                COUNT(*) as transacciones,
                SUM(v.cantidad) as unidades_vendidas,
                SUM(v.total) as ingresos,
                AVG(v.total) as ticket_promedio,
                COUNT(DISTINCT p.id) as productos_diferentes,
                CASE p.categoria
                    WHEN 'Bebidas Calientes' THEN '☕'
                    WHEN 'Bebidas Frías' THEN '🧃'
                    WHEN 'Panadería' THEN '🥐'
                    WHEN 'Comidas' THEN '🍽️'
                    WHEN 'Postres' THEN '🍰'
                    WHEN 'Tés e Infusiones' THEN '🫖'
                    ELSE '🍴'
                END as emoji
            FROM ventas v
            JOIN productos p ON v.producto_id = p.id
            WHERE v.fecha_venta >= CURRENT_DATE - INTERVAL '7 days'
            GROUP BY p.categoria
            ORDER BY ingresos DESC
        `);

        const response = {
            hoy: hoyStats.rows[0],
            ayer: ayerStats.rows[0],
            topProductos: topProductos.rows,
            ventasPorHora: ventasPorHora.rows,
            tendencia30Dias: tendencia30Dias.rows,
            ventasPorCategoria: ventasPorCategoria.rows,
            metadata: {
                cafeteria: "Las Delicias del Norte",
                horario_operacion: "6:00 AM - 12:00 PM",
                zona_horaria: "America/Bogota",
                timestamp: new Date().toISOString()
            }
        };

        console.log(`📊 Dashboard generado: ${response.hoy.transacciones_hoy} ventas, $${response.hoy.ingresos_hoy} ingresos`);
        res.json(response);
    } catch (error) {
        console.error('❌ Error en getDashboardData:', error);
        res.status(500).json({ 
            error: 'Error al obtener datos del dashboard de la cafetería',
            details: error.message 
        });
    }
}

// ==================== REPORTE SEMANAL CAFETERÍA ====================
async function getReporteSemanal(req, res) {
    try {
        const { fecha } = req.query;
        const fechaBase = fecha || 'CURRENT_DATE';
        
        console.log(`📅 Generando reporte semanal desde: ${fecha || 'HOY'}`);

        // Ventas por día de la semana (última semana)
        const ventasSemana = await pool.query(`
            SELECT 
                v.fecha_venta,
                EXTRACT(DOW FROM v.fecha_venta) as dia_semana,
                TO_CHAR(v.fecha_venta, 'Day') as nombre_dia,
                TO_CHAR(v.fecha_venta, 'DD/MM') as fecha_corta,
                COUNT(*) as transacciones,
                SUM(v.cantidad) as unidades_vendidas,
                SUM(v.total) as ingresos,
                AVG(v.total) as ticket_promedio,
                COUNT(DISTINCT v.producto_id) as productos_diferentes,
                MIN(v.hora_venta) as primera_venta,
                MAX(v.hora_venta) as ultima_venta,
                COALESCE(g.gastos_dia, 0) as gastos_dia,
                SUM(v.total) - COALESCE(g.gastos_dia, 0) as ganancia_neta
            FROM ventas v
            LEFT JOIN (
                SELECT fecha_gasto, SUM(monto) as gastos_dia
                FROM gastos 
                WHERE activo = true 
                GROUP BY fecha_gasto
            ) g ON v.fecha_venta = g.fecha_gasto
            WHERE v.fecha_venta >= ${fechaBase}::date - INTERVAL '6 days'
            AND v.fecha_venta <= ${fechaBase}::date
            GROUP BY v.fecha_venta, EXTRACT(DOW FROM v.fecha_venta), g.gastos_dia
            ORDER BY v.fecha_venta
        `, fecha ? [fecha] : []);

        // Productos más vendidos de la semana por categoría
        const topProductosSemana = await pool.query(`
            SELECT 
                p.nombre,
                p.categoria,
                p.precio,
                SUM(v.cantidad) as unidades_vendidas,
                SUM(v.total) as ingresos_totales,
                COUNT(v.id) as transacciones,
                AVG(v.precio_unitario) as precio_promedio,
                ROUND((SUM(v.total) / (SELECT SUM(total) FROM ventas WHERE fecha_venta >= ${fechaBase}::date - INTERVAL '6 days' AND fecha_venta <= ${fechaBase}::date) * 100), 2) as porcentaje_ingresos,
                CASE p.categoria
                    WHEN 'Bebidas Calientes' THEN '☕'
                    WHEN 'Bebidas Frías' THEN '🧃'
                    WHEN 'Panadería' THEN '🥐'
                    WHEN 'Comidas' THEN '🍽️'
                    WHEN 'Postres' THEN '🍰'
                    WHEN 'Tés e Infusiones' THEN '🫖'
                    ELSE '🍴'
                END as emoji
            FROM ventas v
            JOIN productos p ON v.producto_id = p.id
            WHERE v.fecha_venta >= ${fechaBase}::date - INTERVAL '6 days'
            AND v.fecha_venta <= ${fechaBase}::date
            GROUP BY p.id, p.nombre, p.categoria, p.precio
            ORDER BY ingresos_totales DESC
            LIMIT 15
        `, fecha ? [fecha] : []);

        // Análisis de horarios pico
        const horariosPico = await pool.query(`
            SELECT 
                EXTRACT(HOUR FROM hora_venta) as hora,
                TO_CHAR(CAST(EXTRACT(HOUR FROM hora_venta) || ':00' AS TIME), 'HH12:MI AM') as hora_formato,
                COUNT(*) as transacciones,
                SUM(cantidad) as unidades,
                SUM(total) as ingresos,
                AVG(total) as ticket_promedio,
                CASE 
                    WHEN EXTRACT(HOUR FROM hora_venta) BETWEEN 6 AND 7 THEN 'Apertura'
                    WHEN EXTRACT(HOUR FROM hora_venta) BETWEEN 8 AND 9 THEN 'Rush Matutino'
                    WHEN EXTRACT(HOUR FROM hora_venta) BETWEEN 10 AND 11 THEN 'Media Mañana'
                    WHEN EXTRACT(HOUR FROM hora_venta) = 11 THEN 'Pre-Cierre'
                    ELSE 'Fuera de Horario'
                END as periodo
            FROM ventas
            WHERE fecha_venta >= ${fechaBase}::date - INTERVAL '6 days'
            AND fecha_venta <= ${fechaBase}::date
            GROUP BY EXTRACT(HOUR FROM hora_venta)
            ORDER BY transacciones DESC
        `, fecha ? [fecha] : []);

        // Comparación con semana anterior
        const semanaAnterior = await pool.query(`
            SELECT 
                COUNT(*) as transacciones_anterior,
                SUM(cantidad) as unidades_anterior,
                SUM(total) as ingresos_anterior,
                AVG(total) as ticket_promedio_anterior
            FROM ventas
            WHERE fecha_venta >= ${fechaBase}::date - INTERVAL '13 days'
            AND fecha_venta <= ${fechaBase}::date - INTERVAL '7 days'
        `, fecha ? [fecha] : []);

        const response = {
            periodo: {
                inicio: fecha ? new Date(fecha + 'T00:00:00Z').toISOString().split('T')[0] : new Date(Date.now() - 6*24*60*60*1000).toISOString().split('T')[0],
                fin: fecha || new Date().toISOString().split('T')[0]
            },
            ventasPorDia: ventasSemana.rows,
            topProductos: topProductosSemana.rows,
            horariosPico: horariosPico.rows,
            comparacionSemanaAnterior: semanaAnterior.rows[0],
            resumen: {
                dias_operacion: ventasSemana.rows.length,
                mejor_dia: ventasSemana.rows.reduce((max, dia) => dia.ingresos > max.ingresos ? dia : max, { ingresos: 0 }),
                peor_dia: ventasSemana.rows.reduce((min, dia) => dia.ingresos < min.ingresos ? dia : min, { ingresos: Infinity })
            },
            timestamp: new Date().toISOString()
        };

        console.log(`📈 Reporte semanal generado: ${response.ventasPorDia.length} días analizados`);
        res.json(response);
    } catch (error) {
        console.error('❌ Error en getReporteSemanal:', error);
        res.status(500).json({ 
            error: 'Error al obtener reporte semanal de la cafetería',
            details: error.message 
        });
    }
}

// ==================== REPORTE MENSUAL CAFETERÍA ====================
async function getReporteMensual(req, res) {
    try {
        const { mes, año } = req.query;
        const fechaActual = new Date();
        const mesActual = mes || (fechaActual.getMonth() + 1);
        const añoActual = año || fechaActual.getFullYear();

        console.log(`📅 Generando reporte mensual: ${mesActual}/${añoActual}`);

        // Ventas por día del mes
        const ventasDelMes = await pool.query(`
            SELECT 
                v.fecha_venta,
                EXTRACT(DAY FROM v.fecha_venta) as dia,
                TO_CHAR(v.fecha_venta, 'Day') as dia_semana,
                COUNT(*) as transacciones,
                SUM(v.cantidad) as unidades_vendidas,
                SUM(v.total) as ingresos,
                AVG(v.total) as ticket_promedio,
                COALESCE(g.gastos_dia, 0) as gastos,
                SUM(v.total) - COALESCE(g.gastos_dia, 0) as ganancia_neta
            FROM ventas v
            LEFT JOIN (
                SELECT fecha_gasto, SUM(monto) as gastos_dia
                FROM gastos 
                WHERE activo = true 
                GROUP BY fecha_gasto
            ) g ON v.fecha_venta = g.fecha_gasto
            WHERE EXTRACT(MONTH FROM v.fecha_venta) = $1
            AND EXTRACT(YEAR FROM v.fecha_venta) = $2
            GROUP BY v.fecha_venta, g.gastos_dia
            ORDER BY v.fecha_venta
        `, [mesActual, añoActual]);

        // Top productos del mes por categoría
        const topProductosMes = await pool.query(`
            SELECT 
                p.nombre,
                p.categoria,
                p.precio,
                SUM(v.cantidad) as unidades_vendidas,
                SUM(v.total) as ingresos_totales,
                COUNT(v.id) as transacciones,
                AVG(v.total) as ticket_promedio,
                COUNT(DISTINCT v.fecha_venta) as dias_vendido,
                CASE p.categoria
                    WHEN 'Bebidas Calientes' THEN '☕'
                    WHEN 'Bebidas Frías' THEN '🧃'
                    WHEN 'Panadería' THEN '🥐'
                    WHEN 'Comidas' THEN '🍽️'
                    WHEN 'Postres' THEN '🍰'
                    WHEN 'Tés e Infusiones' THEN '🫖'
                    ELSE '🍴'
                END as emoji
            FROM ventas v
            JOIN productos p ON v.producto_id = p.id
            WHERE EXTRACT(MONTH FROM v.fecha_venta) = $1
            AND EXTRACT(YEAR FROM v.fecha_venta) = $2
            GROUP BY p.id, p.nombre, p.categoria, p.precio
            ORDER BY ingresos_totales DESC
        `, [mesActual, añoActual]);

        // Análisis por categoría del mes
        const categoriasMes = await pool.query(`
            SELECT 
                p.categoria,
                COUNT(*) as transacciones,
                SUM(v.cantidad) as unidades,
                SUM(v.total) as ingresos,
                AVG(v.total) as ticket_promedio,
                COUNT(DISTINCT p.id) as productos_diferentes,
                ROUND((SUM(v.total) / (
                    SELECT SUM(total) 
                    FROM ventas 
                    WHERE EXTRACT(MONTH FROM fecha_venta) = $1 
                    AND EXTRACT(YEAR FROM fecha_venta) = $2
                ) * 100), 2) as porcentaje_ingresos
            FROM ventas v
            JOIN productos p ON v.producto_id = p.id
            WHERE EXTRACT(MONTH FROM v.fecha_venta) = $1
            AND EXTRACT(YEAR FROM v.fecha_venta) = $2
            GROUP BY p.categoria
            ORDER BY ingresos DESC
        `, [mesActual, añoActual]);

        // Comparación con mes anterior
        const mesAnterior = mesActual === 1 ? 12 : mesActual - 1;
        const añoMesAnterior = mesActual === 1 ? añoActual - 1 : añoActual;

        const comparacionMesAnterior = await pool.query(`
            SELECT 
                COUNT(*) as transacciones_anterior,
                SUM(cantidad) as unidades_anterior,
                SUM(total) as ingresos_anterior,
                AVG(total) as ticket_promedio_anterior
            FROM ventas
            WHERE EXTRACT(MONTH FROM fecha_venta) = $1
            AND EXTRACT(YEAR FROM fecha_venta) = $2
        `, [mesAnterior, añoMesAnterior]);

        const response = {
            periodo: {
                mes: mesActual,
                año: añoActual,
                nombre_mes: new Date(añoActual, mesActual - 1).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })
            },
            ventasPorDia: ventasDelMes.rows,
            topProductos: topProductosMes.rows,
            categorias: categoriasMes.rows,
            comparacionMesAnterior: comparacionMesAnterior.rows[0],
            estadisticas: {
                dias_operacion: ventasDelMes.rows.length,
                mejor_dia: ventasDelMes.rows.reduce((max, dia) => dia.ingresos > max.ingresos ? dia : max, { ingresos: 0 }),
                dia_mas_transacciones: ventasDelMes.rows.reduce((max, dia) => dia.transacciones > max.transacciones ? dia : max, { transacciones: 0 })
            },
            timestamp: new Date().toISOString()
        };

        console.log(`📊 Reporte mensual generado: ${response.ventasPorDia.length} días, ${response.topProductos.length} productos`);
        res.json(response);
    } catch (error) {
        console.error('❌ Error en getReporteMensual:', error);
        res.status(500).json({ 
            error: 'Error al obtener reporte mensual de la cafetería',
            details: error.message 
        });
    }
}

// ==================== PREDICCIONES INTELIGENTES CAFETERÍA ====================
async function getPredicciones(req, res) {
    try {
        console.log('🔮 Generando predicciones para la cafetería...');
        
        // Predicción basada en promedios de últimos 30 días (horario de operación)
        const promediosDiarios = await pool.query(`
            SELECT 
                AVG(ingresos_dia) as promedio_ingresos_diarios,
                AVG(unidades_dia) as promedio_unidades_diarias,
                AVG(transacciones_dia) as promedio_transacciones_diarias,
                AVG(gastos_dia) as promedio_gastos_diarios,
                AVG(ganancia_dia) as promedio_ganancia_diaria
            FROM (
                SELECT 
                    v.fecha_venta,
                    SUM(v.total) as ingresos_dia,
                    SUM(v.cantidad) as unidades_dia,
                    COUNT(*) as transacciones_dia,
                    COALESCE(g.gastos_dia, 0) as gastos_dia,
                    SUM(v.total) - COALESCE(g.gastos_dia, 0) as ganancia_dia
                FROM ventas v
                LEFT JOIN (
                    SELECT fecha_gasto, SUM(monto) as gastos_dia
                    FROM gastos 
                    WHERE activo = true 
                    GROUP BY fecha_gasto
                ) g ON v.fecha_venta = g.fecha_gasto
                WHERE v.fecha_venta >= CURRENT_DATE - INTERVAL '30 days'
                GROUP BY v.fecha_venta, g.gastos_dia
            ) as stats_diarias
        `);

        // Tendencia por día de la semana (cafeterías tienen patrones semanales)
        const tendenciaDiaSemana = await pool.query(`
            SELECT 
                EXTRACT(DOW FROM fecha_venta) as dia_semana,
                TO_CHAR(DATE '2023-01-01' + EXTRACT(DOW FROM fecha_venta) * INTERVAL '1 day', 'Day') as nombre_dia,
                AVG(total_dia) as promedio_ingresos,
                AVG(unidades_dia) as promedio_unidades,
                AVG(transacciones_dia) as promedio_transacciones,
                COUNT(*) as semanas_analizadas
            FROM (
                SELECT 
                    fecha_venta,
                    SUM(total) as total_dia,
                    SUM(cantidad) as unidades_dia,
                    COUNT(*) as transacciones_dia
                FROM ventas
                WHERE fecha_venta >= CURRENT_DATE - INTERVAL '60 days'
                GROUP BY fecha_venta
            ) as ventas_por_dia
            GROUP BY EXTRACT(DOW FROM fecha_venta)
            ORDER BY dia_semana
        `);

        // Predicción por producto (productos de cafetería)
        const prediccionesProductos = await pool.query(`
            SELECT 
                p.nombre,
                p.categoria,
                p.precio,
                COALESCE(AVG(ventas_diarias.unidades_dia), 0) as promedio_unidades_diarias,
                COALESCE(AVG(ventas_diarias.ingresos_dia), 0) as promedio_ingresos_diarios,
                COUNT(ventas_diarias.fecha_venta) as dias_con_ventas,
                CASE p.categoria
                    WHEN 'Bebidas Calientes' THEN '☕'
                    WHEN 'Bebidas Frías' THEN '🧃'
                    WHEN 'Panadería' THEN '🥐'
                    WHEN 'Comidas' THEN '🍽️'
                    WHEN 'Postres' THEN '🍰'
                    WHEN 'Tés e Infusiones' THEN '🫖'
                    ELSE '🍴'
                END as emoji,
                CASE 
                    WHEN COUNT(ventas_diarias.fecha_venta) >= 20 THEN 'Alta'
                    WHEN COUNT(ventas_diarias.fecha_venta) >= 10 THEN 'Media'
                    WHEN COUNT(ventas_diarias.fecha_venta) >= 5 THEN 'Baja'
                    ELSE 'Muy Baja'
                END as frecuencia_venta
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
            GROUP BY p.id, p.nombre, p.categoria, p.precio
            ORDER BY promedio_ingresos_diarias DESC NULLS LAST
            LIMIT 20
        `);

        const promedios = promediosDiarios.rows[0] || {
            promedio_ingresos_diarios: 0,
            promedio_unidades_diarias: 0,
            promedio_transacciones_diarias: 0,
            promedio_gastos_diarios: 0,
            promedio_ganancia_diaria: 0
        };

        // Calcular predicciones para próximos 7 días
        const prediccionesSemanales = {
            ingresosSemana: Math.round((parseFloat(promedios.promedio_ingresos_diarios) || 0) * 7),
            unidadesSemana: Math.round((parseFloat(promedios.promedio_unidades_diarias) || 0) * 7),
            transaccionesSemana: Math.round((parseFloat(promedios.promedio_transacciones_diarias) || 0) * 7),
            gastosSemana: Math.round((parseFloat(promedios.promedio_gastos_diarios) || 0) * 7),
            gananciaSemana: Math.round((parseFloat(promedios.promedio_ganancia_diaria) || 0) * 7)
        };

        // Predicciones mensuales
        const prediccionesMensuales = {
            ingresosMes: Math.round((parseFloat(promedios.promedio_ingresos_diarios) || 0) * 30),
            unidadesMes: Math.round((parseFloat(promedios.promedio_unidades_diarias) || 0) * 30),
            transaccionesMes: Math.round((parseFloat(promedios.promedio_transacciones_diarias) || 0) * 30),
            gastosMes: Math.round((parseFloat(promedios.promedio_gastos_diarios) || 0) * 30),
            gananciaMes: Math.round((parseFloat(promedios.promedio_ganancia_diaria) || 0) * 30)
        };

        // Recomendaciones específicas para cafetería
        const recomendaciones = [];
        
        if (prediccionesMensuales.gananciaMes < 0) {
            recomendaciones.push({
                tipo: 'warning',
                mensaje: 'Se proyectan pérdidas este mes. Revisar gastos y precios.',
                accion: 'Optimizar costos de ingredientes y revisar pricing'
            });
        }

        if (promedios.promedio_transacciones_diarias < 10) {
            recomendaciones.push({
                tipo: 'info',
                mensaje: 'Pocas transacciones diarias. Considerar promociones.',
                accion: 'Implementar combo desayunos o happy hours'
            });
        }

        if (promedios.promedio_ingresos_diarios > 0) {
            const proyeccionAnual = Math.round(promedios.promedio_ingresos_diarios * 365);
            recomendaciones.push({
                tipo: 'success',
                mensaje: `Proyección anual: ${proyeccionAnual.toLocaleString('es-CO')} COP`,
                accion: 'Mantener estrategia actual y explorar crecimiento'
            });
        }

        const response = {
            promediosDiarios: promedios,
            prediccionesSemanales,
            prediccionesMensuales,
            tendenciaPorDiaSemana: tendenciaDiaSemana.rows,
            prediccionesPorProducto: prediccionesProductos.rows,
            recomendaciones,
            metodologia: {
                descripcion: "Predicciones basadas en análisis de últimos 30 días",
                factores: ["Tendencias diarias", "Patrones semanales", "Categorías de productos", "Horario 6AM-12PM"],
                precision: "Estimativa - Sujeta a variaciones estacionales"
            },
            timestamp: new Date().toISOString()
        };

        console.log(`🔮 Predicciones generadas: ${response.prediccionesMensuales.ingresosMes} proyectados para el mes`);
        res.json(response);
    } catch (error) {
        console.error('❌ Error en getPredicciones:', error);
        res.status(500).json({ 
            error: 'Error al obtener predicciones de la cafetería',
            details: error.message 
        });
    }
}

// ==================== ANÁLISIS DE TENDENCIAS CAFETERÍA ====================
async function getTendencias(req, res) {
    try {
        console.log('📈 Analizando tendencias de la cafetería...');
        
        // Tendencias de los últimos 3 meses
        const tendenciasTrimestrales = await pool.query(`
            SELECT 
                DATE_TRUNC('month', v.fecha_venta) as mes,
                TO_CHAR(DATE_TRUNC('month', v.fecha_venta), 'Month YYYY') as mes_nombre,
                COUNT(*) as transacciones,
                SUM(v.cantidad) as unidades_vendidas,
                SUM(v.total) as ingresos,
                AVG(v.total) as ticket_promedio,
                COUNT(DISTINCT v.producto_id) as productos_vendidos,
                COUNT(DISTINCT v.fecha_venta) as dias_operacion,
                COALESCE(SUM(g.gastos_mes), 0) as gastos_totales,
                SUM(v.total) - COALESCE(SUM(g.gastos_mes), 0) as ganancia_neta
            FROM ventas v
            LEFT JOIN (
                SELECT 
                    DATE_TRUNC('month', fecha_gasto) as mes_gasto,
                    SUM(monto) as gastos_mes
                FROM gastos 
                WHERE activo = true 
                GROUP BY DATE_TRUNC('month', fecha_gasto)
            ) g ON DATE_TRUNC('month', v.fecha_venta) = g.mes_gasto
            WHERE v.fecha_venta >= CURRENT_DATE - INTERVAL '3 months'
            GROUP BY DATE_TRUNC('month', v.fecha_venta), g.gastos_mes
            ORDER BY mes
        `);

        // Crecimiento por categoría en los últimos 3 meses
        const crecimientoCategorias = await pool.query(`
            SELECT 
                p.categoria,
                COALESCE(SUM(v.cantidad), 0) as total_unidades,
                COALESCE(SUM(v.total), 0) as total_ingresos,
                COUNT(DISTINCT DATE_TRUNC('month', v.fecha_venta)) as meses_activos,
                AVG(v.total) as ticket_promedio,
                COUNT(DISTINCT p.id) as productos_categoria,
                CASE p.categoria
                    WHEN 'Bebidas Calientes' THEN '☕'
                    WHEN 'Bebidas Frías' THEN '🧃'
                    WHEN 'Panadería' THEN '🥐'
                    WHEN 'Comidas' THEN '🍽️'
                    WHEN 'Postres' THEN '🍰'
                    WHEN 'Tés e Infusiones' THEN '🫖'
                    ELSE '🍴'
                END as emoji,
                CASE 
                    WHEN COALESCE(SUM(v.total), 0) > 500000 THEN 'Excelente'
                    WHEN COALESCE(SUM(v.total), 0) > 200000 THEN 'Bueno'
                    WHEN COALESCE(SUM(v.total), 0) > 50000 THEN 'Regular'
                    ELSE 'Bajo'
                END as rendimiento
            FROM productos p
            LEFT JOIN ventas v ON p.id = v.producto_id 
                AND v.fecha_venta >= CURRENT_DATE - INTERVAL '3 months'
            WHERE p.activo = true
            GROUP BY p.categoria
            ORDER BY total_ingresos DESC
        `);

        // Horarios pico análisis detallado (6 AM - 12 PM)
        const horariosPico = await pool.query(`
            SELECT 
                EXTRACT(HOUR FROM hora_venta) as hora,
                TO_CHAR(CAST(EXTRACT(HOUR FROM hora_venta) || ':00' AS TIME), 'HH12:MI AM') as hora_formato,
                COUNT(*) as transacciones,
                SUM(cantidad) as unidades,
                SUM(total) as ingresos,
                AVG(total) as ticket_promedio,
                COUNT(DISTINCT fecha_venta) as dias_analizados,
                CASE 
                    WHEN EXTRACT(HOUR FROM hora_venta) BETWEEN 6 AND 7 THEN 'Apertura (6-7 AM)'
                    WHEN EXTRACT(HOUR FROM hora_venta) BETWEEN 8 AND 9 THEN 'Rush Matutino (8-9 AM)'
                    WHEN EXTRACT(HOUR FROM hora_venta) BETWEEN 10 AND 11 THEN 'Media Mañana (10-11 AM)'
                    WHEN EXTRACT(HOUR FROM hora_venta) = 11 THEN 'Pre-Cierre (11-12 PM)'
                    ELSE 'Fuera de Horario'
                END as periodo,
                ROUND((COUNT(*) * 100.0 / (SELECT COUNT(*) FROM ventas WHERE fecha_venta >= CURRENT_DATE - INTERVAL '30 days')), 2) as porcentaje_transacciones
            FROM ventas
            WHERE fecha_venta >= CURRENT_DATE - INTERVAL '30 days'
            AND EXTRACT(HOUR FROM hora_venta) BETWEEN 6 AND 11
            GROUP BY EXTRACT(HOUR FROM hora_venta)
            ORDER BY transacciones DESC
        `);

        // Productos estrella vs productos lentos
        const analisisProductos = await pool.query(`
            SELECT 
                p.nombre,
                p.categoria,
                p.precio,
                COALESCE(SUM(v.cantidad), 0) as unidades_vendidas,
                COALESCE(SUM(v.total), 0) as ingresos,
                COUNT(v.id) as transacciones,
                COUNT(DISTINCT v.fecha_venta) as dias_vendido,
                CASE 
                    WHEN COALESCE(SUM(v.cantidad), 0) >= 100 THEN 'Producto Estrella ⭐'
                    WHEN COALESCE(SUM(v.cantidad), 0) >= 50 THEN 'Producto Popular 👍'
                    WHEN COALESCE(SUM(v.cantidad), 0) >= 10 THEN 'Producto Regular ➡️'
                    WHEN COALESCE(SUM(v.cantidad), 0) > 0 THEN 'Producto Lento 🐌'
                    ELSE 'Sin Ventas ❌'
                END as clasificacion,
                ROUND((COALESCE(SUM(v.total), 0) / NULLIF((SELECT SUM(total) FROM ventas WHERE fecha_venta >= CURRENT_DATE - INTERVAL '30 days'), 0) * 100), 2) as porcentaje_ingresos
            FROM productos p
            LEFT JOIN ventas v ON p.id = v.producto_id 
                AND v.fecha_venta >= CURRENT_DATE - INTERVAL '30 days'
            WHERE p.activo = true
            GROUP BY p.id, p.nombre, p.categoria, p.precio
            ORDER BY unidades_vendidas DESC
        `);

        // Patrones de consumo por día de la semana
        const patronesDiaSemana = await pool.query(`
            SELECT 
                EXTRACT(DOW FROM fecha_venta) as dia_semana,
                TO_CHAR(fecha_venta, 'Day') as nombre_dia,
                COUNT(*) as transacciones,
                SUM(cantidad) as unidades,
                SUM(total) as ingresos,
                AVG(total) as ticket_promedio,
                COUNT(DISTINCT fecha_venta) as semanas_analizadas,
                CASE EXTRACT(DOW FROM fecha_venta)
                    WHEN 1 THEN 'Lunes - Inicio de semana'
                    WHEN 2 THEN 'Martes - Día activo'
                    WHEN 3 THEN 'Miércoles - Media semana'
                    WHEN 4 THEN 'Jueves - Pre-fin de semana'
                    WHEN 5 THEN 'Viernes - Fin de semana laboral'
                    WHEN 6 THEN 'Sábado - Fin de semana'
                    WHEN 0 THEN 'Domingo - Descanso'
                END as descripcion
            FROM ventas
            WHERE fecha_venta >= CURRENT_DATE - INTERVAL '60 days'
            GROUP BY EXTRACT(DOW FROM fecha_venta)
            ORDER BY dia_semana
        `);

        const response = {
            tendenciasTrimestrales: tendenciasTrimestrales.rows,
            crecimientoCategorias: crecimientoCategorias.rows,
            horariosPico: horariosPico.rows,
            analisisProductos: analisisProductos.rows,
            patronesDiaSemana: patronesDiaSemana.rows,
            insights: {
                mejor_categoria: crecimientoCategorias.rows[0] || null,
                hora_pico: horariosPico.rows[0] || null,
                producto_estrella: analisisProductos.rows[0] || null,
                mejor_dia: patronesDiaSemana.rows.reduce((max, dia) => dia.ingresos > max.ingresos ? dia : max, { ingresos: 0 })
            },
            recomendaciones_operativas: [
                "Enfocar inventario en horarios pico (8-9 AM)",
                "Promocionar productos lentos en horarios de menor demanda",
                "Optimizar staff durante rush matutino",
                "Considerar horarios extendidos si la demanda pre-cierre es alta"
            ],
            timestamp: new Date().toISOString()
        };

        console.log(`📊 Análisis de tendencias completado: ${response.analisisProductos.length} productos analizados`);
        res.json(response);
    } catch (error) {
        console.error('❌ Error en getTendencias:', error);
        res.status(500).json({ 
            error: 'Error al obtener tendencias de la cafetería',
            details: error.message 
        });
    }
}

// ==================== REPORTES COMPARATIVOS CAFETERÍA ====================
async function getComparativo(req, res) {
    try {
        const { tipo = 'mensual', periodo1, periodo2 } = req.query;
        console.log(`📊 Generando reporte comparativo: ${tipo}`);

        let query1, query2, params1 = [], params2 = [];

        if (tipo === 'mensual') {
            // Comparar mes actual vs mes anterior
            query1 = `
                SELECT 
                    COUNT(*) as transacciones,
                    SUM(cantidad) as unidades,
                    SUM(total) as ingresos,
                    AVG(total) as ticket_promedio,
                    COUNT(DISTINCT producto_id) as productos_vendidos,
                    COUNT(DISTINCT fecha_venta) as dias_operacion,
                    MIN(fecha_venta) as primer_dia,
                    MAX(fecha_venta) as ultimo_dia
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
                    COUNT(DISTINCT producto_id) as productos_vendidos,
                    COUNT(DISTINCT fecha_venta) as dias_operacion,
                    MIN(fecha_venta) as primer_dia,
                    MAX(fecha_venta) as ultimo_dia
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
                    AVG(total) as ticket_promedio,
                    COUNT(DISTINCT producto_id) as productos_vendidos,
                    MIN(hora_venta) as primera_venta,
                    MAX(hora_venta) as ultima_venta
                FROM ventas
                WHERE fecha_venta >= CURRENT_DATE - EXTRACT(DOW FROM CURRENT_DATE)::integer
                AND fecha_venta <= CURRENT_DATE
            `;

            query2 = `
                SELECT 
                    COUNT(*) as transacciones,
                    SUM(cantidad) as unidades,
                    SUM(total) as ingresos,
                    AVG(total) as ticket_promedio,
                    COUNT(DISTINCT producto_id) as productos_vendidos,
                    MIN(hora_venta) as primera_venta,
                    MAX(hora_venta) as ultima_venta
                FROM ventas
                WHERE fecha_venta >= CURRENT_DATE - EXTRACT(DOW FROM CURRENT_DATE)::integer - 7
                AND fecha_venta <= CURRENT_DATE - EXTRACT(DOW FROM CURRENT_DATE)::integer - 1
            `;
        }

        const [resultado1, resultado2] = await Promise.all([
            pool.query(query1, params1),
            pool.query(query2, params2)
        ]);

        const datos1 = resultado1.rows[0] || {};
        const datos2 = resultado2.rows[0] || {};

        // Calcular variaciones porcentuales
        const calcularVariacion = (actual, anterior) => {
            if (!anterior || anterior === 0) return actual > 0 ? 100 : 0;
            return parseFloat(((actual - anterior) / anterior * 100).toFixed(2));
        };

        const calcularTendencia = (variacion) => {
            if (variacion > 10) return 'Crecimiento fuerte 📈';
            if (variacion > 0) return 'Crecimiento moderado 📊';
            if (variacion === 0) return 'Estable ➡️';
            if (variacion > -10) return 'Declive moderado 📉';
            return 'Declive fuerte 📉';
        };

        // Análisis comparativo por categorías (solo para mensual)
        let comparacionCategorias = null;
        if (tipo === 'mensual') {
            comparacionCategorias = await pool.query(`
                SELECT 
                    p.categoria,
                    SUM(CASE WHEN EXTRACT(MONTH FROM v.fecha_venta) = EXTRACT(MONTH FROM CURRENT_DATE) 
                             AND EXTRACT(YEAR FROM v.fecha_venta) = EXTRACT(YEAR FROM CURRENT_DATE) 
                             THEN v.total ELSE 0 END) as ingresos_actual,
                    SUM(CASE WHEN v.fecha_venta >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month'
                             AND v.fecha_venta < DATE_TRUNC('month', CURRENT_DATE)
                             THEN v.total ELSE 0 END) as ingresos_anterior
                FROM productos p
                LEFT JOIN ventas v ON p.id = v.producto_id
                WHERE v.fecha_venta >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month'
                GROUP BY p.categoria
                ORDER BY ingresos_actual DESC
            `);
        }

        const comparacion = {
            transacciones: {
                actual: parseInt(datos1.transacciones) || 0,
                anterior: parseInt(datos2.transacciones) || 0,
                variacion: calcularVariacion(datos1.transacciones, datos2.transacciones),
                tendencia: calcularTendencia(calcularVariacion(datos1.transacciones, datos2.transacciones))
            },
            unidades: {
                actual: parseInt(datos1.unidades) || 0,
                anterior: parseInt(datos2.unidades) || 0,
                variacion: calcularVariacion(datos1.unidades, datos2.unidades),
                tendencia: calcularTendencia(calcularVariacion(datos1.unidades, datos2.unidades))
            },
            ingresos: {
                actual: parseFloat(datos1.ingresos) || 0,
                anterior: parseFloat(datos2.ingresos) || 0,
                variacion: calcularVariacion(datos1.ingresos, datos2.ingresos),
                tendencia: calcularTendencia(calcularVariacion(datos1.ingresos, datos2.ingresos))
            },
            ticketPromedio: {
                actual: parseFloat(datos1.ticket_promedio) || 0,
                anterior: parseFloat(datos2.ticket_promedio) || 0,
                variacion: calcularVariacion(datos1.ticket_promedio, datos2.ticket_promedio),
                tendencia: calcularTendencia(calcularVariacion(datos1.ticket_promedio, datos2.ticket_promedio))
            },
            productosVendidos: {
                actual: parseInt(datos1.productos_vendidos) || 0,
                anterior: parseInt(datos2.productos_vendidos) || 0,
                variacion: calcularVariacion(datos1.productos_vendidos, datos2.productos_vendidos)
            }
        };

        // Generar insights automáticos
        const insights = [];
        
        if (comparacion.ingresos.variacion > 15) {
            insights.push("🎉 Excelente crecimiento en ingresos. La cafetería está en expansión.");
        } else if (comparacion.ingresos.variacion < -15) {
            insights.push("⚠️ Caída significativa en ingresos. Revisar estrategia de precios y promociones.");
        }

        if (comparacion.ticketPromedio.variacion > 10) {
            insights.push("💰 El ticket promedio ha aumentado. Los clientes gastan más por visita.");
        } else if (comparacion.ticketPromedio.variacion < -10) {
            insights.push("📉 El ticket promedio ha bajado. Considerar combos o upselling.");
        }

        if (comparacion.transacciones.variacion > comparacion.ingresos.variacion) {
            insights.push("👥 Más clientes pero menor gasto promedio. Oportunidad de aumentar ticket.");
        }

        const response = {
            tipo,
            periodo_actual: tipo === 'mensual' ? 'Este mes' : 'Esta semana',
            periodo_anterior: tipo === 'mensual' ? 'Mes anterior' : 'Semana anterior',
            comparacion,
            categorias: comparacionCategorias ? comparacionCategorias.rows : null,
            insights,
            recomendaciones: [
                comparacion.ingresos.variacion < 0 ? "Implementar promociones especiales" : "Mantener estrategia actual",
                comparacion.ticketPromedio.variacion < 0 ? "Crear combos atractivos" : "Explorar productos premium",
                "Analizar horarios pico para optimizar staff"
            ],
            cafeteria_context: {
                horario: "6:00 AM - 12:00 PM",
                enfoque: "Desayunos y media mañana",
                productos_clave: "Café, panadería, jugos naturales"
            },
            timestamp: new Date().toISOString()
        };

        console.log(`📈 Comparativo ${tipo} generado: ${response.comparacion.ingresos.variacion}% variación en ingresos`);
        res.json(response);
    } catch (error) {
        console.error('❌ Error en getComparativo:', error);
        res.status(500).json({ 
            error: 'Error al obtener reporte comparativo de la cafetería',
            details: error.message 
        });
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