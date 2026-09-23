import { useState, useEffect } from 'react';
import PantallaProfesor from './PantallaProfesor.tsx';
import PantallaAlumno from './PantallaAlumno.tsx';
import PantallaRegistro from './PantallaRegistro.tsx';
import PantallaGestionDocente from './PantallaGestionDocente.tsx';
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
    const doTransition = () => {
      window.history.pushState({ panel: nuevaVista }, '');
      setVista(nuevaVista);
      setNotificacion(null);
    };

    if (!(document as any).startViewTransition) {
      doTransition();
    } else {
      (document as any).startViewTransition(doTransition);
    }
  };

  const volverInicio = () => {
    const doTransition = () => {
      if (window.history.state?.panel !== 'INICIO') {
        window.history.back();
      } else {
        setVista('INICIO');
      }
    };

    if (!(document as any).startViewTransition) {
      doTransition();
    } else {
      (document as any).startViewTransition(doTransition);
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
          
          <div className="pantalla-transicion glass-container rounded-[2.5rem] p-8 sm:p-12 max-w-sm w-full anim-suave relative z-10">
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

      <div className="w-full max-w-xl mx-auto flex flex-col gap-5 sm:gap-6 z-10 anim-suave">
        
        <button onClick={manejarClickAlumnado} className="pantalla-transicion glass-button relative w-full aspect-[21/9] sm:aspect-[3/1] min-h-[120px] rounded-[2.5rem] flex flex-col items-center justify-center group cursor-pointer mt-4 sm:mt-0">
          <span className="text-[clamp(1.75rem,8vw,3.5rem)] font-black tracking-tight text-[#002b5c] group-hover:text-[#0090d0] transition-colors duration-300">ALUMNADO</span>
        </button>

        <button onClick={() => irAPanel('PROFESORADO')} className="pantalla-transicion glass-button relative w-full aspect-[21/9] sm:aspect-[3/1] min-h-[120px] rounded-[2.5rem] flex flex-col items-center justify-center group cursor-pointer">
          <span className="text-[clamp(1.5rem,7vw,3.25rem)] font-black tracking-tight text-[#002b5c] group-hover:text-[#0090d0] transition-colors duration-300">PROFESORADO</span>
        </button>

        <div className="grid grid-cols-2 gap-5 sm:gap-6 mt-2">
          <button onClick={() => irAPanel('GESTION')} className="pantalla-transicion dark-glow-btn relative w-full aspect-square sm:aspect-[4/3] min-h-[120px] rounded-[2.5rem] flex items-center justify-center group cursor-pointer">
            <span className="text-[clamp(1.15rem,5vw,1.75rem)] font-black text-white tracking-tight group-hover:text-[#b3e6ff] transition-colors duration-300">Gestión</span>
          </button>

          <button onClick={() => irAPanel('REGISTRO')} className={`pantalla-transicion ${!alumnoVinculado ? 'primary-glow-btn' : 'glass-button'} relative w-full aspect-square sm:aspect-[4/3] min-h-[120px] rounded-[2.5rem] flex items-center justify-center group cursor-pointer`}>
            <span className={`text-[clamp(1.15rem,5vw,1.75rem)] font-black tracking-tight transition-colors duration-300 ${!alumnoVinculado ? 'text-white' : 'text-[#002b5c] group-hover:text-[#0090d0]'}`}>
              {!alumnoVinculado ? 'Vincular Móvil' : 'Mi Cuenta'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
