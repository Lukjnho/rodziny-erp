-- ============================================================================
-- 142 — El EdR lee solo la fuente oficial de ventas
-- ============================================================================
-- Preparación para el shadow mode: cuando el POS propio empiece a cobrar en
-- paralelo con Fudo, la misma venta va a existir de los dos lados. Sin este
-- filtro el Estado de Resultados contaría cada venta dos veces.
--
-- Hoy no cambia ningún número: todas las filas existentes tienen origen='fudo'
-- (default de la migración 141). Verificado antes y después.
--
-- Espejo del lado del frente: src/lib/origenVentas.ts. Cuando un local deje de
-- usar Fudo hay que cambiar LOS DOS.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.edr_resumen_ventas(p_local text, p_anio text)
RETURNS TABLE(periodo text, ing_bruto numeric, iva_debito numeric, ticket_count bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  select
    periodo,
    sum(total_bruto) as ing_bruto,
    sum(coalesce(iva, 0)) as iva_debito,
    count(*) as ticket_count
  from ventas_tickets
  where local = p_local
    and periodo >= p_anio || '-01'
    and periodo <= p_anio || '-12'
    and estado != 'Cancelada'
    and estado != 'Eliminada'
    and coalesce(es_dividendo, false) = false
    and origen = 'fudo'   -- shadow mode: no mezclar con las ventas del POS propio
  group by periodo
$function$;
