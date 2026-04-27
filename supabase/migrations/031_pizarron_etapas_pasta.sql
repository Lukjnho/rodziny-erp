-- 031_pizarron_etapas_pasta.sql
-- Reemplaza el flujo binario pendiente/hecho de cocina_pizarron_items por
-- 3 etapas que reflejan el ciclo real de producción de pasta:
--   1. en_produccion → se cargó el lote de relleno o masa
--   2. en_bandejas    → la pasta se armó y está en freezer de producción
--   3. ciclo_completo → todas las pastas derivadas se porcionaron y están en cámara
--
-- Pasta simple (tagliatelle, spaghetti, ñoquis no rellenos): saltea en_bandejas.
--   Solo 2 etapas: en_produccion → ciclo_completo.
--
-- Salsa / postre / pastelería / panadería: 1 sola etapa (ciclo_completo al cargar el lote).

-- ── 1. Migrar estados existentes ────────────────────────────────────────────
-- Hay que pasar por una columna libre de CHECK porque el constraint actual no
-- conoce los nuevos valores. Se recrea el CHECK al final.
ALTER TABLE cocina_pizarron_items DROP CONSTRAINT IF EXISTS cocina_pizarron_items_estado_check;

UPDATE cocina_pizarron_items SET estado = 'ciclo_completo' WHERE estado = 'hecho';
UPDATE cocina_pizarron_items SET estado = 'en_produccion' WHERE estado = 'parcial';

ALTER TABLE cocina_pizarron_items
  ADD CONSTRAINT cocina_pizarron_items_estado_check
  CHECK (estado IN ('pendiente', 'en_produccion', 'en_bandejas', 'ciclo_completo', 'cancelado'));

-- Ajustar índice parcial (apuntaba a estado='pendiente', sigue siendo correcto pero lo recreamos por si acaso)
DROP INDEX IF EXISTS cocina_pizarron_pendientes_idx;
CREATE INDEX cocina_pizarron_pendientes_idx ON cocina_pizarron_items (fecha_objetivo, local, tipo, receta_id)
  WHERE estado = 'pendiente';

-- ── 2. Drop triggers y función vieja ────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_pizarron_cumplido_relleno    ON cocina_lotes_relleno;
DROP TRIGGER IF EXISTS trg_pizarron_cumplido_masa       ON cocina_lotes_masa;
DROP TRIGGER IF EXISTS trg_pizarron_cumplido_produccion ON cocina_lotes_produccion;
DROP FUNCTION IF EXISTS public.marcar_pizarron_cumplido();

-- ── 3. Función helper: recalcula el estado de un item según los lotes_pasta derivados
-- Recibe un lote de relleno o masa, busca el item del pizarrón correspondiente,
-- y calcula el estado nuevo mirando cuántos lotes_pasta lo apuntan y dónde están.
CREATE OR REPLACE FUNCTION public.recalcular_pizarron_para_lote(
  p_tipo text,           -- 'relleno' | 'masa'
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

  SELECT id INTO v_item_id
  FROM cocina_pizarron_items
  WHERE tipo = p_tipo
    AND receta_id = p_receta_id
    AND local = p_local
    AND fecha_objetivo = p_fecha
    AND estado <> 'cancelado'
  ORDER BY created_at
  LIMIT 1;

  IF v_item_id IS NULL THEN
    RETURN;
  END IF;

  -- Contar lotes de pasta derivados de este lote de relleno/masa
  IF p_tipo = 'relleno' THEN
    SELECT
      count(*),
      count(*) FILTER (WHERE ubicacion = 'freezer_produccion'),
      count(*) FILTER (WHERE ubicacion = 'camara_congelado'),
      true  -- por definición, si tiene lote_relleno_id es pasta con relleno
    INTO v_total_pasta, v_pasta_freezer, v_pasta_camara, v_alguna_con_relleno
    FROM cocina_lotes_pasta
    WHERE lote_relleno_id = p_lote_id;
  ELSE  -- masa
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

  -- Determinar estado:
  IF v_total_pasta = 0 THEN
    -- Lote cargado pero ninguna pasta armada todavía
    v_nuevo_estado := 'en_produccion';
  ELSIF v_pasta_freezer > 0 THEN
    -- Hay pasta armada en freezer
    IF v_alguna_con_relleno THEN
      -- Pasta con relleno: muestra etapa "en_bandejas"
      v_nuevo_estado := 'en_bandejas';
    ELSE
      -- Pasta simple en freezer: aún no porcionada → seguimos en producción
      v_nuevo_estado := 'en_produccion';
    END IF;
  ELSE
    -- Todas las pastas derivadas están en cámara → ciclo completo
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

-- ── 4. Trigger en cocina_lotes_relleno: cargar lote → en_produccion ─────────
CREATE OR REPLACE FUNCTION public.trg_pizarron_lote_relleno()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.recalcular_pizarron_para_lote('relleno', NEW.id, NEW.receta_id, NEW.local, NEW.fecha);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pizarron_lote_relleno_ins
  AFTER INSERT ON cocina_lotes_relleno
  FOR EACH ROW EXECUTE FUNCTION public.trg_pizarron_lote_relleno();

-- ── 5. Trigger en cocina_lotes_masa: cargar lote → en_produccion ────────────
CREATE OR REPLACE FUNCTION public.trg_pizarron_lote_masa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.recalcular_pizarron_para_lote('masa', NEW.id, NEW.receta_id, NEW.local, NEW.fecha);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pizarron_lote_masa_ins
  AFTER INSERT ON cocina_lotes_masa
  FOR EACH ROW EXECUTE FUNCTION public.trg_pizarron_lote_masa();

-- ── 6. Trigger en cocina_lotes_pasta: armar/porcionar → recalcular relleno y masa
-- Se dispara en INSERT (armado) y en UPDATE de ubicación (porcionado).
CREATE OR REPLACE FUNCTION public.trg_pizarron_lote_pasta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_relleno record;
  v_masa record;
BEGIN
  IF NEW.lote_relleno_id IS NOT NULL THEN
    SELECT receta_id, local, fecha INTO v_relleno
    FROM cocina_lotes_relleno WHERE id = NEW.lote_relleno_id;
    IF FOUND AND v_relleno.receta_id IS NOT NULL THEN
      PERFORM public.recalcular_pizarron_para_lote(
        'relleno', NEW.lote_relleno_id, v_relleno.receta_id, v_relleno.local, v_relleno.fecha
      );
    END IF;
  END IF;

  IF NEW.lote_masa_id IS NOT NULL THEN
    SELECT receta_id, local, fecha INTO v_masa
    FROM cocina_lotes_masa WHERE id = NEW.lote_masa_id;
    IF FOUND AND v_masa.receta_id IS NOT NULL THEN
      PERFORM public.recalcular_pizarron_para_lote(
        'masa', NEW.lote_masa_id, v_masa.receta_id, v_masa.local, v_masa.fecha
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pizarron_lote_pasta_ins
  AFTER INSERT ON cocina_lotes_pasta
  FOR EACH ROW EXECUTE FUNCTION public.trg_pizarron_lote_pasta();

CREATE TRIGGER trg_pizarron_lote_pasta_upd
  AFTER UPDATE OF ubicacion ON cocina_lotes_pasta
  FOR EACH ROW
  WHEN (OLD.ubicacion IS DISTINCT FROM NEW.ubicacion)
  EXECUTE FUNCTION public.trg_pizarron_lote_pasta();

-- ── 7. Trigger en cocina_lotes_produccion: salsa/postre/etc → ciclo_completo
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

  SELECT id INTO v_item_id
  FROM cocina_pizarron_items
  WHERE tipo = v_tipo
    AND receta_id = NEW.receta_id
    AND local = NEW.local
    AND fecha_objetivo = NEW.fecha
    AND estado <> 'cancelado'
  ORDER BY created_at
  LIMIT 1;

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

CREATE TRIGGER trg_pizarron_lote_produccion_ins
  AFTER INSERT ON cocina_lotes_produccion
  FOR EACH ROW EXECUTE FUNCTION public.trg_pizarron_lote_produccion();

COMMENT ON FUNCTION public.recalcular_pizarron_para_lote IS
  'Dado un lote de relleno o masa, busca el item del pizarrón correspondiente y recalcula su estado (en_produccion / en_bandejas / ciclo_completo) según los lotes_pasta derivados. Llamada desde los triggers de cocina_lotes_relleno, cocina_lotes_masa y cocina_lotes_pasta.';
