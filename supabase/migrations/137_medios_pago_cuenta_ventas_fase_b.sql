-- 137_medios_pago_cuenta_ventas_fase_b.sql
--
-- FASE B: cerrar el circuito — la cuenta también del lado de las ventas.
--
-- QUÉ HACE (en criollo):
--   La Fase A dejó marcado de qué cuenta SALE la plata (compras, sueldos, gastos).
--   Faltaba la otra punta: en qué cuenta CAE la plata que entra por ventas.
--   Con las dos puestas, cada peso se puede seguir de principio a fin.
--
-- REGLA DE NEGOCIO (Lucas, 30-ago-2026):
--   En ventas TODO lo que no es efectivo cae en Mercado Pago — QR, débito,
--   crédito y transferencia por igual. Se siguen guardando como medios
--   separados a propósito: sirve para el arqueo de caja y para el orden.
--   El efectivo no va a ningún banco: queda en la caja física.
--
-- QUÉ *NO* HACE:
--   No toca las funciones conciliar_adelantos / conciliar_dividendos. Hoy
--   deducen el banco leyendo el texto del medio de pago y FUNCIONAN, porque
--   ese texto sigue intacto. Cambiarlas ahora sería tocar lógica que anda sin
--   necesidad. Se migran en la Fase D, cuando el texto viejo se apague.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. La lista ahora sabe las dos direcciones
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE public.medios_pago ADD COLUMN IF NOT EXISTS cuenta_default_venta TEXT;

COMMENT ON COLUMN public.medios_pago.cuenta_default_venta IS
  'Dónde CAE la plata cuando el cliente paga con este medio. En Rodziny: todo lo bancarizado va a mercadopago; el efectivo va a "caja" (no es un banco, es el arqueo físico).';

UPDATE public.medios_pago SET cuenta_default_venta = 'caja'        WHERE codigo = 'efectivo';
UPDATE public.medios_pago SET cuenta_default_venta = 'mercadopago' WHERE codigo IN ('qr','debito','credito','transferencia','mp_lucas');
-- cheque, mixto y sin_especificar quedan en NULL a propósito:
--   cheque no se usa para cobrar, mixto es un ticket con varios pagos (el
--   detalle real está en ventas_pagos) y sin_especificar es justamente eso.

-- ═══════════════════════════════════════════════════════════════════════
-- 2. La cuenta en cada venta
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE public.ventas_tickets ADD COLUMN IF NOT EXISTS cuenta TEXT;
ALTER TABLE public.ventas_pagos   ADD COLUMN IF NOT EXISTS cuenta TEXT;

COMMENT ON COLUMN public.ventas_pagos.cuenta IS
  'Dónde cayó la plata: mercadopago | caja. Mismos nombres que movimientos_bancarios.cuenta, más "caja" para el efectivo.';

UPDATE public.ventas_tickets t
   SET cuenta = m.cuenta_default_venta
  FROM public.medios_pago m
 WHERE m.id = t.medio_pago_id
   AND t.cuenta IS NULL
   AND m.cuenta_default_venta IS NOT NULL;

UPDATE public.ventas_pagos p
   SET cuenta = m.cuenta_default_venta
  FROM public.medios_pago m
 WHERE m.id = p.medio_pago_id
   AND p.cuenta IS NULL
   AND m.cuenta_default_venta IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ventas_pagos_cuenta   ON public.ventas_pagos(cuenta);
CREATE INDEX IF NOT EXISTS idx_ventas_tickets_cuenta ON public.ventas_tickets(cuenta);
