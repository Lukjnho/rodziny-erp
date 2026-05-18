-- Permiso granular para el nuevo módulo Productos (Costeo + ABM de productos).
-- Default false porque maneja datos sensibles de costos y márgenes; los admins
-- siguen viéndolo todo via es_admin.
ALTER TABLE public.perfiles
  ADD COLUMN IF NOT EXISTS puede_ver_productos boolean NOT NULL DEFAULT false;
