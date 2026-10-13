-- Copia de la estructura de la base de datos tal y como estaba el 13/10/2026
-- (antes de las mejoras de cuentas y seguridad). Sirve para montar desde cero
-- un proyecto de pruebas idéntico al real. NO volver a ejecutar en producción.

create type public.rol_usuario as enum ('profesor', 'alumno');
create type public.fase_sesion as enum ('ENTRADA', 'SALIDA', 'CERRADA');
create type public.estado_asistencia as enum ('PRESENTE', 'RETRASO', 'FALTA_JUSTIFICADA', 'FALTA_INJUSTIFICADA', 'SE_FUE_A_MITAD');

create table public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre_completo text not null,
  email text not null unique,
  rol public.rol_usuario not null default 'alumno',
  dispositivo_hash text
);

create table public.asignaturas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  codigo text unique,
  profesor_id uuid references public.perfiles(id),
  aula text,
  horario text,
  dias_semana integer[] default '{}'::integer[]
);

create table public.horarios (
  id uuid primary key default gen_random_uuid(),
  asignatura_id uuid not null references public.asignaturas(id) on delete cascade,
  dia_semana smallint not null check (dia_semana >= 1 and dia_semana <= 7),
  hora_inicio time not null,
  hora_fin time not null,
  aula text not null
);

create table public.matriculas (
  id uuid primary key default gen_random_uuid(),
  asignatura_id uuid not null references public.asignaturas(id) on delete cascade,
  alumno_id uuid not null references public.perfiles(id) on delete cascade,
  unique (asignatura_id, alumno_id)
);

create table public.sesiones (
  id uuid primary key default gen_random_uuid(),
  asignatura_id uuid references public.asignaturas(id),
  fecha date not null default current_date,
  fase public.fase_sesion not null default 'ENTRADA',
  secret_totp text not null,
  hora_apertura timestamptz not null default now(),
  hora_cierre timestamptz,
  pin_profesor text
);

create table public.asistencias (
  id uuid primary key default gen_random_uuid(),
  sesion_id uuid not null references public.sesiones(id) on delete cascade,
  alumno_id uuid not null references auth.users(id) on delete cascade,
  estado public.estado_asistencia not null default 'FALTA_INJUSTIFICADA',
  hora_entrada timestamptz,
  hora_salida timestamptz,
  manual boolean not null default false,
  unique (sesion_id, alumno_id)
);

-- En producción, RLS estaba apagado en estas 4 tablas (aunque las políticas existían)
alter table public.perfiles disable row level security;
alter table public.asignaturas disable row level security;
alter table public.sesiones disable row level security;
alter table public.asistencias disable row level security;
alter table public.horarios enable row level security;
alter table public.matriculas enable row level security;

create policy "Alumnos leen solo su asistencia" on public.asistencias for select to authenticated
  using (alumno_id = auth.uid());
create policy "Profesores gestionan asistencias de sus clases" on public.asistencias for all to authenticated
  using (exists (select 1 from public.sesiones s join public.asignaturas a on a.id = s.asignatura_id
                 where s.id = asistencias.sesion_id and a.profesor_id = auth.uid()));
create policy "Lectura de sesiones" on public.sesiones for select to authenticated
  using (exists (select 1 from public.matriculas m where m.asignatura_id = sesiones.asignatura_id and m.alumno_id = auth.uid())
         or exists (select 1 from public.asignaturas a where a.id = sesiones.asignatura_id and a.profesor_id = auth.uid()));
create policy "Profesores gestionan sesiones" on public.sesiones for all to authenticated
  using (exists (select 1 from public.asignaturas a where a.id = sesiones.asignatura_id and a.profesor_id = auth.uid()));
create policy "Lectura de asignaturas" on public.asignaturas for select to authenticated using (true);
create policy "Profesores gestionan sus asignaturas" on public.asignaturas for all to authenticated
  using (profesor_id = auth.uid());
create policy "Lectura de matrículas" on public.matriculas for select to authenticated
  using (alumno_id = auth.uid() or exists (select 1 from public.asignaturas a where a.id = matriculas.asignatura_id and a.profesor_id = auth.uid()));
create policy "Profesores gestionan matrículas" on public.matriculas for all to authenticated
  using (exists (select 1 from public.asignaturas a where a.id = matriculas.asignatura_id and a.profesor_id = auth.uid()));
create policy "Lectura de horarios" on public.horarios for select to authenticated using (true);
create policy "Profesores editan horarios de sus asignaturas" on public.horarios for all to authenticated
  using (exists (select 1 from public.asignaturas a where a.id = horarios.asignatura_id and a.profesor_id = auth.uid()));
create policy "Edición de propio perfil" on public.perfiles for update to authenticated using (auth.uid() = id);
create policy "Lectura de perfiles autenticados" on public.perfiles for select to authenticated using (true);

alter publication supabase_realtime add table public.sesiones, public.asistencias;
