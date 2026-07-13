-- 130_cocina_productos_extrusion_saavedra.sql
--
-- Alta de las pastas de extrusión de Saavedra como PRODUCTOS de producción.
--
-- Contexto: "Cresta di Gallo" y "Fusilli" ya existían como RECETAS
-- (cocina_recetas, categoria='pasta') con su costeo, pero NO como productos
-- (cocina_productos). El QR de producción ("Armar Pasta") y el pizarrón leen
-- cocina_productos WHERE tipo='pasta', así que sin este registro no aparecían.
--
-- Se crean los dos productos espejando exactamente los campos de las pastas
-- existentes de Saavedra (unidad='porciones', controla_stock=true,
-- minimo_produccion=100, disponible_almacen=false) y enlazados a su receta
-- fresca (NO la variante "(CONGELADA)", que es sólo canal congelado del Menú).
--
-- Además se mapean a la subreceta "Masa Extrusion" en cocina_pasta_recetas para
-- que al armar el QR autocomplete la masa. Al ser pastas de sólo masa (sin
-- relleno) se comportan igual que "Tagliatelles al huevo".
--
-- Idempotente: ON CONFLICT en (codigo) y en (pasta_id, receta_id).

-- ── 1. Productos ────────────────────────────────────────────────────────────
insert into cocina_productos
  (nombre, codigo, tipo, unidad, local, activo, controla_stock, minimo_produccion, disponible_almacen, receta_id)
values
  ('Cresta di Gallo', 'cresg', 'pasta', 'porciones', 'saavedra', true, true, 100, false,
   'f54a81f3-2317-47a9-887f-fdcd4c58c5ff'),
  ('Fusilli',         'fussg', 'pasta', 'porciones', 'saavedra', true, true, 100, false,
   'bef945dd-08b2-45b8-9a4b-70b2623b1e6b')
on conflict (codigo) do nothing;

-- ── 2. Mapeo pasta → Masa Extrusion (rol='masa') ────────────────────────────
-- Se resuelve el pasta_id por codigo (recién insertado o preexistente) para no
-- depender del uuid autogenerado.
insert into cocina_pasta_recetas (pasta_id, receta_id)
select p.id, '3709d5c2-d13e-4add-a8b1-8e3229935dfb'::uuid
from cocina_productos p
where p.codigo in ('cresg', 'fussg')
on conflict (pasta_id, receta_id) do nothing;
