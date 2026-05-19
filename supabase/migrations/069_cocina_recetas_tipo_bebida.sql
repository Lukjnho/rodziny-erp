-- 069: agregar 'bebida' al CHECK de cocina_recetas.tipo
--
-- Para bebidas elaboradas que sí son recetas (cocktails, jarras mezcladas).
-- Las bebidas de reventa puro (latas, agua, vino sin transformar) NO van como
-- receta — viven en cocina_productos con insumo_reventa_id (modelo del Menú).

ALTER TABLE cocina_recetas DROP CONSTRAINT IF EXISTS cocina_recetas_tipo_check;
ALTER TABLE cocina_recetas ADD CONSTRAINT cocina_recetas_tipo_check
  CHECK (tipo = ANY (ARRAY[
    'relleno'::text,
    'masa'::text,
    'salsa'::text,
    'pasta'::text,
    'postre'::text,
    'pasteleria'::text,
    'panaderia'::text,
    'subreceta'::text,
    'bebida'::text,
    'otro'::text
  ]));
