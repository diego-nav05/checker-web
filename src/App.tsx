import { useState } from 'react';
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

  const manejarClickAlumnado = () => {
    // Leemos el estado actual en el momento exacto del clic
    const idGuardado = localStorage.getItem('checker_alumno_id');
    const rolActual = localStorage.getItem('checker_rol');

    // Bloqueo absoluto si la sesión es de docente
    if (rolActual === 'profesor') {
      alert('⛔ Las cuentas de profesorado no tienen acceso al panel de alumnado.');
      return;
    }

    // Si no hay sesión válida de alumno, redirigimos a registro
    if (!idGuardado) {
      alert('Para acceder como alumno, primero debes iniciar sesión o crear tu cuenta en "Acceso" para vincular este dispositivo.');
      setVista('REGISTRO');
      return;
    }

    setVista('ALUMNADO');
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

      // Forzamos el rol docente y limpiamos cualquier sesión de alumno previa
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
    
    // Borrado limpio del historial al cerrar sesión
    localStorage.removeItem('checker_rol');
    localStorage.removeItem('checker_alumno_id');
    localStorage.removeItem('checker_nombre');

    await supabase.auth.signOut();
    setVista('INICIO');
  };

  if (vista === 'ALUMNADO') {
    return <PantallaAlumno onVolver={() => setVista('INICIO')} />;
  }

  if (vista === 'REGISTRO') {
    return <PantallaRegistro onVolver={() => setVista('INICIO')} />;
  }

  if (vista === 'PROFESORADO') {
    if (!sesionProfesor) {
      return (
        <div className="min-h-screen bg-[#F5F5F7] p-4 sm:p-8 flex flex-col items-center justify-center font-sans selection:bg-[#0090d0] selection:text-white">
          <div className="bg-white rounded-[2.5rem] p-8 sm:p-12 max-w-md w-full shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] border border-black/[0.02]">
            <button
              onClick={() => {
                setVista('INICIO');
                setErrorLoginProfesor(null);
                setEmailProfesor('');
                setPassProfesor('');
              }}
              className="text-xs font-bold text-slate-500 hover:text-slate-800 mb-6 cursor-pointer"
            >
              ← Volver
            </button>

            <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">
              Acceso Docente
            </h2>
            <p className="text-slate-500 text-sm mt-1 mb-8 font-medium">
              Introduce tus credenciales para proyectar el aula.
            </p>

            <form onSubmit={loginDocente} className="flex flex-col gap-5">
              <input
                type="email"
                placeholder="Correo institucional"
                value={emailProfesor}
                onChange={(e) => setEmailProfesor(e.target.value)}
                className="w-full p-4 bg-[#F5F5F7] rounded-[1.25rem] border border-transparent focus:border-[#0090d0] focus:outline-none text-slate-900 text-sm font-medium"
                required
              />

              <input
                type="password"
                placeholder="Contraseña"
                value={passProfesor}
                onChange={(e) => setPassProfesor(e.target.value)}
                className="w-full p-4 bg-[#F5F5F7] rounded-[1.25rem] border border-transparent focus:border-[#0090d0] focus:outline-none text-slate-900 text-sm font-medium"
                required
              />

              <button
                type="submit"
                disabled={cargandoProfesor}
                className="w-full py-4 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-2xl transition-all shadow-sm active:scale-[0.98] cursor-pointer disabled:opacity-50"
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
          <div className="bg-white rounded-[2.5rem] p-8 sm:p-12 max-w-md w-full shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] border border-black/[0.02]">
            <button
              onClick={() => { 
                setVista('INICIO'); 
                setErrorLoginProfesor(null);
                setEmailProfesor('');
                setPassProfesor('');
              }}
              className="text-xs font-bold text-slate-500 hover:text-slate-800 mb-6 cursor-pointer"
            >
              ← Volver
            </button>

            <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">
              Seguridad Administrativa
            </h2>
            <p className="text-slate-500 text-sm mt-1 mb-8 font-medium">
              Autentícate como docente para acceder a la gestión global.
            </p>

            <form onSubmit={loginDocente} className="flex flex-col gap-5">
              <input
                type="email"
                placeholder="Correo institucional"
                value={emailProfesor}
                onChange={(e) => setEmailProfesor(e.target.value)}
                className="w-full p-4 bg-[#F5F5F7] rounded-[1.25rem] border border-transparent focus:border-[#0090d0] focus:outline-none text-slate-900 text-sm font-medium"
                required
              />
              <input
                type="password"
                placeholder="Contraseña"
                value={passProfesor}
                onChange={(e) => setPassProfesor(e.target.value)}
                className="w-full p-4 bg-[#F5F5F7] rounded-[1.25rem] border border-transparent focus:border-[#0090d0] focus:outline-none text-slate-900 text-sm font-medium"
                required
              />
              <button
                type="submit"
                disabled={cargandoProfesor}
                className="w-full py-4 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-2xl transition-all shadow-sm active:scale-[0.98] cursor-pointer disabled:opacity-50"
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
    <div className="min-h-screen bg-[#F5F5F7] flex items-center justify-center p-4 sm:p-8 font-sans selection:bg-[#0090d0] selection:text-white">
      <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-8">
        
        {/* Columna Izquierda: Accesos Principales */}
        <div className="md:col-span-2 flex flex-col gap-5 md:gap-8">
          <button
            onClick={manejarClickAlumnado}
            className="flex-1 bg-white rounded-[2.5rem] p-8 md:p-12 text-left shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] border border-black/[0.02] hover:shadow-[0_20px_40px_-15px_rgba(0,144,208,0.15)] transition-all cursor-pointer group flex flex-col justify-center min-h-[200px] active:scale-[0.98]"
          >
            <h2 className="text-5xl md:text-6xl font-extrabold text-slate-900 tracking-tight group-hover:text-[#0090d0] transition-colors">
              ALUMNADO
            </h2>
          </button>

          <button
            onClick={() => setVista('PROFESORADO')}
            className="flex-1 bg-white rounded-[2.5rem] p-8 md:p-12 text-left shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] border border-black/[0.02] hover:shadow-[0_20px_40px_-15px_rgba(0,144,208,0.15)] transition-all cursor-pointer group flex flex-col justify-center min-h-[200px] active:scale-[0.98]"
          >
            <h2 className="text-5xl md:text-6xl font-extrabold text-slate-900 tracking-tight group-hover:text-[#0090d0] transition-colors">
              PROFESORADO
            </h2>
          </button>
        </div>

        {/* Columna Derecha: Gestión y Acceso */}
        <div className="md:col-span-1 flex flex-col gap-5 md:gap-8">
          <button
            onClick={() => setVista('REGISTRO')}
            className="flex-1 bg-white rounded-[2.5rem] p-6 md:p-10 text-center shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] border border-black/[0.02] hover:shadow-[0_20px_40px_-15px_rgba(0,144,208,0.15)] transition-all cursor-pointer group flex flex-col items-center justify-center min-h-[180px] active:scale-[0.98]"
          >
            <h3 className="text-3xl font-extrabold text-slate-900 tracking-tight group-hover:text-[#0090d0] transition-colors">
              Acceso
            </h3>
            <p className="text-sm text-slate-500 mt-2 font-medium">
              Crear o recuperar cuenta
            </p>
          </button>

          <button
            onClick={() => setVista('GESTION')}
            className="flex-1 bg-slate-900 rounded-[2.5rem] p-6 md:p-10 text-center shadow-[0_20px_40px_-15px_rgba(0,0,0,0.2)] border border-slate-800 hover:bg-[#0090d0] hover:border-[#0090d0] transition-all cursor-pointer group flex flex-col items-center justify-center min-h-[180px] active:scale-[0.98]"
          >
            <h3 className="text-3xl font-extrabold text-white tracking-tight leading-tight">
              Gestión Docente
            </h3>
          </button>
        </div>

      </div>
    </div>
  );
}
