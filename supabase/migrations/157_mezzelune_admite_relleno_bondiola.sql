-- 157 — Las Mezzelune vuelven a ser "pasta rellena" a los ojos del QR de producción.
--
-- PROBLEMA (raíz del incidente de la migración 156):
--   El QR decide si una pasta lleva relleno mirando cocina_pasta_recetas: si el producto no
--   tiene ninguna receta mapeada con rol='relleno', pone productoAdmiteRelleno=false, deshabilita
--   el selector de relleno ("No aplica para fideos") y guarda el lote como pasta simple:
--   se va derecho a cámara con "porciones" en vez de quedar en freezer como bandejas
--   pendientes de porcionar. Los dos productos Mezzelune tenían CERO filas en esa tabla.
--
-- POR QUÉ SOLO EL RELLENO Y NINGUNA MASA:
--   masasFiltradas() en ProduccionQRPage filtra el paso "3) Masa disponible" por las recetas
--   mapeadas a la pasta, con fallback "si ninguna masa matchea, mostrar todas". Mapeando
--   únicamente el relleno se arregla el bug y las Mezzelune se siguen pudiendo armar con
--   cualquier masa (huevo, pimentón, negra carbón, cúrcuma…), que es como trabaja el equipo.
--   Si además mapeáramos "Masa Huevo Pastas Rellenas", el QR escondería las masas variantes
--   cada vez que la de huevo estuviera cargada el mismo día — el mismo problema que se
--   resolvió a mano para el Scarpinocc en may-2026.
--
-- Idempotente por el UNIQUE (pasta_id, receta_id).
--
-- PENDIENTE APARTE: esta tabla no tiene pantalla que la escriba (las únicas escrituras del repo
-- son las migraciones 019, 130 y esta). El editor va en Productos, junto a la ficha del producto.

insert into cocina_pasta_recetas (pasta_id, receta_id)
values
  -- Mezzelune de Bondiola Braseada (vedia)    <- Relleno de Bondiola Braseada (vedia)
  ('1ba373c0-eadd-4ba2-82d6-1a2419707f1d', 'a2c5c7f2-1acf-4d9b-8252-983481ba8a7b'),
  -- Mezzelune De Bondiola Braseada (saavedra) <- Relleno de Bondiola Braseada (saavedra)
  ('60b6527c-0b0e-41b2-9e0d-686149175f47', 'b0463701-c7f6-4c57-97ee-951093e6482e')
on conflict (pasta_id, receta_id) do nothing;
