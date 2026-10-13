import { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';

interface Props {
  mostrarNotificacion: (texto: string, tipo: 'exito' | 'error' | 'info') => void;
  // En el aula va a la derecha para no quedar encima del QR de asistencia
  lado?: 'izquierda' | 'derecha';
}

export default function BotonCompartir({ mostrarNotificacion, lado = 'izquierda' }: Props) {
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
        className={`absolute bottom-4 sm:bottom-6 ${lado === 'derecha' ? 'right-4 sm:right-6' : 'left-4 sm:left-6'} px-4 h-12 flex items-center justify-center gap-3 bg-white/60 hover:bg-white border border-slate-200/50 rounded-full text-slate-600 shadow-[0_4px_12px_rgba(0,0,0,0.05)] transition-all duration-300 hover:shadow-[0_8px_20px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 active:scale-95 cursor-pointer z-20 backdrop-blur-md select-none`}
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
        <div className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#001a38]/80 backdrop-blur-xl p-4 sm:p-8 overflow-y-auto select-none transition-all duration-500 ${isClosing ? 'opacity-0' : 'opacity-100 animate-[fade-in_0.4s_ease-out]'}`}>
          
          {/* Botón Cerrar (Fuera de la tarjeta) */}
          <button 
            onClick={handleClose} 
            className={`absolute top-6 right-6 sm:top-10 sm:right-10 w-12 h-12 flex items-center justify-center bg-white/10 hover:bg-white/20 border border-white/20 text-white rounded-full backdrop-blur-md shadow-lg transition-all duration-300 hover:scale-110 active:scale-95 cursor-pointer z-10 ${isClosing ? 'scale-75 opacity-0' : 'scale-100 opacity-100'}`}
          >
            <svg className="w-5 h-5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>

          {/* Modal Container */}
          <div className={`flex flex-col items-center justify-center w-full max-w-[90vh] bg-white/95 backdrop-blur-3xl rounded-[3rem] shadow-[0_20px_60px_-10px_rgba(0,0,0,0.4),0_0_0_1px_rgba(255,255,255,0.4)] p-8 sm:p-12 relative overflow-hidden transition-all duration-500 transform ${isClosing ? 'scale-95 opacity-0 translate-y-8' : 'scale-100 opacity-100 translate-y-0 anim-suave'}`}>
            
            {/* Cabecera / Título */}
            <div className="mb-8 text-center space-y-2">
              <h2 className="text-3xl sm:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-[#002b5c] to-[#0090d0] tracking-tight leading-tight pb-1">
                Escanea para unirte
              </h2>
              <p className="text-slate-500 font-medium tracking-wide">Abre la cámara de tu dispositivo y apunta al código</p>
            </div>
            
            {/* Contenedor del QR (Efecto integrado) */}
            <div className="bg-white p-6 sm:p-10 rounded-[2.5rem] shadow-[inset_0_4px_24px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.04)] mb-8 aspect-square w-full flex items-center justify-center relative overflow-hidden group">
              <div className="absolute inset-0 bg-gradient-to-tr from-blue-50 to-transparent opacity-50 pointer-events-none"></div>
              <QRCodeSVG 
                value={window.location.href} 
                size={2048} // Render a large size, CSS scales it down to fit perfectly
                className="w-full h-full pointer-events-none relative z-10 transition-transform duration-700 group-hover:scale-[1.02]"
                level="H" 
                fgColor="#002b5c"
                includeMargin={false}
              />
            </div>
            
            {/* Botón de acción */}
            <button 
              onClick={() => {
                navigator.clipboard.writeText(window.location.href);
                mostrarNotificacion('¡Enlace copiado al portapapeles!', 'exito');
              }}
              className="primary-glow-btn text-white px-8 py-4 rounded-full font-bold tracking-widest uppercase text-sm flex items-center gap-3 cursor-pointer select-none mx-auto w-full max-w-sm justify-center"
            >
              <svg className="w-5 h-5 pointer-events-none opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Copiar enlace
            </button>
          </div>
        </div>
      )}
    </>
  );
}
