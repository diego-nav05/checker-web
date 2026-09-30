import { useState, useEffect } from 'react';
import PantallaProfesor from './PantallaProfesor.tsx';
import PantallaAlumno from './PantallaAlumno.tsx';
import PantallaRegistro from './PantallaRegistro.tsx';
import PantallaGestionDocente from './PantallaGestionDocente.tsx';
import BotonCompartir from './BotonCompartir.tsx';
import { supabase } from './supabase';

type Vista = 'INICIO' | 'ALUMNADO' | 'PROFESORADO' | 'REGISTRO' | 'GESTION';

// GlobalAnimStyles se han movido a index.css
const GlobalAnimStyles = () => null;

export default function App() {
  const [vista, setVista] = useState<Vista>('INICIO');
  const [sesionProfesor, setSesionProfesor] = useState<boolean>(false);
  const [emailProfesor, setEmailProfesor] = useState('');
  const [passProfesor, setPassProfesor] = useState('');
  
  const [notificacion, setNotificacion] = useState<{ texto: string; tipo: 'error' | 'info' | 'exito' } | null>(null);
  const [cargandoProfesor, setCargandoProfesor] = useState(false);

  const alumnoVinculado = !!localStorage.getItem('checker_alumno_id');

  useEffect(() => {
    const rol = localStorage.getItem('checker_rol');
    const idAlumno = localStorage.getItem('checker_alumno_id');
    
    if (!idAlumno && rol !== 'profesor') {
      setNotificacion({ texto: '👋 Si eres un nuevo alumno, ve al apartado "Vincular" (o "Mi Cuenta" en PC).', tipo: 'info' });
      const timer = setTimeout(() => setNotificacion(null), 8000);
      return () => clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    if (!window.history.state || !window.history.state.panel) {
      window.history.replaceState({ panel: 'INICIO' }, '');
    }

    const handlePopState = (e: PopStateEvent) => {
      if (e.state && e.state.panel) {
        setVista(e.state.panel);
      } else {
        setVista('INICIO');
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const irAPanel = (nuevaVista: Vista) => {
    window.history.pushState({ panel: nuevaVista }, '');
    setVista(nuevaVista);
    setNotificacion(null);
  };

  const volverInicio = () => {
    if (window.history.state?.panel !== 'INICIO') {
      window.history.back();
    } else {
      setVista('INICIO');
    }
  };

  const mostrarNotificacion = (texto: string, tipo: 'error' | 'info' | 'exito' = 'error') => {
    setNotificacion({ texto, tipo });
    setTimeout(() => setNotificacion(null), 4000);
  };

  const manejarClickAlumnado = () => {
    const idGuardado = localStorage.getItem('checker_alumno_id');
    const rolActual = localStorage.getItem('checker_rol');

    if (rolActual === 'profesor') {
      mostrarNotificacion('Tu cuenta actual es de docente.', 'info');
      return;
    }

    if (!idGuardado) {
      mostrarNotificacion('Ve al apartado "Vincular" (o "Mi Cuenta" en PC) para enlazar tu dispositivo.', 'info');
      irAPanel('REGISTRO');
      return;
    }

    irAPanel('ALUMNADO');
  };

  const manejarClickGestion = () => {
    const idGuardado = localStorage.getItem('checker_alumno_id');
    const rolActual = localStorage.getItem('checker_rol');

    if (idGuardado && rolActual !== 'profesor') {
      mostrarNotificacion('Solo acceso docente. Para desvincular tu móvil, debes pedírselo a un profesor.', 'error');
      return;
    }

    irAPanel('GESTION');
  };

  const manejarClickProfesorado = () => {
    const idGuardado = localStorage.getItem('checker_alumno_id');
    const rolActual = localStorage.getItem('checker_rol');

    if (idGuardado && rolActual !== 'profesor') {
      mostrarNotificacion('Solo acceso docente. Para desvincular tu móvil, debes pedírselo a un profesor.', 'error');
      return;
    }

    irAPanel('PROFESORADO');
  };

  const loginDocente = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotificacion(null);
    setCargandoProfesor(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: emailProfesor, password: passProfesor });
      if (error) throw error;

      const { data: perfil } = await supabase.from('perfiles').select('rol').eq('id', data.user.id).single();
      if (perfil && perfil.rol !== 'profesor') {
        await supabase.auth.signOut();
        throw new Error('Sin privilegios de docente.');
      }

      localStorage.setItem('checker_rol', 'profesor');
      localStorage.removeItem('checker_alumno_id');
      setSesionProfesor(true);
    } catch (err: any) {
      mostrarNotificacion('Credenciales incorrectas o sin acceso.', 'error');
    } finally {
      setCargandoProfesor(false);
    }
  };

  const cerrarSesionDocente = () => {
    setVista('INICIO');
    window.history.replaceState({ panel: 'INICIO' }, '');

    setSesionProfesor(false);
    setEmailProfesor('');
    setPassProfesor('');
    setNotificacion(null);

    localStorage.removeItem('checker_rol');
    localStorage.removeItem('checker_alumno_id');
    localStorage.removeItem('checker_nombre');

    supabase.auth.signOut().catch(() => {});
  };

  // NOTIFICACIÓN CENTRADA CON FLEXBOX (Sin conflictos de transform horizontal)
  const ToastNotificacion = () => {
    if (!notificacion) return null;
    return (
      <div className="fixed top-6 inset-x-0 z-[200] flex justify-center px-4 pointer-events-none">
        <div className={`pointer-events-auto px-6 py-3.5 rounded-2xl sm:rounded-full shadow-[0_16px_32px_-10px_rgba(0,0,0,0.2)] backdrop-blur-2xl flex items-center gap-3 anim-drop max-w-lg border text-center ${
          notificacion.tipo === 'error' ? 'bg-rose-500/90 border-rose-400/50 text-white' : 
          notificacion.tipo === 'exito' ? 'bg-emerald-500/90 border-emerald-400/50 text-white' : 
          'bg-[#002b5c]/90 border-white/20 text-white'
        }`} style={{ boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.2), 0 10px 40px -10px rgba(0,0,0,0.25)' }}>
          <span className="text-sm font-semibold tracking-wide">{notificacion.texto}</span>
        </div>
      </div>
    );
  };

  if (vista === 'ALUMNADO') return <PantallaAlumno onVolver={volverInicio} />;
  if (vista === 'REGISTRO') return <PantallaRegistro onVolver={volverInicio} />;

  if (vista === 'PROFESORADO' || vista === 'GESTION') {
    if (!sesionProfesor) {
      return (
        <div className="min-h-[100dvh] bg-[#F0F4F8] p-4 sm:p-8 flex flex-col items-center justify-center font-sans selection:bg-[#0090d0] selection:text-white relative overflow-hidden">
          <GlobalAnimStyles />
          <div className="glow-blob"></div>
          
          <ToastNotificacion />
          
          <div className="glass-container rounded-[2.5rem] p-8 sm:p-12 max-w-sm w-full anim-suave relative z-10">
            <button 
              onClick={() => { 
                setVista('INICIO'); 
                volverInicio(); 
                setEmailProfesor(''); 
                setPassProfesor(''); 
              }} 
              className="w-11 h-11 flex items-center justify-center bg-white/80 hover:bg-white border border-slate-200/50 rounded-full text-slate-500 shadow-[0_4px_12px_rgba(0,0,0,0.05)] transition-all duration-300 hover:shadow-[0_8px_20px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 active:scale-95 cursor-pointer mb-8 relative z-10 backdrop-blur-md"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
            </button>

            <h2 className="text-3xl font-black text-[#002b5c] tracking-tight leading-none mb-8 relative z-10">
              {vista === 'GESTION' ? 'Gestión' : 'Aula'}
            </h2>

            <form onSubmit={loginDocente} className="flex flex-col gap-4 relative z-10">
              <input type="email" placeholder="Correo UNEATLANTICO" value={emailProfesor} onChange={(e) => setEmailProfesor(e.target.value)} className="w-full p-4 bg-white/50 backdrop-blur-xl rounded-[1.25rem] border border-white focus:border-[#0090d0]/50 focus:ring-4 focus:ring-[#0090d0]/10 focus:outline-none text-[#002b5c] text-sm font-bold tracking-wide transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]" required/>
              <input type="password" placeholder="Contraseña" value={passProfesor} onChange={(e) => setPassProfesor(e.target.value)} className="w-full p-4 bg-white/50 backdrop-blur-xl rounded-[1.25rem] border border-white focus:border-[#0090d0]/50 focus:ring-4 focus:ring-[#0090d0]/10 focus:outline-none text-[#002b5c] text-sm font-bold tracking-wide transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]" required/>
              <button type="submit" disabled={cargandoProfesor} className="w-full mt-4 py-4 dark-glow-btn text-white font-bold rounded-[1.25rem] transition-all active:scale-[0.97] cursor-pointer disabled:opacity-50 text-sm tracking-wide">
                {cargandoProfesor ? 'Verificando...' : 'Acceder'}
              </button>
            </form>
          </div>
        </div>
      );
    }
    return vista === 'PROFESORADO' ? <PantallaProfesor onVolver={cerrarSesionDocente} /> : <PantallaGestionDocente onVolver={cerrarSesionDocente} />;
  }

  return (
    <div className="min-h-[100dvh] bg-[#F0F4F8] flex items-center justify-center py-8 px-4 font-sans selection:bg-[#0090d0] selection:text-white relative overflow-hidden">
      <GlobalAnimStyles />
      <div className="glow-blob"></div>
      
      <ToastNotificacion />

      {vista === 'INICIO' && (
        <BotonCompartir mostrarNotificacion={mostrarNotificacion} />
      )}

      <div className="w-full max-w-xl mx-auto flex flex-col gap-4 sm:gap-5 z-10 anim-suave">
        
        <button onClick={manejarClickAlumnado} className="relative w-full aspect-[21/9] sm:aspect-[3/1] min-h-[130px] rounded-full flex flex-col items-center justify-center group cursor-pointer mt-4 sm:mt-0 overflow-hidden transition-all duration-500 hover:-translate-y-1 hover:shadow-[0_16px_40px_rgba(0,144,208,0.15)] bg-white/60 backdrop-blur-2xl border border-white/80 shadow-[0_8px_32px_rgba(0,0,0,0.04)]">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-in-out"></div>
          <div className="absolute top-0 right-0 w-32 h-32 bg-[#00d2ff]/10 rounded-full blur-2xl -mr-10 -mt-10 transition-transform duration-700 group-hover:scale-150"></div>
          <span className="text-[clamp(2rem,8vw,3.5rem)] font-black tracking-tighter text-[#002b5c] group-hover:text-[#0090d0] transition-colors duration-300 relative z-10 drop-shadow-sm">ALUMNADO</span>
        </button>

        <button onClick={manejarClickProfesorado} className="relative w-full aspect-[21/9] sm:aspect-[3/1] min-h-[130px] rounded-full flex flex-col items-center justify-center group cursor-pointer overflow-hidden transition-all duration-500 hover:-translate-y-1 hover:shadow-[0_16px_40px_rgba(0,43,92,0.12)] bg-[#F0F4F8]/80 backdrop-blur-2xl border border-white/60 shadow-[0_8px_32px_rgba(0,0,0,0.04)]">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-in-out"></div>
          <div className="absolute bottom-0 left-0 w-32 h-32 bg-[#002b5c]/5 rounded-full blur-2xl -ml-10 -mb-10 transition-transform duration-700 group-hover:scale-150"></div>
          <span className="text-[clamp(1.75rem,7vw,3.25rem)] font-black tracking-tighter text-[#002b5c]/90 group-hover:text-[#0090d0] transition-colors duration-300 relative z-10 drop-shadow-sm">PROFESORADO</span>
        </button>

        <div className="grid grid-cols-2 gap-4 sm:gap-5 mt-1 w-full">
          <button onClick={manejarClickGestion} className="relative w-full aspect-square sm:aspect-auto sm:h-[130px] rounded-full flex flex-col items-center justify-center gap-2 group cursor-pointer overflow-hidden transition-all duration-500 hover:-translate-y-1 hover:shadow-[0_16px_40px_rgba(0,43,92,0.3)] bg-gradient-to-br from-[#002b5c]/90 to-[#001530]/90 backdrop-blur-2xl border border-white/20 shadow-[0_8px_32px_rgba(0,0,0,0.1)]">
            <div className="absolute top-0 right-0 w-40 h-40 bg-white/5 rounded-full blur-[30px] -mr-10 -mt-10 transition-transform duration-700 group-hover:scale-150 group-hover:bg-white/10"></div>
            <svg className="w-8 h-8 text-white/80 group-hover:text-white transition-colors duration-300 relative z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            <span className="text-[clamp(1.15rem,5vw,1.5rem)] font-black text-white tracking-tight group-hover:text-[#b3e6ff] transition-colors duration-300 relative z-10">Gestión</span>
          </button>

          <button onClick={() => irAPanel('REGISTRO')} className="relative w-full aspect-square sm:aspect-auto sm:h-[130px] rounded-full flex flex-col items-center justify-center gap-2 group cursor-pointer overflow-hidden transition-all duration-500 hover:-translate-y-1 bg-gradient-to-br from-[#0090d0]/90 to-[#0070a0]/90 hover:shadow-[0_16px_40px_rgba(0,144,208,0.3)] border border-white/20 shadow-[0_8px_32px_rgba(0,144,208,0.2)] backdrop-blur-2xl">
            <div className="absolute top-0 left-0 w-40 h-40 bg-white/10 rounded-full blur-[30px] -ml-10 -mt-10 transition-transform duration-700 group-hover:scale-150 group-hover:bg-white/20"></div>
            
            <svg className="w-8 h-8 relative z-10 transition-colors duration-300 text-white/90 group-hover:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              {alumnoVinculado || localStorage.getItem('checker_rol') === 'profesor' ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              ) : (
                <>
                  <path className="sm:hidden" strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  <path className="hidden sm:block" strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </>
              )}
            </svg>
            
            <span className="text-[clamp(1.15rem,5vw,1.5rem)] font-black tracking-tight transition-colors duration-300 relative z-10 text-white">
              {alumnoVinculado || localStorage.getItem('checker_rol') === 'profesor' ? 'Mi Cuenta' : (
                <>
                  <span className="sm:hidden">Vincular</span>
                  <span className="hidden sm:inline">Mi Cuenta</span>
                </>
              )}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
