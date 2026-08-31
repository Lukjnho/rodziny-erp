-- ============================================================================
-- 144 — Vínculo exacto entre el ticket y el turno de caja
-- ============================================================================
-- El arqueo del POS necesita saber qué tickets pertenecen a ESE turno. Sin esto
-- habría que deducirlo por horario, y el turno noche cruza la medianoche (20 a
-- 01h en Vedia), así que la deducción falla justo cuando más importa.
--
-- Solo lo llena el POS. Los tickets importados de Fudo lo dejan en NULL: para
-- esos el control sigue siendo el de siempre (Cierre de Caja contra el arqueo
-- de Fudo). ON DELETE SET NULL a propósito: si alguien borra un cierre, se
-- pierde el agrupamiento pero NUNCA la venta.
-- ============================================================================

ALTER TABLE public.ventas_tickets
  ADD COLUMN IF NOT EXISTS cierre_caja_id uuid
    REFERENCES public.cierres_caja(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ventas_tickets_cierre_caja
  ON public.ventas_tickets (cierre_caja_id);

COMMENT ON COLUMN public.ventas_tickets.cierre_caja_id IS
  'Turno de caja en el que se cobro este ticket. Lo llena solo el POS propio; los tickets de Fudo quedan en NULL.';
