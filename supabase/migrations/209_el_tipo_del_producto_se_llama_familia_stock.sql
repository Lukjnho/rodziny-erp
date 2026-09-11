-- 209 — `cocina_productos.tipo` pasa a llamarse `familia_stock`
--
-- ══════════════════════════════════════════════════════════════════════════════
-- POR QUÉ
-- ══════════════════════════════════════════════════════════════════════════════
--
-- La columna se llamaba `tipo` y parecía la categoría del producto. No lo es.
-- Medido el 11-sep-2026 sobre los 100 productos, contra lo que dice la receta
-- de cada uno:
--
--   tipo='pasta'       (22) ← cat:pasta · rol:masa · rol:relleno
--   tipo='masa'        (18) ← rol:masa · rol:masa_panaderia
--   tipo='postre'      (12) ← cat:postre · rol:pasteleria_base · rol:postre_base
--   tipo='panificado'  (10) ← cat:panificado · rol:masa_panaderia · rol:panificado_base
--
-- Tres clasificaciones distintas de receta caen en 'pasta', y `masa_panaderia`
-- aparece tanto en 'masa' como en 'panificado'. Si esto fuera la categoría o el
-- rol, eso no podría pasar. Lo que la columna dice de verdad es **en qué sección
-- del pizarrón, del QR y de la cámara vive el producto**, y lo confirma quién la
-- usa: StockTab la agrupa en "🥖 Panes", el QR de producción filtra por ella, el
-- Dashboard de cocina arma sus secciones con ella.
--
-- Que se llame `tipo` la hacía chocar de frente con `cocina_recetas.tipo`
-- (receta / subreceta) y con `cocina_recetas.categoria`. Tres columnas, tres
-- cosas, y dos con el mismo nombre.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- 💣 LO QUE ESTA MIGRACIÓN **NO** HACE, Y POR QUÉ
-- ══════════════════════════════════════════════════════════════════════════════
--
-- No unifica las etiquetas de las pantallas de cocina. Buscando por texto antes
-- de tocar apareció que esas pantallas NO están etiquetando una columna, están
-- etiquetando CUATRO:
--
--   cocina_productos.tipo          100 filas   pasta·bebida·masa·salsa·postre·
--                                              panificado·relleno·milanesa
--   cocina_pizarron_items.tipo   1.088 filas   salsa·relleno·postre·PANADERIA·
--                                              PASTELERIA·PASTA_SIMPLE·milanesa
--   cocina_lotes_produccion.cat  4.649 filas   salsa·postre·PANADERIA·PASTELERIA·
--                                              milanesa·pasta
--   cocina_cierre_dia.tipo       5.021 filas   pasta·salsa·postre·PANADERIA·milanesa
--
-- `panaderia` y `panificado` son la misma cosa escrita distinto en columnas
-- distintas, y `pasta_simple` y `pasteleria` no existen del lado del producto.
-- Juntar las cuatro tablas de etiquetas en una sola cambiaría lo que muestran
-- tres pantallas de producción. Eso es una decisión del negocio, no una mudanza:
-- queda planteado y sin tocar.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- QUÉ SÍ HACE
-- ══════════════════════════════════════════════════════════════════════════════
--
--   1. Borra el único producto con familia 'relleno': "Mezzelune Cuadril
--      (perro)", apagado, sin receta, sin insumo y sin UNA sola referencia en
--      las 12 tablas que apuntan a cocina_productos (verificado antes de
--      borrar, no supuesto).
--   2. Renombra la columna y deja la lista cerrada en los 7 valores que quedan.
--
-- Verificado antes de tocar: NINGUNA vista ni función de la base lee
-- `cocina_productos.tipo`. Las que parecían leerlo miran el `tipo` de OTRA
-- tabla (`cocina_pizarron_items`, `cocina_cierre_dia`).
--
begin;

do $fix$
declare
  v_filas int;
  v_id    uuid;
begin
  -- ── 1) El huérfano ────────────────────────────────────────────────────────
  select id into v_id from public.cocina_productos where tipo = 'relleno';
  if v_id is null then
    raise notice 'No hay producto con familia "relleno": ya estaba borrado.';
  else
    if exists (select 1 from public.ventas_items where cocina_producto_id = v_id)
    or exists (select 1 from public.cocina_lotes_pasta where producto_id = v_id)
    or exists (select 1 from public.cocina_cierre_dia where producto_id = v_id)
    or exists (select 1 from public.cocina_ajustes_stock where producto_id = v_id)
    or exists (select 1 from public.cocina_merma where producto_id = v_id)
    or exists (select 1 from public.cocina_cierre_camara where producto_id = v_id)
    or exists (select 1 from public.cocina_pasta_recetas where pasta_id = v_id)
    or exists (select 1 from public.almacen_pedidos where producto_id = v_id)
    or exists (select 1 from public.cocina_pizarron_items where destino_producto_id = v_id)
    then
      raise exception 'El producto "relleno" tiene referencias. NO se borra: revisalo a mano.';
    end if;

    delete from public.cocina_productos where id = v_id;
    get diagnostics v_filas = row_count;
    if v_filas <> 1 then
      raise exception 'Esperaba borrar 1 producto y borré %.', v_filas;
    end if;
  end if;

  -- ── 2) Que no quede ningún valor fuera de los siete ───────────────────────
  select count(*) into v_filas from public.cocina_productos
   where tipo not in ('pasta','salsa','postre','masa','panificado','milanesa','bebida');
  if v_filas <> 0 then
    raise exception 'Hay % productos con una familia que no está en la lista de 7.', v_filas;
  end if;
end
$fix$;

-- ── 3) El renombre ───────────────────────────────────────────────────────────
-- Las dos reglas que nombran la columna se rehacen: en Postgres un `check` no
-- sigue a la columna renombrada por su nombre viejo en el texto.
alter table public.cocina_productos drop constraint if exists cocina_productos_tipo_check;
alter table public.cocina_productos drop constraint if exists cocina_productos_pasta_declara_relleno;

alter table public.cocina_productos rename column tipo to familia_stock;

alter table public.cocina_productos add constraint cocina_productos_familia_stock_check
  check (familia_stock = any (array[
    'pasta', 'salsa', 'postre', 'masa', 'panificado', 'milanesa', 'bebida'
  ]));

-- Una pasta tiene que decir si lleva relleno o no. Misma regla que antes, con
-- el nombre nuevo.
alter table public.cocina_productos add constraint cocina_productos_pasta_declara_relleno
  check (familia_stock is distinct from 'pasta' or lleva_relleno is not null);

-- ── 4) Un puente para que el salón no vea un error mientras se despliega ────
--
-- 💣 Un renombre de columna rompe al instante la app que YA está corriendo:
-- `select('id, nombre, codigo, tipo')` devuelve 400 y el QR de producción, el
-- Stock y el pizarrón quedan en blanco. Entre aplicar esto y que Vercel termine
-- de publicar el frontend nuevo pasan minutos, y a esta hora hay cocineros
-- usando las tablets.
--
-- Por eso queda un `tipo` de solo lectura, calculado, que devuelve lo mismo.
-- Las pantallas viejas siguen leyendo sin enterarse.
--
-- ⚠️ Lo que SÍ falla en esa ventana es GRABAR un producto desde la ficha de
-- Productos, porque no se puede escribir en una columna calculada. Es una
-- pantalla de escritorio que usa una persona, no la cocina.
--
-- ⏳ PENDIENTE: borrar esta columna cuando el frontend nuevo esté publicado.
--     alter table public.cocina_productos drop column tipo;
alter table public.cocina_productos
  add column tipo text generated always as (familia_stock) stored;

comment on column public.cocina_productos.tipo is
  'PUENTE TEMPORAL de la migración 209. Es familia_stock con el nombre viejo, '
  'de solo lectura, para no romper el frontend ya publicado mientras se '
  'despliega el nuevo. BORRAR cuando el deploy esté arriba.';

comment on column public.cocina_productos.familia_stock is
  'En qué sección de la cocina vive el producto: pizarrón, QR de producción y '
  'cámara. NO es la categoría comercial (esa está en cocina_recetas.categoria) '
  'ni el rol de la subreceta (cocina_recetas.rol). Un mismo valor de acá puede '
  'venir de varias categorías y de varios roles: "pasta" agrupa recetas de '
  'categoría pasta y subrecetas de rol masa y relleno.';

-- ── Guardarraíl ──────────────────────────────────────────────────────────────
do $guard$
declare
  r record;
  v_total int;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='cocina_productos'
                    and column_name='familia_stock') then
    raise exception 'GUARDARRAIL: no se creó la columna familia_stock.';
  end if;
  if exists (select 1 from public.cocina_productos where tipo is distinct from familia_stock) then
    raise exception 'GUARDARRAIL: el puente "tipo" no devuelve lo mismo que familia_stock.';
  end if;

  select count(*) into v_total from public.cocina_productos;
  if v_total <> 99 then
    raise exception 'GUARDARRAIL: esperaba 99 productos después de borrar el huérfano y hay %.', v_total;
  end if;

  for r in select familia_stock, count(*) as n from public.cocina_productos group by 1 order by 2 desc
  loop
    raise notice '  familia %  →  %', rpad(r.familia_stock, 12), r.n;
  end loop;
end
$guard$;

commit;
