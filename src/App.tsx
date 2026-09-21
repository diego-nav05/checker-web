import { useState, useEffect } from 'react';
import PantallaProfesor from './PantallaProfesor.tsx';
import PantallaAlumno from './PantallaAlumno.tsx';
import PantallaRegistro from './PantallaRegistro.tsx';
import PantallaGestionDocente from './PantallaGestionDocente.tsx';
import { supabase } from './supabase';

type Vista = 'INICIO' | 'ALUMNADO' | 'PROFESORADO' | 'REGISTRO' | 'GESTION';

const GlobalAnimStyles = () => (
  <style>{`
    @keyframes suave {
      0% { opacity: 0; transform: translateY(12px) scale(0.98); }
      100% { opacity: 1; transform: translateY(0) scale(1); }
    }
    .anim-suave {
      animation: suave 0.7s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      will-change: transform, opacity;
    }
    @keyframes drop-in {
      0% { opacity: 0; transform: translateY(-16px) scale(0.96); }
      100% { opacity: 1; transform: translateY(0) scale(1); }
    }
    .anim-drop {
      animation: drop-in 0.45s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      will-change: transform, opacity;
    }
  `}</style>
);

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
      setNotificacion({ texto: '👋 Si eres un nuevo alumno, regístrate en "Vincular Móvil".', tipo: 'info' });
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
      mostrarNotificacion('Debes crear una cuenta para vincular este móvil.', 'info');
      irAPanel('REGISTRO');
      return;
    }

    irAPanel('ALUMNADO');
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
        <div className={`pointer-events-auto px-6 py-3.5 rounded-2xl sm:rounded-full shadow-[0_10px_40px_-10px_rgba(0,0,0,0.25)] backdrop-blur-2xl flex items-center gap-3 anim-drop max-w-lg border text-center ${
          notificacion.tipo === 'error' ? 'bg-rose-500/95 border-rose-400/50 text-white' : 
          notificacion.tipo === 'exito' ? 'bg-emerald-500/95 border-emerald-400/50 text-white' : 
          'bg-[#002b5c]/95 border-white/10 text-white'
        }`}>
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
          <div className="absolute top-0 left-0 w-full h-96 bg-gradient-to-b from-[#0090d0]/5 to-transparent pointer-events-none -z-10"></div>
          
          <ToastNotificacion />
          
          <div className="bg-white/60 backdrop-blur-3xl rounded-[3rem] p-8 sm:p-12 max-w-sm w-full shadow-[0_20px_40px_-15px_rgba(0,43,92,0.1)] border border-white/60 anim-suave relative">
            <div className="absolute inset-0 rounded-[3rem] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.8)] pointer-events-none"></div>
            
            <button 
              onClick={() => { 
                setVista('INICIO'); 
                volverInicio(); 
                setEmailProfesor(''); 
                setPassProfesor(''); 
              }} 
              className="w-11 h-11 flex items-center justify-center bg-white hover:bg-slate-50 border border-slate-100/80 rounded-full text-slate-500 shadow-sm transition-all duration-300 hover:shadow-md cursor-pointer active:scale-90 mb-8 relative z-10"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
            </button>

            <h2 className="text-3xl font-black text-[#002b5c] tracking-tight leading-none mb-8 relative z-10">
              {vista === 'GESTION' ? 'Gestión' : 'Aula'}
            </h2>

            <form onSubmit={loginDocente} className="flex flex-col gap-4 relative z-10">
              <input type="email" placeholder="Correo UNEATLANTICO" value={emailProfesor} onChange={(e) => setEmailProfesor(e.target.value)} className="w-full p-4 bg-white/50 backdrop-blur-md rounded-[1.5rem] border border-white focus:border-[#0090d0]/30 focus:ring-4 focus:ring-[#0090d0]/10 focus:outline-none text-[#002b5c] text-sm font-bold tracking-wide transition-all shadow-[0_2px_10px_rgba(0,0,0,0.02)]" required/>
              <input type="password" placeholder="Contraseña" value={passProfesor} onChange={(e) => setPassProfesor(e.target.value)} className="w-full p-4 bg-white/50 backdrop-blur-md rounded-[1.5rem] border border-white focus:border-[#0090d0]/30 focus:ring-4 focus:ring-[#0090d0]/10 focus:outline-none text-[#002b5c] text-sm font-bold tracking-wide transition-all shadow-[0_2px_10px_rgba(0,0,0,0.02)]" required/>
              <button type="submit" disabled={cargandoProfesor} className="w-full mt-4 py-4 bg-gradient-to-b from-[#002b5c] to-[#001a38] text-white font-bold rounded-[1.5rem] transition-all shadow-[0_8px_20px_rgb(0,43,92,0.3)] hover:shadow-[0_12px_25px_rgb(0,43,92,0.4)] active:scale-[0.97] cursor-pointer disabled:opacity-50 text-sm tracking-wide border border-[#002b5c]/50">
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
      <div className="absolute top-0 left-0 w-full h-[50vh] bg-gradient-to-b from-[#0090d0]/5 to-transparent pointer-events-none -z-10"></div>
      
      <ToastNotificacion />

      <div className="w-full max-w-xl mx-auto flex flex-col gap-5 sm:gap-6 z-10 anim-suave">
        
        <button onClick={manejarClickAlumnado} className="relative w-full aspect-[21/9] sm:aspect-[3/1] bg-white/60 backdrop-blur-3xl rounded-[2.5rem] sm:rounded-[3rem] shadow-[0_8px_32px_rgba(0,43,92,0.04)] border border-white/50 flex flex-col items-center justify-center transition-all duration-500 hover:shadow-[0_20px_40px_rgba(0,144,208,0.15)] hover:-translate-y-1 active:scale-[0.97] group overflow-hidden cursor-pointer mt-4 sm:mt-0">
          <div className="absolute inset-0 rounded-[2.5rem] sm:rounded-[3rem] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.8)] pointer-events-none"></div>
          <span className="text-[clamp(1.75rem,8vw,3.5rem)] font-black tracking-tight text-[#002b5c] group-hover:text-[#0090d0] transition-colors duration-300">ALUMNADO</span>
        </button>

        <button onClick={() => irAPanel('PROFESORADO')} className="relative w-full aspect-[21/9] sm:aspect-[3/1] bg-white/60 backdrop-blur-3xl rounded-[2.5rem] sm:rounded-[3rem] shadow-[0_8px_32px_rgba(0,43,92,0.04)] border border-white/50 flex flex-col items-center justify-center transition-all duration-500 hover:shadow-[0_20px_40px_rgba(0,144,208,0.15)] hover:-translate-y-1 active:scale-[0.97] group overflow-hidden cursor-pointer">
          <div className="absolute inset-0 rounded-[2.5rem] sm:rounded-[3rem] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.8)] pointer-events-none"></div>
          <span className="text-[clamp(1.5rem,7vw,3.25rem)] font-black tracking-tight text-[#002b5c] group-hover:text-[#0090d0] transition-colors duration-300">PROFESORADO</span>
        </button>

        <div className="grid grid-cols-2 gap-5 sm:gap-6 mt-2">
          <button onClick={() => irAPanel('GESTION')} className="relative w-full aspect-square sm:aspect-[4/3] bg-gradient-to-br from-[#002b5c] to-[#001a38] backdrop-blur-2xl rounded-[2rem] sm:rounded-[2.5rem] shadow-[0_15px_35px_rgba(0,43,92,0.2)] border border-[#002b5c]/50 flex items-center justify-center transition-all duration-500 hover:shadow-[0_20px_40px_rgba(0,144,208,0.35)] hover:-translate-y-1 active:scale-[0.96] group cursor-pointer overflow-hidden">
            <div className="absolute inset-0 rounded-[2rem] sm:rounded-[2.5rem] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] pointer-events-none"></div>
            <span className="text-[clamp(1.15rem,5vw,1.75rem)] font-black text-white tracking-tight group-hover:text-[#b3e6ff] transition-colors duration-300">Gestión</span>
          </button>

          <button onClick={() => irAPanel('REGISTRO')} className={`relative w-full aspect-square sm:aspect-[4/3] backdrop-blur-3xl rounded-[2rem] sm:rounded-[2.5rem] border flex items-center justify-center transition-all duration-500 hover:-translate-y-1 active:scale-[0.96] group cursor-pointer overflow-hidden ${!alumnoVinculado ? 'bg-gradient-to-br from-[#0090d0] to-[#007fb8] shadow-[0_15px_35px_rgba(0,144,208,0.25)] border-[#0090d0]/50' : 'bg-white/60 shadow-[0_8px_30px_rgba(0,0,0,0.04)] border-white/50 hover:shadow-[0_15px_30px_rgba(0,0,0,0.08)] hover:bg-white'}`}>
            <div className="absolute inset-0 rounded-[2rem] sm:rounded-[2.5rem] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.8)] pointer-events-none"></div>
            <span className={`text-[clamp(1.15rem,5vw,1.75rem)] font-black tracking-tight transition-colors ${!alumnoVinculado ? 'text-white' : 'text-[#002b5c] group-hover:text-[#0090d0]'}`}>
              {!alumnoVinculado ? 'Vincular Móvil' : 'Mi Cuenta'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
