-- 049_pizarron_carry_over_lotes.sql
-- Permite que un lote cargado hoy "termine" un item del plan planificado
-- para días previos (carry-over). Antes el match exigía fecha_objetivo
-- exactamente igual a la fecha del lote, por lo que si se planificaba
-- relleno para ayer pero se terminaba hoy, el item quedaba "pendiente"
-- aunque el lote ya estuviera cargado.
--
-- Estrategia:
--   1. Match exacto en fecha_objetivo = p_fecha (comportamiento original).
--   2. Si no hay, fallback al item abierto más antiguo de los últimos 7 días.
--      Estados abiertos: pendiente / en_produccion / en_bandejas.
--      7 días = mismo horizonte que DIAS_VENTANA_LOTES_ABIERTOS del QR.
--
-- Aplica tanto a recalcular_pizarron_para_lote (relleno/masa) como al
-- trigger de cocina_lotes_produccion (salsa/postre/pastelería/panadería).

-- ── 1. Reescribir recalcular_pizarron_para_lote con fallback carry-over
CREATE OR REPLACE FUNCTION public.recalcular_pizarron_para_lote(
  p_tipo text,
  p_lote_id uuid,
  p_receta_id uuid,
  p_local text,
  p_fecha date
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_item_id uuid;
  v_total_pasta int;
  v_pasta_freezer int;
  v_pasta_camara int;
  v_alguna_con_relleno boolean;
  v_nuevo_estado text;
BEGIN
  IF p_tipo NOT IN ('relleno', 'masa') OR p_receta_id IS NULL THEN
    RETURN;
  END IF;

  -- 1) Match exacto en la fecha del lote (preserva comportamiento original).
  SELECT id INTO v_item_id
  FROM cocina_pizarron_items
  WHERE tipo = p_tipo
    AND receta_id = p_receta_id
    AND local = p_local
    AND fecha_objetivo = p_fecha
    AND estado <> 'cancelado'
  ORDER BY created_at
  LIMIT 1;

  -- 2) Carry-over: si no hay item planificado para hoy, buscar el item
  --    abierto más antiguo dentro de los últimos 7 días.
  IF v_item_id IS NULL THEN
    SELECT id INTO v_item_id
    FROM cocina_pizarron_items
    WHERE tipo = p_tipo
      AND receta_id = p_receta_id
      AND local = p_local
      AND fecha_objetivo BETWEEN (p_fecha - INTERVAL '7 days')::date AND p_fecha
      AND estado IN ('pendiente', 'en_produccion', 'en_bandejas')
    ORDER BY fecha_objetivo, created_at
    LIMIT 1;
  END IF;

  IF v_item_id IS NULL THEN
    RETURN;
  END IF;

  IF p_tipo = 'relleno' THEN
    SELECT
      count(*),
      count(*) FILTER (WHERE ubicacion = 'freezer_produccion'),
      count(*) FILTER (WHERE ubicacion = 'camara_congelado'),
      true
    INTO v_total_pasta, v_pasta_freezer, v_pasta_camara, v_alguna_con_relleno
    FROM cocina_lotes_pasta
    WHERE lote_relleno_id = p_lote_id;
  ELSE
    SELECT
      count(*),
      count(*) FILTER (WHERE ubicacion = 'freezer_produccion'),
      count(*) FILTER (WHERE ubicacion = 'camara_congelado'),
      bool_or(lote_relleno_id IS NOT NULL)
    INTO v_total_pasta, v_pasta_freezer, v_pasta_camara, v_alguna_con_relleno
    FROM cocina_lotes_pasta
    WHERE lote_masa_id = p_lote_id;
  END IF;

  v_alguna_con_relleno := COALESCE(v_alguna_con_relleno, false);

  IF v_total_pasta = 0 THEN
    v_nuevo_estado := 'en_produccion';
  ELSIF v_pasta_freezer > 0 THEN
    IF v_alguna_con_relleno THEN
      v_nuevo_estado := 'en_bandejas';
    ELSE
      v_nuevo_estado := 'en_produccion';
    END IF;
  ELSE
    v_nuevo_estado := 'ciclo_completo';
  END IF;

  UPDATE cocina_pizarron_items
  SET estado = v_nuevo_estado,
      lote_tabla = 'cocina_lotes_' || p_tipo,
      lote_id = p_lote_id,
      cantidad_hecha = COALESCE(cantidad_hecha, cantidad_recetas),
      completado_en = CASE WHEN v_nuevo_estado = 'ciclo_completo' THEN now() ELSE NULL END
  WHERE id = v_item_id;
END;
$$;

COMMENT ON FUNCTION public.recalcular_pizarron_para_lote IS
  'Dado un lote de relleno o masa, busca el item del pizarrón correspondiente y recalcula su estado (en_produccion / en_bandejas / ciclo_completo) según los lotes_pasta derivados. Match primero por fecha_objetivo exacta; si no hay, fallback al item abierto más antiguo de los últimos 7 días (carry-over).';

-- ── 2. Reescribir trigger de cocina_lotes_produccion con mismo fallback
CREATE OR REPLACE FUNCTION public.trg_pizarron_lote_produccion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tipo text;
  v_item_id uuid;
BEGIN
  v_tipo := CASE NEW.categoria
    WHEN 'salsa'      THEN 'salsa'
    WHEN 'postre'     THEN 'postre'
    WHEN 'pasteleria' THEN 'pasteleria'
    WHEN 'panaderia'  THEN 'panaderia'
    ELSE NULL
  END;

  IF v_tipo IS NULL OR NEW.receta_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 1) Match exacto en la fecha del lote.
  SELECT id INTO v_item_id
  FROM cocina_pizarron_items
  WHERE tipo = v_tipo
    AND receta_id = NEW.receta_id
    AND local = NEW.local
    AND fecha_objetivo = NEW.fecha
    AND estado <> 'cancelado'
  ORDER BY created_at
  LIMIT 1;

  -- 2) Carry-over: item abierto más antiguo de los últimos 7 días.
  IF v_item_id IS NULL THEN
    SELECT id INTO v_item_id
    FROM cocina_pizarron_items
    WHERE tipo = v_tipo
      AND receta_id = NEW.receta_id
      AND local = NEW.local
      AND fecha_objetivo BETWEEN (NEW.fecha - INTERVAL '7 days')::date AND NEW.fecha
      AND estado IN ('pendiente', 'en_produccion', 'en_bandejas')
    ORDER BY fecha_objetivo, created_at
    LIMIT 1;
  END IF;

  IF v_item_id IS NOT NULL THEN
    UPDATE cocina_pizarron_items
    SET estado = 'ciclo_completo',
        lote_tabla = 'cocina_lotes_produccion',
        lote_id = NEW.id,
        cantidad_hecha = COALESCE(cantidad_hecha, cantidad_recetas),
        completado_en = now()
    WHERE id = v_item_id;
  END IF;

  RETURN NEW;
END;
$$;
