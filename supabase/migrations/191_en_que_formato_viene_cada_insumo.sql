-- ============================================================================
-- 191 — EN QUÉ FORMATO VIENE CADA INSUMO
-- ============================================================================
--
-- QUÉ PASA HOY
-- ------------
-- La Calculadora de Cocina dice "necesitás 37,4 kg de harina de arroz". Nadie
-- compra 37,4 kg: se compran DOS BOLSAS DE 25. Ese redondeo lo viene haciendo
-- Lucas de memoria, insumo por insumo, cada vez que arma la proyección de la
-- semana (7-sep-2026: «sumamos el requerido de materia prima de lo que vamos a
-- producir y redondeamos dependiendo de los formatos de como viene cada
-- producto»).
--
-- El dato NO existe en ninguna tabla del ERP. `productos` guarda la unidad
-- (kg / L / unid.), el costo y el proveedor, pero no en qué presentación llega.
--
--
-- POR QUÉ NO ALCANZA CON LEERLO DEL NOMBRE
-- ----------------------------------------
-- Al no haber campo, el formato se fue filtrando dentro del nombre del insumo:
--
--     "Leche Sachet x 1 L"        → el sachet es de 1 L
--     "Bolsa de hielo x 10kg."    → la bolsa es de 10 kg
--     "Huevos (~60g/unid)"        → dice cuánto pesa UNO, no que se compran
--                                    por maple de 30
--
-- Son tres casos sobre 215 insumos, escritos cada uno a su manera, y el tercero
-- ni siquiera habla de la compra. Adivinar el formato leyendo el nombre daría
-- números de compra inventados, que es peor que no dar ninguno.
--
--
-- LO QUE HACE ESTA MIGRACIÓN
-- --------------------------
-- Dos columnas en `productos`:
--
--     bulto_cantidad → cuánto trae UN bulto, en la MISMA unidad del insumo
--                      (harina de arroz en kg → 25 ; aceite en L → 5)
--     bulto_nombre   → cómo se le dice a ese bulto: bolsa, bidón, caja, maple…
--
-- Con eso, "37,4 kg" pasa a mostrarse como "2 bolsas de 25 kg".
--
--
-- LO QUE NO HACE
-- --------------
--   * No obliga a cargarlo. Los 215 insumos arrancan en NULL y la lista de
--     compra los sigue mostrando como hoy, con el kilaje pelado. Se cargan de a
--     poco, empezando por los que más se compran.
--   * No decide el redondeo. Cuántos bultos hacen falta lo calcula la pantalla
--     (siempre hacia arriba: 37,4 ÷ 25 = 1,49 → 2 bolsas).
--   * No toca stock, ni costos, ni recetas.
-- ============================================================================

alter table productos
  add column if not exists bulto_cantidad numeric,
  add column if not exists bulto_nombre   text;

comment on column productos.bulto_cantidad is
  'Cuánto trae un bulto de compra, en la unidad del insumo (kg/L/unid.). NULL = no cargado: la lista de compra muestra la cantidad suelta.';
comment on column productos.bulto_nombre is
  'Nombre del envase de compra: bolsa, bidón, caja, maple, sachet, cajón. NULL = no cargado.';

-- Un bulto de 0 o negativo rompería la división del redondeo.
alter table productos
  drop constraint if exists productos_bulto_cantidad_check;
alter table productos
  add constraint productos_bulto_cantidad_check
  check (bulto_cantidad is null or bulto_cantidad > 0);
