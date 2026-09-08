-- ============================================================================
-- 190 — LAS MESAS DEL SALÓN (Saavedra)
-- ============================================================================
--
-- QUÉ ES ESTO
-- -----------
-- El piso del salón de Saavedra: dónde vive una mesa abierta, quién la puede
-- tocar y por qué puerta. NO trae pantalla: eso es el paso siguiente. Acá está
-- la base, que es lo que no se puede corregir después sin dolor.
--
--
-- 🔑 LA DECISIÓN DE FONDO: UNA MESA ABIERTA **NO** ES UNA VENTA A MEDIO HACER
-- ---------------------------------------------------------------------------
-- Lo obvio sería guardar la mesa como un ticket abierto en `ventas_tickets` y
-- listo. Está MAL, por tres razones concretas, cada una medida contra este ERP:
--
--   1. **Cocina cuenta `ventas_items` sin filtrar estado ni origen**, a propósito
--      (mig 184). Una mesa abierta ahí le descontaría la pasta a la cámara ANTES
--      de servirla, y una mesa que alguien se olvida de cerrar se la descontaría
--      para siempre. El conteo de cámara de Saavedra empezaría a marcar
--      faltantes todas las noches.
--   2. **El cajero no tiene UPDATE sobre ventas_tickets/items/pagos** (mig 151),
--      justamente para que no pueda mutilar una venta antes del arqueo. Una mesa
--      que se edita veinte veces durante la cena necesita todo lo contrario.
--   3. **`cierre_caja_id` se escribe una sola vez.** Una mesa que empieza en el
--      turno del mediodía y se cobra en el de la noche rompería el arqueo de los
--      dos.
--
-- Por eso la mesa vive acá, en tablas propias, y **recién al cobrar** se vuelca
-- de un saque a `ventas_tickets` + `ventas_items` + `ventas_pagos`. Hasta ese
-- momento, para el resto del ERP, la mesa no existe.
--
--
-- LO QUE DECIDIÓ LUCAS (8-sep-2026)
-- ---------------------------------
--   * **El mozo marca "piden la cuenta".** La mesa cambia de estado y aparece
--     avisada en el mostrador. Queda la hora, así se puede mirar cuánto tarda una
--     mesa desde que pide hasta que paga.
--   * **Un plato ya mandado a la cocina se puede sacar, pero queda anotado**:
--     quién lo sacó, cuándo y de qué mesa. No se borra el renglón — se marca.
--     Es plata: si el plato ya se cocinó, alguien lo comió o se tiró.
--   * **El plano lo armamos nosotros.** Dar de alta un espacio o una mesa,
--     numerarla, moverla o cambiarle la forma es cosa de administración: el mozo
--     y el cajero solo las VEN. Por eso `caja_salas` y `caja_mesas` no tienen
--     puerta de escritura para ellos, ni siquiera una custodiada por función.
--
-- Y de antes (6 y 7-sep):
--   * El mozo entra **con su propio usuario** desde el teléfono, no con un PIN.
--     El permiso `puede_ver_salon` ya existe en `perfiles` (lo dejó la mig 187).
--   * **Se cobra en la compu del mostrador**, no en el teléfono.
--   * El **número de mesa es TEXTO**, nunca un contador: el Salón salta del 13
--     al 24.
--   * Los espacios son **Salón** y **Vereda**. En pantalla se dicen "espacios":
--     💣 "Salón" ya significa otra cosa en el ERP (es el canal de precio de la
--     mig 062), por eso las tablas se llaman `caja_salas` / `caja_mesas`.
--
--
-- 💣 NADIE ESCRIBE DERECHO: SOLO POR FUNCIÓN
-- -------------------------------------------
-- Mismo candado que la mig 189, que ya está probado en producción: las reglas de
-- escritura exigen que la sesión esté marcada con `rodziny.salon = 'si'`, y esa
-- marca **la ponen únicamente las funciones de acá abajo**. Sin eso, un mozo con
-- la consola del navegador abierta se saltea todas las validaciones: se agrega
-- platos a $0, se saca renglones sin dejar rastro, o abre una mesa en Vedia.
--
-- ⚠️ Y por la misma razón que la 189: **las funciones NO son `security definer`**.
-- Son de `postgres`, que tiene `rolbypassrls`, así que definer apagaría la RLS de
-- TODA la base y borraría la frontera de local de la mig 187. Con invoker, la RLS
-- sigue viva adentro de la función.
-- ⚠️ Vuelta atrás si algo de esto sale mal: sacar el pedazo del
-- `current_setting('rodziny.salon', true) = 'si'` de las políticas de escritura.
--
--
-- POR QUÉ EL `local` ESTÁ REPETIDO EN TODAS LAS TABLAS
-- ----------------------------------------------------
-- Se podría deducir subiendo por mesa → sala. NO se hace: la lección de la mig
-- 157 y la 187 es que un filtro de fila tiene que ser una **comparación de
-- columna pelada**. En cuanto hay que salir a buscarlo a otra tabla, Postgres lo
-- resuelve fila por fila (medido: 217 ms contra 2.246 ms). El `local` viaja
-- repetido y un disparador se encarga de que no se despegue del de la mesa.
--
--
-- POR QUÉ EL TICKET SE ANOTA EN EL RENGLÓN Y NO EN LA SESIÓN
-- ----------------------------------------------------------
-- Una sesión puede terminar en VARIOS tickets: el día que se divida la cuenta,
-- cada renglón se va con el ticket que lo pagó. Si el vínculo estuviera en la
-- sesión, dividir la cuenta exigiría rehacer el esquema. Dividir NO entra en la
-- v1, pero el esquema no lo tranca.
--
-- 🔑 Y de acá sale el arreglo del conteo de cámara (paso 10): lo que todavía no
-- se cobró es **`ticket_id is null`**, NO "la sesión está abierta". Con la cuenta
-- dividida la sesión sigue abierta con renglones ya cobrados, y contarlos por
-- sesión los contaría dos veces.
--
--
-- LO QUE ESTA MIGRACIÓN NO HACE (a propósito)
-- --------------------------------------------
--   * **No cobra.** `salon_cobrar_mesa` va en la migración siguiente, junto con
--     la pantalla del mostrador.
--     ⚠️ Y ahí hay que resolver algo que acá queda anotado y sin resolver: si
--     alguien **cambia un precio mientras la mesa está abierta**, el renglón
--     guarda el precio con el que se lo vendió al cliente, pero el candado de la
--     mig 192 compara contra la carta de ESE momento y va a rechazar el cobro.
--     Mientras tanto la regla es de sentido común: **no se tocan precios con el
--     salón abierto**.
--   * No junta ni muda mesas, no divide la cuenta, no maneja propinas ni
--     cubierto, no reserva, y no imprime la comanda (paso 9: 💣 el teléfono NO
--     puede imprimir, tiene que hacerlo una PC).
--   * No toca el mostrador de Vedia.
--
-- Contexto: [[salon-saavedra-mesas-diseno]], migraciones 187 (frontera de local),
-- 189 (el cobro en una transacción y la marca de sesión), 192 (el precio lo pone
-- la carta).
-- ============================================================================


-- ── 1. Los espacios y las mesas ────────────────────────────────────────────

create table if not exists public.caja_salas (
  id     uuid primary key default gen_random_uuid(),
  local  text not null,
  nombre text not null,
  orden  int  not null default 0,
  activo boolean not null default true,
  unique (local, nombre)
);

comment on table public.caja_salas is
  'Los espacios del local: Salón, Vereda. Se dicen "espacios" en pantalla porque "salón" ya es el canal de precio de la mig 062.';

create table if not exists public.caja_mesas (
  id        uuid primary key default gen_random_uuid(),
  local     text not null,
  sala_id   uuid not null references public.caja_salas(id) on delete restrict,
  numero    text not null,
  capacidad int,
  forma     text not null default 'rectangular' check (forma in ('rectangular', 'redonda')),
  pos_x     numeric not null default 0,
  pos_y     numeric not null default 0,
  ancho     numeric not null default 1 check (ancho > 0),
  alto      numeric not null default 1 check (alto  > 0),
  activo    boolean not null default true,
  unique (sala_id, numero)
);

comment on column public.caja_mesas.numero is
  'TEXTO, nunca un contador: el Salón de Saavedra salta del 13 al 24.';
comment on column public.caja_mesas.pos_x is
  'Dónde cae la mesa en el plano de la pantalla. Con ancho/alto/forma es lo que deja "hacerla rectangular".';

create index if not exists idx_caja_mesas_local on public.caja_mesas (local, activo);


-- ── 2. La sesión: una mesa ocupada, de cuando se sienta a cuando paga ──────

create table if not exists public.caja_mesa_sesiones (
  id                uuid primary key default gen_random_uuid(),
  local             text not null,
  mesa_id           uuid not null references public.caja_mesas(id) on delete restrict,
  comensales        int  not null check (comensales > 0),
  estado            text not null default 'abierta'
                    check (estado in ('abierta', 'cuenta_pedida', 'cobrada', 'anulada')),
  abierta_en        timestamptz not null default now(),
  abierta_por       uuid references auth.users(id) on delete set null,
  cuenta_pedida_en  timestamptz,
  cuenta_pedida_por uuid references auth.users(id) on delete set null,
  cerrada_en        timestamptz,
  anulada_motivo    text,
  nota              text
);

comment on table public.caja_mesa_sesiones is
  'Una mesa ocupada, de cuando se sientan a cuando pagan. NO es una venta: la venta nace recién al cobrar.';
comment on column public.caja_mesa_sesiones.comensales is
  'Cuánta gente se sentó. Lo pidió Lucas para poder mirar el ticket promedio por persona, no solo por mesa.';

-- Una mesa no puede estar ocupada dos veces a la vez.
create unique index if not exists idx_caja_sesion_una_por_mesa
  on public.caja_mesa_sesiones (mesa_id)
  where estado in ('abierta', 'cuenta_pedida');

create index if not exists idx_caja_sesiones_local
  on public.caja_mesa_sesiones (local, estado);


-- ── 3. Los envíos a la cocina (cada tanda es una comanda) ──────────────────

create table if not exists public.caja_mesa_envios (
  id          uuid primary key default gen_random_uuid(),
  local       text not null,
  sesion_id   uuid not null references public.caja_mesa_sesiones(id) on delete restrict,
  numero      int  not null,
  enviado_en  timestamptz not null default now(),
  enviado_por uuid references auth.users(id) on delete set null,
  impreso_en  timestamptz,
  unique (sesion_id, numero)
);

comment on table public.caja_mesa_envios is
  'Cada tanda que el mozo manda a la cocina. `impreso_en` en null = la comanda todavía no salió en papel; de ahí come la cola de impresión del paso 9.';


-- ── 4. Los renglones ───────────────────────────────────────────────────────

create table if not exists public.caja_mesa_lineas (
  id              uuid primary key default gen_random_uuid(),
  local           text not null,
  sesion_id       uuid not null references public.caja_mesa_sesiones(id) on delete restrict,
  envio_id        uuid references public.caja_mesa_envios(id) on delete restrict,
  padre_id        uuid references public.caja_mesa_lineas(id) on delete restrict,
  linea           int  not null,
  receta_id       uuid not null references public.cocina_recetas(id) on delete restrict,
  nombre          text not null,
  categoria       text,
  cantidad        numeric not null check (cantidad > 0),
  precio_unitario numeric not null check (precio_unitario >= 0),
  descuento_pct   numeric not null default 0 check (descuento_pct >= 0 and descuento_pct <= 100),
  estado          text not null default 'activa' check (estado in ('activa', 'sacada')),
  sacada_en       timestamptz,
  sacada_por      uuid references auth.users(id) on delete set null,
  sacada_motivo   text,
  ticket_id       uuid references public.ventas_tickets(id) on delete set null,
  agregada_en     timestamptz not null default now(),
  agregada_por    uuid references auth.users(id) on delete set null,
  unique (sesion_id, linea)
);

comment on column public.caja_mesa_lineas.envio_id is
  'null = todavía está en el borrador del mozo, la cocina no lo vio. Con envío = ya salió la comanda.';
comment on column public.caja_mesa_lineas.ticket_id is
  'Qué ticket se llevó este renglón. null = sin cobrar. ESTE es el filtro del conteo de cámara (paso 10), NO "la sesión está abierta": con la cuenta dividida la sesión sigue abierta con renglones ya cobrados.';
comment on column public.caja_mesa_lineas.precio_unitario is
  'El precio con el que se le vendió al cliente, congelado al agregarlo. Lo pone la BASE leyendo la carta, nunca el teléfono.';

create index if not exists idx_caja_lineas_sesion on public.caja_mesa_lineas (sesion_id);
create index if not exists idx_caja_lineas_sin_cobrar
  on public.caja_mesa_lineas (local, receta_id) where ticket_id is null and estado = 'activa';


-- ── 5. Que el `local` no se despegue del de la mesa ────────────────────────

create or replace function public.caja_salon_sella_local()
returns trigger
language plpgsql
set search_path to 'public'
as $sella$
declare
  v_local text;
begin
  if tg_table_name = 'caja_mesas' then
    select s.local into v_local from public.caja_salas s where s.id = new.sala_id;
  elsif tg_table_name = 'caja_mesa_sesiones' then
    select m.local into v_local from public.caja_mesas m where m.id = new.mesa_id;
  else
    select se.local into v_local from public.caja_mesa_sesiones se where se.id = new.sesion_id;
  end if;

  if v_local is null then
    raise exception 'No encuentro a qué casa pertenece esto. Cerrá la pantalla, volvé a entrar y probá de nuevo.';
  end if;

  new.local := v_local;
  return new;
end;
$sella$;

comment on function public.caja_salon_sella_local() is
  'El local de una mesa, una sesión o un renglón sale SIEMPRE de arriba, nunca de lo que mande la pantalla. El campo está repetido para que las reglas de fila puedan compararlo pelado (mig 187).';

drop trigger if exists trg_caja_mesas_local on public.caja_mesas;
create trigger trg_caja_mesas_local before insert or update on public.caja_mesas
  for each row execute function public.caja_salon_sella_local();

drop trigger if exists trg_caja_sesiones_local on public.caja_mesa_sesiones;
create trigger trg_caja_sesiones_local before insert or update on public.caja_mesa_sesiones
  for each row execute function public.caja_salon_sella_local();

drop trigger if exists trg_caja_envios_local on public.caja_mesa_envios;
create trigger trg_caja_envios_local before insert or update on public.caja_mesa_envios
  for each row execute function public.caja_salon_sella_local();

drop trigger if exists trg_caja_lineas_local on public.caja_mesa_lineas;
create trigger trg_caja_lineas_local before insert or update on public.caja_mesa_lineas
  for each row execute function public.caja_salon_sella_local();


-- ── 6. Quién puede mirar y quién puede tocar ───────────────────────────────

alter table public.caja_salas         enable row level security;
alter table public.caja_mesas         enable row level security;
alter table public.caja_mesa_sesiones enable row level security;
alter table public.caja_mesa_envios   enable row level security;
alter table public.caja_mesa_lineas   enable row level security;

-- 🔑 Decisión de Lucas (8-sep-2026): **el plano lo armamos nosotros.** Los
-- espacios y las mesas —darlas de alta, numerarlas, moverlas, hacerlas
-- rectangulares— los toca SOLO administración. El mozo y el cajero las VEN y
-- nada más. Por eso `caja_salas` y `caja_mesas` no tienen regla de escritura por
-- función: no hay puerta para ellos, ni siquiera una custodiada.
--
-- Las otras tres (sesiones, envíos, renglones) son la operación del servicio: ahí
-- sí escribe el mozo, y solo por función.

do $reglas$
declare
  t text;
  -- Ver: el mozo (salón) y el cajero (que es el que cobra la mesa), cada uno en
  -- su casa. Administración sin local ve todo, como en el resto del ERP.
  ver text := '((select public.tiene_permiso(''salon'')) or (select public.tiene_permiso(''caja'')))'
              || ' and ((select public.mi_local()) is null or local = (select public.mi_local())'
              || ' or (select public.es_admin()))';
  -- Escribir: SOLO por función. La marca la ponen las funciones de abajo.
  esc text := '(select public.tiene_permiso(''salon'')) and coalesce(current_setting(''rodziny.salon'', true), '''') = ''si'''
              || ' and ((select public.mi_local()) is null or local = (select public.mi_local())'
              || ' or (select public.es_admin()))';
begin
  -- Todas: mirar el plano y el estado de las mesas.
  foreach t in array array['caja_salas', 'caja_mesas', 'caja_mesa_sesiones',
                           'caja_mesa_envios', 'caja_mesa_lineas'] loop
    execute format('drop policy if exists %I on public.%I', t || '_ver', t);
    execute format('create policy %I on public.%I for select to authenticated using (%s)', t || '_ver', t, ver);

    -- Administración hace lo que haga falta: armar el plano, corregir una mesa
    -- cargada mal, mover una de espacio.
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for all to authenticated using ((select public.es_admin())) with check ((select public.es_admin()))', t || '_admin', t);

    execute format('revoke all on public.%I from public, anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;

  -- Solo la operación del servicio: el mozo escribe, y nada más que por función.
  foreach t in array array['caja_mesa_sesiones', 'caja_mesa_envios', 'caja_mesa_lineas'] loop
    execute format('drop policy if exists %I on public.%I', t || '_escribir', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (%s)', t || '_escribir', t, esc);

    execute format('drop policy if exists %I on public.%I', t || '_editar', t);
    execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', t || '_editar', t, esc, esc);
  end loop;

  -- Y que quede dicho: si alguna vez alguien agrega una regla de escritura a
  -- salas o mesas, el chequeo del final de esta migración lo va a frenar.
  foreach t in array array['caja_salas', 'caja_mesas'] loop
    execute format('drop policy if exists %I on public.%I', t || '_escribir', t);
    execute format('drop policy if exists %I on public.%I', t || '_editar', t);
  end loop;
end;
$reglas$;


-- ── 7. Las funciones: la única puerta ──────────────────────────────────────

-- Abrir una mesa.
create or replace function public.salon_abrir_mesa(
  p_mesa_id    uuid,
  p_comensales int
) returns uuid
language plpgsql
set search_path to 'public'
as $abrir$
declare
  v_sesion uuid;
begin
  if p_comensales is null or p_comensales < 1 then
    raise exception 'Decime cuánta gente se sentó en la mesa.';
  end if;

  if not exists (select 1 from public.caja_mesas m where m.id = p_mesa_id and m.activo) then
    raise exception 'Esa mesa no existe o está dada de baja. Refrescá el plano del salón.';
  end if;

  perform set_config('rodziny.salon', 'si', true);

  insert into public.caja_mesa_sesiones (local, mesa_id, comensales, abierta_por)
  values ('x', p_mesa_id, p_comensales, auth.uid())   -- el local lo sella el disparador
  returning id into v_sesion;

  perform set_config('rodziny.salon', '', true);
  return v_sesion;
exception
  when unique_violation then
    raise exception 'Esa mesa ya está ocupada. Refrescá el plano: puede haberla abierto otro mozo.';
end;
$abrir$;

-- Agregar un plato al borrador de la mesa. El PRECIO lo pone la carta.
create or replace function public.salon_agregar_linea(
  p_sesion_id     uuid,
  p_receta_id     uuid,
  p_cantidad      numeric,
  p_padre_id      uuid    default null,
  p_descuento_pct numeric default 0
) returns uuid
language plpgsql
set search_path to 'public'
as $agregar$
declare
  v_local   text;
  v_estado  text;
  v_canal   text;
  v_precio  numeric;
  v_nombre  text;
  v_categ   text;
  v_linea   int;
  v_id      uuid;
begin
  select se.local, se.estado into v_local, v_estado
    from public.caja_mesa_sesiones se where se.id = p_sesion_id;

  if v_local is null then
    raise exception 'Esa mesa no existe. Refrescá el plano del salón.';
  end if;
  if v_estado <> 'abierta' then
    raise exception 'La mesa ya no admite platos nuevos (está %). Si hace falta, que la reabran desde el mostrador.', v_estado;
  end if;
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'La cantidad tiene que ser mayor que cero.';
  end if;
  if p_descuento_pct is null or p_descuento_pct < 0 or p_descuento_pct > 100 then
    raise exception 'El descuento va de 0 a 100 por ciento.';
  end if;

  select cp.canal into v_canal from public.caja_canal_precio cp where cp.tipo_venta = 'salon';
  if v_canal is null then
    raise exception 'Falta configurar con qué lista de precios cobra el salón. Avisale a administración.';
  end if;

  -- El precio sale de la carta DE ESTA CASA, nunca del teléfono (mig 192).
  select r.nombre, r.categoria, pc.precio
    into v_nombre, v_categ, v_precio
    from public.cocina_recetas r
    join public.cocina_recetas_precios_canal pc on pc.receta_id = r.id and pc.canal = v_canal
   where r.id = p_receta_id
     and r.local = v_local
     and r.vendible and r.activo
     and pc.precio > 0;

  if v_precio is null then
    raise exception 'Ese plato no está en la carta de esta casa, o no tiene precio cargado. Refrescá la carta y probá de nuevo.';
  end if;

  if p_padre_id is not null and not exists (
    select 1 from public.caja_mesa_lineas l
     where l.id = p_padre_id and l.sesion_id = p_sesion_id and l.estado = 'activa'
  ) then
    raise exception 'La salsa dice colgar de un plato que no está en esta mesa.';
  end if;

  select coalesce(max(l.linea), 0) + 1 into v_linea
    from public.caja_mesa_lineas l where l.sesion_id = p_sesion_id;

  perform set_config('rodziny.salon', 'si', true);

  insert into public.caja_mesa_lineas (
    local, sesion_id, padre_id, linea, receta_id, nombre, categoria,
    cantidad, precio_unitario, descuento_pct, agregada_por
  ) values (
    'x', p_sesion_id, p_padre_id, v_linea, p_receta_id, v_nombre, v_categ,
    p_cantidad, v_precio, p_descuento_pct, auth.uid()
  ) returning id into v_id;

  perform set_config('rodziny.salon', '', true);
  return v_id;
end;
$agregar$;

-- Sacar un plato. NO se borra: queda marcado con quién y cuándo (decisión de
-- Lucas, 8-sep-2026).
create or replace function public.salon_sacar_linea(
  p_linea_id uuid,
  p_motivo   text default null
) returns void
language plpgsql
set search_path to 'public'
as $sacar$
declare
  v_estado_sesion text;
  v_estado_linea  text;
  v_ticket        uuid;
begin
  select se.estado, l.estado, l.ticket_id
    into v_estado_sesion, v_estado_linea, v_ticket
    from public.caja_mesa_lineas l
    join public.caja_mesa_sesiones se on se.id = l.sesion_id
   where l.id = p_linea_id;

  if v_estado_linea is null then
    raise exception 'Ese plato no está en ninguna mesa. Refrescá la pantalla.';
  end if;
  if v_ticket is not null then
    raise exception 'Ese plato ya se cobró: no se puede sacar de la mesa. Si hay que devolverlo, lo anula un administrador desde Ventas.';
  end if;
  if v_estado_linea = 'sacada' then
    raise exception 'Ese plato ya estaba sacado.';
  end if;
  if v_estado_sesion not in ('abierta', 'cuenta_pedida') then
    raise exception 'La mesa ya está cerrada (%).', v_estado_sesion;
  end if;

  perform set_config('rodziny.salon', 'si', true);

  update public.caja_mesa_lineas
     set estado = 'sacada', sacada_en = now(), sacada_por = auth.uid(), sacada_motivo = p_motivo
   where id = p_linea_id;

  perform set_config('rodziny.salon', '', true);
end;
$sacar$;

-- Mandar a la cocina lo que está en el borrador. Devuelve el envío (la comanda).
create or replace function public.salon_enviar_a_cocina(p_sesion_id uuid)
returns uuid
language plpgsql
set search_path to 'public'
as $enviar$
declare
  v_estado  text;
  v_cuantas int;
  v_numero  int;
  v_envio   uuid;
begin
  select se.estado into v_estado from public.caja_mesa_sesiones se where se.id = p_sesion_id;
  if v_estado is null then
    raise exception 'Esa mesa no existe. Refrescá el plano del salón.';
  end if;
  if v_estado not in ('abierta', 'cuenta_pedida') then
    raise exception 'La mesa ya está cerrada (%): no se le puede mandar nada a la cocina.', v_estado;
  end if;

  select count(*) into v_cuantas
    from public.caja_mesa_lineas l
   where l.sesion_id = p_sesion_id and l.envio_id is null and l.estado = 'activa';

  if v_cuantas = 0 then
    raise exception 'No hay nada nuevo para mandar a la cocina.';
  end if;

  select coalesce(max(e.numero), 0) + 1 into v_numero
    from public.caja_mesa_envios e where e.sesion_id = p_sesion_id;

  perform set_config('rodziny.salon', 'si', true);

  insert into public.caja_mesa_envios (local, sesion_id, numero, enviado_por)
  values ('x', p_sesion_id, v_numero, auth.uid())
  returning id into v_envio;

  update public.caja_mesa_lineas
     set envio_id = v_envio
   where sesion_id = p_sesion_id and envio_id is null and estado = 'activa';

  perform set_config('rodziny.salon', '', true);
  return v_envio;
end;
$enviar$;

-- El mozo avisa que piden la cuenta.
create or replace function public.salon_pedir_la_cuenta(p_sesion_id uuid)
returns void
language plpgsql
set search_path to 'public'
as $cuenta$
declare
  v_estado text;
  v_sin_mandar int;
begin
  select se.estado into v_estado from public.caja_mesa_sesiones se where se.id = p_sesion_id;
  if v_estado is null then
    raise exception 'Esa mesa no existe. Refrescá el plano del salón.';
  end if;
  if v_estado = 'cuenta_pedida' then
    return;   -- apretarlo dos veces no es un error
  end if;
  if v_estado <> 'abierta' then
    raise exception 'La mesa ya está cerrada (%).', v_estado;
  end if;

  select count(*) into v_sin_mandar
    from public.caja_mesa_lineas l
   where l.sesion_id = p_sesion_id and l.envio_id is null and l.estado = 'activa';

  if v_sin_mandar > 0 then
    raise exception 'Quedan % platos sin mandar a la cocina. Mandalos o sacalos antes de pedir la cuenta.', v_sin_mandar;
  end if;

  perform set_config('rodziny.salon', 'si', true);

  update public.caja_mesa_sesiones
     set estado = 'cuenta_pedida', cuenta_pedida_en = now(), cuenta_pedida_por = auth.uid()
   where id = p_sesion_id;

  perform set_config('rodziny.salon', '', true);
end;
$cuenta$;

-- Anular una mesa abierta por error. Solo si no se cobró ni un renglón.
create or replace function public.salon_anular_sesion(p_sesion_id uuid, p_motivo text)
returns void
language plpgsql
set search_path to 'public'
as $anular$
declare
  v_estado   text;
  v_cobrados int;
begin
  select se.estado into v_estado from public.caja_mesa_sesiones se where se.id = p_sesion_id;
  if v_estado is null then
    raise exception 'Esa mesa no existe. Refrescá el plano del salón.';
  end if;
  if v_estado not in ('abierta', 'cuenta_pedida') then
    raise exception 'La mesa ya está cerrada (%).', v_estado;
  end if;
  if nullif(btrim(coalesce(p_motivo, '')), '') is null then
    raise exception 'Poné por qué se anula la mesa.';
  end if;

  select count(*) into v_cobrados
    from public.caja_mesa_lineas l where l.sesion_id = p_sesion_id and l.ticket_id is not null;

  if v_cobrados > 0 then
    raise exception 'Esta mesa ya tiene % renglones cobrados: no se anula. Lo que haya que devolver lo anula un administrador desde Ventas.', v_cobrados;
  end if;

  perform set_config('rodziny.salon', 'si', true);

  update public.caja_mesa_lineas
     set estado = 'sacada', sacada_en = now(), sacada_por = auth.uid(),
         sacada_motivo = 'mesa anulada: ' || p_motivo
   where sesion_id = p_sesion_id and estado = 'activa';

  update public.caja_mesa_sesiones
     set estado = 'anulada', cerrada_en = now(), anulada_motivo = p_motivo
   where id = p_sesion_id;

  perform set_config('rodziny.salon', '', true);
end;
$anular$;

do $permisos$
declare
  f text;
begin
  foreach f in array array[
    'salon_abrir_mesa(uuid, int)',
    'salon_agregar_linea(uuid, uuid, numeric, uuid, numeric)',
    'salon_sacar_linea(uuid, text)',
    'salon_enviar_a_cocina(uuid)',
    'salon_pedir_la_cuenta(uuid)',
    'salon_anular_sesion(uuid, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$permisos$;


-- ── 8. Los dos espacios de Saavedra y las mesas que ya conocemos ───────────
-- El Salón de Saavedra en Fudo son las mesas 1 a 13 y la 24. Las de la Vereda
-- las carga Lucas desde la pantalla: no las sé y no las voy a inventar.

insert into public.caja_salas (local, nombre, orden) values
  ('saavedra', 'Salón',  1),
  ('saavedra', 'Vereda', 2)
on conflict (local, nombre) do nothing;

insert into public.caja_mesas (local, sala_id, numero, pos_x, pos_y)
select 'x', s.id, m.numero, ((m.i - 1) % 5) * 2, ((m.i - 1) / 5) * 2
  from public.caja_salas s
  cross join (
    select numero, row_number() over () as i
      from unnest(array['1','2','3','4','5','6','7','8','9','10','11','12','13','24']) as numero
  ) m
 where s.local = 'saavedra' and s.nombre = 'Salón'
on conflict (sala_id, numero) do nothing;


-- ── 9. Chequeo: si algo de esto no quedó, la migración se cae acá ──────────

do $guard$
declare
  t         text;
  v_mesas   int;
  v_salas   int;
  v_pol     int;
begin
  foreach t in array array['caja_salas', 'caja_mesas', 'caja_mesa_sesiones',
                           'caja_mesa_envios', 'caja_mesa_lineas'] loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'public' and c.relname = t and c.relrowsecurity) then
      raise exception 'GUARDA: % no existe o quedó sin RLS prendida', t;
    end if;

    if has_table_privilege('anon', 'public.' || t, 'SELECT') then
      raise exception 'GUARDA: % quedó legible con la clave pública', t;
    end if;
  end loop;

  -- Las tres de la operación tienen que exigir la marca de sesión: sin eso,
  -- cualquier mozo con la consola abierta escribe a mano y las funciones son de
  -- adorno.
  foreach t in array array['caja_mesa_sesiones', 'caja_mesa_envios', 'caja_mesa_lineas'] loop
    select count(*) into v_pol from pg_policies
     where schemaname = 'public' and tablename = t
       and coalesce(qual, '') || coalesce(with_check, '') like '%rodziny.salon%';
    if v_pol < 2 then
      raise exception 'GUARDA: a % le faltan las reglas con la marca de sesión (encontré %)', t, v_pol;
    end if;
  end loop;

  -- El plano lo arma administración: salas y mesas NO pueden tener ninguna regla
  -- de escritura que no sea la de admin.
  foreach t in array array['caja_salas', 'caja_mesas'] loop
    select count(*) into v_pol from pg_policies
     where schemaname = 'public' and tablename = t
       and cmd <> 'SELECT'
       and policyname <> t || '_admin';
    if v_pol > 0 then
      raise exception 'GUARDA: % tiene % regla(s) de escritura que no son de administración. El plano lo armamos nosotros, no el mozo ni el cajero.', t, v_pol;
    end if;
  end loop;

  -- Ninguna función puede ser security definer: apagaría la RLS de toda la base.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'salon\_%' and p.prosecdef
  ) then
    raise exception 'GUARDA: alguna función del salón quedó security definer, y eso borra la frontera de local de la mig 187';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'salon\_%'
       and (p.proconfig is null or not (p.proconfig @> array['search_path=public']))
  ) then
    raise exception 'GUARDA: alguna función del salón quedó sin search_path fijo';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'salon\_%'
       and has_function_privilege('anon', p.oid, 'EXECUTE')
  ) then
    raise exception 'GUARDA: alguna función del salón quedó ejecutable con la clave pública';
  end if;

  select count(*) into v_salas from public.caja_salas where local = 'saavedra';
  select count(*) into v_mesas from public.caja_mesas where local = 'saavedra';
  if v_salas < 2 then
    raise exception 'GUARDA: esperaba los dos espacios de Saavedra, encontré %', v_salas;
  end if;
  if v_mesas < 14 then
    raise exception 'GUARDA: esperaba al menos las 14 mesas del Salón, encontré %', v_mesas;
  end if;

  raise notice 'OK 190: % espacios y % mesas en Saavedra · faltan las de la Vereda, las carga Lucas', v_salas, v_mesas;
end;
$guard$;
