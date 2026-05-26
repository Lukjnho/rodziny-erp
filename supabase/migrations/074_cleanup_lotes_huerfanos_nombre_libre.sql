-- 074: cleanup de lotes huérfanos con nombre_libre
--
-- Hasta hoy, el cierre de salsas/postres/panadería (MostradorPage) apagaba los
-- lotes anteriores solo por receta_id. Los lotes viejos del modelo previo que
-- usaban nombre_libre (sin receta_id) quedaban activos y se SUMABAN al stock
-- visible junto con el lote nuevo del cierre — por eso el tab Stock mostraba
-- valores acumulados que no se actualizaban al cerrar.
--
-- Este cleanup desactiva esos huérfanos SOLO cuando el producto ya tiene una
-- receta vinculada en cocina_productos. Si el producto no tiene receta, el lote
-- huérfano se deja activo porque podría ser su única fuente de stock.
--
-- Idempotente: solo apaga (no borra), y el WHERE evita re-procesar.

UPDATE cocina_lotes_produccion l
SET en_stock = false
WHERE l.en_stock = true
  AND l.receta_id IS NULL
  AND l.nombre_libre IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM cocina_productos p
    WHERE p.local = l.local
      AND p.activo = true
      AND p.receta_id IS NOT NULL
      AND LOWER(TRIM(p.nombre)) = LOWER(TRIM(l.nombre_libre))
  );
