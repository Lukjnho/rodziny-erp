-- Tabla de auditoría para el backfill de gastos.proveedor_id huérfanos.
-- Guarda el par (gasto_id, proveedor_id_anterior, proveedor_id_nuevo) por batch
-- para poder revertir si algún match resultó incorrecto.
--
-- Primer batch aplicado 2026-05-14 ('fase-a-2026-05-14'): 501 gastos vinculados
-- automáticamente vía buscar_proveedor_por_texto con score >= 80, excluyendo:
--   - "ICBC" (falso positivo del RPC por aliases compuestos)
--   - Rodziny Pastas / Rodziny Sin Gluten (decisión pendiente)
--
-- Rollback completo del batch:
--   UPDATE gastos g SET proveedor_id = log.proveedor_id_anterior
--   FROM gastos_backfill_proveedor_id_log log
--   WHERE g.id = log.gasto_id AND log.batch_label = '<batch>';

CREATE TABLE IF NOT EXISTS public.gastos_backfill_proveedor_id_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gasto_id uuid NOT NULL REFERENCES public.gastos(id) ON DELETE CASCADE,
  proveedor_id_anterior uuid,
  proveedor_id_nuevo uuid NOT NULL,
  texto_gasto text,
  score int,
  match_label text,
  batch_label text NOT NULL,
  aplicado_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gastos_backfill_log_batch_idx
  ON public.gastos_backfill_proveedor_id_log(batch_label);
CREATE INDEX IF NOT EXISTS gastos_backfill_log_gasto_idx
  ON public.gastos_backfill_proveedor_id_log(gasto_id);

COMMENT ON TABLE public.gastos_backfill_proveedor_id_log IS
  'Auditoría de backfills de gastos.proveedor_id (vinculación retroactiva con proveedores). Permite rollback por batch_label.';
