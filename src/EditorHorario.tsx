import { DIAS, type HorarioEditable } from './horario';

interface Props {
  valor: HorarioEditable;
  onCambiar: (nuevo: HorarioEditable) => void;
}

const claseHora = 'w-full min-w-0 px-1.5 sm:px-3 py-2.5 bg-white/80 rounded-xl border border-white focus:border-azul/30 focus:ring-4 focus:ring-azul/10 focus:outline-none text-marino text-sm font-bold text-center transition-all';

// Elige los días de clase y la hora de cada uno. Al escribir la hora de un día, se copia sola
// a los demás días marcados que aún no la tengan (lo normal es que sea la misma hora).
export default function EditorHorario({ valor, onCambiar }: Props) {
  const diasMarcados = Object.keys(valor).map(Number).sort((a, b) => a - b);

  const alternarDia = (dia: number) => {
    const nuevo = { ...valor };
    if (nuevo[dia]) {
      delete nuevo[dia];
    } else {
      // El día nuevo empieza con la hora de los demás días (si ya hay alguna)
      const referencia = diasMarcados.map(d => valor[d]).find(h => h.inicio);
      nuevo[dia] = referencia ? { ...referencia } : { inicio: '', fin: '' };
    }
    onCambiar(nuevo);
  };

  const cambiarHora = (dia: number, campo: 'inicio' | 'fin', hora: string) => {
    const nuevo: HorarioEditable = { ...valor, [dia]: { ...valor[dia], [campo]: hora } };
    // Los días que aún no tienen esa hora se rellenan con la misma
    for (const otro of diasMarcados) {
      if (otro !== dia && !valor[otro][campo]) nuevo[otro] = { ...nuevo[otro], [campo]: hora };
    }
    onCambiar(nuevo);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5 sm:gap-2 justify-center py-1">
        {DIAS.map(dia => {
          const marcado = !!valor[dia.id];
          return (
            <button
              key={dia.id}
              type="button"
              onClick={() => alternarDia(dia.id)}
              title={dia.largo}
              className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-xs font-black border transition-all duration-300 cursor-pointer active:scale-90 ${marcado ? 'bg-azul border-azul text-white shadow-[0_6px_16px_-4px_rgba(0,144,208,0.6)] ring-4 ring-azul/15' : 'bg-white border-slate-200 text-slate-500 hover:border-azul/40 hover:text-azul'}`}
            >
              {dia.corto}
            </button>
          );
        })}
      </div>

      {diasMarcados.length === 0 ? (
        <p className="text-[11px] text-slate-400 font-semibold text-center">Marca los días en los que hay clase.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {diasMarcados.map(dia => (
            <div key={dia} className="grid grid-cols-[2.75rem_1fr_auto_1fr] sm:grid-cols-[5.5rem_1fr_auto_1fr] items-center gap-1.5 sm:gap-2 bg-white/50 border border-white rounded-control px-2.5 sm:px-3 py-2 contenido-pestana">
              <span className="text-xs font-black text-marino"><span className="sm:hidden">{DIAS[dia - 1].medio}</span><span className="hidden sm:inline">{DIAS[dia - 1].largo}</span></span>
              <input
                type="time"
                aria-label={`Hora de inicio del ${DIAS[dia - 1].largo.toLowerCase()}`}
                value={valor[dia].inicio}
                onChange={(e) => cambiarHora(dia, 'inicio', e.target.value)}
                className={claseHora}
                required
              />
              <span className="text-slate-300 font-bold">–</span>
              <input
                type="time"
                aria-label={`Hora de fin del ${DIAS[dia - 1].largo.toLowerCase()} (opcional)`}
                value={valor[dia].fin}
                onChange={(e) => cambiarHora(dia, 'fin', e.target.value)}
                className={claseHora}
              />
            </div>
          ))}
          <p className="text-[11px] text-slate-400 font-semibold px-1 leading-snug">
            La hora de fin es opcional. Si todos los días son a la misma hora, basta con escribirla una vez.
          </p>
        </div>
      )}
    </div>
  );
}
