-- Horario por día de la semana: cada asignatura puede tener una hora distinta cada día.
-- Usa la tabla "horarios" (ya existía pero no se usaba): una fila por día de clase.
-- dia_semana: 1 = lunes ... 7 = domingo. La hora de fin es opcional.
-- asignaturas.dias_semana y asignaturas.horario se siguen rellenando como resumen.

alter table public.horarios alter column hora_fin drop not null;
alter table public.horarios alter column aula drop not null;
alter table public.horarios add constraint horarios_asignatura_dia_key unique (asignatura_id, dia_semana);

-- Copiamos el horario que ya tenía cada asignatura: la primera hora del texto es el inicio
-- y la segunda (si la hay) el fin. Ej.: "8:00 10:00" -> 08:00-10:00; "10:15" -> 10:15.
insert into public.horarios (asignatura_id, dia_semana, hora_inicio, hora_fin, aula)
select a.id,
       case when d = 0 then 7 else d end,
       (regexp_match(a.horario, '(\d{1,2}:\d{2})'))[1]::time,
       (regexp_match(a.horario, '\d{1,2}:\d{2}\D+(\d{1,2}:\d{2})'))[1]::time,
       a.aula
from public.asignaturas a
cross join lateral unnest(coalesce(a.dias_semana, '{}')) as d
where a.horario ~ '\d{1,2}:\d{2}'
on conflict (asignatura_id, dia_semana) do nothing;
