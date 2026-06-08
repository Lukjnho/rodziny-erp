-- 097: Agenda — tareas compartidas entre varios usuarios.
-- Modelo: cada item conserva usuario_id (creador) y suma `asignados` (uuid[]).
-- Lo ven el creador + todos los asignados + admins. Cualquier asignado puede
-- editar/tildar (estado completado compartido). Eliminar = solo creador/admin.

-- 1) Columna de asignados (lista de user_id con quienes se comparte).
alter table agenda_items
  add column if not exists asignados uuid[] not null default '{}';

-- Índice GIN para la query "asignados contiene mi user_id".
create index if not exists agenda_items_asignados_gin
  on agenda_items using gin (asignados);

-- 2) RLS: que el asignado también pueda VER y EDITAR/TILDAR.
-- (Las policies existentes para creador/admin se mantienen; RLS las combina con OR.)
drop policy if exists agenda_items_select_asignado on agenda_items;
create policy agenda_items_select_asignado on agenda_items
  for select
  using (auth.uid() = any (asignados));

drop policy if exists agenda_items_update_asignado on agenda_items;
create policy agenda_items_update_asignado on agenda_items
  for update
  using (auth.uid() = any (asignados))
  with check (auth.uid() = any (asignados) or usuario_id = auth.uid());

-- 3) RPC para listar compañeros a quienes se puede asignar.
-- Devuelve solo user_id + nombre (no expone el resto de perfiles).
-- Filtra a quienes tienen el módulo Agenda habilitado.
create or replace function agenda_companeros()
returns table (user_id uuid, nombre text)
language sql
security definer
set search_path = public
as $$
  select p.user_id, p.nombre
  from perfiles p
  where p.puede_ver_agenda = true
  order by p.nombre;
$$;

revoke all on function agenda_companeros() from public, anon;
grant execute on function agenda_companeros() to authenticated;
