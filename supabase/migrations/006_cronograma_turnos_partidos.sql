-- 006: cronograma con turnos partidos
-- Algunos empleados tienen jornada partida (ej: 11-15 y 20-00).
-- Guardamos el detalle en jsonb y mantenemos hora_entrada/hora_salida como
-- "primera entrada" y "última salida" del día para que los lectores legacy
-- (AsistenciaTab, FicharPage) sigan funcionando sobre el span del día.

alter table cronograma
  add column if not exists turnos jsonb not null default '[]'::jsonb;

-- Backfill: para las filas existentes, armar el array con el único turno
-- legacy si tienen hora_entrada/hora_salida.
update cronograma
set turnos = jsonb_build_array(
  jsonb_build_object('entrada', to_char(hora_entrada, 'HH24:MI'),
                     'salida',  to_char(hora_salida,  'HH24:MI'))
)
where turnos = '[]'::jsonb
  and hora_entrada is not null
  and hora_salida  is not null
  and es_franco = false;

notify pgrst, 'reload schema';
