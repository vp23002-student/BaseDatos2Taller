// Acciones compartidas entre vistas.
import { api, cache, estado, guardar } from './db';
import { aviso } from './ui';

/** Notifica una alerta por WhatsApp.
 *  En línea: el backend Rust arma el mensaje y marca la alerta como enviada.
 *  Sin conexión: se arma localmente y el cambio se sincroniza después. */
export async function notificarAlerta(id: string) {
  const ventana = window.open('', '_blank'); // abrir antes del await evita el bloqueo de ventanas emergentes
  try {
    let enlace: string;
    if (estado.enLinea && !estado.modoSinConexion) {
      enlace = (await api<{ enlace: string }>(`/alertas/${encodeURIComponent(id)}/enviar`, { method: 'POST' })).enlace;
    } else {
      const a = cache.get(id)!;
      const c = cache.get(a.cliente_id ?? '') ?? { nombre: '', telefono: '' };
      let tel = String(c.telefono ?? '').replace(/\D/g, '');
      if (tel.length === 8) tel = '503' + tel;
      const msg = `Hola ${c.nombre}, le saludamos de su taller. Su vehículo placa ${a.placa} tiene programado: ${a.nombre_servicio} para el ${a.fecha_programada}${a.km_programado ? ` o al llegar a ${a.km_programado} km` : ''}. ¿Desea agendar una cita?`;
      enlace = `https://wa.me/${tel}?text=${encodeURIComponent(msg)}`;
      await guardar({ ...a, estado_envio: 'enviada', enviada_en: new Date().toISOString() });
      aviso('Alerta marcada localmente; se sincronizará al volver la conexión', 'info');
    }
    if (ventana) ventana.location.href = enlace;
    else window.open(enlace, '_blank');
  } catch (e: any) {
    ventana?.close();
    aviso(`No se pudo notificar: ${e.message}`, 'error');
  }
}
