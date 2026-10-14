import type { FaseSesion } from './types';

// Contenido del QR de asistencia. Es una dirección web, así que si alguien lo escanea con la cámara
// normal del móvil se le abre Checker:
//
//   https://checker-web-eight.vercel.app/a/ + fase E|S (1) + segundo (4) + firma (16)
//
// - La dirección va en minúsculas para que todas las cámaras la reconozcan como enlace.
// - El código va en MAYÚSCULAS a propósito: así esa parte usa el modo "alfanumérico" del QR, que
//   necesita muchos menos cuadraditos.
// - No lleva qué clase es: el servidor la averigua con la firma (cada clase tiene su propia clave).
// - Del segundo en que se generó solo van las 4 últimas cifras: el móvil reconstruye el resto con su reloj.
// - La firma son los 16 primeros caracteres del HMAC: imposible de adivinar en los 45 s que vale.
//
// También se siguen leyendo los dos formatos anteriores (JSON y dirección con la clase).

export interface CodigoAsistencia {
  sesion: string | null; // null en el formato actual: la averigua el servidor
  fase: FaseSesion;
  t: number;
  firma: string;
}

const LARGO_SESION = 25;
const LARGO_FIRMA = 16;
const CIFRAS_T = 10_000;

function base36AUuid(texto: string) {
  let n = 0n;
  for (const c of texto.toLowerCase()) n = n * 36n + BigInt(parseInt(c, 36));
  const hex = n.toString(16).padStart(32, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function crearCodigo({ fase, t, firma }: Omit<CodigoAsistencia, 'sesion'>, origen = window.location.origin) {
  const segundo = String(t % CIFRAS_T).padStart(4, '0');
  return `${origen.toLowerCase()}/a/${fase === 'SALIDA' ? 'S' : 'E'}${segundo}${firma.slice(0, LARGO_FIRMA).toUpperCase()}`;
}

const PATRON = new RegExp(`/a/([ES])(\\d{4})([0-9A-F]{${LARGO_FIRMA}})/?$`, 'i');
const PATRON_CON_SESION = new RegExp(`/a/([0-9A-Z]{${LARGO_SESION}})([ES])(\\d{4})([0-9A-F]{${LARGO_FIRMA},64})/?$`, 'i');

// El segundo completo es el más cercano a la hora de este móvil que acaba en esas 4 cifras
function reconstruirSegundo(cifras: string, ahora: number) {
  const ahoraS = Math.floor(ahora / 1000);
  let t = ahoraS - (ahoraS % CIFRAS_T) + Number(cifras);
  if (t - ahoraS > CIFRAS_T / 2) t -= CIFRAS_T;
  else if (ahoraS - t > CIFRAS_T / 2) t += CIFRAS_T;
  return t;
}

const faseDe = (letra: string): FaseSesion => (letra.toUpperCase() === 'S' ? 'SALIDA' : 'ENTRADA');

// Lee un QR de Checker (cualquiera de sus formatos). Si no es de Checker, null.
export function leerCodigo(texto: string, ahora = Date.now()): CodigoAsistencia | null {
  const limpio = texto.trim();
  let m = limpio.match(PATRON);
  if (m) return { sesion: null, fase: faseDe(m[1]), t: reconstruirSegundo(m[2], ahora), firma: m[3].toLowerCase() };
  m = limpio.match(PATRON_CON_SESION);
  if (m) return { sesion: base36AUuid(m[1]), fase: faseDe(m[2]), t: reconstruirSegundo(m[3], ahora), firma: m[4].toLowerCase() };
  try {
    const { s, f, t, token } = JSON.parse(limpio) ?? {};
    if (s && f && t && token) return { sesion: s, fase: f, t: Number(t), firma: token };
  } catch { /* no es JSON */ }
  return null;
}

// Si la web se ha abierto escaneando el QR con la cámara normal del móvil, la dirección trae el código.
// Lo guardamos y limpiamos la barra de direcciones (para que al recargar no se intente usar otra vez).
export const codigoInicial: CodigoAsistencia | null = (() => {
  if (!/^\/a\//i.test(window.location.pathname)) return null;
  const codigo = leerCodigo(window.location.pathname);
  window.history.replaceState(null, '', '/');
  return codigo;
})();
