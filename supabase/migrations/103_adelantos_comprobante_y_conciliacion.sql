-- 103 — Adelantos: comprobante + N° de operación + conciliación bancaria
--
-- Un adelanto pagado por transferencia es un egreso bancarizado real (sale plata
-- de MP/Galicia), así que debe exigir comprobante + N° de op y poder conciliarse
-- contra el extracto, igual que sueldos y dividendos.
--
-- Espeja el modelo de `dividendos` (medio_pago + numero_operacion + comprobante_path
-- + conciliado_movimiento_id) y agrega la RPC conciliar_adelantos, calcada de
-- conciliar_dividendos (matchea por N° de op y, en su defecto, por monto+fecha+banco
-- cuando hay un único movimiento candidato libre).

-- ── Columnas nuevas en adelantos ────────────────────────────────────────────
-- conciliado_movimiento_id ya existe (agregada 2026-06-05).
ALTER TABLE adelantos ADD COLUMN IF NOT EXISTS medio_pago text;
ALTER TABLE adelantos ADD COLUMN IF NOT EXISTS numero_operacion text;
ALTER TABLE adelantos ADD COLUMN IF NOT EXISTS comprobante_path text;

-- ── RPC de conciliación de adelantos por transferencia ──────────────────────
CREATE OR REPLACE FUNCTION public.conciliar_adelantos(p_desde date, p_hasta date)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_op int := 0;
  v_mf int := 0;
BEGIN
  -- 1) Por N° de operación (cuando el movimiento lo expone en la referencia)
  WITH m AS (
    SELECT DISTINCT ON (a.id) a.id AS adel_id, mov.id AS mov_id
    FROM adelantos a
    JOIN movimientos_bancarios mov
      ON mov.debito > 0 AND mov.gasto_id IS NULL
     AND regexp_replace(COALESCE(mov.referencia, ''), '\D', '', 'g')
         = regexp_replace(COALESCE(a.numero_operacion, ''), '\D', '', 'g')
     AND length(regexp_replace(COALESCE(a.numero_operacion, ''), '\D', '', 'g')) >= 6
     AND (
       (a.medio_pago ILIKE '%mp%' OR a.medio_pago ILIKE '%mercado%') AND mov.cuenta = 'mercadopago'
       OR a.medio_pago ILIKE '%galicia%' AND mov.cuenta = 'galicia'
       OR a.medio_pago ILIKE '%icbc%' AND mov.cuenta = 'icbc'
     )
    WHERE a.conciliado_movimiento_id IS NULL
      AND a.medio_pago ILIKE 'transferencia%'
      AND a.fecha BETWEEN p_desde AND p_hasta
  ),
  u AS (
    UPDATE adelantos a SET conciliado_movimiento_id = m.mov_id
    FROM m WHERE a.id = m.adel_id
    RETURNING 1
  )
  SELECT count(*) INTO v_op FROM u;

  -- 2) Por monto + fecha + banco, solo si hay UN único movimiento candidato libre
  WITH cand AS (
    SELECT a.id AS adel_id,
      (SELECT array_agg(mov.id)
         FROM movimientos_bancarios mov
        WHERE mov.debito > 0 AND mov.gasto_id IS NULL
          AND ABS(mov.debito - a.monto) < 1
          AND mov.fecha BETWEEN a.fecha - 3 AND a.fecha + 3
          AND (
            (a.medio_pago ILIKE '%mp%' OR a.medio_pago ILIKE '%mercado%') AND mov.cuenta = 'mercadopago'
            OR a.medio_pago ILIKE '%galicia%' AND mov.cuenta = 'galicia'
            OR a.medio_pago ILIKE '%icbc%' AND mov.cuenta = 'icbc'
          )
          AND NOT EXISTS (SELECT 1 FROM adelantos a2 WHERE a2.conciliado_movimiento_id = mov.id)
          AND NOT EXISTS (SELECT 1 FROM dividendos d2 WHERE d2.conciliado_movimiento_id = mov.id)
      ) AS movs
    FROM adelantos a
    WHERE a.conciliado_movimiento_id IS NULL
      AND a.medio_pago ILIKE 'transferencia%'
      AND a.fecha BETWEEN p_desde AND p_hasta
  ),
  u2 AS (
    UPDATE adelantos a SET conciliado_movimiento_id = cand.movs[1]
    FROM cand
    WHERE a.id = cand.adel_id AND cand.movs IS NOT NULL AND array_length(cand.movs, 1) = 1
    RETURNING 1
  )
  SELECT count(*) INTO v_mf FROM u2;

  RETURN jsonb_build_object('por_op', v_op, 'por_monto_fecha', v_mf);
END $function$;
