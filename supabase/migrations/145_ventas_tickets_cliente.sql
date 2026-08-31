-- ============================================================================
-- 145 — Cliente / número de llamador en el ticket
-- ============================================================================
-- En Vedia se entrega un llamador (el "beep") y el número que se le da al
-- cliente se escribe en el ticket. Ese número va impreso en la comanda: es
-- cómo la cocina sabe a quién llamar cuando el pedido está listo.
--
-- Es el mismo campo que Fudo llama `customerName` en su API, así que el
-- importador también lo puede llenar y quedan las dos puntas hablando de lo
-- mismo. Texto libre a propósito: en Vedia es un número, pero en Saavedra
-- puede ser un nombre.
-- ============================================================================

ALTER TABLE public.ventas_tickets
  ADD COLUMN IF NOT EXISTS cliente text;

COMMENT ON COLUMN public.ventas_tickets.cliente IS
  'Numero de llamador (Vedia) o nombre del cliente (Saavedra). Se imprime en la comanda. Equivale a Sale.customerName de Fudo.';
