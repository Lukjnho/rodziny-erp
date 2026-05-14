-- Cuando un cierre se "verifica" (= Lucas retira el efectivo del local y lo
-- lleva a la caja fuerte de su casa), se registra cuánto efectivo se llevó.
-- El default sugerido es: monto_contado - fondo de cambio para el próximo
-- turno (típicamente $12.000). Editable por el usuario al verificar.

ALTER TABLE public.cierres_caja
  ADD COLUMN IF NOT EXISTS monto_llevado_caja_fuerte numeric;

ALTER TABLE public.cierres_caja
  ADD COLUMN IF NOT EXISTS nota_caja_fuerte text;

COMMENT ON COLUMN public.cierres_caja.monto_llevado_caja_fuerte IS
  'Efectivo retirado del local y depositado en la caja fuerte. Se llena al verificar el cierre. NULL = aún en caja chica del local.';

COMMENT ON COLUMN public.cierres_caja.nota_caja_fuerte IS
  'Nota opcional sobre el retiro (ej: monto extra dejado como cambio).';
