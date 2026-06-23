-- 117: estado de las acciones sugeridas del Plan de acción (módulo Productos).
-- Las acciones se calculan en vivo (no se guardan); esta tabla solo persiste
-- qué hizo el usuario con cada una: 'hecha' (ya la ejecuté) o 'descartada'
-- (decido no hacerla). Un registro por accion_key; el último estado manda.
create table if not exists productos_acciones_estado (
  id uuid primary key default gen_random_uuid(),
  -- id estable de la acción generado en el front: p.ej. 'vaca-vedia-n:Bolognesa'
  accion_key text not null unique,
  tipo text not null,
  local text not null,
  producto_codigo text,
  producto_nombre text,
  estado text not null check (estado in ('hecha', 'descartada')),
  -- precio sugerido al momento de marcar 'hecha' (solo subas de precio).
  -- Permite que la tarjeta reaparezca cuando el motor sugiera un objetivo mayor.
  precio_objetivo numeric,
  nota text,
  usuario_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists productos_acciones_estado_local_idx
  on productos_acciones_estado (local);

alter table productos_acciones_estado enable row level security;

-- ERP interno: cualquier usuario autenticado lee y gestiona el estado de las
-- acciones (es info compartida del negocio, no por usuario).
drop policy if exists productos_acciones_estado_select on productos_acciones_estado;
create policy productos_acciones_estado_select on productos_acciones_estado
  for select to authenticated using (true);

drop policy if exists productos_acciones_estado_insert on productos_acciones_estado;
create policy productos_acciones_estado_insert on productos_acciones_estado
  for insert to authenticated with check (true);

drop policy if exists productos_acciones_estado_update on productos_acciones_estado;
create policy productos_acciones_estado_update on productos_acciones_estado
  for update to authenticated using (true) with check (true);

drop policy if exists productos_acciones_estado_delete on productos_acciones_estado;
create policy productos_acciones_estado_delete on productos_acciones_estado
  for delete to authenticated using (true);
