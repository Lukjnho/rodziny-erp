-- Fase 2.B del módulo Productos: producto ancla / estratégico.
-- Un producto marcado como ancla aparece en la matriz de Menu Engineering pero
-- NO recibe sugerencias automáticas de cambio de precio. Ejemplo: Ragú Roast
-- Beef de Vedia (top de ventas, identidad de la marca, no se reformula sin
-- análisis estratégico).
ALTER TABLE public.cocina_productos
  ADD COLUMN IF NOT EXISTS es_ancla boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.cocina_productos.es_ancla IS
  'Producto ancla / estratégico. Se muestra en Menu Engineering pero las sugerencias automáticas de precio lo dejan estable.';
