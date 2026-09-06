-- 181 — Una sola forma de escribir cada unidad
--
-- EL PROBLEMA
-- El almacén guarda tres unidades y ninguna variante: `productos.unidad` y
-- `movimientos_stock.unidad` sólo contienen 'unid.', 'kg' y 'L', porque el
-- formulario de Compras fija esos valores. La cocina tenía lista propia y venía
-- guardando 'unid' y 'lt' para EXACTAMENTE las mismas unidades.
--
-- Eso no rompía nada mientras cada módulo se mirara el ombligo. Pero el próximo
-- paso es que producir descuente el almacén, y ahí toda comparación de unidades
-- entre una receta y el stock falla por un punto, sin dar un solo error.
--
-- DE DÓNDE SALÍA
-- De una línea: `mapearUnidad()` en el selector de ingredientes convertía el 'L'
-- del insumo en 'lt' y su 'unid.' en 'unid'. Venía fabricando la divergencia de a
-- un renglón por vez. Ya está corregida junto con esta migración, así que esto
-- limpia lo viejo y no vuelve a ensuciarse.
--
-- QUÉ HACE Y QUÉ NO HACE
-- Corrige SÓLO LA ORTOGRAFÍA. No toca una sola cantidad.
--   'unid'  → 'unid.'   (196 renglones)
--   'lt'    → 'L'       ( 53 renglones)
--   'l'     → 'L'       (  4 renglones)
--
-- Los renglones en 'g', 'ml' y 'oz' QUEDAN COMO ESTÁN, a propósito. No son un
-- error de tipeo: nadie escribe "0,003 kg de nuez moscada", escribe "3 g". La
-- conversión se hace al calcular (aBase en @/lib/unidades), no al guardar, para
-- que el que carga siga escribiendo como piensa.
--
-- En particular NO se convierten los 46 renglones de barra que están en ml/oz
-- contra un insumo que el almacén cuenta por botella: ésos no se arreglan
-- cambiando la unidad, se resuelven con `productos.contenido_ml` (que ya está
-- cargado en los 46) en el momento de descontar.

begin;

-- Se listan los valores viejos de forma explícita en vez de usar un normalizador
-- genérico: si mañana aparece una unidad nueva mal escrita, queremos que quede a
-- la vista en una migración y no que se corrija sola sin que nadie se entere.
update cocina_receta_ingredientes
   set unidad = 'unid.'
 where lower(trim(unidad)) in ('unid', 'u', 'unidad', 'unidades');

update cocina_receta_ingredientes
   set unidad = 'L'
 where lower(trim(unidad)) in ('lt', 'l', 'lts', 'litro', 'litros');

update cocina_receta_ingredientes
   set unidad = 'kg'
 where lower(trim(unidad)) in ('kgs', 'kilo', 'kilos');

update cocina_receta_ingredientes
   set unidad = 'g'
 where lower(trim(unidad)) in ('gr', 'grs', 'gramo', 'gramos');

update cocina_receta_ingredientes
   set unidad = 'ml'
 where lower(trim(unidad)) in ('mililitros');

update cocina_receta_ingredientes
   set unidad = 'oz'
 where lower(trim(unidad)) in ('onza', 'onzas');

-- Guardarraíl: si después de esto quedara alguna unidad fuera del vocabulario,
-- la migración falla en vez de dejar el problema escondido para más adelante.
do $$
declare
  raras text;
begin
  select string_agg(distinct unidad, ', ')
    into raras
    from cocina_receta_ingredientes
   where unidad is not null
     and unidad not in ('kg', 'g', 'L', 'ml', 'unid.', 'oz');
  if raras is not null then
    raise exception 'Quedaron unidades fuera del vocabulario en cocina_receta_ingredientes: %', raras;
  end if;
end $$;

commit;
