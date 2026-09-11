-- 211 · El puente de familia_stock se retira
--
-- La 209 renombró cocina_productos.tipo a familia_stock. La 210 tuvo que dejar
-- `tipo` como columna real con un disparador que sincronizaba en las dos
-- direcciones, porque el código publicado todavía escribía el nombre viejo.
--
-- Hoy (11-sep-2026) el merge a main está publicado y verificado:
--
--   curl -s https://rodziny-erp.vercel.app/version.json   -> 3bbcb6d
--   git rev-parse main                                    -> 3bbcb6d
--
-- Y se verificó contra el JS PUBLICADO, no contra el repo:
--   · el objeto que guarda un producto manda `familia_stock`, no `tipo`
--   · los tres select de cocina_productos piden `familia_stock`
--   · ninguna función edge toca la tabla
--   · ninguna vista, índice ni RPC depende de la columna `tipo`
--     (`recalcular_pizarron_pasta_simple` filtra el `tipo` de
--      cocina_pizarron_items, que es otra tabla — revisado renglón por renglón)
--
-- Ya se puede retirar el puente.

begin;

-- Guardarraíl 1: nadie puede quedar sin familia_stock.
do $$
declare v_sin int;
begin
  select count(*) into v_sin from public.cocina_productos where familia_stock is null;
  if v_sin > 0 then
    raise exception 'PARAR: % productos sin familia_stock. El puente no se retira.', v_sin;
  end if;
end $$;

-- Guardarraíl 2: las dos columnas tienen que decir lo mismo. Si alguna fila
-- difiere, es que algo escribió `tipo` sin pasar por el disparador y perderíamos
-- ese dato al borrar.
do $$
declare v_dif int;
begin
  select count(*) into v_dif
    from public.cocina_productos
   where tipo is distinct from familia_stock;
  if v_dif > 0 then
    raise exception 'PARAR: % filas con tipo <> familia_stock. Revisar antes de borrar.', v_dif;
  end if;
end $$;

drop trigger if exists trg_cocina_productos_puente_familia on public.cocina_productos;
drop function if exists public.cocina_productos_puente_familia();

alter table public.cocina_productos drop column if exists tipo;

-- Guardarraíl 3: la columna se fue y familia_stock quedó entera.
do $$
declare v_quedo int; v_filas int;
begin
  select count(*) into v_quedo
    from information_schema.columns
   where table_schema='public' and table_name='cocina_productos' and column_name='tipo';
  if v_quedo <> 0 then
    raise exception 'PARAR: la columna tipo sigue ahí.';
  end if;

  select count(*) into v_filas
    from public.cocina_productos where familia_stock is not null;
  raise notice 'OK: puente retirado. % productos con familia_stock.', v_filas;
end $$;

commit;
