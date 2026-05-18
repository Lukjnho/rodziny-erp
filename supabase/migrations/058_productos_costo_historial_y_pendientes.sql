-- Fase 1.E del módulo Productos: historial de costos de insumos y detección
-- de variaciones a partir de gastos.items_json (jsonb), con flujo de
-- aprobación humana (no auto-aplica para que Lucas controle qué se mueve).

-- ─── Historial de costos ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.productos_costo_historial (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id uuid NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
  costo_anterior numeric,
  costo_nuevo numeric NOT NULL,
  variacion_pct numeric,
  fuente text NOT NULL DEFAULT 'manual'
    CHECK (fuente IN ('manual','gasto_item','sistema','aprobacion_pendiente')),
  gasto_id uuid REFERENCES public.gastos(id) ON DELETE SET NULL,
  usuario text,
  comentario text,
  fecha timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_costo_historial_producto
  ON public.productos_costo_historial(producto_id, fecha DESC);

COMMENT ON TABLE public.productos_costo_historial IS
  'Histórico de cambios del costo_unitario de un insumo. Se carga al aceptar una variación pendiente o al editar manualmente.';

-- ─── Variaciones pendientes ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.productos_costo_pendientes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id uuid NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
  costo_actual numeric NOT NULL,
  costo_propuesto numeric NOT NULL,
  variacion_pct numeric NOT NULL,
  gasto_id uuid REFERENCES public.gastos(id) ON DELETE CASCADE,
  fecha_gasto date,
  estado text NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente','aceptado','rechazado')),
  resuelto_por text,
  resuelto_at timestamptz,
  comentario text,
  fecha_deteccion timestamptz NOT NULL DEFAULT now(),
  UNIQUE (producto_id, gasto_id)
);

CREATE INDEX IF NOT EXISTS idx_costo_pendientes_estado
  ON public.productos_costo_pendientes(estado, fecha_deteccion DESC);

COMMENT ON TABLE public.productos_costo_pendientes IS
  'Variaciones de costo detectadas desde gastos.items_json. Lucas las acepta/rechaza desde el tab Insumos.';

-- ─── RPC: detecta variaciones de costo desde gastos recientes ───────────────
-- Recorre items_json de gastos del período, compara precio_unitario contra
-- productos.costo_unitario actual, e inserta en productos_costo_pendientes
-- todo lo que supere el umbral. No actualiza costos automáticamente.
CREATE OR REPLACE FUNCTION public.detectar_variaciones_costo(
  p_dias int DEFAULT 30,
  p_umbral_pct numeric DEFAULT 0.05
)
RETURNS TABLE (
  detectadas int,
  ya_existentes int,
  sin_variacion int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_detectadas int := 0;
  v_ya_existentes int := 0;
  v_sin_variacion int := 0;
  r record;
  v_var_pct numeric;
  v_costo_propuesto numeric;
  v_existe int;
BEGIN
  FOR r IN
    SELECT
      g.id AS gasto_id,
      g.fecha,
      (item->>'producto_id')::uuid AS producto_id,
      avg(((item->>'precio_unitario')::numeric)) AS precio_unitario_compra,
      max(p.costo_unitario) AS costo_actual
    FROM gastos g,
         LATERAL jsonb_array_elements(g.items_json) AS item
         JOIN productos p ON p.id = (item->>'producto_id')::uuid
    WHERE g.fecha >= CURRENT_DATE - (p_dias || ' days')::interval
      AND g.items_json IS NOT NULL
      AND (item->>'producto_id') IS NOT NULL
      AND (item->>'precio_unitario') IS NOT NULL
      AND ((item->>'precio_unitario')::numeric) > 0
      AND p.activo = true
      AND p.costo_unitario IS NOT NULL
      AND p.costo_unitario > 0
      AND (g.cancelado IS NOT TRUE)
    GROUP BY g.id, g.fecha, (item->>'producto_id')::uuid
  LOOP
    v_costo_propuesto := r.precio_unitario_compra;
    v_var_pct := (v_costo_propuesto - r.costo_actual) / r.costo_actual;

    IF abs(v_var_pct) >= p_umbral_pct THEN
      -- Solo inserta si no existe ya una variación para (producto, gasto)
      SELECT count(*) INTO v_existe
        FROM productos_costo_pendientes
        WHERE producto_id = r.producto_id AND gasto_id = r.gasto_id;

      IF v_existe = 0 THEN
        INSERT INTO productos_costo_pendientes (
          producto_id, costo_actual, costo_propuesto, variacion_pct,
          gasto_id, fecha_gasto, estado
        ) VALUES (
          r.producto_id, r.costo_actual, v_costo_propuesto, v_var_pct,
          r.gasto_id, r.fecha, 'pendiente'
        );
        v_detectadas := v_detectadas + 1;
      ELSE
        v_ya_existentes := v_ya_existentes + 1;
      END IF;
    ELSE
      v_sin_variacion := v_sin_variacion + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_detectadas, v_ya_existentes, v_sin_variacion;
END;
$$;

GRANT EXECUTE ON FUNCTION public.detectar_variaciones_costo(int, numeric) TO authenticated;

-- ─── RPC: aceptar una variación (atómico) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.aceptar_variacion_costo(
  p_pendiente_id uuid,
  p_usuario text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pendiente productos_costo_pendientes%ROWTYPE;
BEGIN
  SELECT * INTO v_pendiente FROM productos_costo_pendientes WHERE id = p_pendiente_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Variación pendiente no encontrada: %', p_pendiente_id;
  END IF;
  IF v_pendiente.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'La variación ya fue resuelta (estado=%)', v_pendiente.estado;
  END IF;

  -- 1. Actualizar costo del producto
  UPDATE productos
    SET costo_unitario = v_pendiente.costo_propuesto,
        updated_at = now()
    WHERE id = v_pendiente.producto_id;

  -- 2. Insertar registro en historial
  INSERT INTO productos_costo_historial (
    producto_id, costo_anterior, costo_nuevo, variacion_pct,
    fuente, gasto_id, usuario, comentario
  ) VALUES (
    v_pendiente.producto_id,
    v_pendiente.costo_actual,
    v_pendiente.costo_propuesto,
    v_pendiente.variacion_pct,
    'gasto_item',
    v_pendiente.gasto_id,
    p_usuario,
    'Aceptada desde productos_costo_pendientes id=' || v_pendiente.id::text
  );

  -- 3. Marcar como aceptada
  UPDATE productos_costo_pendientes
    SET estado = 'aceptado',
        resuelto_por = p_usuario,
        resuelto_at = now()
    WHERE id = p_pendiente_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.aceptar_variacion_costo(uuid, text) TO authenticated;

-- ─── RPC: rechazar una variación ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rechazar_variacion_costo(
  p_pendiente_id uuid,
  p_usuario text DEFAULT NULL,
  p_comentario text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE productos_costo_pendientes
    SET estado = 'rechazado',
        resuelto_por = p_usuario,
        resuelto_at = now(),
        comentario = p_comentario
    WHERE id = p_pendiente_id AND estado = 'pendiente';
END;
$$;

GRANT EXECUTE ON FUNCTION public.rechazar_variacion_costo(uuid, text, text) TO authenticated;

-- ─── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.productos_costo_historial   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.productos_costo_pendientes  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sel_historial ON public.productos_costo_historial;
CREATE POLICY sel_historial ON public.productos_costo_historial FOR SELECT
USING (
  EXISTS (SELECT 1 FROM public.perfiles
          WHERE user_id = auth.uid()
            AND (es_admin OR puede_ver_productos))
);

DROP POLICY IF EXISTS ins_historial ON public.productos_costo_historial;
CREATE POLICY ins_historial ON public.productos_costo_historial FOR INSERT
WITH CHECK (
  EXISTS (SELECT 1 FROM public.perfiles
          WHERE user_id = auth.uid()
            AND (es_admin OR puede_ver_productos))
);

DROP POLICY IF EXISTS sel_pendientes ON public.productos_costo_pendientes;
CREATE POLICY sel_pendientes ON public.productos_costo_pendientes FOR SELECT
USING (
  EXISTS (SELECT 1 FROM public.perfiles
          WHERE user_id = auth.uid()
            AND (es_admin OR puede_ver_productos))
);

DROP POLICY IF EXISTS mod_pendientes ON public.productos_costo_pendientes;
CREATE POLICY mod_pendientes ON public.productos_costo_pendientes FOR ALL
USING (
  EXISTS (SELECT 1 FROM public.perfiles
          WHERE user_id = auth.uid()
            AND (es_admin OR puede_ver_productos))
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.perfiles
          WHERE user_id = auth.uid()
            AND (es_admin OR puede_ver_productos))
);
