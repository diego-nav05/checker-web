import { useState } from 'react';
import { supabase } from './supabase';
import { AvisoFlotante, useAviso } from './Aviso';
import { Boton, BotonVolver, Campo, Pantalla, Pestanas, Tarjeta } from './ui';
import { estadoCuenta, mensajeError, reclamarCuenta, vincularEsteDispositivo, type ResultadoReclamar } from './cuentas';

interface Props {
  onVolver: () => void;
}

const DOMINIO_DOCENTE = '@uneatlantico.es';

export default function PantallaRegistro({ onVolver }: Props) {
  const [esRegistro, setEsRegistro] = useState(true);
  const [esRecuperarPass, setEsRecuperarPass] = useState(false);
  const [rolRegistro, setRolRegistro] = useState<'alumno' | 'profesor'>('alumno');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nombre, setNombre] = useState('');
  const [codigoAlta, setCodigoAlta] = useState('');
  const [mostrarCodigo, setMostrarCodigo] = useState(false);
  const [cargando, setCargando] = useState(false);
  // Correo que falta por confirmar: muestra el botón de "Reenviar correo"
  const [emailSinConfirmar, setEmailSinConfirmar] = useState<string | null>(null);

  const { aviso, avisar, cerrar } = useAviso();

  const irAInicioSesion = (conservarEmail: string) => {
    setEsRegistro(false);
    setEsRecuperarPass(false);
    setNombre('');
    setPassword('');
    setCodigoAlta('');
    setMostrarCodigo(false);
    setEmail(conservarEmail);
  };

  const reenviarConfirmacion = async () => {
    if (!emailSinConfirmar) return;
    setCargando(true);
    const { error } = await supabase.auth.resend({ type: 'signup', email: emailSinConfirmar });
    setCargando(false);
    if (error) {
      avisar(error.message.toLowerCase().includes('rate limit') || error.message.includes('seconds')
        ? 'Espera un minuto antes de pedir otro correo.'
        : 'No se pudo reenviar el correo. Inténtalo de nuevo en unos minutos.', 'error');
      return;
    }
    avisar(`Correo reenviado a ${emailSinConfirmar}. Revisa también la carpeta de spam.`, 'exito', { fijo: true });
  };

  // Mensaje tras activar una cuenta que había creado un profesor
  const avisarCuentaReclamada = (resultado: ResultadoReclamar, emailUsado: string) => {
    if (resultado.resultado === 'FUSIONADA') return; // se gestiona iniciando sesión directamente
    setEmailSinConfirmar(emailUsado);
    irAInicioSesion(emailUsado);
    avisar(
      `¡Tu profesor ya te había dado de alta! Hemos guardado tu contraseña.\n\n` +
      (resultado.correoEnviado
        ? `Te hemos enviado un correo a ${emailUsado}: ábrelo y pulsa el enlace para activar tu cuenta (mira también en spam). Después vuelve aquí e inicia sesión. Conservarás todas tus asistencias.`
        : `No hemos podido enviarte ahora el correo de activación. Pulsa "Reenviar correo de activación" en unos minutos.`),
      'exito',
      { fijo: true },
    );
  };

  // Último paso al iniciar sesión: perfil + vincular el móvil
  const completarInicioSesion = async (userId: string) => {
    const { data: perfil, error: profileError } = await supabase.from('perfiles').select('id, nombre_completo, rol').eq('id', userId).single();
    if (profileError || !perfil) {
      await supabase.auth.signOut();
      throw new Error('No se encontró tu perfil de usuario. Pide ayuda a tu profesor.');
    }

    if (perfil.rol === 'profesor') {
      localStorage.setItem('checker_rol', 'profesor');
      localStorage.setItem('checker_docente_dia', new Date().toDateString());
      localStorage.setItem('checker_nombre', perfil.nombre_completo);
      localStorage.removeItem('checker_alumno_id');
      avisar('Has entrado como docente.', 'exito');
      setTimeout(onVolver, 1200);
      return;
    }

    const vinculo = await vincularEsteDispositivo();
    if (vinculo === 'OTRO_DISPOSITIVO') {
      await supabase.auth.signOut();
      avisar(
        'Tu cuenta ya está vinculada a otro móvil o a otro navegador.\n\nSi has cambiado de móvil o de navegador, pide a tu profesor que la libere en Gestión → Alumnos y vuelve a entrar. Consejo: entra siempre desde el mismo navegador.',
        'error',
        { fijo: true },
      );
      return;
    }

    localStorage.setItem('checker_alumno_id', perfil.id);
    localStorage.setItem('checker_nombre', perfil.nombre_completo);
    localStorage.setItem('checker_rol', 'alumno');

    avisar('¡Listo! Este móvil ha quedado vinculado a tu cuenta.', 'exito');
    setTimeout(onVolver, 1500);
  };

  const recuperarPassword = async () => {
    if (!email.trim()) throw new Error('Introduce tu correo electrónico.');
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
    if (error) throw error;
    avisar(`Si existe una cuenta con ${email.trim()}, te llegará un correo para cambiar la contraseña. Revisa también la carpeta de spam.`, 'exito', { fijo: true });
    setEsRecuperarPass(false);
  };

  const registrarse = async () => {
    const emailLimpio = email.trim().toLowerCase();
    if (!nombre.trim()) throw new Error('El nombre es obligatorio.');
    if (password.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.');

    if (rolRegistro === 'profesor') {
      if (!emailLimpio.endsWith(DOMINIO_DOCENTE)) throw new Error(`Los docentes deben registrarse con un correo ${DOMINIO_DOCENTE}`);
    } else {
      // Cuenta creada por un profesor sin correo: el alumno la activa con su código
      if (mostrarCodigo && codigoAlta.trim()) {
        const resultado = await reclamarCuenta({ email: emailLimpio, password, nombre: nombre.trim(), codigo: codigoAlta });
        if (resultado.resultado === 'FUSIONADA') return iniciarSesion(emailLimpio, password);
        return avisarCuentaReclamada(resultado, emailLimpio);
      }

      const estado = await estadoCuenta(emailLimpio);
      if (estado === 'PENDIENTE') {
        // El profe ya le creó la cuenta con este correo: se detecta solo por el correo
        const resultado = await reclamarCuenta({ email: emailLimpio, password, nombre: nombre.trim() });
        return avisarCuentaReclamada(resultado, emailLimpio);
      }
      if (estado === 'EXISTE') {
        irAInicioSesion(emailLimpio);
        avisar('Ya tienes una cuenta con este correo. Inicia sesión con tu contraseña.', 'info', { fijo: true });
        return;
      }
      if (estado === 'SIN_CONFIRMAR') {
        setEmailSinConfirmar(emailLimpio);
        irAInicioSesion(emailLimpio);
        avisar('Ya te registraste con este correo, pero falta activarlo. Busca el correo de activación (también en spam) o pulsa "Reenviar correo de activación".', 'info', { fijo: true });
        return;
      }
    }

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: emailLimpio,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        // El servidor crea el perfil con estos datos (ver migración cuentas_y_matriculas)
        data: { nombre_completo: nombre.trim(), rol: rolRegistro },
      },
    });
    if (authError) throw authError;
    if (!authData.user || authData.user.identities?.length === 0) {
      // Supabase responde así cuando el correo ya estaba registrado
      irAInicioSesion(emailLimpio);
      avisar('Ya existe una cuenta con este correo. Inicia sesión con tu contraseña.', 'info', { fijo: true });
      return;
    }

    if (!authData.session) {
      setEmailSinConfirmar(emailLimpio);
      irAInicioSesion(emailLimpio);
      avisar(
        `¡Cuenta creada! Te hemos enviado un correo a ${emailLimpio}.\n\nÁbrelo y pulsa el enlace para activar tu cuenta (mira también en spam). Después vuelve aquí e inicia sesión desde el navegador que vayas a usar en clase.`,
        'exito',
        { fijo: true },
      );
      return;
    }

    await completarInicioSesion(authData.user.id);
  };

  const iniciarSesion = async (emailLogin: string, passwordLogin: string) => {
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email: emailLogin, password: passwordLogin });

    if (authError) {
      const msg = authError.message.toLowerCase();
      if (msg.includes('email not confirmed')) {
        setEmailSinConfirmar(emailLogin);
        avisar('Todavía no has activado tu cuenta. Busca el correo de activación (también en spam) o pulsa "Reenviar correo de activación".', 'info', { fijo: true });
        return;
      }
      if (msg.includes('invalid login credentials')) {
        const estado = await estadoCuenta(emailLogin);
        if (estado === 'PENDIENTE') {
          // Cuenta creada por un profe: la contraseña que ha escrito pasa a ser la suya
          const resultado = await reclamarCuenta({ email: emailLogin, password: passwordLogin });
          return avisarCuentaReclamada(resultado, emailLogin);
        }
        if (estado === 'LIBRE') throw new Error('No hay ninguna cuenta con este correo. Pulsa "Regístrate aquí" para crearla (si tu profesor te dio un código de alta, escríbelo allí).');
        throw new Error('Contraseña incorrecta. Si no la recuerdas, pulsa "¿Has olvidado tu contraseña?".');
      }
      throw authError;
    }

    setEmailSinConfirmar(null);
    await completarInicioSesion(authData.user.id);
  };

  const autenticar = async (e: React.FormEvent) => {
    e.preventDefault();
    setCargando(true);
    cerrar();

    try {
      if (esRecuperarPass) await recuperarPassword();
      else if (esRegistro) await registrarse();
      else await iniciarSesion(email.trim().toLowerCase(), password);
    } catch (error: any) {
      let mensaje = mensajeError(error.message || 'Ha ocurrido un error inesperado.');
      const msgLower = mensaje.toLowerCase();

      if (msgLower.includes('invalid login credentials')) mensaje = 'Correo o contraseña incorrectos.';
      else if (msgLower.includes('already registered')) mensaje = 'Este correo ya tiene una cuenta. Inicia sesión.';
      else if (msgLower.includes('password should be at least')) mensaje = 'La contraseña debe tener al menos 6 caracteres.';
      else if (msgLower.includes('unable to validate email address') || msgLower.includes('invalid format')) mensaje = 'El formato del correo electrónico es inválido.';
      else if (msgLower.includes('rate limit') || msgLower.includes('security purposes')) mensaje = 'Demasiados intentos seguidos. Espera un minuto y vuelve a probar.';
      else if (msgLower.includes('email link is invalid')) mensaje = 'El enlace ha caducado o no es válido.';
      else if (msgLower.includes('missing email')) mensaje = 'Por favor, introduce tu correo electrónico.';
      else if (msgLower.includes('database error saving new user')) mensaje = `No se pudo crear la cuenta. Si eres docente, usa tu correo ${DOMINIO_DOCENTE}.`;
      else if (msgLower.includes('failed to fetch') || msgLower.includes('network')) mensaje = 'Sin conexión a internet. Revisa tu conexión y vuelve a intentarlo.';

      avisar(mensaje, 'error');
    } finally {
      setCargando(false);
    }
  };

  const cambiarModo = (registro: boolean) => {
    setEsRegistro(registro);
    cerrar();
    setEmail('');
    setPassword('');
    setNombre('');
    setCodigoAlta('');
    setMostrarCodigo(false);
    setEmailSinConfirmar(null);
  };

  const modo = esRecuperarPass ? 'RECUPERAR' : esRegistro ? 'REGISTRO' : 'LOGIN';

  return (
    <Pantalla ancho="estrecho" centrada>
      <AvisoFlotante aviso={aviso} onCerrar={cerrar} />

      <Tarjeta indice={0} className="p-7 sm:p-10">
        <BotonVolver onClick={onVolver} className="mb-8" />

        {/* key={modo}: al cambiar entre registro, inicio de sesión y recuperar, el contenido entra deslizándose */}
        <div key={modo} className="contenido-pestana">
          <h2 className="text-3xl font-black text-marino tracking-tight leading-none mb-3">
            {modo === 'RECUPERAR' ? 'Recuperar contraseña' : modo === 'REGISTRO' ? 'Nueva cuenta' : '¡Hola de nuevo!'}
          </h2>
          <p className="text-sm text-slate-500 font-medium mb-8 leading-relaxed">
            {modo === 'RECUPERAR' ? 'Introduce tu correo y te enviaremos un enlace para cambiarla.' : modo === 'REGISTRO' ? 'Regístrate una sola vez para vincular tu dispositivo de forma segura.' : 'Introduce tu correo y contraseña para acceder.'}
          </p>

          <form onSubmit={autenticar} className="flex flex-col gap-4">
            {modo === 'REGISTRO' && (
              <>
                <Pestanas
                  opciones={[{ valor: 'alumno', texto: 'Estudiante' }, { valor: 'profesor', texto: 'Docente' }]}
                  valor={rolRegistro}
                  onCambiar={(rol) => { setRolRegistro(rol); setEmail(''); if (rol === 'profesor') setMostrarCodigo(false); }}
                />
                <Campo type="text" placeholder="Nombre y apellidos" value={nombre} onChange={(e) => setNombre(e.target.value)} required autoComplete="name" />
              </>
            )}

            {modo === 'REGISTRO' && rolRegistro === 'profesor' ? (
              <div className="flex w-full bg-white/60 backdrop-blur-md rounded-control border border-white focus-within:border-azul/30 focus-within:ring-4 focus-within:ring-azul/10 transition-all shadow-[0_2px_10px_rgba(0,0,0,0.02)] overflow-hidden">
                <input
                  type="text"
                  placeholder="nombre.apellido"
                  value={email.replace(DOMINIO_DOCENTE, '')}
                  onChange={(e) => setEmail(e.target.value.replace(DOMINIO_DOCENTE, '') + DOMINIO_DOCENTE)}
                  className="w-full pl-5 py-4 bg-transparent outline-none text-marino text-sm font-bold tracking-wide placeholder:text-slate-400 placeholder:font-semibold"
                  required
                  autoComplete="username"
                />
                <div className="pr-5 py-4 flex items-center text-marino/50 text-sm font-bold select-none pointer-events-none">
                  {DOMINIO_DOCENTE}
                </div>
              </div>
            ) : (
              <Campo type="email" placeholder="Correo electrónico" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            )}

            {modo !== 'RECUPERAR' && (
              <Campo type="password" placeholder="Contraseña" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} autoComplete={modo === 'REGISTRO' ? 'new-password' : 'current-password'} />
            )}

            {modo === 'REGISTRO' && rolRegistro === 'alumno' && (
              mostrarCodigo ? (
                <div className="contenido-pestana">
                  <Campo
                    type="text"
                    placeholder="Código de alta"
                    value={codigoAlta}
                    onChange={(e) => setCodigoAlta(e.target.value.toUpperCase())}
                    maxLength={8}
                    autoCapitalize="characters"
                    autoComplete="off"
                    className="border-azul/20 font-black tracking-[0.3em] text-center uppercase placeholder:normal-case placeholder:tracking-normal"
                  />
                  <p className="text-[11px] text-slate-400 font-semibold mt-2 px-2 leading-snug">
                    Lo tienes si tu profesor te dio de alta antes de que te registraras. Tus asistencias se conservarán.
                  </p>
                </div>
              ) : (
                <button type="button" onClick={() => setMostrarCodigo(true)} className="text-xs font-bold text-azul hover:text-marino transition-colors cursor-pointer self-center">
                  ¿Tu profesor te dio un código de alta?
                </button>
              )
            )}

            <Boton type="submit" variante={modo === 'LOGIN' ? 'principal' : 'acento'} ancho disabled={cargando} className="mt-4 py-4">
              {cargando ? 'Procesando...' : modo === 'RECUPERAR' ? 'Enviar correo de recuperación' : modo === 'REGISTRO' ? 'Crear mi cuenta' : 'Iniciar sesión'}
            </Boton>

            {emailSinConfirmar && modo === 'LOGIN' && (
              <Boton variante="secundario" ancho onClick={reenviarConfirmacion} disabled={cargando}>
                Reenviar correo de activación
              </Boton>
            )}
          </form>

          <div className="mt-8 pt-6 border-t border-slate-200/60 text-center flex flex-col items-center gap-3">
            {modo === 'RECUPERAR' ? (
              <Boton variante="secundario" tamano="pequeno" onClick={() => setEsRecuperarPass(false)}>
                Volver a <span className="text-azul">iniciar sesión</span>
              </Boton>
            ) : modo === 'REGISTRO' ? (
              <Boton variante="secundario" tamano="pequeno" onClick={() => cambiarModo(false)}>
                ¿Ya tienes una cuenta? <span className="text-azul">Inicia sesión</span>
              </Boton>
            ) : (
              <>
                <Boton variante="secundario" tamano="pequeno" onClick={() => cambiarModo(true)}>
                  ¿Eres nuevo? <span className="text-azul">Regístrate aquí</span>
                </Boton>
                <Boton variante="texto" onClick={() => { setEsRecuperarPass(true); cerrar(); setPassword(''); }}>
                  ¿Has olvidado tu contraseña?
                </Boton>
              </>
            )}
          </div>
        </div>
      </Tarjeta>
    </Pantalla>
  );
}
