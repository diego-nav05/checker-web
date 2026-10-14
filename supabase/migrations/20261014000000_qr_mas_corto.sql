-- QR más fácil de leer: el QR nuevo lleva solo los primeros 16 caracteres de la firma (64 bits),
-- en vez de los 64. Así tiene muchos menos cuadraditos y se lee mejor desde lejos.
-- Adivinar 64 bits en los 20 segundos que vale cada código es imposible, así que sigue siendo seguro.
-- Se sigue aceptando la firma completa, para que los QR de la versión anterior funcionen igual.
create or replace function public.registrar_asistencia(p_sesion uuid, p_fase text, p_t bigint, p_token text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_rol public.rol_usuario;
  s public.sesiones%rowtype;
  a public.asistencias%rowtype;
  v_ahora timestamptz := now();
  v_firma text;
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
  v_firma := encode(extensions.hmac(p_sesion::text || '|' || p_fase || '|' || p_t::text, s.secret_totp, 'sha256'), 'hex');
  if p_token is null or length(p_token) < 16 or lower(p_token) <> left(v_firma, length(p_token)) then
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
