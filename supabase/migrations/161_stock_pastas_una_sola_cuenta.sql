-- 161 — Una sola cuenta de stock de pastas: tres capas dentro de la misma vista.
--
-- EL PROBLEMA. Preguntarle al sistema cuántos Sorrentinos hay en la cámara de
-- Vedia daba CUATRO respuestas distintas al mismo tiempo (3-sep-2026):
--     v_cocina_stock_pastas neto ..... 393   (arranca del conteo físico)
--     v_stock_pastas_test ............ 416   (idem + las bandejas estimadas)
--     v_cocina_lote_pasta_saldo ...... 684   (sin conteo físico)
--     cocina_stock_actual ............ 718   (sin conteo físico y sin filtrar ubicación)
--
-- Y esta vista no exponía ningún NETO, así que cada pantalla hacía su propia
-- resta: Dashboard, Traspasos y el panel de Compras restaban una cosa; el Plan
-- de Producción y el Resumen Semanal otra; y StockTab reimplementaba la vista
-- entera en TypeScript. Tres definiciones de "disponible" para el mismo hecho.
--
-- LO QUE SE AGREGA. Cinco columnas al final. Las 10 que ya existían quedan
-- EXACTAS (verificado producto por producto en los dos locales: 0 diferencias),
-- así que ninguna de las 6 pantallas se rompe y pueden migrar de a una.
--
--   porciones_neto_camara ....... (1) VENDIBLE HOY. Pasta porcionada, en cámara.
--   bandejas_en_proceso ......... el dato crudo: bandejas armadas sin porcionar.
--   porciones_en_proceso_est .... (2) esas bandejas traducidas a porciones.
--   en_proceso_sin_ratio ........ hay algo en el freezer y NO se puede estimar.
--   porciones_proyectadas ....... (3) (1) + (2). El número del que PLANIFICA.
--
-- POR QUÉ TRES Y NO UNO. La pasta armada existe pero todavía no se puede
-- vender. Quien mueve mercadería necesita (1); quien planifica necesita (3).
-- Sumarlas en un solo número deja al que traslada creyendo que puede bajar al
-- mostrador bandejas que nadie cortó.
--
-- EL ORIGEN DE ESTAS 5 COLUMNAS. Ya existían en `v_stock_pastas_test`, una
-- vista que alguna sesión anterior dejó VIVA EN PRODUCCIÓN, fuera del
-- repositorio y sin que una sola línea de TypeScript la leyera. Se absorbe acá
-- y se borra al final, para que no quede una quinta cuenta flotando.
--
-- DECISIONES QUE VALE LA PENA NO PERDER:
--
-- · Se estima por KILOS, no por bandejas. Las pastas extrudadas (Radiatori,
--   Rigatoni, Tagliatelles) no tienen cantidad_cajones cargado, así que el
--   ratio por bandeja les da NULL. Y el tamaño de bandeja varía tanto que el
--   desvío de Sorrentinos por bandeja es 3,70 sobre una media de 5,05; por kilo
--   es estable.
--
-- · Se usa MEDIANA, no promedio. Alcanzan 6 filas con relleno_kg cargado en
--   gramos para envenenar 120 días de historia: el promedio crudo da 0,23
--   porciones/kg para el Scarpinocc cuando el real es 3,76 (16 veces menos).
--
-- · relleno_kg > 50 se interpreta como GRAMOS y se divide por 1000. Es un
--   landmine conocido de la carga por QR.
--
-- · El neto NO resta las ventas de Fudo. El traspaso ya sacó esa pasta de la
--   cámara; restar las dos cosas cuenta el egreso dos veces. En Vedia hay 492
--   traspasos registrados; en Saavedra no existe el circuito cámara→mostrador
--   (0 traspasos de siempre) y el cierre diario ES el reconteo físico.
--
-- · El neto NO suma porciones_ajuste_mostrador. Esa columna es un acumulado
--   histórico SIN baseline (713 porciones en Vedia, 167 solo de Ñoquis de
--   papa): sumarla infla el stock de la nada.

create or replace view public.v_cocina_stock_pastas as
with base as (
  -- ── Las 10 columnas que ya existían, sin tocar una coma (mig 125) ──────────
  select p.id as producto_id, p.nombre, p.codigo, p.local, p.minimo_produccion,
    coalesce(b.cantidad_real, 0::numeric)
      + coalesce((select sum(lp.porciones) from cocina_lotes_pasta lp
                   where lp.producto_id = p.id and lp.local = p.local
                     and lp.ubicacion = 'camara_congelado'
                     and (b.created_at is null or coalesce(lp.porcionado_at, lp.created_at) > b.created_at)), 0::bigint)::numeric
      + coalesce((select sum(a.delta) from cocina_ajustes_stock a
                   where a.producto_id = p.id and a.local = p.local and a.ubicacion = 'camara'
                     and (b.created_at is null or a.created_at > b.created_at)), 0::numeric) as porciones_camara,
    coalesce((select sum(lp.porciones) from cocina_lotes_pasta lp
               where lp.producto_id = p.id and lp.local = p.local
                 and lp.ubicacion = 'freezer_produccion'), 0::bigint)::numeric as porciones_fresco,
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

comment on column public.v_cocina_stock_pastas.porciones_fresco is
  'DEPRECADA: da 0 SIEMPRE. Suma lp.porciones de los lotes en '
  'freezer_produccion, pero en esa etapa las porciones son NULL (se cargan '
  'recien al porcionar); lo que hay es cantidad_cajones. Usar '
  'bandejas_en_proceso o porciones_en_proceso_est. Se borra cuando las 6 '
  'pantallas hayan migrado.';

comment on column public.v_cocina_stock_pastas.porciones_ajuste_mostrador is
  'Acumulado historico SIN baseline de conteo. NUNCA sumar a un neto de camara: '
  'infla el stock de la nada (713 porciones en Vedia, 167 solo de Noquis de papa).';

comment on column public.v_cocina_stock_pastas.porciones_neto_camara is
  'VENDIBLE HOY: camara - traspasos - merma, clampeado a 0. NO resta ventas de '
  'Fudo (el traspaso ya saco esa pasta de la camara) ni suma ajuste_mostrador.';

comment on column public.v_cocina_stock_pastas.porciones_en_proceso_est is
  'Bandejas armadas traducidas a porciones: kg en freezer x mediana de '
  'porciones/kg del producto (120 dias). Estimacion, no conteo. NUNCA sumarla '
  'al neto de camara.';

comment on column public.v_cocina_stock_pastas.porciones_proyectadas is
  'Para PLANIFICAR: neto de camara + lo armado sin porcionar. Prohibido usarla '
  'en Traspasos o Mostrador: habilitaria trasladar bandejas sin cortar.';

-- Los permisos los hereda de la vista anterior (anon y authenticated ya tenian
-- SELECT: el QR de produccion lee sin sesion). Se reafirman por si acaso.
grant select on public.v_cocina_stock_pastas to anon, authenticated, service_role;

-- ── PENDIENTE, a proposito: la vista huerfana NO se borra acá ───────────────
-- v_stock_pastas_test quedo viva en produccion, fuera del repositorio y sin un
-- solo lector en el codigo. Su logica es la que quedo arriba, asi que ya no
-- tiene razon de existir. Pero borrar es destructivo y esta migracion es
-- puramente aditiva a proposito: si algo sale mal, no hay nada que revertir.
-- El DROP va en una migracion aparte, con el OK explicito de Lucas:
--     drop view if exists public.v_stock_pastas_test;
