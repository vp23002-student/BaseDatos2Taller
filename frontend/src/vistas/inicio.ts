import { notificarAlerta } from '../acciones';
import { cache, type Doc } from '../db';
import { alertasVigentes, cuando, diasHasta, km, kmActual, normalizarPlaca, porTipo, stockActual } from '../logica';
import { $, h, pieLista } from '../ui';

let limite = 8;

export function vistaInicio(c: HTMLElement) {
  // Solo lo que hay que atender: vencidos + hoy, mañana y pasado mañana.
  const agenda = alertasVigentes().filter((a) => diasHasta(a.fecha_programada) <= 2);
  const cuenta = (f: (d: number) => boolean) => agenda.filter((a) => f(diasHasta(a.fecha_programada))).length;
  const bajos = porTipo('repuesto').filter((r) => stockActual(r) <= r.minimo_reorden);
  const lista = agenda.slice(0, limite);

  c.innerHTML = `
    <section class="tarjeta">
      <h2>¿Qué carro llegó?</h2>
      <input id="placa-rapida" placeholder="Escriba la placa, ej. P900037" autocomplete="off" />
      <div id="res-placa"></div>
    </section>

    <section class="kpis">
      <div class="kpi kpi-rojo"><b>${cuenta((d) => d < 0)}</b><span>Vencidos</span></div>
      <div class="kpi kpi-amarillo"><b>${cuenta((d) => d === 0)}</b><span>Hoy</span></div>
      <div class="kpi"><b>${cuenta((d) => d === 1)}</b><span>Mañana</span></div>
      <div class="kpi"><b>${cuenta((d) => d === 2)}</b><span>Pasado mañana</span></div>
    </section>

    <section class="tarjeta">
      <h2>Clientes a avisar</h2>
      ${lista.length === 0 ? '<p class="vacio">Nada pendiente para estos días 🎉</p>' : `
      <div class="tabla-scroll"><table>
        <thead><tr><th>Placa</th><th>Cliente</th><th>Servicio</th><th>Cuándo</th><th></th></tr></thead>
        <tbody>${lista.map((a) => {
          const cli = cache.get(a.cliente_id ?? '');
          const d = diasHasta(a.fecha_programada);
          return `<tr>
            <td><a href="#/vehiculo/${encodeURIComponent(a.vehiculo_id)}"><b class="placa">${h(a.placa)}</b></a></td>
            <td>${h(cli?.nombre ?? '—')}</td>
            <td>${h(a.nombre_servicio)}</td>
            <td><span class="badge ${d < 0 ? 'badge-vencida' : 'badge-proxima'}">${h(cuando(a.fecha_programada))}</span></td>
            <td>${a.estado_envio === 'enviada'
              ? '<span class="badge badge-enviada">✔ Avisado</span>'
              : `<button class="btn btn-wa" data-wa="${h(a._id)}">WhatsApp</button>`}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>${pieLista(lista.length, agenda.length)}`}
    </section>

    ${bajos.length ? `<section class="tarjeta">
      <h2>Repuestos por comprar</h2>
      <ul class="lista">${bajos.map((r) => `<li><b>${h(r.descripcion)}</b> — quedan ${stockActual(r)} (mínimo ${r.minimo_reorden})</li>`).join('')}</ul>
    </section>` : ''}`;

  // Búsqueda rápida: placa -> ver ficha o abrir orden directo.
  const inp = $('#placa-rapida', c) as HTMLInputElement;
  const pintar = () => {
    const f = normalizarPlaca(inp.value);
    const vs: Doc[] = f ? porTipo('vehiculo').filter((v) => v.placa.includes(f)).slice(0, 5) : [];
    $('#res-placa', c).innerHTML = !f ? '' : vs.length
      ? vs.map((v) => `<div class="resultado">
          <span><b class="placa">${h(v.placa)}</b> ${h(v.marca)} ${h(v.modelo)} · ${h(cache.get(v.cliente_id)?.nombre ?? '')} · ${km(kmActual(v))}</span>
          <a class="btn" href="#/orden/${encodeURIComponent(v._id)}">🔧 Nueva orden</a>
          <a class="btn btn-sec" href="#/vehiculo/${encodeURIComponent(v._id)}">Ver ficha</a></div>`).join('')
      : `<p class="ayuda">No está registrada. <a href="#/vehiculos/nuevo/${encodeURIComponent(f)}">Registrar ${h(f)}</a></p>`;
  };
  inp.addEventListener('input', pintar);
  inp.addEventListener('keydown', (e) => {
    const primero = c.querySelector<HTMLAnchorElement>('#res-placa .btn');
    if (e.key === 'Enter' && primero) location.hash = primero.getAttribute('href')!;
  });

  c.querySelectorAll<HTMLButtonElement>('[data-wa]').forEach((b) =>
    b.addEventListener('click', () => notificarAlerta(b.dataset.wa!)),
  );
  c.querySelector('[data-mas]')?.addEventListener('click', () => { limite += 10; vistaInicio(c); });
  return { reactiva: true };
}
