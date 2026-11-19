// Escaneo de códigos de barras / QR con la cámara de la tableta.
//  1) BarcodeDetector nativo (Chrome/Android) si existe.
//  2) Respaldo con ZXing (JavaScript puro, funciona sin red).
//  3) Campo de texto: sirve también para lectores USB/Bluetooth que "teclean" el código.
import { h } from './ui';

export function escanear(titulo = 'Escanear código'): Promise<string | null> {
  return new Promise((resolver) => {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-caja">
        <h2>${h(titulo)}</h2>
        <video playsinline muted></video>
        <p class="ayuda" id="esc-estado">Apunte la cámara al código de barras…</p>
        <form id="esc-form" class="fila">
          <input id="esc-manual" placeholder="…o escriba el código" autocomplete="off" />
          <button class="btn">Usar</button>
        </form>
        <button class="btn btn-sec" id="esc-cerrar">Cancelar</button>
      </div>`;
    document.body.appendChild(modal);
    const video = modal.querySelector('video')!;
    const estadoEl = modal.querySelector('#esc-estado')!;
    const manual = modal.querySelector<HTMLInputElement>('#esc-manual')!;
    let detener: () => void = () => {};
    let terminado = false;

    const fin = (v: string | null) => {
      if (terminado) return;
      terminado = true;
      detener();
      modal.remove();
      resolver(v ? v.trim() : null);
    };
    modal.querySelector('#esc-cerrar')!.addEventListener('click', () => fin(null));
    modal.querySelector('#esc-form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      if (manual.value.trim()) fin(manual.value);
    });
    setTimeout(() => manual.focus(), 50);

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
        estadoEl.textContent = 'La cámara requiere HTTPS o localhost. Use el campo de texto o un lector USB.';
        return;
      }
      try {
        const BD = (window as any).BarcodeDetector;
        if (BD) {
          const flujo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
          detener = () => flujo.getTracks().forEach((t) => t.stop());
          video.srcObject = flujo;
          await video.play();
          const det = new BD();
          const ciclo = async () => {
            if (terminado) return;
            try {
              const r = await det.detect(video);
              if (r.length) return fin(r[0].rawValue);
            } catch { /* cuadro no listo */ }
            requestAnimationFrame(ciclo);
          };
          ciclo();
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser');
          const lector = new BrowserMultiFormatReader();
          const ctrl = await lector.decodeFromVideoDevice(undefined, video, (res) => {
            if (res) fin(res.getText());
          });
          detener = () => ctrl.stop();
        }
      } catch (e: any) {
        estadoEl.textContent = `No se pudo usar la cámara (${e?.name ?? e}). Use el campo de texto.`;
      }
    })();
  });
}
