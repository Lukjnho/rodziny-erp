-- 076: soporte para costear bebidas por ml/oz cuando se compran en "unidad".
--
-- Caso: Campari se compra como 1 botella (unidad), pero los tragos lo usan en oz.
-- Las copas de vino son el MISMO insumo que la botella, en otro formato (150 ml).
--
-- Se agregan 2 columnas opcionales (ambas NULL por defecto, no rompen nada):
--   - productos.contenido_ml: cuánto líquido tiene 1 unidad del insumo (750 botella,
--     354 lata, etc). Solo aplica si la unidad de compra es 'unid'.
--   - cocina_productos.ml_por_venta: para bebidas reventa que se venden en formato
--     copa/shot. NULL = vende la unidad entera (Pepsi lata). 150 = "Copa Malbec".
--
-- El motor de costeo usa contenido_ml para puentear unid <-> ml/oz en recetas.
-- El costeo de bebidas reventa usa ml_por_venta para descontar fracción de unidad.

ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS contenido_ml numeric NULL;

COMMENT ON COLUMN productos.contenido_ml IS
  'Contenido líquido por unidad (ej: 750 botella, 354 lata). Solo aplica si la unidad de compra es "unid". Permite costear recetas en ml/oz.';

ALTER TABLE cocina_productos
  ADD COLUMN IF NOT EXISTS ml_por_venta numeric NULL;

COMMENT ON COLUMN cocina_productos.ml_por_venta IS
  'Para bebidas reventa que se venden por porción (copa/shot). NULL = vende la unidad entera. Se costea como (costo_unitario / contenido_ml) * ml_por_venta.';
