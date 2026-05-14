-- Permiso granular para el tab "Flujo de caja" de Finanzas. Hasta ahora se
-- mostraba a cualquiera con `puede_ver_finanzas`; se separa porque incluye
-- dividendos de socios que Lucas prefiere mantener privados.
-- Default false → solo admins ven el tab. Habilitar manualmente desde Usuarios.

ALTER TABLE public.perfiles
  ADD COLUMN IF NOT EXISTS puede_ver_flujo_caja boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.perfiles.puede_ver_flujo_caja IS
  'Acceso al tab Flujo de caja (movimientos bancarios, efectivo, dividendos). Datos sensibles — solo socios.';
