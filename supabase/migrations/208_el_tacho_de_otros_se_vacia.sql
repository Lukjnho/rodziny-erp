-- 208 — El tacho de "otros" se vacía, y el panificado toma el nombre del patrón
--
-- ══════════════════════════════════════════════════════════════════════════════
-- QUÉ ESTABA PASANDO
-- ══════════════════════════════════════════════════════════════════════════════
--
-- El rol de una subreceta dice a qué grupo comercial se proyecta cuando se
-- vende sola. Había 28 subrecetas en `otros`, que es el tacho: ni el costeo ni
-- el menú saben dónde ponerlas, y caen al fondo como "Otros".
--
-- Lucas las clasificó el 11-sep-2026 mirando la lista completa con nombre y
-- con cuántas recetas usa cada una. Se mueven 21 de las 28:
--
--     15 componentes dulces        → pasteleria_base
--      1 Masa sable                → masa   (es una masa, no un relleno dulce)
--      1 Empanado Para Milanesa    → milanesa_base
--      4 coberturas y guarniciones → adicional
--
-- El criterio de las cuatro últimas, con sus palabras: «son coberturas y
-- guarniciones: se suman a un plato base, no lo componen».
--
-- Las 7 que NO se mueven y por qué:
--     4 están apagadas y sin uso → se dejan como están
--     3 terminan en "(PACK)"     → no son subrecetas, son variantes con empaque
--                                  mal cargadas. Se deciden aparte.
--
-- Y una receta suelta: "Focaccia (ENTRADA)" era la única en la CATEGORÍA
-- `otros`. Es un pan: va a `panificado`.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- EL ROL `panificado` PASA A LLAMARSE `panificado_base`
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Los `*_base` no son siete valores sueltos: son UN mecanismo que significa
-- "base que se proyecta al grupo comercial X". `panificado` era el mismo patrón
-- sin el sufijo, y por eso se confundía con la CATEGORÍA `panificado`, que es
-- otra columna y otra cosa. Ahora los ocho se llaman igual.
--
-- 💣 Es un renombre de dato, no solo de etiqueta. Antes de hacerlo se verificó
-- que no lo mire nadie más: cero funciones y cero vistas de la base lo nombran,
-- y en el front hay UN solo lugar (`PlanProduccionEditor.tsx:64`), que va en el
-- mismo commit. `cocina_productos.tipo = 'panificado'` y
-- `cocina_recetas.categoria = 'panificado'` son OTRAS columnas y no se tocan.
--
begin;

-- ── 1) La lista de roles admite el nombre nuevo ─────────────────────────────
alter table public.cocina_recetas drop constraint if exists cocina_recetas_rol_check;
alter table public.cocina_recetas add constraint cocina_recetas_rol_check
  check (rol is null or rol = any (array[
    'relleno', 'masa', 'masa_panaderia',
    'salsa_base', 'postre_base', 'panificado', 'panificado_base',
    'pasteleria_base', 'bebida_base',
    'adicional', 'packaging', 'milanesa_base', 'otros'
  ]));

do $fix$
declare
  v_filas int;
  v_resto int;
begin
  -- ── 2) Los 15 componentes dulces ──────────────────────────────────────────
  update public.cocina_recetas
     set rol = 'pasteleria_base', updated_at = now()
   where tipo = 'subreceta' and rol = 'otros'
     and nombre in ('Almibar', 'Almibar Base', 'Bizcochuelo de Chocolate', 'Caramelo Base',
                    'Coulis de Frutos Rojos', 'Coulis de Frutos Rojos Base', 'Crema chantilli',
                    'Crema Pastelera', 'Crema Tiramisú', 'Dulce de Leche', 'Frosting',
                    'Ganache', 'Mermelada de Frutos Rojos', 'Pionono Base', 'Tapas de Chocolates');
  get diagnostics v_filas = row_count;
  if v_filas <> 15 then
    raise exception 'Esperaba 15 componentes dulces y moví %. Revisá los nombres antes de seguir.', v_filas;
  end if;

  -- ── 3) Masa sable es una masa ─────────────────────────────────────────────
  update public.cocina_recetas
     set rol = 'masa', updated_at = now()
   where tipo = 'subreceta' and rol = 'otros' and nombre = 'Masa sable';
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'Esperaba 1 "Masa sable" y moví %.', v_filas;
  end if;

  -- ── 4) El empanado va con la milanesa ─────────────────────────────────────
  update public.cocina_recetas
     set rol = 'milanesa_base', updated_at = now()
   where tipo = 'subreceta' and rol = 'otros' and nombre = 'Empanado Para Milanesa';
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'Esperaba 1 "Empanado Para Milanesa" y moví %.', v_filas;
  end if;

  -- ── 5) Las cuatro coberturas y guarniciones ───────────────────────────────
  update public.cocina_recetas
     set rol = 'adicional', updated_at = now()
   where tipo = 'subreceta' and rol = 'otros'
     and nombre in ('Cebolla Salteada (PIZZA)', 'Cherrys Confitados',
                    'Mix De Quesos (PIZZA/MILA)', 'Morron Asado');
  get diagnostics v_filas = row_count;
  if v_filas <> 4 then
    raise exception 'Esperaba 4 coberturas y moví %.', v_filas;
  end if;

  -- ── 6) La Focaccia es un pan ──────────────────────────────────────────────
  update public.cocina_recetas
     set categoria = 'panificado', updated_at = now()
   where tipo = 'receta' and categoria = 'otros';
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'Esperaba 1 receta en categoría "otros" (la Focaccia) y moví %.', v_filas;
  end if;

  -- ── 7) panificado → panificado_base ───────────────────────────────────────
  update public.cocina_recetas
     set rol = 'panificado_base', updated_at = now()
   where tipo = 'subreceta' and rol = 'panificado';
  get diagnostics v_filas = row_count;
  if v_filas <> 15 then
    raise exception 'Esperaba 15 subrecetas con rol "panificado" y moví %.', v_filas;
  end if;

  -- ── 8) Lo que queda en el tacho tiene que ser exactamente 7 ───────────────
  select count(*) into v_resto
    from public.cocina_recetas where tipo = 'subreceta' and rol = 'otros';
  if v_resto <> 7 then
    raise exception 'En "otros" tenían que quedar 7 (4 apagadas + 3 PACK) y quedan %.', v_resto;
  end if;

  raise notice 'Tacho vaciado: 21 subrecetas clasificadas, 15 renombradas a panificado_base, 1 receta a panificado. Quedan 7 en otros a propósito.';
end
$fix$;

-- ── 9) Ahora que no queda ninguna, el nombre viejo se saca de la lista ──────
-- Así no puede volver a entrar por una carga a mano.
alter table public.cocina_recetas drop constraint cocina_recetas_rol_check;
alter table public.cocina_recetas add constraint cocina_recetas_rol_check
  check (rol is null or rol = any (array[
    'relleno', 'masa', 'masa_panaderia',
    'salsa_base', 'postre_base', 'panificado_base',
    'pasteleria_base', 'bebida_base',
    'adicional', 'packaging', 'milanesa_base', 'otros'
  ]));

comment on column public.cocina_recetas.rol is
  'Qué es esta subreceta dentro de la cocina. Los *_base son UN mecanismo: '
  '"base que se proyecta al grupo comercial X" cuando la subreceta se vende sola. '
  'NO confundir con `categoria`, que es otra columna y solo la llevan las recetas.';

-- ── Guardarraíl ─────────────────────────────────────────────────────────────
do $guard$
declare
  r record;
begin
  for r in
    select rol, count(*) as n from public.cocina_recetas
     where tipo = 'subreceta' and rol is not null group by rol order by rol
  loop
    raise notice '  rol %  →  %', rpad(r.rol, 18), r.n;
  end loop;

  if exists (select 1 from public.cocina_recetas where tipo='subreceta' and rol='panificado') then
    raise exception 'GUARDARRAIL: todavía hay subrecetas con el rol viejo "panificado".';
  end if;
  if exists (select 1 from public.cocina_recetas where tipo='receta' and categoria='otros') then
    raise exception 'GUARDARRAIL: todavía hay recetas en la categoría "otros".';
  end if;
end
$guard$;

commit;
