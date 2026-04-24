-- 025_traslado_cajones_en_traspasos.sql
-- Corrección del diseño anterior (024): la cantidad de porciones por cajón no
-- es fija por producto — la decide el cocinero al porcionar (generalmente 40-45
-- según el lote). Por eso la dato vive en el evento de traslado, no en el
-- catálogo de productos.
--
-- Cambios:
--   a) drop porciones_por_cajon de cocina_productos (no tenía datos cargados).
--   b) add cantidad_cajones a cocina_traspasos (nullable int): cuántos cajones
--      se movieron físicamente. Las porciones siguen siendo el número exacto.

alter table cocina_productos drop column if exists porciones_por_cajon;

alter table cocina_traspasos
  add column if not exists cantidad_cajones int
    check (cantidad_cajones is null or cantidad_cajones > 0);

comment on column cocina_traspasos.cantidad_cajones is
  'Cuántos cajones físicos se movieron al mostrador. Las porciones por cajón varían lote a lote, por eso se anota acá y no en el producto.';
