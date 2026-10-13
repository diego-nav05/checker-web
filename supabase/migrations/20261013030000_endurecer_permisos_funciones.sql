-- Las funciones que solo usan usuarios con sesión dejan de poder llamarse sin iniciar sesión.
-- (Ya se protegían por dentro; esto cierra también la puerta de entrada.)
-- Siguen abiertas a visitantes: estado_cuenta (registro), hora_servidor y registrar_asistencia
-- (que responde NO_SESION para que la web pida volver a iniciar sesión).
revoke execute on function public.alumnos_sin_clase() from anon;
revoke execute on function public.desvincular_dispositivo(uuid) from anon;
revoke execute on function public.es_profesor() from anon;
revoke execute on function public.secreto_sesion(uuid) from anon;
revoke execute on function public.vincular_dispositivo(text, text) from anon;
-- Función interna de Supabase para activar RLS en tablas nuevas: no la necesita nadie desde la web
revoke execute on function public.rls_auto_enable() from anon, authenticated;
-- Ruta de búsqueda fija (recomendación de Supabase)
alter function public.hora_servidor() set search_path = '';
