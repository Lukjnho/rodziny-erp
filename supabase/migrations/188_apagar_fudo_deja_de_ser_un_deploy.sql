-- ============================================================================
-- 188 — APAGAR FUDO DEJA DE SER UN DEPLOY
-- ============================================================================
--
-- QUÉ PASA HOY
-- ------------
-- "La venta oficial es la de Fudo" está escrito a mano en una constante del
-- código (`src/lib/origenVentas.ts`) y la leen OCHO pantallas. Mientras el POS
-- propio corre en paralelo con Fudo, la misma venta existe de los dos lados; si
-- los reportes leyeran todo, cada venta se contaría dos veces y se romperían
-- Ventas, EdR, Flujo de Caja e Ingeniería de Menú a la vez. Por eso hoy todos
-- filtran `origen = 'fudo'`.
--
-- El problema es el día del corte: Saavedra va a empezar a cobrar por el POS
-- propio MIENTRAS Vedia sigue en Fudo. Con una constante eso no se puede decir,
-- y cambiarla exige un deploy (y volver atrás, otro).
--
--
-- POR QUÉ NO ALCANZA CON HACER LA CONSTANTE "UNA FUNCIÓN DEL LOCAL"
-- -----------------------------------------------------------------
-- Era el camino obvio y NO sirve: cuatro de las ocho consultas miran las DOS
-- casas en la misma query y no filtran por local.
--
--   * useVentasResumen        → en "consolidado" no pone `.eq('local', ...)`.
--   * GastosPage              → el ratio gasto/venta, cuando no hay local elegido.
--   * AnalisisGastos          → ídem, el del año.
--   * CierreMesPanel          → SIEMPRE consolidado (agrupa por local después).
--
-- Una constante que a veces vale 'fudo' y a veces 'pos' no puede contestar esas
-- cuatro. La regla tiene que resolverse FILA POR FILA, del lado de la base.
--
--
-- LO QUE HACE ESTA MIGRACIÓN
-- --------------------------
--   1. Una tablita `ventas_origen_oficial` con un renglón por local:
--          vedia    → fudo
--          saavedra → fudo
--   2. Dos listas (`v_ventas_tickets_oficial`, `v_ventas_items_oficial`) que ya
--      vienen filtradas: cada fila pasa solo si su `origen` es el oficial DE SU
--      LOCAL. Eso es lo que leen los reportes de ahora en más.
--
-- HOY NO CAMBIA NINGÚN NÚMERO: los dos renglones dicen 'fudo', o sea exactamente
-- lo mismo que la constante. El chequeo del final lo comprueba contando.
--
-- EL DÍA DEL CORTE EN SAAVEDRA es un renglón, sin deploy:
--
--     update public.ventas_origen_oficial set origen = 'pos' where local = 'saavedra';
--
-- y para volver atrás, lo mismo con 'fudo'. Diez segundos.
-- ⚠️ Después de cambiarlo hay que RECARGAR las pantallas abiertas: el navegador
-- se guarda la respuesta anterior un rato (React Query) y te va a seguir
-- mostrando los números viejos hasta que refresques.
--
--
-- 💣 EL PELIGRO DE ESTE DISEÑO, Y CÓMO SE TAPA
-- ---------------------------------------------
-- Las listas CRUZAN las ventas contra la tablita. Un cruce es un filtro: si un
-- local no tiene renglón cargado, sus ventas NO desaparecen de la base, pero
-- desaparecen de TODOS los reportes, sin un solo cartel de error. Es el mismo
-- tipo de falla muda que venimos sacando de la Caja.
--
-- Por eso van dos llaves de `local` (foreign key) desde `ventas_tickets` y
-- `ventas_items` hacia la tablita. Con eso, si mañana aparece un local nuevo, la
-- base RECHAZA la carga de su primera venta ("no existe el renglón") en vez de
-- mostrarte cero. Se falla al cargar, que se ve, y no al mirar, que no se ve.
-- Hoy entra limpio: las dos tablas tienen `local` NOT NULL, cero filas flojas y
-- exactamente dos valores (vedia y saavedra).
--
--
-- 💣 `security_invoker = true` NO ES OPCIONAL
-- --------------------------------------------
-- Una vista de Postgres, por omisión, lee con los permisos del DUEÑO: se saltea
-- las reglas de fila de las tablas de abajo. Sin esa opción, estas dos listas
-- serían un agujero para leer TODAS las ventas de las dos casas esquivando la
-- migración 187. Con la opción prendida, cada uno ve por la lista exactamente lo
-- mismo que ve por la tabla.
--
-- Ojo con la otra cara: como las reglas SÍ corren, la regla de lectura de
-- `ventas_origen_oficial` tiene que dejar leerla a cualquiera con sesión. Si no,
-- el cruce no encuentra nada y las listas vuelven VACÍAS para todo el mundo.
--
--
-- 💣 LAS LISTAS CONGELAN LAS COLUMNAS
-- ------------------------------------
-- `select t.*` se resuelve al crear la vista. Si mañana le agregás una columna a
-- `ventas_tickets` o a `ventas_items`, la lista NO la va a tener y la pantalla
-- que la pida va a tirar error. Se arregla volviendo a correr los dos
-- `drop view` + `create view` de acá abajo.
--
--
-- LO QUE NO TOCA
-- --------------
--   * `useFudoHuerfanos` se queda con 'fudo' escrito a mano, a propósito: esa
--     pantalla es SOBRE los nombres que manda Fudo, no sobre "la venta oficial".
--   * Cocina sigue leyendo `ventas_items` derecho, sin filtrar origen (mig 184).
--   * El importador de Fudo sigue escribiendo `origen = 'fudo'`, como debe ser.
--   * El POS sigue escribiendo `origen = 'pos'`.
--
-- Contexto: migración 141 (nació la columna `origen`), 150 (los borrados del
-- importador filtran por origen), 187 (cada cajero ve solo su casa).
-- ============================================================================


-- ── 1. La tablita ───────────────────────────────────────────────────────────

create table if not exists public.ventas_origen_oficial (
  local           text primary key,
  origen          text not null check (origen in ('fudo', 'pos')),
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid references auth.users(id) on delete set null
);

comment on table public.ventas_origen_oficial is
  'De qué sistema salen las ventas OFICIALES de cada local. Los reportes leen las vistas v_ventas_tickets_oficial / v_ventas_items_oficial, que filtran con esto. Cortar Fudo en un local = update de este renglón, sin deploy.';
comment on column public.ventas_origen_oficial.origen is
  'fudo = las ventas importadas de Fudo. pos = las que cobra la caja propia del ERP.';

-- Los dos locales que existen hoy. `on conflict do nothing` para poder correr la
-- migración de nuevo sin pisar un corte ya hecho.
insert into public.ventas_origen_oficial (local, origen) values
  ('vedia', 'fudo'),
  ('saavedra', 'fudo')
on conflict (local) do nothing;

-- Red de seguridad: cualquier local que ya tenga ventas cargadas y no esté en la
-- lista, entra como 'fudo' (que es lo que hacía la constante). Sin esto las
-- llaves de abajo no se podrían crear.
insert into public.ventas_origen_oficial (local, origen)
select distinct t.local, 'fudo' from public.ventas_tickets t
on conflict (local) do nothing;

insert into public.ventas_origen_oficial (local, origen)
select distinct i.local, 'fudo' from public.ventas_items i
on conflict (local) do nothing;

-- Deja anotado cuándo se tocó el renglón (para saber, meses después, qué día se
-- cortó Fudo en cada casa).
create or replace function public.ventas_origen_oficial_sello()
returns trigger
language plpgsql
set search_path to 'public'
as $sello$
begin
  new.actualizado_en := now();
  new.actualizado_por := auth.uid();
  return new;
end;
$sello$;

drop trigger if exists ventas_origen_oficial_sello on public.ventas_origen_oficial;
create trigger ventas_origen_oficial_sello
  before update on public.ventas_origen_oficial
  for each row execute function public.ventas_origen_oficial_sello();


-- ── 2. Quién puede leerla y quién puede cambiarla ───────────────────────────

alter table public.ventas_origen_oficial enable row level security;

-- Leerla la tiene que poder cualquiera con sesión: si no, el cruce de las
-- vistas no encuentra nada y los reportes salen VACÍOS.
drop policy if exists ventas_origen_oficial_ver on public.ventas_origen_oficial;
create policy ventas_origen_oficial_ver on public.ventas_origen_oficial
  for select to authenticated
  using (true);

-- Cambiarla, solo administración. Es el interruptor de toda la facturación.
drop policy if exists ventas_origen_oficial_admin on public.ventas_origen_oficial;
create policy ventas_origen_oficial_admin on public.ventas_origen_oficial
  for all to authenticated
  using ((select public.es_admin()))
  with check ((select public.es_admin()));

revoke all on public.ventas_origen_oficial from public, anon;
grant select, insert, update, delete on public.ventas_origen_oficial to authenticated;
grant all on public.ventas_origen_oficial to service_role;


-- ── 3. Las llaves que hacen que un local sin renglón falle al CARGAR ────────

alter table public.ventas_tickets drop constraint if exists ventas_tickets_local_oficial_fk;
alter table public.ventas_tickets
  add constraint ventas_tickets_local_oficial_fk
  foreign key (local) references public.ventas_origen_oficial(local)
  on update cascade;

alter table public.ventas_items drop constraint if exists ventas_items_local_oficial_fk;
alter table public.ventas_items
  add constraint ventas_items_local_oficial_fk
  foreign key (local) references public.ventas_origen_oficial(local)
  on update cascade;


-- ── 4. Las dos listas que leen los reportes ─────────────────────────────────

drop view if exists public.v_ventas_tickets_oficial;
create view public.v_ventas_tickets_oficial
with (security_invoker = true) as
select t.*
from public.ventas_tickets t
join public.ventas_origen_oficial o
  on o.local = t.local
 and o.origen = t.origen;

comment on view public.v_ventas_tickets_oficial is
  'Los tickets de la venta OFICIAL de cada local (ver ventas_origen_oficial). Reemplaza el .eq(origen, fudo) escrito a mano en los reportes. security_invoker = true: respeta las reglas de fila de ventas_tickets.';

drop view if exists public.v_ventas_items_oficial;
create view public.v_ventas_items_oficial
with (security_invoker = true) as
select i.*
from public.ventas_items i
join public.ventas_origen_oficial o
  on o.local = i.local
 and o.origen = i.origen;

comment on view public.v_ventas_items_oficial is
  'Los renglones de la venta OFICIAL de cada local (ver ventas_origen_oficial). security_invoker = true: respeta las reglas de fila de ventas_items.';

-- Igual que el resto de las vistas del ERP: se leen con sesión, nunca con la
-- clave pública.
revoke all on public.v_ventas_tickets_oficial from public, anon;
revoke all on public.v_ventas_items_oficial   from public, anon;
grant select on public.v_ventas_tickets_oficial to authenticated;
grant select on public.v_ventas_items_oficial   to authenticated;
grant select on public.v_ventas_tickets_oficial to service_role;
grant select on public.v_ventas_items_oficial   to service_role;


-- ── 5. Chequeo: si algo de esto no quedó, la migración se cae acá ───────────

do $guard$
declare
  v_renglones   int;
  v_tickets_vw  bigint;
  v_tickets_old bigint;
  v_items_vw    bigint;
  v_items_old   bigint;
  v_vista       text;
begin
  -- 5.1 la tablita tiene un renglón por cada local con ventas
  select count(*) into v_renglones from public.ventas_origen_oficial;
  if v_renglones < 2 then
    raise exception 'GUARDA: ventas_origen_oficial quedó con % renglones, esperaba al menos 2 (vedia y saavedra)', v_renglones;
  end if;

  if exists (select 1 from public.ventas_tickets t
             where not exists (select 1 from public.ventas_origen_oficial o where o.local = t.local)) then
    raise exception 'GUARDA: hay tickets de un local que no está en ventas_origen_oficial';
  end if;

  -- 5.2 las dos vistas existen y leen con los permisos del que pregunta
  foreach v_vista in array array['v_ventas_tickets_oficial', 'v_ventas_items_oficial'] loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = v_vista and c.relkind = 'v'
        and c.reloptions @> array['security_invoker=true']
    ) then
      raise exception 'GUARDA: la vista % no existe o le falta security_invoker = true (sería un agujero para leer las ventas de las dos casas)', v_vista;
    end if;

    if has_table_privilege('anon', 'public.' || v_vista, 'SELECT') then
      raise exception 'GUARDA: la vista % quedó legible con la clave pública', v_vista;
    end if;

    if not has_table_privilege('authenticated', 'public.' || v_vista, 'SELECT') then
      raise exception 'GUARDA: la vista % no la puede leer un usuario con sesión', v_vista;
    end if;
  end loop;

  -- 5.3 las dos llaves están puestas
  if not exists (select 1 from pg_constraint where conname = 'ventas_tickets_local_oficial_fk') then
    raise exception 'GUARDA: falta la llave de local en ventas_tickets';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ventas_items_local_oficial_fk') then
    raise exception 'GUARDA: falta la llave de local en ventas_items';
  end if;

  -- 5.4 LO QUE MÁS IMPORTA: hoy las listas tienen que dar EXACTAMENTE lo mismo
  --     que la constante que reemplazan. Si esto no da igual, algún reporte
  --     cambia de número sin que nadie lo haya pedido.
  select count(*) into v_tickets_vw  from public.v_ventas_tickets_oficial;
  select count(*) into v_tickets_old from public.ventas_tickets where origen = 'fudo';
  if v_tickets_vw <> v_tickets_old then
    raise exception 'GUARDA: la lista de tickets da % filas y el filtro viejo daba %', v_tickets_vw, v_tickets_old;
  end if;

  select count(*) into v_items_vw  from public.v_ventas_items_oficial;
  select count(*) into v_items_old from public.ventas_items where origen = 'fudo';
  if v_items_vw <> v_items_old then
    raise exception 'GUARDA: la lista de renglones da % filas y el filtro viejo daba %', v_items_vw, v_items_old;
  end if;

  raise notice 'OK 188: % locales configurados · % tickets · % renglones', v_renglones, v_tickets_vw, v_items_vw;
end;
$guard$;
