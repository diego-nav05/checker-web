import { useEffect, useState } from 'react';

// Cada publicación en Vercel genera un archivo /assets/index-XXXX.js con un nombre distinto.
// Si el que sirve ahora la web no coincide con el que tiene cargado esta pestaña, hay versión nueva.
const PATRON_SCRIPT = /src="(\/assets\/index-[^"]+\.js)"/;
const SEGUNDOS_ENTRE_COMPROBACIONES = 60;

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

    comprobar(); // nada más abrir: el móvil puede tener guardada una versión vieja
    const intervalo = setInterval(comprobar, SEGUNDOS_ENTRE_COMPROBACIONES * 1000);
    // También al volver a la pestaña (por ejemplo, el ordenador del aula al día siguiente)
    const alVolver = () => { if (document.visibilityState === 'visible') comprobar(); };
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      clearInterval(intervalo);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, []);

  if (!hayVersionNueva) return null;

  // Pantalla completa que tapa la app: con una versión vieja el QR puede no leerse, así que hay que actualizar sí o sí
  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center p-6 bg-marino/90 backdrop-blur-xl">
      <div className="w-full max-w-sm bg-white rounded-bento p-8 text-center shadow-2xl bento-entrada">
        <div className="w-20 h-20 mx-auto mb-5 rounded-full bg-azul/10 text-azul flex items-center justify-center text-4xl">⬆️</div>
        <h2 className="text-2xl font-black text-marino tracking-tight">Actualiza Checker</h2>
        <p className="text-sm text-slate-500 font-semibold mt-2 leading-relaxed">
          Hay una versión nueva. Actualiza para poder seguir usando la app (no pierdes nada).
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-6 w-full py-4 bg-azul text-white rounded-control text-base font-black cursor-pointer active:scale-95 transition-transform animate-pulse"
        >
          Actualizar ahora
        </button>
      </div>
    </div>
  );
}
