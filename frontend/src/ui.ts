// Utilidades de interfaz: escape de HTML (evita XSS), avisos y diálogos.

export function h(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function aviso(texto: string, tipo: 'ok' | 'error' | 'info' = 'ok') {
  const el = document.createElement('div');
  el.className = `aviso aviso-${tipo}`;
  el.textContent = texto;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('visible'), 10);
  setTimeout(() => {
    el.classList.remove('visible');
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

export function badge(estado: string): string {
  const textos: Record<string, string> = {
    vencida: 'Vencida', proxima: 'Próxima', programada: 'Programada',
    procesada: '✔ Procesada', rechazada: '✖ Rechazada', pendiente: '⏳ Pendiente de sincronizar',
    enviada: '📨 Notificada',
  };
  return `<span class="badge badge-${h(estado)}">${h(textos[estado] ?? estado)}</span>`;
}

/** Pie de lista: "Mostrando 10 de 42" + botón para ver más. */
export function pieLista(mostrados: number, total: number): string {
  if (total <= mostrados) return '';
  return `<div class="pie-lista"><small>Mostrando ${mostrados} de ${total}. Escriba para filtrar.</small>
    <button type="button" class="btn btn-sec" data-mas>Ver más</button></div>`;
}

export function $(sel: string, raiz: ParentNode = document): HTMLElement {
  const el = raiz.querySelector(sel);
  if (!el) throw new Error(`No existe ${sel}`);
  return el as HTMLElement;
}

export function valor(sel: string, raiz: ParentNode = document): string {
  return ($(sel, raiz) as HTMLInputElement).value.trim();
}
