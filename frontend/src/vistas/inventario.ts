import { esAdmin, guardar, type Doc } from '../db';
import { escanear } from '../escaner';
import { dinero, nuevoId, porTipo, stockActual } from '../logica';
import { $, aviso, h, pieLista } from '../ui';

let filtro = '';
let limite = 15;

export function vistaInventario(c: HTMLElement) {
  const admin = esAdmin();
  c.innerHTML = `
    <section class="tarjeta">
      <h2>Inventario de repuestos</h2>
      <div class="fila">
        <input id="filtro" placeholder="Buscar por nombre o código" value="${h(filtro)}" autocomplete="off" />
        <button class="btn btn-sec" id="esc">📷 Código de barras</button>
      </div>
      <div id="tabla"></div>
      ${admin ? '' : '<p class="ayuda">Las entradas de mercadería las registra el usuario <b>jefe</b>.</p>'}
    </section>`;

  const pintar = () => {
    const f = filtro.toLowerCase();
    const todos = porTipo('repuesto')
      .map((r) => ({ ...r, stock: stockActual(r) }) as Doc)
      .filter((r) => !f || `${r.descripcion} ${r.codigo_barras}`.toLowerCase().includes(f))
      // lo que falta primero
      .sort((a, b) => Number(b.stock <= b.minimo_reorden) - Number(a.stock <= a.minimo_reorden) || a.descripcion.localeCompare(b.descripcion));
    const rs = todos.slice(0, limite);
    $('#tabla', c).innerHTML = `<div class="tabla-scroll"><table>
      <thead><tr><th>Repuesto</th><th>Hay</th><th>Mínimo</th><th>Precio</th>${admin ? '<th></th>' : ''}</tr></thead>
      <tbody>${rs.map((r) => `<tr class="${r.stock <= r.minimo_reorden ? 'fila-alerta' : ''}">
        <td>${h(r.descripcion)}<br><small><code>${h(r.codigo_barras)}</code></small></td>
        <td><b>${r.stock}</b></td><td>${h(r.minimo_reorden)}</td><td>${dinero(r.precio)}</td>
        ${admin ? `<td><button class="btn btn-sec" data-entrada="${h(r._id)}">＋ Entrada</button></td>` : ''}
      </tr>`).join('') || `<tr><td colspan="5" class="vacio">Sin resultados</td></tr>`}</tbody>
    </table></div>${pieLista(rs.length, todos.length)}`;
    c.querySelector('[data-mas]')?.addEventListener('click', () => { limite += 15; pintar(); });
    c.querySelectorAll<HTMLButtonElement>('[data-entrada]').forEach((b) =>
      b.addEventListener('click', async () => {
        const cant = Number(prompt('¿Cuántas unidades entraron?', '10'));
        if (!(cant > 0)) return;
        await guardar({ _id: nuevoId('movimiento'), tipo: 'movimiento', repuesto_id: b.dataset.entrada, cantidad: cant, motivo: 'entrada', fecha: new Date().toISOString() });
        aviso('Entrada registrada');
      }),
    );
  };
  pintar();

  const inp = $('#filtro', c) as HTMLInputElement;
  inp.addEventListener('input', () => { filtro = inp.value; limite = 15; pintar(); });
  $('#esc', c).addEventListener('click', async () => {
    const v = await escanear('Escanear código del repuesto');
    if (v) { filtro = v; inp.value = v; pintar(); }
  });
  return { reactiva: true };
}
