// Capa de datos offline-first:
//  - Cada tableta tiene una réplica local completa en PouchDB (IndexedDB).
//  - Toda lectura/escritura de la interfaz va a la réplica LOCAL: funciona sin red.
//  - Una replicación bidireccional continua (Couch Replication Protocol) la
//    mantiene sincronizada con Apache CouchDB cuando hay conexión.
import PouchDB from 'pouchdb-browser';

export type Doc = {
  _id: string;
  _rev?: string;
  _conflicts?: string[];
  _deleted?: boolean;
  tipo: string;
  [campo: string]: any;
};

type Sesion = { usuario: string; clave: string; roles: string[] };

export const estado = {
  sesion: null as Sesion | null,
  enLinea: false,
  modoSinConexion: false, // interruptor de demostración
  sincronizando: false,
  ultimaSync: '' as string,
  pendientes: new Set<string>(),
  log: [] as { hora: string; texto: string; tipo: 'ok' | 'info' | 'error' }[],
};

export const cache = new Map<string, Doc>();

let local: PouchDB.Database<Doc> | null = null;
let remoto: PouchDB.Database<Doc> | null = null;
let remotoCatalogo: PouchDB.Database<Doc> | null = null;
let sync: PouchDB.Replication.Sync<Doc> | null = null;
let syncCatalogo: { cancel(): void } | null = null;

// Documentos maestros (solo el rol admin los modifica) viven en la base "taller_catalogo".
const TIPOS_CATALOGO = ['repuesto', 'config', 'movimiento'];
const esCatalogo = (d: any) => TIPOS_CATALOGO.includes(d.tipo) || (d._deleted && String(d._id).match(/^(repuesto|config|movimiento):/));
let cambiosLocales: PouchDB.Core.Changes<Doc> | null = null;

const CLAVE_SESION = 'tallersync.sesion';
const CLAVE_PENDIENTES = 'tallersync.pendientes';
const URL_REMOTA = `${location.origin}/couch/taller`;
const URL_CATALOGO = `${location.origin}/couch/taller_catalogo`;

// ---------- suscripción a cambios (re-render) ----------
const oyentes = new Set<() => void>();
let temporizador: number | undefined;
export function suscribir(fn: () => void): () => void {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}
export function notificar() {
  clearTimeout(temporizador);
  temporizador = window.setTimeout(() => oyentes.forEach((f) => f()), 120);
}

function registrar(texto: string, tipo: 'ok' | 'info' | 'error' = 'info') {
  estado.log.unshift({ hora: new Date().toLocaleTimeString(), texto, tipo });
  estado.log.length = Math.min(estado.log.length, 80);
  notificar();
}

function guardarPendientes() {
  try {
    localStorage.setItem(CLAVE_PENDIENTES, JSON.stringify([...estado.pendientes]));
  } catch { /* almacenamiento no disponible */ }
}

function cabeceraAuth(): string {
  const s = estado.sesion!;
  return 'Basic ' + btoa(unescape(encodeURIComponent(`${s.usuario}:${s.clave}`)));
}

// ---------- sesión ----------
export function sesionGuardada(): Sesion | null {
  try {
    const t = localStorage.getItem(CLAVE_SESION);
    return t ? (JSON.parse(t) as Sesion) : null;
  } catch {
    return null;
  }
}

export async function iniciarSesion(usuario: string, clave: string): Promise<void> {
  let roles: string[] = [];
  try {
    const r = await fetch(`${location.origin}/couch/_session`, {
      headers: { Authorization: 'Basic ' + btoa(unescape(encodeURIComponent(`${usuario}:${clave}`))) },
    });
    const j = await r.json();
    if (!r.ok || !j.userCtx?.name) throw Object.assign(new Error('Usuario o contraseña incorrectos'), { auth: true });
    roles = j.userCtx.roles;
  } catch (e: any) {
    if (e.auth) throw e;
    // Sin red: se permite entrar si este usuario ya inició sesión antes en esta tableta.
    const previa = sesionGuardada();
    if (previa && previa.usuario === usuario && previa.clave === clave) roles = previa.roles;
    else throw new Error('Sin conexión y sin una sesión previa de este usuario en la tableta');
  }
  estado.sesion = { usuario, clave, roles };
  localStorage.setItem(CLAVE_SESION, JSON.stringify(estado.sesion));
  await abrir();
}

export async function cerrarSesion() {
  sync?.cancel();
  syncCatalogo?.cancel();
  cambiosLocales?.cancel();
  localStorage.removeItem(CLAVE_SESION);
  location.hash = '';
  location.reload();
}

export function esAdmin(): boolean {
  return !!estado.sesion?.roles.some((r) => r === 'admin' || r === '_admin');
}

// ---------- apertura de la réplica local ----------
export async function abrir() {
  local = new PouchDB<Doc>('tallersync_local', { auto_compaction: true });
  const s = estado.sesion!;
  remoto = new PouchDB<Doc>(URL_REMOTA, { skip_setup: true, auth: { username: s.usuario, password: s.clave } });
  remotoCatalogo = new PouchDB<Doc>(URL_CATALOGO, { skip_setup: true, auth: { username: s.usuario, password: s.clave } });

  try {
    const p = JSON.parse(localStorage.getItem(CLAVE_PENDIENTES) || '[]');
    estado.pendientes = new Set(p);
  } catch { /* nada */ }

  const todos = await local.allDocs({ include_docs: true, conflicts: true });
  cache.clear();
  for (const f of todos.rows) if (f.doc && !f.id.startsWith('_design/')) cache.set(f.id, f.doc);

  cambiosLocales = local
    .changes({ since: 'now', live: true, include_docs: true, conflicts: true })
    .on('change', (c) => {
      if (c.id.startsWith('_design/')) return;
      if (c.deleted) cache.delete(c.id);
      else if (c.doc) cache.set(c.id, c.doc);
      notificar();
    });

  if (cache.size === 0) registrar('Réplica local vacía: descargando datos del servidor…');
  iniciarSync();
}

// ---------- identidad del servidor ----------
// El backend crea `config:instancia` con un id único cada vez que la base se crea desde cero.
// Si cambia, el servidor fue reiniciado (p. ej. `detener.sh --borrar`): la réplica local es de
// una base que ya no existe y NO debe subirse, o "reviviría" miles de documentos viejos.
const CLAVE_INSTANCIA = 'tallersync.instancia';

async function verificarInstancia(): Promise<boolean> {
  let actual: string;
  try {
    actual = (await remotoCatalogo!.get('config:instancia')).valor;
  } catch {
    return false; // sin red, o el servidor aún se está creando: reintentar luego
  }
  const previa = localStorage.getItem(CLAVE_INSTANCIA);
  const hayDatos = (await local!.info()).doc_count > 0;
  if (previa !== actual && (previa || hayDatos)) {
    registrar('El servidor fue reiniciado: se descarta la réplica local antigua', 'info');
    sync?.cancel();
    syncCatalogo?.cancel();
    cambiosLocales?.cancel();
    await local!.destroy();
    localStorage.removeItem(CLAVE_PENDIENTES);
    localStorage.setItem(CLAVE_INSTANCIA, actual);
    location.reload();
    return false;
  }
  localStorage.setItem(CLAVE_INSTANCIA, actual);
  return true;
}

// ---------- replicación ----------
// Sin `retry` de PouchDB: ante un error se detiene y la reconexión pasa siempre por
// verificarInstancia(), así nunca se sube nada a una base distinta de la original.
let temporizadorReintento: number | undefined;
let espera = 1000;
function reintentar() {
  sync?.cancel();
  syncCatalogo?.cancel();
  sync = null;
  syncCatalogo = null;
  estado.enLinea = false;
  estado.sincronizando = false;
  notificar();
  clearTimeout(temporizadorReintento);
  temporizadorReintento = window.setTimeout(iniciarSync, espera);
  espera = Math.min(espera * 2, 8000);
}

export async function iniciarSync() {
  if (!local || !remoto || !remotoCatalogo || estado.modoSinConexion) return;
  clearTimeout(temporizadorReintento);
  if (!(await verificarInstancia())) return reintentar();
  if (estado.modoSinConexion) return;
  espera = 1000;
  sync?.cancel();
  syncCatalogo?.cancel();
  const opciones = { live: true, retry: false, batch_size: 100 };

  // Catálogo: el admin sincroniza en ambos sentidos; un mecánico solo lo descarga.
  const alCambiarCatalogo = (info: any) => {
    const docs: Doc[] = info.change?.docs ?? info.docs ?? [];
    if (info.direction === 'push') {
      docs.forEach((d) => estado.pendientes.delete(d._id));
      guardarPendientes();
    }
    if (docs.length) registrar(`Catálogo: ${docs.length} documento(s) ${info.direction === 'push' ? 'enviados' : 'recibidos'}`, 'ok');
  };
  const replCatalogo: any = esAdmin()
    ? local.sync(remotoCatalogo, { ...opciones, push: { filter: (d: any) => esCatalogo(d) && !String(d._id).startsWith('_design/') } } as any)
    : local.replicate.from(remotoCatalogo, opciones as any);
  syncCatalogo = replCatalogo.on('change', alCambiarCatalogo).on('error', reintentar);

  // Operación diaria (clientes, vehículos, órdenes, alertas): bidireccional.
  sync = local
    .sync(remoto, { ...opciones, push: { filter: (d: any) => !esCatalogo(d) && !String(d._id).startsWith('_design/') } } as any)
    .on('change', (info: any) => {
      const docs: Doc[] = info.change?.docs ?? [];
      if (info.direction === 'push') {
        docs.forEach((d) => estado.pendientes.delete(d._id));
        guardarPendientes();
        registrar(`⬆ ${docs.length} documento(s) enviados al servidor`, 'ok');
      } else {
        registrar(`⬇ ${docs.length} documento(s) recibidos del servidor`, 'ok');
      }
    })
    .on('active', () => {
      estado.sincronizando = true;
      estado.enLinea = true;
      notificar();
    })
    .on('paused', (err: any) => {
      estado.sincronizando = false;
      if (err) {
        estado.enLinea = false;
      } else {
        estado.enLinea = true;
        estado.ultimaSync = new Date().toLocaleTimeString();
      }
      notificar();
    })
    .on('denied', (err: any) => registrar(`Servidor rechazó un documento: ${err?.reason ?? err?.message ?? JSON.stringify(err)}`, 'error'))
    .on('error', (err: any) => {
      registrar(`Sin conexión con el servidor (${err?.message ?? err}); reintentando…`, 'error');
      reintentar();
    }) as any;
}

export function alternarSinConexion(activar: boolean) {
  estado.modoSinConexion = activar;
  if (activar) {
    clearTimeout(temporizadorReintento);
    sync?.cancel();
    syncCatalogo?.cancel();
    sync = null;
    syncCatalogo = null;
    estado.enLinea = false;
    estado.sincronizando = false;
    registrar('Modo sin conexión ACTIVADO (simulación de corte de red)', 'info');
  } else {
    registrar('Conexión restablecida: sincronizando…', 'info');
    iniciarSync();
  }
  notificar();
}

// ---------- escritura local ----------
export async function guardar(doc: Doc): Promise<Doc> {
  if (!local) throw new Error('Base local no abierta');
  if (!doc.tipo) throw new Error('Todo documento necesita "tipo"');
  const r = await local.put(doc);
  estado.pendientes.add(r.id);
  guardarPendientes();
  return { ...doc, _rev: r.rev };
}

export async function obtenerRevision(id: string, rev: string): Promise<Doc> {
  return local!.get(id, { rev });
}

/** Resuelve un conflicto: el contenido elegido queda como versión ganadora y
 *  las demás revisiones en conflicto se eliminan. */
export async function resolverConflicto(id: string, revElegida: string) {
  const ganador = await local!.get(id, { conflicts: true });
  const elegido = await local!.get(id, { rev: revElegida });
  const perdedoras = [ganador._rev!, ...(ganador._conflicts ?? [])].filter((r) => r !== ganador._rev);
  const docs: any[] = [];
  if (revElegida !== ganador._rev) {
    const { _rev, _conflicts, ...contenido } = elegido as any;
    docs.push({ ...contenido, _rev: ganador._rev });
  }
  for (const r of perdedoras) docs.push({ _id: id, _rev: r, _deleted: true });
  await local!.bulkDocs(docs);
  estado.pendientes.add(id);
  guardarPendientes();
  registrar(`Conflicto resuelto en ${id}`, 'ok');
}

// ---------- API del backend en Rust ----------
export async function api<T = any>(ruta: string, opciones: RequestInit = {}): Promise<T> {
  const h = new Headers(opciones.headers);
  h.set('Authorization', cabeceraAuth());
  if (opciones.body) h.set('Content-Type', 'application/json');
  const r = await fetch(`/api${ruta}`, { ...opciones, headers: h });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.mensaje || (j.detalles ? j.detalles.join(', ') : `HTTP ${r.status}`));
  return j as T;
}

export async function infoLocal() {
  return local ? local.info() : null;
}
