-- Unificar el criterio de "es subreceta". Había dos marcas desalineadas:
-- el flag `es_subreceta` (estaba true solo en las 2 "Pomodoro Base") y el
-- `tipo='subreceta'` (62 recetas). De acá en más manda el flag `es_subreceta`.
--
-- Solo SETEA true (nunca false): no toca las que ya estaban en true (Pomodoro
-- Base es tipo='salsa' pero subreceta) ni desmarca nada. Reversible y aditivo.
--
-- Efecto: las subrecetas se filtran de las listas de "a producir"
-- (StockProduccionSection) — correcto: una subreceta no es objetivo de
-- producción standalone, se produce dentro de la receta que la usa.

UPDATE public.cocina_recetas
SET es_subreceta = true
WHERE tipo = 'subreceta'
  AND es_subreceta IS DISTINCT FROM true;
