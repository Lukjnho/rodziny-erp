-- 050_cocina_lote_trazabilidad.sql
-- Permite seguir un lote de pasta a lo largo del ciclo:
--   armado → cámara → mostrador
--
-- El "vendido" no se rastrea por lote porque las ventas vienen agregadas
-- desde Fudo (no hay registro fila-a-fila por lote). Para salsas/postres,
-- la trazabilidad usa el flag en_stock existente (overwrite por receta).
--
-- Componentes:
--   1. Tabla cocina_lote_consumos: cada salida de cámara queda imputada a
--      un lote específico vía FIFO.
--   2. RPC fifo_consumir_camara_pasta: distribuye una cantidad entre los
--      lotes en cámara de un producto, por orden cronológico.
--   3. Triggers en cocina_traspasos (INS/UPD/DEL) y cocina_ajustes_stock
--      (con delta negativo sobre cámara) que invocan el FIFO.
--   4. Vista v_cocina_lote_pasta_saldo: saldo en cámara + cantidad
--      trasladada a mostrador + estado derivado por lote.
--   5. Vista v_cocina_pizarron_trazabilidad: una fila por item del plan,
--      con el detalle de lotes derivados y sus saldos.
--   6. Backfill: corre el FIFO sobre todos los traspasos y ajustes
--      negativos existentes (orden cronológico).

-- ─── 1. Tabla cocina_lote_consumos ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cocina_lote_consumos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_pasta_id uuid NOT NULL REFERENCES public.cocina_lotes_pasta(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('traspaso', 'ajuste_camara', 'merma_camara')),
  cantidad numeric NOT NULL CHECK (cantidad > 0),
  origen_tabla text NOT NULL,
  origen_id uuid,
  fecha date NOT NULL,
  local text NOT NULL CHECK (local IN ('vedia', 'saavedra')),
  notas text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cocina_lote_consumos_lote
  ON public.cocina_lote_consumos (lote_pasta_id);
CREATE INDEX IF NOT EXISTS idx_cocina_lote_consumos_origen
  ON public.cocina_lote_consumos (origen_tabla, origen_id);

COMMENT ON TABLE public.cocina_lote_consumos IS
  'Imputación FIFO de salidas de cámara a un lote específico. Cada traspaso o ajuste negativo crea N filas (una por lote consumido). Permite saber el saldo vivo de cada lote en cámara.';

ALTER TABLE public.cocina_lote_consumos ENABLE ROW LEVEL SECURITY;
CREATE POLICY cocina_lote_consumos_select_anon
  ON public.cocina_lote_consumos FOR SELECT TO anon USING (true);
CREATE POLICY cocina_lote_consumos_auth_all
  ON public.cocina_lote_consumos FOR ALL TO authenticated
  USING (tiene_permiso('cocina'))
  WITH CHECK (tiene_permiso('cocina'));

-- ─── 2. RPC FIFO ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fifo_consumir_camara_pasta(
  p_producto_id uuid,
  p_local text,
  p_fecha date,
  p_cantidad numeric,
  p_tipo text,
  p_origen_tabla text,
  p_origen_id uuid,
  p_notas text DEFAULT NULL
) RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_lote record;
  v_restante numeric := p_cantidad;
  v_saldo numeric;
  v_consumir numeric;
BEGIN
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RETURN 0;
  END IF;

  -- Iterar lotes en cámara ordenados FIFO (fecha del lote, luego created_at).
  -- Solo se consideran lotes cuya fecha sea <= a la fecha del consumo
  -- (no se puede consumir un lote del futuro).
  FOR v_lote IN
    SELECT lp.id, lp.porciones
    FROM cocina_lotes_pasta lp
    WHERE lp.producto_id = p_producto_id
      AND lp.local = p_local
      AND lp.ubicacion = 'camara_congelado'
      AND lp.fecha <= p_fecha
    ORDER BY lp.fecha, lp.created_at
  LOOP
    IF v_restante <= 0 THEN
      EXIT;
    END IF;

    SELECT v_lote.porciones - COALESCE(SUM(cantidad), 0)
      INTO v_saldo
    FROM cocina_lote_consumos
    WHERE lote_pasta_id = v_lote.id;

    IF v_saldo <= 0 THEN
      CONTINUE;
    END IF;

    v_consumir := LEAST(v_restante, v_saldo);

    INSERT INTO cocina_lote_consumos
      (lote_pasta_id, tipo, cantidad, origen_tabla, origen_id, fecha, local, notas)
    VALUES
      (v_lote.id, p_tipo, v_consumir, p_origen_tabla, p_origen_id, p_fecha, p_local, p_notas);

    v_restante := v_restante - v_consumir;
  END LOOP;

  -- Si quedó cantidad sin asignar (stock insuficiente), no se crea fila huérfana.
  -- Se loggea para diagnóstico; el desfase queda visible vs el total del producto.
  IF v_restante > 0 THEN
    RAISE NOTICE 'FIFO pasta: stock insuficiente en cámara para producto=% local=% fecha=%, faltaron % porciones (origen %.%)',
      p_producto_id, p_local, p_fecha, v_restante, p_origen_tabla, p_origen_id;
  END IF;

  RETURN p_cantidad - v_restante;
END;
$$;

COMMENT ON FUNCTION public.fifo_consumir_camara_pasta IS
  'Distribuye una salida (traspaso/merma/ajuste negativo) entre los lotes en cámara del producto, en orden FIFO. Devuelve la cantidad efectivamente asignada. Si hay stock insuficiente, deja parte sin asignar y emite NOTICE.';

-- ─── 3. Triggers ──────────────────────────────────────────────────────────

-- 3.a) Traspasos: INSERT crea consumos; UPDATE de porciones limpia y rehace; DELETE limpia.
CREATE OR REPLACE FUNCTION public.trg_traspaso_fifo() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    DELETE FROM cocina_lote_consumos
    WHERE origen_tabla = 'cocina_traspasos' AND origen_id = OLD.id;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM fifo_consumir_camara_pasta(
      NEW.producto_id, NEW.local, NEW.fecha,
      NEW.porciones::numeric, 'traspaso',
      'cocina_traspasos', NEW.id, NULL
    );
    RETURN NEW;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_traspaso_fifo_ins ON cocina_traspasos;
DROP TRIGGER IF EXISTS trg_traspaso_fifo_upd ON cocina_traspasos;
DROP TRIGGER IF EXISTS trg_traspaso_fifo_del ON cocina_traspasos;

CREATE TRIGGER trg_traspaso_fifo_ins
  AFTER INSERT ON cocina_traspasos
  FOR EACH ROW EXECUTE FUNCTION public.trg_traspaso_fifo();

CREATE TRIGGER trg_traspaso_fifo_upd
  AFTER UPDATE OF porciones, producto_id, fecha, local ON cocina_traspasos
  FOR EACH ROW EXECUTE FUNCTION public.trg_traspaso_fifo();

CREATE TRIGGER trg_traspaso_fifo_del
  AFTER DELETE ON cocina_traspasos
  FOR EACH ROW EXECUTE FUNCTION public.trg_traspaso_fifo();

-- 3.b) Ajustes de cámara con delta negativo: descuento FIFO. Delta positivo no
--      se imputa a un lote (no hay lote de origen), queda como ajuste libre.
CREATE OR REPLACE FUNCTION public.trg_ajuste_camara_fifo() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    DELETE FROM cocina_lote_consumos
    WHERE origen_tabla = 'cocina_ajustes_stock' AND origen_id = OLD.id;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    IF NEW.ubicacion = 'camara' AND NEW.delta < 0 THEN
      PERFORM fifo_consumir_camara_pasta(
        NEW.producto_id, NEW.local, NEW.fecha,
        (-NEW.delta)::numeric, 'ajuste_camara',
        'cocina_ajustes_stock', NEW.id, NEW.motivo
      );
    END IF;
    RETURN NEW;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_ajuste_camara_fifo_ins ON cocina_ajustes_stock;
DROP TRIGGER IF EXISTS trg_ajuste_camara_fifo_upd ON cocina_ajustes_stock;
DROP TRIGGER IF EXISTS trg_ajuste_camara_fifo_del ON cocina_ajustes_stock;

CREATE TRIGGER trg_ajuste_camara_fifo_ins
  AFTER INSERT ON cocina_ajustes_stock
  FOR EACH ROW EXECUTE FUNCTION public.trg_ajuste_camara_fifo();

CREATE TRIGGER trg_ajuste_camara_fifo_upd
  AFTER UPDATE OF delta, producto_id, fecha, local, ubicacion ON cocina_ajustes_stock
  FOR EACH ROW EXECUTE FUNCTION public.trg_ajuste_camara_fifo();

CREATE TRIGGER trg_ajuste_camara_fifo_del
  AFTER DELETE ON cocina_ajustes_stock
  FOR EACH ROW EXECUTE FUNCTION public.trg_ajuste_camara_fifo();

-- ─── 4. Vista v_cocina_lote_pasta_saldo ───────────────────────────────────
-- Una fila por lote_pasta: saldo en cámara, total trasladado a mostrador,
-- ajustes en cámara, y estado derivado del ciclo de vida.
DROP VIEW IF EXISTS public.v_cocina_lote_pasta_saldo;
CREATE VIEW public.v_cocina_lote_pasta_saldo AS
SELECT
  lp.id AS lote_pasta_id,
  lp.producto_id,
  lp.local,
  lp.fecha AS fecha_armado,
  lp.fecha_porcionado,
  lp.ubicacion,
  lp.porciones AS porciones_iniciales,
  lp.lote_relleno_id,
  lp.lote_masa_id,
  lp.responsable AS responsable_armado,
  lp.responsable_porcionado,
  COALESCE((
    SELECT SUM(cantidad) FROM cocina_lote_consumos lc
    WHERE lc.lote_pasta_id = lp.id AND lc.tipo = 'traspaso'
  ), 0)::numeric AS porciones_a_mostrador,
  COALESCE((
    SELECT SUM(cantidad) FROM cocina_lote_consumos lc
    WHERE lc.lote_pasta_id = lp.id AND lc.tipo = 'merma_camara'
  ), 0)::numeric AS porciones_merma_camara,
  COALESCE((
    SELECT SUM(cantidad) FROM cocina_lote_consumos lc
    WHERE lc.lote_pasta_id = lp.id AND lc.tipo = 'ajuste_camara'
  ), 0)::numeric AS porciones_ajuste_camara,
  GREATEST(
    lp.porciones - COALESCE((
      SELECT SUM(cantidad) FROM cocina_lote_consumos lc
      WHERE lc.lote_pasta_id = lp.id
    ), 0)::numeric,
    0
  ) AS saldo_camara
FROM cocina_lotes_pasta lp
WHERE lp.ubicacion = 'camara_congelado' OR lp.ubicacion = 'freezer_produccion';

COMMENT ON VIEW public.v_cocina_lote_pasta_saldo IS
  'Saldo y movimientos por lote de pasta. saldo_camara = porciones_iniciales − todos los consumos FIFO (traspasos, mermas, ajustes negativos).';

-- ─── 5. Vista v_cocina_pizarron_trazabilidad ──────────────────────────────
-- Una fila por item del pizarrón con derivados agregados.
-- Pensada para alimentar el plan semanal extendido y la pestaña de
-- trazabilidad. Los lotes_pasta derivados se traen vía pasta_recetas.
DROP VIEW IF EXISTS public.v_cocina_pizarron_trazabilidad;
CREATE VIEW public.v_cocina_pizarron_trazabilidad AS
WITH lotes_pasta_del_pizarron AS (
  SELECT
    pi.id AS pizarron_id,
    lp.id AS lote_pasta_id,
    lp.porciones AS porciones_iniciales,
    lp.ubicacion,
    lp.fecha AS fecha_armado,
    lp.fecha_porcionado,
    saldo.porciones_a_mostrador,
    saldo.porciones_merma_camara,
    saldo.porciones_ajuste_camara,
    saldo.saldo_camara
  FROM cocina_pizarron_items pi
  JOIN cocina_lotes_pasta lp
    ON lp.local = pi.local
   AND (
     (pi.tipo = 'relleno' AND lp.lote_relleno_id = pi.lote_id)
     OR (pi.tipo = 'masa' AND lp.lote_masa_id = pi.lote_id)
   )
  LEFT JOIN v_cocina_lote_pasta_saldo saldo ON saldo.lote_pasta_id = lp.id
  WHERE pi.lote_id IS NOT NULL
)
SELECT
  pi.id AS pizarron_id,
  pi.fecha_objetivo,
  pi.local,
  pi.tipo,
  pi.receta_id,
  pi.texto_libre,
  pi.cantidad_recetas,
  pi.estado AS estado_pizarron,
  pi.lote_id,
  pi.lote_tabla,
  COALESCE(SUM(lpz.porciones_iniciales), 0)::numeric AS pastas_total_iniciales,
  COALESCE(SUM(lpz.porciones_a_mostrador), 0)::numeric AS pastas_a_mostrador,
  COALESCE(SUM(lpz.saldo_camara), 0)::numeric AS pastas_saldo_camara,
  COALESCE(SUM(lpz.porciones_merma_camara), 0)::numeric AS pastas_merma,
  COUNT(lpz.lote_pasta_id) AS pastas_cantidad_lotes,
  CASE
    WHEN COUNT(lpz.lote_pasta_id) = 0 THEN pi.estado
    WHEN COALESCE(SUM(lpz.saldo_camara), 0) = 0
      AND COALESCE(SUM(lpz.porciones_a_mostrador), 0) > 0 THEN 'en_mostrador'
    WHEN COALESCE(SUM(lpz.porciones_a_mostrador), 0) > 0 THEN 'en_mostrador_parcial'
    ELSE pi.estado
  END AS estado_trazabilidad
FROM cocina_pizarron_items pi
LEFT JOIN lotes_pasta_del_pizarron lpz ON lpz.pizarron_id = pi.id
WHERE pi.estado <> 'cancelado'
GROUP BY pi.id;

COMMENT ON VIEW public.v_cocina_pizarron_trazabilidad IS
  'Para cada item del plan semanal (cocina_pizarron_items), suma los lotes_pasta derivados con sus saldos. Agrega un estado_trazabilidad que extiende el ciclo más allá de ciclo_completo: en_mostrador_parcial (parte trasladada), en_mostrador (todo el saldo de cámara se vació).';

-- ─── 6. Backfill ──────────────────────────────────────────────────────────
-- Recorre traspasos y ajustes negativos existentes en orden cronológico,
-- ejecutando el FIFO. Los triggers detectan TG_OP='INSERT' al hacer
-- los siguientes INSERTs en cocina_lote_consumos, pero como no hacemos
-- INSERTs ahí desde el frontend (solo desde el RPC), evitamos doble
-- ejecución llamando directo al RPC y NO insertando en traspasos/ajustes.

-- Limpiar consumos previos por si esta migración se corre dos veces:
TRUNCATE TABLE cocina_lote_consumos;

DO $$
DECLARE
  r record;
BEGIN
  -- Traspasos primero, ordenados por fecha + created_at (orden temporal real)
  FOR r IN
    SELECT id, producto_id, local, fecha, porciones, created_at
    FROM cocina_traspasos
    ORDER BY fecha, created_at
  LOOP
    PERFORM fifo_consumir_camara_pasta(
      r.producto_id, r.local, r.fecha,
      r.porciones::numeric, 'traspaso',
      'cocina_traspasos', r.id, 'backfill'
    );
  END LOOP;

  -- Ajustes con delta < 0 sobre cámara (en orden cronológico)
  FOR r IN
    SELECT id, producto_id, local, fecha, delta, motivo, created_at
    FROM cocina_ajustes_stock
    WHERE ubicacion = 'camara' AND delta < 0
    ORDER BY fecha, created_at
  LOOP
    PERFORM fifo_consumir_camara_pasta(
      r.producto_id, r.local, r.fecha,
      (-r.delta)::numeric, 'ajuste_camara',
      'cocina_ajustes_stock', r.id, COALESCE(r.motivo, 'backfill')
    );
  END LOOP;
END;
$$;
