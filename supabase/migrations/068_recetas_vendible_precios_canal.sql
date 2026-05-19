-- 068: recetas vendibles + precio por canal por receta
--
-- El Menú deja de depender del linkeo manual producto↔receta. Una receta
-- marcada vendible=true se proyecta al Menú trayendo el costo ya calculado
-- en Costeo; el precio por canal pasa a vivir en la receta (no en el
-- producto). Decisión de Lucas 2026-05-19.
--
-- Backfill: NINGUNA receta arranca vendible (Lucas tildea a mano en Costeo).
-- Precios NO se pre-migran: los productos-pasta apuntan al relleno/masa, no
-- a la receta-pasta, así que sembrar precios ensuciaría rellenos/masas.
-- Bebidas (reventa, sin receta) siguen gestionándose por cocina_productos.

ALTER TABLE cocina_recetas
  ADD COLUMN IF NOT EXISTS vendible boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS cocina_recetas_precios_canal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receta_id uuid NOT NULL REFERENCES cocina_recetas(id) ON DELETE CASCADE,
  canal text NOT NULL CHECK (canal = ANY (ARRAY['plato'::text, 'vianda'::text, 'congelado'::text])),
  precio numeric NOT NULL CHECK (precio >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (receta_id, canal)
);

ALTER TABLE cocina_recetas_precios_canal ENABLE ROW LEVEL SECURITY;

-- RLS espejado de cocina_productos_precios_canal.
CREATE POLICY sel_precios_recetas_canal ON cocina_recetas_precios_canal
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM perfiles
      WHERE perfiles.user_id = auth.uid()
        AND (perfiles.es_admin OR perfiles.puede_ver_productos OR perfiles.puede_ver_cocina)
    )
  );

CREATE POLICY mod_precios_recetas_canal ON cocina_recetas_precios_canal
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM perfiles
      WHERE perfiles.user_id = auth.uid()
        AND (perfiles.es_admin OR perfiles.puede_ver_productos)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM perfiles
      WHERE perfiles.user_id = auth.uid()
        AND (perfiles.es_admin OR perfiles.puede_ver_productos)
    )
  );

-- Reutiliza la función de touch ya existente (creada en 062).
CREATE TRIGGER trg_touch_precios_recetas_canal BEFORE UPDATE
  ON cocina_recetas_precios_canal FOR EACH ROW
  EXECUTE FUNCTION touch_precios_canal_updated_at();
