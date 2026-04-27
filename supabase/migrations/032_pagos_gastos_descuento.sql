-- 032_pagos_gastos_descuento.sql
-- Permitir registrar un descuento aplicado por el proveedor al momento del pago.
-- gastos.importe_total queda intacto (= monto facturado original);
-- pagos_gastos.descuento + pagos_gastos.monto representan el efectivo desembolsado.

ALTER TABLE pagos_gastos
  ADD COLUMN IF NOT EXISTS descuento numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN pagos_gastos.descuento IS
  'Descuento aplicado por el proveedor al momento del pago. monto = importe_total - descuento.';
