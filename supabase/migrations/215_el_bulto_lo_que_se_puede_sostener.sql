-- 215 · PASO B del bulto: se escribe SOLO lo que se puede sostener.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- QUÉ SE DEDUCE Y QUÉ NO
-- ══════════════════════════════════════════════════════════════════════════════
--
-- La pregunta era: ¿el insumo se compra de a uno, o viene en un bulto de N?
-- La fuente son los renglones de factura (`gastos.items_json`), y la cuenta es
-- la razón entre el precio unitario de la factura y el costo guardado.
--
-- 💣 **Esa razón NO sirve para deducir el tamaño del bulto.** Confunde tres
-- cosas distintas: cuántos vienen en el paquete, cuánto subió el precio, y los
-- errores de carga del propio renglón.
--
-- La prueba está en los dos únicos insumos donde el bulto ya estaba cargado a
-- mano y se sabe correcto — las dos servilletas 24×24, paquete de 1000:
--
--     Servilleta (24x24cm, c/u) · Vedia      razones de 874 a 1.431 (mediana 1.210)
--     Servilletas 24*24 · Saavedra           razones de 1.000 a 1.431 (mediana 1.426)
--
-- El paquete es de 1.000 en los dos casos. El método habría escrito 1.210 y
-- 1.426, pisando un dato correcto con uno inventado. Pasó porque un proveedor
-- (DG Clean) cobra 43 % más caro el mismo paquete: la razón lee esa diferencia
-- de precio como si fuera un paquete más grande.
--
-- ✅ **Lo que la razón SÍ resuelve es la otra mitad: si hay bulto o no.** Los
-- dos casos de control caen del lado correcto ("hay bulto"), y hay 114 insumos
-- donde TODAS sus facturas cobran aproximadamente lo mismo que el costo
-- guardado — o sea, se compran en la misma unidad en que se usan.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- LA REGLA QUE SE APLICA
-- ══════════════════════════════════════════════════════════════════════════════
--
--   `bulto_cantidad = 1`  ⇔  3 o más renglones de factura, y en TODOS la razón
--                            entre precio unitario y costo cae entre 0,5 y 1,5.
--   `NULL`                ⇔  no sabemos. Y eso también es información.
--
-- Quedan afuera a propósito:
--   · los 9 cuyo NOMBRE ya declara un bulto ("x50ud.", "x 100ud.", "x1000")
--     — escribirles un 1 al lado contradiría el nombre, lo decide Lucas;
--   · los 2 que sí tienen bulto (las servilletas): ya están cargados y el
--     método no sabe el tamaño;
--   · los que no calzan con nada: son errores de carga, van aparte.
--
-- Reparto final sobre 394 insumos activos:
--     114  bulto = 1   (se compra por unidad, confirmado)
--       3  bulto ya cargado a mano (2 servilletas + la Cofia de la mig 214)
--     277  NULL, abierto en por qué:
--            114  tiene 1 o 2 facturas, no alcanzan para afirmar nada
--             89  no tiene ninguna factura enganchada
--             43  tiene 3 o más pero no coinciden entre sí
--             22  no tiene costo cargado
--              9  el nombre ya declara el bulto ("x50ud.") — lo decide Lucas
--
-- Solo datos. Hoy no lee estas columnas ninguna pantalla.

begin;

create temporary table _por_unidad (id uuid primary key) on commit drop;

insert into _por_unidad (id) values
  ('f79a52e1-2f8c-4289-9b58-b9f2283fbbb2'),  -- Abducido Cabernet Franc · vedia (7 facturas)
  ('876d1045-d0ff-4e22-9d70-df3d85940942'),  -- Abducido Malbec · vedia (7 facturas)
  ('7d95e11c-d43d-4ab4-839f-3454d87011d6'),  -- Aceite de Girasol · saavedra (5 facturas)
  ('51e011ee-fe63-4f4b-bcdb-742a027d236e'),  -- Aceite de Girasol · vedia (8 facturas)
  ('42f2b89d-d88b-442b-8df4-0c1ab7b29674'),  -- Aceite de Oliva · vedia (5 facturas)
  ('79d82627-be83-4f4d-92fe-03d5e6393d61'),  -- Aceitunas · saavedra (3 facturas)
  ('beb570ef-6de3-4f2a-887e-4eea16d47240'),  -- Aerosol p/difusor x ud. · vedia (3 facturas)
  ('70bd6d7d-4734-4c37-83ca-617b740f81cc'),  -- Agua con Gas 500cc (DEPOSITO) · vedia (11 facturas)
  ('5ede015a-bb4e-4e34-9558-e2882a809b1b'),  -- Almidon de maiz · saavedra (12 facturas)
  ('001603ca-d211-4b2f-badf-9596d0695bac'),  -- Aperol Botella 750cc (DEPOSITO) · vedia (3 facturas)
  ('5aab24ca-7944-41c4-acb8-a6d24f136e25'),  -- Apio · saavedra (10 facturas)
  ('b15b983e-6962-49d9-868c-eea37e2ce28b'),  -- Azucar · vedia (6 facturas)
  ('5aeae3c9-b2e2-496c-8725-ee1956574d32'),  -- Azucar SIN TACC · saavedra (13 facturas)
  ('b4e8fa0f-844c-456d-89a4-4a49276654e1'),  -- Bandeja Aluminio F275 · saavedra (11 facturas)
  ('6e1bfc0c-07c1-4dba-9e24-4720acf26b71'),  -- Bandeja Aluminio F275 · vedia (15 facturas)
  ('66c25b8b-beda-4df4-99c7-54caaf77522c'),  -- Bidon Alcohol 70% x4.5L · vedia (5 facturas)
  ('5311b745-0626-48eb-9289-8da251cefc00'),  -- Bondiola · saavedra (5 facturas)
  ('91b97e75-3121-4170-a12c-b1088dd319a9'),  -- Bondiola · vedia (7 facturas)
  ('c170e9fe-5e3c-4adc-a285-720708215e76'),  -- Botella de Miel · vedia (3 facturas)
  ('2ce8da76-f39c-46f6-be4c-ceb7aee4c4b8'),  -- Cafe en grano · saavedra (3 facturas)
  ('a2a07b61-23d4-4515-9143-85341291aaa1'),  -- Carne molida · saavedra (14 facturas)
  ('fb89fcaf-51a1-48f7-9405-d750f5b49db5'),  -- Carne Molida · vedia (24 facturas)
  ('b37ce604-a062-41bc-83e4-70c2f3cae0f9'),  -- Cebolla · vedia (32 facturas)
  ('eab18562-80ab-47f7-bd8c-cbae360ded89'),  -- Cebollita de Verdeo · saavedra (8 facturas)
  ('94f9dd27-77e4-4ebf-a8f7-1deca3de5d91'),  -- Cebollita de Verdeo · vedia (36 facturas)
  ('b9ab2e28-95a4-4fab-94da-4a20f99c5176'),  -- Chocolate baño Bombonitos S.Amargo · saavedra (3 facturas)
  ('08211f62-8166-443d-a9fb-687e749314e8'),  -- Chorizo · saavedra (14 facturas)
  ('a2cf751b-a725-4b04-ab1c-d806f200df2f'),  -- Chorizo · vedia (23 facturas)
  ('cf29382d-2fc5-42a6-b208-f7a83c5cfb15'),  -- Cinta Blanca x ud. · vedia (3 facturas)
  ('1871121f-8b91-4dbf-b53f-a1aa7eb1f8ca'),  -- Cinta papel · saavedra (3 facturas)
  ('4b14ad52-377d-4538-ab21-e72ab831bb8f'),  -- Crema de leche · saavedra (18 facturas)
  ('46fbce4b-baa2-4d4d-a8e8-18f20b8d469c'),  -- Crema de Leche · vedia (23 facturas)
  ('6d7bfb0c-58fc-4725-a6d6-1dd58353baa7'),  -- Cuadril · saavedra (21 facturas)
  ('4251f877-1785-4409-b1f7-31ecf0fe2446'),  -- Cynar Botella 750cc (DEPOSITO) · vedia (3 facturas)
  ('ab5e2ecd-c26c-4fd0-adb1-e7abcc1ed507'),  -- Desodorante de piso x5L · vedia (3 facturas)
  ('bf3bf924-a6ab-456c-8b98-af47c6006925'),  -- Desodorante piso x5L · saavedra (3 facturas)
  ('a062432d-ff80-4639-8791-97bd440eed1e'),  -- Detergente x 5L · saavedra (4 facturas)
  ('325ab146-a3e9-4559-b1b5-a4bee4411edb'),  -- Dorada Deposito · vedia (3 facturas)
  ('a5e3a883-c3fb-4326-9044-7eef383f9f90'),  -- Dulce de leche · saavedra (7 facturas)
  ('582b621f-1585-45a2-acbc-b6bfb1f1abb0'),  -- Dulce de leche · vedia (5 facturas)
  ('c7949c6f-9805-4ce4-a766-bfb5f700c5e0'),  -- Dulce de membrillo · saavedra (3 facturas)
  ('bc2fbf66-6d0c-4c49-8b98-ecf5463c2d12'),  -- Edulcorante en sobre · saavedra (3 facturas)
  ('6007e049-b176-4666-9956-08c032817183'),  -- Esponja · vedia (3 facturas)
  ('1ed3d21e-4ea1-4ef4-879d-91bba2b3f96c'),  -- Esponja reforzada · saavedra (3 facturas)
  ('179ba9a4-9f8a-4ca4-ab0d-4069ac436042'),  -- Frambuesa congelada · saavedra (3 facturas)
  ('754d20c5-5952-45c9-aa2d-76b976b5c70e'),  -- Galletitas Vainilla x6ud. · vedia (9 facturas)
  ('34d50544-44dd-415e-bc3b-8a95e7cc5b86'),  -- Guanciale · vedia (5 facturas)
  ('7dc4be37-52d3-4914-8b10-dad82977fee6'),  -- Guantes de Nitrilo · saavedra (4 facturas)
  ('4c736047-1015-456d-be10-525ad837464e'),  -- Harina 0000 · vedia (8 facturas)
  ('8e652671-5c8c-45e0-8f62-5e6c3a55ab88'),  -- Harina de arroz · saavedra (13 facturas)
  ('0f08fa11-736d-485b-adc3-8585c2667e08'),  -- Hongo de pino · vedia (4 facturas)
  ('d2936fde-4e08-43b7-bd32-464c25bf7157'),  -- Huelga de Amores Chardonnay Dulce(DEPOSITO) · vedia (7 facturas)
  ('11c46be9-5143-4b83-8b20-0753da5ddbab'),  -- Huelga de amores Malbec Reserva · saavedra (3 facturas)
  ('f0fcbcd6-d260-4366-bd98-d623318a204b'),  -- Huelga de Amores Malbec Reserva (DEPOSITO) · vedia (7 facturas)
  ('5fff2ff8-52e5-4850-984f-45d5abbd1d75'),  -- Huevos (~60g/unid) · saavedra (18 facturas)
  ('8acde7c0-6425-4da0-b162-d57730b5ef3f'),  -- Jamon cocido · vedia (21 facturas)
  ('96504bd2-8de2-436e-bc39-9dfe9b7413b4'),  -- Jamon cocido Sin TACC · saavedra (12 facturas)
  ('5effa030-af9a-4e95-9ae6-293a01247b98'),  -- Jengibre · saavedra (9 facturas)
  ('ac48c95a-95de-4077-82c6-c9110062e3f3'),  -- Jengibre · vedia (10 facturas)
  ('14cbc5bd-c608-4f9d-bcd6-18b292ff62dc'),  -- La Iride Malbec Rose Dulce (DEPOSITO) · vedia (6 facturas)
  ('33c142ac-0f1d-4719-8225-f3eb23c66716'),  -- Lavandina Suelta x 5L · vedia (3 facturas)
  ('eafdedf7-ff23-440d-9e59-db43628bbb01'),  -- Leche 0% Lactosa · saavedra (10 facturas)
  ('1963dfe7-f4af-441d-830c-088fd78d1106'),  -- Leche de almendras · saavedra (5 facturas)
  ('8d9a5ab2-31fe-46b8-ad80-10f124c13eb8'),  -- Leche entera en Polvo · saavedra (4 facturas)
  ('c4db91e1-2f93-4f98-98a0-e7f3f27dd3b7'),  -- Leche Larga Vida · saavedra (18 facturas)
  ('c3baaab3-b793-4383-a86e-775eddd54373'),  -- Leche Sachet x 1 L · saavedra (17 facturas)
  ('93371134-e3e2-4fac-9966-c90e20eb9cf2'),  -- Leche Sachet x 1 L · vedia (20 facturas)
  ('6f6251f9-d61c-4f58-ab78-8ac511ecbc55'),  -- Levadura Fresca · saavedra (5 facturas)
  ('947ee607-022b-4e92-8b9a-1afee3b8442c'),  -- Limon en fruta · vedia (29 facturas)
  ('1d611a92-209d-4f93-94ff-a0412c8c6dcf'),  -- Manteca · vedia (10 facturas)
  ('82b92bc0-b3e9-4831-bdef-23f6fe6c81f7'),  -- Manteca sin sal · saavedra (4 facturas)
  ('006f7044-2217-42ec-93a7-53a150751770'),  -- Menta fresca · vedia (25 facturas)
  ('daf4b13d-f433-4485-b5a0-71e1b4fbfab3'),  -- Menta Fresca · saavedra (21 facturas)
  ('db69b875-8ac3-4419-abd9-adb3c47b2f62'),  -- Mix Semillas · saavedra (3 facturas)
  ('8c1bb47d-fef9-4701-958e-bd8c2b88d200'),  -- Naranjas · saavedra (27 facturas)
  ('9823e308-f222-4a64-b471-bb3c08fcbbba'),  -- Naranjas · vedia (29 facturas)
  ('090e367e-affa-4999-ae36-410e9796f159'),  -- Nuez Mariposa · saavedra (3 facturas)
  ('5184974d-0bdf-48bf-9f53-b77f4640acae'),  -- Panceta Ahumada · saavedra (11 facturas)
  ('587b0cd7-1f56-4075-851b-24c56aea4a0c'),  -- Panceta envasada · vedia (9 facturas)
  ('18b79a45-c616-4a8d-93aa-4428f45d0951'),  -- Papel higienico x8u. · vedia (6 facturas)
  ('ec78dd43-7540-440c-8fb2-e22b4c28d5ef'),  -- Paso de los Toros Tonica 1500cc (DEPOSITO) · vedia (6 facturas)
  ('70387378-f5cd-4109-a4e8-bea981d86365'),  -- Perejil · vedia (8 facturas)
  ('d858e654-fe92-458b-9418-fdebcc88b0bb'),  -- Pimenton Dulce · vedia (5 facturas)
  ('9eaab9e8-55c5-44d6-8bf7-314529c0b6d0'),  -- Pote bisagra 250gr · vedia (3 facturas)
  ('d7906ffe-3139-4c06-a906-1a2937fd1d32'),  -- Premezcla DIMAX · saavedra (7 facturas)
  ('9fb422cd-5e13-4b63-890e-69711ad61b52'),  -- Queso crema · vedia (14 facturas)
  ('cbac3726-470f-469d-a9a9-7dd3ba560f31'),  -- Queso Danbo · saavedra (13 facturas)
  ('fbd04c59-3cb7-4dce-8dce-3f90718f19ad'),  -- Queso Danbo · vedia (16 facturas)
  ('4a294eae-1a27-429a-8514-b222d62259a8'),  -- Queso Mascarpone · saavedra (4 facturas)
  ('86240e13-e30d-49c0-b4c1-eb8c2446f9ac'),  -- Queso Muzzarella · vedia (20 facturas)
  ('0e59f0e7-c448-4358-a5a5-5890327675fe'),  -- Queso Reggianito · vedia (3 facturas)
  ('e9f06136-e3d7-42f0-8ba3-b93c2602ef04'),  -- Queso Sardo · vedia (17 facturas)
  ('feae7885-aac4-49c0-a29b-cf808e7ed2ca'),  -- Queso Sardo Silvia · saavedra (14 facturas)
  ('d9074576-fece-40d8-981e-355024111c8d'),  -- Queso Sardo Silvia · vedia (16 facturas)
  ('f2e671ae-eeb6-46dd-8cab-32507b3e6f67'),  -- Rejilla Doble (bacha) · vedia (3 facturas)
  ('466a4e73-fbde-4d32-b9c5-5ef8a131985b'),  -- Rocio vegetal Natura · saavedra (6 facturas)
  ('f846f201-f504-4a1f-b675-d614c4b91fdf'),  -- Rollo de papel aluminio 38cm x1kg · vedia (4 facturas)
  ('48eea727-11a0-414a-98d4-7ac4993f90c6'),  -- Rollo papel aluminio x 1kg · saavedra (4 facturas)
  ('d1e517b7-e41d-415a-b8bf-20d78423052e'),  -- Rucula · saavedra (24 facturas)
  ('68630ead-8d57-4c75-b0b1-21c5afe473c0'),  -- Sal fina SIN TACC · saavedra (8 facturas)
  ('8911e5d3-8089-4823-a5f8-474abcb8d4f3'),  -- Salsa Barbacoa · vedia (5 facturas)
  ('523c61e5-9477-45fd-b13e-a010ab422998'),  -- Semolin · vedia (19 facturas)
  ('bb467244-8d6d-4f43-901d-f73fc18a9090'),  -- Soda Sifon 2L · vedia (5 facturas)
  ('8a22a616-433c-464b-ad31-309665ce9b66'),  -- Suprema de pollo · saavedra (8 facturas)
  ('5400e041-a945-4e37-9019-e4a968bd673b'),  -- Suprema de Pollo · vedia (13 facturas)
  ('0518695d-31c5-4a67-b85a-929448c44aec'),  -- Tapa Aluminio F275 · vedia (14 facturas)
  ('fe7f9ffc-96ab-4fcc-b84e-29537b93436d'),  -- Toallas para manos x paq · vedia (4 facturas)
  ('027105b8-c0bc-480d-8602-4d3a66e880ec'),  -- Tomates perita · saavedra (26 facturas)
  ('148d73aa-da22-43de-850b-91c8d06ae3b0'),  -- Trapo de Piso · vedia (3 facturas)
  ('a188837e-5b32-41bc-9be1-bc4909c7a207'),  -- Vacio de cerdo · saavedra (8 facturas)
  ('50348e5a-c1e0-492c-972a-63e8e84e0ad4'),  -- Vacio de cerdo · vedia (18 facturas)
  ('b3b051da-aa3a-49d6-9bb0-515f31a675d5'),  -- Vino Blanco x ud.(COCINA) · saavedra (3 facturas)
  ('0e2f9d2c-c57f-4373-9469-f53935ba9edf'),  -- Vino Blanco x ud.(COCINA) · vedia (4 facturas)
  ('7e5ea8bc-9566-4d7c-869b-b3dd547e5842')   -- Zanahoria · vedia (16 facturas)
;

do $$
declare n int;
begin
  -- Guardarraíl 1: los 114 existen, están activos y NO tienen bulto cargado.
  select count(*) into n
    from _por_unidad u join productos p on p.id = u.id
   where p.activo and p.bulto_cantidad is null;
  if n <> 114 then
    raise exception 'Esperaba 114 insumos activos y sin bulto, encontré %', n;
  end if;

  -- Guardarraíl 2: hoy hay exactamente 3 con bulto cargado.
  select count(*) into n from productos where activo and bulto_cantidad is not null;
  if n <> 3 then
    raise exception 'Esperaba 3 insumos con bulto ya cargado, encontré %', n;
  end if;

  update productos p
     set bulto_cantidad = 1
    from _por_unidad u
   where p.id = u.id;
  get diagnostics n = row_count;
  if n <> 114 then raise exception 'Se tocaron % filas, esperaba 114', n; end if;

  -- Guardarraíl 3: quedan 117 con bulto y ninguno perdió el suyo.
  select count(*) into n from productos where activo and bulto_cantidad is not null;
  if n <> 117 then raise exception 'Quedaron % con bulto, esperaba 117', n; end if;

  select count(*) into n from productos
   where id in ('9b8e527a-2c90-4118-af03-1ca89f701b11','cf4c093d-5977-4e6e-a4fd-68bd080de4d4')
     and bulto_cantidad = 1000;
  if n <> 2 then raise exception 'Las servilletas perdieron su paquete de 1000'; end if;
end $$;

commit;
