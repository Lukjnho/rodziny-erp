-- Actualiza v_cocina_stock_pastas para reflejar ajustes manuales de stock.
-- - porciones_camara ahora incluye el ajuste acumulado de cámara
-- - se agrega porciones_ajuste_mostrador para que el Dashboard pueda
--   sumarlo al cálculo de mostrador
-- Drop+create porque cambian los tipos (bigint → numeric) por la suma con ajustes (numeric).
DROP VIEW IF EXISTS public.v_cocina_stock_pastas;

CREATE VIEW public.v_cocina_stock_pastas AS
SELECT
  p.id AS producto_id,
  p.nombre,
  p.codigo,
  p.local,
  p.minimo_produccion,
  COALESCE(
    (SELECT SUM(lp.porciones) FROM cocina_lotes_pasta lp
      WHERE lp.producto_id = p.id AND lp.local = p.local AND lp.ubicacion = 'camara_congelado'),
    0
  )::numeric
  + COALESCE(
    (SELECT SUM(a.delta) FROM cocina_ajustes_stock a
      WHERE a.producto_id = p.id AND a.local = p.local AND a.ubicacion = 'camara'),
    0
  )::numeric AS porciones_camara,
  COALESCE(
    (SELECT SUM(lp.porciones) FROM cocina_lotes_pasta lp
      WHERE lp.producto_id = p.id AND lp.local = p.local AND lp.ubicacion = 'freezer_produccion'),
    0
  )::numeric AS porciones_fresco,
  COALESCE(
    (SELECT SUM(t.porciones) FROM cocina_traspasos t
      WHERE t.producto_id = p.id AND t.local = p.local),
    0
  )::numeric AS porciones_traspasadas,
  COALESCE(
    (SELECT SUM(m.porciones) FROM cocina_merma m
      WHERE m.producto_id = p.id AND m.local = p.local),
    0
  )::numeric AS porciones_merma,
  COALESCE(
    (SELECT SUM(a.delta) FROM cocina_ajustes_stock a
      WHERE a.producto_id = p.id AND a.local = p.local AND a.ubicacion = 'mostrador'),
    0
  )::numeric AS porciones_ajuste_mostrador
FROM cocina_productos p
WHERE p.tipo = 'pasta' AND p.activo = true;
