import { cache, estado, guardar } from '../db';
import { escanear } from '../escaner';
import { catalogo, dinero, hoyISO, km, kmActual, normalizarPlaca, nuevoId, porTipo, stockActual } from '../logica';
import { $, aviso, h, valor } from '../ui';

type Linea = { repuesto_id: string; codigo_barras: string; descripcion: string; cantidad: number; precio_unitario: number };

export function vistaOrden(c: HTMLElement, [vehiculoInicial]: string[]) {
  const reglas = catalogo();
  const repuestos = porTipo('repuesto');
  let vehiculo = vehiculoInicial ? cache.get(vehiculoInicial) : undefined;
  const lineas: Linea[] = [];

  c.innerHTML = `
    <section class="tarjeta">
      <h2>Nueva orden de servicio</h2>
      <form id="fo" class="formulario">
        <fieldset><legend>Vehículo</legend>
          <div class="fila">
            <input id="placa" list="placas" placeholder="Placa" value="${h(vehiculo?.placa ?? '')}" autocomplete="off" />
            <button type="button" class="btn btn-sec" id="esc-placa">📷 Escanear</button>
          </div>
          <datalist id="placas">${porTipo('vehiculo').map((v) => `<option value="${h(v.placa)}">`).join('')}</datalist>
          <p id="info-veh" class="ayuda"></p>
          <label>Kilometraje actual (odómetro)<input id="km" type="number" min="1" required /></label>
          <label>Fecha<input id="fecha" type="date" value="${hoyISO()}" required /></label>
        </fieldset>
        <fieldset><legend>Servicios realizados</legend>
          <div class="servicios">${reglas.map((r) => `
            <label class="servicio"><input type="checkbox" value="${h(r.tipo)}" />
              <span>${h(r.nombre)}<small>${r.intervalo_km ? `c/${km(r.intervalo_km)}` : ''}${r.intervalo_km && r.intervalo_meses ? ' o ' : ''}${r.intervalo_meses ? `${r.intervalo_meses} meses` : ''}</small></span>
              <input type="number" class="costo" step="0.01" min="0" value="${r.precio_mano_obra}" title="Mano de obra" />
            </label>`).join('')}
          </div>
        </fieldset>
        <fieldset><legend>Repuestos utilizados</legend>
          <div class="fila">
            <select id="sel-rep"><option value="">— Elegir repuesto —</option>
              ${repuestos.map((r) => `<option value="${h(r._id)}">${h(r.descripcion)} (${stockActual(r)} disp.)</option>`).join('')}
            </select>
            <button type="button" class="btn btn-sec" id="add-rep">Agregar</button>
            <button type="button" class="btn btn-sec" id="esc-rep">📷 Escanear código</button>
          </div>
          <div id="lineas"></div>
        </fieldset>
        <label>Observaciones del mecánico<textarea id="obs" rows="2"></textarea></label>
        <div class="total">Total: <b id="total">$0.00</b></div>
        <button class="btn btn-grande">💾 Guardar orden (funciona sin conexión)</button>
      </form>
    </section>`;

  const pintarVehiculo = () => {
    const p = normalizarPlaca(valor('#placa', c));
    vehiculo = cache.get(`vehiculo:${p}`);
    const info = $('#info-veh', c);
    if (vehiculo) {
      const cli = cache.get(vehiculo.cliente_id);
      info.innerHTML = `✔ ${h(vehiculo.marca)} ${h(vehiculo.modelo)} · ${h(cli?.nombre ?? '')} · último registro ${km(kmActual(vehiculo))}`;
      ($('#km', c) as HTMLInputElement).min = String(kmActual(vehiculo));
    } else info.textContent = p ? 'Placa no registrada (regístrela en Vehículos)' : '';
  };
  const total = () => {
    let t = 0;
    c.querySelectorAll<HTMLLabelElement>('.servicio').forEach((l) => {
      if ((l.querySelector('input[type=checkbox]') as HTMLInputElement).checked) t += Number((l.querySelector('.costo') as HTMLInputElement).value) || 0;
    });
    lineas.forEach((x) => (t += x.cantidad * x.precio_unitario));
    $('#total', c).textContent = dinero(t);
    return Math.round(t * 100) / 100;
  };
  const pintarLineas = () => {
    $('#lineas', c).innerHTML = lineas.map((x, i) => `
      <div class="linea"><span>${h(x.descripcion)}</span>
        <input type="number" min="1" value="${x.cantidad}" data-cant="${i}" />
        <span>${dinero(x.precio_unitario)}</span>
        <button type="button" class="btn btn-sec" data-quitar="${i}">✕</button></div>`).join('');
    c.querySelectorAll<HTMLInputElement>('[data-cant]').forEach((inp) =>
      inp.addEventListener('input', () => { lineas[Number(inp.dataset.cant)].cantidad = Math.max(1, Number(inp.value) || 1); total(); }));
    c.querySelectorAll<HTMLButtonElement>('[data-quitar]').forEach((b) =>
      b.addEventListener('click', () => { lineas.splice(Number(b.dataset.quitar), 1); pintarLineas(); }));
    total();
  };
  const agregar = (repId: string) => {
    const r = cache.get(repId);
    if (!r) return aviso('Repuesto no encontrado', 'error');
    const ya = lineas.find((x) => x.repuesto_id === repId);
    if (ya) ya.cantidad++;
    else lineas.push({ repuesto_id: r._id, codigo_barras: r.codigo_barras, descripcion: r.descripcion, cantidad: 1, precio_unitario: Number(r.precio) || 0 });
    if (stockActual(r) <= 0) aviso(`Atención: ${r.descripcion} sin existencias registradas`, 'info');
    pintarLineas();
  };

  pintarVehiculo();
  $('#placa', c).addEventListener('input', pintarVehiculo);
  $('#esc-placa', c).addEventListener('click', async () => {
    const v = await escanear('Escanear placa o QR del vehículo');
    if (v) { ($('#placa', c) as HTMLInputElement).value = normalizarPlaca(v); pintarVehiculo(); }
  });
  c.querySelectorAll('.servicio input').forEach((i) => i.addEventListener('input', total));
  $('#add-rep', c).addEventListener('click', () => { const v = valor('#sel-rep', c); if (v) agregar(v); });
  $('#esc-rep', c).addEventListener('click', async () => {
    const cod = await escanear('Escanear código de barras del repuesto');
    if (cod) agregar(`repuesto:${cod}`);
  });

  $('#fo', c).addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      if (!vehiculo) throw new Error('Seleccione un vehículo registrado');
      const kilometraje = Number(valor('#km', c));
      if (!(kilometraje > 0)) throw new Error('Ingrese el kilometraje');
      if (kilometraje < kmActual(vehiculo) && !confirm('El kilometraje es menor al último registrado. ¿Guardar de todos modos?')) return;
      const servicios: any[] = [];
      c.querySelectorAll<HTMLLabelElement>('.servicio').forEach((l) => {
        const chk = l.querySelector('input[type=checkbox]') as HTMLInputElement;
        if (chk.checked) servicios.push({ tipo: chk.value, descripcion: '', costo: Number((l.querySelector('.costo') as HTMLInputElement).value) || 0 });
      });
      if (!servicios.length) throw new Error('Marque al menos un servicio');
      const id = nuevoId('orden');
      await guardar({
        _id: id, tipo: 'orden_servicio', vehiculo_id: vehiculo._id, cliente_id: vehiculo.cliente_id,
        fecha: valor('#fecha', c), kilometraje, servicios, repuestos_usados: lineas,
        mecanico: estado.sesion?.usuario ?? '', observaciones: valor('#obs', c),
        costo_total: total(), estado: 'completada',
        creada_sin_conexion: !estado.enLinea, creada_en: new Date().toISOString(),
        dispositivo: navigator.userAgent.slice(0, 80),
      });
      aviso(estado.enLinea ? 'Orden guardada y enviándose al servidor' : 'Orden guardada en la tableta (sin conexión)');
      location.hash = `#/vehiculo/${encodeURIComponent(vehiculo._id)}`;
    } catch (err: any) {
      aviso(err.message, 'error');
    }
  });
  return { reactiva: false };
}
