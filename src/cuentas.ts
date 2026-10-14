import { supabase } from './supabase';
import { getDeviceId, getHuellaDispositivo } from './device';

export type EstadoCuenta = 'LIBRE' | 'SIN_CONFIRMAR' | 'EXISTE' | 'PENDIENTE';

// Las cuentas creadas por un profe sin correo llevan un correo provisional con este dominio
export const DOMINIO_SIN_CORREO = '@pendiente.invalid';
export const tieneCorreoReal = (email?: string | null) => !!email && !email.endsWith(DOMINIO_SIN_CORREO);

export async function estadoCuenta(email: string): Promise<EstadoCuenta | null> {
  const { data, error } = await supabase.rpc('estado_cuenta', { p_email: email.trim() });
  if (error) return null;
  return data as EstadoCuenta;
}

// Llama a la Edge Function "cuentas". Devuelve el código de error tal cual para traducirlo.
async function llamarCuentas<T>(cuerpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('cuentas', { body: cuerpo });
  if (error) {
    let codigo = 'ERROR_INTERNO';
    try {
      const detalle = await (error as { context?: Response }).context?.json();
      if (detalle?.error) codigo = detalle.error;
    } catch { /* respuesta sin JSON */ }
    throw new Error(codigo);
  }
  return data as T;
}

export interface ResultadoReclamar {
  resultado: 'CONFIRMA_CORREO' | 'FUSIONADA';
  correoEnviado?: boolean;
}

export const reclamarCuenta = (datos: { email: string; password: string; nombre?: string; codigo?: string }) =>
  llamarCuentas<ResultadoReclamar>({ accion: 'reclamar', ...datos });

export interface ResultadoAlta {
  tipo: 'NUEVO' | 'EXISTENTE';
  // true si se ha reconocido una cuenta que ya existía por el nombre (el profe no puso correo)
  porNombre?: boolean;
  nombre: string;
  email: string | null;
  pendiente: boolean;
  codigo: string | null;
}

export const altaAlumno = (datos: { nombre: string; email?: string; asignatura_id: string }) =>
  llamarCuentas<ResultadoAlta>({ accion: 'alta', ...datos });

export type ResultadoVinculo = 'OK' | 'OTRO_DISPOSITIVO' | 'PROFESOR' | 'SIN_PERFIL';

export async function vincularEsteDispositivo(): Promise<ResultadoVinculo> {
  const { data, error } = await supabase.rpc('vincular_dispositivo', {
    p_dispositivo_id: getDeviceId(),
    p_huella: getHuellaDispositivo(),
  });
  if (error) throw error;
  return data as ResultadoVinculo;
}

// Traduce los códigos de error del servidor a mensajes claros para el usuario
const MENSAJES: Record<string, string> = {
  NO_AUTORIZADO: 'Tu sesión de docente ha caducado. Vuelve a iniciar sesión.',
  ASIGNATURA_NO_VALIDA: 'Elige una de tus asignaturas.',
  NOMBRE_OBLIGATORIO: 'Escribe el nombre y apellidos del alumno.',
  EMAIL_NO_VALIDO: 'El correo electrónico no es válido.',
  ES_PROFESOR: 'Ese correo pertenece a un docente, no a un alumno.',
  EMAIL_YA_REGISTRADO: 'Ese correo ya tiene otra cuenta. Si es tuya, escribe su contraseña correcta para unir tus asistencias. Si no la recuerdas, recupérala primero desde "Iniciar sesión".',
  EMAIL_SIN_CONFIRMAR: 'Ese correo tiene una cuenta sin confirmar. Busca en tu correo (también en spam) el enlace de confirmación y vuelve a intentarlo.',
  PASSWORD_CORTA: 'La contraseña debe tener al menos 6 caracteres.',
  NOMBRE_REPETIDO: 'Hay varios alumnos con ese mismo nombre. Escribe también su correo para saber cuál es.',
  CODIGO_NO_VALIDO: 'Ese código de alta no existe o ya se ha usado. Revísalo con tu profesor.',
  NO_PENDIENTE: 'No hay ninguna cuenta pendiente con ese correo.',
  ERROR_CREANDO: 'No se pudo crear la cuenta. Inténtalo de nuevo en unos segundos.',
  ERROR_INTERNO: 'Ha habido un problema con el servidor. Inténtalo de nuevo en unos segundos.',
};

export const mensajeError = (codigo: string) => MENSAJES[codigo] ?? codigo;
