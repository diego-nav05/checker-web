import { useState } from 'react';
import { supabase } from './supabase';
import CryptoJS from 'crypto-js';

interface Props {
  onVolver: () => void;
}

export default function PantallaRegistro({ onVolver }: Props) {
  // POR DEFECTO AHORA ES TRUE (Prioridad a Crear Cuenta)
  const [esRegistro, setEsRegistro] = useState(true);
  const [rolRegistro, setRolRegistro] = useState<'alumno' | 'profesor'>('alumno');
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nombre, setNombre] = useState('');
  const [cargando, setCargando] = useState(false);

  const [notificacion, setNotificacion] = useState<{ texto: string; tipo: 'exito' | 'error' | 'info' } | null>(null);

  const mostrarNotificacion = (texto: string, tipo: 'exito' | 'error' | 'info' = 'error') => {
    setNotificacion({ texto, tipo });
    setTimeout(() => setNotificacion(null), 4000);
  };

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
        if (!nombre.trim()) throw new Error('El nombre es obligatorio.');
        
        const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });
        if (authError) throw authError;
        if (!authData.user) throw new Error('Error interno al crear la cuenta.');

        const hash = rolRegistro === 'alumno' ? generarHashDispositivo() : null;

        const { error: profileError } = await supabase.from('perfiles').insert([{
          id: authData.user.id,
          nombre_completo: nombre,
          email: email,
          rol: rolRegistro,
          dispositivo_hash: hash
        }]);

        if (profileError) throw profileError;

        localStorage.setItem('checker_nombre', nombre);
        localStorage.setItem('checker_rol', rolRegistro);
        
        if (rolRegistro === 'alumno') {
          localStorage.setItem('checker_alumno_id', authData.user.id);
        } else {
          localStorage.removeItem('checker_alumno_id');
        }

        mostrarNotificacion(`Cuenta de ${rolRegistro} creada con éxito.`, 'exito');
        setTimeout(onVolver, 1500);

      } else {
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
        if (authError) throw authError;

        const { data: perfil, error: profileError } = await supabase.from('perfiles').select('*').eq('id', authData.user.id).single();
        if (profileError || !perfil) throw new Error('No se encontró el perfil de usuario.');

        if (perfil.rol === 'profesor') {
          localStorage.setItem('checker_rol', 'profesor');
          localStorage.setItem('checker_nombre', perfil.nombre_completo);
          localStorage.removeItem('checker_alumno_id');
          mostrarNotificacion('Acceso autorizado como Docente.', 'exito');
          setTimeout(onVolver, 1000);
          return;
        }

        const hashActual = generarHashDispositivo();

        if (!perfil.dispositivo_hash) {
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
      let mensaje = error.message;
      if (mensaje.includes('Invalid login credentials')) mensaje = 'Correo o contraseña incorrectos.';
      if (mensaje.includes('already registered')) mensaje = 'Este correo ya tiene una cuenta. Pulsa abajo para Iniciar Sesión.';
      if (mensaje.includes('Password should be at least')) mensaje = 'La contraseña debe tener al menos 6 caracteres.';
      
      mostrarNotificacion(mensaje, 'error');
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[#F0F4F8] p-4 sm:p-8 flex flex-col items-center justify-center font-sans selection:bg-[#0090d0] selection:text-white relative overflow-hidden">
      
      <div className="absolute top-0 left-0 w-full h-96 bg-gradient-to-b from-[#0090d0]/5 to-transparent pointer-events-none -z-10"></div>

      {notificacion && (
        <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-[200] px-6 py-3.5 rounded-full shadow-[0_10px_40px_-10px_rgba(0,0,0,0.2)] backdrop-blur-2xl flex items-center gap-3 transition-all duration-500 cubic-bezier(0.16,1,0.3,1) animate-[fade-in-down_0.4s_ease-out] w-fit min-w-[280px] max-w-sm border ${
          notificacion.tipo === 'error' ? 'bg-rose-500/95 border-rose-400/50 text-white' : 
          notificacion.tipo === 'exito' ? 'bg-emerald-500/95 border-emerald-400/50 text-white' : 
          'bg-[#002b5c]/95 border-white/10 text-white'
        }`}>
          <span className="text-sm font-semibold tracking-wide">{notificacion.texto}</span>
        </div>
      )}

      <div className="bg-white/60 backdrop-blur-3xl rounded-[3rem] p-8 sm:p-12 max-w-sm w-full shadow-[0_20px_40px_-15px_rgba(0,43,92,0.1)] border border-white/60 animate-[fade-in_0.4s_ease-out,zoom-in_0.4s_ease-out] relative">
        <div className="absolute inset-0 rounded-[3rem] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.8)] pointer-events-none"></div>
        
        <button onClick={onVolver} className="w-11 h-11 flex items-center justify-center bg-white hover:bg-slate-50 border border-slate-100/80 rounded-full text-slate-500 shadow-sm transition-all duration-300 hover:shadow-md cursor-pointer active:scale-90 mb-8 relative z-10">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        </button>

        <div className="relative z-10">
          <h2 className="text-3xl font-black text-[#002b5c] tracking-tight leading-none mb-3">
            {esRegistro ? 'Nueva Cuenta' : 'Bienvenido'}
          </h2>
          <p className="text-sm text-slate-500 font-medium mb-8 leading-relaxed">
            {esRegistro ? 'Regístrate una sola vez para vincular tu dispositivo de forma segura.' : 'Introduce tu correo y contraseña para acceder.'}
          </p>

          <form onSubmit={autenticar} className="flex flex-col gap-4">
            {esRegistro && (
              <div className="animate-[fade-in-down_0.3s_ease-out]">
                <div className="flex bg-white/50 backdrop-blur-md p-1.5 rounded-[1.5rem] border border-white mb-4 shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
                  <button type="button" onClick={() => setRolRegistro('alumno')} className={`flex-1 py-3 text-[11px] uppercase tracking-widest font-bold rounded-xl transition-all duration-300 cursor-pointer ${rolRegistro === 'alumno' ? 'bg-[#002b5c] text-white shadow-md' : 'text-slate-500 hover:text-[#002b5c]'}`}>
                    Estudiante
                  </button>
                  <button type="button" onClick={() => setRolRegistro('profesor')} className={`flex-1 py-3 text-[11px] uppercase tracking-widest font-bold rounded-xl transition-all duration-300 cursor-pointer ${rolRegistro === 'profesor' ? 'bg-[#002b5c] text-white shadow-md' : 'text-slate-500 hover:text-[#002b5c]'}`}>
                    Docente
                  </button>
                </div>

                <input type="text" placeholder="Nombre y Apellidos" value={nombre} onChange={(e) => setNombre(e.target.value)} className="w-full mb-4 p-4 bg-white/50 backdrop-blur-md rounded-[1.5rem] border border-white focus:border-[#0090d0]/30 focus:ring-4 focus:ring-[#0090d0]/10 focus:outline-none text-[#002b5c] text-sm font-bold tracking-wide transition-all shadow-[0_2px_10px_rgba(0,0,0,0.02)]" required/>
              </div>
            )}

            <input type="email" placeholder="Correo UNEATLANTICO" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full p-4 bg-white/50 backdrop-blur-md rounded-[1.5rem] border border-white focus:border-[#0090d0]/30 focus:ring-4 focus:ring-[#0090d0]/10 focus:outline-none text-[#002b5c] text-sm font-bold tracking-wide transition-all shadow-[0_2px_10px_rgba(0,0,0,0.02)]" required/>
            <input type="password" placeholder="Contraseña" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full p-4 bg-white/50 backdrop-blur-md rounded-[1.5rem] border border-white focus:border-[#0090d0]/30 focus:ring-4 focus:ring-[#0090d0]/10 focus:outline-none text-[#002b5c] text-sm font-bold tracking-wide transition-all shadow-[0_2px_10px_rgba(0,0,0,0.02)]" required/>

            <button type="submit" disabled={cargando} className={`w-full mt-4 py-4 text-white font-bold rounded-[1.5rem] transition-all duration-300 shadow-[0_8px_20px_rgba(0,43,92,0.3)] hover:shadow-[0_12px_25px_rgba(0,144,208,0.4)] active:scale-[0.97] cursor-pointer disabled:opacity-50 text-sm tracking-wide border ${esRegistro ? 'bg-gradient-to-br from-[#0090d0] to-[#007fb8] border-[#0090d0]/50 shadow-[0_8px_20px_rgba(0,144,208,0.3)]' : 'bg-gradient-to-br from-[#002b5c] to-[#001a38] border-[#002b5c]/50'}`}>
              {cargando ? 'Procesando...' : (esRegistro ? 'Crear mi Cuenta' : 'Iniciar Sesión')}
            </button>
          </form>

          <div className="mt-8 text-center">
            <button onClick={() => { setEsRegistro(!esRegistro); setNotificacion(null); setEmail(''); setPassword(''); setNombre(''); }} className="text-xs font-bold text-slate-500 hover:text-[#0090d0] transition-colors cursor-pointer px-4 py-2 rounded-full hover:bg-slate-50">
              {esRegistro ? 'Ya tengo una cuenta. Iniciar sesión.' : 'No tengo cuenta. Registrarme.'}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
