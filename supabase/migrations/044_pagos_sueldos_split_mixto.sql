-- Permite pagos divididos (mitad efectivo + mitad transferencia) por liquidación.
-- pagos_sueldos: deja de ser único por (empleado, periodo) → ahora puede haber 2 filas.
-- liquidaciones_quincenales.medio_pago: agrega valor 'mixto'.

-- 1) Drop unique de pagos_sueldos para permitir múltiples filas por (empleado, periodo)
ALTER TABLE public.pagos_sueldos
  DROP CONSTRAINT IF EXISTS pagos_sueldos_empleado_id_periodo_key;

-- 2) Index de soporte (para queries por empleado+periodo, ya no único)
CREATE INDEX IF NOT EXISTS pagos_sueldos_empleado_periodo_idx
  ON public.pagos_sueldos (empleado_id, periodo);

-- 3) Cada fila de pagos_sueldos sigue siendo de un solo medio (efectivo o transferencia).
--    Si la liquidación se pagó mixto, se guardan 2 filas (una por medio).
--    El check de medio_pago en pagos_sueldos se mantiene tal cual.

-- 4) Liquidaciones: agregar 'mixto' al check
ALTER TABLE public.liquidaciones_quincenales
  DROP CONSTRAINT IF EXISTS liquidaciones_quincenales_medio_pago_check;
ALTER TABLE public.liquidaciones_quincenales
  ADD CONSTRAINT liquidaciones_quincenales_medio_pago_check
  CHECK (medio_pago IS NULL OR medio_pago = ANY (ARRAY['efectivo'::text, 'transferencia'::text, 'mixto'::text]));
