-- Número de arqueo de Fudo (id correlativo del cash-count, lo que aparece
-- impreso como "#5033" en el ticket de cierre). Se autocompleta al sincronizar
-- desde la API de Fudo; queda editable a mano por si el match es ambiguo.
-- Texto y no numeric porque puede tener varios separados por coma si en un
-- mismo turno hubo más de un arqueo abierto en la misma caja.

ALTER TABLE public.cierres_caja
  ADD COLUMN IF NOT EXISTS nro_arqueo_fudo text;

COMMENT ON COLUMN public.cierres_caja.nro_arqueo_fudo IS
  'ID del CashCount de Fudo (el "#" del ticket impreso). Puede ser uno solo o varios separados por coma si en el rango horario del turno hubo más de un arqueo en la misma caja.';
