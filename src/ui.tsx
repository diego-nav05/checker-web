// Piezas de interfaz comunes a toda la web (diseño tipo bento).
// Si quieres cambiar el aspecto de todos los botones, tarjetas o ventanas, se cambia aquí una sola vez.

import type { ButtonHTMLAttributes, CSSProperties, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

const unir = (...clases: (string | false | null | undefined)[]) => clases.filter(Boolean).join(' ');

// Para las animaciones escalonadas: style={retraso(2)} hace que el elemento entre el tercero
export const retraso = (indice: number): CSSProperties => ({ '--i': indice } as CSSProperties);

/* ------------------------------------------------------------------ Pantalla */

interface PantallaProps {
  children: ReactNode;
  // Ancho máximo del contenido: 'estrecho' para formularios, 'normal' para casi todo, 'amplio' para el aula
  ancho?: 'estrecho' | 'normal' | 'amplio';
  centrada?: boolean;
  className?: string;
  // Elementos pegados a los bordes de la pantalla (botón de compartir, sesión del docente...)
  esquinas?: ReactNode;
}

const ANCHOS = { estrecho: 'max-w-sm', normal: 'max-w-6xl', amplio: 'max-w-[1700px]' };

export function Pantalla({ children, ancho = 'normal', centrada = false, className, esquinas }: PantallaProps) {
  return (
    <div className={unir('min-h-[100dvh] bg-fondo p-4 sm:p-8 flex flex-col font-sans selection:bg-azul selection:text-white relative overflow-hidden', esquinas && 'pb-24 sm:pb-24')}>
      <div className="glow-blob"></div>
      {esquinas}
      <div className={unir('relative z-10 w-full mx-auto flex flex-col flex-1', ANCHOS[ancho], centrada && 'justify-center', className)}>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Tarjeta bento */

type VarianteTarjeta = 'cristal' | 'blanca' | 'aviso' | 'peligro' | 'marino' | 'azul';

const TARJETAS: Record<VarianteTarjeta, string> = {
  cristal: 'glass-container',
  blanca: 'bg-white/85 border border-white shadow-[0_10px_30px_-12px_rgba(0,43,92,0.12)]',
  aviso: 'bg-amber-50/80 border border-amber-100',
  peligro: 'bg-rose-50/80 border border-rose-100',
  marino: 'bg-gradient-to-br from-marino to-marino-oscuro text-white border border-white/10 shadow-[0_16px_40px_-12px_rgba(0,43,92,0.45)]',
  azul: 'bg-gradient-to-br from-azul to-azul-oscuro text-white border border-white/20 shadow-[0_16px_40px_-12px_rgba(0,144,208,0.45)]',
};

interface TarjetaProps {
  children: ReactNode;
  variante?: VarianteTarjeta;
  // Posición en la animación de entrada escalonada (si no se indica, no se anima)
  indice?: number;
  animacion?: 'subir' | 'izquierda' | 'derecha';
  interactiva?: boolean;
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
}

export function Tarjeta({ children, variante = 'cristal', indice, animacion = 'subir', interactiva, className, style, onClick }: TarjetaProps) {
  const claseAnimacion = indice === undefined ? '' : animacion === 'izquierda' ? 'entra-izquierda' : animacion === 'derecha' ? 'entra-derecha' : 'bento-entrada';
  return (
    <div
      onClick={onClick}
      style={{ ...(indice !== undefined ? retraso(indice) : {}), ...style }}
      className={unir(
        'rounded-bento relative',
        TARJETAS[variante],
        claseAnimacion,
        interactiva && 'transition-all duration-500 hover:-translate-y-1 hover:shadow-[0_24px_48px_-16px_rgba(0,144,208,0.25)] cursor-pointer',
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ Botones */

type VarianteBoton = 'principal' | 'acento' | 'secundario' | 'peligro' | 'exito' | 'texto';

const BOTONES: Record<VarianteBoton, string> = {
  principal: 'bg-marino text-white shadow-[0_8px_20px_rgba(0,43,92,0.25)] hover:bg-azul hover:shadow-[0_12px_28px_rgba(0,144,208,0.35)] hover:-translate-y-0.5',
  acento: 'bg-azul text-white shadow-[0_8px_20px_rgba(0,144,208,0.3)] hover:bg-azul-oscuro hover:-translate-y-0.5',
  secundario: 'bg-white/85 text-marino border border-slate-200/70 shadow-sm hover:bg-white hover:-translate-y-0.5',
  peligro: 'bg-rose-500 text-white shadow-[0_8px_20px_rgba(244,63,94,0.25)] hover:bg-rose-600 hover:-translate-y-0.5',
  exito: 'bg-emerald-500 text-white shadow-[0_8px_20px_rgba(16,185,129,0.25)] hover:bg-emerald-600 hover:-translate-y-0.5',
  texto: 'text-slate-400 hover:text-azul',
};

interface BotonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: VarianteBoton;
  tamano?: 'normal' | 'pequeno';
  ancho?: boolean;
}

export function Boton({ variante = 'principal', tamano = 'normal', ancho, className, type = 'button', ...resto }: BotonProps) {
  return (
    <button
      type={type}
      {...resto}
      className={unir(
        'inline-flex items-center justify-center gap-2 font-bold transition-all duration-300 cursor-pointer active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 select-none',
        variante === 'texto'
          ? 'text-xs px-2 py-1'
          : tamano === 'pequeno' ? 'text-xs px-4 py-2.5 rounded-full' : 'text-sm px-6 py-3.5 rounded-control',
        BOTONES[variante],
        ancho && 'w-full',
        className,
      )}
    />
  );
}

export function BotonVolver({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Volver"
      className={unir('w-11 h-11 shrink-0 flex items-center justify-center bg-white hover:bg-slate-50 border border-slate-100 rounded-full text-slate-500 shadow-sm transition-all duration-300 hover:shadow-md hover:-translate-x-0.5 cursor-pointer active:scale-90', className)}
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
    </button>
  );
}

/* ------------------------------------------------------------------ Cabecera */

interface CabeceraProps {
  titulo: string;
  subtitulo?: ReactNode;
  onVolver?: () => void;
  acciones?: ReactNode;
}

export function Cabecera({ titulo, subtitulo, onVolver, acciones }: CabeceraProps) {
  return (
    <Tarjeta indice={0} className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-4 mb-6">
      <div className="flex items-center gap-4 min-w-0">
        {onVolver && <BotonVolver onClick={onVolver} />}
        <div className="min-w-0">
          <h1 className="text-xl font-black text-marino tracking-tight leading-tight truncate">{titulo}</h1>
          {subtitulo && <div className="text-xs font-semibold text-slate-400 mt-0.5">{subtitulo}</div>}
        </div>
      </div>
      {acciones && <div className="flex flex-wrap items-center gap-2 sm:gap-3">{acciones}</div>}
    </Tarjeta>
  );
}

/* ------------------------------------------------------------------ Textos */

export function TituloSeccion({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={unir('text-xl sm:text-2xl font-black text-marino tracking-tight', className)}>{children}</h2>;
}

/* ------------------------------------------------------------------ Campos de formulario */

const claseCampo = 'w-full px-5 py-4 bg-white/60 backdrop-blur-md rounded-control border border-white focus:border-azul/30 focus:ring-4 focus:ring-azul/10 focus:outline-none text-marino text-sm font-bold tracking-wide placeholder:text-slate-400 placeholder:font-semibold transition-all shadow-[0_2px_10px_rgba(0,0,0,0.02)]';

export function Campo({ className, ...resto }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...resto} className={unir(claseCampo, className)} />;
}

export function Selector({ className, children, ...resto }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...resto} className={unir(claseCampo, 'cursor-pointer', className)}>{children}</select>;
}

/* ------------------------------------------------------------------ Etiquetas de estado */

type TonoEtiqueta = 'exito' | 'aviso' | 'peligro' | 'info' | 'neutro' | 'oscuro';

const ETIQUETAS: Record<TonoEtiqueta, string> = {
  exito: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  aviso: 'bg-amber-50 text-amber-600 border-amber-100',
  peligro: 'bg-rose-50 text-rose-600 border-rose-100',
  info: 'bg-azul/10 text-azul border-azul/15',
  neutro: 'bg-slate-50 text-slate-500 border-slate-100',
  oscuro: 'bg-marino text-white border-marino',
};

export function Etiqueta({ tono = 'neutro', children, className, title }: { tono?: TonoEtiqueta; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={unir('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-black uppercase tracking-wider whitespace-nowrap', ETIQUETAS[tono], className)}>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ Pestañas con indicador deslizante */

interface PestanasProps<T extends string> {
  opciones: { valor: T; texto: string }[];
  valor: T;
  onCambiar: (valor: T) => void;
  className?: string;
}

export function Pestanas<T extends string>({ opciones, valor, onCambiar, className }: PestanasProps<T>) {
  const activa = Math.max(0, opciones.findIndex(o => o.valor === valor));
  return (
    <div
      className={unir('pestanas glass-container p-1.5 rounded-full', className)}
      style={{ '--total': opciones.length, '--activa': activa } as CSSProperties}
    >
      <span className="pestanas-indicador rounded-full"></span>
      {opciones.map(o => (
        <button
          key={o.valor}
          type="button"
          onClick={() => onCambiar(o.valor)}
          className={unir('py-3 px-3 text-xs font-bold rounded-full cursor-pointer', o.valor === valor ? 'text-white' : 'text-slate-500 hover:text-marino')}
        >
          {o.texto}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ Ventana emergente */

interface ModalProps {
  titulo: string;
  descripcion?: ReactNode;
  children?: ReactNode;
  onCerrar?: () => void;
  ancho?: 'sm' | 'md';
  centrado?: boolean;
  icono?: ReactNode;
}

export function Modal({ titulo, descripcion, children, onCerrar, ancho = 'sm', centrado = false, icono }: ModalProps) {
  return (
    <div className="fixed inset-0 bg-slate-900/25 backdrop-blur-sm flex items-center justify-center p-4 z-50 modal-fondo">
      <div className={unir('glass-container rounded-bento p-7 sm:p-8 w-full shadow-2xl flex flex-col max-h-[90dvh]', ancho === 'md' ? 'max-w-md' : 'max-w-sm')}>
        <div className={unir('flex items-start gap-4 mb-5', centrado ? 'justify-center text-center' : 'justify-between')}>
          <div className={unir('min-w-0', centrado && 'flex flex-col items-center')}>
            {icono && <div className="mb-4">{icono}</div>}
            <h3 className="text-xl font-black text-marino tracking-tight">{titulo}</h3>
            {descripcion && <div className="text-sm text-slate-500 font-medium mt-1.5 leading-relaxed">{descripcion}</div>}
          </div>
          {onCerrar && !centrado && (
            <button type="button" onClick={onCerrar} aria-label="Cerrar" className="w-9 h-9 shrink-0 flex items-center justify-center bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-full cursor-pointer transition-colors active:scale-95">✕</button>
          )}
        </div>
        <div className="overflow-y-auto -mx-1 px-1">{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Estados vacíos y de carga */

export function Vacio({ icono, titulo, texto }: { icono: string; titulo: string; texto?: string }) {
  return (
    <div className="text-center py-12 px-4 bento-entrada">
      <div className="w-16 h-16 bg-white/70 border border-white rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm"><span className="text-2xl">{icono}</span></div>
      <p className="text-marino font-black text-lg tracking-tight">{titulo}</p>
      {texto && <p className="text-sm text-slate-400 font-medium mt-1.5 leading-relaxed max-w-sm mx-auto">{texto}</p>}
    </div>
  );
}

// Tarjetas grises con brillo mientras llegan los datos (mejor que un texto "Cargando...")
export function Esqueleto({ filas = 3, alto = 'h-20', columnas = 1 }: { filas?: number; alto?: string; columnas?: 1 | 2 | 3 }) {
  const rejilla = columnas === 3 ? 'md:grid-cols-2 lg:grid-cols-3' : columnas === 2 ? 'md:grid-cols-2' : '';
  return (
    <div className={unir('grid grid-cols-1 gap-4', rejilla)} aria-label="Cargando" role="status">
      {Array.from({ length: filas }, (_, i) => (
        <div key={i} className={unir('rounded-bento esqueleto', alto)} style={{ animationDelay: `${i * 120}ms` }}></div>
      ))}
    </div>
  );
}
