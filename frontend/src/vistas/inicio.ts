import { notificarAlerta } from '../acciones';
import { cache, estado, type Doc } from '../db';
import { alertasVigentes, dinero, fecha, hoyISO, km, porTipo, stockActual } from '../logica';
import { badge, h } from '../ui';

export function vistaInicio(c: HTMLElement) {
  const alertas = alertasVigentes();
  const vencidas = alertas.filter((a) => a.estado === 'vencida');
  const proximas = alertas.filter((a) => a.estado === 'proxima');
  const bajos = porTipo('repuesto')
    .map((r) => ({ ...r, stock: stockActual(r) }) as Doc)
    .filter((r) => r.stock <= r.minimo_reorden);
  const hoy = hoyISO();
  const ordenesHoy = porTipo('orden_servicio').filter((o) => String(o.fecha).startsWith(hoy));
  const ventasHoy = ordenesHoy.reduce((s, o) => s + (Number(o.costo_total) || 0), 0);
  const lista = [...vencidas, ...proximas].slice(0, 40);

  c.innerHTML = `
    <section class="kpis">
      <div class="kpi kpi-rojo"><b>${vencidas.length}</b><span>Mantenimientos vencidos</span></div>
      <div class="kpi kpi-amarillo"><b>${proximas.length}</b><span>Próximos (15 días)</span></div>
      <div class="kpi"><b>${ordenesHoy.length}</b><span>Órdenes hoy · ${dinero(ventasHoy)}</span></div>
      <div class="kpi ${bajos.length ? 'kpi-rojo' : ''}"><b>${bajos.length}</b><span>Repuestos bajo mínimo</span></div>
      <div class="kpi"><b>${estado.pendientes.size}</b><span>Cambios por sincronizar</span></div>
    </section>

    <section class="tarjeta">
      <h2>Clientes a contactar</h2>
      <p class="ayuda">Alertas calculadas por el backend en Rust a partir del historial. Toque “WhatsApp” para enviar el recordatorio.</p>
      ${lista.length === 0 ? '<p class="vacio">No hay mantenimientos vencidos ni próximos 🎉</p>' : `
      <div class="tabla-scroll"><table>
        <thead><tr><th>Placa</th><th>Cliente</th><th>Servicio</th><th>Fecha</th><th>Km</th><th>Estado</th><th></th></tr></thead>
        <tbody>${lista.map((a) => {
          const cli = cache.get(a.cliente_id ?? '');
          return `<tr>
            <td><a href="#/vehiculo/${encodeURIComponent(a.vehiculo_id)}"><b>${h(a.placa)}</b></a></td>
            <td>${h(cli?.nombre ?? '—')}<br><small>${h(cli?.telefono ?? '')}</small></td>
            <td>${h(a.nombre_servicio)}</td>
            <td>${fecha(a.fecha_programada)}</td>
            <td>${a.km_programado ? km(a.km_programado) : '—'}</td>
            <td>${badge(a.estado)} ${a.estado_envio === 'enviada' ? badge('enviada') : ''}</td>
            <td><button class="btn btn-wa" data-wa="${h(a._id)}">WhatsApp</button></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`}
    </section>

    ${bajos.length ? `<section class="tarjeta">
      <h2>Repuestos por reordenar</h2>
      <ul class="lista">${bajos.map((r) => `<li><b>${h(r.descripcion)}</b> — quedan ${r.stock} (mínimo ${r.minimo_reorden}) · ${h(r.proveedor)}</li>`).join('')}</ul>
    </section>` : ''}`;

  c.querySelectorAll<HTMLButtonElement>('[data-wa]').forEach((b) =>
    b.addEventListener('click', () => notificarAlerta(b.dataset.wa!)),
  );
  return { reactiva: true };
}
