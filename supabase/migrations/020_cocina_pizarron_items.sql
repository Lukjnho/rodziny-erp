-- 020_cocina_pizarron_items.sql
-- Plan de producción que el chef define desde el ERP ("pizarrón" digital).
-- Persiste las órdenes y se auto-marcan como 'hecho' cuando el equipo registra
-- el lote correspondiente vía el QR (cualquier tabla de lotes).

CREATE TABLE IF NOT EXISTS cocina_pizarron_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha_objetivo date NOT NULL,
  local text NOT NULL CHECK (local IN ('vedia', 'saavedra')),
  turno text NULL CHECK (turno IS NULL OR turno IN ('mañana', 'tarde')),
  tipo text NOT NULL CHECK (tipo IN ('relleno', 'masa', 'salsa', 'postre', 'pasteleria', 'panaderia')),
  receta_id uuid NULL REFERENCES cocina_recetas(id) ON DELETE SET NULL,
  texto_libre text NULL,
  cantidad_recetas numeric NOT NULL DEFAULT 1 CHECK (cantidad_recetas > 0),
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'hecho', 'parcial', 'cancelado')),
  lote_tabla text NULL CHECK (lote_tabla IS NULL OR lote_tabla IN ('cocina_lotes_relleno', 'cocina_lotes_masa', 'cocina_lotes_produccion')),
  lote_id uuid NULL,
  cantidad_hecha numeric NULL,
  completado_en timestamptz NULL,
  notas text NULL,
  publicado_por uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  publicado_en timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pizarron_referencia_valida CHECK (
    (receta_id IS NOT NULL) OR (texto_libre IS NOT NULL AND length(trim(texto_libre)) > 0)
  )
);

CREATE INDEX cocina_pizarron_fecha_local_idx ON cocina_pizarron_items (fecha_objetivo, local);
CREATE INDEX cocina_pizarron_pendientes_idx ON cocina_pizarron_items (fecha_objetivo, local, tipo, receta_id)
  WHERE estado = 'pendiente';

COMMENT ON TABLE cocina_pizarron_items IS
  'Plan de producción definido por el chef. Cada fila es una orden (ej: "1 receta de Relleno de Jamón para mañana mañana"). Se autocompletan vía triggers cuando el equipo registra el lote correspondiente.';

ALTER TABLE cocina_pizarron_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cocina_pizarron_select_anon"
  ON cocina_pizarron_items FOR SELECT TO anon USING (true);

CREATE POLICY "cocina_pizarron_auth_all"
  ON cocina_pizarron_items FOR ALL TO authenticated
  USING (tiene_permiso('cocina')) WITH CHECK (tiene_permiso('cocina'));

-- ── Trigger: match automático lote ↔ pizarrón ───────────────────────────────
-- Al registrar un lote (desde QR o desde el admin), busca el primer item
-- pendiente del pizarrón para ese local+fecha+tipo+receta y lo marca hecho.

CREATE OR REPLACE FUNCTION public.marcar_pizarron_cumplido()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tipo text;
  v_cantidad_hecha numeric;
  v_item_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'cocina_lotes_relleno' THEN
    v_tipo := 'relleno';
    v_cantidad_hecha := NEW.cantidad_recetas;
  ELSIF TG_TABLE_NAME = 'cocina_lotes_masa' THEN
    v_tipo := 'masa';
    v_cantidad_hecha := 1;
  ELSIF TG_TABLE_NAME = 'cocina_lotes_produccion' THEN
    v_tipo := CASE NEW.categoria
      WHEN 'salsa' THEN 'salsa'
      WHEN 'postre' THEN 'postre'
      WHEN 'pasteleria' THEN 'pasteleria'
      WHEN 'panaderia' THEN 'panaderia'
      ELSE NULL
    END;
    v_cantidad_hecha := 1;
  ELSE
    RETURN NEW;
  END IF;

  IF v_tipo IS NULL OR NEW.receta_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_item_id
  FROM cocina_pizarron_items
  WHERE estado = 'pendiente'
    AND tipo = v_tipo
    AND receta_id = NEW.receta_id
    AND local = NEW.local
    AND fecha_objetivo = NEW.fecha
  ORDER BY created_at
  LIMIT 1;

  IF v_item_id IS NOT NULL THEN
    UPDATE cocina_pizarron_items
    SET estado = 'hecho',
        lote_tabla = TG_TABLE_NAME,
        lote_id = NEW.id,
        cantidad_hecha = v_cantidad_hecha,
        completado_en = now()
    WHERE id = v_item_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pizarron_cumplido_relleno
  AFTER INSERT ON cocina_lotes_relleno
  FOR EACH ROW EXECUTE FUNCTION public.marcar_pizarron_cumplido();

CREATE TRIGGER trg_pizarron_cumplido_masa
  AFTER INSERT ON cocina_lotes_masa
  FOR EACH ROW EXECUTE FUNCTION public.marcar_pizarron_cumplido();

CREATE TRIGGER trg_pizarron_cumplido_produccion
  AFTER INSERT ON cocina_lotes_produccion
  FOR EACH ROW EXECUTE FUNCTION public.marcar_pizarron_cumplido();
