-- 111 — Corregir filas fantasma de MercadoPago (crédito negativo → débito)
--
-- Contexto: una importación vieja de MercadoPago cargó egresos reales como
-- crédito negativo (debito=0, credito<0) en vez de débito positivo. Eso hacía
-- que esas salidas restaran mal de los ingresos en el Flujo de caja en lugar de
-- contarse como egresos. Afecta 64 filas: 1 de feb-2026 y 63 de mar-2026
-- (total -$16.922.268,78). Ninguna tiene gemelo ni gasto_id vinculado, así que
-- todas se CONVIERTEN (no se borran) y no rompen ninguna conciliación.

UPDATE movimientos_bancarios
SET debito = -credito, credito = 0
WHERE cuenta = 'mercadopago'
  AND coalesce(debito, 0) = 0
  AND coalesce(credito, 0) < 0;
