-- 213 · Seis columnas que no lee nadie, y dos precios colgados
--
-- ⚠️ ESTA MIGRACIÓN VA DESPUÉS DEL DEPLOY, NO ANTES.
--
--   curl -s https://rodziny-erp.vercel.app/version.json   -> bacc15c  ✅
--   git rev-parse main                                    -> bacc15c  ✅
--
-- El commit bacc15c sacó `ml_por_venta` y `minutos_lote` de los `select` del
-- frontend. Si esta migración se aplicara antes, esas consultas devolverían
-- HTTP 400 y las pantallas quedarían en error — exactamente lo que pasó el
-- 11-sep con `cocina_productos.costo_empaque` (migración 204).
--
-- Cada columna se verificó por búsqueda de texto sobre todo `src/`, las
-- funciones edge y los scripts, y contra pg_depend / pg_proc / pg_indexes.

begin;

-- ── 1 · cocina_recetas.margen_seguridad_pct ────────────────────────────────
-- Un colchón POR RECETA que nunca leyó nadie: el motor usa sólo el global de
-- `configuracion.margen_seguridad_pct`. 0 referencias en el código.
-- ⚠️ No confundir con la fila de `configuracion` que se llama igual y SÍ manda.
alter table public.cocina_recetas drop column if exists margen_seguridad_pct;

-- ── 2 · cocina_recetas.minutos_lote ────────────────────────────────────────
-- 💣 Estaba en NULL en las 274 recetas activas. `useManoObra` repartía el pool
-- "ponderado por cantidad × minutos", pero como ningún minuto estaba cargado
-- el peso caía siempre al valor de respaldo: era un reparto por cantidad
-- disfrazado de ponderación por tiempo. El código ya lo dice (bacc15c).
alter table public.cocina_recetas drop column if exists minutos_lote;

-- ── 3 · cocina_productos.ml_por_venta ──────────────────────────────────────
-- Se pedía en dos `select` y no entraba en ninguna cuenta. La división de
-- ml a costo la hace `productos.contenido_ml` dentro del motor de costeo.
alter table public.cocina_productos drop column if exists ml_por_venta;

-- ── 4 · cocina_productos.tiempo_anticipacion_hs ────────────────────────────
-- Cero referencias en todo el repositorio.
alter table public.cocina_productos drop column if exists tiempo_anticipacion_hs;

-- ── 5 · productos.es_packaging ─────────────────────────────────────────────
-- 11 insumos marcados y nadie los lee. Quedó de la primera pasada del empaque,
-- antes de que el empaque pasara a ser una subreceta (migración 204).
alter table public.productos drop column if exists es_packaging;

-- ── 6 · cocina_productos.precio_venta, y sus dos disparadores ──────────────
-- Era un ESPEJO del precio del canal 'plato', escrito por
-- `trg_sync_precio_venta_salon`, que cuelga de `cocina_productos_precios_canal`
-- — la tabla VIEJA, sin una escritura desde el 28-may-2026. La tabla que se usa
-- hoy es `cocina_recetas_precios_canal` (228 filas, tocada hoy).
--
-- 💣 El espejo ya estaba mintiendo: Capeletti decía $7.400 contra $7.800 real,
-- Flan SG $6.000 contra $6.300. Nadie lo lee, así que nadie lo notó.
--
-- El historial de precios vigente es `cocina_recetas_precios_historial`
-- (migración 200). `cocina_productos_precio_historial` (59 filas) queda como
-- archivo: no se toca, sólo deja de recibir filas nuevas.
drop trigger if exists trg_sync_precio_venta_salon on public.cocina_productos_precios_canal;
drop function if exists public.sync_precio_venta_salon();
drop trigger if exists cocina_productos_precio_log on public.cocina_productos;
drop function if exists public.cocina_productos_log_precio();
alter table public.cocina_productos drop column if exists precio_venta;

-- ── 7 · Dos precios de canal sobre SUBRECETAS ──────────────────────────────
-- Una subreceta no se vende nunca: es un componente. Con un precio cargado
-- entra a cualquier conteo de márgenes y lo ensucia — la Tarta Vazca daba
-- −174,3 % porque su "precio" de $5.000 se comparaba contra el costo de la
-- torta entera, $10.994,59.
--
-- 📌 Se borran SÓLO estas dos, que son las únicas subrecetas con precio. Hay
-- otras 51 filas de precio sobre recetas `vendible=false` (Parisiene,
-- Scappinoc, "Tiramisú (no usar)", gaseosas…): ésas son platos jubilados del
-- menú que conservaron su precio, otro caso y otra decisión.
do $$
declare v_n int;
begin
  delete from public.cocina_recetas_precios_canal pc
   using public.cocina_recetas r
   where r.id = pc.receta_id
     and r.tipo = 'subreceta';
  get diagnostics v_n = row_count;
  if v_n <> 2 then
    raise exception 'PARAR: se esperaban 2 precios de subreceta y se borraron %.', v_n;
  end if;
  raise notice 'OK: 2 precios de canal sobre subrecetas borrados.';
end $$;

-- ── Guardarraíl: las seis se fueron y no se llevaron nada puesto ───────────
do $$
declare v_quedan int; v_recetas int; v_productos int; v_insumos int;
begin
  select count(*) into v_quedan from information_schema.columns
   where table_schema='public' and (
     (table_name='cocina_recetas'   and column_name in ('margen_seguridad_pct','minutos_lote')) or
     (table_name='cocina_productos' and column_name in ('ml_por_venta','tiempo_anticipacion_hs','precio_venta')) or
     (table_name='productos'        and column_name = 'es_packaging'));
  if v_quedan <> 0 then
    raise exception 'PARAR: quedaron % columnas sin borrar.', v_quedan;
  end if;

  -- La columna que SÍ manda tiene que seguir donde estaba.
  if not exists (select 1 from public.configuracion where clave='margen_seguridad_pct') then
    raise exception 'PARAR: desapareció el colchón global de configuracion.';
  end if;

  select count(*) into v_recetas   from public.cocina_recetas   where activo;
  select count(*) into v_productos from public.cocina_productos where activo;
  select count(*) into v_insumos   from public.productos        where activo;
  raise notice 'OK: % recetas, % productos y % insumos activos, intactos.',
    v_recetas, v_productos, v_insumos;
end $$;

commit;
