-- 003: Reset categorías de gasto con jerarquía Categoría → Subcategoría
-- Fuente: Estado de Resultados 2026 (Lucas) — los items pintados son categorías,
-- las líneas debajo son subcategorías. Cada gasto se asocia al ID de la SUBCATEGORÍA
-- (la hoja). Las categorías padre son solo agrupador visual.

begin;

-- 1) Liberar referencias antes de truncar
update gastos set categoria_id = null;
update proveedores set categoria_default_id = null;
delete from categorias_gasto;

-- 2) Insertar padres + hijos en un solo CTE
with padres as (
  insert into categorias_gasto (nombre, parent_id, tipo_edr, activo, orden) values
    ('Costo de alimentos',             null, 'cmv_alimentos',  true, 10),
    ('Costo de bebidas',               null, 'cmv_bebidas',    true, 20),
    ('Costos indirectos de operación', null, 'cmv_indirectos', true, 30),
    ('Gastos de estructura',           null, 'gastos_op',      true, 40),
    ('Impuestos y Tasas',              null, 'impuestos_op',   true, 50),
    ('Gastos de RRHH',                 null, 'gastos_rrhh',    true, 60),
    ('Inversiones',                    null, 'inversiones',    true, 70),
    ('Intereses',                      null, 'intereses',      true, 80)
  returning id, nombre
)
insert into categorias_gasto (nombre, parent_id, tipo_edr, activo, orden)
select sub.nombre, p.id, sub.tipo_edr, true, sub.orden
from padres p
join (values
  -- Costo de alimentos
  ('Costo de alimentos','Aceites y vinagres','cmv_alimentos',101),
  ('Costo de alimentos','Carnes, embutidos y pescados','cmv_alimentos',102),
  ('Costo de alimentos','Condimentos, agregados y aderezos','cmv_alimentos',103),
  ('Costo de alimentos','Costos de empaque directos','cmv_alimentos',104),
  ('Costo de alimentos','Harinas y huevos','cmv_alimentos',105),
  ('Costo de alimentos','Ingredientes para postres','cmv_alimentos',106),
  ('Costo de alimentos','Lacteos y quesos','cmv_alimentos',107),
  ('Costo de alimentos','Panificados','cmv_alimentos',108),
  ('Costo de alimentos','Verduras congeladas','cmv_alimentos',109),
  ('Costo de alimentos','Verduras, frutas, hongos y enlatados','cmv_alimentos',110),
  -- Costo de bebidas
  ('Costo de bebidas','Bebidas para venta','cmv_bebidas',201),
  ('Costo de bebidas','Hielo','cmv_bebidas',202),
  ('Costo de bebidas','Ingredientes para bebidas','cmv_bebidas',203),
  -- Indirectos
  ('Costos indirectos de operación','Descartables y plásticos','cmv_indirectos',301),
  ('Costos indirectos de operación','Fletes y transporte','cmv_indirectos',302),
  ('Costos indirectos de operación','Jardinería','cmv_indirectos',303),
  ('Costos indirectos de operación','Productos de limpieza','cmv_indirectos',304),
  -- Gastos de estructura
  ('Gastos de estructura','Agua','gastos_op',401),
  ('Gastos de estructura','Alquiler','gastos_op',402),
  ('Gastos de estructura','Cobertura médica','gastos_op',403),
  ('Gastos de estructura','Electricidad','gastos_op',404),
  ('Gastos de estructura','Gas','gastos_op',405),
  ('Gastos de estructura','Internet','gastos_op',406),
  ('Gastos de estructura','Marketing','gastos_op',407),
  ('Gastos de estructura','Seguridad','gastos_op',408),
  ('Gastos de estructura','Seguro','gastos_op',409),
  ('Gastos de estructura','AADI CAPIF','gastos_op',410),
  ('Gastos de estructura','Mantenimiento','gastos_op',411),
  ('Gastos de estructura','ChatGPT','gastos_op',412),
  ('Gastos de estructura','Honorarios profesionales','gastos_op',413),
  ('Gastos de estructura','Papelería y librería','gastos_op',414),
  ('Gastos de estructura','Servicios bancarios','gastos_op',415),
  ('Gastos de estructura','Tienda de Puntos','gastos_op',416),
  -- Impuestos
  ('Impuestos y Tasas','Chaco ATP','impuestos_op',501),
  ('Impuestos y Tasas','Industria y comercio','impuestos_op',502),
  ('Impuestos y Tasas','Tasas y servicios','impuestos_op',503),
  ('Impuestos y Tasas','Anticipo de Ganancias','impuestos_op',504),
  ('Impuestos y Tasas','IVA','impuestos_op',505),
  ('Impuestos y Tasas','Regularización de impuestos','impuestos_op',506),
  -- RRHH
  ('Gastos de RRHH','Capacitaciones y certificaciones','gastos_rrhh',601),
  ('Gastos de RRHH','Aguinaldo','sueldos',602),
  ('Gastos de RRHH','Cargas sociales','cargas_sociales',603),
  ('Gastos de RRHH','Sueldos','sueldos',604),
  -- Inversiones
  ('Inversiones','Mejoras del local','inversiones',701),
  ('Inversiones','Maquinaria','inversiones',702),
  ('Inversiones','Utensilios varios','inversiones',703),
  -- Intereses
  ('Intereses','Préstamos','intereses',801)
) as sub(padre, nombre, tipo_edr, orden) on sub.padre = p.nombre;

-- 3) Backfill: matchear gastos legacy contra el nombre de la subcategoría
update gastos g
set categoria_id = c.id
from categorias_gasto c
where c.parent_id is not null
  and g.categoria_id is null
  and g.categoria is not null
  and lower(trim(g.categoria)) = lower(trim(c.nombre));

update gastos g
set categoria_id = c.id
from categorias_gasto c
where c.parent_id is not null
  and g.categoria_id is null
  and g.subcategoria is not null
  and lower(trim(g.subcategoria)) = lower(trim(c.nombre));

commit;

notify pgrst, 'reload schema';
