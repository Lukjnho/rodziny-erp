-- Concilia sueldos pagados por transferencia contra el extracto. Igual lógica que
-- conciliar_pagos_consolidados pero sobre pagos_sueldos: una transferencia (Retiro)
-- suele pagar a varios empleados → agrupa por N° op + banco; si la suma del grupo =
-- débito del movimiento de ese banco con esa referencia, vincula los N pagos (1:N).
CREATE OR REPLACE FUNCTION conciliar_sueldos_consolidados(
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
           p.cuenta,
           SUM(p.monto)    AS suma,
           array_agg(p.id) AS pago_ids
    FROM pagos_sueldos p
    WHERE COALESCE(p.numero_operacion, '') <> ''
      AND length(regexp_replace(p.numero_operacion, '\D', '', 'g')) >= 6
      AND p.conciliado_movimiento_id IS NULL
      AND p.medio_pago = 'transferencia'
      AND p.fecha_pago BETWEEN p_fecha_desde AND p_fecha_hasta
    GROUP BY 1, 2
  ),
  mov AS (
    SELECT DISTINCT ON (op_dig, cuenta) op_dig, cuenta, mov_id, pago_ids
    FROM (
      SELECT g.op_dig, g.cuenta, g.pago_ids, m.id AS mov_id,
             (m.descripcion ILIKE 'Retiro MP%') AS es_retiro
      FROM grupos g
      JOIN movimientos_bancarios m
        ON m.debito > 0
       AND (g.cuenta IS NULL OR m.cuenta = g.cuenta)
       AND regexp_replace(COALESCE(m.referencia, ''), '\D', '', 'g') = g.op_dig
       AND ABS(m.debito - g.suma) < 1
    ) x
    ORDER BY op_dig, cuenta, es_retiro DESC
  ),
  upd AS (
    UPDATE pagos_sueldos p
    SET conciliado_movimiento_id = mov.mov_id
    FROM mov
    WHERE p.id = ANY(mov.pago_ids)
    RETURNING mov.mov_id
  )
  SELECT COUNT(DISTINCT mov_id), COUNT(*) INTO v_grupos, v_pagos FROM upd;

  RETURN jsonb_build_object('grupos', v_grupos, 'pagos', v_pagos);
END $$;
