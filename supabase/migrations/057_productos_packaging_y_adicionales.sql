-- Fase 1.C del módulo Productos: vínculo de packaging y adicionales de
-- servicio con productos elaborados, por canal de venta.

-- ─── es_packaging para filtrar insumos ──────────────────────────────────────
-- Marca productos (insumos) que son packaging (bolsa de arranque, bandeja,
-- tapa, etiqueta, etc.). No cambia su costeo, solo permite filtrarlos en la
-- UI y sugerirlos al cargar packaging de un producto elaborado.
ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS es_packaging boolean NOT NULL DEFAULT false;

-- ─── Packaging de un producto elaborado, por canal ──────────────────────────
-- Ejemplo: un Sorrentino vendido como vianda lleva 1 caja empanada + 1 bandeja
-- + 1 tapa + 1 bolsa de arranque. El mismo Sorrentino congelado lleva 1 bolsa
-- zipper + 1 etiqueta. En plato (servicio en local) lleva solo la bolsa de
-- arranque.
CREATE TABLE IF NOT EXISTS public.cocina_productos_packaging (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cocina_producto_id uuid NOT NULL REFERENCES public.cocina_productos(id) ON DELETE CASCADE,
  insumo_id uuid NOT NULL REFERENCES public.productos(id) ON DELETE RESTRICT,
  cantidad numeric NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  canal text NOT NULL DEFAULT 'todos' CHECK (canal IN ('todos','plato','vianda','congelado')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cocina_producto_id, insumo_id, canal)
);

CREATE INDEX IF NOT EXISTS idx_cocina_productos_packaging_producto
  ON public.cocina_productos_packaging(cocina_producto_id);

COMMENT ON TABLE public.cocina_productos_packaging IS
  'Packaging asignado a un producto elaborado, opcionalmente por canal de venta. Apunta a productos (insumos) con su costo_unitario.';

-- ─── Adicionales de servicio, por canal ─────────────────────────────────────
-- Solo aplica a plato y vianda (el congelado no tiene servicio).
-- El origen puede ser:
--   - insumo_id (producto comprado): ej queso sardo, pan Vedia, servilleta
--   - elaborado_id (cocina_producto): ej pan Saavedra (producción propia),
--     aceite saborizado (subreceta)
-- CHECK garantiza que exactamente uno de los dos está poblado.
CREATE TABLE IF NOT EXISTS public.cocina_productos_adicionales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cocina_producto_id uuid NOT NULL REFERENCES public.cocina_productos(id) ON DELETE CASCADE,
  insumo_id uuid REFERENCES public.productos(id) ON DELETE RESTRICT,
  elaborado_id uuid REFERENCES public.cocina_productos(id) ON DELETE RESTRICT,
  cantidad numeric NOT NULL CHECK (cantidad > 0),
  unidad text NOT NULL,
  canal text NOT NULL DEFAULT 'plato' CHECK (canal IN ('todos','plato','vianda')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT adicional_un_origen CHECK (
    (insumo_id IS NOT NULL)::int + (elaborado_id IS NOT NULL)::int = 1
  )
);

CREATE INDEX IF NOT EXISTS idx_cocina_productos_adicionales_producto
  ON public.cocina_productos_adicionales(cocina_producto_id);

COMMENT ON TABLE public.cocina_productos_adicionales IS
  'Adicionales del servicio asignados a un producto elaborado, por canal. Origen puede ser insumo (productos) o elaborado (cocina_productos).';

-- ─── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.cocina_productos_packaging   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cocina_productos_adicionales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sel_packaging ON public.cocina_productos_packaging;
CREATE POLICY sel_packaging ON public.cocina_productos_packaging FOR SELECT
USING (
  EXISTS (SELECT 1 FROM public.perfiles
          WHERE user_id = auth.uid()
            AND (es_admin OR puede_ver_productos OR puede_ver_cocina))
);

DROP POLICY IF EXISTS mod_packaging ON public.cocina_productos_packaging;
CREATE POLICY mod_packaging ON public.cocina_productos_packaging FOR ALL
USING (
  EXISTS (SELECT 1 FROM public.perfiles
          WHERE user_id = auth.uid()
            AND (es_admin OR puede_ver_productos))
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.perfiles
          WHERE user_id = auth.uid()
            AND (es_admin OR puede_ver_productos))
);

DROP POLICY IF EXISTS sel_adicionales ON public.cocina_productos_adicionales;
CREATE POLICY sel_adicionales ON public.cocina_productos_adicionales FOR SELECT
USING (
  EXISTS (SELECT 1 FROM public.perfiles
          WHERE user_id = auth.uid()
            AND (es_admin OR puede_ver_productos OR puede_ver_cocina))
);

DROP POLICY IF EXISTS mod_adicionales ON public.cocina_productos_adicionales;
CREATE POLICY mod_adicionales ON public.cocina_productos_adicionales FOR ALL
USING (
  EXISTS (SELECT 1 FROM public.perfiles
          WHERE user_id = auth.uid()
            AND (es_admin OR puede_ver_productos))
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.perfiles
          WHERE user_id = auth.uid()
            AND (es_admin OR puede_ver_productos))
);

-- Marca pre-poblada: productos con nombres conocidos de packaging
-- (heurística suave; el usuario puede tildar/destildar manualmente después)
UPDATE public.productos
SET es_packaging = true
WHERE activo = true
  AND es_packaging = false
  AND (
    nombre ILIKE '%bandeja%aluminio%' OR
    nombre ILIKE '%tapa%aluminio%' OR
    nombre ILIKE '%bolsa%arranque%' OR
    nombre ILIKE '%bolsa%emblocada%' OR
    nombre ILIKE '%bolsa%zipper%' OR
    nombre ILIKE '%caja%empanada%' OR
    nombre ILIKE '%etiqueta%vinilo%' OR
    nombre ILIKE '%film%' OR
    nombre ILIKE '%film%cocina%' OR
    nombre ILIKE '%termoencogible%' OR
    nombre ILIKE '%bolsa%pan%'
  );
