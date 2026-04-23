-- 014_cocina_recetas_tipo_check.sql
-- El CHECK constraint original de cocina_recetas.tipo no incluía los valores
-- 'panaderia' y 'pasteleria' que se agregaron después para el flujo de
-- Rodziny Sin Gluten (Saavedra). Esto hacía imposible guardar recetas de
-- tipo panadería/pastelería con el error:
--   new row for relation "cocina_recetas" violates check constraint
--   "cocina_recetas_tipo_check"

alter table cocina_recetas
  drop constraint if exists cocina_recetas_tipo_check;

alter table cocina_recetas
  add constraint cocina_recetas_tipo_check
  check (tipo in (
    'relleno',
    'masa',
    'salsa',
    'postre',
    'pasteleria',
    'panaderia',
    'subreceta',
    'otro'
  ));

notify pgrst, 'reload schema';
