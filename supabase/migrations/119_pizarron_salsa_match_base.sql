-- 119_pizarron_salsa_match_base.sql
-- Fix: las salsas planificadas con la receta VENDIBLE (categoria='salsa') nunca
-- se tachaban del pizarrón. El QR de producción solo carga la subreceta Base
-- (rol='salsa_base'), y el trigger trg_pizarron_lote_produccion matchea el item
-- por receta_id. Si el plan guardó la vendible (otro receta_id) el match falla y
-- el item queda "pendiente" para siempre aunque la salsa se haya cargado.
--
-- A partir de ahora el editor del plan solo ofrece la Base (cambio en
-- PlanProduccionEditor.tsx), así que plan y QR comparten receta_id.
--
-- Esta migración corrige los datos ya cargados:
--   1. Repunta receta_id vendible -> base en los items de salsa ABIERTOS
--      (pendiente / en_produccion / en_bandejas). Los ciclo_completo se dejan
--      como están (ya muestran bien).
--   2. Tacha (ciclo_completo) los items abiertos que tengan un lote de salsa
--      Base cargado dentro de la ventana de carry-over (lote en [fecha_objetivo,
--      fecha_objetivo + 7 días]), replicando lo que habría hecho el trigger.
--
-- El vínculo vendible->base se deriva por convención de nombre: el 1er
-- ingrediente de la receta vendible se llama 'Subreceta <Nombre de la Base>'.
-- Idempotente: re-ejecutarla no cambia nada una vez aplicada.

-- ── 1. Repuntar receta_id vendible -> base en items abiertos ──────────────────
WITH base_map AS (
  SELECT v.id AS vend_id, b.id AS base_id
  FROM cocina_recetas v
  JOIN LATERAL (
    SELECT ri.nombre
    FROM cocina_receta_ingredientes ri
    WHERE ri.receta_id = v.id
    ORDER BY ri.orden
    LIMIT 1
  ) ing ON true
  JOIN cocina_recetas b
    ON b.rol = 'salsa_base'
   AND b.local = v.local
   AND b.activo
   AND ('Subreceta ' || b.nombre) = ing.nombre
  WHERE v.categoria = 'salsa' AND v.activo
)
UPDATE cocina_pizarron_items pi
SET receta_id = bm.base_id
FROM base_map bm
WHERE pi.tipo = 'salsa'
  AND pi.receta_id = bm.vend_id
  AND pi.estado IN ('pendiente', 'en_produccion', 'en_bandejas');

-- ── 2. Tachar items abiertos que ya tienen lote Base cargado ──────────────────
UPDATE cocina_pizarron_items pi
SET estado = 'ciclo_completo',
    lote_tabla = 'cocina_lotes_produccion',
    lote_id = lp.id,
    cantidad_hecha = COALESCE(pi.cantidad_hecha, pi.cantidad_recetas),
    completado_en = COALESCE(pi.completado_en, now())
FROM cocina_lotes_produccion lp
WHERE pi.tipo = 'salsa'
  AND pi.estado IN ('pendiente', 'en_produccion', 'en_bandejas')
  AND lp.categoria = 'salsa'
  AND lp.receta_id = pi.receta_id
  AND lp.local = pi.local
  AND lp.fecha BETWEEN pi.fecha_objetivo AND (pi.fecha_objetivo + INTERVAL '7 days')::date;
