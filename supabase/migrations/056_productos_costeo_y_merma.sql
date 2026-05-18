-- Fase 1.B del módulo Productos: configuración de costeo por categoría,
-- comisión MP por medio de pago, y merma por insumo.

-- ─── Merma por insumo ───────────────────────────────────────────────────────
-- La cebolla pelada/zanahoria pelada/etc. pierden % al ser usadas. La merma
-- se aplica al multiplicar el costo_unitario por (1 + merma_pct) cuando se
-- consume en una receta.
ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS merma_pct numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.productos.merma_pct IS
  'Porcentaje de pérdida al usar el insumo (ej: 0.15 = se necesita 15% más kg para usar el rendimiento útil). 0 = sin merma.';

-- ─── Configuración de costeo por categoría de producto elaborado ────────────
-- Categoría usa cocina_productos.tipo (pasta, salsa, postre, etc.) o 'default'
-- como fallback. Estos valores son los markup/margen objetivo y rango de
-- mercado para sugerir precios y disparar alertas.
CREATE TABLE IF NOT EXISTS public.productos_costeo_config (
  categoria text PRIMARY KEY,
  markup_objetivo numeric NOT NULL DEFAULT 0.70,    -- % sobre costo (0.70 = precio = costo × 1.70)
  margen_min numeric NOT NULL DEFAULT 0.50,         -- margen mínimo aceptable sobre precio neto
  margen_max numeric NOT NULL DEFAULT 0.80,         -- margen máximo (arriba = "dejando plata o costo mal cargado")
  redondeo numeric NOT NULL DEFAULT 100,            -- precio sugerido se redondea a múltiplos de este número
  rango_mercado_min numeric,                        -- nullable; opcional, para alertas
  rango_mercado_max numeric,
  descripcion text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.productos_costeo_config IS
  'Configuración de costeo por categoría. Categoría matchea cocina_productos.tipo o usa "default" como fallback.';

-- Trigger para mantener updated_at
CREATE OR REPLACE FUNCTION public.productos_costeo_config_touch_updated()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS productos_costeo_config_touch ON public.productos_costeo_config;
CREATE TRIGGER productos_costeo_config_touch
  BEFORE UPDATE ON public.productos_costeo_config
  FOR EACH ROW EXECUTE FUNCTION public.productos_costeo_config_touch_updated();

-- Seeds de categorías. Lucas pidió markup 70% para elaborados. Para
-- comprados (bebidas, vinos, etc.) puse valores típicos de gastronomía
-- que él tiene que validar y ajustar.
INSERT INTO public.productos_costeo_config
  (categoria, markup_objetivo, margen_min, margen_max, redondeo, descripcion)
VALUES
  ('default',     0.70, 0.50, 0.80, 100, 'Fallback para categorías sin config propia'),
  -- Elaborados (Lucas confirmó 70% markup)
  ('pasta',       0.70, 0.55, 0.80, 100, 'Pastas (top de ventas, ojo techo de mercado $12-18k)'),
  ('salsa',       0.70, 0.50, 0.80, 100, 'Salsas (mostrador y mesa)'),
  ('postre',      0.70, 0.55, 0.85, 100, 'Postres'),
  ('panificado',  0.65, 0.45, 0.75,  50, 'Pan, facturas'),
  ('pasteleria',  0.70, 0.50, 0.85, 100, 'Pastelería fina (Saavedra)'),
  ('masa',        0.65, 0.45, 0.75, 100, 'Masas vendidas sueltas'),
  -- Comprados (valores estimativos típicos, A VALIDAR con Lucas)
  ('bebida',      1.50, 0.55, 0.75, 100, 'Gaseosas, aguas, cervezas. Markup típico gastronómico'),
  ('vino',        1.00, 0.45, 0.65, 100, 'Vinos (markup más bajo, segmento sensible al precio)'),
  ('aperitivo',   1.80, 0.55, 0.75, 100, 'Gin, fernet, etc.'),
  ('helado',      1.00, 0.45, 0.65, 100, 'Helado soft (tetrabrik dividido en porciones)')
ON CONFLICT (categoria) DO NOTHING;

-- ─── Comisión MP por medio de pago ──────────────────────────────────────────
-- Valores estimados iniciales. En Fase 1.E o 2 vamos a calibrarlos con
-- datos reales del extracto de MercadoPago vs ventas Fudo.
CREATE TABLE IF NOT EXISTS public.comision_mp_config (
  medio_pago text PRIMARY KEY,
  pct numeric NOT NULL DEFAULT 0,
  descripcion text,
  actualizado timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.comision_mp_config IS
  'Comisión efectiva por medio de pago, para calcular margen real. Calibrar con datos reales del extracto MP.';

INSERT INTO public.comision_mp_config (medio_pago, pct, descripcion)
VALUES
  ('efectivo',      0,     'Sin comisión'),
  ('qr',            0.015, 'MercadoPago QR (estimado, A CALIBRAR con extracto MP)'),
  ('debito',        0.020, 'Débito (estimado, sin promociones)'),
  ('credito',       0.030, 'Crédito (estimado, 1 pago)'),
  ('transferencia', 0,     'Transferencia bancaria, sin comisión'),
  ('mp_lucas',      0,     'POSnet personal de Lucas (PM 7 Fudo). No aplica al negocio, va a dividendo.')
ON CONFLICT (medio_pago) DO NOTHING;

-- ─── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.productos_costeo_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comision_mp_config       ENABLE ROW LEVEL SECURITY;

-- Lectura: admins o con permiso productos
DROP POLICY IF EXISTS sel_productos_costeo_config ON public.productos_costeo_config;
CREATE POLICY sel_productos_costeo_config ON public.productos_costeo_config FOR SELECT
USING (
  EXISTS (SELECT 1 FROM public.perfiles
          WHERE user_id = auth.uid()
            AND (es_admin OR puede_ver_productos))
);

DROP POLICY IF EXISTS sel_comision_mp_config ON public.comision_mp_config;
CREATE POLICY sel_comision_mp_config ON public.comision_mp_config FOR SELECT
USING (
  EXISTS (SELECT 1 FROM public.perfiles
          WHERE user_id = auth.uid()
            AND (es_admin OR puede_ver_productos))
);

-- Modificación: solo admins
DROP POLICY IF EXISTS mod_productos_costeo_config ON public.productos_costeo_config;
CREATE POLICY mod_productos_costeo_config ON public.productos_costeo_config FOR ALL
USING (
  EXISTS (SELECT 1 FROM public.perfiles WHERE user_id = auth.uid() AND es_admin)
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.perfiles WHERE user_id = auth.uid() AND es_admin)
);

DROP POLICY IF EXISTS mod_comision_mp_config ON public.comision_mp_config;
CREATE POLICY mod_comision_mp_config ON public.comision_mp_config FOR ALL
USING (
  EXISTS (SELECT 1 FROM public.perfiles WHERE user_id = auth.uid() AND es_admin)
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.perfiles WHERE user_id = auth.uid() AND es_admin)
);
