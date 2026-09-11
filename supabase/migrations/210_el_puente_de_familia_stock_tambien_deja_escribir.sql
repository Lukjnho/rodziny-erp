-- 210 — El puente de `familia_stock` también tiene que dejar ESCRIBIR
--
-- ══════════════════════════════════════════════════════════════════════════════
-- ⚠️ ESTO REPARA ALGO QUE ROMPÍ HOY
-- ══════════════════════════════════════════════════════════════════════════════
--
-- La migración 209 dejó un `tipo` CALCULADO como puente, para que el frontend
-- ya publicado siguiera leyendo mientras se desplegaba el nuevo. La cuenta que
-- hice mal fue suponer que el deploy nuevo llegaba en minutos.
--
-- No llega: Vercel publica `main`, y el código que acompaña a la 209 está en la
-- rama `fix/entrada-montos`, con 49 commits sin mergear. O sea que producción va
-- a seguir escribiendo `tipo` hasta que alguien haga el merge, y en una columna
-- calculada no se puede escribir. Roto desde la 209, medido:
--
--   ProductoFormPanel  → guardar un producto desde la ficha de Productos
--   RecetaEditorInline → crear el producto de stock desde una receta
--
-- Las LECTURAS nunca se rompieron: para eso estaba el puente.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- CÓMO SE REPARA
-- ══════════════════════════════════════════════════════════════════════════════
--
-- El puente pasa a ser una columna de verdad con un disparador que mantiene las
-- dos en el mismo valor, escriba quien escriba:
--
--   el código viejo manda `tipo`          → se copia a `familia_stock`
--   el código nuevo manda `familia_stock` → se copia a `tipo`
--
-- Así las dos versiones del frontend conviven sin que ninguna se entere, que es
-- lo que la 209 tendría que haber hecho de entrada.
--
-- ⏳ SIGUE PENDIENTE, y ahora la condición es clara: borrar la columna `tipo`
--    cuando `fix/entrada-montos` esté MERGEADA A MAIN y publicada, no antes.
--      alter table public.cocina_productos drop column tipo;
--      drop trigger trg_cocina_productos_puente_familia on public.cocina_productos;
--      drop function public.cocina_productos_puente_familia();
--
-- 💣 LO QUE ESTA MIGRACIÓN **NO** PUEDE REPARAR, y necesita el merge:
--    La 208 renombró el rol `panificado` a `panificado_base`, y
--    `PlanProduccionEditor:64` de `main` filtra por el nombre viejo. El
--    desplegable de "Panadería" del plan semanal de Saavedra perdió 12 recetas
--    (sigue mostrando las 10 de `masa_panaderia` y las 16 de categoría
--    `panificado`). Eso es un literal en el código: no hay arreglo del lado de
--    la base que no sea deshacer la 208.
--
begin;

-- ── 1) De columna calculada a columna de verdad ─────────────────────────────
alter table public.cocina_productos drop column if exists tipo;
alter table public.cocina_productos add column tipo text;

update public.cocina_productos set tipo = familia_stock where tipo is distinct from familia_stock;

-- ── 2) El disparador que mantiene las dos iguales ───────────────────────────
create or replace function public.cocina_productos_puente_familia()
returns trigger
language plpgsql
as $$
begin
  -- Al insertar: gana la que vino cargada. Si vinieron las dos y no coinciden,
  -- manda `familia_stock`, que es el nombre bueno.
  if tg_op = 'insert' then
    if new.familia_stock is null and new.tipo is not null then
      new.familia_stock := new.tipo;
    end if;
    new.tipo := new.familia_stock;
    return new;
  end if;

  -- Al actualizar: se copia la que CAMBIÓ.
  if new.familia_stock is distinct from old.familia_stock then
    new.tipo := new.familia_stock;
  elsif new.tipo is distinct from old.tipo then
    new.familia_stock := new.tipo;
  else
    new.tipo := new.familia_stock;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cocina_productos_puente_familia on public.cocina_productos;
create trigger trg_cocina_productos_puente_familia
  before insert or update on public.cocina_productos
  for each row execute function public.cocina_productos_puente_familia();

comment on column public.cocina_productos.tipo is
  'PUENTE TEMPORAL (mig 209/210). Es familia_stock con el nombre viejo, '
  'sincronizado por trigger en las dos direcciones para que el frontend de main '
  'y el de fix/entrada-montos convivan. BORRAR cuando el merge esté publicado.';

-- ── Guardarraíl: las dos columnas tienen que quedar iguales ─────────────────
do $guard$
declare v_mal int;
begin
  select count(*) into v_mal from public.cocina_productos where tipo is distinct from familia_stock;
  if v_mal <> 0 then
    raise exception 'GUARDARRAIL: % productos con tipo <> familia_stock.', v_mal;
  end if;
  raise notice 'OK  las dos columnas coinciden en los % productos', (select count(*) from public.cocina_productos);
end
$guard$;

commit;
