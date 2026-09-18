export function getDeviceId(): string {
  let deviceId = localStorage.getItem('checker_device_hash');
  if (!deviceId) {
    // Genera un identificador aleatorio único y lo guarda en el navegador
    deviceId = 'dev_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
    localStorage.setItem('checker_device_hash', deviceId);
  }
  return deviceId;
}
