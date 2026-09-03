-- ─────────────────────────────────────────────────────────────────────────────
-- 163 · Se va porciones_fresco: la columna que daba 0 siempre
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ ERA. Sumaba lp.porciones de los lotes en 'freezer_produccion' para
-- mostrar "la pasta fresca sin porcionar". Pero en esa etapa las porciones son
-- NULL: se cargan recién en el paso "Porcionar pasta" del QR. Lo que existe en
-- la bandeja es cantidad_cajones. O sea que la columna devolvía 0 en el 100% de
-- los casos, en los dos locales, desde el día uno.
--
-- QUÉ ROMPÍA. Cuatro pantallas la leían creyendo que era la pasta armada:
--   · Dashboard mostraba "+ N porc. en cola" → la línea nunca aparecía.
--   · Plan de Producción y Resumen Semanal hacían neto + fresco → sumaban 0,
--     no veían lo ya producido, y pedían producir de nuevo.
--   · El panel de Compras mostraba una columna "Frescos" siempre vacía.
-- En Vedia, desde junio, 130 de 229 lotes pasaron más de 12 horas invisibles:
-- 9.128 porciones que el plan no veía.
--
-- QUÉ LA REEMPLAZA (migración 161): bandejas_en_proceso (el dato crudo que la
-- persona cuenta en el freezer), porciones_en_proceso_est (esas bandejas
-- traducidas por kilos, estimación) y en_proceso_sin_ratio (hay algo y no se
-- puede estimar → mostrar "?" en vez de un 0 que miente).
--
-- POR QUÉ SE PUEDE BORRAR AHORA. Las 6 pantallas ya migraron:
--   compras/PastasTerminadasPanel · cocina/TraspasosTab · cocina/DashboardTab
--   cocina/components/ResumenSemanalCard · cocina/components/PlanProduccionEditor
--   cocina/StockTab
-- Verificado antes de aplicar:
--   · grep en todo src/: 0 lecturas (solo comentarios que cuentan la historia).
--   · pg_depend: 0 vistas o reglas dependen de v_cocina_stock_pastas.
-- Se borra una COLUMNA CALCULADA de una vista. No se toca ninguna tabla ni se
-- pierde un solo dato: los lotes en freezer siguen enteros, con sus kilos, sus
-- bandejas y sus fechas.
--
-- Hace falta drop + create (no basta create or replace): Postgres no deja
-- sacarle columnas a una vista existente. Y el drop se lleva los grants, así
-- que hay que volver a darlos al final — anon incluido, porque el QR de
-- producción lee sin sesión.
-- ─────────────────────────────────────────────────────────────────────────────

drop view if exists public.v_cocina_stock_pastas;

create view public.v_cocina_stock_pastas as
with base as (
  -- Idéntico a la mig 161, MENOS porciones_fresco.
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
    -- El baseline: el último conteo físico. En Saavedra se produce y se
    -- almacena en la MISMA cámara, así que el cierre de turno de pastas ES el
    -- conteo de cámara. En Vedia el cierre de turno es del MOSTRADOR (otro
    -- lugar físico) y por eso NO entra acá — eso es correcto, no un olvido.
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
  -- Porciones por kilo: MEDIANA por producto y local, últimos 120 días.
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
  -- Lo que está armado en el freezer de producción, esperando el porcionado.
  select lp.producto_id, lp.local,
         sum(coalesce(lp.masa_kg, 0)
             + case when coalesce(lp.relleno_kg, 0) > 50 then lp.relleno_kg / 1000.0
                    else coalesce(lp.relleno_kg, 0) end) as kg,
         sum(coalesce(lp.cantidad_cajones, 0)) as bandejas,
         count(*) as lotes
  from cocina_lotes_pasta lp
  where lp.ubicacion = 'freezer_produccion'
  group by lp.producto_id, lp.local
)
select
  base.*,
  -- (1) VENDIBLE HOY. Nunca negativo: la regla de la casa es que el stock
  --     como mínimo es 0, no un número rojo.
  greatest(0::numeric, base.porciones_camara - base.porciones_traspasadas - base.porciones_merma)
    as porciones_neto_camara,
  coalesce(pr.bandejas, 0)::int
    as bandejas_en_proceso,
  -- (2) Las bandejas traducidas. Va SIEMPRE en columna aparte: es una promesa,
  --     no mercadería que se pueda bajar al mostrador.
  coalesce(round(coalesce(pr.kg, 0) * coalesce(r.porc_por_kg, 0)), 0)::int
    as porciones_en_proceso_est,
  -- Hay algo en el freezer y no se puede poner un número: o el producto no
  -- tiene historial para estimar, o el lote se cargó sin kilos. Mostrar "?" en
  -- pantalla, nunca un 0 que parezca "no hay nada".
  (coalesce(pr.lotes, 0) > 0
     and coalesce(round(coalesce(pr.kg, 0) * coalesce(r.porc_por_kg, 0)), 0) = 0)
    as en_proceso_sin_ratio,
  -- (3) El número del que PLANIFICA: lo que va a haber cuando se termine de
  --     porcionar lo que ya está armado.
  (greatest(0::numeric, base.porciones_camara - base.porciones_traspasadas - base.porciones_merma)
     + coalesce(round(coalesce(pr.kg, 0) * coalesce(r.porc_por_kg, 0)), 0))
    as porciones_proyectadas
from base
left join proceso pr on pr.producto_id = base.producto_id and pr.local = base.local
left join ratio   r  on r.producto_id  = base.producto_id and r.local  = base.local;

-- ── Qué usa cada quién ───────────────────────────────────────────────────────
comment on view public.v_cocina_stock_pastas is
  'Stock de pastas terminadas, en tres capas. porciones_neto_camara = vendible '
  'HOY (lo usan Traspasos y Mostrador). porciones_proyectadas = neto + lo '
  'armado sin porcionar (lo usan Plan de Produccion y Resumen Semanal). '
  'Ninguna pantalla debe volver a hacer la resta por su cuenta.';

comment on column public.v_cocina_stock_pastas.porciones_ajuste_mostrador is
  'Acumulado historico SIN baseline de conteo. NUNCA sumar a un neto de camara: '
  'infla el stock de la nada (713 porciones en Vedia, 167 solo de Noquis de papa).';

comment on column public.v_cocina_stock_pastas.porciones_neto_camara is
  'VENDIBLE HOY: camara - traspasos - merma, clampeado a 0. NO resta ventas de '
  'Fudo (el traspaso ya saco esa pasta de la camara) ni suma ajuste_mostrador.';

comment on column public.v_cocina_stock_pastas.bandejas_en_proceso is
  'Bandejas armadas en freezer_produccion, sin porcionar. Es el dato CRUDO que '
  'la persona ve y cuenta. Reemplaza a la vieja porciones_fresco (mig 163).';

comment on column public.v_cocina_stock_pastas.porciones_en_proceso_est is
  'Bandejas armadas traducidas a porciones: kg en freezer x mediana de '
  'porciones/kg del producto (120 dias). Estimacion, no conteo. NUNCA sumarla '
  'al neto de camara.';

comment on column public.v_cocina_stock_pastas.porciones_proyectadas is
  'Para PLANIFICAR: neto de camara + lo armado sin porcionar. Prohibido usarla '
  'en Traspasos o Mostrador: habilitaria trasladar bandejas sin cortar.';

grant select on public.v_cocina_stock_pastas to anon, authenticated, service_role;
