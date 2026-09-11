-- 217 · Diez recetas jubiladas dejan de chocar con la que sigue viva.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- QUÉ SE ARREGLA
-- ══════════════════════════════════════════════════════════════════════════════
--
-- El índice único de la base es `(nombre, local)` y es SENSIBLE A MAYÚSCULAS:
-- para Postgres `Torta matilda` y `Torta Matilda` son dos nombres distintos.
-- El motor de costeo, en cambio, normaliza —minúsculas, sin el prefijo
-- "Subreceta ", espacios colapsados— y se queda con LA PRIMERA que encuentra.
-- Esa es toda la grieta, y la consulta que carga las recetas no tiene
-- `order by`: cuál gana puede cambiar entre una carga de página y la siguiente.
--
-- `npm run nombres` encontró 15 pares. Acá van los 10 que se pueden renombrar
-- sin mover un peso: en ninguno se toca una subreceta que algún renglón nombre,
-- porque los 17 renglones que nombran a estos platos apuntan a la que se queda.
--
-- Convención: sufijo ` (no usar)`, que ya existe en estos datos.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- LOS QUE **NO** ENTRAN
-- ══════════════════════════════════════════════════════════════════════════════
--
-- ⛔ `Bolognesa Base` (Vedia). La apagada tiene 21 ingredientes y la viva 18,
--    y la diferencia no es un descuido: la apagada arma la salsa con
--    `Subreceta Pomodoro Base` (3,5 kg) y la viva la reemplazó por
--    `Lata tomate italiano 2.5kg`. Además la apagada lleva queso sardo y
--    tomillo que la viva no. Cuál es la buena lo decide Lucas.
--
-- ⛔ Los 4 pares con las DOS activas (avocado toast, crema de hongos, jugo de
--    naranja, tiramisú). No son duplicados: son una receta vendible de un solo
--    renglón que envuelve a la subreceta con la lista real. Renombrar la base
--    obliga a actualizar también los renglones que la nombran.
--
-- 🔑 El índice único sobre el nombre normalizado NO se puede crear hasta que
-- los 5 que quedan estén resueltos.

begin;

do $$
declare n int; total int := 0;
begin
  -- Guardarraíl: los 10 existen, están APAGADOS, y ninguno ya tiene el sufijo.
  select count(*) into n from cocina_recetas
   where not activo and nombre not like '%(no usar)%'
     and (nombre, local) in (
       ('Agua Con Gas','saavedra'), ('Agua Sin Gas','saavedra'),
       ('Masa Sable','saavedra'), ('Torta Matilda','saavedra'),
       ('Torta Matilda (PORCION)','saavedra'),
       ('Helado Soft  Americana','vedia'),
       ('Mac & cheese (BIENAL)','vedia'), ('Mac & cheese (BIENAL)','saavedra'),
       ('Salsa De cherrys (BIENAL)','vedia'), ('Salsa Toffee Base','vedia'));
  if n <> 10 then
    raise exception 'Esperaba 10 recetas apagadas para renombrar, encontré %', n;
  end if;

  -- Guardarraíl: las que se quedan siguen vivas y con su nombre.
  select count(*) into n from cocina_recetas
   where activo and (nombre, local) in (
       ('Agua con Gas','saavedra'), ('Agua sin Gas','saavedra'),
       ('Masa sable','saavedra'), ('Torta matilda','saavedra'),
       ('Torta matilda (PORCION)','saavedra'));
  if n <> 5 then raise exception 'Alguna de las que se quedan no está viva: encontré %', n; end if;

  update cocina_recetas set nombre = 'Agua Con Gas (no usar)'
   where nombre = 'Agua Con Gas' and local = 'saavedra';
  get diagnostics n = row_count; total := total + n;

  update cocina_recetas set nombre = 'Agua Sin Gas (no usar)'
   where nombre = 'Agua Sin Gas' and local = 'saavedra';
  get diagnostics n = row_count; total := total + n;

  update cocina_recetas set nombre = 'Masa Sable (no usar)'
   where nombre = 'Masa Sable' and local = 'saavedra';
  get diagnostics n = row_count; total := total + n;

  update cocina_recetas set nombre = 'Torta Matilda (no usar)'
   where nombre = 'Torta Matilda' and local = 'saavedra';
  get diagnostics n = row_count; total := total + n;

  update cocina_recetas set nombre = 'Torta Matilda (PORCION, no usar)'
   where nombre = 'Torta Matilda (PORCION)' and local = 'saavedra';
  get diagnostics n = row_count; total := total + n;

  -- El accidente acá es el DOBLE ESPACIO, que es justo lo que el motor colapsa.
  update cocina_recetas set nombre = 'Helado Soft Americana (no usar)'
   where nombre = 'Helado Soft  Americana' and local = 'vedia';
  get diagnostics n = row_count; total := total + n;

  -- Las dos plazas. La que se renombra es la receta de un solo renglón (la
  -- cáscara); la subreceta con los 6 ingredientes se queda con el nombre.
  update cocina_recetas set nombre = 'Mac & cheese (BIENAL, no usar)'
   where nombre = 'Mac & cheese (BIENAL)' and local in ('vedia','saavedra');
  get diagnostics n = row_count; total := total + n;

  update cocina_recetas set nombre = 'Salsa De cherrys (BIENAL, no usar)'
   where nombre = 'Salsa De cherrys (BIENAL)' and local = 'vedia';
  get diagnostics n = row_count; total := total + n;

  update cocina_recetas set nombre = 'Salsa Toffee Base (no usar)'
   where nombre = 'Salsa Toffee Base' and local = 'vedia';
  get diagnostics n = row_count; total := total + n;

  if total <> 10 then raise exception 'Se renombraron % recetas, esperaba 10', total; end if;

  -- Guardarraíl final: quedan 5 pares chocando, ni uno más.
  select count(*) into n from (
    select 1 from cocina_recetas
     group by regexp_replace(regexp_replace(lower(btrim(nombre)), '^subreceta\s+', ''), '\s+', ' ', 'g'), local
    having count(*) > 1) x;
  if n <> 5 then raise exception 'Quedaron % pares chocando, esperaba 5', n; end if;

  -- Y la Bolognesa sigue intacta: la decide Lucas.
  select count(*) into n from cocina_recetas
   where nombre = 'Bolognesa Base' and local = 'vedia' and not activo;
  if n <> 1 then raise exception 'La Bolognesa Base se tocó y no tenía que tocarse'; end if;
end $$;

commit;
