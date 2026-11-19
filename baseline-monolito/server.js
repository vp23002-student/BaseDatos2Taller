// ARQUITECTURA DE REFERENCIA (grupo de control del experimento)
// Backend monolítico tradicional: Node.js + Express + PostgreSQL.
//  - El cliente depende de peticiones síncronas: si no hay red, la orden NO se registra.
//  - Cada orden es una transacción ACID que actualiza filas compartidas
//    (existencia de repuestos y alerta vigente por vehículo) -> bloqueos de fila.
// Implementa la MISMA regla de negocio que el backend Rust para que la
// comparación sea justa (mismo payload, mismas validaciones, mismas alertas).
import express from 'express';
import fs from 'node:fs';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 20 });
const app = express();
app.use(express.json({ limit: '10mb' }));

const REGLAS = {
  cambio_aceite: [5000, 3, 'Cambio de aceite y filtro'], filtro_aire: [10000, 6, 'Filtro de aire'],
  filtro_combustible: [20000, 12, 'Filtro de combustible'], pastillas_freno: [20000, 12, 'Pastillas de freno'],
  rotacion_llantas: [10000, 6, 'Rotación de llantas'], alineacion_balanceo: [10000, 6, 'Alineación y balanceo'],
  bateria: [null, 24, 'Batería'], banda_distribucion: [60000, 48, 'Banda de distribución'],
  refrigerante: [40000, 24, 'Cambio de refrigerante'], bujias: [30000, 24, 'Bujías'],
  revision_general: [null, 6, 'Revisión general'], otro: [null, null, 'Otro / correctivo'],
};

// ---------- telemetría equivalente a la del backend Rust ----------
const latencias = new Map();
app.use((req, res, next) => {
  const t0 = process.hrtime.bigint();
  const fin = res.end;
  res.end = function (...a) {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (!res.headersSent) res.setHeader('server-timing', `app;dur=${ms.toFixed(3)}`);
    const k = `${req.method} ${req.route?.path ?? req.path}`;
    const arr = latencias.get(k) ?? [];
    if (arr.length >= 50000) arr.shift();
    arr.push(ms);
    latencias.set(k, arr);
    return fin.apply(this, a);
  };
  next();
});

function validar(o) {
  const e = [];
  if (!/^vehiculo:/.test(o.vehiculo_id ?? '')) e.push('vehiculo_id inválido');
  if (!/^\d{4}-\d{2}-\d{2}/.test(o.fecha ?? '')) e.push('fecha inválida');
  if (!(Number.isInteger(o.kilometraje) && o.kilometraje > 0)) e.push('kilometraje inválido');
  if (!Array.isArray(o.servicios) || !o.servicios.length) e.push('sin servicios');
  for (const s of o.servicios ?? []) if (!REGLAS[s.tipo]) e.push(`servicio desconocido ${s.tipo}`);
  for (const r of o.repuestos_usados ?? []) if (!(r.cantidad > 0)) e.push('cantidad inválida');
  if (!o.mecanico) e.push('mecánico requerido');
  return e;
}

function proxima(tipo, fechaIso, km, kmDia) {
  const [ikm, meses] = REGLAS[tipo];
  const f = new Date(fechaIso.slice(0, 10) + 'T00:00:00Z');
  let porTiempo = null, porKm = null;
  if (meses) { porTiempo = new Date(f); porTiempo.setUTCMonth(porTiempo.getUTCMonth() + meses); }
  if (ikm) { porKm = new Date(f); porKm.setUTCDate(porKm.getUTCDate() + Math.ceil(ikm / (kmDia || 40))); }
  const fecha = porTiempo && porKm ? (porTiempo < porKm ? porTiempo : porKm) : porTiempo ?? porKm;
  return fecha ? { fecha: fecha.toISOString().slice(0, 10), km: ikm ? km + ikm : null } : null;
}

app.get('/api/salud', (_q, r) => r.json({ estado: 'ok', servicio: 'monolito-referencia' }));

app.get('/api/metricas', (_q, r) => {
  const endpoints = {};
  for (const [k, v] of latencias) {
    const s = [...v].sort((a, b) => a - b);
    const p = (q) => s[Math.round((s.length - 1) * q)] ?? 0;
    endpoints[k] = { conteo: v.length, promedio_ms: v.reduce((a, b) => a + b, 0) / v.length, p50_ms: p(0.5), p95_ms: p(0.95), p99_ms: p(0.99) };
  }
  r.json({ servicio: 'monolito-node', memoria_rss_mb: process.memoryUsage().rss / 1048576, endpoints });
});
app.post('/api/metricas/reiniciar', (_q, r) => { latencias.clear(); r.json({ ok: true }); });

app.post('/api/ordenes', async (req, res) => {
  const o = req.body;
  const errores = validar(o);
  if (errores.length) return res.status(422).json({ error: 'validacion', detalles: errores });
  const id = o._id ?? `orden:${Date.now()}:${Math.random().toString(16).slice(2, 14)}`;
  const total = (o.servicios ?? []).reduce((a, s) => a + (s.costo || 0), 0)
    + (o.repuestos_usados ?? []).reduce((a, x) => a + x.cantidad * (x.precio_unitario || 0), 0);
  const cli = await pool.connect();
  try {
    await cli.query('BEGIN');
    const v = await cli.query('SELECT cliente_id, km_diario_estimado FROM vehiculos WHERE id=$1', [o.vehiculo_id]);
    if (!v.rowCount) { await cli.query('ROLLBACK'); return res.status(422).json({ error: 'validacion', detalles: ['vehículo no existe'] }); }
    await cli.query(
      `INSERT INTO ordenes(id, vehiculo_id, fecha, kilometraje, mecanico, costo_total, servicios, repuestos)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, o.vehiculo_id, o.fecha.slice(0, 10), o.kilometraje, o.mecanico, total, JSON.stringify(o.servicios), JSON.stringify(o.repuestos_usados ?? [])],
    );
    // Actualización de un contador compartido: bloqueo de fila por repuesto
    for (const r of o.repuestos_usados ?? []) {
      await cli.query('UPDATE repuestos SET existencia = existencia - $1 WHERE id = $2', [r.cantidad, r.repuesto_id]);
    }
    // Alerta vigente por (vehículo, servicio): UPSERT sobre la misma fila
    for (const s of o.servicios) {
      const p = proxima(s.tipo, o.fecha, o.kilometraje, v.rows[0].km_diario_estimado);
      if (!p) continue;
      await cli.query(
        `INSERT INTO alertas(vehiculo_id, tipo_servicio, fecha_programada, km_programado, orden_origen, estado_envio)
         VALUES($1,$2,$3,$4,$5,'pendiente')
         ON CONFLICT (vehiculo_id, tipo_servicio) DO UPDATE
         SET fecha_programada=EXCLUDED.fecha_programada, km_programado=EXCLUDED.km_programado,
             orden_origen=EXCLUDED.orden_origen, estado_envio='pendiente'`,
        [o.vehiculo_id, s.tipo, p.fecha, p.km, id],
      );
    }
    await cli.query('COMMIT');
    res.status(201).json({ id, ok: true, costo_total: Math.round(total * 100) / 100 });
  } catch (e) {
    await cli.query('ROLLBACK').catch(() => {});
    res.status(e.code === '23505' ? 409 : 500).json({ error: e.message });
  } finally {
    cli.release();
  }
});

app.get('/api/ordenes/conteo', async (req, res) => {
  const r = await pool.query('SELECT count(*)::int AS n FROM ordenes WHERE id LIKE $1', [`${req.query.prefijo ?? ''}%`]);
  res.json({ conteo: r.rows[0].n });
});

async function iniciar() {
  for (let i = 0; i < 30; i++) {
    try { await pool.query('SELECT 1'); break; } catch { await new Promise((r) => setTimeout(r, 1000)); }
  }
  await pool.query(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM vehiculos');
  if (rows[0].n === 0 && fs.existsSync(process.env.RUTA_SEMILLA ?? '')) {
    const s = JSON.parse(fs.readFileSync(process.env.RUTA_SEMILLA, 'utf8'));
    for (const c of s.clientes) await pool.query('INSERT INTO clientes VALUES($1,$2,$3,$4)', [c._id, c.nombre, c.telefono, c.correo]);
    for (const v of s.vehiculos)
      await pool.query('INSERT INTO vehiculos VALUES($1,$2,$3,$4,$5,$6,$7)', [v._id, v.cliente_id, v.placa, v.marca, v.modelo, v.kilometraje_actual, v.km_diario_estimado]);
    for (const r of s.repuestos)
      await pool.query('INSERT INTO repuestos VALUES($1,$2,$3,$4,$5,$6)', [r._id, r.codigo_barras, r.descripcion, r.existencia, r.minimo_reorden, r.precio]);
    console.log('Semilla cargada en PostgreSQL');
  }
  app.listen(4000, () => console.log('Monolito de referencia en :4000'));
}
iniciar();
