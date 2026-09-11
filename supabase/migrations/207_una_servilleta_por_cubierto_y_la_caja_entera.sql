-- 207 — Una servilleta por cubierto, y la caja de cartón entera
--
-- ══════════════════════════════════════════════════════════════════════════════
-- QUÉ CIERRA
-- ══════════════════════════════════════════════════════════════════════════════
--
-- La migración 203 emparejó el empaque de los dos locales pero dejó DOS números
-- parados sobre suposiciones que nadie había medido. Lucas los decidió el
-- 11-sep-2026 y esta migración los baja al dato. Con esto el margen de las
-- variantes con empaque deja de estar en duda.
--
-- 1) LA SERVILLETA DEL SALÓN: 1 por cubierto, no 10.
--
--    La 203 puso 10 porque era lo que el costo viejo estaba cobrando ($75,03) y
--    no quiso mover la plata del salón sin que alguien mirara. Ahora sí:
--    **en la mesa se usan más de una, pero ese consumo no se le puede atribuir
--    al plato.** La receta cobra la que se sirve con el cubierto: una.
--
--      Servicio Salón (Vedia)   $423,95 → $356,45   (−$67,50)
--
--    Lo usan 20 recetas de Vedia, que bajan $81,67 cada una — son $67,50 más el
--    10% de margen de seguridad que el motor aplica encima. Ninguna cambia de
--    color: las que estaban en amarillo mejoran dentro del amarillo.
--
-- 2) LA CAJA DE CARTÓN: 1 por vianda, y el precio es el de la caja suelta.
--
--    💣 Portón verificado antes de tocar nada, porque si el precio hubiera sido
--    el del bulto el arreglo era al revés. Las dos últimas compras de Saavedra
--    dicen "100 unidades × $169,17 = $16.917": el precio guardado es el de UNA
--    caja. Lo confirma la caja gemela de Vedia (18x18) a $161,12 la unidad: si
--    $169,17 fuera el bulto de 100, la misma caja costaría 100 veces menos en un
--    local que en el otro.
--
--    El packaging de Saavedra ya quedó en 1 con la 203. Lo que faltaba son las
--    dos recetas de medialunas, que ponen 0,01 de caja = 100 medialunas por caja:
--
--      Medialuna Rellenas Pastelera (Saavedra)   $784,05 → $968,28
--      Medialunas Rellenas jyq      (Saavedra) $1.898,80 → $2.083,02
--
--    Y arrastran a "Medialuna Rellena", que las lleva adentro:
--
--      Medialuna Rellena            (Saavedra) $2.088,67 → $2.291,32
--
--    ⚠️ Ésa es la única que se acerca al piso: con precio $5.500 pasa de 52,6% a
--    48,0% de margen. El piso de `panificado` es 45%, así que queda en AMARILLO,
--    no en rojo. Ninguna receta cruza su piso por esta migración.
--
-- Medido con el motor de costeo real (`costeoEngine`), no a ojo.
--
begin;

do $fix$
declare
  v_filas   int;
  v_serv_ve constant uuid := '9b8e527a-2c90-4118-af03-1ca89f701b11'; -- Servilleta (24x24cm, c/u)  vedia
  v_caja_sa constant uuid := 'c5306d17-afbd-450c-b4ba-0b64e940e6cb'; -- Caja Carton 18*18 x100ud   saavedra
  v_salon   uuid;
begin
  -- ── 1) Una servilleta por cubierto ─────────────────────────────────────────
  select id into v_salon from public.cocina_recetas
   where local = 'vedia' and nombre = 'Servicio Salón';
  if v_salon is null then
    raise exception 'No encontré la subreceta "Servicio Salón" de Vedia.';
  end if;

  update public.cocina_receta_ingredientes
     set cantidad = 1
   where receta_id = v_salon
     and producto_id = v_serv_ve
     and cantidad = 10;
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'Esperaba 1 renglón de servilleta en Servicio Salón y toqué %. Alguien ya lo cambió.', v_filas;
  end if;

  -- ── 2) Una caja por vianda, también en las medialunas ──────────────────────
  -- No se nombran las recetas: se corrige TODO renglón que ponga 0,01 de esta
  -- caja. Hoy son exactamente dos, y el conteo lo verifica.
  update public.cocina_receta_ingredientes
     set cantidad = 1
   where producto_id = v_caja_sa
     and cantidad = 0.01;
  get diagnostics v_filas = row_count;
  if v_filas <> 2 then
    raise exception 'Esperaba 2 renglones de caja de cartón en 0,01 y toqué %.', v_filas;
  end if;

  raise notice 'Empaque cerrado: 1 servilleta por cubierto y 2 cajas de cartón enteras.';
end
$fix$;

-- ── Guardarraíl: los costos tienen que dar EXACTAMENTE esto ──────────────────
do $guard$
declare
  r          record;
  v_esperado numeric;
begin
  for r in
    select rec.local, rec.nombre,
           round(sum(i.cantidad * coalesce(p.costo_unitario, 0)), 2) as costo
      from public.cocina_recetas rec
      join public.cocina_receta_ingredientes i on i.receta_id = rec.id
      left join public.productos p on p.id = i.producto_id
     where (rec.local = 'vedia'    and rec.nombre = 'Servicio Salón')
        or (rec.local = 'saavedra' and rec.nombre ~* '^packaging')
        or (rec.local = 'vedia'    and rec.nombre ~* '^packaging')
     group by rec.local, rec.nombre
  loop
    v_esperado := case
      when r.nombre = 'Servicio Salón'                         then 356.45
      when r.nombre ilike '%vianda%' and r.local = 'vedia'     then 479.15
      when r.nombre ilike '%vianda%' and r.local = 'saavedra'  then 487.20
      else 141.19  -- los dos congelados
    end;
    if r.costo <> v_esperado then
      raise exception 'GUARDARRAIL: % de % dio % y esperaba %.', r.nombre, r.local, r.costo, v_esperado;
    end if;
    raise notice 'OK  %  %  = $%', r.local, r.nombre, r.costo;
  end loop;

  -- Y no queda ni un renglón de caja de cartón en la décima o la centésima parte.
  select count(*) into v_esperado
    from public.cocina_receta_ingredientes
   where producto_id in ('c5306d17-afbd-450c-b4ba-0b64e940e6cb',
                         'bace4226-6fdc-47c0-808f-70ecb2624ca1')
     and cantidad < 1;
  if v_esperado <> 0 then
    raise exception 'GUARDARRAIL: quedan % renglones de caja de cartón abajo de 1.', v_esperado;
  end if;
  raise notice 'OK  ninguna caja de carton fraccionada';
end
$guard$;

commit;
