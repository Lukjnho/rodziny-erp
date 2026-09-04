-- 175 — Cada receta nombra la subreceta de SU local
--
-- EL PROBLEMA
-- 12 renglones nombraban una subreceta que no existe en su local. El motor de
-- costeo, al no encontrarla, la buscaba en el OTRO local sin avisar. Decisión de
-- Lucas (4-sep-2026): «cada receta es similar pero no deberían tener un producto
-- con la receta del otro local porque así no funciona».
--
-- LO GRAVE: 9 de esos 12 eran los productos SIN GLUTEN de Saavedra
-- (Cappelletti Capresse SG, Spaghetti Al Huevo SG, Tagliatelles Al Huevo)
-- agarrando las masas de Vedia, que son DE TRIGO (harina 0000 + semolín). En el
-- papel, un producto SG figuraba hecho con gluten. Saavedra ni siquiera tiene
-- harina 0000 ni semolín cargados como insumo: amasa sin gluten (harina de
-- arroz, almidón de maíz, fécula de mandioca, harina de garbanzos, goma xántica
-- y sal SIN TACC).
--
-- Lucas confirmó que en Saavedra se usa UNA sola masa, la sin gluten que ya está
-- cargada, tanto para simples como para rellenas. Por eso NO se duplica nada:
-- se corrige a qué subreceta apunta cada renglón.
--
-- Las cantidades NO cambian: 0,13 / 0,14 kg de masa por porción son kilos de
-- masa, no una fracción del lote. La migración 174 ya divide por el rinde de la
-- subreceta que corresponda.

-- ── 1) Saavedra: los 9 renglones SG pasan a la masa sin gluten de Saavedra ───
update public.cocina_receta_ingredientes i
   set nombre = 'Subreceta Masa Huevo Pastas'
  from public.cocina_recetas r
 where i.receta_id = r.id
   and r.local = 'saavedra'
   and i.producto_id is null
   and i.nombre in ('Subreceta Masa Huevo Pastas Simples',
                    'Subreceta Masa Huevo Pastas Rellenas');

-- ── 2) Almíbar: es la misma subreceta con distinto nombre en cada local ──────
-- Vedia la llama «Almibar Base», Saavedra «Almibar», y cada receta nombraba la
-- del otro. Las dos rinden 12 kg y llevan lo mismo (azúcar), así que el costo no
-- se mueve: lo que se arregla es que cada local se apoye en su propia ficha.
update public.cocina_receta_ingredientes i
   set nombre = 'Subreceta Almibar'
  from public.cocina_recetas r
 where i.receta_id = r.id
   and r.local = 'saavedra'
   and i.producto_id is null
   and i.nombre = 'Subreceta Almibar Base';

update public.cocina_receta_ingredientes i
   set nombre = 'Subreceta Almibar Base'
  from public.cocina_recetas r
 where i.receta_id = r.id
   and r.local = 'vedia'
   and i.producto_id is null
   and i.nombre = 'Subreceta Almibar';

-- ── 3) Crema de Hongos: Vedia tiene la suya, el «(BIENAL)» es de Saavedra ────
-- La Bienal ya pasó; ese sufijo quedó de aquel evento.
update public.cocina_receta_ingredientes i
   set nombre = 'Subreceta Crema de Hongos'
  from public.cocina_recetas r
 where i.receta_id = r.id
   and r.local = 'vedia'
   and i.producto_id is null
   and i.nombre = 'Subreceta Crema de Hongos (BIENAL)';
