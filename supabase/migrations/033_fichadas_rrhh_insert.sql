-- 033_fichadas_rrhh_insert.sql
-- Permitir a usuarios authenticated con permiso 'rrhh' insertar fichajes manuales
-- desde el panel admin (modal "Fichaje manual" cuando alguien se olvido el celular).
--
-- La policy fichadas_anon_insert ya existe pero solo aplica al rol 'anon' (kiosko
-- PWA publica sin login). Para authenticated faltaba INSERT.

CREATE POLICY fichadas_rrhh_insert ON fichadas
  FOR INSERT TO authenticated
  WITH CHECK (tiene_permiso('rrhh'));
