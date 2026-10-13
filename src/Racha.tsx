import { useId } from 'react';
import type { CSSProperties } from 'react';
import { Tarjeta } from './ui';

// Cuanta más racha, más grande y espectacular el fuego (cambia de color, brilla y suelta chispas)
const NIVELES = [
  { desde: 0, colores: ['#e2e8f0', '#cbd5e1', '#f1f5f9'], tamano: 54, chispas: 0, brillo: 0 },
  { desde: 1, colores: ['#fdba74', '#f97316', '#fef3c7'], tamano: 58, chispas: 0, brillo: 0.25 },
  { desde: 3, colores: ['#fb923c', '#ea580c', '#fde047'], tamano: 66, chispas: 2, brillo: 0.4 },
  { desde: 5, colores: ['#f97316', '#dc2626', '#fde047'], tamano: 74, chispas: 4, brillo: 0.55 },
  { desde: 10, colores: ['#38bdf8', '#2563eb', '#e0f2fe'], tamano: 82, chispas: 6, brillo: 0.7 },
  { desde: 20, colores: ['#e879f9', '#9333ea', '#fef9c3'], tamano: 90, chispas: 8, brillo: 0.85 },
];

// Posición, desvío y retraso de cada chispa (fijos para que no salten al volver a pintar)
const CHISPAS = [
  { x: 30, dx: -14, retraso: 0 }, { x: 62, dx: 12, retraso: 0.5 }, { x: 45, dx: -6, retraso: 1.1 },
  { x: 70, dx: 18, retraso: 0.8 }, { x: 25, dx: -20, retraso: 1.4 }, { x: 55, dx: 8, retraso: 0.25 },
  { x: 38, dx: -10, retraso: 1.6 }, { x: 66, dx: 22, retraso: 1.25 },
];

export function nivelDeRacha(racha: number) {
  return [...NIVELES].reverse().find(n => racha >= n.desde) ?? NIVELES[0];
}

export function Llama({ racha }: { racha: number }) {
  const n = nivelDeRacha(racha);
  const id = useId().replace(/:/g, '');
  const encendida = racha > 0;
  return (
    <div className="relative shrink-0 flex items-end justify-center" style={{ width: n.tamano + 24, height: n.tamano + 24 }}>
      {encendida && (
        <div
          className="absolute inset-2 rounded-full blur-xl halo-llama"
          style={{ background: n.colores[1], '--brillo': n.brillo } as CSSProperties}
        ></div>
      )}
      {CHISPAS.slice(0, n.chispas).map((c, i) => (
        <span
          key={i}
          className="chispa"
          style={{ left: `${c.x}%`, background: i % 2 ? n.colores[0] : n.colores[2], animationDelay: `${c.retraso}s`, '--dx': `${c.dx}px` } as CSSProperties}
        ></span>
      ))}
      <div className={`relative ${encendida ? 'llama' : ''} ${racha >= 10 ? 'llama-rapida' : ''}`} style={{ width: n.tamano, height: n.tamano * 1.2 }}>
        <svg viewBox="0 0 64 80" className="w-full h-full drop-shadow-sm" aria-hidden="true">
          <defs>
            <linearGradient id={`exterior-${id}`} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor={n.colores[1]} />
              <stop offset="100%" stopColor={n.colores[0]} />
            </linearGradient>
            <linearGradient id={`nucleo-${id}`} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="100%" stopColor={n.colores[2]} />
            </linearGradient>
          </defs>
          <path
            fill={`url(#exterior-${id})`}
            d="M32 2C36 18 54 26 54 48C54 66 44 78 32 78C20 78 10 66 10 48C10 36 18 30 22 22C24 32 28 34 30 34C28 22 30 12 32 2Z"
          />
          <path
            className={encendida ? 'nucleo' : ''}
            fill={`url(#nucleo-${id})`}
            opacity={encendida ? 0.95 : 0.6}
            d="M32 36C35 45 44 49 44 60C44 70 38 76 32 76C26 76 20 70 20 60C20 52 26 49 28 43C29 48 31 50 32 50C31 45 31 40 32 36Z"
          />
        </svg>
      </div>
    </div>
  );
}

// Tarjeta de la racha para la pantalla del alumno
export default function TarjetaRacha({ racha, record, indice }: { racha: number; record: number; indice: number }) {
  const fondoArcoiris = racha >= 20;
  return (
    <Tarjeta indice={indice} className={`p-5 flex items-center gap-3 overflow-hidden ${fondoArcoiris ? 'fondo-leyenda' : ''}`}>
      <Llama racha={racha} />
      <div className="min-w-0">
        <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">Tu racha</p>
        <p className="flex flex-wrap items-baseline gap-x-1.5 mt-0.5">
          <span className="text-4xl font-black tracking-tighter text-marino tabular-nums">{racha}</span>
          <span className="text-xs font-bold text-slate-500 whitespace-nowrap">{racha === 1 ? 'clase seguida' : 'clases seguidas'}</span>
        </p>
        <p className="text-[11px] font-semibold text-slate-400 mt-1 leading-snug">
          {racha === 0
            ? (record > 0 ? `Tu récord: ${record}. ¡Ve a clase para volver a encenderla!` : 'Ve a clase para encender tu racha.')
            : record > racha ? `Tu récord: ${record}` : '¡Es tu récord!'}
        </p>
      </div>
    </Tarjeta>
  );
}
