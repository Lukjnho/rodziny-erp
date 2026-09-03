-- 166 · La clasificación del EdR vive en UN solo lugar
--
-- La 165 arregló que no se pierda plata, pero para que la pantalla pueda
-- decir QUÉ quedó sin clasificar hacía falta repetir el mismo CASE en una
-- vista. Dos copias de la misma regla es exactamente el problema que
-- estamos arreglando, así que la regla se saca a una función y la usan
-- las dos: el resumen del EdR y la lista de lo que quedó afuera.
--
-- Si mañana se agrega una categoría nueva, se toca acá y nada más.

create or replace function public.edr_renglon_de_gasto(p_categoria text, p_subcategoria text)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  with n as (
    select
      lower(trim(translate(coalesce(p_categoria, ''), 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU'))) as cat,
      lower(trim(translate(coalesce(p_subcategoria, ''), 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU'))) as sub
  )
  select case
    when cat = 'costo de alimentos'              then 'cmv_alimentos'
    when cat = 'costo de bebidas'                then 'cmv_bebidas'
    when cat = 'costos indirectos de operacion'  then 'cmv_indirectos'
    when cat in (
      'gastos administrativos', 'gastos de estructura',
      'gastos de estructura totales', 'gastos de estructuras totales'
    )                                            then 'gastos_op'
    when cat = 'gastos de rrhh' and sub = 'sueldos'          then 'sueldos'
    when cat = 'gastos de rrhh' and sub = 'cargas sociales'  then 'cargas_sociales'
    -- Sindicato, uniformes y los que quedaron sin subcategoría.
    when cat = 'gastos de rrhh'                  then 'rrhh_otros'
    when cat = 'aguinaldo'                       then 'aguinaldo'
    -- La regularización ARCA es extraordinaria: sale de Impuestos y va al
    -- Resultado Financiero.
    when cat = 'impuestos y tasas' and sub = 'regularizacion de impuestos' then 'arca'
    when cat = 'impuestos y tasas'               then 'impuestos_op'
    when cat = 'inversiones'                     then 'inversiones'
    when cat = 'intereses'                       then 'intereses'
    -- Decisión de Lucas (3-sep-2026): la Bienal no ensucia el resultado
    -- operativo. Renglón propio abajo del EBIT, como la regularización.
    when cat = 'bienal 2026'                     then 'bienal'
    else 'sin_clasificar'
  end
  from n;
$function$;

comment on function public.edr_renglon_de_gasto(text, text) is
  'En que renglon del EdR cae un gasto, segun su categoria y subcategoria. UNICA definicion: la usan edr_resumen_gastos y v_edr_gastos_sin_renglon. Devuelve sin_clasificar cuando no encaja en ninguno, y eso la pantalla lo muestra en un cartel. Para agregar una categoria nueva al EdR se toca SOLO esta funcion.';

-- El resumen ahora delega la clasificación.
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
  with clasificado as (
    select
      g.periodo,
      coalesce(g.importe_neto, g.importe_total) as monto,
      public.edr_renglon_de_gasto(g.categoria, g.subcategoria) as renglon
    from public.gastos g
    where g.local = p_local
      and g.periodo like p_anio || '-%'
      and g.cancelado = false
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
  'Gastos del año agrupados por mes y por renglón del EdR. Cada gasto cae en UN solo renglón (ver edr_renglon_de_gasto); lo que no encaja en ninguno cae en sin_clasificar, que la pantalla muestra en un cartel. Por construccion: la suma de los renglones = total_gastos.';

-- La lista de lo que quedó afuera, para que el cartel diga qué revisar.
create or replace view public.v_edr_gastos_sin_renglon as
select
  g.id,
  g.periodo,
  g.local,
  g.fecha,
  g.proveedor,
  coalesce(nullif(trim(g.categoria), ''), '(sin categoría)') as categoria,
  g.subcategoria,
  coalesce(g.importe_neto, g.importe_total) as monto
from public.gastos g
where g.cancelado = false
  and public.edr_renglon_de_gasto(g.categoria, g.subcategoria) = 'sin_clasificar';

comment on view public.v_edr_gastos_sin_renglon is
  'Gastos que no caen en ningun renglon del EdR. Alimenta el cartel del Estado de Resultados. Deberia estar vacia: si hay algo, es plata cargada que el EdR no muestra en ninguna linea.';

revoke all on public.v_edr_gastos_sin_renglon from anon;
grant select on public.v_edr_gastos_sin_renglon to authenticated;
