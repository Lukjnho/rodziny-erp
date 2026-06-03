-- Sueldos pagados por transferencia (MP o Galicia) deben llevar comprobante + N° op
-- y poder conciliarse contra el extracto, igual que cualquier egreso bancarizado.
-- Columnas aditivas (nullables) — no rompen el flujo existente (efectivo/transferencia).
ALTER TABLE pagos_sueldos
  ADD COLUMN IF NOT EXISTS cuenta text,                    -- 'mercadopago' | 'galicia' (solo transferencia)
  ADD COLUMN IF NOT EXISTS numero_operacion text,
  ADD COLUMN IF NOT EXISTS comprobante_pago_path text,
  ADD COLUMN IF NOT EXISTS conciliado_movimiento_id uuid;

CREATE INDEX IF NOT EXISTS idx_pagos_sueldos_conciliado
  ON pagos_sueldos (conciliado_movimiento_id)
  WHERE conciliado_movimiento_id IS NOT NULL;
