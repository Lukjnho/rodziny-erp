-- 094_pagos_gastos_programado.sql
-- Plan de pagos: marca las cuotas que todavia no se debitaron (ej: echeq a 30/60 dias).
--   programado=true  => pago agendado a futuro, la plata aun no salio (no cuenta para
--                       el "pagado real" del gasto; el gasto queda Parcial)
--   programado=false => pago ejecutado/confirmado (transferencia hecha o echeq debitado)
-- El flujo de caja igual imputa cada cuota por su fecha_pago en el mes correspondiente.
ALTER TABLE pagos_gastos
  ADD COLUMN IF NOT EXISTS programado boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN pagos_gastos.programado IS
  'true = cuota agendada a futuro (echeq sin debitar); false = pago ejecutado. El flujo de caja igual la cuenta por fecha_pago en su mes.';
