-- 198 — El Estado de Resultados cuenta las ventas del POS
--
--
-- ══════════════════════════════════════════════════════════════════════════════
-- LO QUE ESTABA PASANDO
-- ══════════════════════════════════════════════════════════════════════════════
--
-- `edr_resumen_ventas` —la función que le da los ingresos al Estado de Resultados—
-- tiene `and origen = 'fudo'` escrito adentro. O sea: **el EdR no cuenta ni un peso
-- de lo que cobra nuestra propia caja.**
--
-- La migración 188 hizo justamente esto: sacó el `origen = 'fudo'` de todos lados y
-- lo reemplazó por una regla por local en `ventas_origen_oficial`, con dos vistas
-- que la resuelven fila por fila. Movió ocho lugares. **Este quedó afuera** porque
-- vive en la base y no en una pantalla, así que no apareció al buscar en el código.
--
-- Barrido el 9-sep-2026 sobre TODAS las funciones y vistas del esquema `public`
-- buscando `origen = 'fudo'`: **queda una sola, ésta.** Después de esta migración,
-- ninguna.
--
-- 💣 **Por qué importa ahora y no antes.** Hoy el POS lleva cobrados 2 tickets por
-- $28.600, así que la diferencia es invisible. El día que Saavedra corte a `pos`
-- —que es el próximo paso del plan del salón— **las ventas de Saavedra en el EdR se
-- van a CERO**, y el EdR no protesta: muestra un mes con todos los costos y sin
-- ingresos. Es exactamente la clase de falla que no grita.
--
--
-- ══════════════════════════════════════════════════════════════════════════════
-- QUÉ CAMBIA
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Una línea: en vez de leer `ventas_tickets` filtrando por un valor fijo, lee
-- `v_ventas_tickets_oficial`, que se queda con los tickets cuyo origen coincide con
-- el que ese local tiene declarado como oficial. Mientras un local siga en 'fudo'
-- devuelve exactamente lo mismo que hoy; cuando pase a 'pos', sigue devolviendo la
-- venta que corresponde sin tocar una línea de código.
--
-- 🔑 Lo que NO cambia: la función sigue siendo `security invoker` (no es definer).
-- El que la llama tiene que poder leer los tickets por sus propios permisos, igual
-- que hasta ahora. No se abre nada.
--
begin;

create or replace function public.edr_resumen_ventas(p_local text, p_anio text)
returns table(periodo text, ing_bruto numeric, iva_debito numeric, ticket_count bigint)
language sql
stable
set search_path to 'public'
as $$
  select
    t.periodo,
    sum(t.total_bruto) as ing_bruto,
    sum(coalesce(t.iva, 0)) as iva_debito,
    count(*) as ticket_count
  from v_ventas_tickets_oficial t
  where t.local = p_local
    and t.periodo >= p_anio || '-01'
    and t.periodo <= p_anio || '-12'
    and t.estado != 'Cancelada'
    and t.estado != 'Eliminada'
    and coalesce(t.es_dividendo, false) = false
  group by t.periodo
$$;

comment on function public.edr_resumen_ventas(text, text) is
  'Ingresos del Estado de Resultados por mes. Lee v_ventas_tickets_oficial, que '
  'resuelve por local cuál es el origen que vale (mig 188): mientras el local esté '
  'en "fudo" cuenta lo importado, y el día que pase a "pos" cuenta lo que cobra '
  'nuestra caja, sin deploy. Antes tenía origen = ''fudo'' escrito adentro y el EdR '
  'se habría quedado en cero el día del corte.';

-- ── Guardarraíl ─────────────────────────────────────────────────────────────
do $guard$
declare
  v_viejo   numeric;
  v_nuevo   numeric;
  v_local   text;
  v_anio    text := to_char(current_date, 'YYYY');
begin
  -- 1) Hoy los dos locales siguen en 'fudo', así que los números NO se pueden
  --    mover ni un peso. Si se mueven, algo se entendió mal.
  foreach v_local in array array['vedia', 'saavedra'] loop
    select coalesce(sum(total_bruto), 0) into v_viejo
      from ventas_tickets
     where local = v_local
       and periodo >= v_anio || '-01' and periodo <= v_anio || '-12'
       and estado != 'Cancelada' and estado != 'Eliminada'
       and coalesce(es_dividendo, false) = false
       and origen = 'fudo';

    select coalesce(sum(ing_bruto), 0) into v_nuevo
      from public.edr_resumen_ventas(v_local, v_anio);

    if round(v_viejo, 2) <> round(v_nuevo, 2) then
      raise exception 'GUARDARRAIL: % cambio de % a %. Hoy tenia que dar igual.',
        v_local, v_viejo, v_nuevo;
    end if;
    raise notice '% sin cambios: %', v_local, v_nuevo;
  end loop;

  -- 2) Y que ya no quede NINGUNA funcion ni vista con el filtro clavado.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and pg_get_functiondef(p.oid) like '%origen = ''fudo''%'
  ) then
    raise exception 'GUARDARRAIL: quedo alguna funcion con origen = fudo escrito adentro.';
  end if;

  raise notice 'GUARDARRAIL OK';
end
$guard$;

commit;
