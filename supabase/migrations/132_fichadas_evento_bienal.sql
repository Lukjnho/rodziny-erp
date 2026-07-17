-- 132_fichadas_evento_bienal.sql
-- Fichaje para eventos puntuales (ej. Bienal) SIN contaminar las horas del local.
--
-- Modelo: la columna `evento` marca las fichadas hechas en un evento externo.
--   - Fichaje normal del local  → evento IS NULL  (comportamiento actual, no cambia)
--   - Fichaje en la Bienal       → evento = 'bienal', y `local` guarda el stand
--     ('vedia' / 'saavedra') donde se fichó.
--
-- Aditivo e idempotente: no toca ninguna fila existente (todas quedan evento=NULL),
-- no altera RLS (la policy anon de inserción sigue con WITH CHECK true).

ALTER TABLE public.fichadas
  ADD COLUMN IF NOT EXISTS evento text;

COMMENT ON COLUMN public.fichadas.evento IS
  'Evento externo al que pertenece la fichada (ej. ''bienal''). NULL = fichaje normal del local. '
  'Los reportes de horas del local deben filtrar evento IS NULL para no inflar Vedia/Saavedra.';

-- Índice parcial: las consultas de eventos son un subconjunto chico; acelera el
-- filtro por evento sin pesar sobre el fichaje normal (evento IS NULL no se indexa).
CREATE INDEX IF NOT EXISTS idx_fichadas_evento
  ON public.fichadas (evento, fecha)
  WHERE evento IS NOT NULL;
