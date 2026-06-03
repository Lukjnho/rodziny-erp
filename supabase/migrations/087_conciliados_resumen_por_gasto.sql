-- Resumen por gasto de los movimientos conciliados (link 1:1) en un rango.
-- Suma/cuenta en el servidor SIN límite de filas, para que el panel "Conciliados
-- en este período" no calcule mal el total de los cargos consolidados con miles de
-- movimientos (retenciones/comisiones MP), que con el límite de 2000 del cliente
-- mostraban un Σ incompleto y una falsa alerta de desfase.
CREATE OR REPLACE FUNCTION conciliados_resumen_por_gasto(
  p_desde date,
  p_hasta date,
  p_cuenta text DEFAULT NULL
) RETURNS TABLE (gasto_id uuid, n_movs bigint, total_debito numeric)
LANGUAGE sql
STABLE
AS $$
  SELECT m.gasto_id, COUNT(*)::bigint, COALESCE(SUM(m.debito), 0)
  FROM movimientos_bancarios m
  WHERE m.gasto_id IS NOT NULL
    AND m.fecha BETWEEN p_desde AND p_hasta
    AND (p_cuenta IS NULL OR p_cuenta = 'todos' OR m.cuenta = p_cuenta)
  GROUP BY m.gasto_id;
$$;
