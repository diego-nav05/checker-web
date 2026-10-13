import type { Asistencia, EstadoAsistencia } from './types';

const ESTILO_ESTADO: Record<string, string> = {
  PRESENTE: 'bg-emerald-50 text-emerald-600 border-emerald-300 shadow-[0_0_14px_rgba(52,211,153,0.35)]',
  RETRASO: 'bg-amber-50 text-amber-600 border-amber-300 shadow-[0_0_14px_rgba(251,191,36,0.35)]',
  SE_FUE_A_MITAD: 'bg-purple-50 text-purple-600 border-purple-300 shadow-[0_0_14px_rgba(192,132,252,0.35)]',
  FALTA_JUSTIFICADA: 'bg-sky-50 text-azul border-azul/40 shadow-[0_0_14px_rgba(0,144,208,0.3)]',
  FALTA_INJUSTIFICADA: 'bg-rose-50 text-rose-600 border-rose-300 shadow-[0_0_14px_rgba(251,113,133,0.35)]',
};

// Una fila de alumno con el selector de estado (en el aula y al corregir clases pasadas)
export default function FilaAlumno({ item, onCambiar }: { item: Asistencia; onCambiar: (id: string, estado: EstadoAsistencia) => void }) {
  const nombre = item.perfiles?.nombre_completo || 'Alumno registrado';
  return (
    <div className="bento-card py-2.5 pl-3.5 pr-2 flex items-center justify-between gap-2 animate-[fade-in-down_0.4s_ease-out]">
      <div className="flex flex-col overflow-hidden min-w-0">
        <p className="font-bold text-marino text-xs tracking-tight truncate" title={nombre}>{nombre}</p>
        {(item.perfiles as any)?.pendiente && (
          <span className="text-[9px] font-bold uppercase tracking-widest text-amber-500 whitespace-nowrap truncate" title="Dado de alta por el profesor: aún no ha activado su cuenta">Sin cuenta activa</span>
        )}
      </div>
      <select
        value={item.estado}
        onChange={(e) => onCambiar(item.id, e.target.value as EstadoAsistencia)}
        style={{ textAlignLast: 'center' }}
        className={`text-[9px] sm:text-[10px] font-black uppercase tracking-wider px-2 py-2 rounded-full outline-none transition-all duration-500 cursor-pointer appearance-none text-center border-2 flex-shrink-0 w-[84px] hover:scale-105 ${ESTILO_ESTADO[item.estado] || ESTILO_ESTADO.FALTA_INJUSTIFICADA}`}
      >
        <option value="PRESENTE">Presente</option>
        <option value="RETRASO">Retraso</option>
        <option value="SE_FUE_A_MITAD">Abandono</option>
        <option value="FALTA_JUSTIFICADA">Justificado</option>
        <option value="FALTA_INJUSTIFICADA">Ausente</option>
      </select>
    </div>
  );
}
