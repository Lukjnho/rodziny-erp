-- Fix: edr_resumen_gastos no matcheaba la categoría "Gastos de estructura"
-- (sin "totales"). Se perdían gastos al sumar gastos_op del EdR.
-- Variantes válidas para gastos_op:
--   - "Gastos administrativos"
--   - "Gastos de estructura"           ← NUEVO
--   - "Gastos de estructura totales"
--   - "Gastos de estructuras totales"  (con "s" plural — ya estaba)

CREATE OR REPLACE FUNCTION public.edr_resumen_gastos(p_local text, p_anio text)
 RETURNS TABLE(periodo text, cmv_alimentos numeric, cmv_bebidas numeric, cmv_indirectos numeric, gastos_op numeric, gastos_rrhh numeric, impuestos_op numeric, inversiones numeric, intereses numeric, sueldos numeric, cargas_sociales numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    g.periodo,

    SUM(CASE WHEN TRIM(g.categoria) = 'Costo de alimentos'
      THEN COALESCE(g.importe_neto, g.importe_total) ELSE 0 END) AS cmv_alimentos,

    SUM(CASE WHEN TRIM(g.categoria) = 'Costo de bebidas'
      THEN COALESCE(g.importe_neto, g.importe_total) ELSE 0 END) AS cmv_bebidas,

    SUM(CASE WHEN LOWER(TRIM(TRANSLATE(g.categoria, 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU'))) = 'costos indirectos de operacion'
      THEN COALESCE(g.importe_neto, g.importe_total) ELSE 0 END) AS cmv_indirectos,

    SUM(CASE WHEN LOWER(TRIM(TRANSLATE(g.categoria, 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU'))) IN (
      'gastos administrativos',
      'gastos de estructura',
      'gastos de estructura totales',
      'gastos de estructuras totales'
    ) THEN COALESCE(g.importe_neto, g.importe_total) ELSE 0 END) AS gastos_op,

    SUM(CASE WHEN TRIM(g.categoria) = 'Gastos de RRHH'
      THEN COALESCE(g.importe_neto, g.importe_total) ELSE 0 END) AS gastos_rrhh,

    SUM(CASE WHEN LOWER(TRIM(TRANSLATE(g.categoria, 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU'))) = 'impuestos y tasas'
      THEN COALESCE(g.importe_neto, g.importe_total) ELSE 0 END) AS impuestos_op,

    SUM(CASE WHEN TRIM(g.categoria) = 'Inversiones'
      THEN COALESCE(g.importe_neto, g.importe_total) ELSE 0 END) AS inversiones,

    SUM(CASE WHEN TRIM(g.categoria) = 'Intereses'
      THEN COALESCE(g.importe_neto, g.importe_total) ELSE 0 END) AS intereses,

    SUM(CASE WHEN TRIM(g.categoria) = 'Gastos de RRHH'
      AND LOWER(TRIM(g.subcategoria)) = 'sueldos'
      THEN COALESCE(g.importe_neto, g.importe_total) ELSE 0 END) AS sueldos,

    SUM(CASE WHEN TRIM(g.categoria) = 'Gastos de RRHH'
      AND LOWER(TRIM(g.subcategoria)) = 'cargas sociales'
      THEN COALESCE(g.importe_neto, g.importe_total) ELSE 0 END) AS cargas_sociales

  FROM gastos g
  WHERE g.local = p_local
    AND g.periodo LIKE p_anio || '-%'
    AND g.cancelado = false
  GROUP BY g.periodo
  ORDER BY g.periodo;
$function$;
