import CryptoJS from 'crypto-js';

// Identificador aleatorio de este navegador. Se guarda una sola vez y no cambia aunque
// el navegador se actualice (al contrario que la huella).
export function getDeviceId(): string {
  let deviceId = localStorage.getItem('checker_device_hash');
  if (!deviceId) {
    // randomUUID no existe en móviles muy antiguos: en ese caso usamos el método de siempre
    deviceId = 'dev_' + (typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).substring(2, 15) + Date.now().toString(36));
    localStorage.setItem('checker_device_hash', deviceId);
  }
  return deviceId;
}

// Huella del navegador: el método antiguo de vinculación. Se sigue calculando igual para que las
// cuentas vinculadas antes de esta versión se reconozcan, y como respaldo si se borra el identificador.
export function getHuellaDispositivo(): string {
  const datos = navigator.userAgent + window.screen.width + window.screen.height + navigator.language;
  return CryptoJS.SHA256(datos).toString();
}
