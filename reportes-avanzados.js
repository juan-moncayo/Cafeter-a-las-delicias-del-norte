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
        
        // Estadísticas del día actual - Consulta segura
        const hoyStats = await pool.query(`
            SELECT 
                COALESCE(COUNT(*), 0)::integer as transacciones_hoy,
                COALESCE(SUM(cantidad), 0)::integer as unidades_hoy,
                COALESCE(SUM(total), 0)::numeric as ingresos_hoy,
                COALESCE(COUNT(DISTINCT producto_id), 0)::integer as productos_vendidos_hoy,
                COALESCE(AVG(total), 0)::numeric as ticket_promedio,
                MIN(hora_venta) as primera_venta,
                MAX(hora_venta) as ultima_venta
            FROM ventas 
            WHERE fecha_venta = CURRENT_DATE
        `);

        // Gastos del día actual
        const gastosHoy = await pool.query(`
            SELECT 
                COALESCE(SUM(monto), 0)::numeric as gastos_hoy
            FROM gastos 
            WHERE fecha_gasto = CURRENT_DATE AND activo = true
        `);

        // Estadísticas de ayer para comparación
        const ayerStats = await pool.query(`
            SELECT 
                COALESCE(COUNT(*), 0)::integer as transacciones_ayer,
                COALESCE(SUM(cantidad), 0)::integer as unidades_ayer,
                COALESCE(SUM(total), 0)::numeric as ingresos_ayer
            FROM ventas 
            WHERE fecha_venta = CURRENT_DATE - INTERVAL '1 day'
        `);

        // Gastos de ayer
        const gastosAyer = await pool.query(`
            SELECT 
                COALESCE(SUM(monto), 0)::numeric as gastos_ayer
            FROM gastos 
            WHERE fecha_gasto = CURRENT_DATE - INTERVAL '1 day' AND activo = true
        `);

        // Top productos del mes (simplificado y seguro)
        const topProductos = await pool.query(`
            SELECT 
                p.nombre,
                p.categoria,
                p.precio,
                COALESCE(SUM(v.cantidad), 0)::integer as total_cantidad,
                COALESCE(SUM(v.total), 0)::numeric as total_ingresos,
                COALESCE(COUNT(v.id), 0)::integer as total_transacciones,
                COALESCE(AVG(v.total), 0)::numeric as ticket_promedio
            FROM productos p
            LEFT JOIN ventas v ON p.id = v.producto_id 
                AND v.fecha_venta >= DATE_TRUNC('month', CURRENT_DATE)
            WHERE p.activo = true
            GROUP BY p.id, p.nombre, p.categoria, p.precio
            ORDER BY total_ingresos DESC
            LIMIT 8
        `);

        // Tendencia últimos 7 días (simplificado)
        const tendencia7Dias = await pool.query(`
            SELECT 
                fecha_venta,
                COALESCE(COUNT(*), 0)::integer as transacciones,
                COALESCE(SUM(cantidad), 0)::integer as unidades,
                COALESCE(SUM(total), 0)::numeric as ingresos
            FROM ventas
            WHERE fecha_venta >= CURRENT_DATE - INTERVAL '6 days'
            AND fecha_venta <= CURRENT_DATE
            GROUP BY fecha_venta
            ORDER BY fecha_venta
        `);

        // Construir respuesta segura
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
                ticket_promedio: parseFloat(hoyData.ticket_promedio) || 0,
                gastos_hoy: parseFloat(gastosHoyData.gastos_hoy) || 0,
                ganancia_neta_hoy: (parseFloat(hoyData.ingresos_hoy) || 0) - (parseFloat(gastosHoyData.gastos_hoy) || 0),
                primera_venta: hoyData.primera_venta,
                ultima_venta: hoyData.ultima_venta
            },
            ayer: {
                transacciones_ayer: parseInt(ayerData.transacciones_ayer) || 0,
                unidades_ayer: parseInt(ayerData.unidades_ayer) || 0,
                ingresos_ayer: parseFloat(ayerData.ingresos_ayer) || 0,
                gastos_ayer: parseFloat(gastosAyerData.gastos_ayer) || 0,
                ganancia_neta_ayer: (parseFloat(ayerData.ingresos_ayer) || 0) - (parseFloat(gastosAyerData.gastos_ayer) || 0)
            },
            topProductos: topProductos.rows,
            tendencia30Dias: tendencia7Dias.rows, // Usando 7 días por simplicidad
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
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

// ==================== REPORTE SEMANAL CAFETERÍA ====================
async function getReporteSemanal(req, res) {
    try {
        const { fecha } = req.query;
        console.log(`📅 Generando reporte semanal desde: ${fecha || 'HOY'}`);

        let fechaFinal = fecha ? new Date(fecha) : new Date();
        let fechaInicio = new Date(fechaFinal);
        fechaInicio.setDate(fechaInicio.getDate() - 6);

        // Ventas por día de la semana - Consulta segura
        const ventasSemana = await pool.query(`
            SELECT 
                fecha_venta,
                EXTRACT(DOW FROM fecha_venta)::integer as dia_semana,
                TO_CHAR(fecha_venta, 'Day') as nombre_dia,
                TO_CHAR(fecha_venta, 'DD/MM') as fecha_corta,
                COALESCE(COUNT(*), 0)::integer as transacciones,
                COALESCE(SUM(cantidad), 0)::integer as unidades_vendidas,
                COALESCE(SUM(total), 0)::numeric as ingresos,
                COALESCE(AVG(total), 0)::numeric as ticket_promedio,
                COALESCE(COUNT(DISTINCT producto_id), 0)::integer as productos_diferentes
            FROM ventas
            WHERE fecha_venta >= $1::date AND fecha_venta <= $2::date
            GROUP BY fecha_venta, EXTRACT(DOW FROM fecha_venta)
            ORDER BY fecha_venta
        `, [fechaInicio.toISOString().split('T')[0], fechaFinal.toISOString().split('T')[0]]);

        // Top productos de la semana (simplificado)
        const topProductosSemana = await pool.query(`
            SELECT 
                p.nombre,
                p.categoria,
                p.precio,
                COALESCE(SUM(v.cantidad), 0)::integer as unidades_vendidas,
                COALESCE(SUM(v.total), 0)::numeric as ingresos_totales,
                COALESCE(COUNT(v.id), 0)::integer as transacciones,
                COALESCE(AVG(v.precio_unitario), 0)::numeric as precio_promedio
            FROM productos p
            LEFT JOIN ventas v ON p.id = v.producto_id
                AND v.fecha_venta >= $1::date AND v.fecha_venta <= $2::date
            WHERE p.activo = true
            GROUP BY p.id, p.nombre, p.categoria, p.precio
            HAVING SUM(v.cantidad) > 0
            ORDER BY ingresos_totales DESC
            LIMIT 10
        `, [fechaInicio.toISOString().split('T')[0], fechaFinal.toISOString().split('T')[0]]);

        const response = {
            periodo: {
                inicio: fechaInicio.toISOString().split('T')[0],
                fin: fechaFinal.toISOString().split('T')[0]
            },
            ventasPorDia: ventasSemana.rows,
            topProductos: topProductosSemana.rows,
            horariosPico: [], // Simplificado por ahora
            comparacionSemanaAnterior: {
                transacciones_anterior: 0,
                unidades_anterior: 0,
                ingresos_anterior: 0,
                ticket_promedio_anterior: 0
            },
            resumen: {
                dias_operacion: ventasSemana.rows.length,
                mejor_dia: ventasSemana.rows.reduce((max, dia) => {
                    const ingresosMax = parseFloat(max.ingresos) || 0;
                    const ingresosActual = parseFloat(dia.ingresos) || 0;
                    return ingresosActual > ingresosMax ? dia : max;
                }, { ingresos: 0 }),
                peor_dia: ventasSemana.rows.reduce((min, dia) => {
                    const ingresosMin = parseFloat(min.ingresos) || 999999;
                    const ingresosActual = parseFloat(dia.ingresos) || 0;
                    return ingresosActual < ingresosMin ? dia : min;
                }, { ingresos: 999999 })
            },
            timestamp: new Date().toISOString()
        };

        console.log(`📈 Reporte semanal generado: ${response.ventasPorDia.length} días analizados`);
        res.json(response);

    } catch (error) {
        console.error('❌ Error en getReporteSemanal:', error);
        res.status(500).json({ 
            error: 'Error al obtener reporte semanal de la cafetería',
            details: error.message,
            timestamp: new Date().toISOString()
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

        // Ventas por día del mes - Consulta segura
        const ventasDelMes = await pool.query(`
            SELECT 
                fecha_venta,
                EXTRACT(DAY FROM fecha_venta)::integer as dia,
                TO_CHAR(fecha_venta, 'Day') as dia_semana,
                COALESCE(COUNT(*), 0)::integer as transacciones,
                COALESCE(SUM(cantidad), 0)::integer as unidades_vendidas,
                COALESCE(SUM(total), 0)::numeric as ingresos,
                COALESCE(AVG(total), 0)::numeric as ticket_promedio
            FROM ventas
            WHERE EXTRACT(MONTH FROM fecha_venta) = $1
            AND EXTRACT(YEAR FROM fecha_venta) = $2
            GROUP BY fecha_venta
            ORDER BY fecha_venta
        `, [mesActual, añoActual]);

        const response = {
            periodo: {
                mes: mesActual,
                año: añoActual,
                nombre_mes: new Date(añoActual, mesActual - 1).toLocaleDateString('es-CO', { 
                    month: 'long', 
                    year: 'numeric' 
                })
            },
            ventasPorDia: ventasDelMes.rows,
            topProductos: [], // Simplificado
            categorias: [], // Simplificado
            comparacionMesAnterior: {
                transacciones_anterior: 0,
                unidades_anterior: 0,
                ingresos_anterior: 0,
                ticket_promedio_anterior: 0
            },
            estadisticas: {
                dias_operacion: ventasDelMes.rows.length,
                mejor_dia: ventasDelMes.rows.reduce((max, dia) => {
                    const ingresosMax = parseFloat(max.ingresos) || 0;
                    const ingresosActual = parseFloat(dia.ingresos) || 0;
                    return ingresosActual > ingresosMax ? dia : max;
                }, { ingresos: 0 }),
                dia_mas_transacciones: ventasDelMes.rows.reduce((max, dia) => {
                    const transaccionesMax = parseInt(max.transacciones) || 0;
                    const transaccionesActual = parseInt(dia.transacciones) || 0;
                    return transaccionesActual > transaccionesMax ? dia : max;
                }, { transacciones: 0 })
            },
            timestamp: new Date().toISOString()
        };

        console.log(`📊 Reporte mensual generado: ${response.ventasPorDia.length} días`);
        res.json(response);

    } catch (error) {
        console.error('❌ Error en getReporteMensual:', error);
        res.status(500).json({ 
            error: 'Error al obtener reporte mensual de la cafetería',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

// ==================== PREDICCIONES INTELIGENTES CAFETERÍA ====================
async function getPredicciones(req, res) {
    try {
        console.log('🔮 Generando predicciones para la cafetería...');
        
        // Predicción basada en promedios de últimos 7 días
        const promediosDiarios = await pool.query(`
            SELECT 
                COALESCE(AVG(ingresos_dia), 0)::numeric as promedio_ingresos_diarios,
                COALESCE(AVG(unidades_dia), 0)::numeric as promedio_unidades_diarias,
                COALESCE(AVG(transacciones_dia), 0)::numeric as promedio_transacciones_diarias,
                COUNT(*) as dias_analizados
            FROM (
                SELECT 
                    fecha_venta,
                    SUM(total) as ingresos_dia,
                    SUM(cantidad) as unidades_dia,
                    COUNT(*) as transacciones_dia
                FROM ventas
                WHERE fecha_venta >= CURRENT_DATE - INTERVAL '6 days'
                AND fecha_venta <= CURRENT_DATE
                GROUP BY fecha_venta
            ) as stats_diarias
        `);

        // Tendencia por día de la semana (simplificado)
        const tendenciaDiaSemana = await pool.query(`
            SELECT 
                EXTRACT(DOW FROM fecha_venta)::integer as dia_semana,
                TO_CHAR(DATE '2023-01-01' + EXTRACT(DOW FROM fecha_venta) * INTERVAL '1 day', 'Day') as nombre_dia,
                COALESCE(AVG(total_dia), 0)::numeric as promedio_ingresos,
                COALESCE(AVG(unidades_dia), 0)::numeric as promedio_unidades,
                COUNT(*) as dias_analizados
            FROM (
                SELECT 
                    fecha_venta,
                    SUM(total) as total_dia,
                    SUM(cantidad) as unidades_dia
                FROM ventas
                WHERE fecha_venta >= CURRENT_DATE - INTERVAL '13 days'
                GROUP BY fecha_venta
            ) as ventas_por_dia
            GROUP BY EXTRACT(DOW FROM fecha_venta)
            ORDER BY dia_semana
        `);

        const promedios = promediosDiarios.rows[0] || {
            promedio_ingresos_diarios: 0,
            promedio_unidades_diarias: 0,
            promedio_transacciones_diarias: 0,
            dias_analizados: 0
        };

        // Calcular predicciones para próximos 7 días
        const prediccionesSemanales = {
            ingresosSemana: Math.round((parseFloat(promedios.promedio_ingresos_diarios) || 0) * 7),
            unidadesSemana: Math.round((parseFloat(promedios.promedio_unidades_diarias) || 0) * 7),
            transaccionesSemana: Math.round((parseFloat(promedios.promedio_transacciones_diarias) || 0) * 7)
        };

        // Predicciones mensuales
        const prediccionesMensuales = {
            ingresosMes: Math.round((parseFloat(promedios.promedio_ingresos_diarios) || 0) * 30),
            unidadesMes: Math.round((parseFloat(promedios.promedio_unidades_diarias) || 0) * 30),
            transaccionesMes: Math.round((parseFloat(promedios.promedio_transacciones_diarias) || 0) * 30)
        };

        // Generar recomendaciones básicas
        const recomendaciones = [];
        
        const diasAnalizados = parseInt(promedios.dias_analizados) || 0;
        const ingresosDiarios = parseFloat(promedios.promedio_ingresos_diarios) || 0;
        
        if (diasAnalizados === 0) {
            recomendaciones.push({
                tipo: 'info',
                mensaje: 'Sistema recién configurado. Acumule datos para predicciones más precisas.',
                accion: 'Registrar ventas diariamente para generar tendencias'
            });
        } else if (ingresosDiarios < 50000) {
            recomendaciones.push({
                tipo: 'warning',
                mensaje: 'Ingresos diarios por debajo del promedio esperado para una cafetería.',
                accion: 'Considerar promociones o ampliar horarios'
            });
        } else {
            recomendaciones.push({
                tipo: 'success',
                mensaje: `Tendencia positiva con $${Math.round(ingresosDiarios).toLocaleString('es-CO')} promedio diario`,
                accion: 'Mantener estrategia actual'
            });
        }

        const response = {
            promediosDiarios: promedios,
            prediccionesSemanales,
            prediccionesMensuales,
            tendenciaPorDiaSemana: tendenciaDiaSemana.rows,
            prediccionesPorProducto: [], // Simplificado
            recomendaciones,
            metodologia: {
                descripcion: `Predicciones basadas en análisis de últimos ${diasAnalizados} días`,
                factores: ["Tendencias diarias", "Patrones semanales", "Horario 6AM-12PM"],
                precision: "Estimativa - Mayor precisión con más datos históricos"
            },
            timestamp: new Date().toISOString()
        };

        console.log(`🔮 Predicciones generadas: $${response.prediccionesMensuales.ingresosMes} proyectados para el mes`);
        res.json(response);

    } catch (error) {
        console.error('❌ Error en getPredicciones:', error);
        res.status(500).json({ 
            error: 'Error al obtener predicciones de la cafetería',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

// ==================== ANÁLISIS DE TENDENCIAS CAFETERÍA ====================
async function getTendencias(req, res) {
    try {
        console.log('📈 Analizando tendencias de la cafetería...');
        
        // Tendencias simples de los últimos 14 días
        const tendenciasSimples = await pool.query(`
            SELECT 
                fecha_venta,
                COALESCE(COUNT(*), 0)::integer as transacciones,
                COALESCE(SUM(cantidad), 0)::integer as unidades_vendidas,
                COALESCE(SUM(total), 0)::numeric as ingresos,
                COALESCE(AVG(total), 0)::numeric as ticket_promedio
            FROM ventas
            WHERE fecha_venta >= CURRENT_DATE - INTERVAL '13 days'
            GROUP BY fecha_venta
            ORDER BY fecha_venta
        `);

        // Análisis por categorías (simplificado)
        const categoriasTendencias = await pool.query(`
            SELECT 
                p.categoria,
                COALESCE(COUNT(v.id), 0)::integer as transacciones,
                COALESCE(SUM(v.cantidad), 0)::integer as unidades,
                COALESCE(SUM(v.total), 0)::numeric as ingresos,
                COALESCE(AVG(v.total), 0)::numeric as ticket_promedio
            FROM productos p
            LEFT JOIN ventas v ON p.id = v.producto_id 
                AND v.fecha_venta >= CURRENT_DATE - INTERVAL '6 days'
            WHERE p.activo = true
            GROUP BY p.categoria
            ORDER BY ingresos DESC
        `);

        // Productos estrella vs productos lentos (simplificado)
        const analisisProductos = await pool.query(`
            SELECT 
                p.nombre,
                p.categoria,
                p.precio,
                COALESCE(SUM(v.cantidad), 0)::integer as unidades_vendidas,
                COALESCE(SUM(v.total), 0)::numeric as ingresos,
                COALESCE(COUNT(v.id), 0)::integer as transacciones,
                CASE 
                    WHEN COALESCE(SUM(v.cantidad), 0) >= 20 THEN 'Producto Estrella ⭐'
                    WHEN COALESCE(SUM(v.cantidad), 0) >= 10 THEN 'Producto Popular 👍'
                    WHEN COALESCE(SUM(v.cantidad), 0) >= 5 THEN 'Producto Regular ➡️'
                    WHEN COALESCE(SUM(v.cantidad), 0) > 0 THEN 'Producto Lento 🐌'
                    ELSE 'Sin Ventas ❌'
                END as clasificacion
            FROM productos p
            LEFT JOIN ventas v ON p.id = v.producto_id 
                AND v.fecha_venta >= CURRENT_DATE - INTERVAL '6 days'
            WHERE p.activo = true
            GROUP BY p.id, p.nombre, p.categoria, p.precio
            ORDER BY unidades_vendidas DESC
        `);

        const response = {
            tendenciasTrimestrales: tendenciasSimples.rows,
            crecimientoCategorias: categoriasTendencias.rows,
            horariosPico: [], // Simplificado
            analisisProductos: analisisProductos.rows,
            patronesDiaSemana: [], // Simplificado
            insights: {
                mejor_categoria: categoriasTendencias.rows[0] || null,
                hora_pico: null,
                producto_estrella: analisisProductos.rows[0] || null,
                mejor_dia: tendenciasSimples.rows.reduce((max, dia) => {
                    const ingresosMax = parseFloat(max.ingresos) || 0;
                    const ingresosActual = parseFloat(dia.ingresos) || 0;
                    return ingresosActual > ingresosMax ? dia : max;
                }, { ingresos: 0 })
            },
            recomendaciones_operativas: [
                "Sistema en configuración inicial - Recopilando datos",
                "Revisar tendencias semanalmente para insights detallados",
                "Enfocar en productos estrella para maximizar ingresos",
                "Considerar promociones para productos lentos"
            ],
            timestamp: new Date().toISOString()
        };

        console.log(`📊 Análisis de tendencias completado: ${response.analisisProductos.length} productos analizados`);
        res.json(response);

    } catch (error) {
        console.error('❌ Error en getTendencias:', error);
        res.status(500).json({ 
            error: 'Error al obtener tendencias de la cafetería',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

// ==================== REPORTES COMPARATIVOS CAFETERÍA ====================
async function getComparativo(req, res) {
    try {
        const { tipo = 'mensual' } = req.query;
        console.log(`📊 Generando reporte comparativo: ${tipo}`);

        let queryActual, queryAnterior;
        let parametrosActual = [], parametrosAnterior = [];

        if (tipo === 'mensual') {
            // Comparar mes actual vs mes anterior
            queryActual = `
                SELECT 
                    COALESCE(COUNT(*), 0)::integer as transacciones,
                    COALESCE(SUM(cantidad), 0)::integer as unidades,
                    COALESCE(SUM(total), 0)::numeric as ingresos,
                    COALESCE(AVG(total), 0)::numeric as ticket_promedio,
                    COALESCE(COUNT(DISTINCT producto_id), 0)::integer as productos_vendidos,
                    COALESCE(COUNT(DISTINCT fecha_venta), 0)::integer as dias_operacion
                FROM ventas
                WHERE EXTRACT(MONTH FROM fecha_venta) = EXTRACT(MONTH FROM CURRENT_DATE)
                AND EXTRACT(YEAR FROM fecha_venta) = EXTRACT(YEAR FROM CURRENT_DATE)
            `;

            queryAnterior = `
                SELECT 
                    COALESCE(COUNT(*), 0)::integer as transacciones,
                    COALESCE(SUM(cantidad), 0)::integer as unidades,
                    COALESCE(SUM(total), 0)::numeric as ingresos,
                    COALESCE(AVG(total), 0)::numeric as ticket_promedio,
                    COALESCE(COUNT(DISTINCT producto_id), 0)::integer as productos_vendidos,
                    COALESCE(COUNT(DISTINCT fecha_venta), 0)::integer as dias_operacion
                FROM ventas
                WHERE fecha_venta >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month'
                AND fecha_venta < DATE_TRUNC('month', CURRENT_DATE)
            `;
        } else {
            // Comparar semana actual vs semana anterior
            queryActual = `
                SELECT 
                    COALESCE(COUNT(*), 0)::integer as transacciones,
                    COALESCE(SUM(cantidad), 0)::integer as unidades,
                    COALESCE(SUM(total), 0)::numeric as ingresos,
                    COALESCE(AVG(total), 0)::numeric as ticket_promedio,
                    COALESCE(COUNT(DISTINCT producto_id), 0)::integer as productos_vendidos
                FROM ventas
                WHERE fecha_venta >= CURRENT_DATE - 6
                AND fecha_venta <= CURRENT_DATE
            `;

            queryAnterior = `
                SELECT 
                    COALESCE(COUNT(*), 0)::integer as transacciones,
                    COALESCE(SUM(cantidad), 0)::integer as unidades,
                    COALESCE(SUM(total), 0)::numeric as ingresos,
                    COALESCE(AVG(total), 0)::numeric as ticket_promedio,
                    COALESCE(COUNT(DISTINCT producto_id), 0)::integer as productos_vendidos
                FROM ventas
                WHERE fecha_venta >= CURRENT_DATE - 13
                AND fecha_venta <= CURRENT_DATE - 7
            `;
        }

        const [resultadoActual, resultadoAnterior] = await Promise.all([
            pool.query(queryActual, parametrosActual),
            pool.query(queryAnterior, parametrosAnterior)
        ]);

        const datosActuales = resultadoActual.rows[0] || {};
        const datosAnteriores = resultadoAnterior.rows[0] || {};

        // Calcular variaciones porcentuales de forma segura
        const calcularVariacion = (actual, anterior) => {
            const valorActual = parseFloat(actual) || 0;
            const valorAnterior = parseFloat(anterior) || 0;
            
            if (valorAnterior === 0) return valorActual > 0 ? 100 : 0;
            return parseFloat(((valorActual - valorAnterior) / valorAnterior * 100).toFixed(2));
        };

        const calcularTendencia = (variacion) => {
            if (variacion > 10) return 'Crecimiento fuerte 📈';
            if (variacion > 0) return 'Crecimiento moderado 📊';
            if (variacion === 0) return 'Estable ➡️';
            if (variacion > -10) return 'Declive moderado 📉';
            return 'Declive fuerte 📉';
        };

        const comparacion = {
            transacciones: {
                actual: parseInt(datosActuales.transacciones) || 0,
                anterior: parseInt(datosAnteriores.transacciones) || 0,
                variacion: calcularVariacion(datosActuales.transacciones, datosAnteriores.transacciones),
                tendencia: calcularTendencia(calcularVariacion(datosActuales.transacciones, datosAnteriores.transacciones))
            },
            unidades: {
                actual: parseInt(datosActuales.unidades) || 0,
                anterior: parseInt(datosAnteriores.unidades) || 0,
                variacion: calcularVariacion(datosActuales.unidades, datosAnteriores.unidades),
                tendencia: calcularTendencia(calcularVariacion(datosActuales.unidades, datosAnteriores.unidades))
            },
            ingresos: {
                actual: parseFloat(datosActuales.ingresos) || 0,
                anterior: parseFloat(datosAnteriores.ingresos) || 0,
                variacion: calcularVariacion(datosActuales.ingresos, datosAnteriores.ingresos),
                tendencia: calcularTendencia(calcularVariacion(datosActuales.ingresos, datosAnteriores.ingresos))
            },
            ticketPromedio: {
                actual: parseFloat(datosActuales.ticket_promedio) || 0,
                anterior: parseFloat(datosAnteriores.ticket_promedio) || 0,
                variacion: calcularVariacion(datosActuales.ticket_promedio, datosAnteriores.ticket_promedio),
                tendencia: calcularTendencia(calcularVariacion(datosActuales.ticket_promedio, datosAnteriores.ticket_promedio))
            },
            productosVendidos: {
                actual: parseInt(datosActuales.productos_vendidos) || 0,
                anterior: parseInt(datosAnteriores.productos_vendidos) || 0,
                variacion: calcularVariacion(datosActuales.productos_vendidos, datosAnteriores.productos_vendidos)
            }
        };

        // Generar insights automáticos
        const insights = [];
        
        if (comparacion.ingresos.variacion > 15) {
            insights.push("🎉 Excelente crecimiento en ingresos. La cafetería está en expansión.");
        } else if (comparacion.ingresos.variacion < -15) {
            insights.push("⚠️ Caída significativa en ingresos. Revisar estrategia de precios y promociones.");
        } else if (Math.abs(comparacion.ingresos.variacion) <= 5) {
            insights.push("📊 Ingresos estables. Buen mantenimiento del rendimiento.");
        }

        if (comparacion.ticketPromedio.variacion > 10) {
            insights.push("💰 El ticket promedio ha aumentado. Los clientes gastan más por visita.");
        } else if (comparacion.ticketPromedio.variacion < -10) {
            insights.push("📉 El ticket promedio ha bajado. Considerar combos o estrategias de upselling.");
        }

        if (comparacion.transacciones.variacion > comparacion.ingresos.variacion + 5) {
            insights.push("👥 Más clientes pero menor gasto promedio. Oportunidad de aumentar ticket promedio.");
        }

        // Si no hay insights significativos, agregar uno general
        if (insights.length === 0) {
            insights.push("📈 Rendimiento normal. Continuar monitoreando tendencias para optimizar.");
        }

        const response = {
            tipo,
            periodo_actual: tipo === 'mensual' ? 'Este mes' : 'Esta semana',
            periodo_anterior: tipo === 'mensual' ? 'Mes anterior' : 'Semana anterior',
            comparacion,
            categorias: null, // Simplificado
            insights,
            recomendaciones: [
                comparacion.ingresos.variacion < 0 ? 
                    "Implementar promociones especiales para recuperar ingresos" : 
                    "Mantener estrategia actual que está funcionando bien",
                comparacion.ticketPromedio.variacion < 0 ? 
                    "Crear combos atractivos para aumentar ticket promedio" : 
                    "Explorar productos premium para seguir creciendo",
                "Analizar horarios pico para optimizar personal y inventario"
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
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

// ==================== FUNCIONES DE UTILIDAD ====================

// Función para validar conexión de base de datos
async function validarConexionBD() {
    try {
        await pool.query('SELECT NOW() as tiempo_servidor');
        console.log('✅ Conexión a base de datos validada correctamente');
        return true;
    } catch (error) {
        console.error('❌ Error de conexión a base de datos:', error.message);
        return false;
    }
}

// Función para limpiar y validar parámetros de fecha
function validarParametrosFecha(req) {
    const { fecha, mes, año } = req.query;
    const resultado = {
        fecha: null,
        mes: null,
        año: null,
        esValido: true,
        errores: []
    };

    if (fecha) {
        const fechaObj = new Date(fecha);
        if (isNaN(fechaObj.getTime())) {
            resultado.esValido = false;
            resultado.errores.push('Fecha inválida');
        } else {
            resultado.fecha = fecha;
        }
    }

    if (mes) {
        const mesNum = parseInt(mes);
        if (mesNum < 1 || mesNum > 12) {
            resultado.esValido = false;
            resultado.errores.push('Mes debe estar entre 1 y 12');
        } else {
            resultado.mes = mesNum;
        }
    }

    if (año) {
        const añoNum = parseInt(año);
        const añoActual = new Date().getFullYear();
        if (añoNum < 2020 || añoNum > añoActual + 1) {
            resultado.esValido = false;
            resultado.errores.push(`Año debe estar entre 2020 y ${añoActual + 1}`);
        } else {
            resultado.año = añoNum;
        }
    }

    return resultado;
}

// Función para formatear respuestas de error de manera consistente
function formatearErrorRespuesta(error, contexto = 'operación') {
    return {
        error: `Error al ejecutar ${contexto}`,
        mensaje: 'Ha ocurrido un error interno. Por favor intente de nuevo.',
        detalles: process.env.NODE_ENV === 'development' ? error.message : undefined,
        timestamp: new Date().toISOString(),
        cafeteria: 'Las Delicias del Norte'
    };
}

// Función para logging estructurado
function logOperacion(operacion, datos = {}) {
    const timestamp = new Date().toLocaleString('es-CO', {
        timeZone: 'America/Bogota'
    });
    
    console.log(`📊 [${timestamp}] ${operacion}:`, {
        ...datos,
        cafeteria: 'Las Delicias del Norte'
    });
}

// Middleware para validar horario de operación (opcional)
function validarHorarioOperacion(req, res, next) {
    const now = new Date();
    const colombiaTime = new Date(now.toLocaleString("en-US", {timeZone: "America/Bogota"}));
    const hour = colombiaTime.getHours();
    
    // Cafetería opera de 6 AM a 12 PM, pero permitimos consultas 24/7
    req.horarioOperacion = {
        horaActual: hour,
        enOperacion: hour >= 6 && hour < 12,
        mensaje: hour >= 6 && hour < 12 ? 'En horario de operación' : 'Fuera de horario de operación'
    };
    
    // Log para seguimiento
    if (req.method !== 'GET') {
        logOperacion('Acceso fuera de horario', {
            ruta: req.originalUrl,
            hora: hour,
            enOperacion: req.horarioOperacion.enOperacion
        });
    }
    
    next();
}

// Inicialización del módulo
async function inicializarModuloReportes() {
    console.log('🚀 Inicializando módulo de reportes avanzados...');
    
    const conexionValida = await validarConexionBD();
    if (!conexionValida) {
        console.error('❌ No se pudo establecer conexión con la base de datos');
        return false;
    }

    // Verificar que las tablas necesarias existen
    try {
        await pool.query(`
            SELECT 
                COUNT(*) as productos_count
            FROM productos 
            WHERE activo = true
        `);
        
        await pool.query(`
            SELECT COUNT(*) as ventas_count 
            FROM ventas 
            WHERE fecha_venta >= CURRENT_DATE - INTERVAL '1 day'
        `);

        console.log('✅ Módulo de reportes avanzados inicializado correctamente');
        return true;
        
    } catch (error) {
        console.error('❌ Error verificando estructura de base de datos:', error.message);
        return false;
    }
}

// Exportar todas las funciones
module.exports = {
    getDashboardData,
    getReporteSemanal,
    getReporteMensual,
    getPredicciones,
    getTendencias,
    getComparativo,
    validarConexionBD,
    validarParametrosFecha,
    formatearErrorRespuesta,
    logOperacion,
    validarHorarioOperacion,
    inicializarModuloReportes
};