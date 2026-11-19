import { cache, guardar } from '../db';
import { alertasVigentes, km, kmActual, normalizarPlaca, nuevoId, porTipo } from '../logica';
import { $, aviso, h, pieLista, valor } from '../ui';

let filtro = '';
let limite = 10;

export function vistaVehiculos(c: HTMLElement, [accion, placaNueva]: string[]) {
  c.innerHTML = `
    <section class="tarjeta">
      <h2>Vehículos</h2>
      <div class="fila">
        <input id="busqueda" placeholder="Buscar por placa, marca o cliente" value="${h(filtro)}" autocomplete="off" />
        <button class="btn" id="nuevo">＋ Registrar vehículo</button>
      </div>
      <div id="resultados"></div>
    </section>
    <section class="tarjeta oculto" id="form-nuevo"></section>`;

  const pintar = () => {
    const texto = filtro.trim().toLowerCase();
    const placa = normalizarPlaca(filtro);
    const todos = porTipo('vehiculo')
      .filter((v) => {
        if (!texto) return true;
        const cli = cache.get(v.cliente_id)?.nombre ?? '';
        return (placa && v.placa.includes(placa)) || `${v.marca} ${v.modelo} ${cli}`.toLowerCase().includes(texto);
      })
      .sort((a, b) => a.placa.localeCompare(b.placa));
    const vs = todos.slice(0, limite);
    $('#resultados', c).innerHTML = vs.length
      ? `<div class="rejilla">${vs.map((v) => {
          const cli = cache.get(v.cliente_id);
          const pend = alertasVigentes(v._id).filter((a) => a.estado !== 'programada').length;
          return `<a class="ficha" href="#/vehiculo/${encodeURIComponent(v._id)}">
            <b class="placa">${h(v.placa)}</b>
            <span>${h(v.marca)} ${h(v.modelo)} ${h(v.anio ?? '')}</span>
            <small>${h(cli?.nombre ?? 'Sin cliente')} · ${km(kmActual(v))}</small>
            ${pend ? `<span class="badge badge-vencida">${pend} pendiente(s)</span>` : ''}
          </a>`;
        }).join('')}</div>${pieLista(vs.length, todos.length)}`
      : '<p class="vacio">Sin resultados. Use “Registrar vehículo”.</p>';
    c.querySelector('[data-mas]')?.addEventListener('click', () => { limite += 10; pintar(); });
  };
  pintar();

  const input = $('#busqueda', c) as HTMLInputElement;
  input.addEventListener('input', () => {
    filtro = input.value;
    limite = 10;
    pintar();
  });
  $('#nuevo', c).addEventListener('click', () => formularioNuevo($('#form-nuevo', c), normalizarPlaca(filtro)));
  if (accion === 'nuevo') formularioNuevo($('#form-nuevo', c), placaNueva ?? '');
  return { reactiva: false };
}

function formularioNuevo(cont: HTMLElement, placaInicial: string) {
  cont.classList.remove('oculto');
  const clientes = porTipo('cliente').sort((a, b) => a.nombre.localeCompare(b.nombre));
  cont.innerHTML = `
    <h2>Registrar vehículo</h2>
    <form id="fnv" class="formulario">
      <label>Placa<input id="placa" required placeholder="P123456" value="${h(placaInicial)}" /></label>
      <div class="dos-col">
        <label>Marca<input id="marca" required placeholder="Toyota" /></label>
        <label>Modelo<input id="modelo" required placeholder="Corolla" /></label>
        <label>Año<input id="anio" type="number" min="1950" max="2030" /></label>
        <label>Kilometraje actual<input id="km" type="number" min="0" required /></label>
      </div>
      <label>Dueño
        <select id="cli-existente"><option value="">— Cliente nuevo —</option>
        ${clientes.map((c) => `<option value="${h(c._id)}">${h(c.nombre)}</option>`).join('')}</select>
      </label>
      <div id="cli-nuevo" class="dos-col">
        <label>Nombre del cliente<input id="nombre" /></label>
        <label>Teléfono (WhatsApp)<input id="telefono" type="tel" placeholder="7123-4567" /></label>
        <label class="check"><input type="checkbox" id="consentimiento" checked /> El cliente acepta recibir recordatorios por WhatsApp</label>
      </div>
      <button class="btn btn-grande">Guardar</button>
    </form>`;
  const sel = $('#cli-existente', cont) as HTMLSelectElement;
  sel.addEventListener('change', () => $('#cli-nuevo', cont).classList.toggle('oculto', !!sel.value));
  cont.scrollIntoView({ behavior: 'smooth' });
  ($(placaInicial ? '#marca' : '#placa', cont) as HTMLInputElement).focus();

  $('#fnv', cont).addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const placa = normalizarPlaca(valor('#placa', cont));
      if (placa.length < 4) throw new Error('Placa inválida');
      if (cache.has(`vehiculo:${placa}`)) throw new Error(`La placa ${placa} ya está registrada`);
      let clienteId = sel.value;
      if (!clienteId) {
        if (valor('#nombre', cont).length < 3) throw new Error('Escriba el nombre del cliente');
        if (!($('#consentimiento', cont) as HTMLInputElement).checked) throw new Error('Se requiere el consentimiento del cliente');
        clienteId = nuevoId('cliente');
        await guardar({
          _id: clienteId, tipo: 'cliente', nombre: valor('#nombre', cont), telefono: valor('#telefono', cont),
          consentimiento_datos: true, fecha_registro: new Date().toISOString().slice(0, 10),
        });
      }
      await guardar({
        _id: `vehiculo:${placa}`, tipo: 'vehiculo', cliente_id: clienteId, placa,
        marca: valor('#marca', cont), modelo: valor('#modelo', cont), anio: Number(valor('#anio', cont)) || null,
        kilometraje_actual: Number(valor('#km', cont)) || 0, km_diario_estimado: 40,
      });
      aviso('Vehículo registrado');
      // flujo directo: registrar y abrir la orden
      location.hash = `#/orden/${encodeURIComponent('vehiculo:' + placa)}`;
    } catch (err: any) {
      aviso(err.message, 'error');
    }
  });
}
