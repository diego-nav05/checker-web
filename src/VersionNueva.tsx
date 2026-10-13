import { useEffect, useState } from 'react';

// Cada publicación en Vercel genera un archivo /assets/index-XXXX.js con un nombre distinto.
// Si el que sirve ahora la web no coincide con el que tiene cargado esta pestaña, hay versión nueva.
const PATRON_SCRIPT = /src="(\/assets\/index-[^"]+\.js)"/;
const MINUTOS_ENTRE_COMPROBACIONES = 5;

function scriptCargado(): string | null {
  const script = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]');
  return script ? new URL(script.src).pathname : null;
}

export default function AvisoVersionNueva() {
  const [hayVersionNueva, setHayVersionNueva] = useState(false);

  useEffect(() => {
    const actual = scriptCargado();
    if (!actual) return; // En desarrollo (npm run dev) no hay /assets: no comprobamos nada

    const comprobar = async () => {
      try {
        const html = await (await fetch('/', { cache: 'no-store' })).text();
        const publicado = html.match(PATRON_SCRIPT)?.[1];
        if (publicado && publicado !== actual) setHayVersionNueva(true);
      } catch {
        // Sin conexión: ya lo intentaremos más tarde
      }
    };

    const intervalo = setInterval(comprobar, MINUTOS_ENTRE_COMPROBACIONES * 60_000);
    // También al volver a la pestaña (por ejemplo, el ordenador del aula al día siguiente)
    const alVolver = () => { if (document.visibilityState === 'visible') comprobar(); };
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      clearInterval(intervalo);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, []);

  if (!hayVersionNueva) return null;

  return (
    <div className="fixed bottom-4 inset-x-0 z-[400] flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-3 pl-5 pr-2 py-2 bg-marino/95 text-white rounded-full shadow-[0_16px_32px_-10px_rgba(0,0,0,0.35)] backdrop-blur-2xl border border-white/15 bento-entrada">
        <span className="text-xs sm:text-sm font-semibold">Hay una versión nueva de Checker</span>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-white text-marino rounded-full text-xs font-black uppercase tracking-widest cursor-pointer active:scale-95 transition-transform"
        >
          Actualizar
        </button>
      </div>
    </div>
  );
}
