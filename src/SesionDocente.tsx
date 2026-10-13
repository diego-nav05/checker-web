import { useEffect, useRef, useState } from 'react';

interface Props {
  nombre: string;
  onCambiarCuenta: () => void;
  onCerrarSesion: () => void;
}

// Pastilla del docente conectado, abajo a la derecha (como el botón de compartir a la izquierda).
// Al pulsarla se despliegan las opciones de la cuenta.
export default function SesionDocente({ nombre, onCambiarCuenta, onCerrarSesion }: Props) {
  const [abierta, setAbierta] = useState(false);
  const contenedor = useRef<HTMLDivElement>(null);

  // Se cierra al pulsar fuera o con Escape
  useEffect(() => {
    if (!abierta) return;
    const fuera = (e: MouseEvent) => { if (!contenedor.current?.contains(e.target as Node)) setAbierta(false); };
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierta(false); };
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', tecla);
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', tecla); };
  }, [abierta]);

  return (
    <div ref={contenedor} className="absolute bottom-4 right-4 sm:bottom-6 sm:right-6 z-20 flex flex-col items-end">
      {abierta && (
        <div className="mb-2 w-52 p-1.5 bg-white/90 backdrop-blur-xl border border-white rounded-control shadow-[0_16px_40px_-12px_rgba(0,43,92,0.25)] flex flex-col contenido-pestana">
          <button onClick={() => { setAbierta(false); onCambiarCuenta(); }} className="text-left px-4 py-3 rounded-xl text-xs font-bold text-marino hover:bg-azul/10 hover:text-azul transition-colors cursor-pointer">
            Cambiar de cuenta
          </button>
          <button onClick={() => { setAbierta(false); onCerrarSesion(); }} className="text-left px-4 py-3 rounded-xl text-xs font-bold text-slate-500 hover:bg-rose-50 hover:text-rose-500 transition-colors cursor-pointer">
            Cerrar sesión
          </button>
        </div>
      )}
      <button
        onClick={() => setAbierta(!abierta)}
        aria-expanded={abierta}
        title="Opciones de la cuenta de docente"
        className="h-12 pl-4 pr-3 flex items-center gap-2.5 bg-white/60 hover:bg-white border border-slate-200/50 rounded-full text-marino shadow-[0_4px_12px_rgba(0,0,0,0.05)] transition-all duration-300 hover:shadow-[0_8px_20px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 active:scale-95 cursor-pointer backdrop-blur-md select-none"
      >
        <span className="w-2 h-2 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"></span>
        <span className="text-xs font-bold truncate max-w-[130px] sm:max-w-[220px]">{nombre}</span>
        <svg className={`w-4 h-4 shrink-0 text-slate-400 transition-transform duration-300 ${abierta ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" /></svg>
      </button>
    </div>
  );
}
