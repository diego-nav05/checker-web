import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

// Lector de QR de la cámara. Usa dos motores:
// - El detector que trae el propio móvil (Android/Chrome), que es rapidísimo, si existe.
// - ZXing (el mismo motor que usan muchas apps nativas) para el resto, sobre todo iPhone.
// Alterna la imagen entera con recortes del centro a resolución completa: así lee tanto un QR
// descentrado (sin tener que encajarlo en el recuadro) como uno pequeño y lejano.

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

  // Qué parte de la imagen se analiza en cada vuelta. Se van turnando:
  //  - 'entera': toda la imagen, para los QR que se ven grandes
  //  - 'centro': el centro de lo que se ve en pantalla (con el zoom puesto), a resolución completa
  //  - trozos: la imagen dividida en recuadros que se solapan. Un QR pequeño y lejano solo se encuentra
  //    bien si se analiza un trozo; así se pilla esté donde esté, sin tener que encajarlo en el recuadro.
  // Con zoom por software la cámara no amplía de verdad: por eso analizamos el trozo ampliado a
  // resolución completa, que es lo que hace que el zoom ayude a leer y no sea solo visual.
  type Zona = { x: number; y: number; lado: number } | 'entera';
  const trozos = (w: number, h: number) => {
    const lado = Math.round(Math.min(w, h) * 0.6);
    const posiciones = (total: number) => {
      const n = Math.max(1, Math.ceil((total - lado) / (lado * 0.6)) + 1);
      return Array.from({ length: n }, (_, k) => (n === 1 ? (total - lado) / 2 : ((total - lado) * k) / (n - 1)));
    };
    return posiciones(w).flatMap(x => posiciones(h).map(y => ({ x, y, lado })));
  };
  const centro = (w: number, h: number, fraccion: number): Zona => {
    const lado = Math.round(Math.min(w, h) * fraccion / zoom);
    return { x: (w - lado) / 2, y: (h - lado) / 2, lado };
  };
  // Orden de la vuelta: el centro muy a menudo (es donde suele estar el QR) y el resto repartido
  const zonasDeLaVuelta = (w: number, h: number): Zona[] => {
    if (zoom > 1) return [centro(w, h, 1), centro(w, h, 0.6), 'entera'];
    const resto: Zona[] = ['entera', ...trozos(w, h)];
    return resto.flatMap(z => [centro(w, h, 0.6), z]);
  };

  const fotograma = (zona: Zona) => {
    const w = video.videoWidth, h = video.videoHeight;
    if (zona === 'entera') {
      // La imagen entera se reduce un poco para no atascar los móviles lentos (los trozos van a tamaño real)
      const escala = Math.min(1, 1280 / Math.max(w, h));
      lienzo.width = Math.round(w * escala); lienzo.height = Math.round(h * escala);
      ctx.drawImage(video, 0, 0, w, h, 0, 0, lienzo.width, lienzo.height);
    } else {
      // Con zoom, el trozo se amplía como en pantalla: los cuadraditos del QR salen más grandes y suaves,
      // y ZXing los distingue mejor que con 1 o 2 píxeles por cuadradito
      const salida = Math.min(Math.round(zona.lado * zoom), 1200);
      lienzo.width = lienzo.height = salida;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(video, Math.round(zona.x), Math.round(zona.y), zona.lado, zona.lado, 0, 0, salida, salida);
    }
    return lienzo;
  };

  const buscar = async () => {
    if (!activo) return;
    let texto: string | null = null;
    try {
      if (video.readyState >= 2 && video.videoWidth > 0) {
        const turno = vuelta++;
        const zonas = zonasDeLaVuelta(video.videoWidth, video.videoHeight);
        const zona = zonas[turno % zonas.length];
        if (nativo) {
          try {
            // El detector del móvil es rápido: puede mirar la imagen entera a tamaño real
            texto = await nativo(zona === 'entera' ? video : fotograma(zona));
          } catch { /* algunos móviles fallan con el detector propio: tiramos de ZXing */ }
        }
        // Sin detector propio, ZXing en cada vuelta; con él, ZXing de refuerzo de vez en cuando
        if (!texto && (!nativo || turno % 3 === 2)) {
          respaldo ??= await detectorZxing();
          texto = await respaldo(fotograma(zona));
        }
      }
    } catch { /* fotograma raro: probamos con el siguiente */ }
    if (!activo) return;
    if (texto) {
      const seguir = await onLeido(texto);
      if (!seguir) return;
    }
    setTimeout(buscar, texto ? 600 : 30);
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
