-- 082_cocina_lotes_pasta_masas.sql
-- Multi-masa en "Armar Pasta": un armado de pasta "mixta" (ej: Tagliatelles
-- mixtos) consume VARIOS lotes de masa. cocina_lotes_pasta.lote_masa_id es 1:1,
-- así que el detalle por lote se guarda en esta tabla puente. El masa_kg TOTAL
-- se sigue guardando en cocina_lotes_pasta.masa_kg (con lote_masa_id = null en
-- el caso mixto) para no romper los análisis de rendimiento. El disponible de
-- cada masa se calcula sumando el consumo directo + el de esta tabla.

create table if not exists cocina_lotes_pasta_masas (
  id uuid primary key default gen_random_uuid(),
  lote_pasta_id uuid not null references cocina_lotes_pasta(id) on delete cascade,
  lote_masa_id uuid not null references cocina_lotes_masa(id),
  masa_kg numeric not null check (masa_kg > 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_clpm_lote_pasta on cocina_lotes_pasta_masas(lote_pasta_id);
create index if not exists idx_clpm_lote_masa on cocina_lotes_pasta_masas(lote_masa_id);

-- Flag para habilitar el multi-masa SOLO en productos "mixtos" (varias masas).
alter table cocina_productos add column if not exists es_mixto boolean not null default false;

-- Tagliatelles mixtos (Vedia) — único mixto actual.
update cocina_productos set es_mixto = true
where id = '514cf33b-99c9-4f3c-90de-ac287784ad55';

-- RLS: el QR de producción escribe con anon key. Espejamos las políticas de
-- cocina_lotes_pasta (anon INSERT/SELECT, authenticated ALL vía permiso cocina).
alter table cocina_lotes_pasta_masas enable row level security;

create policy cocina_lotes_pasta_masas_cocina_all on cocina_lotes_pasta_masas
  for all to authenticated
  using (tiene_permiso('cocina'))
  with check (tiene_permiso('cocina'));

create policy cocina_lotes_pasta_masas_anon_insert on cocina_lotes_pasta_masas
  for insert to anon
  with check (true);

create policy cocina_lotes_pasta_masas_anon_select on cocina_lotes_pasta_masas
  for select to anon
  using (true);
