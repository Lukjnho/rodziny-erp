-- 035_cocina_conteo_stock.sql
-- Tabla que el DashboardTab y el banner de sugerencias del Plan ya consultan
-- para el conteo manual de stock de salsas/postres (productos no-pasta).
-- Nunca se habia creado: el codigo apuntaba a una tabla fantasma y el boton
-- "Cargar/Editar" del Dashboard tiraba error.

CREATE TABLE IF NOT EXISTS cocina_conteo_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  producto text NOT NULL,
  fecha date NOT NULL DEFAULT current_date,
  cantidad numeric NOT NULL CHECK (cantidad >= 0),
  local text NOT NULL CHECK (local IN ('vedia','saavedra')),
  responsable text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Lookup tipico: ultimo conteo por producto en un local.
CREATE INDEX IF NOT EXISTS cocina_conteo_stock_local_producto_idx
  ON cocina_conteo_stock (local, producto, created_at DESC);

ALTER TABLE cocina_conteo_stock ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cocina_conteo_stock_cocina_all ON cocina_conteo_stock;
CREATE POLICY cocina_conteo_stock_cocina_all ON cocina_conteo_stock
  FOR ALL TO authenticated
  USING (tiene_permiso('cocina'))
  WITH CHECK (tiene_permiso('cocina'));

COMMENT ON TABLE cocina_conteo_stock IS
  'Conteo manual diario de stock de salsas/postres (kg para salsa, unidades para postre). El Dashboard guarda el valor que ingresa el chef, mantiene historico y usa el ultimo por producto para calcular dias restantes y plan de produccion.';
