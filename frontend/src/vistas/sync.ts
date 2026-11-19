import { alternarSinConexion, cache, estado, infoLocal, obtenerRevision, resolverConflicto } from '../db';
import { $, aviso, h } from '../ui';

export function vistaSync(c: HTMLElement) {
  const conflictos = [...cache.values()].filter((d) => d._conflicts?.length);
  c.innerHTML = `
    <section class="tarjeta">
      <h2>Sincronización</h2>
      <div class="kpis">
        <div class="kpi ${estado.enLinea ? 'kpi-verde' : 'kpi-rojo'}"><b>${estado.enLinea ? 'En línea' : 'Sin conexión'}</b><span>${estado.sincronizando ? 'replicando…' : `última sync ${h(estado.ultimaSync || '—')}`}</span></div>
        <div class="kpi"><b>${estado.pendientes.size}</b><span>Cambios locales por subir</span></div>
        <div class="kpi"><b id="ndocs">…</b><span>Documentos en la tableta</span></div>
        <div class="kpi ${conflictos.length ? 'kpi-amarillo' : ''}"><b>${conflictos.length}</b><span>Conflictos</span></div>
      </div>
      <label class="interruptor"><input type="checkbox" id="offline" ${estado.modoSinConexion ? 'checked' : ''} />
        <span>Simular corte de internet (para la demostración)</span></label>
      <p class="ayuda">Con el corte activado se puede seguir trabajando: todo se guarda en la tableta y se sube al quitarlo.</p>
    </section>
    <section class="tarjeta">
      <h2>Conflictos de edición</h2>
      <p class="ayuda">Aparecen si dos tabletas editan lo mismo sin internet. Elija qué versión se queda.</p>
      <div id="conf">${conflictos.length ? '' : '<p class="vacio">Sin conflictos.</p>'}</div>
    </section>
    <section class="tarjeta">
      <h2>Últimos eventos</h2>
      <ul class="bitacora">${estado.log.slice(0, 15).map((l) => `<li class="log-${l.tipo}"><small>${h(l.hora)}</small> ${h(l.texto)}</li>`).join('') || '<li>Sin eventos</li>'}</ul>
    </section>`;

  infoLocal().then((i) => { const el = c.querySelector('#ndocs'); if (el && i) el.textContent = String(i.doc_count); });
  $('#offline', c).addEventListener('change', (e) => alternarSinConexion((e.target as HTMLInputElement).checked));

  const cont = $('#conf', c);
  conflictos.forEach(async (d) => {
    const revs = [d._rev!, ...d._conflicts!];
    const versiones = await Promise.all(revs.map((r) => obtenerRevision(d._id, r)));
    const caja = document.createElement('div');
    caja.className = 'conflicto';
    caja.innerHTML = `<h3>${h(d._id)}</h3><div class="versiones">${versiones.map((v, i) => {
      const { _id, _rev, _conflicts, ...resto } = v as any;
      return `<div class="version"><b>${i === 0 ? 'Ganadora actual' : 'Alternativa'}</b> <small>${h(_rev)}</small>
        <pre>${h(JSON.stringify(resto, null, 1))}</pre>
        <button class="btn" data-rev="${h(_rev)}">Conservar esta versión</button></div>`;
    }).join('')}</div>`;
    caja.querySelectorAll<HTMLButtonElement>('[data-rev]').forEach((b) =>
      b.addEventListener('click', async () => {
        await resolverConflicto(d._id, b.dataset.rev!);
        aviso('Conflicto resuelto');
      }),
    );
    cont.appendChild(caja);
  });
  return { reactiva: true };
}
