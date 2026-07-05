-- 124 — Expansión de subrecetas en el QR de producción (Cocina)
--
-- Problema: en Saavedra los postres se cargan por "Cargar Pastelería Terminada"
-- (product-driven). La grilla del QR muestra los ingredientes de la receta a la
-- que apunta el producto TAL CUAL: no expande subrecetas. Cuando la receta tiene
-- un renglón "Subreceta X Base" (puntero sin producto_id), no hay nada pesable →
-- "no salen los ingredientes" (ej: Tiramisú, Flan).
--
-- Solución: RPC que devuelve los ingredientes de una receta ya EXPANDIDOS —
-- cada renglón "Subreceta X" se reemplaza recursivamente por los ingredientes
-- reales de esa subreceta (escalados por la cantidad del puntero). Mismo criterio
-- de matching que el motor de costeo (prefijo "Subreceta ", por nombre+local).
-- SECURITY DEFINER para que funcione bajo el cliente anónimo del QR público.

-- Helper de normalización de nombre (espeja normalizarNombre() de costeoEngine.ts):
-- minúsculas, sin prefijo "Subreceta ", espacios colapsados.
create or replace function public._cocina_norm_nombre(n text)
returns text
language sql
immutable
as $$
  select regexp_replace(
           regexp_replace(lower(btrim(coalesce(n, ''))), '^subreceta\s+', '', 'i'),
           '\s+', ' ', 'g')
$$;

create or replace function public.cocina_ingredientes_expandidos(p_receta_id uuid)
returns table (
  id text,
  nombre text,
  cantidad double precision,
  unidad text,
  producto_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  with recursive walk as (
    -- Nivel 0: ingredientes directos de la receta pedida.
    select
      i.id::text                                                       as id,
      i.nombre,
      i.cantidad,
      i.unidad,
      i.producto_id,
      i.orden,
      1::numeric                                                       as acc,
      (select r0.local from cocina_recetas r0 where r0.id = p_receta_id) as local_ctx,
      i.id::text                                                       as path,
      0                                                                as depth
    from cocina_receta_ingredientes i
    where i.receta_id = p_receta_id

    union all

    -- Por cada renglón-puntero (sin producto) que resuelve a una subreceta del
    -- mismo local, se traen los ingredientes de esa subreceta escalados por la
    -- cantidad del puntero (acc acumulado). Tope de profundidad = guarda anti-ciclo.
    select
      ci.id::text,
      ci.nombre,
      ci.cantidad,
      ci.unidad,
      ci.producto_id,
      ci.orden,
      w.acc * w.cantidad,
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
  )
  select
    w.path                       as id,
    w.nombre,
    (w.cantidad * w.acc)::double precision as cantidad,
    w.unidad,
    w.producto_id
  from walk w
  -- Se descartan los renglones-puntero que SÍ se expandieron (quedan reemplazados
  -- por sus hijos). Los punteros que no matchean ninguna subreceta se conservan
  -- (no se pierde nada silenciosamente).
  where not (
    w.producto_id is null
    and exists (
      select 1 from cocina_recetas r
      where r.tipo = 'subreceta'
        and r.activo
        and public._cocina_norm_nombre(r.nombre) = public._cocina_norm_nombre(w.nombre)
        and r.local = w.local_ctx
    )
  )
  order by w.depth, w.orden, w.path;
$$;

grant execute on function public._cocina_norm_nombre(text) to anon, authenticated;
grant execute on function public.cocina_ingredientes_expandidos(uuid) to anon, authenticated;

-- Dato: el producto "Carrot Cake SG" (Saavedra) apuntaba a una receta vacía e
-- inactiva ("."). Se re-vincula a la subreceta "Carrot Cake" (pasteleria_base,
-- 10 ingredientes) — la misma que ya usa el pizarrón para este postre.
update cocina_productos
set receta_id = '17964c04-137e-40d4-8ab9-1f9e1b9dfbd3'
where local = 'saavedra'
  and nombre = 'Carrot Cake SG'
  and receta_id = '2c041320-fa9d-40c1-ad4b-48e1f9af974d';
