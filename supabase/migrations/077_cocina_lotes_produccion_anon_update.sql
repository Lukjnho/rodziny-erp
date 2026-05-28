-- 077: policy UPDATE anon para cocina_lotes_produccion
--
-- Bug encontrado 2026-05-28: el cierre de salsas/postres desde /mostrador
-- (PWA pública sin auth → role anon) ejecuta UPDATE en_stock=false en los
-- lotes previos antes de insertar el cierre nuevo. Sin policy UPDATE para
-- anon el UPDATE devuelve 200 OK con count=0 (silencioso): los lotes previos
-- quedan activos y el stock visible suma cierre nuevo + cierres viejos.
--
-- El mismo problema afectaba al overwrite del QR Cargar Salsa antes del
-- commit 26172b0 (modelo aditivo) y sigue afectando al overwrite de
-- pasta/milanesa en Saavedra. Esta policy lo cierra para todos los casos.
--
-- El modelo de seguridad de cocina ya era "anon escribe todo" (las PWAs del
-- chef son públicas sin login, ver policy anon_insert pre-existente). Esta
-- policy completa el set sin cambiar el threat model.
--
-- Idempotente: DROP + CREATE.

DROP POLICY IF EXISTS cocina_lotes_produccion_anon_update ON public.cocina_lotes_produccion;

CREATE POLICY cocina_lotes_produccion_anon_update
  ON public.cocina_lotes_produccion
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);
