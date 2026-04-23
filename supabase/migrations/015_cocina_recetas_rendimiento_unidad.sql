-- 015_cocina_recetas_rendimiento_unidad.sql
-- El rendimiento de una receta se guardaba como `rendimiento_kg`, pero algunas
-- recetas rinden en litros (salsas, caldos) o en unidades (tortas enteras,
-- chipas por bollito, etc.). Agregamos una columna para diferenciar la unidad
-- y dejamos el valor histórico como 'kg' por default para no romper recetas
-- existentes.

alter table cocina_recetas
  add column if not exists rendimiento_unidad text not null default 'kg'
  check (rendimiento_unidad in ('kg','l','unidad'));

notify pgrst, 'reload schema';
