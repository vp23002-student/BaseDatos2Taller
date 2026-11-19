// Prueba de carga (Fase 3/4): escritura concurrente de órdenes de servicio.
// Se ejecuta con el MISMO script y la MISMA carga contra ambas arquitecturas:
//   OBJETIVO=rust      -> backend Rust + CouchDB   (http://backend:3000)
//   OBJETIVO=monolito  -> Node.js + PostgreSQL      (http://monolito:4000)
// Variables: VUS (usuarios virtuales), DURACION, REPETICION, SEMILLA_ALEATORIA
import http from 'k6/http';
import { check } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import encoding from 'k6/encoding';

const OBJETIVO = __ENV.OBJETIVO || 'rust';
const URL = OBJETIVO === 'rust' ? 'http://backend:3000/api/ordenes' : 'http://monolito:4000/api/ordenes';
const VUS = Number(__ENV.VUS || 50);
const ETIQUETA = `${OBJETIVO}_vus${VUS}_rep${__ENV.REPETICION || 1}`;

const semilla = JSON.parse(open('/datos-semilla/semilla.json'));
const VEHICULOS = semilla.vehiculos.map((v) => v._id);
const REPUESTOS = semilla.repuestos;
const SERVICIOS = ['filtro_aire', 'pastillas_freno', 'rotacion_llantas', 'revision_general', 'bujias', 'refrigerante'];

const tiempoServidor = new Trend('tiempo_servidor_ms', true);
const exito = new Rate('exito');
const ordenesOk = new Counter('ordenes_ok');

export const options = {
  scenarios: {
    carga: { executor: 'constant-vus', vus: VUS, duration: __ENV.DURACION || '20s' },
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  discardResponseBodies: true,
};

const auth = 'Basic ' + encoding.b64encode(`${__ENV.MECANICO1_USER || 'mecanico1'}:${__ENV.MECANICO1_PASS || 'taller2026'}`);

function elegir(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function orden() {
  const servicios = [{ tipo: 'cambio_aceite', costo: 15 }];
  if (Math.random() < 0.5) servicios.push({ tipo: elegir(SERVICIOS), costo: 10 });
  // El filtro de aceite A es el repuesto "caliente": lo usan casi todas las órdenes (caso real)
  const usados = [{ repuesto_id: 'repuesto:7501000000035', cantidad: 1, precio_unitario: 6.75 }];
  if (Math.random() < 0.5) {
    const r = elegir(REPUESTOS);
    usados.push({ repuesto_id: r._id, cantidad: 1, precio_unitario: r.precio });
  }
  return {
    tipo: 'orden_servicio',
    vehiculo_id: elegir(VEHICULOS),
    fecha: '2026-11-07',
    kilometraje: 100000 + Math.floor(Math.random() * 50000),
    servicios,
    repuestos_usados: usados,
    mecanico: 'k6',
    costo_total: 0,
  };
}

export default function () {
  const r = http.post(URL, JSON.stringify(orden()), {
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    tags: { objetivo: OBJETIVO },
  });
  const ok = check(r, { 'status 201': (x) => x.status === 201 });
  exito.add(ok);
  if (ok) ordenesOk.add(1);
  const st = (r.headers['Server-Timing'] || '').match(/dur=([\d.]+)/);
  if (st) tiempoServidor.add(Number(st[1]));
}

export function handleSummary(data) {
  const m = data.metrics;
  const resumen = {
    objetivo: OBJETIVO, vus: VUS, repeticion: Number(__ENV.REPETICION || 1), duracion: __ENV.DURACION || '20s',
    peticiones: m.http_reqs.values.count,
    throughput_rps: m.http_reqs.values.rate,
    ordenes_ok: m.ordenes_ok ? m.ordenes_ok.values.count : 0,
    throughput_ok_rps: m.ordenes_ok ? m.ordenes_ok.values.rate : 0,
    tasa_exito: m.exito ? m.exito.values.rate : 0,
    latencia_ms: m.http_req_duration.values,
    tiempo_servidor_ms: m.tiempo_servidor_ms ? m.tiempo_servidor_ms.values : null,
  };
  return {
    [`/resultados/carga/${ETIQUETA}.json`]: JSON.stringify(resumen, null, 2),
    stdout: `\n[${ETIQUETA}] ${resumen.peticiones} peticiones · ${resumen.throughput_ok_rps.toFixed(1)} órdenes/s · ` +
      `p95 ${resumen.latencia_ms['p(95)'].toFixed(1)} ms · éxito ${(resumen.tasa_exito * 100).toFixed(2)} %\n`,
  };
}
