-- 098: agenda_companeros() debe incluir a los admins.
-- Los admins (Lucas, Karina) tienen puede_ver_agenda=false porque acceden a
-- todos los módulos vía es_admin, no por el flag granular. Sin esto no
-- aparecían en la lista "Compartir con" y nadie podía asignarles tareas.

create or replace function agenda_companeros()
returns table (user_id uuid, nombre text)
language sql
security definer
set search_path = public
as $$
  select p.user_id, p.nombre
  from perfiles p
  where p.puede_ver_agenda = true or p.es_admin = true
  order by p.nombre;
$$;

revoke all on function agenda_companeros() from public, anon;
grant execute on function agenda_companeros() to authenticated;
