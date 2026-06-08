-- Módulo Convenios: catálogo de convenios (marcas/instituciones con descuento)
-- que consumen en los locales. La MEDICIÓN (facturación, descuentos, consumos)
-- sale en vivo de la API de Fudo cruzando por el cliente vinculado a cada venta
-- (edge function fudo-convenios). Esta tabla guarda solo la metadata manual:
-- descuento pactado, beneficios extra, vigencia, contacto, estado.

-- 1. Flag de permiso en el perfil (default false; admins lo ven por es_admin)
ALTER TABLE public.perfiles
  ADD COLUMN IF NOT EXISTS puede_ver_convenios boolean NOT NULL DEFAULT false;

-- 2. Tabla principal
CREATE TABLE IF NOT EXISTS public.convenios (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  local             TEXT NOT NULL CHECK (local IN ('vedia', 'saavedra')),
  -- ID del Customer en Fudo. Es la llave para cruzar las ventas con el convenio.
  -- NULL = todavía no se vinculó al cliente de Fudo (no se podrá medir hasta entonces).
  fudo_customer_id  TEXT,
  nombre            TEXT NOT NULL,
  -- Descuento pactado. En Vedia suele venir en el nombre del cliente Fudo ("APEX 15%");
  -- igual lo guardamos acá para el cálculo del neto y para que sea editable.
  descuento_pct     NUMERIC,
  tipo              TEXT,            -- institucional | empresa | club | otro
  contacto          TEXT,
  beneficios_extra  TEXT,           -- ej: "Uso del salón para reuniones" (valor no monetario)
  vigencia_desde    DATE,
  vigencia_hasta    DATE,
  estado            TEXT NOT NULL DEFAULT 'activo'
                      CHECK (estado IN ('activo', 'proximo', 'vencido', 'negociacion')),
  notas             TEXT,
  activo            BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (local, fudo_customer_id)
);

CREATE INDEX IF NOT EXISTS idx_convenios_local ON public.convenios(local);

-- 3. RLS: lo ven y gestionan admins o usuarios con permiso de convenios.
ALTER TABLE public.convenios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS convenios_all ON public.convenios;
CREATE POLICY convenios_all
  ON public.convenios FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.perfiles
      WHERE user_id = auth.uid() AND (es_admin OR puede_ver_convenios)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.perfiles
      WHERE user_id = auth.uid() AND (es_admin OR puede_ver_convenios)
    )
  );

-- 4. Seed: los 4 convenios reales detectados en Fudo (jun 2026).
--    Vedia mete el % en el nombre del cliente; Saavedra (UTN) no.
INSERT INTO public.convenios (local, fudo_customer_id, nombre, descuento_pct, tipo, estado)
VALUES
  ('vedia',    '712', 'APEX',    15, 'empresa',       'activo'),
  ('vedia',    '757', 'Konecta', 15, 'empresa',       'activo'),
  ('vedia',    '759', 'UCES',    15, 'institucional', 'activo'),
  ('saavedra', '20',  'UTN',     15, 'institucional', 'activo')
ON CONFLICT (local, fudo_customer_id) DO NOTHING;
