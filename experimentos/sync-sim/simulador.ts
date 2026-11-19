// Experimento de RESILIENCIA ante red intermitente (variables dependientes b y d de la Fase 1):
//   - latencia de sincronización al recuperar la conexión (s)
//   - tasa de éxito de replicación / transacciones perdidas
//
// Arquitectura PROPUESTA: la tableta guarda en su réplica local (PouchDB) y la
//   replicación de CouchDB envía los documentos cuando hay red (con reintentos y checkpoints).
// Arquitectura de REFERENCIA: cliente tradicional que envía cada orden por una
//   petición HTTP síncrona al monolito (Node + PostgreSQL); si falla, se pierde.
//
// La red se degrada DENTRO de este contenedor con `tc netem` (requiere NET_ADMIN).
import { execSync } from 'node:child_process';
import fs from 'node:fs';
// @ts-ignore módulos sin tipos
import PouchDB from 'pouchdb-core';
// @ts-ignore
import memoria from 'pouchdb-adapter-memory';
// @ts-ignore
import httpAdapter from 'pouchdb-adapter-http';
// @ts-ignore
import replicacion from 'pouchdb-replication';

PouchDB.plugin(memoria).plugin(httpAdapter).plugin(replicacion);

const env = process.env;
const COUCH = env.COUCH_URL ?? 'http://couchdb:5984';
const MONOLITO = env.MONOLITO_URL ?? 'http://monolito:4000';
const USUARIO = env.MECANICO1_USER ?? 'mecanico1';
const CLAVE = env.MECANICO1_PASS ?? 'taller2026';
const N = Number(env.N_DOCS ?? 200);
const REPS = Number(env.REPETICIONES ?? 3);
const TIMEOUT_S = Number(env.TIMEOUT_S ?? 300);
const CONCURRENCIA = Number(env.CONCURRENCIA_MONOLITO ?? 8);
const REINTENTOS = Number(env.REINTENTOS_MONOLITO ?? 1);
const TIMEOUT_REQ_MS = Number(env.TIMEOUT_PETICION_MS ?? 10000);
const SALIDA = env.SALIDA ?? '/resultados/red/resultados_red.csv';

type Escenario = { perdida: number; latencia: number; ancho: string | null; corte?: boolean };
const ESCENARIOS: Record<string, Escenario> = {
  base: { perdida: 0, latencia: 0, ancho: null },
  perdida_5: { perdida: 5, latencia: 200, ancho: '1mbit' },
  perdida_15: { perdida: 15, latencia: 400, ancho: '1mbit' },
  perdida_30: { perdida: 30, latencia: 800, ancho: '1mbit' },
  corte: { perdida: 0, latencia: 100, ancho: '1mbit', corte: true }, // órdenes creadas con la red caída
};
const elegidos = (env.ESCENARIOS ?? Object.keys(ESCENARIOS).join(',')).split(',').map((s) => s.trim());
const arquitecturas = (env.ARQUITECTURAS ?? 'propuesta,monolito').split(',').map((s) => s.trim());

const semilla = JSON.parse(fs.readFileSync(`/datos-semilla/${env.ARCHIVO_SEMILLA ?? 'semilla_demo.json'}`, 'utf8'));
const VEHICULOS: string[] = semilla.vehiculos.map((v: any) => v._id);
const auth = 'Basic ' + Buffer.from(`${USUARIO}:${CLAVE}`).toString('base64');

// ---------- control de red ----------
function red(e: Escenario | 'corte_total' | 'limpia') {
  try { execSync('tc qdisc del dev eth0 root 2>/dev/null'); } catch { /* no había */ }
  if (e === 'limpia') return;
  const args = e === 'corte_total'
    ? 'loss 100%'
    : [e.latencia ? `delay ${e.latencia}ms ${Math.round(e.latencia * 0.2)}ms` : '', e.perdida ? `loss ${e.perdida}%` : '', e.ancho ? `rate ${e.ancho}` : '']
        .filter(Boolean).join(' ');
  if (args) execSync(`tc qdisc add dev eth0 root netem ${args}`);
}

function orden(id: string) {
  return {
    _id: id, tipo: 'orden_servicio', vehiculo_id: VEHICULOS[Math.floor(Math.random() * VEHICULOS.length)],
    fecha: '2026-11-07', kilometraje: 100000 + Math.floor(Math.random() * 50000),
    servicios: [{ tipo: 'cambio_aceite', costo: 15 }, { tipo: 'filtro_aire', costo: 5 }],
    repuestos_usados: [{ repuesto_id: 'repuesto:7501000000035', cantidad: 1, precio_unitario: 6.75 }],
    mecanico: 'simulador', costo_total: 26.75, estado: 'completada', creada_sin_conexion: true,
  };
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function contarEnCouch(prefijo: string, soloProcesadas = false): Promise<number> {
  const selector: any = { _id: { $gt: prefijo, $lt: prefijo + '￰' } };
  if (soloProcesadas) selector.estado_backend = 'procesada';
  const r = await fetch(`${COUCH}/taller/_find`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify({ selector, fields: ['_id'], limit: N * 2 }),
  });
  return ((await r.json()).docs ?? []).length;
}

// ---------- arquitectura propuesta ----------
async function propuesta(nombre: string, e: Escenario, rep: number) {
  const lote = `sim${Date.now()}${rep}`;
  const prefijo = `orden:${lote}:`;
  const local = new PouchDB(`local_${lote}`, { adapter: 'memory' });
  const remoto = new PouchDB(`${COUCH}/taller`, { skip_setup: true, fetch: (u: any, o: any) => {
    o.headers.set('Authorization', auth);
    return PouchDB.fetch(u, o);
  } });

  if (e.corte) red('corte_total');
  // El mecánico trabaja: las órdenes se guardan en la réplica local (no requiere red)
  const t0crear = performance.now();
  await local.bulkDocs(Array.from({ length: N }, (_, i) => orden(`${prefijo}${String(i).padStart(5, '0')}`)));
  const tCrear = (performance.now() - t0crear) / 1000;
  red(e); // vuelve la conexión (degradada)

  const t0 = performance.now();
  let errores = 0;
  while ((performance.now() - t0) / 1000 < TIMEOUT_S) {
    try {
      await local.replicate.to(remoto, { batch_size: 100 });
      break; // terminó sin error
    } catch {
      errores++; // corte o timeout: reintenta; los checkpoints evitan reenviar lo ya confirmado
      await esperar(1000);
    }
  }
  const tSync = (performance.now() - t0) / 1000;
  red('limpia');
  const exitosos = await contarEnCouch(prefijo);

  // Tiempo hasta que el backend Rust procesó (validó y generó alertas) todas las órdenes
  const t1 = performance.now();
  let procesadas = 0;
  while ((performance.now() - t1) / 1000 < 60) {
    procesadas = await contarEnCouch(prefijo, true);
    if (procesadas >= exitosos) break;
    await esperar(250);
  }
  const tProc = (performance.now() - t1) / 1000;
  await local.destroy();
  return { arquitectura: 'propuesta', escenario: nombre, repeticion: rep, n: N, exitosos, perdidos: N - exitosos,
    tiempo_s: tSync, tiempo_captura_s: tCrear, reintentos: errores, procesadas_backend: procesadas, tiempo_procesamiento_s: tProc };
}

// ---------- arquitectura de referencia ----------
async function monolito(nombre: string, e: Escenario, rep: number) {
  const prefijo = `orden:mono${Date.now()}${rep}:`;
  red(e.corte ? 'corte_total' : e);
  const t0 = performance.now();
  let siguiente = 0, errores = 0;
  const trabajador = async () => {
    while (siguiente < N) {
      const i = siguiente++;
      const cuerpo = JSON.stringify(orden(`${prefijo}${String(i).padStart(5, '0')}`));
      for (let intento = 0; intento <= REINTENTOS; intento++) {
        try {
          const r = await fetch(`${MONOLITO}/api/ordenes`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: cuerpo,
            signal: AbortSignal.timeout(e.corte ? 2000 : TIMEOUT_REQ_MS),
          });
          await r.arrayBuffer();
          if (r.status === 201 || r.status === 409) break; // 409 = ya existía (reintento idempotente)
        } catch {
          errores++;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCIA }, trabajador));
  const t = (performance.now() - t0) / 1000;
  red('limpia');
  const r = await fetch(`${MONOLITO}/api/ordenes/conteo?prefijo=${encodeURIComponent(prefijo)}`);
  const exitosos = (await r.json()).conteo as number;
  return { arquitectura: 'monolito', escenario: nombre, repeticion: rep, n: N, exitosos, perdidos: N - exitosos,
    tiempo_s: t, tiempo_captura_s: t, reintentos: errores, procesadas_backend: exitosos, tiempo_procesamiento_s: 0 };
}

// ---------- ejecución ----------
const COLUMNAS = ['fecha', 'arquitectura', 'escenario', 'perdida_pct', 'latencia_ms', 'ancho_banda', 'repeticion', 'n', 'exitosos',
  'perdidos', 'tasa_exito_pct', 'tiempo_s', 'docs_por_s', 'tiempo_captura_s', 'reintentos', 'procesadas_backend', 'tiempo_procesamiento_s'];

async function main() {
  fs.mkdirSync(SALIDA.replace(/\/[^/]+$/, ''), { recursive: true });
  if (!fs.existsSync(SALIDA)) fs.writeFileSync(SALIDA, COLUMNAS.join(',') + '\n');
  red('limpia');
  // Orden aleatorio de corridas (principio de aleatorización del diseño experimental)
  const corridas: [string, string, number][] = [];
  for (const esc of elegidos) for (const arq of arquitecturas) for (let r = 1; r <= REPS; r++) corridas.push([esc, arq, r]);
  corridas.sort(() => Math.random() - 0.5);

  for (const [esc, arq, rep] of corridas) {
    const e = ESCENARIOS[esc];
    if (!e) throw new Error(`Escenario desconocido: ${esc}`);
    process.stdout.write(`▶ ${arq.padEnd(9)} ${esc.padEnd(11)} rep ${rep} … `);
    const r = arq === 'propuesta' ? await propuesta(esc, e, rep) : await monolito(esc, e, rep);
    const fila: Record<string, any> = {
      ...r, fecha: new Date().toISOString(), perdida_pct: e.corte ? 100 : e.perdida, latencia_ms: e.latencia,
      ancho_banda: e.ancho ?? 'sin_limite', tasa_exito_pct: (100 * r.exitosos) / r.n, docs_por_s: r.exitosos / Math.max(r.tiempo_s, 1e-6),
    };
    fs.appendFileSync(SALIDA, COLUMNAS.map((c) => (typeof fila[c] === 'number' ? Number(fila[c].toFixed(4)) : fila[c])).join(',') + '\n');
    console.log(`${r.exitosos}/${r.n} ok · ${r.tiempo_s.toFixed(2)} s`);
  }
  red('limpia');
  try { execSync(`chown -R ${env.HOST_UID ?? 1000}:${env.HOST_GID ?? 1000} /resultados`); } catch { /* sin permisos */ }
  console.log(`Resultados en ${SALIDA}`);
}

main().catch((e) => {
  red('limpia');
  console.error(e);
  process.exit(1);
});
