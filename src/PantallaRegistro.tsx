import { useState } from 'react';
import { supabase } from './supabase';
import CryptoJS from 'crypto-js';

interface Props {
  onVolver: () => void;
}

export default function PantallaRegistro({ onVolver }: Props) {
  const [esRegistro, setEsRegistro] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nombre, setNombre] = useState('');
  const [cargando, setCargando] = useState(false);

  // Sistema de Notificaciones iOS 27
  const [notificacion, setNotificacion] = useState<{ texto: string; tipo: 'exito' | 'error' | 'info' } | null>(null);

  const mostrarNotificacion = (texto: string, tipo: 'exito' | 'error' | 'info' = 'error') => {
    setNotificacion({ texto, tipo });
    setTimeout(() => setNotificacion(null), 4000);
  };

  // Huella digital del dispositivo para evitar suplantaciones
  const generarHashDispositivo = () => {
    const datos = navigator.userAgent + window.screen.width + window.screen.height + navigator.language;
    return CryptoJS.SHA256(datos).toString();
  };

  const autenticar = async (e: React.FormEvent) => {
    e.preventDefault();
    setCargando(true);
    setNotificacion(null);

    try {
      if (esRegistro) {
        // --- CREAR CUENTA ---
        if (!nombre.trim()) throw new Error('El nombre es obligatorio.');
        
        const { data: authData, error: authError } = await supabase.auth.signUp({
          email,
          password,
        });

        if (authError) throw authError;
        if (!authData.user) throw new Error('Error interno al crear la cuenta.');

        const hash = generarHashDispositivo();

        const { error: profileError } = await supabase.from('perfiles').insert([{
          id: authData.user.id,
          nombre_completo: nombre,
          email: email,
          rol: 'alumno',
          dispositivo_hash: hash
        }]);

        if (profileError) throw profileError;

        localStorage.setItem('checker_alumno_id', authData.user.id);
        localStorage.setItem('checker_nombre', nombre);
        localStorage.setItem('checker_rol', 'alumno');

        mostrarNotificacion('Cuenta creada con éxito.', 'exito');
        setTimeout(onVolver, 1500);

      } else {
        // --- INICIAR SESIÓN ---
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (authError) throw authError;

        const { data: perfil, error: profileError } = await supabase
          .from('perfiles')
          .select('*')
          .eq('id', authData.user.id)
          .single();

        if (profileError || !perfil) throw new Error('No se encontró el perfil de usuario.');
        if (perfil.rol !== 'alumno') {
          await supabase.auth.signOut();
          throw new Error('Esta cuenta pertenece al profesorado.');
        }

        const hashActual = generarHashDispositivo();

        if (!perfil.dispositivo_hash) {
          // Si el profesor reseteó el dispositivo, se vincula el nuevo
          await supabase.from('perfiles').update({ dispositivo_hash: hashActual }).eq('id', perfil.id);
        } else if (perfil.dispositivo_hash !== hashActual) {
          await supabase.auth.signOut();
          throw new Error('Cuenta vinculada a otro móvil. Pide a tu profesor que la libere.');
        }

        localStorage.setItem('checker_alumno_id', perfil.id);
        localStorage.setItem('checker_nombre', perfil.nombre_completo);
        localStorage.setItem('checker_rol', 'alumno');

        mostrarNotificacion('Acceso autorizado.', 'exito');
        setTimeout(onVolver, 1000);
      }
    } catch (error: any) {
      // Simplificamos los mensajes de error de Supabase al español
      let mensaje = error.message;
      if (mensaje.includes('Invalid login credentials')) mensaje = 'Correo o contraseña incorrectos.';
      if (mensaje.includes('already registered')) mensaje = 'Este correo ya tiene una cuenta.';
      if (mensaje.includes('Password should be at least')) mensaje = 'La contraseña debe tener al menos 6 caracteres.';
      
      mostrarNotificacion(mensaje, 'error');
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F5F9] p-4 sm:p-8 flex flex-col items-center justify-center font-sans selection:bg-[#0090d0] selection:text-white relative overflow-hidden">
      
      {/* Fondo sutil difuminado */}
      <div className="absolute top-0 left-0 w-full h-96 bg-gradient-to-b from-[#0090d0]/5 to-transparent pointer-events-none -z-10"></div>

      {/* Pop-up de Notificación iOS 27 */}
      {notificacion && (
        <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-50 px-6 py-3.5 rounded-full shadow-2xl backdrop-blur-2xl flex items-center gap-3 transition-all duration-300 animate-[fade-in_0.3s_ease-out] w-fit min-w-[280px] max-w-sm border ${
          notificacion.tipo === 'error' ? 'bg-rose-500/90 border-rose-400 text-white' : 
          notificacion.tipo === 'exito' ? 'bg-emerald-500/90 border-emerald-400 text-white' : 
          'bg-[#002b5c]/90 border-[#0090d0]/50 text-white'
        }`}>
          <span className="text-sm font-semibold tracking-tight">{notificacion.texto}</span>
        </div>
      )}

      {/* Contenedor Principal (Glassmorphism) */}
      <div className="bg-white/70 backdrop-blur-3xl rounded-[3rem] p-8 sm:p-12 max-w-sm w-full shadow-[0_20px_40px_-15px_rgba(0,43,92,0.1)] border border-white/60 animate-[fade-in_0.4s_ease-out,zoom-in_0.4s_ease-out]">
        
        <button
          onClick={onVolver}
          className="w-10 h-10 flex items-center justify-center bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-full transition-colors active:scale-95 mb-8 cursor-pointer"
        >
          ←
        </button>

        <h2 className="text-3xl font-black text-[#002b5c] tracking-tight leading-none mb-2">
          {esRegistro ? 'Nueva Cuenta' : 'Bienvenido'}
        </h2>
        <p className="text-xs text-slate-500 font-medium mb-8">
          {esRegistro ? 'Regístrate para vincular tu dispositivo móvil.' : 'Inicia sesión para registrar tu asistencia.'}
        </p>

        <form onSubmit={autenticar} className="flex flex-col gap-4">
          
          {esRegistro && (
            <input
              type="text"
              placeholder="Nombre y Apellidos"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              className="w-full p-4 bg-slate-50/50 backdrop-blur-sm rounded-2xl border border-slate-200/50 focus:border-[#0090d0] focus:ring-4 focus:ring-[#0090d0]/10 focus:outline-none text-[#002b5c] text-sm font-semibold transition-all"
              required
            />
          )}

          <input
            type="email"
            placeholder="Correo UNEATLANTICO"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full p-4 bg-slate-50/50 backdrop-blur-sm rounded-2xl border border-slate-200/50 focus:border-[#0090d0] focus:ring-4 focus:ring-[#0090d0]/10 focus:outline-none text-[#002b5c] text-sm font-semibold transition-all"
            required
          />

          <input
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full p-4 bg-slate-50/50 backdrop-blur-sm rounded-2xl border border-slate-200/50 focus:border-[#0090d0] focus:ring-4 focus:ring-[#0090d0]/10 focus:outline-none text-[#002b5c] text-sm font-semibold transition-all"
            required
          />

          <button
            type="submit"
            disabled={cargando}
            className="w-full mt-2 py-4 bg-[#002b5c] hover:bg-[#0090d0] text-white font-bold rounded-2xl transition-all shadow-[0_8px_20px_rgb(0,43,92,0.2)] hover:shadow-[0_8px_25px_rgb(0,144,208,0.4)] active:scale-[0.97] cursor-pointer disabled:opacity-50 text-sm"
          >
            {cargando ? 'Procesando...' : (esRegistro ? 'Crear Cuenta' : 'Entrar')}
          </button>
        </form>

        {/* Toggle Login/Registro */}
        <div className="mt-8 text-center">
          <button
            onClick={() => {
              setEsRegistro(!esRegistro);
              setNotificacion(null);
              setEmail('');
              setPassword('');
              setNombre('');
            }}
            className="text-xs font-bold text-slate-400 hover:text-[#0090d0] transition-colors cursor-pointer"
          >
            {esRegistro ? 'Ya tengo una cuenta. Iniciar sesión.' : 'No tengo cuenta. Registrarme.'}
          </button>
        </div>

      </div>
    </div>
  );
}
