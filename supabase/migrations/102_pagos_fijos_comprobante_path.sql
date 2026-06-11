-- 102 — Comprobante adjunto en pagos fijos
-- Permite adjuntar un comprobante (ej. el PDF del VEP que manda el contador) a un
-- pago fijo. Lo usa la integración de Documentos del contador: un VEP detectado se
-- carga como pago fijo del mes de vencimiento con su PDF.
alter table public.pagos_fijos add column if not exists comprobante_path text;
