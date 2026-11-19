import { esAdmin, guardar, type Doc } from '../db';
import { escanear } from '../escaner';
import { dinero, nuevoId, porTipo, stockActual } from '../logica';
import { $, aviso, h } from '../ui';

let filtro = '';

export function vistaInventario(c: HTMLElement) {
  const admin = esAdmin();
  const repuestos = porTipo('repuesto')
    .map((r) => ({ ...r, stock: stockActual(r) }) as Doc)
    .filter((r) => !filtro || `${r.descripcion} ${r.codigo_barras}`.toLowerCase().includes(filtro.toLowerCase()))
    .sort((a, b) => a.descripcion.localeCompare(b.descripcion));

  c.innerHTML = `
    <section class="tarjeta">
      <h2>Inventario de repuestos</h2>
      <p class="ayuda">Existencia = inicial − usados en órdenes + entradas. Se calcula con una vista map/reduce
      (sin actualizar un contador compartido), así dos tabletas sin conexión nunca chocan.</p>
      <div class="fila">
        <input id="filtro" placeholder="Buscar por nombre o código" value="${h(filtro)}" />
        <button class="btn" id="esc">📷 Escanear código</button>
      </div>
      <div class="tabla-scroll"><table>
        <thead><tr><th>Código</th><th>Descripción</th><th>Existencia</th><th>Mínimo</th><th>Precio</th><th>Proveedor</th>${admin ? '<th></th>' : ''}</tr></thead>
        <tbody>${repuestos.map((r) => `<tr class="${r.stock <= r.minimo_reorden ? 'fila-alerta' : ''}">
          <td><code>${h(r.codigo_barras)}</code></td><td>${h(r.descripcion)}</td>
          <td><b>${r.stock}</b></td><td>${h(r.minimo_reorden)}</td><td>${dinero(r.precio)}</td><td>${h(r.proveedor)}</td>
          ${admin ? `<td><button class="btn btn-sec" data-entrada="${h(r._id)}">＋ Entrada</button></td>` : ''}
        </tr>`).join('')}</tbody>
      </table></div>
      ${admin ? '' : '<p class="ayuda">Las entradas de inventario solo las registra el rol <b>admin</b> (RBAC en CouchDB).</p>'}
    </section>`;

  const inp = $('#filtro', c) as HTMLInputElement;
  inp.addEventListener('change', () => { filtro = inp.value; vistaInventario(c); });
  $('#esc', c).addEventListener('click', async () => {
    const v = await escanear('Escanear repuesto');
    if (v) { filtro = v; vistaInventario(c); }
  });
  c.querySelectorAll<HTMLButtonElement>('[data-entrada]').forEach((b) =>
    b.addEventListener('click', async () => {
      const cant = Number(prompt('Cantidad que ingresa al inventario:', '10'));
      if (!(cant > 0)) return;
      await guardar({ _id: nuevoId('movimiento'), tipo: 'movimiento', repuesto_id: b.dataset.entrada, cantidad: cant, motivo: 'entrada', fecha: new Date().toISOString() });
      aviso('Entrada registrada');
    }),
  );
  return { reactiva: true };
}
