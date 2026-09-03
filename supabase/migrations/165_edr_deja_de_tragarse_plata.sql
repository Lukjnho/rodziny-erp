-- 165 · El EdR deja de tragarse plata en silencio
--
-- EL PROBLEMA
-- edr_resumen_gastos armaba cada renglón con una pregunta independiente
-- ("¿este gasto es de alimentos?", "¿es de bebidas?", ...). Un gasto que
-- contestaba que NO a las once preguntas no iba a ningún lado y nadie se
-- enteraba. Medido sobre 2026: $50.654.837 de gastos cargados que el EdR
-- no muestra en ninguna línea, de ningún local. Julio solo esconde $32,5M.
--
-- Lo invisible era: los aguinaldos (categoría que el EdR no conocía Y sin
-- local), la Bienal 2026, los gastos de RRHH que no son sueldo ni carga
-- social (sindicato, uniformes) y dos gastos con la categoría vacía.
--
-- LA SOLUCIÓN
-- Se da vuelta la lógica: se clasifica cada gasto UNA vez, en un solo
-- renglón, y lo que no encaja en ninguno cae en `sin_clasificar`, que la
-- pantalla muestra. La suma de todos los renglones es ahora, por
-- construcción, el total de gastos del período. No se puede perder plata
-- sin que se vea.
--
-- Columnas nuevas: aguinaldo · bienal · rrhh_otros · sin_clasificar.
-- Las viejas conservan nombre y significado para no romper a quien llama.

-- 1 ─────────────────────────────────────────────────────────────────────
-- Los aguinaldos vuelven a existir.
--
-- AguinaldoTab los grababa con local NULL y el comentario "'Ambos' /
-- empresa". La intención era Empresa, pero el EdR llama Empresa a 'sas',
-- y como pide los gastos local por local, un gasto sin local no aparece
-- ni en Vedia, ni en Saavedra, ni en Empresa. 48 gastos, $22.945.556.
-- Decisión de Lucas (3-sep-2026): van todos a Empresa.
update public.gastos
   set local = 'sas'
 where local is null
   and categoria = 'Aguinaldo';

-- 2 ─────────────────────────────────────────────────────────────────────
-- Un solo idioma para el estado de pago.
-- 2.206 filas decían 'Pagado' y 1 decía 'pagado'. Una consulta escrita con
-- una grafía no ve la otra.
update public.gastos set estado_pago = 'Pagado' where estado_pago = 'pagado';

-- 3 ─────────────────────────────────────────────────────────────────────
-- El resumen de gastos del EdR, con clasificación única.
-- Cambia el tipo de retorno, así que hay que borrarla y crearla de nuevo.
drop function if exists public.edr_resumen_gastos(text, text);

create function public.edr_resumen_gastos(p_local text, p_anio text)
returns table(
  periodo text,
  cmv_alimentos numeric,
  cmv_bebidas numeric,
  cmv_indirectos numeric,
  gastos_op numeric,
  gastos_rrhh numeric,
  impuestos_op numeric,
  inversiones numeric,
  intereses numeric,
  sueldos numeric,
  cargas_sociales numeric,
  arca numeric,
  rrhh_otros numeric,
  aguinaldo numeric,
  bienal numeric,
  sin_clasificar numeric,
  total_gastos numeric
)
language sql
stable
set search_path to 'public'
as $function$
  with normalizado as (
    -- Se normaliza una sola vez: minúsculas y sin tildes. Verificado el
    -- 3-sep-2026: cada categoría tiene UNA sola grafía en la base, así que
    -- normalizar no mueve plata de un renglón a otro.
    select
      g.periodo,
      coalesce(g.importe_neto, g.importe_total) as monto,
      lower(trim(translate(coalesce(g.categoria, ''), 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU'))) as cat,
      lower(trim(translate(coalesce(g.subcategoria, ''), 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU'))) as sub
    from public.gastos g
    where g.local = p_local
      and g.periodo like p_anio || '-%'
      and g.cancelado = false
  ),
  clasificado as (
    -- UN gasto, UN renglón. El orden del CASE es el desempate.
    select
      periodo,
      monto,
      case
        when cat = 'costo de alimentos'              then 'cmv_alimentos'
        when cat = 'costo de bebidas'                then 'cmv_bebidas'
        when cat = 'costos indirectos de operacion'  then 'cmv_indirectos'
        when cat in (
          'gastos administrativos', 'gastos de estructura',
          'gastos de estructura totales', 'gastos de estructuras totales'
        )                                            then 'gastos_op'
        when cat = 'gastos de rrhh' and sub = 'sueldos'          then 'sueldos'
        when cat = 'gastos de rrhh' and sub = 'cargas sociales'  then 'cargas_sociales'
        -- Sindicato, uniformes y los que quedaron sin subcategoría. Antes se
        -- calculaban en gastos_rrhh y la pantalla los descartaba.
        when cat = 'gastos de rrhh'                  then 'rrhh_otros'
        when cat = 'aguinaldo'                       then 'aguinaldo'
        -- La regularización ARCA es extraordinaria: sale de Impuestos y va
        -- al Resultado Financiero.
        when cat = 'impuestos y tasas' and sub = 'regularizacion de impuestos' then 'arca'
        when cat = 'impuestos y tasas'               then 'impuestos_op'
        when cat = 'inversiones'                     then 'inversiones'
        when cat = 'intereses'                       then 'intereses'
        -- Decisión de Lucas (3-sep-2026): la Bienal no ensucia el resultado
        -- operativo. Renglón propio abajo del EBIT, como la regularización.
        when cat = 'bienal 2026'                     then 'bienal'
        else 'sin_clasificar'
      end as renglon
    from normalizado
  )
  select
    periodo,
    coalesce(sum(monto) filter (where renglon = 'cmv_alimentos'), 0),
    coalesce(sum(monto) filter (where renglon = 'cmv_bebidas'), 0),
    coalesce(sum(monto) filter (where renglon = 'cmv_indirectos'), 0),
    coalesce(sum(monto) filter (where renglon = 'gastos_op'), 0),
    -- gastos_rrhh = la categoría entera (sueldos + cargas + el resto).
    coalesce(sum(monto) filter (where renglon in ('sueldos', 'cargas_sociales', 'rrhh_otros')), 0),
    coalesce(sum(monto) filter (where renglon = 'impuestos_op'), 0),
    coalesce(sum(monto) filter (where renglon = 'inversiones'), 0),
    coalesce(sum(monto) filter (where renglon = 'intereses'), 0),
    coalesce(sum(monto) filter (where renglon = 'sueldos'), 0),
    coalesce(sum(monto) filter (where renglon = 'cargas_sociales'), 0),
    coalesce(sum(monto) filter (where renglon = 'arca'), 0),
    coalesce(sum(monto) filter (where renglon = 'rrhh_otros'), 0),
    coalesce(sum(monto) filter (where renglon = 'aguinaldo'), 0),
    coalesce(sum(monto) filter (where renglon = 'bienal'), 0),
    coalesce(sum(monto) filter (where renglon = 'sin_clasificar'), 0),
    -- El control: tiene que dar igual a la suma de todos los renglones.
    coalesce(sum(monto), 0)
  from clasificado
  group by periodo
  order by periodo;
$function$;

comment on function public.edr_resumen_gastos(text, text) is
  'Gastos del año agrupados por mes y por renglón del EdR. Cada gasto cae en UN solo renglón; lo que no encaja en ninguno cae en sin_clasificar, que la pantalla muestra en un cartel. Por construccion: la suma de los renglones = total_gastos. Si alguna vez no cierra, hay un bug en el CASE.';

-- 4 ─────────────────────────────────────────────────────────────────────
-- Los gastos que NINGUNA vista del EdR puede mostrar.
--
-- El EdR pide los gastos local por local ('vedia', 'saavedra', 'sas'), así
-- que un gasto con el local vacío o con un local desconocido no aparece en
-- ninguna de las tres, y el renglón sin_clasificar tampoco lo agarra
-- (nunca llega a la función). Esta vista es el único lugar donde se ven.
-- Debe dar 0 filas.
create or replace view public.v_edr_gastos_invisibles as
select
  g.id,
  g.periodo,
  g.fecha,
  g.local,
  g.proveedor,
  g.categoria,
  g.subcategoria,
  coalesce(g.importe_neto, g.importe_total) as monto,
  case
    when g.local is null or g.local = '' then 'sin local'
    else 'local desconocido: ' || g.local
  end as motivo
from public.gastos g
where g.cancelado = false
  and (g.local is null or g.local not in ('vedia', 'saavedra', 'sas'));

comment on view public.v_edr_gastos_invisibles is
  'Gastos que ninguna vista del EdR puede mostrar porque su local no es vedia/saavedra/sas. Debe dar 0 filas. Si aparece algo, hay plata cargada que no figura en ningun Estado de Resultados, ni siquiera en el consolidado.';

-- Las vistas nuevas nacen legibles por anon: hay que sacarle el permiso.
revoke all on public.v_edr_gastos_invisibles from anon;
grant select on public.v_edr_gastos_invisibles to authenticated;
