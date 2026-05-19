-- 066: Saavedra controla TODO el stock con el modelo overwrite ("último pesaje manda")
-- de cocina_lotes_produccion, incluida pasta y milanesa (no usa el flujo cámara/traspaso).
-- Se amplía el CHECK de categoria para admitir 'pasta' y 'milanesa'.

ALTER TABLE cocina_lotes_produccion
  DROP CONSTRAINT cocina_lotes_produccion_categoria_check;

ALTER TABLE cocina_lotes_produccion
  ADD CONSTRAINT cocina_lotes_produccion_categoria_check
  CHECK (categoria = ANY (ARRAY[
    'salsa'::text,
    'postre'::text,
    'pasteleria'::text,
    'panaderia'::text,
    'pasta'::text,
    'milanesa'::text,
    'prueba'::text
  ]));

-- La milanesa no es pasta: tipo propio en el catálogo para su sección de stock.
ALTER TABLE cocina_productos
  DROP CONSTRAINT cocina_productos_tipo_check;

ALTER TABLE cocina_productos
  ADD CONSTRAINT cocina_productos_tipo_check
  CHECK (tipo = ANY (ARRAY[
    'pasta'::text,
    'salsa'::text,
    'postre'::text,
    'relleno'::text,
    'masa'::text,
    'panificado'::text,
    'milanesa'::text,
    'bebida'::text
  ]));
