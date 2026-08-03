-- 135 — Normaliza categorías y unidades de `productos` (pestaña Gastos-Compras > Stock)
--
-- Problema detectado al auditar la pestaña Stock (03-ago-2026):
--
--   1) La misma categoría estaba escrita de dos formas, una por local:
--        "Bebidas para venta"     → 62 productos (todos vedia)
--        "Bebidas para la venta"  → 20 productos (todos saavedra)
--      Como la grilla filtra por local, la duplicación no se ve, pero cualquier
--      vista consolidada (valor de inventario por rubro, CMV, comparativo entre
--      locales) parte el mismo rubro en dos.
--
--   2) Las unidades convivían en dos vocabularios:
--        "unid." (197) vs "unidad" (22)   |   "L" (27) vs "litro" (3)
--      El origen era el modal de alta de producto, que guardaba "unidad"/"litro"
--      mientras el resto del sistema usa "unid."/"L" (ya corregido en el código).
--      El motor de costeo normaliza ambas formas, así que esto es cosmético
--      aguas abajo, pero ensucia la grilla y los reportes.
--
-- Criterio: gana la forma mayoritaria ("Bebidas para venta", "unid.", "L").
-- Idempotente: sólo toca las filas que todavía tienen la forma vieja.

begin;

-- ── 1. Categoría unificada ────────────────────────────────────────────────
update productos
set categoria = 'Bebidas para venta',
    updated_at = now()
where categoria = 'Bebidas para la venta';

-- ── 2. Unidades canónicas en productos ────────────────────────────────────
update productos
set unidad = 'unid.',
    updated_at = now()
where unidad in ('unidad', 'unid', 'u', 'unidades');

update productos
set unidad = 'L',
    updated_at = now()
where unidad in ('litro', 'litros', 'lt', 'lts', 'l');

-- ── 3. Mismo criterio en el historial de movimientos ──────────────────────
-- `movimientos_stock.unidad` es una etiqueta congelada al momento del
-- movimiento (no participa de ningún cálculo, sólo se muestra), así que
-- normalizarla no altera cantidades ni saldos.
update movimientos_stock
set unidad = 'unid.'
where unidad in ('unidad', 'unid', 'u', 'unidades');

update movimientos_stock
set unidad = 'L'
where unidad in ('litro', 'litros', 'lt', 'lts', 'l');

commit;
