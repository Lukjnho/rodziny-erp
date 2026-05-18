-- Fase 2 (mano de obra) del módulo Productos.
-- El sueldo de producción es FIJO mensual (no por hora). Lo modelamos como un
-- POOL mensual de sueldos del equipo de producción, repartido entre lo que
-- ese equipo produjo en el mes (datos reales de los lotes de Cocina),
-- ponderado opcionalmente por los minutos de cada receta.

-- ─── Marca de empleado de producción ────────────────────────────────────────
-- El puesto es texto libre e inconsistente ("cocinero"/"Cocinero",
-- "Produccion" sin tilde), así que usamos un flag explícito. Prepoblado por
-- heurística; Lucas lo ajusta con checkboxes en RRHH.
ALTER TABLE public.empleados
  ADD COLUMN IF NOT EXISTS es_produccion boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.empleados.es_produccion IS
  'Empleado de producción/cocina cuyo sueldo entra al pool de mano de obra del costeo. NO incluye mostrador, mozos, admin, etc.';

UPDATE public.empleados
SET es_produccion = true
WHERE activo = true
  AND es_produccion = false
  AND (
    puesto ILIKE '%cocinero%' OR
    puesto ILIKE '%produccion%' OR
    puesto ILIKE '%producción%' OR
    puesto ILIKE '%panadero%' OR
    puesto ILIKE '%pastelero%'
  );

-- ─── Minutos de lote por receta (referencial, opcional) ─────────────────────
-- Tiempo aproximado que lleva producir un lote de esa receta. Se usa como
-- PONDERADOR para repartir el pool de MO (una receta que lleva más tiempo se
-- lleva una tajada mayor). Si está NULL, el reparto es solo por volumen.
ALTER TABLE public.cocina_recetas
  ADD COLUMN IF NOT EXISTS minutos_lote numeric;

COMMENT ON COLUMN public.cocina_recetas.minutos_lote IS
  'Minutos aproximados de elaboración de un lote (referencial). Pondera el reparto del pool de mano de obra. NULL = reparto solo por volumen producido.';

-- ─── RPC: pool de mano de obra por local ────────────────────────────────────
-- Suma de sueldos de empleados de producción activos, por local. SECURITY
-- DEFINER para no exponer sueldos individuales (solo agregado) ni depender de
-- que el usuario tenga permiso RRHH.
CREATE OR REPLACE FUNCTION public.pool_mano_obra_produccion()
RETURNS TABLE (local text, total_sueldos numeric, n_empleados int)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.local,
         COALESCE(sum(e.sueldo_neto), 0) AS total_sueldos,
         count(*)::int AS n_empleados
  FROM empleados e
  WHERE e.activo = true
    AND e.estado_laboral <> 'baja'
    AND e.es_produccion = true
  GROUP BY e.local;
$$;

GRANT EXECUTE ON FUNCTION public.pool_mano_obra_produccion() TO authenticated;

-- ─── RPC: producción mensual por receta ─────────────────────────────────────
-- Unifica las 4 tablas de lotes en una sola vista normalizada
-- (receta_id, local, cantidad, unidad) para el período YYYY-MM. La cantidad
-- queda en la unidad nativa de cada tipo (kg para relleno/masa/genérico,
-- porciones para pasta) — se usa solo para repartir el pool DENTRO de cada
-- receta, no para comparar entre recetas de distinta unidad.
CREATE OR REPLACE FUNCTION public.produccion_mensual_por_receta(p_periodo text)
RETURNS TABLE (receta_id uuid, local text, cantidad numeric, unidad text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  -- Relleno (kg)
  SELECT lr.receta_id, lr.local, SUM(lr.peso_total_kg)::numeric, 'kg'::text
  FROM cocina_lotes_relleno lr
  WHERE lr.receta_id IS NOT NULL
    AND to_char(lr.fecha, 'YYYY-MM') = p_periodo
  GROUP BY lr.receta_id, lr.local

  UNION ALL
  -- Masa (kg)
  SELECT lm.receta_id, lm.local, SUM(lm.kg_producidos)::numeric, 'kg'::text
  FROM cocina_lotes_masa lm
  WHERE lm.receta_id IS NOT NULL
    AND to_char(lm.fecha, 'YYYY-MM') = p_periodo
  GROUP BY lm.receta_id, lm.local

  UNION ALL
  -- Producción genérica (salsas, postres, panificados) — unidad nativa
  SELECT lp.receta_id, lp.local, SUM(lp.cantidad_producida)::numeric,
         COALESCE(MAX(lp.unidad), 'unid')::text
  FROM cocina_lotes_produccion lp
  WHERE lp.receta_id IS NOT NULL
    AND to_char(lp.fecha, 'YYYY-MM') = p_periodo
  GROUP BY lp.receta_id, lp.local

  UNION ALL
  -- Pasta final (porciones) — vía cocina_productos.receta_id
  SELECT cp.receta_id, lpa.local, SUM(lpa.porciones)::numeric, 'porciones'::text
  FROM cocina_lotes_pasta lpa
  JOIN cocina_productos cp ON cp.id = lpa.producto_id
  WHERE cp.receta_id IS NOT NULL
    AND to_char(lpa.fecha, 'YYYY-MM') = p_periodo
  GROUP BY cp.receta_id, lpa.local;
$$;

GRANT EXECUTE ON FUNCTION public.produccion_mensual_por_receta(text) TO authenticated;
