-- 079_cocina_lotes_excluido_analisis.sql
-- Soft-delete para excluir lotes basura del cálculo de rendimiento del tab
-- Análisis. Antes los lotes con error de unidad (8550 kg cuando eran 8,55)
-- distorsionaban totalmente los promedios. La columna queda accesible para
-- auditar / des-excluir manualmente sin perder histórico.

ALTER TABLE cocina_lotes_relleno
  ADD COLUMN IF NOT EXISTS excluido_analisis boolean NOT NULL DEFAULT false;

ALTER TABLE cocina_lotes_masa
  ADD COLUMN IF NOT EXISTS excluido_analisis boolean NOT NULL DEFAULT false;

ALTER TABLE cocina_lotes_produccion
  ADD COLUMN IF NOT EXISTS excluido_analisis boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN cocina_lotes_relleno.excluido_analisis IS
  'true = no entra en el cálculo de rendimiento del tab Análisis (basura por error de unidad u otra anomalía). Se mantiene en la tabla para auditoría.';
COMMENT ON COLUMN cocina_lotes_masa.excluido_analisis IS
  'true = no entra en el cálculo de rendimiento del tab Análisis (basura por error de unidad u otra anomalía). Se mantiene en la tabla para auditoría.';
COMMENT ON COLUMN cocina_lotes_produccion.excluido_analisis IS
  'true = no entra en el cálculo de rendimiento del tab Análisis (basura por error de unidad u otra anomalía). Se mantiene en la tabla para auditoría.';
