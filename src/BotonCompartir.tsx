import { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Boton } from './ui';

// Siempre la dirección principal de la web (sin restos de la pantalla en la que estés)
const enlace = window.location.origin;
const puedeCompartir = typeof navigator.share === 'function';

interface Props {
  mostrarNotificacion: (texto: string, tipo: 'exito' | 'error' | 'info') => void;
}

export default function BotonCompartir({ mostrarNotificacion }: Props) {
  const [mostrarQR, setMostrarQR] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      setMostrarQR(false);
      setIsClosing(false);
    }, 300);
  };

  // Escuchar tecla Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mostrarQR) {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mostrarQR]);

  return (
    <>
      <button 
        onClick={() => setMostrarQR(true)}
        className={`absolute bottom-4 left-4 sm:bottom-6 sm:left-6 px-4 h-12 flex items-center justify-center gap-3 bg-white/60 hover:bg-white border border-slate-200/50 rounded-full text-slate-600 shadow-[0_4px_12px_rgba(0,0,0,0.05)] transition-all duration-300 hover:shadow-[0_8px_20px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 active:scale-95 cursor-pointer z-20 backdrop-blur-md select-none`}
        title="Compartir y código QR"
      >
        <div className="flex items-center gap-1.5 opacity-80 pointer-events-none">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
          </svg>
          <span className="text-slate-300 font-light">/</span>
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="7" height="7" rx="1" strokeLinecap="round" strokeLinejoin="round"/>
            <rect x="14" y="3" width="7" height="7" rx="1" strokeLinecap="round" strokeLinejoin="round"/>
            <rect x="3" y="14" width="7" height="7" rx="1" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M14 14h7v7h-7z" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </button>

      {mostrarQR && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
          className={`fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/25 backdrop-blur-sm p-4 overflow-y-auto select-none modal-fondo transition-opacity duration-300 ${isClosing ? 'opacity-0' : 'opacity-100'}`}
        >
          <div className="glass-container rounded-bento p-6 sm:p-8 w-full max-w-md shadow-2xl relative">
            <button
              onClick={handleClose}
              aria-label="Cerrar"
              className="absolute top-5 right-5 w-9 h-9 flex items-center justify-center bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-full cursor-pointer transition-colors active:scale-95"
            >
              ✕
            </button>

            <div className="flex items-center gap-3 mb-6 pr-12">
              <div className="w-11 h-11 shrink-0 rounded-control bg-marino flex items-center justify-center shadow-[0_8px_20px_rgba(0,43,92,0.3)]">
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2M8 8h3v3H8zM13 13h3v3h-3zM13 8h3M8 13v3" /></svg>
              </div>
              <div>
                <h2 className="text-xl font-black text-marino tracking-tight">Escanea para entrar en Checker</h2>
                <p className="text-sm text-slate-500 font-medium mt-0.5">Apunta con la cámara del móvil al código</p>
              </div>
            </div>

            <div className="bg-white p-5 sm:p-6 rounded-bento border border-slate-100 shadow-[0_20px_50px_-12px_rgba(0,43,92,0.15)] aspect-square w-full flex items-center justify-center mb-6">
              <QRCodeSVG
                value={enlace}
                size={1024}
                className="w-full h-full pointer-events-none"
                level="H"
                fgColor="#002b5c"
                includeMargin={false}
              />
            </div>

            <p className="text-center text-xs font-bold text-slate-400 mb-4 truncate">{enlace.replace(/^https?:\/\//, '')}</p>

            <div className={`grid gap-3 ${puedeCompartir ? 'grid-cols-2' : 'grid-cols-1'}`}>
              <Boton
                ancho
                variante={puedeCompartir ? 'secundario' : 'principal'}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(enlace);
                    mostrarNotificacion('¡Enlace copiado!', 'exito');
                  } catch {
                    mostrarNotificacion(`Copia este enlace: ${enlace}`, 'info');
                  }
                }}
              >
                Copiar enlace
              </Boton>
              {puedeCompartir && (
                <Boton ancho onClick={() => navigator.share({ title: 'Checker', text: 'Entra en Checker para pasar lista en clase', url: enlace }).catch(() => {})}>
                  Compartir
                </Boton>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
