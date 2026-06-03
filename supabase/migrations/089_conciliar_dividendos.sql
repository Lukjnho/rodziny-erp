-- Conciliación de dividendos pagados por transferencia contra el extracto.
-- Solo dividendos con medio 'transferencia%' (no los auto de Fudo / MP Lucas).
-- Cruza por N° de operación si el movimiento lo trae (ej. Retiro MP), o por
-- monto + fecha (±3 días) + banco cuando hay UN solo candidato (caso MP-a-MP
-- que entra como "VAR" sin N° de op).
ALTER TABLE dividendos ADD COLUMN IF NOT EXISTS conciliado_movimiento_id uuid;

CREATE OR REPLACE FUNCTION conciliar_dividendos(p_desde date, p_hasta date)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_op int := 0;
  v_mf int := 0;
BEGIN
  -- 1) Por N° de operación (cuando el movimiento lo expone)
  WITH m AS (
    SELECT DISTINCT ON (d.id) d.id AS div_id, mov.id AS mov_id
    FROM dividendos d
    JOIN movimientos_bancarios mov
      ON mov.debito > 0 AND mov.gasto_id IS NULL
     AND regexp_replace(COALESCE(mov.referencia, ''), '\D', '', 'g')
         = regexp_replace(COALESCE(d.numero_operacion, ''), '\D', '', 'g')
     AND length(regexp_replace(COALESCE(d.numero_operacion, ''), '\D', '', 'g')) >= 6
     AND (
       (d.medio_pago ILIKE '%mp%' OR d.medio_pago ILIKE '%mercado%') AND mov.cuenta = 'mercadopago'
       OR d.medio_pago ILIKE '%galicia%' AND mov.cuenta = 'galicia'
       OR d.medio_pago ILIKE '%icbc%' AND mov.cuenta = 'icbc'
     )
    WHERE d.conciliado_movimiento_id IS NULL
      AND d.medio_pago ILIKE 'transferencia%'
      AND d.fecha BETWEEN p_desde AND p_hasta
  ),
  u AS (
    UPDATE dividendos d SET conciliado_movimiento_id = m.mov_id
    FROM m WHERE d.id = m.div_id
    RETURNING 1
  )
  SELECT count(*) INTO v_op FROM u;

  -- 2) Por monto + fecha + banco, solo si hay UN único movimiento candidato libre
  WITH cand AS (
    SELECT d.id AS div_id,
      (SELECT array_agg(mov.id)
         FROM movimientos_bancarios mov
        WHERE mov.debito > 0 AND mov.gasto_id IS NULL
          AND ABS(mov.debito - d.monto) < 1
          AND mov.fecha BETWEEN d.fecha - 3 AND d.fecha + 3
          AND (
            (d.medio_pago ILIKE '%mp%' OR d.medio_pago ILIKE '%mercado%') AND mov.cuenta = 'mercadopago'
            OR d.medio_pago ILIKE '%galicia%' AND mov.cuenta = 'galicia'
            OR d.medio_pago ILIKE '%icbc%' AND mov.cuenta = 'icbc'
          )
          AND NOT EXISTS (SELECT 1 FROM dividendos d2 WHERE d2.conciliado_movimiento_id = mov.id)
      ) AS movs
    FROM dividendos d
    WHERE d.conciliado_movimiento_id IS NULL
      AND d.medio_pago ILIKE 'transferencia%'
      AND d.fecha BETWEEN p_desde AND p_hasta
  ),
  u2 AS (
    UPDATE dividendos d SET conciliado_movimiento_id = cand.movs[1]
    FROM cand
    WHERE d.id = cand.div_id AND cand.movs IS NOT NULL AND array_length(cand.movs, 1) = 1
    RETURNING 1
  )
  SELECT count(*) INTO v_mf FROM u2;

  RETURN jsonb_build_object('por_op', v_op, 'por_monto_fecha', v_mf);
END $$;
