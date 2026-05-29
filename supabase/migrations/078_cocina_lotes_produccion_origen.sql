-- 078_cocina_lotes_produccion_origen.sql
-- El cierre físico de mostrador (MostradorPage) reusa cocina_lotes_produccion
-- como mecanismo de overwrite del stock: apaga lotes previos e inserta uno
-- nuevo con el peso real contado. El trigger trg_pizarron_lote_produccion
-- no distingue ese INSERT de uno hecho por QR Cargar Salsa/Postre/etc, y
-- termina marcando como ciclo_completo cualquier item del pizarrón
-- planificado para esa fecha — aunque no se haya producido (era stock
-- remanente). Bug visible: planificás 2x Crema Blanca para hoy, no las
-- hacés porque hay stock, hacés cierre nocturno → el pizarrón te las marca
-- "✓ EN CÁMARA / Disponible para venta".
--
-- Fix: agregar columna `origen` para distinguir producción real (default,
-- viene del QR de carga) del re-baselining del cierre. El trigger ignora
-- los inserts con origen='cierre'.

ALTER TABLE cocina_lotes_produccion
  ADD COLUMN IF NOT EXISTS origen text NOT NULL DEFAULT 'produccion';

ALTER TABLE cocina_lotes_produccion
  DROP CONSTRAINT IF EXISTS cocina_lotes_produccion_origen_check;

ALTER TABLE cocina_lotes_produccion
  ADD CONSTRAINT cocina_lotes_produccion_origen_check
  CHECK (origen IN ('produccion', 'cierre'));

COMMENT ON COLUMN cocina_lotes_produccion.origen IS
  'produccion = lote real cocinado (QR Cargar Salsa/Postre/etc, marca ciclo_completo en pizarrón). cierre = re-baselining de stock vía cierre físico de mostrador (NO marca pizarrón).';

-- Reescribir trigger con guarda al inicio. Resto idéntico al de mig 049.
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
  -- Cierres físicos son re-baselining de stock, no producción.
  -- No deben mover el estado del pizarrón.
  IF NEW.origen = 'cierre' THEN
    RETURN NEW;
  END IF;

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
