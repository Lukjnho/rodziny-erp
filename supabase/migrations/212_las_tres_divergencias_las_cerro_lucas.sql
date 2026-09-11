-- 212 · Las tres divergencias entre receta base y variante, cerradas por Lucas
--
-- Al duplicar cada receta en (VIANDA) / (CONGELADO) / (PACK), las CANTIDADES
-- por porción quedaron sueltas y con el tiempo se desincronizaron en 3 de las
-- 22 familias. No es un error de carga: es la duplicación haciendo lo que hace.
-- (El modelo "una receta, N formas de venderla" que lo elimina de raíz está
--  diseñado y esperando aprobación — ver la memoria del proyecto.)
--
-- Las tres las decidió Lucas el 11-sep-2026, con las dos cantidades a la vista:
--
--   1 · Ñoquis rellenos (Vedia)      → manda la VIANDA. El ñoqui relleno sale
--       del mismo puré que el simple, así que la BASE tiene que llevar también
--       Huevos 0,34 y Semolín 0,040. Se COMPLETA la base.
--   2 · Ñoquis Relleno SG (Saavedra) → 12 g de muzzarella en las dos. Es la
--       misma porción. La VIANDA pasa de 0,010 a 0,012.
--   3 · Tortelli (Saavedra)          → 130 g de masa en todas, el (PACK)
--       incluido. El (PACK) pasa de 0,11 a 0,13.
--
-- Esto va DESPUÉS del merge publicado (main = 3bbcb6d), no antes.
-- Es solo datos: ninguna pantalla compara estas cantidades contra un literal.

begin;

-- ══ 1 · Ñoquis rellenos (Vedia): completar la base ══════════════════════════
do $$
declare
  v_base uuid := '85814287-d586-4843-8ffa-d0cc5fb543f4';
  v_ya int; v_orden int; v_n int;
begin
  -- Guardarraíl: la base NO tiene que tener todavía estos dos ingredientes.
  select count(*) into v_ya
    from public.cocina_receta_ingredientes
   where receta_id = v_base and nombre in ('Huevos','Semolin');
  if v_ya <> 0 then
    raise exception 'PARAR: la base de Ñoquis rellenos ya tiene % de esos ingredientes.', v_ya;
  end if;

  select coalesce(max(orden), 0) into v_orden
    from public.cocina_receta_ingredientes where receta_id = v_base;

  insert into public.cocina_receta_ingredientes
    (receta_id, nombre, cantidad, unidad, orden, producto_id)
  values
    (v_base, 'Huevos',  0.34,  'unid.', v_orden + 1, 'e643d6b6-a89b-4cc5-bf2f-38bbc7455980'),
    (v_base, 'Semolin', 0.040, 'kg',    v_orden + 2, '523c61e5-9477-45fd-b13e-a010ab422998');

  get diagnostics v_n = row_count;
  if v_n <> 2 then
    raise exception 'PARAR: se esperaban 2 altas y se hicieron %.', v_n;
  end if;
  raise notice 'OK 1: Ñoquis rellenos (Vedia) suma Huevos 0,34 y Semolín 0,040.';
end $$;

-- ══ 2 · Ñoquis Relleno SG (VIANDA): muzzarella 0,010 → 0,012 ════════════════
do $$
declare
  v_ing uuid := '00d2d547-6b0e-4073-b457-de844baebc92';
  v_antes numeric; v_n int;
begin
  select cantidad into v_antes from public.cocina_receta_ingredientes where id = v_ing;
  if v_antes is null then
    raise exception 'PARAR: no existe el ingrediente %.', v_ing;
  end if;
  if v_antes <> 0.010 then
    raise exception 'PARAR: se esperaba 0,010 y hay %. Alguien lo toco.', v_antes;
  end if;

  update public.cocina_receta_ingredientes set cantidad = 0.012 where id = v_ing;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'PARAR: el update toco % filas, no 1 (RLS?).', v_n;
  end if;
  raise notice 'OK 2: muzzarella de la vianda SG 0,010 -> 0,012.';
end $$;

-- ══ 3 · Tortelli (PACK): masa 0,11 → 0,13 ══════════════════════════════════
do $$
declare
  v_ing uuid := 'd9bba3fb-8e66-43fb-8730-04ebacd679ab';
  v_antes numeric; v_n int;
begin
  select cantidad into v_antes from public.cocina_receta_ingredientes where id = v_ing;
  if v_antes is null then
    raise exception 'PARAR: no existe el ingrediente %.', v_ing;
  end if;
  if v_antes <> 0.11 then
    raise exception 'PARAR: se esperaba 0,11 y hay %. Alguien lo toco.', v_antes;
  end if;

  update public.cocina_receta_ingredientes set cantidad = 0.13 where id = v_ing;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'PARAR: el update toco % filas, no 1 (RLS?).', v_n;
  end if;
  raise notice 'OK 3: masa del Tortelli (PACK) 0,11 -> 0,13.';
end $$;

-- ══ Cierre: las tres familias tienen que quedar parejas ═════════════════════
do $$
declare v_dif int;
begin
  -- Muzzarella igual en base y vianda de Ñoquis Relleno SG
  select count(*) into v_dif
    from public.cocina_receta_ingredientes a
    join public.cocina_receta_ingredientes b on b.nombre = a.nombre
   where a.receta_id = '6c3c9acf-6719-49c4-9fe0-5c9d12034225'
     and b.receta_id = '7e589b97-9187-46ea-8db3-242ec29691d8'
     and a.cantidad is distinct from b.cantidad;
  if v_dif > 0 then
    raise exception 'PARAR: quedan % ingredientes distintos en Ñoquis Relleno SG.', v_dif;
  end if;

  -- Masa igual en las tres variantes de Tortelli
  select count(distinct cantidad) into v_dif
    from public.cocina_receta_ingredientes
   where nombre = 'Subreceta Masa Huevo Pastas'
     and receta_id in ('98485a0c-3500-4f2f-af26-a3625279cd17',
                       '43d61e11-56c3-418d-aeb9-6df234f08325',
                       'ffae5b9b-825a-4415-a1df-83e710475d9a',
                       '196c6560-4868-49bb-ac93-c0ca2717a9f3');
  if v_dif <> 1 then
    raise exception 'PARAR: el Tortelli tiene % cantidades de masa distintas, deberia ser 1.', v_dif;
  end if;

  raise notice 'OK: las tres familias quedaron parejas.';
end $$;

commit;
