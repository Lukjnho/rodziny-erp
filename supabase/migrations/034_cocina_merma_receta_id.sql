-- 034_cocina_merma_receta_id.sql
-- Permitir registrar merma contra una receta, no solo contra un producto del
-- catalogo cocina_productos. Hoy en Vedia solo hay productos tipo 'pasta', y
-- las salsas/postres/rellenos/masas viven solo como recetas en cocina_recetas
-- (idem panaderia en Saavedra). Para que el form de Merma del QR cubra todo,
-- cocina_merma necesita aceptar receta_id como alternativa a producto_id.

ALTER TABLE cocina_merma
  ADD COLUMN IF NOT EXISTS receta_id uuid REFERENCES cocina_recetas(id) ON DELETE SET NULL;

ALTER TABLE cocina_merma
  ALTER COLUMN producto_id DROP NOT NULL;

-- Garantizar que al menos uno de los dos este presente
ALTER TABLE cocina_merma
  DROP CONSTRAINT IF EXISTS cocina_merma_target_check;

ALTER TABLE cocina_merma
  ADD CONSTRAINT cocina_merma_target_check
  CHECK (producto_id IS NOT NULL OR receta_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS cocina_merma_receta_idx ON cocina_merma (receta_id) WHERE receta_id IS NOT NULL;

COMMENT ON COLUMN cocina_merma.receta_id IS
  'Receta asociada a la merma cuando el item no esta como producto del catalogo (salsas, postres, rellenos, masas, panaderia). Mutuamente exclusivo logicamente con producto_id pero no enforzado.';
