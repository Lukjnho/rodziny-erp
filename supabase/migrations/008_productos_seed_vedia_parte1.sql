-- 008 (parte 1 Vedia): seed de productos insumos — Aceites, Bebidas, Carnes, Condimentos
-- ON CONFLICT DO NOTHING: no pisa precios existentes en el ERP.
-- Costo_unitario = coste_medio / formato_compra.

-- Constraint único por (nombre, local) para poder hacer ON CONFLICT
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'productos_nombre_local_unique'
  ) then
    alter table productos
      add constraint productos_nombre_local_unique unique (nombre, local);
  end if;
end$$;

-- ─── VEDIA — Aceites y vinagres ────────────────────────────────────────────
insert into productos (nombre, marca, categoria, unidad, proveedor, costo_unitario, stock_actual, stock_minimo, activo, local) values
  ('Aceite de Girasol',   'Natura',                          'Aceites y vinagres', 'L', 'Don Vitto', 3284.62, 0, 0, true, 'vedia'),
  ('Aceite de Oliva',     'Olivares de la costa riojana',    'Aceites y vinagres', 'L', 'Don Vitto', 4979.83, 0, 0, true, 'vedia'),
  ('Vinagre de Alcohol',  'Marvavic',                        'Aceites y vinagres', 'L', 'Don Vitto', 1050.63, 0, 0, true, 'vedia')
on conflict (nombre, local) do nothing;

-- ─── VEDIA — Bebidas para venta ────────────────────────────────────────────
insert into productos (nombre, marca, categoria, unidad, proveedor, costo_unitario, stock_actual, stock_minimo, activo, local) values
  ('7 Locos La Coja',                     null,        'Bebidas para venta', 'unid.', 'Cleto Almacen de vinos', 8500.00,  0, 0, true, 'vedia'),
  ('7 Up Lata 354cc',                     null,        'Bebidas para venta', 'unid.', 'CLARG',                  1118.23,  0, 0, true, 'vedia'),
  ('Agua con Gas 500cc',                  'Eco de los Andes', 'Bebidas para venta', 'unid.', 'CLARG',            1286.99,  0, 0, true, 'vedia'),
  ('Agua sin Gas 500cc',                  'Eco de los Andes', 'Bebidas para venta', 'unid.', 'CLARG',            1202.92,  0, 0, true, 'vedia'),
  ('Amber Deposito',                      'El perro',  'Bebidas para venta', 'L',     null,                     3350.00,  0, 0, true, 'vedia'),
  ('APA Deposito',                        'El perro',  'Bebidas para venta', 'L',     null,                     3200.00,  0, 0, true, 'vedia'),
  ('Aperol Botella 750cc',                null,        'Bebidas para venta', 'unid.', null,                     6791.01,  0, 0, true, 'vedia'),
  ('Bolsa de Hielo 10kg',                 'Polo Sur',  'Bebidas para venta', 'Kg',    'Polo Sur',                400.00,  0, 0, true, 'vedia'),
  ('Campari Botella 750cc',               null,        'Bebidas para venta', 'unid.', null,                     6791.18,  0, 0, true, 'vedia'),
  ('Cynar Botella 750cc',                 null,        'Bebidas para venta', 'unid.', null,                     5893.81,  0, 0, true, 'vedia'),
  ('Dorada Deposito',                     'El perro',  'Bebidas para venta', 'L',     null,                     2750.00,  0, 0, true, 'vedia'),
  ('Dos Makila Chardonnay',               null,        'Bebidas para venta', 'unid.', 'Cleto Almacen de vinos', 6500.00,  0, 0, true, 'vedia'),
  ('Dos Makila Malbec',                   null,        'Bebidas para venta', 'unid.', 'Cleto Almacen de vinos', 4500.00,  0, 0, true, 'vedia'),
  ('Fernet Branca 750 ml',                null,        'Bebidas para venta', 'unid.', null,                     13064.70, 0, 0, true, 'vedia'),
  ('Gin botella 750cc',                   'AD Libitum','Bebidas para venta', 'unid.', 'AD Libitum',             15000.00, 0, 0, true, 'vedia'),
  ('H2O Manzana',                         null,        'Bebidas para venta', 'unid.', 'CLARG',                   3469.50, 0, 0, true, 'vedia'),
  ('H2O Pomelo 1.5 L',                    null,        'Bebidas para venta', 'unid.', 'CLARG',                   7267.74, 0, 0, true, 'vedia'),
  ('H2O POMELO 500 cc',                   null,        'Bebidas para venta', 'unid.', 'CLARG',                   6020.88, 0, 0, true, 'vedia'),
  ('Huelga de Amores Chardonnay Dulce',   null,        'Bebidas para venta', 'unid.', 'Cleto Almacen de vinos',  6500.00, 0, 0, true, 'vedia'),
  ('Huelga de Amores Malbec Reserva',     null,        'Bebidas para venta', 'unid.', 'Cleto Almacen de vinos',  7000.00, 0, 0, true, 'vedia'),
  ('Jarabe Granadina 1L',                 null,        'Bebidas para venta', 'unid.', null,                      5400.00, 0, 0, true, 'vedia'),
  ('Jean Rivier Tocai Legendario',        null,        'Bebidas para venta', 'unid.', 'Cleto Almacen de vinos',  4200.00, 0, 0, true, 'vedia'),
  ('Kilari Patero',                       null,        'Bebidas para venta', 'unid.', 'Cleto Almacen de vinos',  6500.00, 0, 0, true, 'vedia'),
  ('La Iride Chardonnay dulce',           null,        'Bebidas para venta', 'unid.', 'Cleto Almacen de vinos',  7000.00, 0, 0, true, 'vedia'),
  ('La Iride Malbec Rose Dulce',          null,        'Bebidas para venta', 'unid.', 'Cleto Almacen de vinos',  6500.00, 0, 0, true, 'vedia'),
  ('Lote AB Chardonnay',                  null,        'Bebidas para venta', 'unid.', 'Cleto Almacen de vinos',  4400.00, 0, 0, true, 'vedia'),
  ('Marco Zunino Blend',                  null,        'Bebidas para venta', 'unid.', 'Cleto Almacen de vinos',  8150.00, 0, 0, true, 'vedia'),
  ('Marco Zunino C. Sauvignon',           null,        'Bebidas para venta', 'unid.', 'Cleto Almacen de vinos',  9300.00, 0, 0, true, 'vedia'),
  ('Marco Zunino Malbec Bonarda',         null,        'Bebidas para venta', 'unid.', 'Cleto Almacen de vinos',  5500.00, 0, 0, true, 'vedia'),
  ('Marco Zunino Malbec Cerezo',          null,        'Bebidas para venta', 'unid.', 'Cleto Almacen de vinos', 10500.00, 0, 0, true, 'vedia'),
  ('Marco Zunino Reserva Malbec',         null,        'Bebidas para venta', 'unid.', 'Cleto Almacen de vinos', 13600.00, 0, 0, true, 'vedia'),
  ('Mirinda Lata 354cc',                  null,        'Bebidas para venta', 'unid.', 'CLARG',                    975.65, 0, 0, true, 'vedia'),
  ('Nepa Deposito',                       null,        'Bebidas para venta', 'L',     null,                      4100.00, 0, 0, true, 'vedia'),
  ('Paso de los toros Pomelo 2.250',      null,        'Bebidas para venta', 'unid.', 'CLARG',                   2623.48, 0, 0, true, 'vedia'),
  ('Paso de los Toros Pomelo Lata',       null,        'Bebidas para venta', 'unid.', 'CLARG',                    765.46, 0, 0, true, 'vedia'),
  ('Paso de los Toros Tonica 1500cc',     null,        'Bebidas para venta', 'unid.', 'CLARG',                   2173.69, 0, 0, true, 'vedia'),
  ('Paso de los Toros Tonica Lata',       null,        'Bebidas para venta', 'unid.', 'CLARG',                    765.46, 0, 0, true, 'vedia'),
  ('Pepsi Lata 354cc',                    null,        'Bebidas para venta', 'unid.', 'CLARG',                   1114.90, 0, 0, true, 'vedia'),
  ('Pepsi Light Lata 350cc',              null,        'Bebidas para venta', 'unid.', 'CLARG',                   1051.12, 0, 0, true, 'vedia'),
  ('Pepsi Light x500cc',                  null,        'Bebidas para venta', 'unid.', 'CLARG',                   1850.06, 0, 0, true, 'vedia'),
  ('Pulpa Anana 1kg',                     null,        'Bebidas para venta', 'unid.', null,                      8300.00, 0, 0, true, 'vedia'),
  ('Pulpa Durazno 1kg',                   null,        'Bebidas para venta', 'unid.', null,                      5400.00, 0, 0, true, 'vedia'),
  ('Pulpa Mango 1kg',                     null,        'Bebidas para venta', 'unid.', null,                      5400.00, 0, 0, true, 'vedia'),
  ('Pulpa Maracuya 1kg',                  null,        'Bebidas para venta', 'unid.', null,                      7000.00, 0, 0, true, 'vedia'),
  ('Session IPA Deposito',                null,        'Bebidas para venta', 'L',     null,                      3700.00, 0, 0, true, 'vedia'),
  ('Soda sifon',                          null,        'Bebidas para venta', 'unid.', null,                      1185.53, 0, 0, true, 'vedia'),
  ('Vermu',                               null,        'Bebidas para venta', 'unid.', null,                      2000.00, 0, 0, true, 'vedia'),
  ('Vermu Feriado Rojo',                  null,        'Bebidas para venta', 'unid.', null,                      8800.00, 0, 0, true, 'vedia'),
  ('Vermu Feriado Rosado',                null,        'Bebidas para venta', 'unid.', null,                      8800.00, 0, 0, true, 'vedia'),
  ('La Iride Chardonnay (DEPOSITO)',      null,        'Bebidas para venta', 'unid.', 'Cleto Almacen de vinos',  7000.00, 0, 0, true, 'vedia')
on conflict (nombre, local) do nothing;

-- ─── VEDIA — Carnes, embutidos y pescados ─────────────────────────────────
insert into productos (nombre, marca, categoria, unidad, proveedor, costo_unitario, stock_actual, stock_minimo, activo, local) values
  ('Bondiola',           null, 'Carnes, embutidos y pescados', 'kg', 'FrigoPorc',    9397.50,  0, 0, true, 'vedia'),
  ('Carne Molida',       null, 'Carnes, embutidos y pescados', 'kg', 'La Esperanza', 13846.15, 0, 0, true, 'vedia'),
  ('Carre de cerdo',     null, 'Carnes, embutidos y pescados', 'kg', 'FrigoPorc',    6100.00,  0, 0, true, 'vedia'),
  ('Chorizo',            null, 'Carnes, embutidos y pescados', 'kg', 'La Esperanza', 7088.36,  0, 0, true, 'vedia'),
  ('Cuadril',            null, 'Carnes, embutidos y pescados', 'kg', 'La Esperanza', 16900.00, 0, 0, true, 'vedia'),
  ('Jamon cocido',       null, 'Carnes, embutidos y pescados', 'kg', 'FrigoPorc',    8743.93,  0, 0, true, 'vedia'),
  ('Lomo',               null, 'Carnes, embutidos y pescados', 'kg', 'La Esperanza', 21000.00, 0, 0, true, 'vedia'),
  ('Osobuco',            null, 'Carnes, embutidos y pescados', 'kg', 'La Esperanza', 7000.00,  0, 0, true, 'vedia'),
  ('Panceta',            null, 'Carnes, embutidos y pescados', 'kg', 'FrigoPorc',    19000.00, 0, 0, true, 'vedia'),
  ('Pata muslo',         null, 'Carnes, embutidos y pescados', 'kg', 'La Esperanza', 4296.00,  0, 0, true, 'vedia'),
  ('Roast Beef',         null, 'Carnes, embutidos y pescados', 'kg', 'La Esperanza', 14860.04, 0, 0, true, 'vedia'),
  ('Suprema de Pollo',   null, 'Carnes, embutidos y pescados', 'kg', 'Santa Ana',    6244.34,  0, 0, true, 'vedia'),
  ('Surubi',             null, 'Carnes, embutidos y pescados', 'kg', null,           13999.99, 0, 0, true, 'vedia'),
  ('Vacio',              null, 'Carnes, embutidos y pescados', 'kg', 'La Esperanza', 22000.00, 0, 0, true, 'vedia'),
  ('Colita de cuadril',  null, 'Carnes, embutidos y pescados', 'Kg', 'La Esperanza', 17460.00, 0, 0, true, 'vedia'),
  ('Vacio de cerdo',     null, 'Carnes, embutidos y pescados', 'Kg', 'FrigoPorc',    8502.50,  0, 0, true, 'vedia'),
  ('Guanciale',          null, 'Carnes, embutidos y pescados', 'Kg', null,           9000.00,  0, 0, true, 'vedia')
on conflict (nombre, local) do nothing;

notify pgrst, 'reload schema';
