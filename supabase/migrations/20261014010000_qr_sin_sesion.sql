-- QR aún más corto: ya no lleva el identificador de la clase. El servidor lo averigua solo, buscando
-- qué clase reciente tiene la clave que produce esa firma (cada clase tiene una clave distinta).
-- Así la dirección del QR puede ir en minúsculas (para que la cámara normal del móvil la abra como
-- enlace) sin que el QR crezca. La comprobación final la hace registrar_asistencia, como siempre.
create or replace function public.registrar_asistencia_qr(p_fase text, p_t bigint, p_token text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_sesion uuid;
begin
  if auth.uid() is null then
    raise exception 'NO_SESION';
  end if;
  if abs(extract(epoch from now()) - p_t) > 45 then
    raise exception 'QR_CADUCADO';
  end if;
  if p_token is null or length(p_token) < 16 or p_fase not in ('ENTRADA', 'SALIDA') then
    raise exception 'QR_FALSO';
  end if;

  -- Clases abiertas o abiertas en los últimos días (así, si ya está cerrada, el aviso es "aula cerrada")
  select s.id into v_sesion
  from public.sesiones s
  where (s.fase <> 'CERRADA' or s.hora_apertura > now() - interval '2 days')
    and lower(p_token) = left(encode(extensions.hmac(s.id::text || '|' || p_fase || '|' || p_t::text, s.secret_totp, 'sha256'), 'hex'), length(p_token))
  limit 1;

  if v_sesion is null then
    raise exception 'QR_FALSO';
  end if;
  return public.registrar_asistencia(v_sesion, p_fase, p_t, p_token);
end $$;

revoke execute on function public.registrar_asistencia_qr(text, bigint, text) from public, anon;
grant execute on function public.registrar_asistencia_qr(text, bigint, text) to authenticated;
