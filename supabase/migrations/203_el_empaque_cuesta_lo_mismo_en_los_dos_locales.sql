-- 203 — El empaque cuesta lo mismo en los dos locales
--
-- (Se saltean los números 201 y 202: quedaron quemados por dos migraciones que se
--  diseñaron el 10-sep, se refutaron y NUNCA se aplicaron. Reusar el número haría
--  que la nota de memoria que las describe apunte a otra cosa.)
--
-- ══════════════════════════════════════════════════════════════════════════════
-- LO QUE ESTABA PASANDO
-- ══════════════════════════════════════════════════════════════════════════════
--
-- La misma vianda costaba $546,68 de empaque en Vedia y $402,48 en Saavedra, y el
-- mismo congelado $141,19 contra $111,84. No es que se compre distinto: son tres
-- datos mal cargados. Los tres son la MISMA confusión — "unidad" a veces es una
-- pieza y a veces es el paquete entero.
--
-- Medido contra las facturas cargadas (`gastos.items_json`), no deducido:
--
-- 1) LA SERVILLETA vale $7.502,81 la "unid." en los dos locales. Eso es el precio
--    del PAQUETE. Se compran de a 4, 5, 6 y 10 por vez desde mayo, siempre a ese
--    precio: nadie compra 5 servilletas. La receta ponía 0,01 de paquete = $75,03
--    por vianda, o sea diez servilletas.
--
--    💣 Cuántas trae el paquete NO está escrito en ningún lado. Se toma 1.000 por
--    tres razones, y si Lucas dice otra cosa esto se cambia en un renglón:
--      · la hermana "Servilletas 33x32 x 1000 ud" del mismo proveedor SÍ lo dice, y
--        sale $17.340,80 el paquete → $17,34 la servilleta grande. La chica a $7,50
--        queda coherente (casi la mitad de superficie).
--      · Vedia compra ~25 paquetes por mes. A 1.000 son 25.000 servilletas para
--        ~4.000 tickets = 6 por mesa. A 100 serían 0,6 por mesa: imposible.
--      · con 100 la servilleta saldría $75, más cara que la bandeja de aluminio.
--
-- 2) LA CAJA DE CARTÓN. Vedia pone 1 caja, Saavedra 0,1 de caja. La correcta es la
--    de Vedia, y las facturas lo prueban: las dos últimas compras de Saavedra
--    (1-jul y 7-jul) son "100 unidades a $169,17" = $16.917. O sea $169,17 es UNA
--    caja, igual que los $161,12 de Vedia. Poner 0,1 es cobrar la décima parte.
--    (En junio Saavedra compraba "2 a $16.112" — ahí sí el precio era el paquete de
--    100. Cambió la forma de cargar la factura y la receta quedó vieja.)
--
-- 3) LA BOLSA ZIPPER. Acá el que estaba mal era Saavedra, no Vedia — al revés de lo
--    que parecía por ser el precio más nuevo. Todas las facturas desde abril dicen
--    lo mismo: **$5.868,56 por cada 100 bolsas**, o sea $58,69 la bolsa.
--
--        28-abr  saavedra   400 × $58,6856 = $23.474,24
--        27-may  vedia      100 × $58,6856 =  $5.868,56
--        01-jul  saavedra   100 × $58,6856 =  $5.868,56
--        29-jul  vedia      100 × $71,0096 =  $7.100,96   (subió y bajó)
--        06-ago  saavedra   100 × $58,6856 =  $5.868,56
--        20-ago  vedia      100 × $58,6856 =  $5.868,56
--        08-sep  saavedra   200 × $29,3428 =  $5.868,56   ← ésta
--
--    La última cargó 200 bolsas por la MISMA plata. El total no se movió ni un peso:
--    se tipeó mal la cantidad, y el precio por bolsa salió a la mitad solo.
--
--
-- ══════════════════════════════════════════════════════════════════════════════
-- CÓMO QUEDA
-- ══════════════════════════════════════════════════════════════════════════════
--
--                        antes              después
--   Vianda Vedia         $546,68            $479,15
--   Vianda Saavedra      $402,48            $487,20
--   Congelado Vedia      $141,19            $141,19   (no se toca)
--   Congelado Saavedra   $111,84            $141,19
--
-- La diferencia entre locales pasa de $144,20 a $8,05 en la vianda —y esos $8,05
-- son reales: cada local compró la caja en una fecha distinta ($161,12 el 17-jun
-- contra $169,17 el 7-jul)— y de $29,35 a CERO en el congelado.
--
-- ⚠️ EL SALÓN NO SE MUEVE NI UN PESO. La subreceta "Servicio Salón" de Vedia (la
-- usan 47 recetas) también lleva la servilleta a 0,01 de paquete. Si se arregla el
-- precio y se deja la cantidad, el salón se abarataría $75 por cubierto de golpe y
-- en silencio. Acá la cantidad pasa a 10 servilletas, que es exactamente lo que se
-- está cobrando hoy: la plata queda igual ($75,03 → $75,00) y lo que cambia es que
-- ahora dice la verdad. **Si son 10 por cubierto o menos lo tiene que decir Lucas.**
--
-- Lo que NO se toca y queda anotado: las dos recetas de medialunas de Saavedra
-- ponen 0,01 de caja de cartón (= 100 medialunas por caja). Es el mismo síntoma,
-- pero no es empaque de vianda y nadie midió cuántas entran.
--
begin;

do $fix$
declare
  v_filas   int;
  v_serv_ve constant uuid := '9b8e527a-2c90-4118-af03-1ca89f701b11'; -- Servilleta (24x24cm, c/u)  vedia
  v_serv_sa constant uuid := 'cf4c093d-5977-4e6e-a4fd-68bd080de4d4'; -- Servilletas 24*24          saavedra
  v_caja_sa constant uuid := 'c5306d17-afbd-450c-b4ba-0b64e940e6cb'; -- Caja Carton 18*18 x100ud   saavedra
  v_zip_sa  constant uuid := 'ed023ce4-784c-458a-8b4e-c4f3cf61cee9'; -- Bolsa zipper 15*20         saavedra
  v_salon   uuid;
  v_vianda  uuid;
begin
  -- ── 1) La servilleta pasa a costar lo que cuesta UNA servilleta ─────────────
  update public.productos
     set costo_unitario = 7.50,
         bulto_cantidad = 1000,
         bulto_nombre   = 'paquete x1000',
         updated_at     = now()
   where id in (v_serv_ve, v_serv_sa)
     and costo_unitario = 7502.81;
  get diagnostics v_filas = row_count;
  if v_filas <> 2 then
    raise exception 'Esperaba corregir 2 servilletas y toqué %. Alguien ya cambió el precio: revisalo a mano.', v_filas;
  end if;

  -- ── 2) Una servilleta por vianda ───────────────────────────────────────────
  update public.cocina_receta_ingredientes i
     set cantidad = 1
    from public.cocina_recetas r
   where r.id = i.receta_id
     and r.nombre ~* '^packaging'
     and i.producto_id in (v_serv_ve, v_serv_sa)
     and i.cantidad = 0.01;
  get diagnostics v_filas = row_count;
  if v_filas <> 2 then
    raise exception 'Esperaba 2 renglones de servilleta en los packaging y toqué %.', v_filas;
  end if;

  -- ── 3) Servicio Salón: la plata queda igual, la unidad deja de mentir ───────
  select id into v_salon from public.cocina_recetas
   where local = 'vedia' and nombre = 'Servicio Salón';
  if v_salon is null then
    raise exception 'No encontré la subreceta "Servicio Salón" de Vedia.';
  end if;

  update public.cocina_receta_ingredientes
     set cantidad = 10
   where receta_id = v_salon and producto_id = v_serv_ve and cantidad = 0.01;
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'Esperaba 1 renglón de servilleta en Servicio Salón y toqué %.', v_filas;
  end if;

  -- ── 4) La caja de cartón entera, no la décima parte ────────────────────────
  select id into v_vianda from public.cocina_recetas
   where local = 'saavedra' and nombre = 'Packaging De Vianda';
  if v_vianda is null then
    raise exception 'No encontré "Packaging De Vianda" de Saavedra.';
  end if;

  update public.cocina_receta_ingredientes
     set cantidad = 1
   where receta_id = v_vianda and producto_id = v_caja_sa and cantidad = 0.1;
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'Esperaba 1 renglón de caja de cartón en el packaging de Saavedra y toqué %.', v_filas;
  end if;

  -- ── 5) La bolsa zipper vale $58,69, no $29,34 ──────────────────────────────
  update public.productos
     set costo_unitario = 58.69,
         updated_at     = now()
   where id = v_zip_sa
     and costo_unitario = 29.34;
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'Esperaba corregir 1 bolsa zipper y toqué %.', v_filas;
  end if;

  raise notice 'Empaque corregido: 3 precios/cantidades de insumo y 4 renglones de receta.';
end
$fix$;

-- ── Guardarraíl: los cuatro packaging tienen que dar EXACTAMENTE esto ────────
do $guard$
declare
  r         record;
  v_esperado numeric;
begin
  for r in
    select rec.local, rec.nombre,
           round(sum(i.cantidad * coalesce(p.costo_unitario, 0)), 2) as costo
      from public.cocina_recetas rec
      join public.cocina_receta_ingredientes i on i.receta_id = rec.id
      left join public.productos p on p.id = i.producto_id
     where rec.nombre ~* '^packaging'
     group by rec.local, rec.nombre
  loop
    v_esperado := case
      when r.nombre ilike '%vianda%' and r.local = 'vedia'    then 479.15
      when r.nombre ilike '%vianda%' and r.local = 'saavedra' then 487.20
      else 141.19  -- los dos congelados quedan idénticos
    end;
    if r.costo <> v_esperado then
      raise exception 'GUARDARRAIL: % de % dio % y esperaba %.', r.nombre, r.local, r.costo, v_esperado;
    end if;
    raise notice 'OK  %  %  = $%', r.local, r.nombre, r.costo;
  end loop;

  -- Y el salón no se movió: 10 servilletas × $7,50 = $75,00 (antes 0,01 × 7502,81 = $75,03)
  select round(sum(i.cantidad * coalesce(p.costo_unitario, 0)), 2) into v_esperado
    from public.cocina_recetas rec
    join public.cocina_receta_ingredientes i on i.receta_id = rec.id
    left join public.productos p on p.id = i.producto_id
   where rec.local = 'vedia' and rec.nombre = 'Servicio Salón';
  if v_esperado not between 423.90 and 424.00 then
    raise exception 'GUARDARRAIL: Servicio Salón dio % y tenía que quedar en ~423,94.', v_esperado;
  end if;
  raise notice 'OK  servicio salon = $%  (antes 423,97)', v_esperado;
end
$guard$;

commit;
