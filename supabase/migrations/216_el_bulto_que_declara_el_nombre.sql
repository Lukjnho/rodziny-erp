-- 216 · El bulto de los que lo dicen en el nombre.
--
-- La 215 dejó 9 insumos afuera a propósito: su nombre ya declara un bulto
-- ("x50ud.", "x 100ud.", "x1000") y escribirles `bulto_cantidad = 1` al lado
-- habría contradicho el nombre. El nombre es el dato más confiable que hay.
--
-- Al mirarlos uno por uno con la factura al lado, los 9 se parten en tres:
--
-- ══════════════════════════════════════════════════════════════════════════════
-- ✅ GRUPO A — el nombre declara un paquete y el costo guardado es POR UNIDAD
-- ══════════════════════════════════════════════════════════════════════════════
-- La factura cobra por unidad y la cantidad comprada es un múltiplo exacto del
-- paquete. Se escribe el bulto y todo queda coherente.
--
--   Bolsa Papel Kraft 31*20*9 x50ud.   $101,07/bolsa   factura: 50 unid. × $101,071
--   Bolsa zipper 15*20 x 100ud.        $58,69/bolsa    factura: 100 unid. × $58,6856
--   Sorbete Negro XL x 1000ud.         $10,54/sorbete  factura: 1000 y 2000 unid. × $10,5354
--
-- ══════════════════════════════════════════════════════════════════════════════
-- ✅ GRUPO B — el nombre NO declara un paquete: declara un FORMATO
-- ══════════════════════════════════════════════════════════════════════════════
--   Champignones lata x460gr.   la unidad del insumo es el KG y la factura cobra
--                               por kg (22,2 kg × $8.451,59). "460 gr" es el
--                               tamaño de la lata, no cuántas latas vienen.
--   Rollo de film x1000         "1000" son METROS. La factura dice 1 unid.
--                               × $47.336: se compra de a un rollo.
--   → bulto = 1, igual que los 114 de la 215.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- ⛔ GRUPO C — NO SE TOCA: el costo guardado es el precio del PAQUETE
-- ══════════════════════════════════════════════════════════════════════════════
-- En estos cuatro la factura cobra por paquete y el costo guardado es ese mismo
-- número. Escribir el bulto al lado diría "una unidad cuesta lo que el paquete
-- entero, y vienen N por paquete": una mentira nueva.
--
--   insumo                            costo hoy    la factura        por unidad sería
--   Bolsa Emblocadas 20*30 x1000u     $10.141,00   10 unid. × $10.141    $10,14
--   Guantes de nitrilo x100u           $9.910,00   10 unid. × $9.910     $99,10
--   Bolsas 80*110 x10u                 $3.300,00   40 unid. × $3.300    $330,00
--   Mangas descartables 30*50 x10ud    $2.251,62    1 unid. × $2.251,62 $225,16
--
-- 🔑 Ninguno de los cuatro lo usa ninguna receta activa: hoy no cuesta un peso.
-- Pero el día que alguien ponga "Guantes" en una receta, entra a ×100.
-- Decide Lucas.

begin;

do $$
declare n int;
begin
  -- Guardarraíl: los 5 existen, están activos y no tienen bulto cargado.
  select count(*) into n from productos
   where activo and bulto_cantidad is null
     and id in ('e6105e8e-3fa9-4395-8d37-00c333bef135',
                '48c70197-ac60-47dc-ba27-37b849ed34e4',
                'c080e9f9-e4a5-4d84-bcba-e14d8a5ca2ae',
                '82d869c7-b2bd-4efe-b36b-2f3d91e04182',
                '50c444c7-d94a-441a-986d-ca18d9f170a0');
  if n <> 5 then raise exception 'Esperaba 5 insumos activos sin bulto, encontré %', n; end if;

  -- Grupo A
  update productos set bulto_cantidad = 50, bulto_nombre = 'paquete x50'
   where id = 'e6105e8e-3fa9-4395-8d37-00c333bef135';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'Kraft 31*20*9: % filas', n; end if;

  update productos set bulto_cantidad = 100, bulto_nombre = 'paquete x100'
   where id = '48c70197-ac60-47dc-ba27-37b849ed34e4';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'Bolsa zipper: % filas', n; end if;

  update productos set bulto_cantidad = 1000, bulto_nombre = 'paquete x1000'
   where id = 'c080e9f9-e4a5-4d84-bcba-e14d8a5ca2ae';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'Sorbete Negro XL: % filas', n; end if;

  -- Grupo B: no hay bulto, se compra en la misma unidad en que se usa.
  update productos set bulto_cantidad = 1
   where id in ('82d869c7-b2bd-4efe-b36b-2f3d91e04182',
                '50c444c7-d94a-441a-986d-ca18d9f170a0');
  get diagnostics n = row_count;
  if n <> 2 then raise exception 'Champignones + film: % filas, esperaba 2', n; end if;

  -- Los 4 del grupo C siguen intactos.
  select count(*) into n from productos
   where bulto_cantidad is null
     and id in ('48bc850d-73e3-4528-902e-90755786b7af',
                '7fd31e8c-1dde-4ea7-b4b4-0b6b66317b02',
                '46d057b0-271a-45e3-8620-9c70d4dcc5ba',
                '8de0742f-1d29-4d17-ab8e-640cb262f569');
  if n <> 4 then raise exception 'El grupo C se tocó y no tenía que tocarse'; end if;

  -- Reparto final: 114 (mig 215) + 3 (servilletas y Cofia) + 5 = 122.
  select count(*) into n from productos where activo and bulto_cantidad is not null;
  if n <> 122 then raise exception 'Quedaron % con bulto, esperaba 122', n; end if;
end $$;

commit;
