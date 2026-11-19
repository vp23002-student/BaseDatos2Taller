// Lógica de presentación calculada sobre la réplica local (funciona sin red).
// Las reglas de negocio "oficiales" (validación y alertas) viven en el backend Rust;
// aquí solo se consultan los documentos que Rust ya generó y replicó.
import { cache, type Doc } from './db';

export type Regla = { tipo: string; nombre: string; intervalo_km: number | null; intervalo_meses: number | null; precio_mano_obra: number };

const CATALOGO_RESPALDO: Regla[] = [
  { tipo: 'cambio_aceite', nombre: 'Cambio de aceite y filtro', intervalo_km: 5000, intervalo_meses: 3, precio_mano_obra: 15 },
  { tipo: 'revision_general', nombre: 'Revisión general', intervalo_km: null, intervalo_meses: 6, precio_mano_obra: 15 },
  { tipo: 'otro', nombre: 'Otro / correctivo', intervalo_km: null, intervalo_meses: null, precio_mano_obra: 0 },
];

export const porTipo = (tipo: string): Doc[] => [...cache.values()].filter((d) => d.tipo === tipo);

export function catalogo(): Regla[] {
  return (cache.get('config:catalogo_servicios')?.servicios as Regla[]) ?? CATALOGO_RESPALDO;
}
export const nombreServicio = (t: string) => catalogo().find((r) => r.tipo === t)?.nombre ?? t;

export function hoyISO(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function sumarDias(iso: string, dias: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + dias);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function estadoAlerta(fecha: string): 'vencida' | 'proxima' | 'programada' {
  const hoy = hoyISO();
  if (fecha < hoy) return 'vencida';
  if (fecha <= sumarDias(hoy, 15)) return 'proxima';
  return 'programada';
}

/** Igual que en Rust: por (vehículo, servicio) cuenta la alerta de la orden más reciente. */
export function alertasVigentes(vehiculoId?: string): Doc[] {
  const ultima = new Map<string, Doc>();
  for (const a of porTipo('alerta')) {
    if (vehiculoId && a.vehiculo_id !== vehiculoId) continue;
    const k = `${a.vehiculo_id}|${a.tipo_servicio}`;
    const p = ultima.get(k);
    if (!p || `${a.fecha_orden}|${a.orden_origen}` > `${p.fecha_orden}|${p.orden_origen}`) ultima.set(k, a);
  }
  return [...ultima.values()]
    .map((a) => ({ ...a, estado: estadoAlerta(a.fecha_programada) }) as Doc)
    .sort((a, b) => a.fecha_programada.localeCompare(b.fecha_programada));
}

export function ordenesDe(vehiculoId: string): Doc[] {
  return porTipo('orden_servicio')
    .filter((o) => o.vehiculo_id === vehiculoId)
    .sort((a, b) => (b.fecha + b._id).localeCompare(a.fecha + a._id));
}

export function kmActual(v: Doc): number {
  return ordenesDe(v._id).reduce((m, o) => Math.max(m, Number(o.kilometraje) || 0), Number(v.kilometraje_actual) || 0);
}

/** Existencia = inicial − usados en órdenes válidas + entradas (misma vista que CouchDB). */
export function stockActual(repuesto: Doc): number {
  let delta = 0;
  for (const d of cache.values()) {
    if (d.tipo === 'orden_servicio' && d.estado_backend !== 'rechazada') {
      for (const r of d.repuestos_usados ?? []) if (r.repuesto_id === repuesto._id) delta -= Number(r.cantidad) || 0;
    } else if (d.tipo === 'movimiento' && d.repuesto_id === repuesto._id) {
      delta += Number(d.cantidad) || 0;
    }
  }
  return (Number(repuesto.existencia) || 0) + delta;
}

export const normalizarPlaca = (p: string) => p.toUpperCase().replace(/[^A-Z0-9]/g, '');

export function nuevoId(prefijo: string): string {
  const ts = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const r = crypto.getRandomValues(new Uint8Array(6));
  return `${prefijo}:${ts}:${[...r].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export const dinero = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;
export const km = (n: number) => `${Math.round(Number(n) || 0).toLocaleString('es-SV')} km`;
export function fecha(iso: string): string {
  if (!iso) return '—';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}
