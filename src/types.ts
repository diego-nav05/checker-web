export type RolUsuario = 'profesor' | 'alumno';
export type EstadoAsistencia = 'PRESENTE' | 'RETRASO' | 'FALTA_JUSTIFICADA' | 'FALTA_INJUSTIFICADA' | 'SE_FUE_A_MITAD';
export type FaseSesion = 'ENTRADA' | 'SALIDA' | 'CERRADA';

export interface Perfil {
  id: string;
  nombre_completo: string;
  email: string;
  rol: RolUsuario;
  dispositivo_hash?: string;
}

export interface Asignatura {
  id: string;
  nombre: string;
  aula: string;
  horario: string;
  codigo?: string;
  profesor_id?: string;
  created_at?: string;
}


export interface Horario {
  id: string;
  asignatura_id: string;
  dia_semana: number; // 1 = Lunes, 7 = Domingo
  hora_inicio: string;
  hora_fin: string;
  aula: string;
}

export interface Sesion {
  id: string;
  asignatura_id: string;
  fecha: string;
  fase: FaseSesion;
  secret_totp: string;
  hora_apertura: string;
  hora_cierre?: string;
  pin_profesor: string;
}

export interface Asistencia {
  id: string;
  sesion_id: string;
  alumno_id: string;
  estado: EstadoAsistencia;
  hora_entrada?: string;
  hora_salida?: string;
  manual: boolean;
  perfiles?: Perfil; // Para uniones con el nombre del alumno
}
