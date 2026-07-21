-- 133: permitir local='bienal' en cierres_caja
-- Los 2 stands de la Bienal 2026 se cargan como un local aparte "bienal"
-- (cada stand en su caja). La constraint previa solo aceptaba vedia/saavedra.
-- Idempotente: se puede correr varias veces sin efecto adverso.

ALTER TABLE public.cierres_caja
  DROP CONSTRAINT IF EXISTS cierres_caja_local_check;

ALTER TABLE public.cierres_caja
  ADD CONSTRAINT cierres_caja_local_check
  CHECK (local = ANY (ARRAY['vedia'::text, 'saavedra'::text, 'bienal'::text]));
