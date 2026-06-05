-- Agenda: los admins pueden ver y gestionar los items de TODOS los usuarios.
-- Las policies de empleado (070) NO se tocan: cada usuario sigue viendo SOLO
-- lo suyo y nunca lo del admin. Estas policies se SUMAN (semántica OR de RLS):
-- empleado => solo lo propio; admin => lo propio + lo de todos = todo.

-- SELECT: admin ve los items de cualquier usuario
DROP POLICY IF EXISTS agenda_items_select_admin ON public.agenda_items;
CREATE POLICY agenda_items_select_admin
  ON public.agenda_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.perfiles
      WHERE user_id = auth.uid() AND es_admin
    )
  );

-- INSERT: admin puede crear items para cualquier usuario (asignar tareas)
DROP POLICY IF EXISTS agenda_items_insert_admin ON public.agenda_items;
CREATE POLICY agenda_items_insert_admin
  ON public.agenda_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.perfiles
      WHERE user_id = auth.uid() AND es_admin
    )
  );

-- UPDATE: admin puede editar/completar items de cualquier usuario
DROP POLICY IF EXISTS agenda_items_update_admin ON public.agenda_items;
CREATE POLICY agenda_items_update_admin
  ON public.agenda_items FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.perfiles
      WHERE user_id = auth.uid() AND es_admin
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.perfiles
      WHERE user_id = auth.uid() AND es_admin
    )
  );

-- DELETE: admin puede borrar items de cualquier usuario
DROP POLICY IF EXISTS agenda_items_delete_admin ON public.agenda_items;
CREATE POLICY agenda_items_delete_admin
  ON public.agenda_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.perfiles
      WHERE user_id = auth.uid() AND es_admin
    )
  );
