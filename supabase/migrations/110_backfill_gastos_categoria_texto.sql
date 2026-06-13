-- 110 — Backfill del espejo de texto categoria/subcategoria en gastos
--
-- Contexto: desde ~2026-05-11 el form manual de gastos guarda solo la FK
-- categoria_id y dejó vacías las columnas de texto legacy categoria/subcategoria.
-- La matriz de Egresos (resuelve por FK con fallback) y sobre todo el RPC
-- edr_resumen_gastos (agrupa por g.categoria TEXTO) quedaban sin estos gastos
-- → "Sin categoría" en la matriz y sub-conteo de CMV/gastos en el EdR.
--
-- Este backfill completa el texto desde categoria_id (rubro = padre, sub = la
-- subcategoría). Es aditivo y retro-compatible: no toca filas ya categorizadas.

UPDATE gastos g
SET categoria   = COALESCE(padre.nombre, c.nombre),
    subcategoria = c.nombre
FROM categorias_gasto c
LEFT JOIN categorias_gasto padre ON padre.id = c.parent_id
WHERE g.categoria_id = c.id
  AND g.categoria IS NULL;
