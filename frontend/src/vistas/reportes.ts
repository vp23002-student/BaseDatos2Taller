import { api, estado } from '../db';
import { h } from '../ui';

export function vistaReportes(c: HTMLElement) {
  c.innerHTML = `
    <section class="tarjeta">
      <h2>Tasa de retorno de clientes (hipótesis de negocio H₂)</h2>
      <p class="ayuda">Instrumento para el estudio de campo: compara si los clientes notificados por WhatsApp
      regresan más que los no notificados. La meta del proyecto es +25 % a los 6 meses.</p>
      <div id="retorno">Cargando…</div>
    </section>
    <section class="tarjeta">
      <h2>Telemetría del backend en Rust</h2>
      <div id="metricas">Cargando…</div>
    </section>`;

  if (!estado.enLinea || estado.modoSinConexion) {
    c.querySelectorAll('#retorno, #metricas').forEach((e) => (e.innerHTML = '<p class="vacio">Requiere conexión con el servidor.</p>'));
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

  fetch('/api/metricas').then((r) => r.json()).then((m) => {
    const filas = Object.entries(m.endpoints as Record<string, any>).sort((a, b) => b[1].conteo - a[1].conteo);
    c.querySelector('#metricas')!.innerHTML = `
      <div class="kpis"><div class="kpi"><b>${m.memoria_rss_mb.toFixed(1)} MB</b><span>RAM (RSS)</span></div>
      <div class="kpi"><b>${m.hilos}</b><span>Hilos</span></div>
      <div class="kpi"><b>${m.listener.ordenes_procesadas}</b><span>Órdenes procesadas del changes feed</span></div>
      <div class="kpi"><b>${m.listener.promedio_procesamiento_ms.toFixed(2)} ms</b><span>Procesamiento promedio</span></div></div>
      <div class="tabla-scroll"><table><thead><tr><th>Endpoint</th><th>Peticiones</th><th>p50</th><th>p95</th><th>p99</th></tr></thead><tbody>
      ${filas.map(([k, v]) => `<tr><td><code>${h(k)}</code></td><td>${v.conteo}</td><td>${v.p50_ms.toFixed(2)} ms</td><td>${v.p95_ms.toFixed(2)} ms</td><td>${v.p99_ms.toFixed(2)} ms</td></tr>`).join('')}
      </tbody></table></div>`;
  }).catch((e) => (c.querySelector('#metricas')!.textContent = e.message));
  return { reactiva: false };
}
