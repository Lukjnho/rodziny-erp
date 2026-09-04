-- 174 — La tablet deja de pedir el lote entero de la subreceta
--
-- EL PROBLEMA
-- `cocina_ingredientes_expandidos` es lo que la tablet le muestra al cocinero
-- para pesar. Cuando un renglón apunta a una subreceta, la función bajaba a los
-- ingredientes de esa subreceta multiplicando por la cantidad del padre, pero
-- SIN dividir por lo que la subreceta rinde. O sea: pedía el LOTE ENTERO.
--
-- Caso real: "Servicio Salón" (Saavedra) lleva **2 unidades** de "Pan para
-- servicio", y esa subreceta rinde **150 porciones**. La tablet pedía pesar
-- 1,8 kg de almidón de maíz, 1,1 kg de harina de arroz y **32 huevos**. Lo
-- correcto es 2/150 de eso.
--
-- Alcance medido antes de tocar: **155 renglones en 113 recetas activas**.
-- Los peores infladores: Pan para servicio (150x), Masa de medialuna SG (24x),
-- Crema Blanca base (21,7x), Helado Soft Pistacho Base (20x).
--
-- No mueve stock ni plata (el motor de costeo, que es otro, ya dividía bien).
-- Lo que rompe es la confianza: el cocinero ve una lista imposible de pesar, la
-- ignora o la tilda a ojo, y lo que queda guardado como "lo que realmente se
-- usó" no sirve para nada.
--
-- LA REGLA, COPIADA DEL MOTOR DE COSTEO (costeoEngine.ts:372-420)
-- La fracción de subreceta que se usa es: cantidad del padre / rinde.
--   · Si el padre pide en peso o volumen (kg, g, ml, lt, oz) se pasa todo a kg
--     —densidad 1 para líquidos, 1 oz = 30 ml— y se divide por rendimiento_kg.
--   · Si pide por unidad, se divide por rendimiento_porciones.
-- Si falta el rinde que hace falta, NO se expande: el renglón de la subreceta
-- queda entero, como pasa hoy cuando no hay subreceta que matchee. Es preferible
-- un renglón que el cocinero entiende a un número inventado.
-- (Verificado antes de aplicar: hoy los 317 renglones que expanden tienen el
-- rinde que necesitan, así que este caso no se da con los datos actuales.)

-- ── La fracción de subreceta que corresponde ────────────────────────────────
create or replace function public._cocina_fraccion_subreceta(
  p_cantidad       numeric,
  p_unidad         text,
  p_rend_kg        numeric,
  p_rend_porciones numeric
) returns numeric
language sql
immutable
set search_path = ''
as $$
  with u as (
    select case
      when lower(btrim(coalesce(p_unidad, ''))) in ('kg', 'kgs')                       then 'kg'
      when lower(btrim(coalesce(p_unidad, ''))) in ('g', 'gr', 'grs', 'gramo', 'gramos') then 'g'
      when lower(btrim(coalesce(p_unidad, ''))) in ('lt', 'l', 'lts', 'litro', 'litros') then 'lt'
      when lower(btrim(coalesce(p_unidad, ''))) in ('ml', 'mililitros')                 then 'ml'
      when lower(btrim(coalesce(p_unidad, ''))) in ('oz', 'onza', 'onzas')              then 'oz'
      -- Todo lo demás (unid, botella, lata, paquete…) cuenta como porciones.
      else 'unid'
    end as un
  ),
  en_kg as (
    select un, case un
      when 'kg' then p_cantidad
      when 'g'  then p_cantidad / 1000
      when 'lt' then p_cantidad              -- 1 lt ≈ 1 kg (densidad 1, base agua)
      when 'ml' then p_cantidad / 1000
      when 'oz' then p_cantidad * 30 / 1000  -- 1 oz = 30 ml
      else null
    end as kg
    from u
  )
  select case
    when kg is not null
      then case when coalesce(p_rend_kg, 0) > 0        then kg         / p_rend_kg end
      else case when coalesce(p_rend_porciones, 0) > 0 then p_cantidad / p_rend_porciones end
  end
  from en_kg;
$$;

comment on function public._cocina_fraccion_subreceta(numeric, text, numeric, numeric) is
  'Qué parte de una subreceta usa un renglón que la nombra: cantidad del padre / rinde, '
  'pasando peso y volumen a kg. Devuelve NULL si falta el rinde que hace falta, y en ese '
  'caso el renglón NO se expande. Misma regla que costeoEngine.ts.';

-- ── La expansión, ahora dividiendo ──────────────────────────────────────────
create or replace function public.cocina_ingredientes_expandidos(p_receta_id uuid)
returns table(id text, nombre text, cantidad double precision, unidad text, producto_id uuid)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with recursive walk as (
    select
      i.id::text                                                        as id,
      i.nombre,
      i.cantidad,
      i.unidad,
      i.producto_id,
      i.orden,
      1::numeric                                                        as acc,
      (select r0.local from cocina_recetas r0 where r0.id = p_receta_id) as local_ctx,
      i.id::text                                                        as path,
      0                                                                 as depth
    from cocina_receta_ingredientes i
    where i.receta_id = p_receta_id

    union all

    select
      ci.id::text,
      ci.nombre,
      ci.cantidad,
      ci.unidad,
      ci.producto_id,
      ci.orden,
      -- ANTES: w.acc * w.cantidad  → se llevaba el lote entero de la subreceta.
      w.acc * public._cocina_fraccion_subreceta(
                w.cantidad, w.unidad, r.rendimiento_kg, r.rendimiento_porciones),
      r.local,
      w.path || '>' || ci.id::text,
      w.depth + 1
    from walk w
    join cocina_recetas r
      on r.tipo = 'subreceta'
     and r.activo
     and public._cocina_norm_nombre(r.nombre) = public._cocina_norm_nombre(w.nombre)
     and r.local = w.local_ctx
    join cocina_receta_ingredientes ci on ci.receta_id = r.id
    where w.producto_id is null
      and w.depth < 8
      -- Sin rinde no se puede repartir: mejor dejar el renglón sin expandir.
      and public._cocina_fraccion_subreceta(
            w.cantidad, w.unidad, r.rendimiento_kg, r.rendimiento_porciones) is not null
  )
  select
    w.path                                 as id,
    w.nombre,
    (w.cantidad * w.acc)::double precision as cantidad,
    w.unidad,
    w.producto_id
  from walk w
  -- Se esconde el renglón "Subreceta X" solo si de verdad se expandió. Si no se
  -- pudo (falta el rinde), queda a la vista para que el cocinero sepa qué lleva.
  where not (
    w.producto_id is null
    and exists (
      select 1 from cocina_recetas r
      where r.tipo = 'subreceta'
        and r.activo
        and public._cocina_norm_nombre(r.nombre) = public._cocina_norm_nombre(w.nombre)
        and r.local = w.local_ctx
        and public._cocina_fraccion_subreceta(
              w.cantidad, w.unidad, r.rendimiento_kg, r.rendimiento_porciones) is not null
    )
  )
  order by w.depth, w.orden, w.path;
$function$;

grant execute on function public.cocina_ingredientes_expandidos(uuid) to anon, authenticated;
