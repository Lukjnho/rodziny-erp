-- Agrega soporte para registrar pagos "Mercadopago Lucas" (PM 7 de Fudo) en el
-- cierre y vincularlos automáticamente a un dividendo de Lucas.
-- Estos cobros pasan por el POSnet personal de Lucas, no son ingreso del negocio.

ALTER TABLE public.cierres_caja
  ADD COLUMN IF NOT EXISTS fudo_mp_lucas numeric NOT NULL DEFAULT 0;

ALTER TABLE public.cierres_caja
  ADD COLUMN IF NOT EXISTS dividendo_id uuid
    REFERENCES public.dividendos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cierres_caja_dividendo_id
  ON public.cierres_caja(dividendo_id)
  WHERE dividendo_id IS NOT NULL;

COMMENT ON COLUMN public.cierres_caja.fudo_mp_lucas IS
  'Monto en pesos cobrado via "Mercadopago Lucas" (PM 7 de Fudo). No es ingreso del negocio; se registra como dividendo de Lucas.';

COMMENT ON COLUMN public.cierres_caja.dividendo_id IS
  'FK al dividendo auto-generado por fudo_mp_lucas. Permite idempotencia en ediciones del cierre.';
