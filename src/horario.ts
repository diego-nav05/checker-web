import { supabase } from './supabase';

// Una fila de la tabla "horarios": a qué hora hay clase de una asignatura un día de la semana
export interface FilaHorario {
  asignatura_id: string;
  dia_semana: number; // 1 = lunes ... 7 = domingo
  hora_inicio: string; // "10:15:00"
  hora_fin: string | null;
}

// Lo que edita el profesor: para cada día marcado, su hora de inicio y (opcional) de fin
export type HorarioEditable = Record<number, { inicio: string; fin: string }>;

export const DIAS = [
  { id: 1, corto: 'L', medio: 'Lun', largo: 'Lunes' },
  { id: 2, corto: 'M', medio: 'Mar', largo: 'Martes' },
  { id: 3, corto: 'X', medio: 'Mié', largo: 'Miércoles' },
  { id: 4, corto: 'J', medio: 'Jue', largo: 'Jueves' },
  { id: 5, corto: 'V', medio: 'Vie', largo: 'Viernes' },
  { id: 6, corto: 'S', medio: 'Sáb', largo: 'Sábado' },
  { id: 7, corto: 'D', medio: 'Dom', largo: 'Domingo' },
];

// JavaScript cuenta el domingo como 0; nosotros como 7
export const diaDeHoy = () => { const d = new Date().getDay(); return d === 0 ? 7 : d; };
export const aDiaJs = (dia: number) => (dia === 7 ? 0 : dia);

// "09:05:00" -> "9:05"
export const hora = (valor?: string | null) => {
  if (!valor) return '';
  const [h, m] = valor.split(':');
  return `${Number(h)}:${m}`;
};

export const tramo = (f: Pick<FilaHorario, 'hora_inicio' | 'hora_fin'>) =>
  f.hora_fin ? `${hora(f.hora_inicio)} – ${hora(f.hora_fin)}` : hora(f.hora_inicio);

export const filasDe = (horarios: FilaHorario[], asignaturaId: string) =>
  horarios.filter(h => h.asignatura_id === asignaturaId).sort((a, b) => a.dia_semana - b.dia_semana);

export const horaDeHoy = (horarios: FilaHorario[], asignaturaId: string) =>
  horarios.find(h => h.asignatura_id === asignaturaId && h.dia_semana === diaDeHoy()) ?? null;

// Resumen corto: "Mar y Mié · 10:15" si todos los días tienen la misma hora, o "Mar 10:15 · Mié 12:00"
export function resumenHorario(filas: FilaHorario[], textoAntiguo?: string | null): string {
  if (filas.length === 0) return textoAntiguo || 'Sin horario';
  const tramos = new Set(filas.map(tramo));
  const nombres = filas.map(f => DIAS[f.dia_semana - 1].medio);
  if (tramos.size === 1) {
    const dias = nombres.length > 1 ? `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}` : nombres[0];
    return `${dias} · ${tramo(filas[0])}`;
  }
  return filas.map(f => `${DIAS[f.dia_semana - 1].medio} ${tramo(f)}`).join(' · ');
}

export async function cargarHorarios(asignaturaIds: string[]): Promise<FilaHorario[]> {
  if (asignaturaIds.length === 0) return [];
  const { data } = await supabase.from('horarios').select('asignatura_id, dia_semana, hora_inicio, hora_fin').in('asignatura_id', asignaturaIds);
  return (data as FilaHorario[]) || [];
}

export const aEditable = (filas: FilaHorario[]): HorarioEditable =>
  Object.fromEntries(filas.map(f => [f.dia_semana, { inicio: hora(f.hora_inicio).padStart(5, '0'), fin: f.hora_fin ? hora(f.hora_fin).padStart(5, '0') : '' }]));

// Guarda el horario: reemplaza las filas de la asignatura y actualiza el resumen que usa el resto de la web
export async function guardarHorario(asignaturaId: string, horario: HorarioEditable, aula: string | null) {
  const dias = Object.keys(horario).map(Number).sort((a, b) => a - b);
  const { error: errorBorrar } = await supabase.from('horarios').delete().eq('asignatura_id', asignaturaId);
  if (errorBorrar) throw errorBorrar;
  if (dias.length > 0) {
    const { error } = await supabase.from('horarios').insert(dias.map(dia => ({
      asignatura_id: asignaturaId,
      dia_semana: dia,
      hora_inicio: horario[dia].inicio,
      hora_fin: horario[dia].fin || null,
      aula,
    })));
    if (error) throw error;
  }
  const filas: FilaHorario[] = dias.map(dia => ({ asignatura_id: asignaturaId, dia_semana: dia, hora_inicio: horario[dia].inicio, hora_fin: horario[dia].fin || null }));
  const { error: errorResumen } = await supabase.from('asignaturas')
    .update({ dias_semana: dias.map(aDiaJs), horario: dias.length ? resumenHorario(filas) : '' })
    .eq('id', asignaturaId);
  if (errorResumen) throw errorResumen;
}
