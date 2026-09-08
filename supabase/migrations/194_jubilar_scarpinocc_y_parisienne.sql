-- 194 — Jubilar el Scarpinocc de Vedia y la Salsa Parisienne de los dos locales
--
-- Decisión de Lucas, 8-sep-2026: "Scarpinocc en vedia ya no producimos mas, podes
-- desactivarlo pero que no se borre el historial de ventas ni produccion. Lo mismo
-- para la salsa parisienne en ambos locales."
--
-- POR QUÉ ESTA MIGRACIÓN EXISTE
-- Apagar la receta NO saca el producto de las tablets: el QR de producción, el
-- pizarrón de pared y el conteo de cámara arman sus listas leyendo
-- cocina_productos.activo, no cocina_recetas.activo. Y hoy no hay ninguna pantalla
-- del ERP donde apagar un producto que ya tiene receta vinculada. Ver
-- [[producto-y-receta-dos-interruptores]].
--
-- QUÉ SE APAGA Y CON QUÉ EVIDENCIA (medido contra la base el 8-sep-2026)
--   · Scarpinocc de Vacío de Cerdo (vedia) — última venta 19-ago, último lote de
--     pasta 19-jun. Facturó $8,77M en toda su vida.
--   · Salsa Parisienne (vedia)   — última venta 3-ago, última producción 31-jul.
--   · Salsa Parisienne SG (saavedra) — última venta 2-ago, última producción 31-jul.
--
-- EL HISTORIAL NO SE TOCA. `activo` solo decide si el producto se OFRECE. Las filas
-- de ventas_items, cocina_lotes_pasta, cocina_lotes_produccion, cocina_traspasos y
-- cocina_cierre_dia siguen apuntando al mismo producto_id y se leen por id sin
-- filtrar activo, así que los informes viejos siguen mostrando el nombre y los
-- números. Esta migración no borra ni una fila.
--
-- 💣 LO QUE SÍ CAMBIA, Y HAY QUE SABERLO
-- La vista v_cocina_stock_pastas termina en `WHERE p.tipo='pasta' AND p.activo=true`.
-- Apagar una pasta NO pone su stock en cero: lo esconde. El Scarpinocc queda con
-- 74 porciones netas en cámara (último conteo 23-ago) que dejan de verse en
-- Stock, pizarrón y mostrador. Si esas 74 existen de verdad en el freezer de Vedia,
-- hay que contarlas y darlas de baja aparte — esta migración no las toca.
--
-- Idempotente: el `and activo` hace que correrla dos veces no haga nada la segunda.

begin;

-- Scarpinocc de Vacío de Cerdo — Vedia
update public.cocina_productos
   set activo = false
 where id = '51c523cd-2f59-45d8-bd7d-feab3d674eb3'
   and activo;

-- Salsa Parisienne — Vedia
update public.cocina_productos
   set activo = false
 where id = 'fa8f4559-2101-46b6-9d27-8596be11277f'
   and activo;

-- Salsa Parisienne SG — Saavedra
update public.cocina_productos
   set activo = false
 where id = '069719ae-c860-4754-9a2f-274d8c433044'
   and activo;

commit;
