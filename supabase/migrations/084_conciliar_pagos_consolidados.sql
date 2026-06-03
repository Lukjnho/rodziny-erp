-- Concilia transferencias consolidadas: 1 transferencia (Retiro MP, etc.) que paga
-- N gastos. Agrupa pagos por N° de operación; si la suma del grupo = el débito de
-- un movimiento con esa misma referencia, marca TODOS los pagos del grupo como
-- conciliados contra ese movimiento (relación 1:N vía conciliado_movimiento_id).
-- La igualdad de suma desambigua falsos positivos (ej: el "Impuesto al débito"
-- comparte los dígitos de op pero su monto no coincide). Si empata, prefiere el
-- movimiento "Retiro MP".
CREATE OR REPLACE FUNCTION conciliar_pagos_consolidados(
  p_fecha_desde date,
  p_fecha_hasta date
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_grupos int := 0;
  v_pagos  int := 0;
BEGIN
  WITH grupos AS (
    SELECT regexp_replace(p.numero_operacion, '\D', '', 'g') AS op_dig,
           SUM(p.monto)        AS suma,
           array_agg(p.id)     AS pago_ids
    FROM pagos_gastos p
    WHERE COALESCE(p.numero_operacion, '') <> ''
      AND length(regexp_replace(p.numero_operacion, '\D', '', 'g')) >= 6
      AND p.conciliado_movimiento_id IS NULL
      AND p.fecha_pago BETWEEN p_fecha_desde AND p_fecha_hasta
    GROUP BY 1
  ),
  mov AS (
    SELECT DISTINCT ON (op_dig) op_dig, mov_id, pago_ids
    FROM (
      SELECT g.op_dig, g.pago_ids, m.id AS mov_id,
             (m.descripcion ILIKE 'Retiro MP%') AS es_retiro
      FROM grupos g
      JOIN movimientos_bancarios m
        ON m.debito > 0
       AND regexp_replace(COALESCE(m.referencia, ''), '\D', '', 'g') = g.op_dig
       AND ABS(m.debito - g.suma) < 1
    ) x
    ORDER BY op_dig, es_retiro DESC
  ),
  upd AS (
    UPDATE pagos_gastos p
    SET conciliado_movimiento_id = mov.mov_id
    FROM mov
    WHERE p.id = ANY(mov.pago_ids)
    RETURNING mov.mov_id
  )
  SELECT COUNT(DISTINCT mov_id), COUNT(*) INTO v_grupos, v_pagos FROM upd;

  -- Vincular el movimiento al primer gasto del grupo (link 1:1) si está libre,
  -- para que el Retiro no quede listado en "Movimientos por procesar".
  UPDATE movimientos_bancarios m
  SET gasto_id = sub.gasto_id
  FROM (
    SELECT DISTINCT ON (p.conciliado_movimiento_id)
           p.conciliado_movimiento_id AS mov_id,
           p.gasto_id
    FROM pagos_gastos p
    WHERE p.conciliado_movimiento_id IS NOT NULL
    ORDER BY p.conciliado_movimiento_id, p.fecha_pago
  ) sub
  WHERE m.id = sub.mov_id AND m.gasto_id IS NULL;

  RETURN jsonb_build_object('grupos', v_grupos, 'pagos', v_pagos);
END $$;
