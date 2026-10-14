import type { FaseSesion } from './types';

// Contenido del QR de asistencia. Es una dirección web, así que si alguien lo escanea con la cámara
// normal del móvil se le abre Checker. Va todo en MAYÚSCULAS a propósito: así el QR usa el modo
// "alfanumérico", que necesita muchos menos cuadraditos, y se lee mucho mejor desde lejos.
//
//   HTTPS://CHECKER-WEB-EIGHT.VERCEL.APP/A/ + sesión (25) + fase E|S (1) + segundo (4) + firma (16)
//
// - La sesión es su identificador escrito en base 36 (más corto que con guiones).
// - Del segundo en que se generó solo van las 4 últimas cifras: el móvil reconstruye el resto con su reloj.
// - La firma son los 16 primeros caracteres del HMAC: imposible de adivinar en los 20 s que vale.

export interface CodigoAsistencia {
  sesion: string;
  fase: FaseSesion;
  t: number;
  firma: string;
}

const LARGO_SESION = 25;
const LARGO_FIRMA = 16;
const CIFRAS_T = 10_000;

const uuidABase36 = (uuid: string) =>
  BigInt('0x' + uuid.replace(/-/g, '')).toString(36).toUpperCase().padStart(LARGO_SESION, '0');

function base36AUuid(texto: string) {
  let n = 0n;
  for (const c of texto.toLowerCase()) n = n * 36n + BigInt(parseInt(c, 36));
  const hex = n.toString(16).padStart(32, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function crearCodigo({ sesion, fase, t, firma }: CodigoAsistencia, origen = window.location.origin) {
  const segundo = String(t % CIFRAS_T).padStart(4, '0');
  return `${origen.toUpperCase()}/A/${uuidABase36(sesion)}${fase === 'SALIDA' ? 'S' : 'E'}${segundo}${firma.slice(0, LARGO_FIRMA).toUpperCase()}`;
}

const PATRON = new RegExp(`/A/([0-9A-Z]{${LARGO_SESION}})([ES])(\\d{4})([0-9A-F]{${LARGO_FIRMA},64})/?$`, 'i');

// Lee un QR de Checker: el formato nuevo (dirección web) o el antiguo (JSON). Si no es de Checker, null.
export function leerCodigo(texto: string, ahora = Date.now()): CodigoAsistencia | null {
  const limpio = texto.trim();
  const m = limpio.match(PATRON);
  if (m) {
    // El segundo completo es el más cercano a la hora de este móvil que acaba en esas 4 cifras
    const ahoraS = Math.floor(ahora / 1000);
    const resto = Number(m[3]);
    let t = ahoraS - (ahoraS % CIFRAS_T) + resto;
    if (t - ahoraS > CIFRAS_T / 2) t -= CIFRAS_T;
    else if (ahoraS - t > CIFRAS_T / 2) t += CIFRAS_T;
    return { sesion: base36AUuid(m[1]), fase: m[2].toUpperCase() === 'S' ? 'SALIDA' : 'ENTRADA', t, firma: m[4].toLowerCase() };
  }
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
