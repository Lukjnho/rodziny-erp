-- ─────────────────────────────────────────────────────────────────────────────
-- 164 · La vista de stock dice DE CUÁNDO es el número
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ. El stock de cámara arranca de un conteo físico (baseline) y le suma
-- lo posterior. Si hace tres semanas que nadie cuenta, el número derivó y en
-- pantalla se ve igual de firme que uno contado hoy. Hoy en Vedia la
-- antigüedad promedio del baseline es de 17 días y el peor caso 83.
--
-- La pantalla del depósito (/pizarron) lo muestra en cada renglón y lo pinta de
-- ámbar cuando pasa mucho, para que el propio tablero pida que lo cuenten en
-- vez de mentir en silencio.
--
-- CÓMO. Un CTE aparte con la MISMA regla del baseline (en Saavedra el cierre de
-- turno de pastas ES el conteo de cámara; en Vedia el cierre es del mostrador y
-- por eso no cuenta), y la columna se agrega AL FINAL. Es la única forma de
-- crecer con CREATE OR REPLACE VIEW: no se puede mover ni renombrar ninguna
-- columna existente. Calcularlo de nuevo en el navegador sería volver a tener
-- dos definiciones del mismo hecho, que es justo lo que acabamos de sacar.
--
-- Puramente aditiva: las 14 columnas anteriores quedan igual y en el mismo
-- orden.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace view public.v_cocina_stock_pastas as
with base as (
  select p.id as producto_id, p.nombre, p.codigo, p.local, p.minimo_produccion,
    coalesce(b.cantidad_real, 0::numeric)
      + coalesce((select sum(lp.porciones) from cocina_lotes_pasta lp
                   where lp.producto_id = p.id and lp.local = p.local
                     and lp.ubicacion = 'camara_congelado'
                     and (b.created_at is null or coalesce(lp.porcionado_at, lp.created_at) > b.created_at)), 0::bigint)::numeric
      + coalesce((select sum(a.delta) from cocina_ajustes_stock a
                   where a.producto_id = p.id and a.local = p.local and a.ubicacion = 'camara'
                     and (b.created_at is null or a.created_at > b.created_at)), 0::numeric) as porciones_camara,
    coalesce((select sum(t.porciones) from cocina_traspasos t
               where t.producto_id = p.id and t.local = p.local
                 and (b.created_at is null or t.created_at > b.created_at)), 0::bigint)::numeric as porciones_traspasadas,
    coalesce((select sum(m.porciones) from cocina_merma m
               where m.producto_id = p.id and m.local = p.local
                 and (b.created_at is null or m.created_at > b.created_at)), 0::numeric) as porciones_merma,
    coalesce((select sum(a.delta) from cocina_ajustes_stock a
               where a.producto_id = p.id and a.local = p.local and a.ubicacion = 'mostrador'), 0::numeric) as porciones_ajuste_mostrador
  from cocina_productos p
  left join lateral (
    select bx.cantidad_real, bx.created_at
    from (
      select cc.cantidad_real, cc.created_at from cocina_cierre_camara cc
       where cc.producto_id = p.id and cc.local = p.local
      union all
      select cd.cantidad_real, cd.created_at from cocina_cierre_dia cd
       where cd.producto_id = p.id and cd.local = p.local and cd.tipo = 'pasta' and p.local = 'saavedra'
    ) bx order by bx.created_at desc limit 1
  ) b on true
  where p.tipo = 'pasta' and p.activo = true
),
ratio as (
  select lp.producto_id, lp.local,
         percentile_cont(0.5) within group (
           order by lp.porciones::numeric / (
             coalesce(lp.masa_kg, 0)
             + case when coalesce(lp.relleno_kg, 0) > 50 then lp.relleno_kg / 1000.0
                    else coalesce(lp.relleno_kg, 0) end)
         ) as porc_por_kg,
         count(*) as lotes_muestra
  from cocina_lotes_pasta lp
  where lp.porciones > 0
    and lp.fecha >= current_date - 120
    and (coalesce(lp.masa_kg, 0)
         + case when coalesce(lp.relleno_kg, 0) > 50 then lp.relleno_kg / 1000.0
                else coalesce(lp.relleno_kg, 0) end) > 0
  group by lp.producto_id, lp.local
),
proceso as (
  select lp.producto_id, lp.local,
         sum(coalesce(lp.masa_kg, 0)
             + case when coalesce(lp.relleno_kg, 0) > 50 then lp.relleno_kg / 1000.0
                    else coalesce(lp.relleno_kg, 0) end) as kg,
         sum(coalesce(lp.cantidad_cajones, 0)) as bandejas,
         count(*) as lotes
  from cocina_lotes_pasta lp
  where lp.ubicacion = 'freezer_produccion'
  group by lp.producto_id, lp.local
),
conteo as (
  select p.id as producto_id, p.local, c.created_at as ultimo_conteo_at
  from cocina_productos p
  left join lateral (
    select bx.created_at from (
      select cc.created_at from cocina_cierre_camara cc
       where cc.producto_id = p.id and cc.local = p.local
      union all
      select cd.created_at from cocina_cierre_dia cd
       where cd.producto_id = p.id and cd.local = p.local and cd.tipo = 'pasta' and p.local = 'saavedra'
    ) bx order by bx.created_at desc limit 1
  ) c on true
  where p.tipo = 'pasta' and p.activo = true
)
select
  base.*,
  greatest(0::numeric, base.porciones_camara - base.porciones_traspasadas - base.porciones_merma)
    as porciones_neto_camara,
  coalesce(pr.bandejas, 0)::int
    as bandejas_en_proceso,
  coalesce(round(coalesce(pr.kg, 0) * coalesce(r.porc_por_kg, 0)), 0)::int
    as porciones_en_proceso_est,
  (coalesce(pr.lotes, 0) > 0
     and coalesce(round(coalesce(pr.kg, 0) * coalesce(r.porc_por_kg, 0)), 0) = 0)
    as en_proceso_sin_ratio,
  (greatest(0::numeric, base.porciones_camara - base.porciones_traspasadas - base.porciones_merma)
     + coalesce(round(coalesce(pr.kg, 0) * coalesce(r.porc_por_kg, 0)), 0))
    as porciones_proyectadas,
  co.ultimo_conteo_at
from base
left join proceso pr on pr.producto_id = base.producto_id and pr.local = base.local
left join ratio   r  on r.producto_id  = base.producto_id and r.local  = base.local
left join conteo  co on co.producto_id = base.producto_id and co.local = base.local;

comment on column public.v_cocina_stock_pastas.ultimo_conteo_at is
  'Cuando se conto fisicamente por ultima vez este producto en la camara. '
  'NULL = nunca. El stock arranca de ahi y le suma lo posterior, asi que '
  'cuanto mas viejo, menos confiable el numero. La pantalla del deposito lo '
  'muestra en cada renglon y lo pinta de rojo cuando pasa mucho.';

grant select on public.v_cocina_stock_pastas to anon, authenticated, service_role;
