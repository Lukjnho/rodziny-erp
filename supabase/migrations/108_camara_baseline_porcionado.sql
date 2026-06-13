-- 108 — Cámara de pastas con baseline/cierre (modelo escalonado)
--
-- Problema: el "stock de cámara" se calculaba como histórico total
-- (producido − traspasado − merma + ajustes) con piso 0. El conteo físico
-- guardaba un DELTA suelto que peleaba contra el porcionado: si Tamara contaba
-- después de que un productor porcionaba, el delta negativo se comía la
-- producción y "no sumaba".
--
-- Modelo nuevo (definido con Lucas):
--   stock_cámara = último_conteo + porcionado_posterior − traslados_posteriores − merma_posterior
-- El conteo físico fija un PUNTO DE PARTIDA con fecha/hora (baseline), no un delta.
-- De ahí en adelante el porcionado siempre suma y a la vista.

-- 1) Hora real de entrada a cámara (porcionado). Antes solo existía
--    fecha_porcionado (sin hora), insuficiente para ubicar la producción
--    respecto del conteo físico del mismo día.
alter table cocina_lotes_pasta
  add column if not exists porcionado_at timestamptz;

-- Backfill: los lotes ya en cámara usan su created_at (mejor hora disponible).
-- Todos quedan ANTES del baseline inicial (now()), así no se recuentan.
update cocina_lotes_pasta
set porcionado_at = created_at
where ubicacion = 'camara_congelado' and porcionado_at is null;

-- 2) El RPC de porcionado estampa la hora real al mover el lote a cámara.
create or replace function public.porcionar_pasta_lote(
  p_lote_id uuid,
  p_porciones integer,
  p_responsable text default null,
  p_sobrante_gramos numeric default null,
  p_sobrante_origen_lote_id uuid default null,
  p_merma_porcionado integer default 0,
  p_notas text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_existe boolean;
begin
  if p_porciones is null or p_porciones <= 0 then
    raise exception 'porciones debe ser > 0';
  end if;

  select true into v_existe
  from cocina_lotes_pasta
  where id = p_lote_id and ubicacion = 'freezer_produccion'
  limit 1;

  if v_existe is null then
    raise exception 'Lote no encontrado o ya porcionado';
  end if;

  update cocina_lotes_pasta
  set ubicacion = 'camara_congelado',
      porciones = p_porciones,
      fecha_porcionado = current_date,
      porcionado_at = now(),
      responsable_porcionado = nullif(trim(coalesce(p_responsable, '')), ''),
      merma_porcionado = coalesce(p_merma_porcionado, 0),
      sobrante_gramos = case
        when p_sobrante_gramos is not null and p_sobrante_gramos > 0 then p_sobrante_gramos
        else null
      end,
      sobrante_origen_lote_id = p_sobrante_origen_lote_id,
      notas = case
        when p_notas is not null and length(trim(p_notas)) > 0
        then '[Porcionado] ' || trim(p_notas)
        else notas
      end
  where id = p_lote_id;
end;
$$;

-- 3) Baseline (conteo físico) de cámara. Espeja cocina_cierre_dia pero solo
--    para pastas/cámara: cada fila = "tal día había N en cámara".
create table if not exists cocina_cierre_camara (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null references cocina_productos(id) on delete cascade,
  local text not null,
  fecha date not null default current_date,
  cantidad_real numeric not null,
  responsable text,
  notas text,
  created_at timestamptz not null default now()
);

create index if not exists idx_cocina_cierre_camara_prod
  on cocina_cierre_camara (producto_id, local, created_at desc);

alter table cocina_cierre_camara enable row level security;

create policy cocina_cierre_camara_anon_select
  on cocina_cierre_camara for select to anon using (true);
create policy cocina_cierre_camara_auth_select
  on cocina_cierre_camara for select to authenticated using (true);
create policy cocina_cierre_camara_auth_insert
  on cocina_cierre_camara for insert to authenticated with check (true);
create policy cocina_cierre_camara_auth_update
  on cocina_cierre_camara for update to authenticated using (true);
create policy cocina_cierre_camara_auth_delete
  on cocina_cierre_camara for delete to authenticated using (true);

-- 4) Baseline inicial = stock de cámara calculado HOY para cada pasta de Vedia
--    (histórico producido − traspasos − merma + ajustes), con piso 0.
--    Saavedra no produce pastas por este flujo: queda sin baseline y cae al
--    cálculo histórico (que da 0).
insert into cocina_cierre_camara (producto_id, local, fecha, cantidad_real, responsable, notas)
select p.id, p.local, current_date,
  greatest(0,
    coalesce((select sum(lp.porciones) from cocina_lotes_pasta lp
      where lp.producto_id = p.id and lp.local = p.local and lp.ubicacion = 'camara_congelado'), 0)
    - coalesce((select sum(t.porciones) from cocina_traspasos t
      where t.producto_id = p.id and t.local = p.local), 0)
    - coalesce((select sum(m.porciones) from cocina_merma m
      where m.producto_id = p.id and m.local = p.local), 0)
    + coalesce((select sum(a.delta) from cocina_ajustes_stock a
      where a.producto_id = p.id and a.local = p.local and a.ubicacion = 'camara'), 0)
  ),
  'sistema',
  'Baseline inicial al migrar al modelo escalonado'
from cocina_productos p
where p.tipo = 'pasta' and p.activo = true and p.local = 'vedia';

-- 5) Vista con baseline. Cada columna pasa a ser "desde el último conteo"
--    (antes era histórico total). Los consumidores (Dashboard, Traspasos,
--    ResumenSemanal, PlanProduccion) hacen camara − traspasadas − merma, así el
--    neto sigue cuadrando sin tocar el front.
create or replace view v_cocina_stock_pastas as
select
  p.id as producto_id,
  p.nombre,
  p.codigo,
  p.local,
  p.minimo_produccion,
  -- CÁMARA: baseline + porcionado posterior + ajustes posteriores
  (coalesce(b.cantidad_real, 0)
   + coalesce((select sum(lp.porciones) from cocina_lotes_pasta lp
       where lp.producto_id = p.id and lp.local = p.local and lp.ubicacion = 'camara_congelado'
         and (b.created_at is null or coalesce(lp.porcionado_at, lp.created_at) > b.created_at)), 0)
   + coalesce((select sum(a.delta) from cocina_ajustes_stock a
       where a.producto_id = p.id and a.local = p.local and a.ubicacion = 'camara'
         and (b.created_at is null or a.created_at > b.created_at)), 0)
  )::numeric as porciones_camara,
  -- FRESCO: bandejas en freezer de producción, sin porcionar (histórico)
  coalesce((select sum(lp.porciones) from cocina_lotes_pasta lp
      where lp.producto_id = p.id and lp.local = p.local and lp.ubicacion = 'freezer_produccion'), 0)::numeric as porciones_fresco,
  -- TRASPASADAS: posteriores al baseline
  coalesce((select sum(t.porciones) from cocina_traspasos t
      where t.producto_id = p.id and t.local = p.local
        and (b.created_at is null or t.created_at > b.created_at)), 0)::numeric as porciones_traspasadas,
  -- MERMA: posterior al baseline
  coalesce((select sum(m.porciones) from cocina_merma m
      where m.producto_id = p.id and m.local = p.local
        and (b.created_at is null or m.created_at > b.created_at)), 0)::numeric as porciones_merma,
  -- AJUSTE MOSTRADOR: histórico (el mostrador tiene su propio cierre aparte)
  coalesce((select sum(a.delta) from cocina_ajustes_stock a
      where a.producto_id = p.id and a.local = p.local and a.ubicacion = 'mostrador'), 0) as porciones_ajuste_mostrador
from cocina_productos p
left join lateral (
  select cc.cantidad_real, cc.created_at
  from cocina_cierre_camara cc
  where cc.producto_id = p.id and cc.local = p.local
  order by cc.created_at desc
  limit 1
) b on true
where p.tipo = 'pasta' and p.activo = true;
