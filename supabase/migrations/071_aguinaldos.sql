-- 071: Tabla aguinaldos (SAC) + vínculo con gastos
-- El tab RRHH > Aguinaldo guarda 1 fila por (empleado, año, semestre).
-- Cuando se marca pagado, se crea un gasto en categorías_gasto > Aguinaldo y
-- se persiste el gasto_id acá para que el upsert sea idempotente.
--
-- Idempotente: en producción la tabla 'aguinaldos' ya existía con un schema
-- previo (sin medio_pago ni gasto_id), de cuando el tab era código suelto sin
-- migración. Usamos ADD COLUMN IF NOT EXISTS para no chocar con esa instancia.

begin;

create table if not exists public.aguinaldos (
  id              uuid primary key default gen_random_uuid(),
  empleado_id     uuid not null references public.empleados(id) on delete cascade,
  anio            int  not null,
  semestre        int  not null check (semestre in (1, 2)),
  mejor_sueldo    numeric(14,2) not null default 0,
  dias_trabajados int  not null default 0,
  monto_calculado numeric(14,2) not null default 0,
  monto_pagado    numeric(14,2),
  pagado          boolean not null default false,
  fecha_pago      date,
  notas           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Columnas nuevas para vincular con Finanzas
alter table public.aguinaldos add column if not exists medio_pago text;
alter table public.aguinaldos
  add column if not exists gasto_id uuid references public.gastos(id) on delete set null;

-- Unique (empleado, año, semestre) si todavía no existe
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.aguinaldos'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) ilike '%(empleado_id, anio, semestre)%'
  ) then
    alter table public.aguinaldos
      add constraint aguinaldos_empleado_anio_semestre_key
      unique (empleado_id, anio, semestre);
  end if;
end $$;

create index if not exists idx_aguinaldos_anio_sem on public.aguinaldos (anio, semestre);
create index if not exists idx_aguinaldos_empleado on public.aguinaldos (empleado_id);
create index if not exists idx_aguinaldos_gasto    on public.aguinaldos (gasto_id);

alter table public.aguinaldos enable row level security;

drop policy if exists "auth_select_aguinaldos" on public.aguinaldos;
drop policy if exists "auth_write_aguinaldos"  on public.aguinaldos;

create policy "auth_select_aguinaldos" on public.aguinaldos
  for select to authenticated using (true);

create policy "auth_write_aguinaldos" on public.aguinaldos
  for all to authenticated using (true) with check (true);

commit;
