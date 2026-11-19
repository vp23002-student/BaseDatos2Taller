import { notificarAlerta } from '../acciones';
import { cache, estado, guardar } from '../db';
import { alertasVigentes, cuando, dinero, fecha, km, kmActual, nombreServicio, ordenesDe } from '../logica';
import { $, aviso, badge, h } from '../ui';

let verTodo = false;

export function vistaVehiculo(c: HTMLElement, [id]: string[]) {
  const v = cache.get(id);
  if (!v) {
    c.innerHTML = `<section class="tarjeta"><p class="vacio">Vehículo no encontrado.</p><a class="btn" href="#/vehiculos">Volver</a></section>`;
    return { reactiva: true };
  }
  const cli = cache.get(v.cliente_id);
  const ordenes = ordenesDe(id);
  const visibles = verTodo ? ordenes : ordenes.slice(0, 3);
  const alertas = alertasVigentes(id);

  c.innerHTML = `
    <section class="tarjeta">
      <h1 class="placa grande">${h(v.placa)}</h1>
      <p>${h(v.marca)} ${h(v.modelo)} ${h(v.anio ?? '')} · <b>${km(kmActual(v))}</b></p>
      <p>👤 ${h(cli?.nombre ?? 'Sin cliente')} · 📞 ${h(cli?.telefono ?? '—')}</p>
      ${v._conflicts?.length ? `<p>${badge('vencida')} Editado en dos tabletas a la vez. <a href="#/sync">Resolver</a></p>` : ''}
      <div class="fila">
        <a class="btn btn-grande" href="#/orden/${encodeURIComponent(id)}">🔧 Nueva orden de servicio</a>
      </div>
      <button class="btn-link oscuro" id="editar">Corregir kilometraje / notas</button>
      <form id="fed" class="formulario oculto">
        <div class="dos-col">
          <label>Kilometraje registrado<input id="ed-km" type="number" value="${h(v.kilometraje_actual ?? 0)}" /></label>
          <label>Notas<input id="ed-notas" value="${h(v.notas ?? '')}" /></label>
        </div>
        <button class="btn">Guardar</button>
      </form>
    </section>
    <section class="tarjeta">
      <h2>Próximos mantenimientos</h2>
      ${alertas.length ? `<div class="tabla-scroll"><table>
        <thead><tr><th>Servicio</th><th>Cuándo</th><th>o al llegar a</th><th></th></tr></thead>
        <tbody>${alertas.map((a) => `<tr>
          <td>${h(a.nombre_servicio)}</td>
          <td><span class="badge badge-${a.estado}">${h(cuando(a.fecha_programada))}</span></td>
          <td>${a.km_programado ? km(a.km_programado) : '—'}</td>
          <td>${a.estado_envio === 'enviada' ? '<span class="badge badge-enviada">✔ Avisado</span>'
            : `<button class="btn btn-wa" data-wa="${h(a._id)}">WhatsApp</button>`}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="vacio">Sin mantenimientos programados. Se calculan al guardar una orden.</p>'}
    </section>
    <section class="tarjeta">
      <h2>Historial (${ordenes.length})</h2>
      ${visibles.map((o) => `<article class="orden">
        <header><b>${fecha(o.fecha)}</b> · ${km(o.kilometraje)}
          <span class="der">${o.estado_backend === 'rechazada' ? badge('rechazada') : !o.estado_backend ? badge('pendiente') : ''} <b>${dinero(o.costo_total)}</b></span></header>
        <div>${(o.servicios ?? []).map((s: any) => `<span class="chip">${h(nombreServicio(s.tipo))}</span>`).join('')}</div>
        ${(o.repuestos_usados ?? []).length ? `<small>Repuestos: ${o.repuestos_usados.map((r: any) => `${h(r.descripcion)} ×${h(r.cantidad)}`).join(', ')}</small>` : ''}
        ${o.observaciones ? `<p><small>📝 ${h(o.observaciones)}</small></p>` : ''}
        ${o.errores ? `<p class="error">${o.errores.map(h).join('<br>')}</p>` : ''}
        ${!o.estado_backend && estado.pendientes.has(o._id) ? '<small class="ayuda">Guardada en la tableta; se enviará al volver la conexión.</small>' : ''}
      </article>`).join('') || '<p class="vacio">Sin órdenes todavía.</p>'}
      ${ordenes.length > 3 ? `<button class="btn btn-sec" id="ver-todo">${verTodo ? 'Ver menos' : `Ver las ${ordenes.length} órdenes`}</button>` : ''}
    </section>`;

  c.querySelectorAll<HTMLButtonElement>('[data-wa]').forEach((b) => b.addEventListener('click', () => notificarAlerta(b.dataset.wa!)));
  c.querySelector('#ver-todo')?.addEventListener('click', () => { verTodo = !verTodo; vistaVehiculo(c, [id]); });
  $('#editar', c).addEventListener('click', () => $('#fed', c).classList.toggle('oculto'));
  $('#fed', c).addEventListener('submit', async (e) => {
    e.preventDefault();
    const actual = cache.get(id)!;
    await guardar({
      ...actual,
      kilometraje_actual: Number(($('#ed-km', c) as HTMLInputElement).value) || 0,
      notas: ($('#ed-notas', c) as HTMLInputElement).value,
    });
    aviso('Vehículo actualizado');
  });
  return { reactiva: true };
}
