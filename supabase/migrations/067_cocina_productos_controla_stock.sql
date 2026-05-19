-- 067: control de stock opt-out por producto.
-- Algunos productos no se controlan en stock (decisión del admin desde Cocina > Stock).
-- Independiente de 'activo' (que prende/apaga el producto en TODO el ERP): un producto
-- puede estar activo en QR/recetas/menú pero quedar fuera del control de stock.
-- Default true: todos arrancan controlados, sin cambio de comportamiento.

ALTER TABLE cocina_productos
  ADD COLUMN controla_stock boolean NOT NULL DEFAULT true;
