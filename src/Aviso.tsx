import { useCallback, useEffect, useRef, useState } from 'react';

export type TipoAviso = 'error' | 'info' | 'exito';

interface Aviso {
  id: number;
  texto: string;
  tipo: TipoAviso;
  fijo: boolean;
}

interface OpcionesAviso {
  // Los avisos fijos no se cierran solos: el usuario tiene que pulsar "Entendido"
  fijo?: boolean;
}

// Tiempo para leer con calma: unos 4 s mínimo y ~60 ms por letra, hasta 14 s
const duracionLectura = (texto: string) => Math.min(14000, Math.max(4000, 2500 + texto.length * 60));

export function useAviso() {
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cerrar = useCallback(() => {
    if (temporizador.current) clearTimeout(temporizador.current);
    setAviso(null);
  }, []);

  const avisar = useCallback((texto: string, tipo: TipoAviso = 'info', opciones: OpcionesAviso = {}) => {
    // Un aviso nuevo reinicia el tiempo: así un aviso viejo no cierra antes de tiempo al nuevo
    if (temporizador.current) clearTimeout(temporizador.current);
    const fijo = !!opciones.fijo;
    setAviso({ id: Date.now(), texto, tipo, fijo });
    if (!fijo) temporizador.current = setTimeout(() => setAviso(null), duracionLectura(texto));
  }, []);

  useEffect(() => () => { if (temporizador.current) clearTimeout(temporizador.current); }, []);

  return { aviso, avisar, cerrar };
}

export function AvisoFlotante({ aviso, onCerrar }: { aviso: Aviso | null; onCerrar: () => void }) {
  if (!aviso) return null;

  const colores =
    aviso.tipo === 'error' ? 'bg-rose-500/95 border-rose-400/50' :
    aviso.tipo === 'exito' ? 'bg-emerald-500/95 border-emerald-400/50' :
    'bg-[#002b5c]/95 border-white/20';

  return (
    <div className="fixed top-6 inset-x-0 z-[300] flex justify-center px-4 pointer-events-none">
      <div
        key={aviso.id}
        role={aviso.tipo === 'error' ? 'alert' : 'status'}
        onClick={aviso.fijo ? undefined : onCerrar}
        className={`pointer-events-auto px-6 py-4 rounded-3xl shadow-[0_16px_32px_-10px_rgba(0,0,0,0.25)] backdrop-blur-2xl flex flex-col items-center gap-3 anim-drop max-w-md w-full sm:w-auto sm:min-w-[300px] border text-center text-white ${colores} ${aviso.fijo ? '' : 'cursor-pointer'}`}
        style={{ boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.2), 0 10px 40px -10px rgba(0,0,0,0.25)' }}
      >
        <span className="text-sm font-semibold tracking-wide leading-relaxed whitespace-pre-line">{aviso.texto}</span>
        {aviso.fijo && (
          <button
            onClick={onCerrar}
            className="px-5 py-2 bg-white/20 hover:bg-white/30 border border-white/30 rounded-full text-xs font-black uppercase tracking-widest transition-colors cursor-pointer active:scale-95"
          >
            Entendido
          </button>
        )}
      </div>
    </div>
  );
}
