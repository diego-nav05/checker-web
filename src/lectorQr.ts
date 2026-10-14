import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

// Lector de QR de la cámara. Usa dos motores:
// - El detector que trae el propio móvil (Android/Chrome), que es rapidísimo, si existe.
// - ZXing (el mismo motor que usan muchas apps nativas) para el resto, sobre todo iPhone.
// Alterna fotogramas enteros con un recorte del centro a resolución completa: así lee tanto un QR
// descentrado como uno pequeño y lejano (proyector, pizarra del fondo de la clase).

type Detector = (fuente: HTMLVideoElement | HTMLCanvasElement) => Promise<string | null>;

let zxing: Promise<typeof import('zxing-wasm/reader')> | null = null;

// Carga el motor ZXing (se descarga de nuestra propia web, no de fuera). Se puede llamar antes
// de abrir la cámara para que la primera lectura sea instantánea.
export function prepararLector() {
  if (!zxing) {
    zxing = import('zxing-wasm/reader').then(m => {
      m.prepareZXingModule({
        overrides: { locateFile: (ruta: string, prefijo: string) => (ruta.endsWith('.wasm') ? wasmUrl : prefijo + ruta) },
        fireImmediately: true,
      });
      return m;
    });
    zxing.catch(() => { zxing = null; });
  }
  return zxing;
}

async function detectorNativo(): Promise<Detector | null> {
  const BD = (window as any).BarcodeDetector;
  if (!BD) return null;
  try {
    const formatos: string[] = await BD.getSupportedFormats();
    if (!formatos.includes('qr_code')) return null;
    const detector = new BD({ formats: ['qr_code'] });
    return async (fuente) => {
      const r = await detector.detect(fuente);
      return r[0]?.rawValue ?? null;
    };
  } catch {
    return null;
  }
}

async function detectorZxing(): Promise<Detector> {
  const { readBarcodes } = await prepararLector();
  return async (fuente) => {
    const lienzo = fuente as HTMLCanvasElement;
    const datos = lienzo.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, lienzo.width, lienzo.height);
    const r = await readBarcodes(datos, { formats: ['QRCode'], tryHarder: true, maxNumberOfSymbols: 1 });
    return r.find(x => x.isValid)?.text ?? null;
  };
}

export interface Lector {
  video: HTMLVideoElement;
  parar: () => void;
  // Zoom por software: cuanto más zoom, más pequeño (y más nítido) el recorte del centro que se analiza
  setZoom: (factor: number) => void;
}

// Abre la cámara trasera en el vídeo indicado y llama a onLeido con el texto de cada QR que encuentre.
// onLeido devuelve true para seguir buscando (p. ej., si el código no valía) o false para acabar.
export async function abrirLector(video: HTMLVideoElement, onLeido: (texto: string) => Promise<boolean>): Promise<Lector> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  });
  const pista = stream.getVideoTracks()[0];
  // Enfoque continuo donde se pueda (en muchos Android viene fijo y el QR de lejos sale borroso)
  pista.applyConstraints({ advanced: [{ focusMode: 'continuous' } as any] }).catch(() => {});

  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  await video.play().catch(() => {});

  let activo = true;
  let zoom = 1;
  let vuelta = 0;
  const lienzo = document.createElement('canvas');
  const ctx = lienzo.getContext('2d', { willReadFrequently: true })!;

  const nativo = await detectorNativo();
  let respaldo: Detector | null = null;

  const fotograma = (recortar: boolean) => {
    const w = video.videoWidth, h = video.videoHeight;
    let lado = Math.min(w, h);
    let sx = 0, sy = 0, sw = w, sh = h;
    if (recortar) {
      lado = Math.round(lado * 0.7 / zoom);
      sx = Math.round((w - lado) / 2); sy = Math.round((h - lado) / 2); sw = sh = lado;
    }
    // El fotograma entero se reduce un poco para que el iPhone no se atasque
    const escala = recortar ? 1 : Math.min(1, 1280 / Math.max(w, h));
    lienzo.width = Math.round(sw * escala); lienzo.height = Math.round(sh * escala);
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, lienzo.width, lienzo.height);
    return lienzo;
  };

  const buscar = async () => {
    if (!activo) return;
    let texto: string | null = null;
    try {
      if (video.readyState >= 2 && video.videoWidth > 0) {
        const recortar = vuelta++ % 2 === 1 || zoom > 1;
        if (nativo) {
          try {
            texto = await nativo(recortar ? fotograma(true) : video);
          } catch { /* algunos móviles fallan con el detector propio: tiramos de ZXing */ }
        }
        if (!texto && (!nativo || vuelta % 4 === 0)) {
          respaldo ??= await detectorZxing();
          texto = await respaldo(fotograma(recortar));
        }
      }
    } catch { /* fotograma raro: probamos con el siguiente */ }
    if (!activo) return;
    if (texto) {
      const seguir = await onLeido(texto);
      if (!seguir) return;
    }
    setTimeout(buscar, texto ? 600 : 40);
  };
  buscar();

  return {
    video,
    parar: () => {
      activo = false;
      stream.getTracks().forEach(t => t.stop());
      video.srcObject = null;
    },
    setZoom: (factor) => { zoom = Math.max(1, factor); },
  };
}
