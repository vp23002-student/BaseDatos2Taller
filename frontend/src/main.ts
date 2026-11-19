import './estilos.css';
import { cerrarSesion, estado, iniciarSesion, sesionGuardada, suscribir } from './db';
import { $, aviso, h } from './ui';
import { vistaInicio } from './vistas/inicio';
import { vistaInventario } from './vistas/inventario';
import { vistaOrden } from './vistas/orden';
import { vistaReportes } from './vistas/reportes';
import { vistaSync } from './vistas/sync';
import { vistaVehiculo } from './vistas/vehiculo';
import { vistaVehiculos } from './vistas/vehiculos';

type Vista = (c: HTMLElement, args: string[]) => { reactiva: boolean };
const RUTAS: Record<string, Vista> = {
  '': vistaInicio,
  vehiculos: vistaVehiculos,
  vehiculo: vistaVehiculo,
  orden: vistaOrden,
  inventario: vistaInventario,
  sync: vistaSync,
  reportes: vistaReportes,
};
const MENU = [
  ['', '🏠', 'Inicio'],
  ['vehiculos', '🚗', 'Vehículos'],
  ['orden', '🔧', 'Nueva orden'],
  ['inventario', '📦', 'Inventario'],
  ['sync', '🔄', 'Sincronización'],
  ['reportes', '📊', 'Reportes'],
];

const app = document.getElementById('app')!;
let reactiva = false;

function pantallaLogin(error = '') {
  const previa = sesionGuardada();
  app.innerHTML = `
    <div class="login">
      <form id="flogin" class="tarjeta">
        <img src="/icono.svg" width="64" alt="" />
        <h1>TallerSync</h1>
        <p class="ayuda">Mantenimiento preventivo y repuestos · funciona sin internet</p>
        ${error ? `<p class="error">${h(error)}</p>` : ''}
        <label>Usuario<input id="usuario" value="${h(previa?.usuario ?? 'mecanico1')}" autocomplete="username" /></label>
        <label>Contraseña<input id="clave" type="password" autocomplete="current-password" /></label>
        <button class="btn btn-grande">Entrar</button>
      </form>
    </div>`;
  $('#flogin').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#flogin button') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = 'Abriendo réplica local…';
    try {
      await iniciarSesion(($('#usuario') as HTMLInputElement).value.trim(), ($('#clave') as HTMLInputElement).value);
      montar();
    } catch (err: any) {
      pantallaLogin(err.message);
    }
  });
}

function barraEstado(): string {
  const e = estado;
  const clase = e.modoSinConexion || !e.enLinea ? 'rojo' : e.sincronizando ? 'amarillo' : 'verde';
  const texto = e.modoSinConexion ? 'Sin conexión (simulado)' : !e.enLinea ? 'Sin conexión' : e.sincronizando ? 'Sincronizando…' : 'En línea';
  return `<a href="#/sync" class="pastilla pastilla-${clase}"><i></i>${texto}${e.pendientes.size ? ` · ${e.pendientes.size} por subir` : ''}</a>`;
}

function montar() {
  app.innerHTML = `
    <header class="barra">
      <a href="#/" class="marca"><img src="/icono.svg" width="30" alt="" /> TallerSync</a>
      <span id="estado-sync"></span>
      <span class="usuario">${h(estado.sesion?.usuario)} <button class="btn-link" id="salir">Salir</button></span>
    </header>
    <nav class="menu">${MENU.map(([r, i, t]) => `<a href="#/${r}" data-ruta="${r}"><span>${i}</span>${t}</a>`).join('')}</nav>
    <main id="vista"></main>`;
  $('#salir').addEventListener('click', () => { if (confirm('¿Cerrar sesión?')) cerrarSesion(); });
  window.addEventListener('hashchange', enrutar);
  suscribir(() => {
    $('#estado-sync').innerHTML = barraEstado();
    // no repintar mientras el usuario escribe en un formulario
    const activo = document.activeElement;
    const escribiendo = activo && $('#vista').contains(activo) && /INPUT|TEXTAREA|SELECT/.test(activo.tagName);
    if (reactiva && !escribiendo) enrutar();
  });
  $('#estado-sync').innerHTML = barraEstado();
  enrutar();
}

function enrutar() {
  const partes = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const [ruta, ...args] = partes;
  const vista = RUTAS[ruta] ?? vistaInicio;
  document.querySelectorAll('.menu a').forEach((a) => a.classList.toggle('activo', (a as HTMLElement).dataset.ruta === (ruta ?? '')));
  const cont = $('#vista');
  const scroll = window.scrollY;
  try {
    reactiva = vista(cont, args).reactiva;
  } catch (e: any) {
    cont.innerHTML = `<p class="error">${h(e.message)}</p>`;
  }
  if (reactiva) window.scrollTo(0, scroll);
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

const previa = sesionGuardada();
if (previa) {
  iniciarSesion(previa.usuario, previa.clave).then(montar).catch((e) => {
    aviso(e.message, 'error');
    pantallaLogin();
  });
} else pantallaLogin();
