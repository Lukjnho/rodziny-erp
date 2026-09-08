-- ============================================================================
-- 192 — EL PRECIO LO PONE LA CARTA, NO EL NAVEGADOR
-- ============================================================================
--
-- QUÉ PASA HOY
-- ------------
-- La migración 189 dejó el cobro hecho una sola transacción y le puso seis
-- candados. Uno quedó afuera a propósito, y es el más caro: **el precio lo sigue
-- mandando el navegador**. La base lo acepta tal cual.
--
-- O sea: un cajero con la consola del navegador abierta cobra un Ragú a $1, el
-- ticket queda guardado a $1, y **el arqueo cierra perfecto** — porque lo que
-- "tendría que haber en el cajón" se calcula sumando los cobros de esos mismos
-- tickets. La plata que falta no aparece por ningún lado: no hay diferencia, no
-- hay alerta, no hay nada que mirar. Es el agujero más silencioso que queda en
-- la caja.
--
--
-- LA REGLA, EN CRIOLLO
-- --------------------
-- Cada renglón que cobra el POS tiene que salir al precio que dice la carta de
-- ESA casa, en la lista que corresponda. Si no coincide, no se cobra.
--
-- Decidido con Lucas el 8-sep-2026: cuando el precio de la pantalla no coincide
-- con el de la carta, la caja **FRENA y pide refrescar**. NO cobra el precio
-- bueno por atrás.
--
-- Por qué, que es lo importante: si la base cobrara el precio de la carta sin
-- avisar, la pantalla le mostraría $7.500 al cliente, el cajero recibiría $7.500
-- en la mano, y el ticket quedaría guardado a $8.000. Al cierre **faltarían $500
-- en el cajón** y nadie sabría por qué. Frenar cuesta diez segundos las pocas
-- veces que pasa; lo otro ensucia el arqueo para siempre.
--
--
-- POR QUÉ VA COMO CANDADO DE LA TABLA Y NO ADENTRO DE `cobrar_venta`
-- ------------------------------------------------------------------
-- Lo natural sería meter el chequeo adentro de la función. NO se hace, por dos
-- razones:
--   1. `cobrar_venta` tiene ~500 líneas y se revisó con doce agentes antes de
--      aplicarla. Reescribirla entera para agregarle veinte líneas es la forma
--      más fácil de romper algo que hoy anda.
--   2. Un candado en la tabla vale para TODOS los caminos, no sólo para la caja.
--      El salón (mig 190) va a escribir renglones también, y no hay que
--      acordarse de repetir la validación allá.
--
-- 💣 El disparador se llama con una `z` a propósito: los disparadores de una
-- tabla corren en ORDEN ALFABÉTICO, y este tiene que correr DESPUÉS de
-- `trg_ventas_items_vincular`, que es el que completa `receta_id` cuando el
-- renglón llega sin enganchar.
--
--
-- DE QUÉ LISTA DE PRECIOS SE TRATA
-- --------------------------------
-- El mostrador cobra con la lista `plato`. El salón, cuando exista, puede querer
-- otra (mismo plato, otro precio en la mesa). Así que el canal NO va escrito a
-- mano: va en una tablita, igual que el interruptor de Fudo de la migración 188.
-- El día que el salón quiera su propia lista es un renglón, sin deploy:
--
--     update public.caja_canal_precio set canal = 'mesa' where tipo_venta = 'salon';
--
--
-- LO QUE ESTE CANDADO TAPA DE PASO
-- --------------------------------
--   * Que se cobre una receta de LA OTRA CASA. La migración 187 dejó el catálogo
--     compartido a propósito (el cajero de Saavedra puede leer la carta de
--     Vedia); acá se cierra por el lado que importa, que es el de la plata.
--   * Que se cobre algo dado de baja o no vendible.
--   * Que se cobre un `cocina_producto` suelto: hoy el catálogo del POS ni los
--     lee ("sus precios son copias viejas"), así que no hay con qué comparar.
--     Cero de los renglones del POS que existen hoy son de ese tipo.
--
-- LO QUE NO TAPA, a propósito:
--   * El **descuento a mano por renglón** (0 a 100%) sigue libre: la pantalla lo
--     permite y es una decisión de Lucas. Este candado mira el precio de lista,
--     no lo que se bonifica.
--   * Los renglones importados de Fudo (`origen = 'fudo'`) pasan de largo: son
--     historia, no se cobran acá.
--   * Un ADMINISTRADOR corrigiendo un renglón viejo (UPDATE) no queda trabado:
--     el candado es sólo al CARGAR. Al cajero no le sirve, porque desde la 151
--     no puede editar ni borrar ventas.
--
--
-- CÓMO ENTRA HOY
-- --------------
-- Comprobado contra producción antes de escribir esto:
--   * Las **160 recetas vendibles y activas tienen precio de mostrador** cargado:
--     ninguna se queda afuera.
--   * Las salsas tienen precio propio (Bolognesa $8.500, Crema Blanca $4.200),
--     no van colgadas a $0 de la pasta. Era el riesgo grande de este diseño: si
--     hubieran ido en cero, este candado rechazaba toda venta con salsa.
--   * Los 4 renglones que el POS cobró en su vida son todos de receta y sus
--     precios coinciden con la carta. El chequeo del final lo verifica.
--
-- Contexto: migración 189 (el cobro en una transacción), 187 (cada cajero ve
-- solo su casa), 188 (la regla en un renglón, no en una constante).
-- ============================================================================


-- ── 1. Con qué lista de precios cobra cada clase de venta ──────────────────

create table if not exists public.caja_canal_precio (
  tipo_venta text primary key,
  canal      text not null
);

comment on table public.caja_canal_precio is
  'Con qué lista de precios (canal de cocina_recetas_precios_canal) cobra cada clase de venta. El mostrador usa plato; el salón puede querer otra. Cambiarlo es un update, sin deploy.';

insert into public.caja_canal_precio (tipo_venta, canal) values
  ('mostrador', 'plato'),
  ('salon',     'plato')
on conflict (tipo_venta) do nothing;

alter table public.caja_canal_precio enable row level security;

-- Leerla la tiene que poder cualquiera con sesión: el disparador la consulta con
-- los permisos del cajero. Si no la puede leer, la caja no cobra.
drop policy if exists caja_canal_precio_ver on public.caja_canal_precio;
create policy caja_canal_precio_ver on public.caja_canal_precio
  for select to authenticated
  using (true);

drop policy if exists caja_canal_precio_admin on public.caja_canal_precio;
create policy caja_canal_precio_admin on public.caja_canal_precio
  for all to authenticated
  using ((select public.es_admin()))
  with check ((select public.es_admin()));

revoke all on public.caja_canal_precio from public, anon;
grant select, insert, update, delete on public.caja_canal_precio to authenticated;
grant all on public.caja_canal_precio to service_role;

-- El disparador arma sus carteles con este ayudante de la 189. El importador de
-- Fudo corre con service_role y sale antes de llegar acá, pero si algún día
-- escribiera renglones del POS, que no se caiga por un permiso.
grant execute on function public.pesos_criollo(numeric) to service_role;


-- ── 2. El candado ──────────────────────────────────────────────────────────

create or replace function public.trg_ventas_items_precio_de_la_carta()
returns trigger
language plpgsql
set search_path to 'public'
as $precio$
declare
  v_canal  text;
  v_precio numeric;
begin
  -- Sólo las ventas nuestras. Lo importado de Fudo es historia.
  if new.origen is distinct from 'pos' then
    return new;
  end if;

  select cp.canal
    into v_canal
    from public.ventas_tickets t
    join public.caja_canal_precio cp on cp.tipo_venta = t.tipo_venta
   where t.id = new.ticket_id;

  if v_canal is null then
    raise exception 'No sé con qué lista de precios cobrar "%". Avisale a administración: falta configurar el canal de precios de esta clase de venta.',
      new.nombre;
  end if;

  if new.receta_id is null then
    raise exception '"%" no está enganchado a ningún plato de la carta, así que no tiene precio con qué compararse. Salí y volvé a entrar a la caja para refrescar la carta.',
      new.nombre;
  end if;

  select pc.precio
    into v_precio
    from public.cocina_recetas_precios_canal pc
    join public.cocina_recetas r on r.id = pc.receta_id
   where pc.receta_id = new.receta_id
     and pc.canal     = v_canal
     and r.local      = new.local      -- que sea de ESTA casa
     and r.vendible
     and r.activo
     and pc.precio > 0;

  if v_precio is null then
    raise exception '"%" no tiene precio cargado en la carta de % (lista "%"), o está dado de baja. Cargalo en Productos y volvé a cobrar.',
      new.nombre, new.local, v_canal;
  end if;

  if round(coalesce(new.precio_unitario, -1), 2) <> round(v_precio, 2) then
    raise exception '"%" está a % en la carta y la pantalla dice %. Salí y volvé a entrar a la caja para refrescar la carta, y cobrá de nuevo.',
      new.nombre,
      public.pesos_criollo(v_precio),
      public.pesos_criollo(coalesce(new.precio_unitario, 0));
  end if;

  return new;
end;
$precio$;

comment on function public.trg_ventas_items_precio_de_la_carta() is
  'Candado de la migración 192: un renglón del POS sólo entra al precio que dice la carta de su local, en la lista que corresponda a esa clase de venta. Frena, no corrige: si corrigiera por atrás, el cajero cobraría un importe y el ticket guardaría otro, y al cierre faltaría plata sin explicación.';

-- La `z` del nombre no es un capricho: hace que corra DESPUÉS de
-- trg_ventas_items_vincular, que es el que completa receta_id.
drop trigger if exists trg_ventas_items_z_precio_de_la_carta on public.ventas_items;
create trigger trg_ventas_items_z_precio_de_la_carta
  before insert on public.ventas_items
  for each row execute function public.trg_ventas_items_precio_de_la_carta();


-- ── 3. Chequeo: si algo de esto no quedó, la migración se cae acá ──────────

do $guard$
declare
  v_canales int;
  v_mal     int;
  v_nombre  text;
begin
  select count(*) into v_canales from public.caja_canal_precio;
  if v_canales < 2 then
    raise exception 'GUARDA: caja_canal_precio quedó con % renglones, esperaba mostrador y salon', v_canales;
  end if;

  if not exists (
    select 1 from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'ventas_items'
       and t.tgname = 'trg_ventas_items_z_precio_de_la_carta'
  ) then
    raise exception 'GUARDA: no quedó puesto el disparador del precio en ventas_items';
  end if;

  -- Que corra DESPUÉS del que engancha la receta (orden alfabético).
  if 'trg_ventas_items_z_precio_de_la_carta' < 'trg_ventas_items_vincular' then
    raise exception 'GUARDA: el disparador del precio correría ANTES del que engancha la receta';
  end if;

  if has_table_privilege('anon', 'public.caja_canal_precio', 'SELECT') then
    raise exception 'GUARDA: caja_canal_precio quedó legible con la clave pública';
  end if;
  if not has_table_privilege('authenticated', 'public.caja_canal_precio', 'SELECT') then
    raise exception 'GUARDA: un usuario con sesión no puede leer caja_canal_precio, y sin eso la caja no cobra';
  end if;

  -- LO QUE MÁS IMPORTA: los renglones del POS que YA existen tienen que cumplir
  -- la regla nueva. Si alguno no la cumple, la regla no describe la realidad y
  -- mañana la caja rechaza ventas buenas.
  select count(*), min(i.nombre)
    into v_mal, v_nombre
    from public.ventas_items i
    join public.ventas_tickets t on t.id = i.ticket_id
    join public.caja_canal_precio cp on cp.tipo_venta = t.tipo_venta
   where i.origen = 'pos'
     and not exists (
       select 1
         from public.cocina_recetas_precios_canal pc
         join public.cocina_recetas r on r.id = pc.receta_id
        where pc.receta_id = i.receta_id
          and pc.canal     = cp.canal
          and r.local      = i.local
          and r.vendible and r.activo
          and round(pc.precio, 2) = round(i.precio_unitario, 2)
     );

  if v_mal > 0 then
    raise exception 'GUARDA: % renglones del POS que ya existen NO cumplen la regla nueva (por ejemplo "%"). Revisar antes de dejar esto puesto.', v_mal, v_nombre;
  end if;

  raise notice 'OK 192: % clases de venta configuradas · los renglones del POS que existen cumplen la regla', v_canales;
end;
$guard$;
