-- 167 · Un gasto con el neto en cero no vale cero
--
-- El EdR resolvía el importe con coalesce(importe_neto, importe_total): si el
-- neto venía NULL usaba el total. Pero el formulario de gastos guardaba CERO
-- cuando el campo quedaba vacío, y coalesce no rescata un cero: el gasto
-- entraba al Estado de Resultados valiendo $0.
--
-- Resultado medido el 3-sep-2026: 76 gastos de 2026 por $14.761.906 —
-- alimentos, bebidas, estructura, inversiones — figuraban cargados y no
-- sumaban nada. El renglon los contaba; la plata no llegaba.
--
-- Un neto de 0 con total > 0 es SIEMPRE un error de carga: no existe una
-- compra que sea 100% IVA. Por eso nullif(): cero se trata como "no cargado"
-- y vale el total, igual que un null.
--
-- La causa tambien se cerro en NuevoGastoModal (mismo commit): ya no se
-- puede guardar un gasto con el neto en cero.

create or replace function public.edr_resumen_gastos(p_local text, p_anio text)
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
      coalesce(nullif(g.importe_neto, 0), g.importe_total) as monto,
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
    coalesce(sum(monto), 0)
  from clasificado
  group by periodo
  order by periodo;
$function$;

create or replace view public.v_edr_gastos_sin_renglon as
select
  g.id,
  g.periodo,
  g.local,
  g.fecha,
  g.proveedor,
  coalesce(nullif(trim(g.categoria), ''), '(sin categoría)') as categoria,
  g.subcategoria,
  coalesce(nullif(g.importe_neto, 0), g.importe_total) as monto
from public.gastos g
where g.cancelado = false
  and public.edr_renglon_de_gasto(g.categoria, g.subcategoria) = 'sin_clasificar';

create or replace view public.v_edr_gastos_invisibles as
select
  g.id,
  g.periodo,
  g.fecha,
  g.local,
  g.proveedor,
  g.categoria,
  g.subcategoria,
  coalesce(nullif(g.importe_neto, 0), g.importe_total) as monto,
  case
    when g.local is null or g.local = '' then 'sin local'
    else 'local desconocido: ' || g.local
  end as motivo
from public.gastos g
where g.cancelado = false
  and (g.local is null or g.local not in ('vedia', 'saavedra', 'sas'));

revoke all on public.v_edr_gastos_sin_renglon from anon;
revoke all on public.v_edr_gastos_invisibles from anon;
grant select on public.v_edr_gastos_sin_renglon to authenticated;
grant select on public.v_edr_gastos_invisibles to authenticated;
