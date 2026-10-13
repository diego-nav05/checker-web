-- Enciende la seguridad por filas (RLS) en todas las tablas.
-- IMPORTANTE: aplicar en producción SOLO cuando la web nueva ya esté publicada en Vercel,
-- porque la web antigua escribe directamente en tablas que a partir de aquí quedan protegidas.
--
-- Qué queda permitido:
--   · Alumnos: leer su propio perfil, sus asistencias, sus matrículas, las sesiones de sus asignaturas
--     y escribir su asistencia SOLO a través de registrar_asistencia() (que valida el QR).
--   · Profesores: leer perfiles, gestionar sus asignaturas, sesiones, matrículas y asistencias.
--   · Nadie puede cambiarse el rol ni tocar el móvil vinculado directamente.
--   · La clave del QR (secret_totp) ya no se puede leer desde la web; solo con secreto_sesion().

-- Perfiles: cada uno lee el suyo, los profes leen todos. Sin escritura directa.
drop policy if exists "Edición de propio perfil" on public.perfiles;
drop policy if exists "Lectura de perfiles autenticados" on public.perfiles;
create policy "Leer el propio perfil o ser profesor" on public.perfiles for select to authenticated
  using (id = auth.uid() or public.es_profesor());

-- Asignaturas: solo un profesor puede crearlas a su nombre
drop policy if exists "Profesores gestionan sus asignaturas" on public.asignaturas;
create policy "Profesores gestionan sus asignaturas" on public.asignaturas for all to authenticated
  using (profesor_id = auth.uid())
  with check (profesor_id = auth.uid() and public.es_profesor());

-- La clave del QR deja de ser legible por columnas
revoke select on public.sesiones from anon, authenticated;
grant select (id, asignatura_id, fecha, fase, hora_apertura, hora_cierre) on public.sesiones to authenticated;

-- Los visitantes sin sesión no tocan ninguna tabla
revoke all on public.perfiles, public.asignaturas, public.sesiones, public.asistencias,
              public.matriculas, public.horarios from anon;

alter table public.perfiles enable row level security;
alter table public.asignaturas enable row level security;
alter table public.sesiones enable row level security;
alter table public.asistencias enable row level security;
alter table public.matriculas enable row level security;
alter table public.horarios enable row level security;
