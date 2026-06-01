-- 081: Proyección de flujo de caja
-- Tab Finanzas > Proyección. Proyecta 12 meses rodantes con DOS saldos en
-- paralelo: Caja operativa (MP) y Reserva (comitente).
--
-- Los KPIs que alimentan la proyección (ingreso, CMV%, sueldos, pagos fijos,
-- aguinaldos) se calculan EN VIVO desde el ERP y NO se persisten acá — se leen
-- de los RPCs del EdR, pagos_fijos, empleados y aguinaldos. Esta migración solo
-- guarda lo que NO sale de otro módulo:
--   - proyeccion_config: los 2 saldos ancla + supuestos (fila única)
--   - proyeccion_flujo_items: inversiones / eventos / transferencias manuales

begin;

-- Config: saldos iniciales + supuestos. Fila única (id = 1).
create table if not exists public.proyeccion_config (
  id                      int primary key default 1,
  saldo_operativa_inicial numeric(16,2) not null default 0,
  saldo_reserva_inicial   numeric(16,2) not null default 0,
  fecha_saldo             date not null default current_date,
  cmv_pct_override        numeric(6,4),            -- null = autocalcular desde EdR
  meses_promedio          int  not null default 3, -- ventana de promedios móviles
  updated_at              timestamptz not null default now(),
  constraint proyeccion_config_fila_unica check (id = 1)
);

comment on column public.proyeccion_config.cmv_pct_override is
  'Si es null, el CMV% se autocalcula = Σ compras mercadería ÷ Σ ventas (RPCs EdR). Si tiene valor, se fija ese.';
comment on column public.proyeccion_config.meses_promedio is
  'Cantidad de meses reales hacia atrás para promediar ingreso y CMV%.';

-- Semilla con los saldos de hoy (MP + comitente). Editable desde la UI.
insert into public.proyeccion_config (id, saldo_operativa_inicial, saldo_reserva_inicial)
values (1, 1606768, 50000000)
on conflict (id) do nothing;

-- Items manuales: inversiones, eventos y transferencias entre cajas.
create table if not exists public.proyeccion_flujo_items (
  id         uuid primary key default gen_random_uuid(),
  periodo    text not null,                                  -- 'YYYY-MM'
  concepto   text not null,
  tipo       text not null check (tipo in ('ingreso','egreso','transferencia')),
  cuenta     text not null default 'operativa'
             check (cuenta in ('operativa','reserva')),
  monto      numeric(16,2) not null,
  nota       text,
  created_at timestamptz not null default now()
);

comment on table public.proyeccion_flujo_items is
  'Movimientos puntuales de la proyección. En tipo=transferencia, "cuenta" es el destino al que ENTRA la plata; sale de la otra caja.';

create index if not exists idx_proy_items_periodo on public.proyeccion_flujo_items (periodo);

-- RLS: mismo patrón que el resto del ERP (authenticated lee y escribe).
alter table public.proyeccion_config      enable row level security;
alter table public.proyeccion_flujo_items enable row level security;

drop policy if exists "auth_select_proy_config" on public.proyeccion_config;
drop policy if exists "auth_write_proy_config"  on public.proyeccion_config;
create policy "auth_select_proy_config" on public.proyeccion_config
  for select to authenticated using (true);
create policy "auth_write_proy_config" on public.proyeccion_config
  for all to authenticated using (true) with check (true);

drop policy if exists "auth_select_proy_items" on public.proyeccion_flujo_items;
drop policy if exists "auth_write_proy_items"  on public.proyeccion_flujo_items;
create policy "auth_select_proy_items" on public.proyeccion_flujo_items
  for select to authenticated using (true);
create policy "auth_write_proy_items" on public.proyeccion_flujo_items
  for all to authenticated using (true) with check (true);

commit;
