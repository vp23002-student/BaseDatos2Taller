import { cache, guardar } from '../db';
import { escanear } from '../escaner';
import { alertasVigentes, km, kmActual, normalizarPlaca, nuevoId, porTipo } from '../logica';
import { $, aviso, h, valor } from '../ui';

let filtro = '';

export function vistaVehiculos(c: HTMLElement) {
  c.innerHTML = `
    <section class="tarjeta">
      <h2>Buscar vehículo</h2>
      <div class="fila">
        <input id="busqueda" placeholder="Placa (ej. P900037)" value="${h(filtro)}" autocomplete="off" />
        <button class="btn" id="escanear">📷 Escanear placa/QR</button>
        <button class="btn btn-sec" id="nuevo">＋ Nuevo cliente y vehículo</button>
      </div>
      <div id="resultados"></div>
    </section>
    <section class="tarjeta oculto" id="form-nuevo"></section>`;

  const pintar = () => {
    const f = normalizarPlaca(filtro);
    const vs = porTipo('vehiculo')
      .filter((v) => !f || v.placa.includes(f))
      .sort((a, b) => a.placa.localeCompare(b.placa))
      .slice(0, 60);
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
        }).join('')}</div>`
      : '<p class="vacio">Sin resultados. Puede registrarlo con “Nuevo cliente y vehículo”.</p>';
  };
  pintar();

  const input = $('#busqueda', c) as HTMLInputElement;
  input.addEventListener('input', () => {
    filtro = input.value;
    pintar();
  });
  $('#escanear', c).addEventListener('click', async () => {
    const v = await escanear('Escanear placa o QR del vehículo');
    if (!v) return;
    const p = normalizarPlaca(v.replace(/^vehiculo:/i, ''));
    if (cache.has(`vehiculo:${p}`)) location.hash = `#/vehiculo/${encodeURIComponent('vehiculo:' + p)}`;
    else {
      filtro = p;
      input.value = p;
      pintar();
      aviso(`Placa ${p} no registrada`, 'info');
    }
  });
  $('#nuevo', c).addEventListener('click', () => formularioNuevo($('#form-nuevo', c)));
  return { reactiva: false };
}

function formularioNuevo(cont: HTMLElement) {
  cont.classList.remove('oculto');
  const clientes = porTipo('cliente').sort((a, b) => a.nombre.localeCompare(b.nombre));
  cont.innerHTML = `
    <h2>Registrar cliente y vehículo</h2>
    <form id="fnv" class="formulario">
      <fieldset><legend>Cliente</legend>
        <label>Cliente existente
          <select id="cli-existente"><option value="">— Nuevo cliente —</option>
          ${clientes.map((c) => `<option value="${h(c._id)}">${h(c.nombre)}</option>`).join('')}</select>
        </label>
        <div id="cli-nuevo">
          <label>Nombre completo<input id="nombre" /></label>
          <label>Teléfono (WhatsApp)<input id="telefono" type="tel" placeholder="7123-4567" /></label>
          <label>Correo<input id="correo" type="email" /></label>
          <label class="check"><input type="checkbox" id="consentimiento" /> El cliente autoriza guardar sus datos y recibir recordatorios (consentimiento informado)</label>
        </div>
      </fieldset>
      <fieldset><legend>Vehículo</legend>
        <label>Placa<input id="placa" required placeholder="P123456" /></label>
        <label>Marca<input id="marca" required /></label>
        <label>Modelo<input id="modelo" required /></label>
        <label>Año<input id="anio" type="number" min="1950" max="2030" /></label>
        <label>VIN<input id="vin" /></label>
        <label>Kilometraje actual<input id="km" type="number" min="0" required /></label>
        <label>Km diarios aprox.<input id="kmdia" type="number" min="1" value="40" /></label>
      </fieldset>
      <button class="btn btn-grande">Guardar (funciona sin conexión)</button>
    </form>`;
  const sel = $('#cli-existente', cont) as HTMLSelectElement;
  sel.addEventListener('change', () => $('#cli-nuevo', cont).classList.toggle('oculto', !!sel.value));
  cont.scrollIntoView({ behavior: 'smooth' });

  $('#fnv', cont).addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const placa = normalizarPlaca(valor('#placa', cont));
      if (placa.length < 4) throw new Error('Placa inválida');
      if (cache.has(`vehiculo:${placa}`)) throw new Error(`La placa ${placa} ya está registrada`);
      let clienteId = sel.value;
      if (!clienteId) {
        if (valor('#nombre', cont).length < 3) throw new Error('Nombre del cliente obligatorio');
        if (!($('#consentimiento', cont) as HTMLInputElement).checked) throw new Error('Se requiere el consentimiento del cliente');
        clienteId = nuevoId('cliente');
        await guardar({
          _id: clienteId, tipo: 'cliente', nombre: valor('#nombre', cont), telefono: valor('#telefono', cont),
          correo: valor('#correo', cont), consentimiento_datos: true, fecha_registro: new Date().toISOString().slice(0, 10),
        });
      }
      await guardar({
        _id: `vehiculo:${placa}`, tipo: 'vehiculo', cliente_id: clienteId, placa,
        marca: valor('#marca', cont), modelo: valor('#modelo', cont), anio: Number(valor('#anio', cont)) || null,
        vin: valor('#vin', cont), kilometraje_actual: Number(valor('#km', cont)) || 0,
        km_diario_estimado: Number(valor('#kmdia', cont)) || 40,
      });
      aviso('Vehículo registrado');
      location.hash = `#/vehiculo/${encodeURIComponent('vehiculo:' + placa)}`;
    } catch (err: any) {
      aviso(err.message, 'error');
    }
  });
}
