-- Ajustes manuales de stock de pastas. Cada fila es un delta (positivo o negativo)
-- aplicado a una ubicación específica (cámara o mostrador) de un producto.
-- StockTab suma estos deltas al cálculo histórico para reflejar conteos físicos
-- u otros ajustes manuales sin contaminar los KPIs de merma ni los Análisis.
CREATE TABLE IF NOT EXISTS public.cocina_ajustes_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha date NOT NULL DEFAULT CURRENT_DATE,
  local text NOT NULL CHECK (local IN ('vedia', 'saavedra')),
  producto_id uuid NOT NULL REFERENCES public.cocina_productos(id) ON DELETE CASCADE,
  ubicacion text NOT NULL CHECK (ubicacion IN ('camara', 'mostrador')),
  delta numeric NOT NULL,
  motivo text,
  responsable text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cocina_ajustes_stock_producto_ubicacion_idx
  ON public.cocina_ajustes_stock (producto_id, ubicacion, local);

ALTER TABLE public.cocina_ajustes_stock ENABLE ROW LEVEL SECURITY;

-- RLS: usuarios autenticados pueden hacer todo (mismo patrón que el resto de cocina_*)
CREATE POLICY "cocina_ajustes_stock_select" ON public.cocina_ajustes_stock
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "cocina_ajustes_stock_insert" ON public.cocina_ajustes_stock
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "cocina_ajustes_stock_update" ON public.cocina_ajustes_stock
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "cocina_ajustes_stock_delete" ON public.cocina_ajustes_stock
  FOR DELETE TO authenticated USING (true);

COMMENT ON TABLE public.cocina_ajustes_stock IS
  'Ajustes manuales de stock de pastas (cámara o mostrador). Cada fila es un delta sumable al histórico.';
