-- 038_perfiles_local_restringido.sql
-- Permite restringir un perfil a un solo local (vedia o saavedra).
-- Caso de uso: el chef de Vedia (José) solo debe ver datos de Vedia en Cocina.
-- NULL = sin restricción (comportamiento actual).

ALTER TABLE perfiles
  ADD COLUMN IF NOT EXISTS local_restringido text
  CHECK (local_restringido IN ('vedia', 'saavedra'));

UPDATE perfiles
  SET local_restringido = 'vedia'
  WHERE user_id = 'a2511c90-70b0-4e91-90de-0711a21ee77a';
