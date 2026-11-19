import QRCode from 'qrcode';
import { notificarAlerta } from '../acciones';
import { cache, estado, guardar } from '../db';
import { alertasVigentes, dinero, fecha, km, kmActual, nombreServicio, ordenesDe } from '../logica';
import { $, aviso, badge, h } from '../ui';

export function vistaVehiculo(c: HTMLElement, [id]: string[]) {
  const v = cache.get(id);
  if (!v) {
    c.innerHTML = `<section class="tarjeta"><p class="vacio">Vehículo no encontrado en la réplica local.</p><a class="btn" href="#/vehiculos">Volver</a></section>`;
    return { reactiva: true };
  }
  const cli = cache.get(v.cliente_id);
  const ordenes = ordenesDe(id);
  const alertas = alertasVigentes(id);

  c.innerHTML = `
    <section class="tarjeta cabecera-vehiculo">
      <div>
        <h1 class="placa grande">${h(v.placa)}</h1>
        <p>${h(v.marca)} ${h(v.modelo)} ${h(v.anio ?? '')} · VIN ${h(v.vin || '—')}</p>
        <p><b>${km(kmActual(v))}</b> · uso estimado ${h(v.km_diario_estimado ?? 40)} km/día</p>
        <p>👤 ${h(cli?.nombre ?? 'Sin cliente')} · 📞 ${h(cli?.telefono ?? '—')}</p>
        ${v._conflicts?.length ? `<p>${badge('vencida')} Este vehículo tiene ediciones en conflicto. <a href="#/sync">Resolver</a></p>` : ''}
        <div class="fila">
          <a class="btn btn-grande" href="#/orden/${encodeURIComponent(id)}">＋ Nueva orden de servicio</a>
          <button class="btn btn-sec" id="editar">✏️ Editar datos</button>
        </div>
      </div>
      <div class="qr"><canvas id="qr"></canvas><small>QR para el parabrisas</small></div>
    </section>
    <section class="tarjeta oculto" id="edicion">
      <h2>Editar vehículo</h2>
      <form id="fed" class="formulario">
        <label>Kilometraje registrado<input id="ed-km" type="number" value="${h(v.kilometraje_actual ?? 0)}" /></label>
        <label>Km diarios aprox.<input id="ed-kmdia" type="number" value="${h(v.km_diario_estimado ?? 40)}" /></label>
        <label>Notas<textarea id="ed-notas">${h(v.notas ?? '')}</textarea></label>
        <button class="btn">Guardar</button>
      </form>
    </section>
    <section class="tarjeta">
      <h2>Próximos mantenimientos</h2>
      ${alertas.length ? `<div class="tabla-scroll"><table>
        <thead><tr><th>Servicio</th><th>Fecha programada</th><th>Km programado</th><th>Estado</th><th></th></tr></thead>
        <tbody>${alertas.map((a) => `<tr>
          <td>${h(a.nombre_servicio)}</td><td>${fecha(a.fecha_programada)}</td>
          <td>${a.km_programado ? km(a.km_programado) : '—'}</td>
          <td>${badge(a.estado)} ${a.estado_envio === 'enviada' ? badge('enviada') : ''}</td>
          <td><button class="btn btn-wa" data-wa="${h(a._id)}">WhatsApp</button></td></tr>`).join('')}
        </tbody></table></div>` : '<p class="vacio">Sin alertas. Se generan al procesar una orden.</p>'}
    </section>
    <section class="tarjeta">
      <h2>Historial de servicios (${ordenes.length})</h2>
      ${ordenes.map((o) => `<article class="orden">
        <header><b>${fecha(o.fecha)}</b> · ${km(o.kilometraje)} · ${h(o.mecanico)}
          <span class="der">${badge(o.estado_backend ?? 'pendiente')} <b>${dinero(o.costo_total)}</b></span></header>
        <div>${(o.servicios ?? []).map((s: any) => `<span class="chip">${h(nombreServicio(s.tipo))}</span>`).join('')}</div>
        ${(o.repuestos_usados ?? []).length ? `<small>Repuestos: ${o.repuestos_usados.map((r: any) => `${h(r.descripcion)} ×${h(r.cantidad)}`).join(', ')}</small>` : ''}
        ${o.observaciones ? `<p><small>📝 ${h(o.observaciones)}</small></p>` : ''}
        ${o.errores ? `<p class="error">${o.errores.map(h).join('<br>')}</p>` : ''}
        ${!o.estado_backend && estado.pendientes.has(o._id) ? '<small class="ayuda">Guardada en la tableta; se enviará al volver la conexión y Rust generará sus alertas.</small>' : ''}
      </article>`).join('') || '<p class="vacio">Sin órdenes registradas.</p>'}
    </section>`;

  QRCode.toCanvas($('#qr', c) as HTMLCanvasElement, v.placa, { width: 132, margin: 1 }).catch(() => {});
  c.querySelectorAll<HTMLButtonElement>('[data-wa]').forEach((b) => b.addEventListener('click', () => notificarAlerta(b.dataset.wa!)));
  $('#editar', c).addEventListener('click', () => $('#edicion', c).classList.toggle('oculto'));
  $('#fed', c).addEventListener('submit', async (e) => {
    e.preventDefault();
    const actual = cache.get(id)!;
    await guardar({
      ...actual,
      kilometraje_actual: Number(($('#ed-km', c) as HTMLInputElement).value) || 0,
      km_diario_estimado: Number(($('#ed-kmdia', c) as HTMLInputElement).value) || 40,
      notas: ($('#ed-notas', c) as HTMLTextAreaElement).value,
    });
    aviso('Vehículo actualizado');
  });
  return { reactiva: true };
}
