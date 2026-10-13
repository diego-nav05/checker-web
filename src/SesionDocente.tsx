interface Props {
  nombre: string;
  onCambiarCuenta: () => void;
  onCerrarSesion: () => void;
}

// Pastilla del docente conectado, abajo a la derecha (como el botón de compartir a la izquierda).
// "Cerrar sesión" siempre a la vista para que nadie se deje la sesión abierta en un ordenador del aula.
export default function SesionDocente({ nombre, onCambiarCuenta, onCerrarSesion }: Props) {
  return (
    <div className="absolute bottom-4 right-4 sm:bottom-6 sm:right-6 z-20 h-12 pl-4 pr-1.5 flex items-center gap-2 sm:gap-3 bg-white/80 border border-slate-200/60 rounded-full shadow-[0_8px_24px_-8px_rgba(0,43,92,0.18)] backdrop-blur-md select-none bento-entrada">
      <span className="w-2 h-2 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" title="Sesión de docente abierta"></span>
      <span className="hidden sm:block text-xs font-bold text-marino truncate max-w-[200px]">{nombre}</span>
      <span className="hidden sm:block w-px h-5 bg-slate-200"></span>
      <button
        onClick={onCambiarCuenta}
        title="Cambiar de cuenta"
        className="h-9 px-2 sm:px-3 flex items-center gap-1.5 rounded-full text-xs font-bold text-azul hover:bg-azul/10 transition-colors cursor-pointer active:scale-95"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
        <span className="hidden sm:inline">Cambiar de cuenta</span>
      </button>
      <button
        onClick={onCerrarSesion}
        className="h-9 px-4 flex items-center gap-1.5 rounded-full text-xs font-black bg-rose-50 text-rose-600 border border-rose-100 hover:bg-rose-500 hover:text-white hover:border-rose-500 transition-colors cursor-pointer active:scale-95"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2"><path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
        Cerrar sesión
      </button>
    </div>
  );
}
