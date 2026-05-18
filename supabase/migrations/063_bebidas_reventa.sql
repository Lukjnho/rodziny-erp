-- Bebidas de reventa: productos que se compran terminados y se venden sin
-- transformar (latas, agua, cerveza, vino). NO tienen receta; su costo = el
-- costo_unitario del insumo comprado (se actualiza solo con compras/OCR).
-- Las jarras de limonada/naranja NO son reventa: son elaboradas (tienen receta).

-- 1) Permitir tipo 'bebida'
ALTER TABLE public.cocina_productos DROP CONSTRAINT IF EXISTS cocina_productos_tipo_check;
ALTER TABLE public.cocina_productos
  ADD CONSTRAINT cocina_productos_tipo_check
  CHECK (tipo = ANY (ARRAY['pasta','salsa','postre','relleno','masa','panificado','bebida']));

-- 2) Link a insumo de reventa (productos comprados). Cuando un producto no
--    tiene receta pero sí insumo_reventa_id, su costo = costo_unitario de ese
--    insumo. ON DELETE SET NULL para no romper el producto si se borra el insumo.
ALTER TABLE public.cocina_productos
  ADD COLUMN IF NOT EXISTS insumo_reventa_id uuid
  REFERENCES public.productos(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.cocina_productos.insumo_reventa_id IS
  'Reventa: insumo comprado del que se revende este producto. Costo = productos.costo_unitario. Solo aplica si receta_id IS NULL.';

-- 3) Config de costeo para la categoría 'bebida' (markup objetivo 150%).
--    Editable después desde el tab Configuración. No pisa si ya existe.
INSERT INTO public.productos_costeo_config
  (categoria, markup_objetivo, margen_min, margen_max, redondeo, descripcion)
VALUES
  ('bebida', 1.5, 0.30, 0.70, 100, 'Bebidas de reventa (latas, agua, cerveza, vino)')
ON CONFLICT (categoria) DO NOTHING;
