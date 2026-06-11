-- 105: descuenta la producción de pasta simple del plan (pizarrón)
--
-- PROBLEMA: al planificar una pasta simple (tagliatelle, spaghetti, etc.) en el
-- tab Producción se guarda un item con tipo='pasta_simple', texto_libre=<nombre
-- del producto> y receta_id=NULL. Cuando se carga la producción por QR se inserta
-- un lote en cocina_lotes_pasta (lote_relleno_id=NULL, producto_id apuntando al
-- producto). PERO la función recalcular_pizarron_para_lote (mig 031) solo matchea
-- items tipo IN ('relleno','masa') por receta_id, así que el item de pasta simple
-- nunca avanzaba de 'pendiente' por más que se produjera. El plan no se descontaba.
--
-- SOLUCIÓN (cumplido por cantidad): al cargar/editar/borrar un lote de pasta
-- simple, sumamos las porciones producidas de ese producto en esa fecha+local y
-- lo comparamos contra las porciones planificadas:
--   sin producción     → pendiente
--   producción < plan   → en_produccion
--   producción >= plan  → ciclo_completo
--
-- Limitación (igual que relleno/masa): el match es por fecha exacta. Si se produce
-- en un día distinto al planificado, no se cruza con ese item del plan.
--
-- Idempotente: CREATE OR REPLACE + DROP/CREATE de triggers.

-- ── 0. Permitir 'cocina_lotes_pasta' como lote_tabla del item ───────────────
-- El CHECK original solo conocía relleno/masa/produccion; la pasta simple se
-- cumple desde cocina_lotes_pasta.
ALTER TABLE cocina_pizarron_items
  DROP CONSTRAINT IF EXISTS cocina_pizarron_items_lote_tabla_check;

ALTER TABLE cocina_pizarron_items
  ADD CONSTRAINT cocina_pizarron_items_lote_tabla_check
  CHECK (lote_tabla IS NULL OR lote_tabla = ANY (ARRAY[
    'cocina_lotes_relleno', 'cocina_lotes_masa', 'cocina_lotes_produccion', 'cocina_lotes_pasta'
  ]));

-- ── 1. Helper: normaliza nombres como normNombre() del front ────────────────
-- Espeja src/modules/cocina/DashboardTab.tsx:normNombre (lower + sin acentos +
-- solo alfanuméricos) para poder cruzar texto_libre del plan con el nombre del
-- producto del lote.
CREATE OR REPLACE FUNCTION public.norm_nombre_cocina(p_texto text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(
    translate(
      lower(coalesce(p_texto, '')),
      'áéíóúàèìòùäëïöüâêîôûãõñç',
      'aeiouaeiouaeiouaeiouaonc'
    ),
    '[^a-z0-9]', '', 'g'
  );
$$;

COMMENT ON FUNCTION public.norm_nombre_cocina IS
  'Normaliza un nombre (minúsculas, sin acentos, solo alfanuméricos). Espeja normNombre() del front para cruzar texto_libre del pizarrón con nombres de producto.';

-- ── 2. Recalcular el item de pasta simple del pizarrón ──────────────────────
-- Suma todas las porciones de pasta simple (lote_relleno_id IS NULL) de ese
-- producto en esa fecha+local y fija el estado del item del plan que matchee
-- por nombre normalizado.
CREATE OR REPLACE FUNCTION public.recalcular_pizarron_pasta_simple(
  p_producto_id uuid,
  p_local text,
  p_fecha date
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_nombre text;
  v_item_id uuid;
  v_plan numeric;
  v_hecho numeric;
  v_estado text;
BEGIN
  SELECT nombre INTO v_nombre FROM cocina_productos WHERE id = p_producto_id;
  IF v_nombre IS NULL THEN
    RETURN;
  END IF;

  -- Buscar el item de pasta simple del plan que matchee por nombre + local + fecha
  SELECT id, cantidad_recetas
  INTO v_item_id, v_plan
  FROM cocina_pizarron_items
  WHERE tipo = 'pasta_simple'
    AND local = p_local
    AND fecha_objetivo = p_fecha
    AND estado <> 'cancelado'
    AND public.norm_nombre_cocina(texto_libre) = public.norm_nombre_cocina(v_nombre)
  ORDER BY created_at
  LIMIT 1;

  IF v_item_id IS NULL THEN
    RETURN;
  END IF;

  -- Sumar porciones producidas de pasta simple de ese producto/fecha/local
  SELECT COALESCE(SUM(porciones), 0)
  INTO v_hecho
  FROM cocina_lotes_pasta
  WHERE producto_id = p_producto_id
    AND local = p_local
    AND fecha = p_fecha
    AND lote_relleno_id IS NULL;

  IF v_hecho <= 0 THEN
    v_estado := 'pendiente';
  ELSIF v_hecho >= v_plan THEN
    v_estado := 'ciclo_completo';
  ELSE
    v_estado := 'en_produccion';
  END IF;

  UPDATE cocina_pizarron_items
  SET estado = v_estado,
      cantidad_hecha = NULLIF(v_hecho, 0),
      lote_tabla = CASE WHEN v_hecho > 0 THEN 'cocina_lotes_pasta' ELSE NULL END,
      completado_en = CASE WHEN v_estado = 'ciclo_completo' THEN now() ELSE NULL END
  WHERE id = v_item_id;
END;
$$;

COMMENT ON FUNCTION public.recalcular_pizarron_pasta_simple IS
  'Suma las porciones de pasta simple (sin relleno) de un producto en una fecha+local y fija el estado del item del plan (pendiente / en_produccion / ciclo_completo) por cantidad. Llamada desde los triggers de cocina_lotes_pasta.';

-- ── 3. Enganchar en el trigger de INSERT/UPDATE de cocina_lotes_pasta ───────
-- Mantiene el comportamiento existente (relleno/masa) y agrega la rama de pasta
-- simple cuando el lote no tiene relleno.
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
  ELSE
    -- Pasta simple (sin relleno): cruzar contra el plan por nombre de producto.
    PERFORM public.recalcular_pizarron_pasta_simple(NEW.producto_id, NEW.local, NEW.fecha);
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

-- ── 4. Recalcular también al BORRAR un lote de pasta simple ─────────────────
-- El trigger de reset existente (trg_pizarron_reset_on_lote_delete) solo limpia
-- items cuyo lote_id apunta al lote borrado; la pasta simple no fija lote_id, así
-- que necesita su propio recálculo por cantidad al borrar.
CREATE OR REPLACE FUNCTION public.trg_pizarron_reset_pasta_simple_del()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.lote_relleno_id IS NULL THEN
    PERFORM public.recalcular_pizarron_pasta_simple(OLD.producto_id, OLD.local, OLD.fecha);
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_pizarron_reset_pasta_simple_del ON cocina_lotes_pasta;
CREATE TRIGGER trg_pizarron_reset_pasta_simple_del
  AFTER DELETE ON cocina_lotes_pasta
  FOR EACH ROW EXECUTE FUNCTION public.trg_pizarron_reset_pasta_simple_del();
