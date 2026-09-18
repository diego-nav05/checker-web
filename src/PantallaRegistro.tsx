import { useState } from 'react';
import { supabase } from './supabase';
import { getDeviceId } from './device';

interface Props {
  onVolver: () => void;
}

type Modo = 'LOGIN' | 'REGISTRO' | 'RECUPERAR';

export default function PantallaRegistro({ onVolver }: Props) {
  const [modo, setModo] = useState<Modo>('LOGIN');
  const [rol, setRol] = useState<'alumno' | 'profesor'>('alumno');
  
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  
  const [cargando, setCargando] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [exitoMsg, setExitoMsg] = useState<string | null>(null);

  const procesarFormulario = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setExitoMsg(null);
    setCargando(true);

    try {
      if (modo === 'REGISTRO') {
        // 1. Crear usuario en Supabase Auth
        const { data: authData, error: authError } = await supabase.auth.signUp({
          email,
          password,
        });

        if (authError) throw authError;
        if (!authData.user) throw new Error('Error al crear el usuario.');

        // 2. Guardar el perfil público con el device_hash
        const deviceHash = getDeviceId();
        const { error: dbError } = await supabase.from('perfiles').insert({
          id: authData.user.id, // Vinculamos el ID de Auth con nuestra tabla
          nombre_completo: nombre,
          email: email,
          rol: rol,
          dispositivo_hash: rol === 'alumno' ? deviceHash : null, // Solo atamos a los alumnos
        });

        if (dbError) throw dbError;

        // Guardado local estricto
        localStorage.setItem('checker_nombre', nombre);
        localStorage.setItem('checker_rol', rol);
        
        if (rol === 'alumno') {
          localStorage.setItem('checker_alumno_id', authData.user.id);
        } else {
          localStorage.removeItem('checker_alumno_id');
        }
        
        setExitoMsg('Cuenta creada con éxito. Ya puedes volver al inicio y acceder.');
        setModo('LOGIN');
      } 
      
      else if (modo === 'LOGIN') {
        // 1. Iniciar sesión real
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (authError) throw authError;

        // 2. Comprobación estricta de seguridad (Anti-Trampas)
        const { data: perfil, error: perfilError } = await supabase
          .from('perfiles')
          .select('*')
          .eq('id', authData.user.id)
          .single();

        if (perfilError || !perfil) throw new Error('No se encontró el perfil de usuario.');

        if (perfil.rol === 'alumno') {
          const hashActual = getDeviceId();
          if (perfil.dispositivo_hash !== hashActual) {
            await supabase.auth.signOut();
            throw new Error('⛔ Dispositivo no reconocido. Este móvil no es el tuyo. Pide a un profesor que desvincule tu cuenta.');
          }
        }

        // Guardado local estricto
        localStorage.setItem('checker_nombre', perfil.nombre_completo);
        localStorage.setItem('checker_rol', perfil.rol);

        if (perfil.rol === 'alumno') {
          localStorage.setItem('checker_alumno_id', perfil.id);
        } else {
          // Si entra un profesor, eliminamos cualquier ID de alumno que hubiera quedado
          localStorage.removeItem('checker_alumno_id'); 
        }

        setExitoMsg('¡Sesión iniciada! Vuelve al inicio para entrar a tu panel.');
      } 
      
      else if (modo === 'RECUPERAR') {
        const { error } = await supabase.auth.resetPasswordForEmail(email);
        if (error) throw error;
        setExitoMsg('Te hemos enviado un enlace de recuperación a tu correo.');
        setModo('LOGIN');
      }

    } catch (error: any) {
      setErrorMsg(error.message);
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F5F7] p-4 sm:p-8 flex flex-col font-sans selection:bg-[#0090d0] selection:text-white">
      
      {/* Isla Superior */}
      <div className="flex items-center justify-between bg-white/80 backdrop-blur-xl px-6 py-4 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-black/[0.03] mb-8 max-w-lg mx-auto w-full">
        <button onClick={onVolver} className="flex items-center justify-center w-10 h-10 bg-slate-100 hover:bg-slate-200 rounded-full text-slate-600 transition-colors cursor-pointer active:scale-95">
          ←
        </button>
        <h1 className="text-xl font-bold text-slate-900 tracking-tight">Acceso al Sistema</h1>
        <div className="w-10"></div> {/* Espaciador para centrar */}
      </div>

      {/* Tarjeta Principal */}
      <div className="max-w-lg w-full mx-auto flex-1 flex flex-col">
        <div className="bg-white rounded-[2.5rem] shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] border border-black/[0.02] p-8 sm:p-12 my-auto">
          
          <div className="text-center mb-8">
            <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">
              {modo === 'LOGIN' ? 'Iniciar Sesión' : modo === 'REGISTRO' ? 'Crear Cuenta' : 'Recuperar Acceso'}
            </h2>
            <p className="text-slate-500 font-medium mt-2">
              {modo === 'LOGIN' ? 'Introduce tus credenciales para continuar.' : 
               modo === 'REGISTRO' ? 'Tu dispositivo quedará vinculado por seguridad.' : 
               'Recibirás un correo con las instrucciones.'}
            </p>
          </div>

          <form onSubmit={procesarFormulario} className="flex flex-col gap-5">
            {modo === 'REGISTRO' && (
              <>
                <div className="flex bg-[#F5F5F7] p-1.5 rounded-[1.5rem] mb-2">
                  <button type="button" onClick={() => setRol('alumno')} className={`flex-1 py-3 text-sm font-bold rounded-[1.25rem] transition-all ${rol === 'alumno' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                    Soy Alumno
                  </button>
                  <button type="button" onClick={() => setRol('profesor')} className={`flex-1 py-3 text-sm font-bold rounded-[1.25rem] transition-all ${rol === 'profesor' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                    Soy Profesor
                  </button>
                </div>
                
                <input
                  type="text"
                  placeholder="Nombre y Apellidos"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  className="w-full p-5 bg-[#F5F5F7] border border-transparent rounded-[1.5rem] text-base font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#0090d0] focus:ring-4 focus:ring-sky-500/10 transition-all"
                  required
                />
              </>
            )}

            <input
              type="email"
              placeholder="Correo electrónico institucional"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full p-5 bg-[#F5F5F7] border border-transparent rounded-[1.5rem] text-base font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#0090d0] focus:ring-4 focus:ring-sky-500/10 transition-all"
              required
            />

            {modo !== 'RECUPERAR' && (
              <input
                type="password"
                placeholder="Contraseña"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full p-5 bg-[#F5F5F7] border border-transparent rounded-[1.5rem] text-base font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#0090d0] focus:ring-4 focus:ring-sky-500/10 transition-all"
                required
              />
            )}

            <button
              type="submit"
              disabled={cargando}
              className="w-full mt-2 py-5 bg-[#0090d0] hover:bg-[#007fb8] text-white text-lg font-bold rounded-[1.5rem] transition-all shadow-[0_8px_20px_-6px_rgba(0,144,208,0.4)] cursor-pointer active:scale-[0.98] disabled:opacity-50"
            >
              {cargando ? 'Procesando...' : modo === 'LOGIN' ? 'Entrar' : modo === 'REGISTRO' ? 'Registrarme' : 'Enviar Enlace'}
            </button>
          </form>

          {/* Alertas */}
          {errorMsg && <div className="mt-6 p-4 bg-rose-50 border border-rose-100 rounded-2xl text-rose-700 text-sm font-semibold text-center">{errorMsg}</div>}
          {exitoMsg && <div className="mt-6 p-4 bg-emerald-50 border border-emerald-100 rounded-2xl text-emerald-700 text-sm font-semibold text-center">{exitoMsg}</div>}

          {/* Enlaces inferiores */}
          <div className="mt-8 flex flex-col items-center gap-3 text-sm font-medium">
            {modo === 'LOGIN' ? (
              <>
                <button onClick={() => setModo('REGISTRO')} className="text-slate-500 hover:text-slate-800 transition-colors">¿No tienes cuenta? <span className="text-[#0090d0] font-bold">Regístrate</span></button>
                <button onClick={() => setModo('RECUPERAR')} className="text-slate-400 hover:text-slate-600 transition-colors">He olvidado mi contraseña</button>
              </>
            ) : modo === 'REGISTRO' ? (
              <button onClick={() => setModo('LOGIN')} className="text-slate-500 hover:text-slate-800 transition-colors">¿Ya tienes cuenta? <span className="text-[#0090d0] font-bold">Inicia Sesión</span></button>
            ) : (
              <button onClick={() => setModo('LOGIN')} className="text-slate-500 hover:text-slate-800 transition-colors">Volver a <span className="text-[#0090d0] font-bold">Iniciar Sesión</span></button>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
