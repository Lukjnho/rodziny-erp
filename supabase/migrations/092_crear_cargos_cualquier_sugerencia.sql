-- Consolida CUALQUIER movimiento con sugerencia (cargo bancario etiquetado), en vez
-- de una lista fija de tipos — así entran también intereses y futuros conceptos sin
-- tener que tocar esta función. La sugerencia solo la setea aplicar_reglas_sugerencia
-- para cargos bancarios, así que es seguro. Junto con concepto_canonico_cargo (mig 090,
-- que devuelve "Gastos bancarios"), todo queda en una línea por (mes, cuenta).
CREATE OR REPLACE FUNCTION crear_cargos_automaticos_bancarios(
  p_categoria_id uuid,
  p_creado_por text DEFAULT NULL,
  p_fecha_desde date DEFAULT NULL,
  p_fecha_hasta date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  rec RECORD;
  v_gasto_id uuid;
  v_creados int := 0;
  v_actualizados int := 0;
  v_movs_vinculados int := 0;
  v_total numeric := 0;
  v_cuenta_label text;
BEGIN
  FOR rec IN
    SELECT
      to_char(mb.fecha, 'YYYY-MM') AS mes,
      MAX(mb.fecha) AS fecha_max,
      mb.cuenta,
      public.concepto_canonico_cargo(mb.sugerencia) AS concepto,
      SUM(mb.debito) AS total_grupo,
      COUNT(*) AS movs_count,
      array_agg(mb.id) AS mov_ids
    FROM public.movimientos_bancarios mb
    WHERE mb.gasto_id IS NULL
      AND mb.debito > 0
      AND mb.es_transferencia_interna IS NOT TRUE
      AND mb.sugerencia IS NOT NULL
      AND (p_fecha_desde IS NULL OR mb.fecha >= p_fecha_desde)
      AND (p_fecha_hasta IS NULL OR mb.fecha <= p_fecha_hasta)
    GROUP BY 1, 3, 4
  LOOP
    v_cuenta_label := CASE rec.cuenta
      WHEN 'mercadopago' THEN 'MercadoPago'
      WHEN 'galicia' THEN 'Banco Galicia'
      WHEN 'icbc' THEN 'ICBC'
      ELSE rec.cuenta
    END;

    SELECT g.id INTO v_gasto_id
    FROM public.gastos g
    WHERE g.categoria_id = p_categoria_id
      AND g.cancelado IS NOT TRUE
      AND to_char(g.fecha, 'YYYY-MM') = rec.mes
      AND CASE g.proveedor
            WHEN 'MercadoPago' THEN 'mercadopago'
            WHEN 'Banco Galicia' THEN 'galicia'
            WHEN 'ICBC' THEN 'icbc'
            ELSE lower(COALESCE(g.proveedor, ''))
          END = rec.cuenta
      AND public.concepto_canonico_cargo(g.comentario) = rec.concepto
    ORDER BY g.created_at NULLS LAST, g.id
    LIMIT 1;

    IF v_gasto_id IS NULL THEN
      INSERT INTO public.gastos (
        local, fecha, categoria_id, categoria, subcategoria,
        proveedor, importe_total, estado_pago, tipo_comprobante,
        comentario, creado_por, creado_manual, cancelado, periodo
      ) VALUES (
        'sas', rec.fecha_max, p_categoria_id, 'Impuestos y Tasas',
        'Impuestos y comisiones bancarias', v_cuenta_label, rec.total_grupo,
        'Pagado', 'recibo',
        rec.concepto || ' · ' || v_cuenta_label || ' · ' || rec.mes
          || ' (consolidado, ' || rec.movs_count::text || ' movimientos)',
        p_creado_por, false, false, rec.mes
      )
      RETURNING id INTO v_gasto_id;
      v_creados := v_creados + 1;
    ELSE
      UPDATE public.gastos g
      SET importe_total = g.importe_total + rec.total_grupo,
          fecha = GREATEST(g.fecha, rec.fecha_max),
          comentario = rec.concepto || ' · ' || v_cuenta_label || ' · ' || rec.mes
                       || ' (consolidado, '
                       || ((SELECT COUNT(*) FROM public.movimientos_bancarios m WHERE m.gasto_id = g.id)
                            + rec.movs_count)::text || ' movimientos)'
      WHERE g.id = v_gasto_id;
      v_actualizados := v_actualizados + 1;
    END IF;

    UPDATE public.movimientos_bancarios SET gasto_id = v_gasto_id WHERE id = ANY(rec.mov_ids);
    v_movs_vinculados := v_movs_vinculados + rec.movs_count;
    v_total := v_total + rec.total_grupo;
  END LOOP;

  RETURN jsonb_build_object('creados', v_creados, 'actualizados', v_actualizados,
    'movs_vinculados', v_movs_vinculados, 'monto_total', v_total);
END;
$$;