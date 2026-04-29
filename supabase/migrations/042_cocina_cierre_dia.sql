-- 042_cocina_cierre_dia.sql
-- Cierre de turno unificado para Pastas / Salsas / Postres (Vedia).
-- Reemplaza las dos tablas vacías cocina_conteo_mostrador y cocina_conteos_mostrador.

-- 1) Drop de tablas obsoletas (verificadas vacías)
DROP TABLE IF EXISTS public.cocina_conteo_mostrador;
DROP TABLE IF EXISTS public.cocina_conteos_mostrador;

-- 2) Tabla nueva
CREATE TABLE IF NOT EXISTS public.cocina_cierre_dia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha date NOT NULL,
  local text NOT NULL CHECK (local IN ('vedia', 'saavedra')),
  producto_id uuid NOT NULL REFERENCES public.cocina_productos(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('pasta', 'salsa', 'postre')),
  turno text CHECK (turno IS NULL OR turno IN ('mediodia', 'noche')),
  cantidad_real numeric NOT NULL CHECK (cantidad_real >= 0),
  unidad text NOT NULL CHECK (unidad IN ('porciones', 'kg', 'unidades')),
  inicial numeric,
  entrega numeric,
  vendido numeric,
  responsable text,
  notas text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Un único cierre por (fecha, local, producto, turno). Para postres/salsas que cierran sin turno,
-- usamos un índice parcial adicional con turno NULL.
CREATE UNIQUE INDEX IF NOT EXISTS ux_cocina_cierre_dia_con_turno
  ON public.cocina_cierre_dia (fecha, local, producto_id, turno)
  WHERE turno IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_cocina_cierre_dia_sin_turno
  ON public.cocina_cierre_dia (fecha, local, producto_id)
  WHERE turno IS NULL;

CREATE INDEX IF NOT EXISTS idx_cocina_cierre_dia_fecha_local
  ON public.cocina_cierre_dia (local, fecha DESC);

CREATE INDEX IF NOT EXISTS idx_cocina_cierre_dia_producto
  ON public.cocina_cierre_dia (producto_id, fecha DESC);

-- 3) RLS — mismo esquema que cocina_traspasos (QR público + admin con permiso cocina)
ALTER TABLE public.cocina_cierre_dia ENABLE ROW LEVEL SECURITY;

CREATE POLICY cocina_cierre_dia_anon_select
  ON public.cocina_cierre_dia FOR SELECT
  TO anon USING (true);

CREATE POLICY cocina_cierre_dia_anon_insert
  ON public.cocina_cierre_dia FOR INSERT
  TO anon WITH CHECK (true);

CREATE POLICY cocina_cierre_dia_cocina_all
  ON public.cocina_cierre_dia FOR ALL
  TO authenticated
  USING (tiene_permiso('cocina'))
  WITH CHECK (tiene_permiso('cocina'));

COMMENT ON TABLE public.cocina_cierre_dia IS
  'Cierre obligatorio por turno/día de stock real de pastas, salsas y postres. Fuente del campo "inicial" del turno siguiente.';
