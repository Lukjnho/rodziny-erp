-- 019_cocina_pasta_recetas_mapping.sql
-- Invierte el flujo del QR "Armar pasta": el cocinero elige relleno + masa
-- disponibles, y la pasta final se autocompleta según mapping N:M. También:
--  - reclasifica "Pure papa para ñoqui" de tipo relleno → masa (conceptualmente
--    es la masa del ñoqui; un lote de puré se divide entre ñoquis comunes y
--    ñoquis rellenos)
--  - migra lotes históricos de cocina_lotes_relleno → cocina_lotes_masa
--  - desactiva duplicados en Saavedra ("Ñoquis de Papa Relleno" y
--    "Masa Huevo Pasta Rellenas")
--  - agrega cocina_lotes_pasta.muzzarella_gramos (ñoquis rellenos llevan
--    muzzarella que se agrega al armar, no viene dentro del relleno)

-- ── 1. Desactivar duplicados en Saavedra ─────────────────────────────────────
UPDATE cocina_recetas SET activo = false
WHERE id IN (
  '5f17a652-e1ce-4e98-8bf1-41937bb0762d',
  '2348be9e-0222-4da8-91a2-87744d6a92af'
);

-- ── 2. Nullificar referencias incorrectas al puré como relleno ──────────────
-- Hay 1 lote histórico (Capeletti Pollo cap-2304) que tenía el puré en el slot
-- lote_relleno_id por error de carga del operario. Se anula la FK pero queda
-- registrada la inconsistencia en notas.
UPDATE cocina_lotes_pasta
SET
  notas = COALESCE(notas || ' | ', '') ||
          '[migration 019] lote_relleno_id apuntaba a lote de Puré de papa ' ||
          '(' || lote_relleno_id::text || '), se anuló porque el puré pasó a ser tipo masa',
  lote_relleno_id = NULL
WHERE lote_relleno_id IN (
  SELECT id FROM cocina_lotes_relleno
  WHERE receta_id IN (
    '9db82c12-93d7-4ed1-a0e8-2eb699cbfef9',
    'ab291054-3b5e-4b49-aa9e-ab6cd64e74a5'
  )
);

-- ── 3. Migrar lotes históricos de puré a cocina_lotes_masa ──────────────────
INSERT INTO cocina_lotes_masa (
  id, receta_id, fecha, kg_producidos, kg_sobrante, destino_sobrante,
  local, responsable, notas, created_at
)
SELECT
  id, receta_id, fecha, peso_total_kg, NULL, NULL,
  local, responsable, notas, created_at
FROM cocina_lotes_relleno
WHERE receta_id IN (
  '9db82c12-93d7-4ed1-a0e8-2eb699cbfef9',
  'ab291054-3b5e-4b49-aa9e-ab6cd64e74a5'
);

DELETE FROM cocina_lotes_relleno
WHERE receta_id IN (
  '9db82c12-93d7-4ed1-a0e8-2eb699cbfef9',
  'ab291054-3b5e-4b49-aa9e-ab6cd64e74a5'
);

-- ── 4. Reclasificar puré de papa a masa ──────────────────────────────────────
UPDATE cocina_recetas
SET tipo = 'masa'
WHERE id IN (
  '9db82c12-93d7-4ed1-a0e8-2eb699cbfef9',
  'ab291054-3b5e-4b49-aa9e-ab6cd64e74a5'
);

-- ── 5. Columna muzzarella_gramos en cocina_lotes_pasta ──────────────────────
ALTER TABLE cocina_lotes_pasta
  ADD COLUMN IF NOT EXISTS muzzarella_gramos integer NULL;

COMMENT ON COLUMN cocina_lotes_pasta.muzzarella_gramos IS
  'Gramos de muzzarella usados al armar ñoquis rellenos (NULL para otras pastas)';

-- ── 6. Tabla de mapping pasta ↔ receta (N:M) ────────────────────────────────
CREATE TABLE IF NOT EXISTS cocina_pasta_recetas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pasta_id uuid NOT NULL REFERENCES cocina_productos(id) ON DELETE CASCADE,
  receta_id uuid NOT NULL REFERENCES cocina_recetas(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pasta_id, receta_id)
);

CREATE INDEX IF NOT EXISTS cocina_pasta_recetas_receta_idx ON cocina_pasta_recetas (receta_id);
CREATE INDEX IF NOT EXISTS cocina_pasta_recetas_pasta_idx ON cocina_pasta_recetas (pasta_id);

COMMENT ON TABLE cocina_pasta_recetas IS
  'Mapping N:M entre pastas finales y sus recetas de masa/relleno predeterminadas. Sirve para autocompletar la pasta al elegir relleno+masa en el QR de producción.';

ALTER TABLE cocina_pasta_recetas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cocina_pasta_recetas_select_anon"
  ON cocina_pasta_recetas FOR SELECT TO anon USING (true);

CREATE POLICY "cocina_pasta_recetas_authenticated_all"
  ON cocina_pasta_recetas FOR ALL TO authenticated
  USING (tiene_permiso('cocina')) WITH CHECK (tiene_permiso('cocina'));

-- ── 7. Poblar mapping inicial ───────────────────────────────────────────────
INSERT INTO cocina_pasta_recetas (pasta_id, receta_id) VALUES
  -- VEDIA
  ('b50ed093-b778-4934-92e0-9093346bb062', '0900702e-b83c-487f-a77d-5c94977f48d8'), -- Capeletti Pollo ← Relleno Pollo
  ('b50ed093-b778-4934-92e0-9093346bb062', '746a51a2-fd8d-4b01-813a-ba00deda1d7e'), -- Capeletti Pollo ← Masa Rellenas
  ('d66631cd-8b20-46b2-800f-1646b3fc23a1', '9db82c12-93d7-4ed1-a0e8-2eb699cbfef9'), -- Ñoquis papa ← Puré
  ('6cd398b2-7b21-47e7-b780-397fae2f7f7b', '9db82c12-93d7-4ed1-a0e8-2eb699cbfef9'), -- Ñoquis rellenos ← Puré
  ('6cd398b2-7b21-47e7-b780-397fae2f7f7b', 'a006faeb-39b2-4f75-b576-a0807a26192e'), -- Ñoquis rellenos ← Relleno Ñoquis
  ('f5c5dba4-c62e-415f-a4d0-9a0df2428e66', 'fcaa4f71-e484-4ecb-b0c4-ce57e83b12fe'), -- Ravioli ← Relleno Espinaca
  ('f5c5dba4-c62e-415f-a4d0-9a0df2428e66', '746a51a2-fd8d-4b01-813a-ba00deda1d7e'), -- Ravioli ← Masa Rellenas
  ('51c523cd-2f59-45d8-bd7d-feab3d674eb3', '9c484605-b1be-41d3-8acf-d33d50c21e89'), -- Scarpinocc ← Relleno Vacío
  ('51c523cd-2f59-45d8-bd7d-feab3d674eb3', '746a51a2-fd8d-4b01-813a-ba00deda1d7e'), -- Scarpinocc ← Masa Rellenas
  ('bab4933b-cc57-430f-8c29-0de16ed1682b', '4b1d4083-e9a4-4551-904a-c3abfd78fdae'), -- Sorrentinos ← Relleno Jamón
  ('bab4933b-cc57-430f-8c29-0de16ed1682b', '746a51a2-fd8d-4b01-813a-ba00deda1d7e'), -- Sorrentinos ← Masa Rellenas
  ('b0c383f8-28d3-4bfd-b1a7-49b43d33b331', '53cddb69-6254-4083-89a9-945a15eb8b64'), -- Tagliatelles huevo ← Masa Simples
  -- SAAVEDRA
  ('00f1c533-e39f-4bb9-a795-f7111c4eeb01', '889f7893-59ab-4126-abca-15c258e4cf43'), -- Caprese ← Relleno Caprese
  ('00f1c533-e39f-4bb9-a795-f7111c4eeb01', '6844b2ac-4e4c-4b97-b9af-793a410f7fe2'), -- Caprese ← Masa Rellenas
  ('244e211c-3e2b-457c-a697-431c488a5950', 'b258f269-2c93-478b-8fae-8457ef71949b'), -- Mezzelune ← Bondiola
  ('244e211c-3e2b-457c-a697-431c488a5950', '6844b2ac-4e4c-4b97-b9af-793a410f7fe2'), -- Mezzelune ← Masa Rellenas
  ('769d1f3a-57b4-433e-b9da-972435e97bb2', 'ab291054-3b5e-4b49-aa9e-ab6cd64e74a5'), -- Ñoquis SG ← Puré SG
  ('133cf342-a8fe-4c10-a934-2769d10efebb', 'ab291054-3b5e-4b49-aa9e-ab6cd64e74a5'), -- Ñoquis rellenos SG ← Puré SG
  ('133cf342-a8fe-4c10-a934-2769d10efebb', 'e9521389-2104-41fe-bebb-9ccd0d68af9c'), -- Ñoquis rellenos SG ← Relleno Ñoquis
  ('686dd84c-e84f-4f18-877f-489d2bad8ccf', 'ae675ec8-d2a9-4ea5-a27b-d4a12938d5e1'), -- Scarpinocc SG ← Relleno Jamón
  ('686dd84c-e84f-4f18-877f-489d2bad8ccf', '6844b2ac-4e4c-4b97-b9af-793a410f7fe2'), -- Scarpinocc SG ← Masa Rellenas
  ('54ca341e-cf2a-4720-9924-9a0a6cd1d378', 'cebee35e-41bc-4a84-9232-08992b8c567b'), -- Spaghetti huevo SG ← Masa Simples
  ('27853865-949e-42c1-97fe-ca3088a6a0f8', 'cebee35e-41bc-4a84-9232-08992b8c567b'); -- Spaghetti milanesa SG ← Masa Simples
