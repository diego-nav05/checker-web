import { useState, useEffect } from 'react';
import PantallaProfesor from './PantallaProfesor.tsx';
import PantallaAlumno from './PantallaAlumno.tsx';
import PantallaRegistro from './PantallaRegistro.tsx';
import PantallaGestionDocente from './PantallaGestionDocente.tsx';
import BotonCompartir from './BotonCompartir.tsx';
import AvisoVersionNueva from './VersionNueva.tsx';
import { AvisoFlotante, useAviso } from './Aviso';
import { supabase, hashInicial } from './supabase';
import { Boton, BotonVolver, Campo, Pantalla, Tarjeta, retraso } from './ui';

type Vista = 'INICIO' | 'ALUMNADO' | 'PROFESORADO' | 'REGISTRO' | 'GESTION';

interface Docente {
  nombre: string;
  email: string;
}

// Gestión vuelve a pedir la contraseña pasados estos minutos
const MINUTOS_GESTION_DESBLOQUEADA = 10;
const hoy = () => new Date().toDateString();

// Iconos del inicio (trazos de 24x24)
const ICONOS = {
  qr: 'M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2M8 8h3v3H8zM13 13h3v3h-3zM13 8h3M8 13v3',
  pizarra: 'M3 4h18M5 4v10a2 2 0 002 2h10a2 2 0 002-2V4M12 16v4M8 20h8M9 9l2 2 4-4',
  engranaje: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z',
  persona: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  movil: 'M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z',
};

const ESTILOS_INICIO = {
  blanca: { tarjeta: 'bg-white/75 border border-white shadow-[0_16px_40px_-16px_rgba(0,43,92,0.18)] backdrop-blur-2xl', icono: 'bg-azul/10 text-azul', titulo: 'text-marino group-hover:text-azul', texto: 'text-slate-400', flecha: 'bg-marino text-white' },
  cristal: { tarjeta: 'glass-container', icono: 'bg-marino/5 text-marino', titulo: 'text-marino group-hover:text-azul', texto: 'text-slate-400', flecha: 'bg-marino text-white' },
  marino: { tarjeta: 'bg-gradient-to-br from-marino to-marino-oscuro border border-white/10 shadow-[0_16px_40px_-12px_rgba(0,43,92,0.45)]', icono: 'bg-white/10 text-white', titulo: 'text-white', texto: 'text-white/60', flecha: 'bg-white text-marino' },
  azul: { tarjeta: 'bg-gradient-to-br from-azul to-azul-oscuro border border-white/20 shadow-[0_16px_40px_-12px_rgba(0,144,208,0.45)]', icono: 'bg-white/15 text-white', titulo: 'text-white', texto: 'text-white/75', flecha: 'bg-white text-azul' },
};

interface TarjetaInicioProps {
  indice: number;
  onClick: () => void;
  icono: string;
  titulo: string;
  texto: string;
  estilo: keyof typeof ESTILOS_INICIO;
  className?: string;
  grande?: boolean;
}

function TarjetaInicio({ indice, onClick, icono, titulo, texto, estilo, className = '', grande }: TarjetaInicioProps) {
  const e = ESTILOS_INICIO[estilo];
  return (
    <button
      onClick={onClick}
      style={retraso(indice)}
      className={`bento-entrada group relative overflow-hidden rounded-bento p-6 sm:p-7 flex flex-col justify-between text-left cursor-pointer transition-all duration-500 hover:-translate-y-1 hover:shadow-[0_24px_48px_-16px_rgba(0,144,208,0.3)] active:scale-[0.98] ${e.tarjeta} ${className}`}
    >
      {/* Brillo que cruza la tarjeta al pasar el ratón */}
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-in-out pointer-events-none"></div>

      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center relative ${e.icono}`}>
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d={icono} /></svg>
      </div>

      <div className="relative mt-6 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className={`font-black tracking-tighter leading-none transition-colors duration-300 ${grande ? 'text-[clamp(1.9rem,7vw,2.6rem)]' : 'text-[clamp(1.25rem,5vw,1.6rem)]'} ${e.titulo}`}>{titulo}</p>
          <p className={`text-xs sm:text-sm font-semibold mt-2 ${e.texto}`}>{texto}</p>
        </div>
        <span className={`w-10 h-10 shrink-0 rounded-full flex items-center justify-center opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-500 ${e.flecha}`}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
        </span>
      </div>
    </button>
  );
}

export default function App() {
  const [vista, setVista] = useState<Vista>('INICIO');
  // Hacia dónde se desliza la pantalla nueva: desde la derecha al avanzar, desde la izquierda al volver
  const [direccion, setDireccion] = useState<'adelante' | 'atras'>('adelante');
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

    const { data: escucha } = supabase.auth.onAuthStateChange((evento, sesion) => {
      if (evento === 'PASSWORD_RECOVERY') setNuevaPassword('');
      if (evento === 'SIGNED_OUT') setDocente(null);
      // Un docente puede iniciar sesión también desde "Mi cuenta": así la app se entera sin recargar.
      // Supabase recomienda no llamar a sus métodos dentro de este aviso, por eso lo dejamos para justo después.
      if (evento === 'SIGNED_IN' && sesion) {
        setTimeout(async () => {
          const datos = await cargarDocente(sesion.user.id, sesion.user.email ?? '');
          if (!datos) return;
          localStorage.setItem('checker_rol', 'profesor');
          // Si ya había un día guardado no lo renovamos: una pestaña olvidada de ayer debe caducar
          if (!localStorage.getItem('checker_docente_dia')) localStorage.setItem('checker_docente_dia', hoy());
          setDocente(datos);
        }, 0);
      }
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

  // La sesión del docente caduca al cambiar de día, aunque la pestaña se haya quedado abierta
  useEffect(() => {
    if (!docente) return;
    const intervalo = setInterval(() => {
      if (localStorage.getItem('checker_docente_dia') !== hoy()) {
        cerrarSesionDocente('Tu sesión de docente ha caducado (dura hasta el final del día). Vuelve a entrar.');
      }
    }, 60_000);
    return () => clearInterval(intervalo);
  }, [docente]);

  useEffect(() => {
    if (!window.history.state || !window.history.state.panel) {
      window.history.replaceState({ panel: 'INICIO' }, '');
    }

    const handlePopState = (e: PopStateEvent) => {
      setDireccion('atras');
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
    setDireccion('adelante');
    window.history.pushState({ panel: nuevaVista }, '');
    setVista(nuevaVista);
    cerrar();
  };

  const volverInicio = () => {
    setDireccion('atras');
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
    <Pantalla ancho="estrecho" centrada>
      <AvisoFlotante aviso={aviso} onCerrar={cerrar} />
      <Tarjeta indice={0} className="p-7 sm:p-10">
        {alVolver && <BotonVolver onClick={alVolver} className="mb-8" />}
        <h2 className="text-3xl font-black text-marino tracking-tight leading-none mb-8">{titulo}</h2>
        {contenido}
      </Tarjeta>
    </Pantalla>
  );

  // Cada pantalla es una función normal (no un componente) para que React no la vuelva a montar en cada render
  const pintarPantalla = () => {
    if (nuevaPassword !== null) {
      return fondoFormulario('Nueva contraseña', (
        <form onSubmit={guardarNuevaPassword} className="flex flex-col gap-4 relative z-10">
          <p className="text-sm text-slate-500 font-medium leading-relaxed">Escribe la contraseña que quieres usar a partir de ahora.</p>
          <Campo type="password" placeholder="Nueva contraseña (mín. 6 caracteres)" value={nuevaPassword} onChange={(e) => setNuevaPassword(e.target.value)} minLength={6} required autoFocus />
          <Boton type="submit" ancho disabled={cargandoProfesor} className="mt-4 py-4">{cargandoProfesor ? 'Guardando...' : 'Guardar contraseña'}</Boton>
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
            <Campo type="email" placeholder="Correo UNEATLANTICO" value={emailProfesor} onChange={(e) => setEmailProfesor(e.target.value)} required autoComplete="username" />
            <Campo type="password" placeholder="Contraseña" value={passProfesor} onChange={(e) => setPassProfesor(e.target.value)} required autoComplete="current-password" />
            <Boton type="submit" ancho disabled={cargandoProfesor} className="mt-4 py-4">
              {cargandoProfesor ? 'Verificando...' : 'Acceder'}
            </Boton>
          </form>
        ), volverInicio);
      }

      if (vista === 'GESTION' && Date.now() > gestionDesbloqueadaHasta) {
        return fondoFormulario('Gestión', (
          <form onSubmit={desbloquearGestion} className="flex flex-col gap-4 relative z-10">
            <p className="text-sm text-slate-500 font-medium leading-relaxed">
              Conectado como <span className="font-bold text-marino">{docente.nombre}</span>
              <br /><span className="text-xs">{docente.email}</span>
            </p>
            <Campo type="password" placeholder="Contraseña" value={passProfesor} onChange={(e) => setPassProfesor(e.target.value)} required autoFocus autoComplete="current-password" />
            <Boton type="submit" ancho disabled={cargandoProfesor} className="mt-4 py-4">
              {cargandoProfesor ? 'Verificando...' : 'Entrar en Gestión'}
            </Boton>
            <Boton variante="texto" onClick={cambiarDeCuenta} className="mt-2">
              ¿No eres tú? Cambiar de cuenta
            </Boton>
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

    const tieneCuenta = alumnoVinculado || localStorage.getItem('checker_rol') === 'profesor';

    return (
      <Pantalla centrada>
        <AvisoFlotante aviso={aviso} onCerrar={cerrar} />
        {vista === 'INICIO' && <BotonCompartir mostrarNotificacion={avisar} />}

        <div className="w-full max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-5 px-1 bento-entrada" style={retraso(0)}>
            <div className="w-11 h-11 rounded-2xl bg-marino flex items-center justify-center shadow-[0_8px_20px_rgba(0,43,92,0.3)]">
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2"><path strokeLinecap="round" strokeLinejoin="round" d={ICONOS.qr} /></svg>
            </div>
            <div>
              <p className="text-xl font-black text-marino tracking-tight leading-none">Checker</p>
              <p className="text-xs font-semibold text-slate-400 mt-1">Asistencia en clase con QR</p>
            </div>
          </div>

          {/* Cuadrícula bento: en el ordenador Alumnado ocupa la columna izquierda entera */}
          <div className="grid grid-cols-2 md:grid-cols-3 md:grid-rows-2 gap-4 sm:gap-5">
            <TarjetaInicio
              indice={1}
              onClick={manejarClickAlumnado}
              icono={ICONOS.qr}
              titulo="ALUMNADO"
              texto="Escanea el QR de tu clase"
              estilo="blanca"
              className="col-span-2 md:col-span-1 md:row-span-2 min-h-[170px] md:min-h-[380px]"
              grande
            />
            <TarjetaInicio
              indice={2}
              onClick={() => manejarClickDocente('PROFESORADO')}
              icono={ICONOS.pizarra}
              titulo="PROFESORADO"
              texto="Abre tu clase y proyecta el QR"
              estilo="cristal"
              className="col-span-2 min-h-[150px]"
              grande
            />
            <TarjetaInicio
              indice={3}
              onClick={() => manejarClickDocente('GESTION')}
              icono={ICONOS.engranaje}
              titulo="Gestión"
              texto="Alumnos y asignaturas"
              estilo="marino"
              className="min-h-[150px]"
            />
            <TarjetaInicio
              indice={4}
              onClick={() => irAPanel('REGISTRO')}
              icono={tieneCuenta ? ICONOS.persona : ICONOS.movil}
              titulo={tieneCuenta ? 'Mi cuenta' : 'Vincular'}
              texto={tieneCuenta ? 'Tu cuenta y tu móvil' : 'Crea tu cuenta o entra'}
              estilo="azul"
              className="min-h-[150px]"
            />
          </div>

          {docente && (
            <Tarjeta indice={5} className="mt-4 sm:mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 px-5 py-3.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"></span>
              <span className="text-xs font-bold text-marino">Docente: {docente.nombre}</span>
              <span className="text-slate-300">·</span>
              <button onClick={cambiarDeCuenta} className="text-xs font-black text-azul hover:text-marino transition-colors cursor-pointer">Cambiar de cuenta</button>
              <span className="text-slate-300">·</span>
              <button onClick={() => cerrarSesionDocente()} className="text-xs font-black text-slate-400 hover:text-rose-500 transition-colors cursor-pointer">Cerrar sesión</button>
            </Tarjeta>
          )}
        </div>
      </Pantalla>
    );
  };

  return (
    <>
      <AvisoVersionNueva />
      <div key={nuevaPassword !== null ? 'NUEVA_PASSWORD' : vista} className={direccion === 'adelante' ? 'pantalla-adelante' : 'pantalla-atras'}>
        {pintarPantalla()}
      </div>
    </>
  );
}
