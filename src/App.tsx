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
  const [errorLoginProfesor, setErrorLoginProfesor] = useState<string | null>(null);
  const [cargandoProfesor, setCargandoProfesor] = useState(false);

  // Control del historial para el botón "Atrás" del móvil
  useEffect(() => {
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
  };

  const volverInicio = () => {
    if (window.history.state?.panel) {
      window.history.back();
    } else {
      setVista('INICIO');
    }
  };

  const manejarClickAlumnado = () => {
    const idGuardado = localStorage.getItem('checker_alumno_id');
    const rolActual = localStorage.getItem('checker_rol');

    if (rolActual === 'profesor') {
      alert('⛔ Las cuentas de profesorado no tienen acceso al panel de alumnado.');
      return;
    }

    if (!idGuardado) {
      alert('Para acceder como alumno, primero debes iniciar sesión o crear tu cuenta en "Acceso" para vincular este dispositivo.');
      irAPanel('REGISTRO');
      return;
    }

    irAPanel('ALUMNADO');
  };

  const loginDocente = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorLoginProfesor(null);
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
        throw new Error('Esta cuenta no tiene permisos de profesorado.');
      }

      localStorage.setItem('checker_rol', 'profesor');
      localStorage.removeItem('checker_alumno_id');

      setSesionProfesor(true);
    } catch (err: any) {
      setErrorLoginProfesor(err.message || 'Credenciales incorrectas');
    } finally {
      setCargandoProfesor(false);
    }
  };

  const cerrarSesionDocente = async () => {
    setSesionProfesor(false);
    setEmailProfesor('');
    setPassProfesor('');
    setErrorLoginProfesor(null);

    localStorage.removeItem('checker_rol');
    localStorage.removeItem('checker_alumno_id');
    localStorage.removeItem('checker_nombre');

    await supabase.auth.signOut();
    volverInicio();
  };

  if (vista === 'ALUMNADO') {
    return <PantallaAlumno onVolver={volverInicio} />;
  }

  if (vista === 'REGISTRO') {
    return <PantallaRegistro onVolver={volverInicio} />;
  }

  if (vista === 'PROFESORADO') {
    if (!sesionProfesor) {
      return (
        <div className="min-h-screen bg-[#F5F5F7] p-4 sm:p-8 flex flex-col items-center justify-center font-sans selection:bg-[#0090d0] selection:text-white">
          <div className="bg-white rounded-[2rem] sm:rounded-[2.5rem] p-6 sm:p-12 max-w-md w-full shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] border border-black/[0.02]">
            <button
              onClick={() => {
                volverInicio();
                setErrorLoginProfesor(null);
                setEmailProfesor('');
                setPassProfesor('');
              }}
              className="text-xs font-bold text-slate-500 hover:text-slate-800 mb-6 cursor-pointer"
            >
              ← Volver
            </button>

            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              Acceso Docente
            </h2>
            <p className="text-slate-500 text-xs sm:text-sm mt-1 mb-8 font-medium">
              Introduce tus credenciales para proyectar el aula.
            </p>

            <form onSubmit={loginDocente} className="flex flex-col gap-4 sm:gap-5">
              <input
                type="email"
                placeholder="Correo institucional"
                value={emailProfesor}
                onChange={(e) => setEmailProfesor(e.target.value)}
                className="w-full p-3.5 sm:p-4 bg-[#F5F5F7] rounded-2xl border border-transparent focus:border-[#0090d0] focus:outline-none text-slate-900 text-sm font-medium"
                required
              />

              <input
                type="password"
                placeholder="Contraseña"
                value={passProfesor}
                onChange={(e) => setPassProfesor(e.target.value)}
                className="w-full p-3.5 sm:p-4 bg-[#F5F5F7] rounded-2xl border border-transparent focus:border-[#0090d0] focus:outline-none text-slate-900 text-sm font-medium"
                required
              />

              <button
                type="submit"
                disabled={cargandoProfesor}
                className="w-full py-3.5 sm:py-4 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-2xl transition-all shadow-sm active:scale-[0.98] cursor-pointer disabled:opacity-50 text-sm sm:text-base"
              >
                {cargandoProfesor ? 'Verificando...' : 'Entrar al Aula'}
              </button>
            </form>

            {errorLoginProfesor && (
              <div className="mt-4 p-3 bg-rose-50 border border-rose-100 rounded-xl text-rose-700 text-xs font-semibold text-center">
                {errorLoginProfesor}
              </div>
            )}
          </div>
        </div>
      );
    }

    return <PantallaProfesor onVolver={cerrarSesionDocente} />;
  }

  if (vista === 'GESTION') {
    if (!sesionProfesor) {
      return (
        <div className="min-h-screen bg-[#F5F5F7] p-4 sm:p-8 flex flex-col items-center justify-center font-sans selection:bg-[#0090d0] selection:text-white">
          <div className="bg-white rounded-[2rem] sm:rounded-[2.5rem] p-6 sm:p-12 max-w-md w-full shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] border border-black/[0.02]">
            <button
              onClick={() => {
                volverInicio();
                setErrorLoginProfesor(null);
                setEmailProfesor('');
                setPassProfesor('');
              }}
              className="text-xs font-bold text-slate-500 hover:text-slate-800 mb-6 cursor-pointer"
            >
              ← Volver
            </button>

            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              Seguridad Administrativa
            </h2>
            <p className="text-slate-500 text-xs sm:text-sm mt-1 mb-8 font-medium">
              Autentícate como docente para acceder a la gestión global.
            </p>

            <form onSubmit={loginDocente} className="flex flex-col gap-4 sm:gap-5">
              <input
                type="email"
                placeholder="Correo institucional"
                value={emailProfesor}
                onChange={(e) => setEmailProfesor(e.target.value)}
                className="w-full p-3.5 sm:p-4 bg-[#F5F5F7] rounded-2xl border border-transparent focus:border-[#0090d0] focus:outline-none text-slate-900 text-sm font-medium"
                required
              />
              <input
                type="password"
                placeholder="Contraseña"
                value={passProfesor}
                onChange={(e) => setPassProfesor(e.target.value)}
                className="w-full p-3.5 sm:p-4 bg-[#F5F5F7] rounded-2xl border border-transparent focus:border-[#0090d0] focus:outline-none text-slate-900 text-sm font-medium"
                required
              />
              <button
                type="submit"
                disabled={cargandoProfesor}
                className="w-full py-3.5 sm:py-4 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-2xl transition-all shadow-sm active:scale-[0.98] cursor-pointer disabled:opacity-50 text-sm sm:text-base"
              >
                {cargandoProfesor ? 'Verificando...' : 'Acceder al Panel'}
              </button>
            </form>
            {errorLoginProfesor && (
              <div className="mt-4 p-3 bg-rose-50 border border-rose-100 rounded-xl text-rose-700 text-xs font-semibold text-center">
                {errorLoginProfesor}
              </div>
            )}
          </div>
        </div>
      );
    }

    return <PantallaGestionDocente onVolver={cerrarSesionDocente} />;
  }

  return (
    <div className="min-h-screen bg-[#F5F5F7] flex items-center justify-center p-3 sm:p-6 md:p-8 font-sans selection:bg-[#0090d0] selection:text-white">
      <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-6 md:gap-8">
        {/* Columna Izquierda */}
        <div className="md:col-span-2 flex flex-col gap-3 sm:gap-6 md:gap-8">
          <button
            onClick={manejarClickAlumnado}
            className="w-full min-w-0 bg-white rounded-[2rem] sm:rounded-[2.5rem] py-8 px-4 sm:p-8 md:p-12 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] border border-black/[0.02] hover:shadow-[0_20px_40px_-15px_rgba(0,144,208,0.15)] transition-all cursor-pointer group grid place-items-center md:flex md:flex-col md:justify-center md:items-start min-h-[140px] sm:min-h-[180px] md:min-h-[220px] active:scale-[0.98]"
          >
            <h2 className="w-full text-center md:text-left text-[clamp(1.5rem,7vw,3.75rem)] font-extrabold text-slate-900 tracking-tight group-hover:text-[#0090d0] transition-colors leading-none select-none">
              ALUMNADO
            </h2>
          </button>

          <button
            onClick={() => irAPanel('PROFESORADO')}
            className="w-full min-w-0 bg-white rounded-[2rem] sm:rounded-[2.5rem] py-8 px-4 sm:p-8 md:p-12 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] border border-black/[0.02] hover:shadow-[0_20px_40px_-15px_rgba(0,144,208,0.15)] transition-all cursor-pointer group grid place-items-center md:flex md:flex-col md:justify-center md:items-start min-h-[140px] sm:min-h-[180px] md:min-h-[220px] active:scale-[0.98]"
          >
            <h2 className="w-full text-center md:text-left text-[clamp(1.35rem,6.2vw,3.75rem)] font-extrabold text-slate-900 tracking-tight group-hover:text-[#0090d0] transition-colors leading-none select-none">
              PROFESORADO
            </h2>
          </button>
        </div>

        {/* Columna Derecha */}
        <div className="md:col-span-1 flex flex-col gap-3 sm:gap-6 md:gap-8">
          <button
            onClick={() => irAPanel('REGISTRO')}
            className="w-full min-w-0 bg-white rounded-[2rem] sm:rounded-[2.5rem] py-6 px-4 sm:p-8 md:p-10 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] border border-black/[0.02] hover:shadow-[0_20px_40px_-15px_rgba(0,144,208,0.15)] transition-all cursor-pointer group flex flex-col items-center justify-center min-h-[120px] sm:min-h-[160px] active:scale-[0.98]"
          >
            <h3 className="w-full text-center text-[clamp(1.35rem,5.5vw,1.875rem)] font-extrabold text-slate-900 tracking-tight group-hover:text-[#0090d0] transition-colors leading-tight select-none">
              Acceso
            </h3>
            <p className="w-full text-center text-xs sm:text-sm text-slate-500 mt-1 sm:mt-2 font-medium select-none">
              Crear o recuperar cuenta
            </p>
          </button>

          <button
            onClick={() => irAPanel('GESTION')}
            className="w-full min-w-0 bg-slate-900 rounded-[2rem] sm:rounded-[2.5rem] py-6 px-4 sm:p-8 md:p-10 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.2)] border border-slate-800 hover:bg-[#0090d0] hover:border-[#0090d0] transition-all cursor-pointer group flex flex-col items-center justify-center min-h-[120px] sm:min-h-[160px] active:scale-[0.98]"
          >
            <h3 className="w-full text-center text-[clamp(1.35rem,5.5vw,1.875rem)] font-extrabold text-white tracking-tight leading-tight select-none">
              Gestión Docente
            </h3>
          </button>
        </div>
      </div>
    </div>
  );
}
