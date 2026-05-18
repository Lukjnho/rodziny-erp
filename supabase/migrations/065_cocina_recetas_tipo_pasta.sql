-- 065_cocina_recetas_tipo_pasta.sql
-- Agrega 'pasta' a los tipos válidos de cocina_recetas.
-- Una receta tipo 'pasta' es la pasta armada (masa + relleno como subrecetas)
-- usada para costear por porción. El CHECK previo no la permitía y el INSERT
-- del editor (RecetaEditorInline) fallaba al guardar una receta tipo Pasta.
-- Aplicada a prod vía MCP el 2026-05-18.

alter table cocina_recetas drop constraint if exists cocina_recetas_tipo_check;
alter table cocina_recetas add constraint cocina_recetas_tipo_check
  check (tipo = any (array[
    'relleno','masa','salsa','pasta','postre','pasteleria','panaderia','subreceta','otro'
  ]));
