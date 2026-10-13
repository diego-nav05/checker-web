-- Mejoras de cuentas: vinculación de móvil fiable, altas forzosas de alumnos,
-- matrículas como lista oficial de cada asignatura y validación del QR en el servidor.
-- Esta migración SOLO AÑADE cosas: la versión anterior de la web sigue funcionando con ella.

-- ---------------------------------------------------------------------------
-- 1. Columnas nuevas en perfiles
-- ---------------------------------------------------------------------------
alter table public.perfiles
  add column if not exists dispositivo_id text,                    -- identificador aleatorio guardado en el navegador
  add column if not exists pendiente boolean not null default false, -- cuenta creada por un profe y aún no activada
  add column if not exists codigo_alta text unique;                -- código para activar una cuenta pendiente

-- ---------------------------------------------------------------------------
-- 2. Funciones auxiliares
-- ---------------------------------------------------------------------------
create or replace function public.es_profesor()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and rol = 'profesor');
$$;

create or replace function public.generar_codigo_alta()
returns text language plpgsql volatile set search_path = '' as $$
declare
  letras constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- sin 0/O ni 1/I para no confundirlos
  codigo text;
begin
  loop
    codigo := '';
    for i in 1..6 loop
      codigo := codigo || substr(letras, 1 + floor(random() * length(letras))::int, 1);
    end loop;
    exit when not exists (select 1 from public.perfiles where codigo_alta = codigo);
  end loop;
  return codigo;
end $$;

create or replace function public.hora_servidor()
returns double precision language sql stable as $$
  select extract(epoch from now());
$$;

-- ---------------------------------------------------------------------------
-- 3. Perfil creado automáticamente al registrarse (en el servidor)
--    La web nueva manda nombre y rol como metadatos del registro. La web antigua
--    no los manda y crea el perfil ella misma, así que en ese caso no hacemos nada.
-- ---------------------------------------------------------------------------
create or replace function public.crear_perfil_desde_auth()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_nombre text := nullif(trim(new.raw_user_meta_data->>'nombre_completo'), '');
  v_rol text := coalesce(new.raw_user_meta_data->>'rol', 'alumno');
  v_pendiente boolean := coalesce((new.raw_user_meta_data->>'pendiente')::boolean, false);
begin
  if v_nombre is null then
    return new;
  end if;
  if v_rol not in ('alumno', 'profesor') then
    v_rol := 'alumno';
  end if;
  if v_rol = 'profesor' and lower(new.email) not like '%@uneatlantico.es' then
    raise exception 'Los docentes deben registrarse con un correo @uneatlantico.es';
  end if;

  insert into public.perfiles (id, nombre_completo, email, rol, pendiente, codigo_alta)
  values (new.id, v_nombre, lower(new.email), v_rol::public.rol_usuario, v_pendiente,
          case when v_pendiente then public.generar_codigo_alta() end)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function public.crear_perfil_desde_auth();

-- Cuando una cuenta pendiente confirma su correo deja de estar pendiente.
-- Si el correo cambia (al activar una cuenta creada sin correo) lo copiamos al perfil.
create or replace function public.sincronizar_perfil_desde_auth()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email is distinct from old.email then
    update public.perfiles set email = lower(new.email) where id = new.id;
  end if;
  if new.email_confirmed_at is not null and old.email_confirmed_at is null then
    update public.perfiles set pendiente = false, codigo_alta = null where id = new.id and pendiente;
  end if;
  return new;
end $$;

drop trigger if exists al_actualizar_usuario on auth.users;
create trigger al_actualizar_usuario
  after update on auth.users
  for each row execute function public.sincronizar_perfil_desde_auth();

-- ---------------------------------------------------------------------------
-- 4. Matrículas: lista oficial de alumnos de cada asignatura
-- ---------------------------------------------------------------------------
-- Rellenamos con todos los alumnos que ya tienen alguna asistencia, para que nadie desaparezca.
insert into public.matriculas (asignatura_id, alumno_id)
select distinct s.asignatura_id, a.alumno_id
from public.asistencias a
join public.sesiones s on s.id = a.sesion_id
join public.perfiles p on p.id = a.alumno_id
where s.asignatura_id is not null
on conflict (asignatura_id, alumno_id) do nothing;

-- Cualquier asistencia nueva (venga de la web antigua o de la nueva) matricula al alumno.
create or replace function public.matricular_desde_asistencia()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.matriculas (asignatura_id, alumno_id)
  select s.asignatura_id, new.alumno_id
  from public.sesiones s
  where s.id = new.sesion_id
    and s.asignatura_id is not null
    and exists (select 1 from public.perfiles p where p.id = new.alumno_id)
  on conflict (asignatura_id, alumno_id) do nothing;
  return new;
end $$;

drop trigger if exists al_crear_asistencia on public.asistencias;
create trigger al_crear_asistencia
  after insert on public.asistencias
  for each row execute function public.matricular_desde_asistencia();

-- ---------------------------------------------------------------------------
-- 5. Funciones que llama la web
-- ---------------------------------------------------------------------------

-- ¿Qué pasa con este correo? LIBRE | SIN_CONFIRMAR | EXISTE | PENDIENTE
create or replace function public.estado_cuenta(p_email text)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when u.id is null then 'LIBRE'
    when p.pendiente then 'PENDIENTE'
    when u.email_confirmed_at is null then 'SIN_CONFIRMAR'
    else 'EXISTE'
  end
  from (select 1) x
  left join auth.users u on lower(u.email) = lower(trim(p_email))
  left join public.perfiles p on p.id = u.id;
$$;

-- Vincula el móvil del alumno que acaba de iniciar sesión. Acepta el móvil si coincide
-- el identificador nuevo O la huella antigua (así las cuentas de antes siguen funcionando).
create or replace function public.vincular_dispositivo(p_dispositivo_id text, p_huella text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v public.perfiles%rowtype;
begin
  select * into v from public.perfiles where id = auth.uid();
  if not found then
    return 'SIN_PERFIL';
  end if;
  if v.rol = 'profesor' then
    return 'PROFESOR';
  end if;
  if (v.dispositivo_id is null and v.dispositivo_hash is null)
     or v.dispositivo_id = p_dispositivo_id
     or v.dispositivo_hash = p_huella then
    update public.perfiles set dispositivo_id = p_dispositivo_id, dispositivo_hash = p_huella where id = v.id;
    return 'OK';
  end if;
  return 'OTRO_DISPOSITIVO';
end $$;

create or replace function public.desvincular_dispositivo(p_alumno uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.es_profesor() then
    raise exception 'SOLO_PROFESORES';
  end if;
  update public.perfiles set dispositivo_id = null, dispositivo_hash = null
  where id = p_alumno and rol = 'alumno';
end $$;

-- Alumnos con cuenta que no están en ninguna clase (de ningún profe): suelen ser los que tienen problemas.
create or replace function public.alumnos_sin_clase()
returns table (id uuid, nombre_completo text, email text, vinculado boolean, pendiente boolean, confirmado boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, p.nombre_completo, p.email,
         (p.dispositivo_id is not null or p.dispositivo_hash is not null),
         p.pendiente,
         (u.email_confirmed_at is not null)
  from public.perfiles p
  join auth.users u on u.id = p.id
  where public.es_profesor()
    and p.rol = 'alumno'
    and not exists (select 1 from public.matriculas m where m.alumno_id = p.id)
    and not exists (select 1 from public.asistencias a where a.alumno_id = p.id)
  order by p.nombre_completo;
$$;

-- El profe recupera la clave del QR de una clase suya (para reanudar un aula abierta).
create or replace function public.secreto_sesion(p_sesion uuid)
returns text language sql stable security definer set search_path = '' as $$
  select s.secret_totp
  from public.sesiones s
  join public.asignaturas a on a.id = s.asignatura_id
  where s.id = p_sesion and a.profesor_id = auth.uid();
$$;

-- El alumno escanea el QR: se comprueba en el servidor (la clave del QR nunca llega al móvil).
create or replace function public.registrar_asistencia(p_sesion uuid, p_fase text, p_t bigint, p_token text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_rol public.rol_usuario;
  s public.sesiones%rowtype;
  a public.asistencias%rowtype;
  v_ahora timestamptz := now();
begin
  if v_uid is null then
    raise exception 'NO_SESION';
  end if;
  select rol into v_rol from public.perfiles where id = v_uid;
  if v_rol is null then
    raise exception 'SIN_PERFIL';
  end if;
  if v_rol <> 'alumno' then
    raise exception 'NO_ALUMNO';
  end if;

  select * into s from public.sesiones where id = p_sesion;
  if not found or s.fase = 'CERRADA' then
    raise exception 'AULA_CERRADA';
  end if;
  if abs(extract(epoch from v_ahora) - p_t) > 20 then
    raise exception 'QR_CADUCADO';
  end if;
  if p_token is distinct from encode(extensions.hmac(p_sesion::text || '|' || p_fase || '|' || p_t::text, s.secret_totp, 'sha256'), 'hex') then
    raise exception 'QR_FALSO';
  end if;
  if p_fase <> s.fase::text then
    raise exception 'FASE_CAMBIADA';
  end if;

  select * into a from public.asistencias where sesion_id = p_sesion and alumno_id = v_uid;
  if found and a.manual then
    raise exception 'BLOQUEADO';
  end if;

  if p_fase = 'ENTRADA' then
    insert into public.asistencias (sesion_id, alumno_id, estado, hora_entrada)
    values (p_sesion, v_uid, 'PRESENTE', v_ahora)
    on conflict (sesion_id, alumno_id) do update set estado = 'PRESENTE', hora_entrada = v_ahora;
    return 'ENTRADA_OK';
  end if;

  insert into public.asistencias (sesion_id, alumno_id, estado, hora_salida)
  values (p_sesion, v_uid, 'RETRASO', v_ahora)
  on conflict (sesion_id, alumno_id) do update
    set hora_salida = v_ahora,
        estado = case when public.asistencias.hora_entrada is not null then public.asistencias.estado else 'RETRASO' end;
  return 'SALIDA_OK';
end $$;

-- Une una cuenta creada por un profe con la cuenta que el alumno ya tenía (solo la usa el servidor).
create or replace function public.fusionar_alumnos(p_origen uuid, p_destino uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  -- Asistencias en clases donde la cuenta de destino no tenía registro: se mueven tal cual
  update public.asistencias a set alumno_id = p_destino
  where a.alumno_id = p_origen
    and not exists (select 1 from public.asistencias b where b.sesion_id = a.sesion_id and b.alumno_id = p_destino);
  -- Clases donde ambas tenían registro: si la de destino era una falta automática, gana la del profe
  update public.asistencias d
  set estado = o.estado, hora_entrada = o.hora_entrada, hora_salida = o.hora_salida, manual = o.manual
  from public.asistencias o
  where o.alumno_id = p_origen and d.alumno_id = p_destino and d.sesion_id = o.sesion_id
    and d.estado = 'FALTA_INJUSTIFICADA' and not d.manual;
  insert into public.matriculas (asignatura_id, alumno_id)
  select asignatura_id, p_destino from public.matriculas where alumno_id = p_origen
  on conflict (asignatura_id, alumno_id) do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Permisos de las funciones
-- ---------------------------------------------------------------------------
revoke execute on function public.estado_cuenta(text) from public;
revoke execute on function public.vincular_dispositivo(text, text) from public;
revoke execute on function public.desvincular_dispositivo(uuid) from public;
revoke execute on function public.alumnos_sin_clase() from public;
revoke execute on function public.secreto_sesion(uuid) from public;
revoke execute on function public.registrar_asistencia(uuid, text, bigint, text) from public;
revoke execute on function public.fusionar_alumnos(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.generar_codigo_alta() from public, anon, authenticated;
revoke execute on function public.crear_perfil_desde_auth() from public, anon, authenticated;
revoke execute on function public.sincronizar_perfil_desde_auth() from public, anon, authenticated;
revoke execute on function public.matricular_desde_asistencia() from public, anon, authenticated;

grant execute on function public.estado_cuenta(text) to anon, authenticated;
grant execute on function public.hora_servidor() to anon, authenticated;
grant execute on function public.es_profesor() to authenticated;
grant execute on function public.vincular_dispositivo(text, text) to authenticated;
grant execute on function public.desvincular_dispositivo(uuid) to authenticated;
grant execute on function public.alumnos_sin_clase() to authenticated;
grant execute on function public.secreto_sesion(uuid) to authenticated;
grant execute on function public.registrar_asistencia(uuid, text, bigint, text) to authenticated;
grant execute on function public.fusionar_alumnos(uuid, uuid) to service_role;
