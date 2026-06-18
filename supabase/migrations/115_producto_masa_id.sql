-- Vínculo masa de panadería → producto de pan. El QR "Cargar Panadería" lo usa
-- para: dado un lote de masa producida (rol=masa_panaderia), saber a qué producto
-- terminado (cocina_productos) sumarle stock cuando el panadero carga cuántos
-- panes salieron. masa_id apunta a la subreceta masa_panaderia de la que sale el
-- producto. NULL = el producto no se produce desde una masa trackeada (ej. pastas,
-- salsas) o todavía no se vinculó.
ALTER TABLE cocina_productos
  ADD COLUMN IF NOT EXISTS masa_id uuid REFERENCES cocina_recetas(id);

COMMENT ON COLUMN cocina_productos.masa_id IS
  'Masa de panaderia (cocina_recetas rol=masa_panaderia) de la que sale este producto. Usado por el QR Cargar Panaderia para sumar stock de panes y descontar la masa consumida.';

-- Vincular los 5 panes 1:1 con su masa SIN GLUTEN (Saavedra).
UPDATE cocina_productos p
SET masa_id = r.id
FROM cocina_recetas r
WHERE r.local = 'saavedra' AND r.rol = 'masa_panaderia'
  AND p.local = 'saavedra' AND p.tipo = 'panificado'
  AND (
    (p.codigo = 'plac' AND r.nombre = 'Masa para Pan Lactal SIN GLUTEN') OR
    (p.codigo = 'pmol' AND r.nombre = 'Masa para Pan de Molde SIN GLUTEN') OR
    (p.codigo = 'pbri' AND r.nombre = 'Masa para Pan Brioche SIN GLUTEN') OR
    (p.codigo = 'pcam' AND r.nombre = 'Masa para Pan de Campo SIN GLUTEN') OR
    (p.codigo = 'pser' AND r.nombre = 'Masa para pan de servicio SIN GLUTEN')
  );
