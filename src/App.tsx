import { useState, useEffect } from 'react';
import PantallaProfesor from './PantallaProfesor.tsx';
import PantallaAlumno from './PantallaAlumno.tsx';
import PantallaRegistro from './PantallaRegistro.tsx';
import PantallaGestionDocente from './PantallaGestionDocente.tsx';
import BotonCompartir from './BotonCompartir.tsx';
import { AvisoFlotante, useAviso } from './Aviso';
import { supabase, hashInicial } from './supabase';

type Vista = 'INICIO' | 'ALUMNADO' | 'PROFESORADO' | 'REGISTRO' | 'GESTION';

interface Docente {
  nombre: string;
  email: string;
}

// Gestión vuelve a pedir la contraseña pasados estos minutos
const MINUTOS_GESTION_DESBLOQUEADA = 10;
const hoy = () => new Date().toDateString();

export default function App() {
  const [vista, setVista] = useState<Vista>('INICIO');
  // El docente se queda conectado en este ordenador hasta que cierra sesión o termina el día
  const [docente, setDocente] = useState<Docente | null>(null);
  const [comprobandoSesion, setComprobandoSesion] = useState(true);
  const [gestionDesbloqueadaHasta, setGestionDesbloqueadaHasta] = useState(0);
  const [emailProfesor, setEmailProfesor] = useState('');
  const [passProfesor, setPassProfesor] = useState('');
  const [cargandoProfesor, setCargandoProfesor] = useState(false);
  const [nuevaPassword, setNuevaPassword] = useState<string | null>(null); // != null: pantalla de cambiar contraseña

  const { aviso, avisar, cerrar } = useAviso();

  const alumnoVinculado = !!localStorage.getItem('checker_alumno_id');

  const cargarDocente = async (userId: string, email: string) => {
    const { data: perfil } = await supabase.from('perfiles').select('rol, nombre_completo').eq('id', userId).maybeSingle();
    if (perfil?.rol !== 'profesor') return null;
    return { nombre: perfil.nombre_completo, email };
  };

  // Al abrir la web: ¿viene de un enlace del correo? ¿hay un docente conectado?
  useEffect(() => {
    const parametrosEnlace = new URLSearchParams(hashInicial.replace(/^#/, ''));
    const tipoEnlace = parametrosEnlace.get('type');
    const errorEnlace = parametrosEnlace.get('error_description');

    if (tipoEnlace === 'recovery') {
      setNuevaPassword('');
    } else if (errorEnlace) {
      avisar('El enlace del correo ha caducado o ya se usó. Pide uno nuevo desde "Vincular" (en el ordenador, "Mi cuenta").', 'error', { fijo: true });
    } else if (tipoEnlace === 'signup' || tipoEnlace === 'invite' || tipoEnlace === 'email') {
      avisar('✅ ¡Correo confirmado! Tu cuenta ya está activa.\n\nAhora entra en "Vincular" (en el ordenador, "Mi cuenta") e inicia sesión desde el navegador que vayas a usar en clase.', 'exito', { fijo: true });
    } else if (!localStorage.getItem('checker_alumno_id') && localStorage.getItem('checker_rol') !== 'profesor') {
      avisar('👋 ¿Eres nuevo? Pulsa "Vincular" (en el ordenador, "Mi cuenta") para crear tu cuenta.', 'info');
    }

    const { data: escucha } = supabase.auth.onAuthStateChange((evento) => {
      if (evento === 'PASSWORD_RECOVERY') setNuevaPassword('');
    });

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session && tipoEnlace !== 'recovery') {
        const diaSesion = localStorage.getItem('checker_docente_dia');
        const datos = await cargarDocente(session.user.id, session.user.email ?? '');
        if (datos) {
          if (diaSesion && diaSesion !== hoy()) {
            // Sesión de otro día: la cerramos por si alguien se olvidó de salir en un ordenador compartido
            await supabase.auth.signOut();
            localStorage.removeItem('checker_rol');
            localStorage.removeItem('checker_docente_dia');
          } else {
            localStorage.setItem('checker_docente_dia', hoy());
            localStorage.setItem('checker_rol', 'profesor');
            setDocente(datos);
          }
        }
      }
      setComprobandoSesion(false);
    })();

    return () => escucha.subscription.unsubscribe();
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
    cerrar();
  };

  const volverInicio = () => {
    setPassProfesor('');
    if (window.history.state?.panel !== 'INICIO') {
      window.history.back();
    } else {
      setVista('INICIO');
    }
  };

  const manejarClickAlumnado = () => {
    const idGuardado = localStorage.getItem('checker_alumno_id');
    const rolActual = localStorage.getItem('checker_rol');

    if (rolActual === 'profesor') {
      avisar('Este navegador tiene abierta una sesión de docente. Para usarlo como alumno, cierra antes la sesión de docente.', 'info');
      return;
    }

    if (!idGuardado) {
      avisar('Primero vincula tu móvil: crea tu cuenta o inicia sesión.', 'info');
      irAPanel('REGISTRO');
      return;
    }

    irAPanel('ALUMNADO');
  };

  const manejarClickDocente = (destino: 'PROFESORADO' | 'GESTION') => {
    const idGuardado = localStorage.getItem('checker_alumno_id');
    const rolActual = localStorage.getItem('checker_rol');

    if (idGuardado && rolActual !== 'profesor') {
      avisar('Esta zona es solo para docentes. Si necesitas cambiar de móvil, pídeselo a tu profesor.', 'error');
      return;
    }

    irAPanel(destino);
  };

  // Inicio de sesión completo (correo + contraseña): solo cuando no hay nadie conectado
  const loginDocente = async (e: React.FormEvent) => {
    e.preventDefault();
    cerrar();
    setCargandoProfesor(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: emailProfesor.trim(), password: passProfesor });
      if (error) throw error;

      const datos = await cargarDocente(data.user.id, data.user.email ?? emailProfesor.trim());
      if (!datos) {
        await supabase.auth.signOut();
        throw new Error('Sin privilegios de docente.');
      }

      localStorage.setItem('checker_rol', 'profesor');
      localStorage.setItem('checker_docente_dia', hoy());
      localStorage.removeItem('checker_alumno_id');
      setDocente(datos);
      // Acaba de escribir la contraseña: Gestión no se la vuelve a pedir enseguida
      setGestionDesbloqueadaHasta(Date.now() + MINUTOS_GESTION_DESBLOQUEADA * 60_000);
      setEmailProfesor('');
      setPassProfesor('');
      avisar(`Hola, ${datos.nombre}. Seguirás conectado en este ordenador hasta que cierres sesión o acabe el día.`, 'exito');
    } catch (err: any) {
      avisar(err.message === 'Sin privilegios de docente.' ? 'Esta cuenta no es de docente.' : 'Correo o contraseña incorrectos.', 'error');
    } finally {
      setCargandoProfesor(false);
    }
  };

  // Con el docente ya conectado, Gestión solo pide la contraseña
  const desbloquearGestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docente) return;
    cerrar();
    setCargandoProfesor(true);
    const { error } = await supabase.auth.signInWithPassword({ email: docente.email, password: passProfesor });
    setCargandoProfesor(false);
    setPassProfesor('');
    if (error) {
      avisar('Contraseña incorrecta.', 'error');
      return;
    }
    setGestionDesbloqueadaHasta(Date.now() + MINUTOS_GESTION_DESBLOQUEADA * 60_000);
  };

  const cerrarSesionDocente = async (mensaje = 'Sesión de docente cerrada.') => {
    setDocente(null);
    setGestionDesbloqueadaHasta(0);
    setEmailProfesor('');
    setPassProfesor('');
    localStorage.removeItem('checker_rol');
    localStorage.removeItem('checker_alumno_id');
    localStorage.removeItem('checker_nombre');
    localStorage.removeItem('checker_docente_dia');
    await supabase.auth.signOut().catch(() => {});
    avisar(mensaje, 'info');
  };

  const cambiarDeCuenta = async () => {
    await cerrarSesionDocente('Sesión cerrada. Entra con la otra cuenta de docente.');
    irAPanel('PROFESORADO');
  };

  const guardarNuevaPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nuevaPassword || nuevaPassword.length < 6) {
      avisar('La contraseña debe tener al menos 6 caracteres.', 'error');
      return;
    }
    setCargandoProfesor(true);
    const { error } = await supabase.auth.updateUser({ password: nuevaPassword });
    setCargandoProfesor(false);
    if (error) {
      avisar('No se pudo cambiar la contraseña. Pide otro correo de recuperación.', 'error', { fijo: true });
      return;
    }
    // Cerramos esta sesión: así el alumno inicia sesión normalmente y su móvil se vincula bien
    await supabase.auth.signOut();
    setNuevaPassword(null);
    avisar('✅ Contraseña cambiada. Ya puedes iniciar sesión con la nueva contraseña.', 'exito', { fijo: true });
  };

  const fondoFormulario = (titulo: string, contenido: React.ReactNode, alVolver?: () => void) => (
    <div className="min-h-[100dvh] bg-[#F0F4F8] p-4 sm:p-8 flex flex-col items-center justify-center font-sans selection:bg-[#0090d0] selection:text-white relative overflow-hidden">
      <div className="glow-blob"></div>
      <AvisoFlotante aviso={aviso} onCerrar={cerrar} />
      <div className="glass-container rounded-[2.5rem] p-8 sm:p-12 max-w-sm w-full anim-suave relative z-10">
        {alVolver && (
          <button
            onClick={alVolver}
            className="w-11 h-11 flex items-center justify-center bg-white/80 hover:bg-white border border-slate-200/50 rounded-full text-slate-500 shadow-[0_4px_12px_rgba(0,0,0,0.05)] transition-all duration-300 hover:shadow-[0_8px_20px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 active:scale-95 cursor-pointer mb-8 relative z-10 backdrop-blur-md"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          </button>
        )}
        <h2 className="text-3xl font-black text-[#002b5c] tracking-tight leading-none mb-8 relative z-10">{titulo}</h2>
        {contenido}
      </div>
    </div>
  );

  const claseInput = "w-full p-4 bg-white/50 backdrop-blur-xl rounded-[1.25rem] border border-white focus:border-[#0090d0]/50 focus:ring-4 focus:ring-[#0090d0]/10 focus:outline-none text-[#002b5c] text-sm font-bold tracking-wide transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]";
  const claseBoton = "w-full mt-4 py-4 dark-glow-btn text-white font-bold rounded-[1.25rem] transition-all active:scale-[0.97] cursor-pointer disabled:opacity-50 text-sm tracking-wide";

  if (nuevaPassword !== null) {
    return fondoFormulario('Nueva contraseña', (
      <form onSubmit={guardarNuevaPassword} className="flex flex-col gap-4 relative z-10">
        <p className="text-sm text-slate-500 font-medium leading-relaxed">Escribe la contraseña que quieres usar a partir de ahora.</p>
        <input type="password" placeholder="Nueva contraseña (mín. 6 caracteres)" value={nuevaPassword} onChange={(e) => setNuevaPassword(e.target.value)} className={claseInput} minLength={6} required autoFocus />
        <button type="submit" disabled={cargandoProfesor} className={claseBoton}>{cargandoProfesor ? 'Guardando...' : 'Guardar contraseña'}</button>
      </form>
    ));
  }

  if (vista === 'ALUMNADO') {
    const irARegistro = () => {
      window.history.replaceState({ panel: 'REGISTRO' }, '');
      setVista('REGISTRO');
    };
    return <PantallaAlumno onVolver={volverInicio} onIrARegistro={irARegistro} />;
  }
  if (vista === 'REGISTRO') return <PantallaRegistro onVolver={volverInicio} />;

  if (vista === 'PROFESORADO' || vista === 'GESTION') {
    if (comprobandoSesion) {
      return fondoFormulario(vista === 'GESTION' ? 'Gestión' : 'Aula', <p className="text-sm text-slate-500 font-semibold">Comprobando sesión...</p>);
    }

    if (!docente) {
      return fondoFormulario(vista === 'GESTION' ? 'Gestión' : 'Aula', (
        <form onSubmit={loginDocente} className="flex flex-col gap-4 relative z-10">
          <input type="email" placeholder="Correo UNEATLANTICO" value={emailProfesor} onChange={(e) => setEmailProfesor(e.target.value)} className={claseInput} required autoComplete="username" />
          <input type="password" placeholder="Contraseña" value={passProfesor} onChange={(e) => setPassProfesor(e.target.value)} className={claseInput} required autoComplete="current-password" />
          <button type="submit" disabled={cargandoProfesor} className={claseBoton}>
            {cargandoProfesor ? 'Verificando...' : 'Acceder'}
          </button>
        </form>
      ), volverInicio);
    }

    if (vista === 'GESTION' && Date.now() > gestionDesbloqueadaHasta) {
      return fondoFormulario('Gestión', (
        <form onSubmit={desbloquearGestion} className="flex flex-col gap-4 relative z-10">
          <p className="text-sm text-slate-500 font-medium leading-relaxed">
            Conectado como <span className="font-bold text-[#002b5c]">{docente.nombre}</span>
            <br /><span className="text-xs">{docente.email}</span>
          </p>
          <input type="password" placeholder="Contraseña" value={passProfesor} onChange={(e) => setPassProfesor(e.target.value)} className={claseInput} required autoFocus autoComplete="current-password" />
          <button type="submit" disabled={cargandoProfesor} className={claseBoton}>
            {cargandoProfesor ? 'Verificando...' : 'Entrar en Gestión'}
          </button>
          <button type="button" onClick={cambiarDeCuenta} className="text-xs font-bold text-slate-400 hover:text-[#0090d0] transition-colors cursor-pointer mt-2">
            ¿No eres tú? Cambiar de cuenta
          </button>
        </form>
      ), volverInicio);
    }

    return (
      <>
        {/* El saludo tras iniciar sesión sigue visible al entrar en el aula o en Gestión */}
        <AvisoFlotante aviso={aviso} onCerrar={cerrar} />
        {vista === 'PROFESORADO'
          ? <PantallaProfesor onVolver={volverInicio} />
          : <PantallaGestionDocente onVolver={volverInicio} />}
      </>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[#F0F4F8] flex items-center justify-center py-8 px-4 font-sans selection:bg-[#0090d0] selection:text-white relative overflow-hidden">
      <div className="glow-blob"></div>

      <AvisoFlotante aviso={aviso} onCerrar={cerrar} />

      {vista === 'INICIO' && (
        <BotonCompartir mostrarNotificacion={avisar} />
      )}

      <div className="w-full max-w-xl mx-auto flex flex-col gap-4 sm:gap-5 z-10 anim-suave">

        <button onClick={manejarClickAlumnado} className="relative w-full aspect-[21/9] sm:aspect-[3/1] min-h-[130px] rounded-full flex flex-col items-center justify-center group cursor-pointer mt-4 sm:mt-0 overflow-hidden transition-all duration-500 hover:-translate-y-1 hover:shadow-[0_16px_40px_rgba(0,144,208,0.15)] bg-white/60 backdrop-blur-2xl border border-white/80 shadow-[0_8px_32px_rgba(0,0,0,0.04)]">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-in-out"></div>
          <div className="absolute top-0 right-0 w-32 h-32 bg-[#00d2ff]/10 rounded-full blur-2xl -mr-10 -mt-10 transition-transform duration-700 group-hover:scale-150"></div>
          <span className="text-[clamp(2rem,8vw,3.5rem)] font-black tracking-tighter text-[#002b5c] group-hover:text-[#0090d0] transition-colors duration-300 relative z-10 drop-shadow-sm">ALUMNADO</span>
        </button>

        <button onClick={() => manejarClickDocente('PROFESORADO')} className="relative w-full aspect-[21/9] sm:aspect-[3/1] min-h-[130px] rounded-full flex flex-col items-center justify-center group cursor-pointer overflow-hidden transition-all duration-500 hover:-translate-y-1 hover:shadow-[0_16px_40px_rgba(0,43,92,0.12)] bg-[#F0F4F8]/80 backdrop-blur-2xl border border-white/60 shadow-[0_8px_32px_rgba(0,0,0,0.04)]">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-in-out"></div>
          <div className="absolute bottom-0 left-0 w-32 h-32 bg-[#002b5c]/5 rounded-full blur-2xl -ml-10 -mb-10 transition-transform duration-700 group-hover:scale-150"></div>
          <span className="text-[clamp(1.75rem,7vw,3.25rem)] font-black tracking-tighter text-[#002b5c]/90 group-hover:text-[#0090d0] transition-colors duration-300 relative z-10 drop-shadow-sm">PROFESORADO</span>
        </button>

        <div className="grid grid-cols-2 gap-4 sm:gap-5 mt-1 w-full">
          <button onClick={() => manejarClickDocente('GESTION')} className="relative w-full aspect-square sm:aspect-auto sm:h-[130px] rounded-full flex flex-col items-center justify-center gap-2 group cursor-pointer overflow-hidden transition-all duration-500 hover:-translate-y-1 hover:shadow-[0_16px_40px_rgba(0,43,92,0.3)] bg-gradient-to-br from-[#002b5c]/90 to-[#001530]/90 backdrop-blur-2xl border border-white/20 shadow-[0_8px_32px_rgba(0,0,0,0.1)]">
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
              {alumnoVinculado || localStorage.getItem('checker_rol') === 'profesor' ? 'Mi cuenta' : (
                <>
                  <span className="sm:hidden">Vincular</span>
                  <span className="hidden sm:inline">Mi cuenta</span>
                </>
              )}
            </span>
          </button>
        </div>

        {docente && (
          <div className="mt-2 mx-auto flex flex-wrap items-center justify-center gap-x-3 gap-y-2 px-5 py-3 bg-white/60 backdrop-blur-xl rounded-full border border-white/80 shadow-[0_4px_16px_rgba(0,0,0,0.04)] anim-suave">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"></span>
            <span className="text-xs font-bold text-[#002b5c]">Docente: {docente.nombre}</span>
            <span className="text-slate-300">·</span>
            <button onClick={cambiarDeCuenta} className="text-xs font-black text-[#0090d0] hover:text-[#002b5c] transition-colors cursor-pointer">Cambiar de cuenta</button>
            <span className="text-slate-300">·</span>
            <button onClick={() => cerrarSesionDocente()} className="text-xs font-black text-slate-400 hover:text-rose-500 transition-colors cursor-pointer">Cerrar sesión</button>
          </div>
        )}
      </div>
    </div>
  );
}
