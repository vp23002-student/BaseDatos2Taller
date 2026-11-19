import { api, estado } from '../db';
import { h } from '../ui';

export function vistaReportes(c: HTMLElement) {
  c.innerHTML = `
    <section class="tarjeta">
      <h2>¿Regresan los clientes?</h2>
      <p class="ayuda">Compara a los clientes avisados por WhatsApp con los no avisados. Meta: +25 % de retorno a los 6 meses.</p>
      <div id="retorno">Cargando…</div>
    </section>`;

  if (!estado.enLinea || estado.modoSinConexion) {
    c.querySelectorAll('#retorno').forEach((e) => (e.innerHTML = '<p class="vacio">Requiere conexión con el servidor.</p>'));
    return { reactiva: false };
  }

  api('/reportes/retorno').then((r) => {
    const fila = (t: string, o: any) => `<tr><td>${t}</td><td>${o.total}</td><td>${o.retornaron}</td><td><b>${o.tasa_pct ?? '—'}${o.tasa_pct != null ? ' %' : ''}</b></td></tr>`;
    c.querySelector('#retorno')!.innerHTML = `
      <div class="kpis"><div class="kpi kpi-verde"><b>${r.tasa_retorno_pct ?? '—'} %</b><span>Tasa global de retorno</span></div>
      <div class="kpi"><b>${r.evaluables}</b><span>Órdenes evaluables</span></div>
      <div class="kpi"><b>${r.ventana_abierta}</b><span>Ventana aún abierta</span></div></div>
      <table><thead><tr><th>Grupo</th><th>Total</th><th>Retornaron</th><th>Tasa</th></tr></thead><tbody>
      ${fila('Con notificación', r.con_notificacion)}${fila('Sin notificación', r.sin_notificacion)}</tbody></table>
      <p class="ayuda">${h(r.definicion)} (tolerancia ${r.tolerancia_dias} días).</p>`;
  }).catch((e) => (c.querySelector('#retorno')!.textContent = e.message));

  return { reactiva: false };
}
