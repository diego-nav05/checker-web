import { useState, useEffect } from 'react';
import PantallaProfesor from './PantallaProfesor.tsx';
import PantallaAlumno from './PantallaAlumno.tsx';
import PantallaRegistro from './PantallaRegistro.tsx';
import PantallaGestionDocente from './PantallaGestionDocente.tsx';
import { supabase } from './supabase';

type Vista = 'INICIO' | 'ALUMNADO' | 'PROFESORADO' | 'REGISTRO' | 'GESTION';

export default function App() {
  const [vista, setVista] = useState<Vista>('INICIO');
  const [sesionProfesor, setSesionProfesor] = useState<boolean>(false);
  const [emailProfesor, setEmailProfesor] = useState('');
  const [passProfesor, setPassProfesor] = useState('');
  
  // Sistema de Pop-ups (Notificaciones)
  const [notificacion, setNotificacion] = useState<{ texto: string; tipo: 'error' | 'info' } | null>(null);
  const [cargandoProfesor, setCargandoProfesor] = useState(false);

  // --- API HISTORY: Prevención de cierre con el botón físico "Atrás" del móvil ---
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
    setNotificacion(null); // Limpiar notificaciones al cambiar de vista
  };

  const volverInicio = () => {
    if (window.history.state?.panel !== 'INICIO') {
      window.history.back();
    } else {
      setVista('INICIO');
    }
  };

  const mostrarNotificacion = (texto: string, tipo: 'error' | 'info' = 'error') => {
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
      mostrarNotificacion('Inicia sesión para vincular tu dispositivo.', 'info');
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
      const { data, error } = await supabase.auth.signInWithPassword({
        email: emailProfesor,
        password: passProfesor,
      });

      if (error) throw error;

      const { data: perfil } = await supabase
        .from('perfiles')
        .select('rol')
        .eq('id', data.user.id)
        .single();

      if (perfil && perfil.rol !== 'profesor') {
        await supabase.auth.signOut();
        throw new Error('Sin privilegios de docente.');
      }

      localStorage.setItem('checker_rol', 'profesor');
      localStorage.removeItem('checker_alumno_id');

      setSesionProfesor(true);
    } catch (err: any) {
      mostrarNotificacion('Credenciales incorrectas o sin acceso.');
    } finally {
      setCargandoProfesor(false);
    }
  };

  const cerrarSesionDocente = async () => {
    setSesionProfesor(false);
    setEmailProfesor('');
    setPassProfesor('');
    setNotificacion(null);

    localStorage.removeItem('checker_rol');
    localStorage.removeItem('checker_alumno_id');
    localStorage.removeItem('checker_nombre');

    await supabase.auth.signOut();
    volverInicio();
  };

  // --- COMPONENTE NOTIFICACIÓN FLOTANTE (POP-UP) ---
  const ToastNotificacion = () => {
    if (!notificacion) return null;
    return (
      <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-50 px-6 py-3.5 rounded-full shadow-2xl backdrop-blur-2xl flex items-center gap-3 transition-all duration-500 ease-out animate-[fade-in_0.3s_ease-out,slide-in-from-top-4_0.3s_ease-out] w-[90%] max-w-sm border ${
        notificacion.tipo === 'error' 
          ? 'bg-rose-500/90 border-rose-400/50 text-white' 
          : 'bg-[#002b5c]/90 border-[#0090d0]/50 text-white'
      }`}>
        <span className="flex-shrink-0">
          {notificacion.tipo === 'error' ? '⚠️' : 'ℹ️'}
        </span>
        <p className="text-sm font-semibold tracking-tight leading-tight">
          {notificacion.texto}
        </p>
      </div>
    );
  };

  // --- ENRUTAMIENTO DE PANTALLAS ---
  if (vista === 'ALUMNADO') return <PantallaAlumno onVolver={volverInicio} />;
  if (vista === 'REGISTRO') return <PantallaRegistro onVolver={volverInicio} />;

  if (vista === 'PROFESORADO' || vista === 'GESTION') {
    if (!sesionProfesor) {
      return (
        <div className="min-h-screen bg-[#F5F5F9] p-6 flex flex-col items-center justify-center font-sans selection:bg-[#0090d0] selection:text-white relative">
          <ToastNotificacion />
          
          <div className="bg-white/80 backdrop-blur-3xl rounded-[3rem] p-8 sm:p-12 max-w-sm w-full shadow-[0_20px_40px_-15px_rgba(0,43,92,0.1)] border border-white/60 animate-[fade-in_0.4s_ease-out,zoom-in_0.4s_ease-out]">
            <button
              onClick={() => {
                volverInicio();
                setEmailProfesor('');
                setPassProfesor('');
              }}
              className="w-10 h-10 flex items-center justify-center bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-full transition-colors active:scale-95 mb-8 cursor-pointer"
            >
              ←
            </button>

            <h2 className="text-3xl font-black text-[#002b5c] tracking-tight leading-none mb-8">
              {vista === 'GESTION' ? 'Gestión' : 'Aula'}
            </h2>

            <form onSubmit={loginDocente} className="flex flex-col gap-4">
              <input
                type="email"
                placeholder="Correo UNEATLANTICO"
                value={emailProfesor}
                onChange={(e) => setEmailProfesor(e.target.value)}
                className="w-full p-4 bg-slate-50/50 backdrop-blur-sm rounded-2xl border border-slate-200/50 focus:border-[#0090d0] focus:ring-4 focus:ring-[#0090d0]/10 focus:outline-none text-[#002b5c] text-sm font-semibold transition-all"
                required
              />

              <input
                type="password"
                placeholder="Contraseña"
                value={passProfesor}
                onChange={(e) => setPassProfesor(e.target.value)}
                className="w-full p-4 bg-slate-50/50 backdrop-blur-sm rounded-2xl border border-slate-200/50 focus:border-[#0090d0] focus:ring-4 focus:ring-[#0090d0]/10 focus:outline-none text-[#002b5c] text-sm font-semibold transition-all"
                required
              />

              <button
                type="submit"
                disabled={cargandoProfesor}
                className="w-full mt-2 py-4 bg-[#002b5c] hover:bg-[#0090d0] text-white font-bold rounded-2xl transition-all shadow-[0_8px_20px_rgb(0,43,92,0.2)] hover:shadow-[0_8px_25px_rgb(0,144,208,0.4)] active:scale-[0.97] cursor-pointer disabled:opacity-50 text-sm"
              >
                {cargandoProfesor ? 'Validando...' : 'Acceder'}
              </button>
            </form>
          </div>
        </div>
      );
    }

    return vista === 'PROFESORADO' 
      ? <PantallaProfesor onVolver={cerrarSesionDocente} /> 
      : <PantallaGestionDocente onVolver={cerrarSesionDocente} />;
  }

  // --- VISTA PRINCIPAL (DISEÑO iOS 27 / UNEATLANTICO) ---
  return (
    <div className="min-h-screen bg-[#F5F5F9] flex items-center justify-center py-8 px-4 font-sans selection:bg-[#0090d0] selection:text-white relative overflow-hidden">
      <ToastNotificacion />

      {/* Fondos difuminados para ambiente moderno (Opcional, muy sutil) */}
      <div className="absolute top-0 left-0 w-full h-96 bg-gradient-to-b from-[#0090d0]/5 to-transparent pointer-events-none -z-10"></div>

      <div className="w-full max-w-xl mx-auto flex flex-col gap-4 sm:gap-6 z-10 animate-[fade-in_0.5s_ease-out]">
        
        {/* BOTÓN 1: ALUMNADO (Arriba) */}
        <button
          onClick={manejarClickAlumnado}
          className="relative w-full aspect-[21/9] sm:aspect-[3/1] bg-white/70 backdrop-blur-3xl rounded-[2.5rem] sm:rounded-[3rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/60 flex items-center justify-center transition-all duration-400 hover:shadow-[0_20px_40px_rgb(0,144,208,0.15)] hover:bg-white active:scale-[0.96] group overflow-hidden cursor-pointer"
        >
          <span className="text-[clamp(1.75rem,8vw,3.5rem)] font-black tracking-tight text-[#002b5c] group-hover:text-[#0090d0] transition-colors duration-300">
            ALUMNADO
          </span>
        </button>

        {/* BOTÓN 2: PROFESORADO (Centro) */}
        <button
          onClick={() => irAPanel('PROFESORADO')}
          className="relative w-full aspect-[21/9] sm:aspect-[3/1] bg-white/70 backdrop-blur-3xl rounded-[2.5rem] sm:rounded-[3rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/60 flex items-center justify-center transition-all duration-400 hover:shadow-[0_20px_40px_rgb(0,144,208,0.15)] hover:bg-white active:scale-[0.96] group overflow-hidden cursor-pointer"
        >
          <span className="text-[clamp(1.5rem,7vw,3.25rem)] font-black tracking-tight text-[#002b5c] group-hover:text-[#0090d0] transition-colors duration-300">
            PROFESORADO
          </span>
        </button>

        {/* FILA INFERIOR: Gestión (Izquierda) y Acceso (Derecha) */}
        <div className="grid grid-cols-2 gap-4 sm:gap-6 mt-2">
          
          <button
            onClick={() => irAPanel('GESTION')}
            className="relative w-full aspect-square sm:aspect-[4/3] bg-[#002b5c]/95 backdrop-blur-2xl rounded-[2rem] sm:rounded-[2.5rem] shadow-[0_15px_35px_rgb(0,43,92,0.2)] border border-[#002b5c] flex items-center justify-center transition-all duration-400 hover:shadow-[0_20px_40px_rgb(0,144,208,0.35)] hover:bg-[#0090d0] hover:border-[#0090d0] active:scale-[0.95] group cursor-pointer"
          >
            <span className="text-[clamp(1.15rem,5vw,1.75rem)] font-extrabold text-white tracking-tight">
              Gestión
            </span>
          </button>

          <button
            onClick={() => irAPanel('REGISTRO')}
            className="relative w-full aspect-square sm:aspect-[4/3] bg-white/70 backdrop-blur-3xl rounded-[2rem] sm:rounded-[2.5rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/60 flex items-center justify-center transition-all duration-400 hover:shadow-[0_15px_30px_rgb(0,0,0,0.08)] hover:bg-white active:scale-[0.95] group cursor-pointer"
          >
            <span className="text-[clamp(1.15rem,5vw,1.75rem)] font-extrabold text-[#002b5c] group-hover:text-[#0090d0] transition-colors tracking-tight">
              Acceso
            </span>
          </button>
          
        </div>
      </div>
    </div>
  );
}
