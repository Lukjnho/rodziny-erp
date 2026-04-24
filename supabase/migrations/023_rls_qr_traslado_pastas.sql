-- 023_rls_qr_traslado_pastas.sql
-- Habilita el QR público de traslado de pastas (nuevo tab del QR de depósito).
-- Requiere anon INSERT + SELECT en cocina_traspasos (para registrar) y anon SELECT
-- en cocina_merma (para calcular stock disponible como en PastasTerminadasPanel).
-- Mantiene intacta la policy authenticated con tiene_permiso('cocina').

-- ── cocina_traspasos: anon SELECT + INSERT ──────────────────────────────────
CREATE POLICY "cocina_traspasos_anon_select"
  ON cocina_traspasos FOR SELECT TO anon USING (true);

CREATE POLICY "cocina_traspasos_anon_insert"
  ON cocina_traspasos FOR INSERT TO anon WITH CHECK (true);

-- ── cocina_merma: anon SELECT ────────────────────────────────────────────────
CREATE POLICY "cocina_merma_anon_select"
  ON cocina_merma FOR SELECT TO anon USING (true);
