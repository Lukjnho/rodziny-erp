-- 004: agregar categoria_gasto_id a productos
-- Independiente de productos.categoria (que es de depósito/inventario).
-- Self-learning: se va llenando a medida que se cargan gastos vinculados.

alter table productos
  add column if not exists categoria_gasto_id uuid
  references categorias_gasto(id) on delete set null;

create index if not exists idx_productos_categoria_gasto
  on productos(categoria_gasto_id);

notify pgrst, 'reload schema';
