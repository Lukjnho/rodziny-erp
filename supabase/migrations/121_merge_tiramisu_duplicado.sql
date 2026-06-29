-- 121_merge_tiramisu_duplicado.sql
-- Tiramisú tenía DOS recetas: la base real "Tiramisú" (rol='postre_base', 6
-- ingredientes, 94 lotes / 23 items de plan) y un wrapper "Tiramisu"
-- (categoria='postre', 1 ingrediente = 'Subreceta Tiramisú', solo 3 lotes / 2
-- items). El plan a veces usaba una y el QR cargaba la otra, así que el item del
-- pizarrón no se tachaba (mismo problema base/vendible que las salsas).
--
-- Fusionamos en la base canónica y desactivamos el duplicado para que el QR y el
-- editor del plan ofrezcan una sola receta de Tiramisú. Ningún producto referencia
-- el wrapper (verificado), así que desactivarlo no afecta costeo.
--
-- IDs fijos a propósito: el fix es puntual de Tiramisú (no un merge genérico de
-- postres). Idempotente: tras correr no quedan referencias al wrapper.

-- Base canónica:  589c5002-74f9-48a8-9559-12b785b3b001  ("Tiramisú", postre_base)
-- Wrapper duplic: 712d1ceb-6ff9-4d49-8d79-351229e44cbc  ("Tiramisu", categoria postre)

UPDATE cocina_lotes_produccion
SET receta_id = '589c5002-74f9-48a8-9559-12b785b3b001'
WHERE receta_id = '712d1ceb-6ff9-4d49-8d79-351229e44cbc';

UPDATE cocina_pizarron_items
SET receta_id = '589c5002-74f9-48a8-9559-12b785b3b001'
WHERE receta_id = '712d1ceb-6ff9-4d49-8d79-351229e44cbc';

UPDATE cocina_recetas
SET activo = false
WHERE id = '712d1ceb-6ff9-4d49-8d79-351229e44cbc';
