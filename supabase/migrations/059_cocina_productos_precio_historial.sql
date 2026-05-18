-- Fase 2.A del módulo Productos: histórico de precios de venta.
-- Registra cada cambio en cocina_productos.precio_venta. Sirve para:
--   - Ver elasticidad real (qué pasó con la demanda cuando subiste precio)
--   - Auditoría de quién subió/bajó precios y cuándo
--   - Base para sugerencias futuras del módulo Menu Engineering

CREATE TABLE IF NOT EXISTS public.cocina_productos_precio_historial (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cocina_producto_id uuid NOT NULL REFERENCES public.cocina_productos(id) ON DELETE CASCADE,
  precio_anterior numeric,
  precio_nuevo numeric,
  variacion_pct numeric,
  fecha timestamptz NOT NULL DEFAULT now(),
  usuario text,
  motivo text
);

CREATE INDEX IF NOT EXISTS idx_precio_historial_producto
  ON public.cocina_productos_precio_historial(cocina_producto_id, fecha DESC);

COMMENT ON TABLE public.cocina_productos_precio_historial IS
  'Histórico de cambios de precio_venta por producto. Llenado por trigger automático.';

-- ─── Trigger: registrar cambios de precio_venta ─────────────────────────────
CREATE OR REPLACE FUNCTION public.cocina_productos_log_precio()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_variacion numeric;
  v_usuario text;
BEGIN
  -- Solo registrar si cambió el precio (ignora NULL → NULL, valores iguales)
  IF NEW.precio_venta IS DISTINCT FROM OLD.precio_venta THEN
    IF OLD.precio_venta IS NOT NULL AND OLD.precio_venta > 0 AND NEW.precio_venta IS NOT NULL THEN
      v_variacion := (NEW.precio_venta - OLD.precio_venta) / OLD.precio_venta;
    ELSE
      v_variacion := NULL;
    END IF;

    -- Intentar obtener nombre del perfil del usuario logueado
    BEGIN
      SELECT nombre INTO v_usuario FROM perfiles WHERE user_id = auth.uid();
    EXCEPTION WHEN OTHERS THEN
      v_usuario := NULL;
    END;

    INSERT INTO cocina_productos_precio_historial (
      cocina_producto_id, precio_anterior, precio_nuevo, variacion_pct, usuario
    ) VALUES (
      NEW.id, OLD.precio_venta, NEW.precio_venta, v_variacion, v_usuario
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cocina_productos_precio_log ON public.cocina_productos;
CREATE TRIGGER cocina_productos_precio_log
  AFTER UPDATE OF precio_venta ON public.cocina_productos
  FOR EACH ROW EXECUTE FUNCTION public.cocina_productos_log_precio();

-- ─── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.cocina_productos_precio_historial ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sel_precio_historial ON public.cocina_productos_precio_historial;
CREATE POLICY sel_precio_historial ON public.cocina_productos_precio_historial FOR SELECT
USING (
  EXISTS (SELECT 1 FROM public.perfiles
          WHERE user_id = auth.uid()
            AND (es_admin OR puede_ver_productos OR puede_ver_cocina))
);

-- INSERT solo via trigger (SECURITY DEFINER bypasea RLS). No exponemos
-- INSERT/UPDATE/DELETE directos a usuarios — es un log inmutable.
