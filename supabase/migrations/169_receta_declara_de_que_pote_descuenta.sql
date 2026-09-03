-- 169 · Cada plato que se vende declara de que pote de camara descuenta
--
-- EL PROBLEMA. Lo que se VENDE es una receta (el plato de la carta) y lo que se
-- CUENTA en la camara es un producto (el pote de sorrentinos). Entre los dos no
-- habia camino. La columna que todos tomaban por puente, cocina_productos.receta_id,
-- significa DOS COSAS DISTINTAS segun la fila: en 26 productos apunta hacia
-- ADELANTE (al plato que se vende) y en 48 apunta hacia ATRAS (a la olla de relleno
-- o a la masa con la que se hace). Por eso no servia como puente y por eso los
-- "Ñoquis de papa" y "Ñoquis rellenos" parecian colisionar: comparten la misma olla.
--
-- LA SOLUCION. Una columna nueva, con un nombre que dice para donde apunta:
-- cocina_recetas.descuenta_producto_id -> cocina_productos(id).
-- Una receta descuenta a lo sumo UN pote. Los tres canales del mismo plato
-- (salon, VIANDA, CONGELADO) son tres recetas distintas y las tres apuntan al
-- mismo pote.
--
-- POR QUE NO HACE FALTA GUARDAR "CUANTAS PORCIONES". Regla de Lucas (3-sep-2026):
-- "para la venta, porciones es igual a 1 venta. O sea 1 porcion es 1 venta".
-- Vale tambien para los combos con milanesa. Y ademas: "nosotros lo que hacemos es
-- un check de cierre donde controlamos fisicamente lo que quedo en stock, y ahi se
-- actualiza si es necesario" — o sea que el descuento automatico es una ESTIMACION
-- ENTRE CONTEOS y el conteo fisico manda, igual que en la camara. No hace falta
-- afinar el gramaje.
--
-- ⚠️ NO CAMBIA NINGUN NUMERO. La columna nace vacia para todo lo que no es pasta,
-- nadie la lee todavia (ninguna vista, ninguna funcion, ninguna pantalla) y el
-- descuento de la venta NO se prende en esta migracion. Es el cable; el enchufe
-- viene despues y con OK aparte.
--
-- ⚠️ REGLA DEL DESCUENTO, para cuando se prenda (decision de Lucas):
-- LA VENTA DESCUENTA EL MOSTRADOR, NUNCA LA CAMARA. La camara ya la descuenta el
-- traspaso. Si la venta tambien la tocara, se restaria dos veces la misma porcion.

alter table public.cocina_recetas
  add column if not exists descuenta_producto_id uuid references public.cocina_productos(id);

comment on column public.cocina_recetas.descuenta_producto_id is
  'De que pote de camara (cocina_productos) sale este plato al venderse. 1 venta = 1 porcion. '
  'Los canales VIANDA/CONGELADO son recetas aparte que apuntan al mismo pote. '
  'NO confundir con cocina_productos.receta_id, que apunta al reves y significa dos cosas.';

create index if not exists idx_cocina_recetas_descuenta_producto
  on public.cocina_recetas (descuenta_producto_id)
  where descuenta_producto_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- BACKFILL en tres pasadas, de mas confiable a menos. Cada pasada solo completa
-- lo que quedo vacio, asi que el orden importa y volver a correr no pisa nada.
-- Solo tipo='receta' (los platos que se venden): las subrecetas quedan afuera a
-- proposito, porque son justamente las que reciben los punteros "hacia atras".
-- ─────────────────────────────────────────────────────────────────────────────

-- PASADA 1 — el producto ya apunta a esta receta (puntero hacia adelante, 26 casos).
update public.cocina_recetas r
set descuenta_producto_id = p.id
from public.cocina_productos p
where r.descuenta_producto_id is null
  and r.tipo = 'receta'
  and p.tipo = 'pasta' and p.activo = true
  and p.receta_id = r.id
  and p.local = r.local;

-- PASADA 2 — mismo nombre, sacandole el canal entre parentesis y el sufijo SG.
-- Cubre "Ñoquis de papa (VIANDA)" -> "Ñoquis de papa" y "Ñoqui De Papa SG" -> idem.
update public.cocina_recetas r
set descuenta_producto_id = p.id
from public.cocina_productos p
where r.descuenta_producto_id is null
  and r.tipo = 'receta'
  and p.tipo = 'pasta' and p.activo = true
  and p.local = r.local
  and public.norm_nombre_cocina(
        regexp_replace(regexp_replace(r.nombre, '\([^)]*\)', '', 'g'), '\ysg\y', '', 'gi'))
    = public.norm_nombre_cocina(regexp_replace(p.nombre, '\ysg\y', '', 'gi'));

-- PASADA 3 — las que no salen por nombre. Cada una revisada contra el catalogo real
-- de la camara; las tres ultimas las confirmo Lucas el 3-sep-2026.
-- La clave es el nombre normalizado SIN canal y SIN 'SG', asi una linea sirve para
-- el plato de salon, la vianda y el congelado a la vez.
update public.cocina_recetas r
set descuenta_producto_id = p.id
from (values
  -- receta (normalizada, sin canal ni SG)   local        pote de camara
  ('sorrentinosdejamonyquesos',              'vedia',     'Sorrentinos de Jamón y queso'),
  ('noquisrelleno',                          'saavedra',  'Ñoquis rellenos'),
  ('tagliatellesmix',                        'vedia',     'Tagliatelles mixtos'),
  ('tagliatelleshuevo',                      'vedia',     'Tagliatelles al huevo'),
  -- misma masa, otro corte (confirmado por Lucas)
  ('spaghettialhuevo',                       'saavedra',  'Tagliatelles al huevo'),
  -- combos con milanesa: descuentan 1 porcion de la pasta que llevan (confirmado por Lucas)
  ('milanesanoquidepapa',                    'saavedra',  'Ñoquis de papa'),
  ('milanesasdepollonoquidepapa',            'vedia',     'Ñoquis de papa'),
  ('milanesaconcrestadigallo',               'saavedra',  'Cresta di Gallo')
) as mapa(clave, loc, pote),
public.cocina_productos p
where r.descuenta_producto_id is null
  and r.tipo = 'receta'
  and r.local = mapa.loc
  and public.norm_nombre_cocina(
        regexp_replace(regexp_replace(r.nombre, '\([^)]*\)', '', 'g'), '\ysg\y', '', 'gi')) = mapa.clave
  and p.tipo = 'pasta' and p.activo = true
  and p.local = mapa.loc
  and public.norm_nombre_cocina(p.nombre) = public.norm_nombre_cocina(mapa.pote);
