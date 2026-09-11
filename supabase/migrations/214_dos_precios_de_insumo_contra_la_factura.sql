-- 214 · Tres costos de insumo corregidos contra la factura que los respalda.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- QUÉ SE CORRIGE Y POR QUÉ
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Los tres tienen el mismo origen: alguien cargó en `costo_unitario` un número
-- que la factura no dice como precio POR UNIDAD.
--
--   Morron Rojo (Saavedra)   $6.000/kg   la factura del 18-ago dice 2 kg × $3.000
--                                        → se cargó el SUBTOTAL como unitario.
--                                        $3.000 es además el precio más repetido
--                                        (7 de 15 facturas con precio).
--
--   Bolsa Kraft Nº3 (Saav.)  $25,97/u    la única factura (13-jul) dice
--                                        200 unid. × $17,8896. 1,45× arriba.
--
--   Cofia x 100ud. (Saav.)   $7.802,83   es la CAJA de 100. La gemela de Vedia
--                                        ("Cofia x ud.") vale $78,03 y la factura
--                                        del 28-abr dice 100 × $78,0283.
--                                        → el costo pasa a ser por cofia y los
--                                        100 quedan donde van: en el bulto.
--
-- ⚠️ LA PALTA **NO** SE TOCA. Estaba en la misma lista y NO corresponde: su
-- factura más reciente (8-sep) dice 3 kg × $8.000, que es exactamente lo que
-- hay cargado. Bajarla a $4.000 subiría el margen de las Tostadas Proteicas de
-- 44,8 % a 46,7 % sin que nada haya mejorado de verdad. Medido, no supuesto.
--
-- Solo datos: ninguna pantalla compara estos valores contra un literal.
-- Efecto medido con el motor real (recetas y productos activos, como producción):
--   Morron Asado          $678,12 → $389,37
--   Pizza De Especial SG  $5.202,10 → $4.924,90   margen 53,6 % → 56,1 %  (sigue amarilla)
--   Chipa                 $1.292,09 → $1.283,20   margen 70,7 % → 70,9 %  (sigue verde)
-- Ninguna receta cambia de color.

begin;

-- ── Morron Rojo · Saavedra ───────────────────────────────────────────────────
do $$
declare n int;
begin
  select count(*) into n from productos
   where id = '6738a827-9495-485c-b9e8-4ae72b3dd9dc' and costo_unitario = 6000.00;
  if n <> 1 then
    raise exception 'Morron Rojo no vale 6000: el dato cambió, revisar antes de tocar';
  end if;

  update productos set costo_unitario = 3000.00
   where id = '6738a827-9495-485c-b9e8-4ae72b3dd9dc';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'Morron Rojo: se tocaron % filas, esperaba 1', n; end if;
end $$;

-- ── Bolsa Papel Kraft Nº3 · Saavedra ─────────────────────────────────────────
do $$
declare n int;
begin
  select count(*) into n from productos
   where id = '49d89886-88a2-4a5b-9f88-c4a43274ca70' and costo_unitario = 25.97;
  if n <> 1 then
    raise exception 'Kraft Nº3 no vale 25,97: el dato cambió, revisar antes de tocar';
  end if;

  update productos set costo_unitario = 17.89
   where id = '49d89886-88a2-4a5b-9f88-c4a43274ca70';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'Kraft Nº3: se tocaron % filas, esperaba 1', n; end if;
end $$;

-- ── Cofia x 100ud. · Saavedra ────────────────────────────────────────────────
-- No la usa ninguna receta, así que no mueve un solo peso de costeo. Se corrige
-- igual para que el detector de precios raros deje de marcarla y para que la
-- caja de 100 quede escrita donde va.
do $$
declare n int;
begin
  select count(*) into n from productos
   where id = '3b29d53d-e73f-4a09-8685-33c6da42a1a3' and costo_unitario = 7802.83;
  if n <> 1 then
    raise exception 'Cofia no vale 7802,83: el dato cambió, revisar antes de tocar';
  end if;

  update productos
     set costo_unitario = 78.03,
         bulto_cantidad = 100,
         bulto_nombre = 'caja x100'
   where id = '3b29d53d-e73f-4a09-8685-33c6da42a1a3';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'Cofia: se tocaron % filas, esperaba 1', n; end if;
end $$;

-- ── Guardarraíl final: la Palta sigue intacta ────────────────────────────────
do $$
declare n int;
begin
  select count(*) into n from productos
   where id = '1b145343-bcd8-4d87-bcce-94246fb4f7ae' and costo_unitario = 8000.00;
  if n <> 1 then
    raise exception 'La Palta se movió y no tenía que moverse';
  end if;
end $$;

commit;
