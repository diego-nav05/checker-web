import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

interface Props {
  mostrarNotificacion: (texto: string, tipo: 'exito' | 'error' | 'info') => void;
}

export default function BotonCompartir({ mostrarNotificacion }: Props) {
  const [mostrarQR, setMostrarQR] = useState(false);

  return (
    <>
      <button 
        onClick={() => setMostrarQR(true)}
        className="absolute bottom-4 left-4 sm:bottom-6 sm:left-6 px-4 h-12 flex items-center justify-center gap-3 bg-white/60 hover:bg-white border border-slate-200/50 rounded-full text-slate-600 shadow-[0_4px_12px_rgba(0,0,0,0.05)] transition-all duration-300 hover:shadow-[0_8px_20px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 active:scale-95 cursor-pointer z-20 backdrop-blur-md select-none"
        title="Compartir y Código QR"
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
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#F0F4F8] p-4 sm:p-8 anim-drop overflow-y-auto select-none">
          <button 
            onClick={() => setMostrarQR(false)} 
            className="absolute top-4 right-4 sm:top-8 sm:right-8 w-12 h-12 flex items-center justify-center bg-white border border-slate-200/50 rounded-full text-slate-500 shadow-[0_4px_12px_rgba(0,0,0,0.05)] transition-all duration-300 hover:shadow-[0_8px_20px_rgba(0,0,0,0.08)] hover:scale-105 active:scale-95 cursor-pointer z-10"
          >
            <svg className="w-6 h-6 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>

          <div className="flex flex-col items-center justify-center w-full max-w-2xl lg:max-w-4xl bg-white rounded-[2rem] shadow-2xl p-6 sm:p-12 relative overflow-hidden">
            <h2 className="text-2xl sm:text-4xl lg:text-5xl font-black text-[#002b5c] tracking-tight mb-8 text-center leading-tight">Escanea para unirte</h2>
            
            <div className="bg-white p-4 sm:p-8 rounded-3xl shadow-[0_8px_32px_rgba(0,0,0,0.1)] border border-slate-100 mb-8 aspect-square w-full flex items-center justify-center" style={{ maxWidth: 'min(70vh, 100%)' }}>
              <QRCodeSVG 
                value={window.location.href} 
                size={1024} 
                className="w-full h-full pointer-events-none"
                level="H" 
                includeMargin={false}
              />
            </div>
            
            <button 
              onClick={() => {
                navigator.clipboard.writeText(window.location.href);
                mostrarNotificacion('¡Enlace copiado!', 'exito');
              }}
              className="px-6 py-4 rounded-full bg-[#F0F4F8] hover:bg-[#e2e8f0] text-[#002b5c] font-bold tracking-wide transition-all active:scale-95 flex items-center gap-3 cursor-pointer select-none"
            >
              <svg className="w-5 h-5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
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
