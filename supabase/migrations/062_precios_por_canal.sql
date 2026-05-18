-- Fase 1 de la restructura Menú/Costeo: precio de venta por canal.
--
-- Hasta ahora cocina_productos.precio_venta era ÚNICO. El negocio necesita
-- precios distintos por canal: Salón (plato) y Vianda comparten precio, el
-- Congelado tiene precio propio. Esta tabla es la FUENTE DE VERDAD de los 3
-- canales; cocina_productos.precio_venta queda espejado al precio del canal
-- 'plato' (Salón) vía trigger para NO romper consumidores existentes:
--   - usePriceEngineering (Ley de Omnes)
--   - useCostoCompleto (precio actual del waterfall)
--   - ProductosTab / Catálogo Cocina (ABM crudo)
--   - trigger de historial de precios (mig 059)
--
-- Vocabulario de canal: se reutiliza 'plato'/'vianda'/'congelado' (igual que
-- cocina_productos_packaging/adicionales). "Salón" es solo el label de UI de
-- 'plato' (servicio en el local).

CREATE TABLE IF NOT EXISTS public.cocina_productos_precios_canal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cocina_producto_id uuid NOT NULL REFERENCES public.cocina_productos(id) ON DELETE CASCADE,
  canal text NOT NULL CHECK (canal IN ('plato','vianda','congelado')),
  precio numeric NOT NULL CHECK (precio >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cocina_producto_id, canal)
);

CREATE INDEX IF NOT EXISTS idx_precios_canal_producto
  ON public.cocina_productos_precios_canal(cocina_producto_id);

COMMENT ON TABLE public.cocina_productos_precios_canal IS
  'Precio de venta por canal (plato=Salón / vianda / congelado). Fuente de verdad; cocina_productos.precio_venta se espeja al canal plato vía trigger.';

-- ─── Backfill: precio_venta actual → canal plato (+ vianda = mismo) ──────────
-- Congelado NO se crea (queda vacío hasta que el usuario lo cargue).
INSERT INTO public.cocina_productos_precios_canal (cocina_producto_id, canal, precio)
SELECT id, 'plato', precio_venta
FROM public.cocina_productos
WHERE precio_venta IS NOT NULL AND precio_venta > 0
ON CONFLICT (cocina_producto_id, canal) DO NOTHING;

INSERT INTO public.cocina_productos_precios_canal (cocina_producto_id, canal, precio)
SELECT id, 'vianda', precio_venta
FROM public.cocina_productos
WHERE precio_venta IS NOT NULL AND precio_venta > 0
ON CONFLICT (cocina_producto_id, canal) DO NOTHING;

-- ─── Trigger: espejar el precio del canal 'plato' a cocina_productos ─────────
-- El UPDATE condicionado (IS DISTINCT FROM) evita disparos en cadena y, durante
-- el backfill, evita ensuciar el historial de precios (mig 059) porque el valor
-- ya coincide con el actual.
CREATE OR REPLACE FUNCTION public.sync_precio_venta_salon()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.canal = 'plato' THEN
    UPDATE public.cocina_productos
       SET precio_venta = NEW.precio
     WHERE id = NEW.cocina_producto_id
       AND precio_venta IS DISTINCT FROM NEW.precio;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_precio_venta_salon ON public.cocina_productos_precios_canal;
CREATE TRIGGER trg_sync_precio_venta_salon
  AFTER INSERT OR UPDATE OF precio ON public.cocina_productos_precios_canal
  FOR EACH ROW EXECUTE FUNCTION public.sync_precio_venta_salon();

-- ─── updated_at automático ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_precios_canal_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_precios_canal ON public.cocina_productos_precios_canal;
CREATE TRIGGER trg_touch_precios_canal
  BEFORE UPDATE ON public.cocina_productos_precios_canal
  FOR EACH ROW EXECUTE FUNCTION public.touch_precios_canal_updated_at();

-- ─── RLS (mismo patrón que cocina_productos_packaging) ──────────────────────
ALTER TABLE public.cocina_productos_precios_canal ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sel_precios_canal ON public.cocina_productos_precios_canal;
CREATE POLICY sel_precios_canal ON public.cocina_productos_precios_canal FOR SELECT
USING (
  EXISTS (SELECT 1 FROM public.perfiles
          WHERE user_id = auth.uid()
            AND (es_admin OR puede_ver_productos OR puede_ver_cocina))
);

DROP POLICY IF EXISTS mod_precios_canal ON public.cocina_productos_precios_canal;
CREATE POLICY mod_precios_canal ON public.cocina_productos_precios_canal FOR ALL
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
