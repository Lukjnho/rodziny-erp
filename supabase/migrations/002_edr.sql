-- ============================================================
-- MÓDULO ESTADO DE RESULTADOS — Rodziny ERP
-- Ejecutar en: Supabase → SQL Editor
-- ============================================================

-- Partidas manuales del EdR (todo lo que no se calcula automáticamente desde Fudo)
CREATE TABLE IF NOT EXISTS edr_partidas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  local       TEXT NOT NULL CHECK (local IN ('vedia', 'saavedra')),
  periodo     TEXT NOT NULL,   -- 'YYYY-MM'
  concepto    TEXT NOT NULL,   -- key de la fila (ej: 'cmv_alimentos', 'pers_sueldos')
  monto       NUMERIC(14,2) NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(local, periodo, concepto)
);

CREATE INDEX IF NOT EXISTS idx_edr_local_periodo ON edr_partidas(local, periodo);
