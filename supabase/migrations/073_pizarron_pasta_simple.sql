-- 073: agrega tipo 'pasta_simple' al pizarrón
--
-- Las tagliatelles, spaghetti, fettuccine y demás pastas sin relleno no encajan en
-- el modelo actual (relleno/masa/salsa/postre/pasteleria/panaderia). Se planifican
-- por cantidad de porciones (no por receta) porque se hacen en el momento con la
-- masa disponible.
--
-- Idempotente: drop + recreate del check constraint.

ALTER TABLE cocina_pizarron_items
  DROP CONSTRAINT IF EXISTS cocina_pizarron_items_tipo_check;

ALTER TABLE cocina_pizarron_items
  ADD CONSTRAINT cocina_pizarron_items_tipo_check
  CHECK (tipo IN ('relleno','masa','salsa','postre','pasteleria','panaderia','pasta_simple'));
