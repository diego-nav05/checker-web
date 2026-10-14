// Edge Function "cuentas": operaciones que necesitan la clave de administrador de Supabase.
//
//  · accion "alta"     → un profesor mete a un alumno en su asignatura (solo con el nombre; el correo
//                         es opcional). Si ya tiene cuenta (por el correo o, sin correo, por el nombre),
//                         solo lo matricula; si no, le crea una cuenta pendiente de activar.
//  · accion "reclamar" → el alumno activa la cuenta que le creó el profesor, con su correo y su
//                         contraseña. Se identifica por el correo o por el código de alta.
//
// La clave de administrador (SUPABASE_SERVICE_ROLE_KEY) la pone Supabase automáticamente:
// nunca está en la web ni en GitHub.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const DOMINIO_SIN_CORREO = 'pendiente.invalid';
const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class ErrorCuenta extends Error {}

const responder = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const normalizarEmail = (email: unknown) => (typeof email === 'string' ? email.trim().toLowerCase() : '');
// ilike trata '_' y '%' como comodines: los escapamos para comparar el correo exacto sin mayúsculas
const patronExacto = (texto: string) => texto.replace(/[\\%_]/g, (c) => `\\${c}`);
// Para comparar nombres sin que importen mayúsculas, tildes ni espacios de más
const normalizarNombre = (texto: string) =>
  texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const cuerpo = await req.json();
    if (cuerpo.accion === 'alta') return responder(await alta(req, admin, cuerpo));
    if (cuerpo.accion === 'reclamar') return responder(await reclamar(admin, url, anonKey, cuerpo));
    throw new ErrorCuenta('ACCION_DESCONOCIDA');
  } catch (e) {
    const codigo = e instanceof ErrorCuenta ? e.message : 'ERROR_INTERNO';
    if (!(e instanceof ErrorCuenta)) console.error(e);
    return responder({ error: codigo }, 400);
  }
});

async function alta(req: Request, admin: SupabaseClient, cuerpo: Record<string, unknown>) {
  // 1. Comprobar que quien llama es un profesor y que la asignatura es suya
  const token = (req.headers.get('Authorization') || '').replace('Bearer ', '');
  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) throw new ErrorCuenta('NO_AUTORIZADO');

  const { data: profe } = await admin.from('perfiles').select('rol').eq('id', user.id).single();
  if (profe?.rol !== 'profesor') throw new ErrorCuenta('NO_AUTORIZADO');

  const asignaturaId = String(cuerpo.asignatura_id || '');
  const { data: asignatura } = await admin.from('asignaturas').select('id, profesor_id').eq('id', asignaturaId).maybeSingle();
  if (!asignatura || asignatura.profesor_id !== user.id) throw new ErrorCuenta('ASIGNATURA_NO_VALIDA');

  const nombre = String(cuerpo.nombre || '').trim().replace(/\s+/g, ' ');
  if (nombre.length < 3) throw new ErrorCuenta('NOMBRE_OBLIGATORIO');
  const email = normalizarEmail(cuerpo.email);
  if (email && !EMAIL_VALIDO.test(email)) throw new ErrorCuenta('EMAIL_NO_VALIDO');

  // 2. Si el alumno ya tiene cuenta, no creamos otra: solo lo metemos en la asignatura.
  //    Con correo lo buscamos por el correo; sin correo, por el nombre (así no se duplica a quien
  //    ya usa Checker en otra asignatura y el profe solo ha escrito su nombre).
  let alumnoId: string;
  let tipo: 'EXISTENTE' | 'NUEVO';
  let porNombre = false;
  let { data: existente } = email
    ? await admin.from('perfiles').select('id, rol').ilike('email', patronExacto(email)).maybeSingle()
    : { data: null as { id: string; rol: string } | null };

  if (!email) {
    const buscado = normalizarNombre(nombre);
    const { data: alumnos } = await admin.from('perfiles').select('id, rol, nombre_completo, pendiente').eq('rol', 'alumno');
    const iguales = (alumnos || []).filter((a) => normalizarNombre(a.nombre_completo || '') === buscado);
    // Si hay varios con ese nombre, vale el único que ya ha activado su cuenta; si no, pedimos el correo
    const activos = iguales.filter((a) => !a.pendiente);
    const candidatos = iguales.length <= 1 ? iguales : activos.length === 1 ? activos : null;
    if (!candidatos) throw new ErrorCuenta('NOMBRE_REPETIDO');
    if (candidatos.length === 1) {
      existente = { id: candidatos[0].id, rol: candidatos[0].rol };
      porNombre = true;
    }
  }

  if (existente) {
    if (existente.rol === 'profesor') throw new ErrorCuenta('ES_PROFESOR');
    alumnoId = existente.id;
    tipo = 'EXISTENTE';
  } else {
    const emailFinal = email || `alta-${crypto.randomUUID()}@${DOMINIO_SIN_CORREO}`;
    const { data: creado, error } = await admin.auth.admin.createUser({
      email: emailFinal,
      email_confirm: false, // el alumno lo confirmará cuando active la cuenta
      user_metadata: { nombre_completo: nombre, rol: 'alumno', pendiente: true },
    });
    if (error || !creado.user) {
      console.error(error);
      throw new ErrorCuenta(error?.message?.includes('already') ? 'EMAIL_YA_REGISTRADO' : 'ERROR_CREANDO');
    }
    alumnoId = creado.user.id;
    tipo = 'NUEVO';
  }

  // 3. Matricular y, si hay una clase abierta de esa asignatura, añadirlo a la lista
  await admin.from('matriculas').upsert({ asignatura_id: asignaturaId, alumno_id: alumnoId }, { onConflict: 'asignatura_id,alumno_id', ignoreDuplicates: true });
  const { data: abiertas } = await admin.from('sesiones').select('id').eq('asignatura_id', asignaturaId).in('fase', ['ENTRADA', 'SALIDA']);
  if (abiertas?.length) {
    await admin.from('asistencias').upsert(
      abiertas.map((s) => ({ sesion_id: s.id, alumno_id: alumnoId, estado: 'FALTA_INJUSTIFICADA', manual: false })),
      { onConflict: 'sesion_id,alumno_id', ignoreDuplicates: true },
    );
  }

  const { data: perfil } = await admin.from('perfiles').select('nombre_completo, codigo_alta, pendiente').eq('id', alumnoId).single();
  return {
    tipo,
    porNombre,
    nombre: perfil?.nombre_completo ?? nombre,
    email: email || null,
    pendiente: perfil?.pendiente ?? false,
    codigo: perfil?.codigo_alta ?? null,
  };
}

async function reclamar(admin: SupabaseClient, url: string, anonKey: string, cuerpo: Record<string, unknown>) {
  const email = normalizarEmail(cuerpo.email);
  const password = String(cuerpo.password || '');
  const nombre = String(cuerpo.nombre || '').trim().replace(/\s+/g, ' ');
  const codigo = String(cuerpo.codigo || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

  if (!EMAIL_VALIDO.test(email) || email.endsWith(`@${DOMINIO_SIN_CORREO}`)) throw new ErrorCuenta('EMAIL_NO_VALIDO');
  if (password.length < 6) throw new ErrorCuenta('PASSWORD_CORTA');

  // 1. Buscar la cuenta pendiente: por código si lo hay, si no por correo
  const consulta = admin.from('perfiles').select('id, email').eq('pendiente', true);
  const { data: pendiente } = codigo
    ? await consulta.eq('codigo_alta', codigo).maybeSingle()
    : await consulta.ilike('email', patronExacto(email)).maybeSingle();
  if (!pendiente) throw new ErrorCuenta(codigo ? 'CODIGO_NO_VALIDO' : 'NO_PENDIENTE');

  // 2. Si el correo pertenece a OTRA cuenta que el alumno ya tenía, unimos las dos
  if (pendiente.email.toLowerCase() !== email) {
    const { data: otra } = await admin.from('perfiles').select('id, pendiente, rol').ilike('email', patronExacto(email)).maybeSingle();
    if (otra) {
      if (otra.pendiente || otra.rol !== 'alumno') throw new ErrorCuenta('EMAIL_YA_REGISTRADO');
      // Solo si demuestra que es suya escribiendo su contraseña correcta
      const publico = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { error: errorLogin } = await publico.auth.signInWithPassword({ email, password });
      if (errorLogin) throw new ErrorCuenta(errorLogin.message.toLowerCase().includes('not confirmed') ? 'EMAIL_SIN_CONFIRMAR' : 'EMAIL_YA_REGISTRADO');

      const { error: errorFusion } = await admin.rpc('fusionar_alumnos', { p_origen: pendiente.id, p_destino: otra.id });
      if (errorFusion) {
        console.error(errorFusion);
        throw new ErrorCuenta('ERROR_INTERNO');
      }
      await admin.auth.admin.deleteUser(pendiente.id);
      return { resultado: 'FUSIONADA' };
    }
  }

  // 3. Poner el correo y la contraseña que ha elegido el alumno
  const { error: errorUpdate } = await admin.auth.admin.updateUserById(pendiente.id, { email, password });
  if (errorUpdate) {
    console.error(errorUpdate);
    throw new ErrorCuenta('ERROR_INTERNO');
  }
  if (nombre.length >= 3) await admin.from('perfiles').update({ nombre_completo: nombre }).eq('id', pendiente.id);

  // 4. Enviar el correo de confirmación (el "segundo paso": demuestra que el correo es suyo)
  const envio = await fetch(`${url}/auth/v1/resend`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'signup', email }),
  });
  if (!envio.ok) console.error('Fallo enviando confirmación', envio.status, await envio.text());

  return { resultado: 'CONFIRMA_CORREO', correoEnviado: envio.ok };
}
