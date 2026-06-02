-- 082: Historia mensual de ventas (para estacionalidad de la Proyección)
-- Guarda el total bruto de ventas por local y mes. Se backfillea con la historia
-- de Fudo (Vedia desde 2025-01, Saavedra desde 2025-07) que el ERP no tiene en
-- ventas_tickets. El hook de Proyección calcula la estacionalidad sobre esta
-- serie + las ventas vivas del ERP, y se reajusta solo al cerrar meses nuevos.

begin;

create table if not exists public.ventas_mensuales_historico (
  local       text not null,
  periodo     text not null,                 -- 'YYYY-MM'
  total_bruto numeric(16,2) not null,
  fuente      text not null default 'fudo',
  updated_at  timestamptz not null default now(),
  primary key (local, periodo)
);

comment on table public.ventas_mensuales_historico is
  'Total bruto de ventas por local y mes. Backfill de Fudo + base para la estacionalidad de la Proyección de flujo.';

-- Backfill Fudo (bajado vía API el 2026-06-01). Idempotente.
insert into public.ventas_mensuales_historico (local, periodo, total_bruto, fuente) values
  ('vedia','2025-01', 74320600, 'fudo'),
  ('vedia','2025-02', 66714302, 'fudo'),
  ('vedia','2025-03', 98106102, 'fudo'),
  ('vedia','2025-04',102020730, 'fudo'),
  ('vedia','2025-05',118134900, 'fudo'),
  ('vedia','2025-06',102943700, 'fudo'),
  ('vedia','2025-07', 88537420, 'fudo'),
  ('vedia','2025-08', 94641780, 'fudo'),
  ('vedia','2025-09', 82424640, 'fudo'),
  ('vedia','2025-10', 85951400, 'fudo'),
  ('vedia','2025-11', 76738800, 'fudo'),
  ('vedia','2025-12', 76425500, 'fudo'),
  ('vedia','2026-01', 58904300, 'fudo'),
  ('vedia','2026-02', 59646590, 'fudo'),
  ('vedia','2026-03', 64834000, 'fudo'),
  ('vedia','2026-04', 68094200, 'fudo'),
  ('vedia','2026-05', 83980248, 'fudo'),
  ('saavedra','2025-07', 37301220, 'fudo'),
  ('saavedra','2025-08', 43929820, 'fudo'),
  ('saavedra','2025-09', 38986180, 'fudo'),
  ('saavedra','2025-10', 41154420, 'fudo'),
  ('saavedra','2025-11', 33099020, 'fudo'),
  ('saavedra','2025-12', 39128250, 'fudo'),
  ('saavedra','2026-01', 31714700, 'fudo'),
  ('saavedra','2026-02', 29963400, 'fudo'),
  ('saavedra','2026-03', 36146700, 'fudo'),
  ('saavedra','2026-04', 34074700, 'fudo'),
  ('saavedra','2026-05', 38655100, 'fudo')
on conflict (local, periodo) do nothing;

alter table public.ventas_mensuales_historico enable row level security;

drop policy if exists "auth_select_vmh" on public.ventas_mensuales_historico;
drop policy if exists "auth_write_vmh"  on public.ventas_mensuales_historico;
create policy "auth_select_vmh" on public.ventas_mensuales_historico
  for select to authenticated using (true);
create policy "auth_write_vmh" on public.ventas_mensuales_historico
  for all to authenticated using (true) with check (true);

commit;
