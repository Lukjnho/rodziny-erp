-- Permitir que cocina_cierre_dia referencie recetas (salsas/postres viven en cocina_recetas,
-- no en cocina_productos). Las pastas siguen usando producto_id como antes.
ALTER TABLE public.cocina_cierre_dia
  ALTER COLUMN producto_id DROP NOT NULL;

ALTER TABLE public.cocina_cierre_dia
  ADD COLUMN IF NOT EXISTS receta_id uuid REFERENCES public.cocina_recetas(id) ON DELETE SET NULL;

-- Cada cierre tiene que apuntar a algo (producto o receta)
ALTER TABLE public.cocina_cierre_dia
  DROP CONSTRAINT IF EXISTS cocina_cierre_dia_target_check;
ALTER TABLE public.cocina_cierre_dia
  ADD CONSTRAINT cocina_cierre_dia_target_check
  CHECK (producto_id IS NOT NULL OR receta_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS cocina_cierre_dia_receta_idx
  ON public.cocina_cierre_dia (receta_id) WHERE receta_id IS NOT NULL;

-- Ampliar tipos válidos (mantener compatibilidad + agregar pasteleria/panaderia para futuro)
ALTER TABLE public.cocina_cierre_dia
  DROP CONSTRAINT IF EXISTS cocina_cierre_dia_tipo_check;
ALTER TABLE public.cocina_cierre_dia
  ADD CONSTRAINT cocina_cierre_dia_tipo_check
  CHECK (tipo = ANY (ARRAY['pasta'::text, 'salsa'::text, 'postre'::text, 'pasteleria'::text, 'panaderia'::text]));
