-- Módulo Agenda: tareas + eventos + recordatorios personales por usuario.
-- Sin sync con Google Calendar — backend 100% en el ERP.

-- 1. Flag de permiso en el perfil (default false; admins lo ven por es_admin)
ALTER TABLE public.perfiles
  ADD COLUMN IF NOT EXISTS puede_ver_agenda boolean NOT NULL DEFAULT false;

-- 2. Tabla principal
CREATE TABLE IF NOT EXISTS public.agenda_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  titulo text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('evento', 'tarea', 'recordatorio')),
  fecha_inicio timestamptz NOT NULL,
  fecha_fin timestamptz NULL,
  all_day boolean NOT NULL DEFAULT false,
  prioridad text NULL CHECK (prioridad IN ('alta', 'media', 'baja')),
  completado boolean NOT NULL DEFAULT false,
  completado_at timestamptz NULL,
  recurrencia jsonb NULL,
  nota text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agenda_items_usuario_fecha
  ON public.agenda_items(usuario_id, fecha_inicio);

-- 3. RLS: cada usuario solo ve y modifica sus propios items
ALTER TABLE public.agenda_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY agenda_items_select_own
  ON public.agenda_items FOR SELECT
  USING (usuario_id = auth.uid());

CREATE POLICY agenda_items_insert_own
  ON public.agenda_items FOR INSERT
  WITH CHECK (usuario_id = auth.uid());

CREATE POLICY agenda_items_update_own
  ON public.agenda_items FOR UPDATE
  USING (usuario_id = auth.uid())
  WITH CHECK (usuario_id = auth.uid());

CREATE POLICY agenda_items_delete_own
  ON public.agenda_items FOR DELETE
  USING (usuario_id = auth.uid());

COMMENT ON TABLE public.agenda_items IS
  'Agenda personal del usuario: tareas, eventos y recordatorios. Sin sync externo.';
