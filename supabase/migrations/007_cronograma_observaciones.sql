-- 007: observaciones por asignación de cronograma
-- Ej: "cubre turno de X", "llega tarde avisado", etc.

alter table cronograma
  add column if not exists observaciones text;

notify pgrst, 'reload schema';
