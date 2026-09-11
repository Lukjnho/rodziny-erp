-- ═══════════════════════════════════════════════════════════════════════════
-- ETAPA 2 · PASO 1 — Las tres tablas de las formas de venta. VACÍAS.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- QUÉ RESUELVE
--
-- Hoy una misma receta se escribe hasta cuatro veces para venderse de cuatro
-- maneras: "Tortelli", "Tortelli (VIANDA)", "Tortelli (CONGELADO)",
-- "Tortelli (PACK)". Son 43 filas que dicen lo mismo, y ya se desincronizaron
-- en tres familias: la base y su variante tenían cantidades distintas del
-- mismo ingrediente (migración 212).
--
-- 🔑 Con este modelo esa clase de error NO PUEDE volver a existir: la cantidad
-- vive una sola vez, en la receta, y la forma declara únicamente lo PROPIO de
-- esa forma. No se arregla un dato: se elimina la posibilidad.
--
--     costo de la forma = costo de la receta × multiplicador
--                       + Σ ingredientes propios de la forma
--                       + Σ (costo de cada receta del surtido × su cantidad)
--
-- ── POR QUÉ SE PUEDE APLICAR ANTES DEL MERGE ───────────────────────────────
--
-- Es puramente aditiva: tres tablas nuevas, ningún objeto viejo tocado. El
-- código publicado hoy no las nombra, así que no se entera de que existen.
-- Es la fila verde de la tabla de CLAUDE.md.
--
-- ── EL VOCABULARIO: CINCO CÓDIGOS, Y NINGUNO MÁS ───────────────────────────
--
-- Decidido por Lucas el 11-sep-2026. En los nombres de hoy conviven
-- CONGELADO/CONGELADA, VIANDA/VIANDAS, PORCION/PORCIONES y ALMACEN con y sin
-- tilde. Son concordancia de género y plurales: para el ojo están bien, pero
-- el dato es uno solo.
--
--     plato · vianda · congelado · porcion · almacen
--
-- El nombre lindo va en `nombre`, libre. Es el mismo patrón que ya mordió con
-- panificado/panaderia: dato único, etiqueta aparte.
--
-- 💡 Los tres primeros son EXACTAMENTE los valores que ya usa
-- `cocina_recetas_precios_canal.canal` (210 plato · 15 vianda · 1 congelado).
-- La decisión no inventa vocabulario: lo extiende con los dos de pastelería.
--
-- El candado es un CHECK, no una convención. Escribir 'ALMACÉN' falla.
--
-- ── LO QUE NO HACE ─────────────────────────────────────────────────────────
--
--   · No escribe ni una fila. Llenar las formas es el paso 3.
--   · No toca `cocina_recetas` ni `cocina_recetas_precios_canal`. Las 43
--     recetas variante siguen vivas y vendiéndose igual.
--   · No agrega NADA a lo que puede leer la clave pública: las tres tablas
--     nacen sin política para `anon`. `cocina_formas_venta` guarda precios y
--     los precios nunca fueron públicos.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · La forma de vender una receta ──────────────────────────────────────
create table if not exists public.cocina_formas_venta (
  id            uuid primary key default gen_random_uuid(),
  receta_id     uuid not null references public.cocina_recetas(id) on delete cascade,

  -- El dato. Cinco valores y ninguno más.
  codigo        text not null
                check (codigo in ('plato', 'vianda', 'congelado', 'porcion', 'almacen')),

  -- La etiqueta para la pantalla: libre. "Congelada", "Porción", "Almacén".
  nombre        text not null,

  -- Cuánta receta base entra en una unidad de esta forma. La porción de torta
  -- es 0,1; el Flat White son 2 expresos; el Pack de 4 es 4.
  multiplicador numeric not null default 1 check (multiplicador > 0),

  -- null significa "no se vende suelta". Es el caso de los (PACK) de hoy, que
  -- existen sólo para que el Pack de 4 se pueda costear.
  precio        numeric check (precio is null or precio >= 0),

  activo        boolean not null default true,
  vendible      boolean not null default true,

  -- El enganche al POS, igual que en cocina_recetas.
  fudo_productos text[],

  orden         integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- 🔑 Esto es lo que hace imposible el par ALMACEN/ALMACÉN: una receta no
  -- puede tener dos veces la misma forma.
  constraint cocina_formas_venta_receta_codigo_key unique (receta_id, codigo)
);

-- ── 2 · Lo PROPIO de la forma ──────────────────────────────────────────────
--
-- ⚠️ No es sólo empaque, y esa corrección costó un rediseño. La porción de
-- Tarta Vazca lleva coulis 0,05 y arándanos 0,01; la entera lleva 0,3 y 0,08:
-- el MISMO ingrediente en otra proporción. La de Brownie suma chantilly y
-- dulce de leche que la entera no tiene.
--
-- Es la misma tabla que cocina_receta_ingredientes con forma_id en vez de
-- receta_id. El empaque entra por acá como un ingrediente más, que es lo que
-- ya es desde la migración 204.
create table if not exists public.cocina_formas_venta_ingredientes (
  id            uuid primary key default gen_random_uuid(),
  forma_id      uuid not null references public.cocina_formas_venta(id) on delete cascade,
  nombre        text not null,
  cantidad      numeric not null,
  unidad        text not null default 'g',
  producto_id   uuid references public.productos(id) on delete set null,
  observaciones text,
  orden         integer not null default 0,
  created_at    timestamptz not null default now()
);

-- ── 3 · El surtido ─────────────────────────────────────────────────────────
--
-- Existe por un solo caso, y por eso es una tabla y no una columna: el
-- "Pack de 4 Congeladas" no son 4 unidades de la misma receta, son CUATRO
-- RECETAS DISTINTAS en una caja (Tortelli ×1 + Mezzelune Bondiola ×2 +
-- Capresse ×1). Sin esto, el pack necesita un caso especial en el motor.
create table if not exists public.cocina_formas_venta_surtido (
  id         uuid primary key default gen_random_uuid(),
  forma_id   uuid not null references public.cocina_formas_venta(id) on delete cascade,
  receta_id  uuid not null references public.cocina_recetas(id) on delete restrict,
  cantidad   numeric not null default 1 check (cantidad > 0),
  orden      integer not null default 0,
  created_at timestamptz not null default now(),
  constraint cocina_formas_venta_surtido_forma_receta_key unique (forma_id, receta_id)
);

-- ── Índices: los caminos por los que se va a entrar ────────────────────────
create index if not exists idx_formas_venta_receta   on public.cocina_formas_venta (receta_id);
create index if not exists idx_formas_venta_activas  on public.cocina_formas_venta (activo) where activo;
create index if not exists idx_formas_ing_forma      on public.cocina_formas_venta_ingredientes (forma_id);
create index if not exists idx_formas_ing_producto   on public.cocina_formas_venta_ingredientes (producto_id);
create index if not exists idx_formas_surtido_forma  on public.cocina_formas_venta_surtido (forma_id);
create index if not exists idx_formas_surtido_receta on public.cocina_formas_venta_surtido (receta_id);

-- ── RLS ────────────────────────────────────────────────────────────────────
--
-- 💣 `tiene_permiso()` va envuelto en (select ...) siempre: sin eso Postgres
-- lo evalúa fila por fila y la consulta tarda lo suficiente como para dar 500.
alter table public.cocina_formas_venta              enable row level security;
alter table public.cocina_formas_venta_ingredientes enable row level security;
alter table public.cocina_formas_venta_surtido      enable row level security;

drop policy if exists formas_venta_editar on public.cocina_formas_venta;
create policy formas_venta_editar on public.cocina_formas_venta
  for all to authenticated
  using      ((select tiene_permiso('productos')) or (select tiene_permiso('cocina')))
  with check ((select tiene_permiso('productos')) or (select tiene_permiso('cocina')));

-- Caja y Salón necesitan el precio para cobrar, pero no escriben formas.
drop policy if exists formas_venta_caja_select on public.cocina_formas_venta;
create policy formas_venta_caja_select on public.cocina_formas_venta
  for select to authenticated
  using ((select tiene_permiso('caja')) or (select tiene_permiso('salon')));

drop policy if exists formas_venta_ing_editar on public.cocina_formas_venta_ingredientes;
create policy formas_venta_ing_editar on public.cocina_formas_venta_ingredientes
  for all to authenticated
  using      ((select tiene_permiso('productos')) or (select tiene_permiso('cocina')))
  with check ((select tiene_permiso('productos')) or (select tiene_permiso('cocina')));

drop policy if exists formas_venta_surtido_editar on public.cocina_formas_venta_surtido;
create policy formas_venta_surtido_editar on public.cocina_formas_venta_surtido
  for all to authenticated
  using      ((select tiene_permiso('productos')) or (select tiene_permiso('cocina')))
  with check ((select tiene_permiso('productos')) or (select tiene_permiso('cocina')));

-- ── El updated_at se toca solo ─────────────────────────────────────────────
drop trigger if exists trg_touch_formas_venta on public.cocina_formas_venta;
create trigger trg_touch_formas_venta
  before update on public.cocina_formas_venta
  for each row execute function public.touch_precios_canal_updated_at();

-- ── El historial de precios no se corta ────────────────────────────────────
--
-- 🔑 Cuando en el paso 4 el precio pase a vivir en la forma, la libreta de
-- cambios de precio tiene que seguir escribiéndose en el MISMO lugar, o el día
-- del cambio de fuente se pierde el rastro sin que nadie lo note.
--
-- `cocina_recetas_precios_historial` guarda (receta_id, canal), y una forma es
-- exactamente (receta_id, codigo). Entra sin tabla nueva.
create or replace function public.cocina_formas_venta_precios_log()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_accion  text;
  v_receta  uuid;
  v_codigo  text;
  v_ant     numeric;
  v_nue     numeric;
  v_var     numeric;
  v_nombre  text;
  v_local   text;
  v_uid     uuid;
  v_usuario text;
  v_origen  text;
begin
  begin
    if TG_OP = 'INSERT' then
      if NEW.precio is null then
        return NEW;
      end if;
      v_accion := 'alta';
      v_receta := NEW.receta_id;
      v_codigo := NEW.codigo;
      v_nue    := NEW.precio;

    elsif TG_OP = 'DELETE' then
      -- Si la receta padre ya no existe, esto es la cascada de borrarla y el
      -- disparador del padre ya anotó la baja con nombre y local. Anotar acá
      -- otra vez deja una fila fantasma imposible de leer.
      if not exists (select 1 from public.cocina_recetas r where r.id = OLD.receta_id) then
        return OLD;
      end if;
      if OLD.precio is null then
        return OLD;
      end if;
      v_accion := 'baja';
      v_receta := OLD.receta_id;
      v_codigo := OLD.codigo;
      v_ant    := OLD.precio;

    else
      -- El upsert del front reescribe la fila aunque el precio no cambie. Si no
      -- cambió nada que importe, no se anota: la libreta se llenaría de ruido.
      if NEW.precio    is not distinct from OLD.precio
     and NEW.codigo    is not distinct from OLD.codigo
     and NEW.receta_id is not distinct from OLD.receta_id then
        return NEW;
      end if;
      v_accion := 'cambio';
      v_receta := NEW.receta_id;
      v_codigo := NEW.codigo;
      v_ant    := OLD.precio;
      v_nue    := NEW.precio;
    end if;

    if v_ant is not null and v_ant > 0 and v_nue is not null then
      v_var := (v_nue - v_ant) / v_ant;
    end if;

    v_uid := auth.uid();
    -- auth.role() distingue lo que auth.uid() no: con la llave de servicio dice
    -- 'service_role'; desde la consola SQL da nulo.
    v_origen := coalesce(auth.role(), 'sql_directo');

    select p.nombre into v_usuario from public.perfiles p where p.user_id = v_uid;
    select r.nombre, r.local into v_nombre, v_local
      from public.cocina_recetas r where r.id = v_receta;

    insert into public.cocina_recetas_precios_historial (
      receta_id, receta_nombre, local, canal, accion,
      precio_anterior, precio_nuevo, variacion_pct, usuario, usuario_id, origen
    ) values (
      v_receta, v_nombre, v_local, v_codigo, v_accion,
      v_ant, v_nue, v_var, v_usuario, v_uid, v_origen
    );

  exception when others then
    -- Se anota en el log de Postgres y la vida sigue. El precio manda.
    raise warning 'historial de precios (formas): no pude anotar (receta=%, forma=%, op=%): %',
      v_receta, v_codigo, TG_OP, SQLERRM;
  end;

  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$fn$;

drop trigger if exists trg_log_formas_venta_precios on public.cocina_formas_venta;
create trigger trg_log_formas_venta_precios
  after insert or update or delete on public.cocina_formas_venta
  for each row execute function public.cocina_formas_venta_precios_log();

-- ═══════════════════════════════════════════════════════════════════════════
-- GUARDARRAÍL — si algo de esto no da, la migración entera se deshace
-- ═══════════════════════════════════════════════════════════════════════════
do $guardia$
declare
  v_receta uuid;
  v_forma  uuid;
  v_n      integer;
begin
  -- 1 · Las tres tablas existen y están vacías.
  select count(*) into v_n from public.cocina_formas_venta;
  if v_n <> 0 then
    raise exception 'cocina_formas_venta tendría que nacer vacía y tiene % filas.', v_n;
  end if;
  select count(*) into v_n from public.cocina_formas_venta_ingredientes;
  if v_n <> 0 then
    raise exception 'cocina_formas_venta_ingredientes tendría que nacer vacía y tiene % filas.', v_n;
  end if;
  select count(*) into v_n from public.cocina_formas_venta_surtido;
  if v_n <> 0 then
    raise exception 'cocina_formas_venta_surtido tendría que nacer vacía y tiene % filas.', v_n;
  end if;

  -- 2 · Las tres tienen RLS prendida.
  select count(*) into v_n
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('cocina_formas_venta', 'cocina_formas_venta_ingredientes',
                       'cocina_formas_venta_surtido')
     and c.relrowsecurity;
  if v_n <> 3 then
    raise exception 'Esperaba 3 tablas con RLS prendida y hay %.', v_n;
  end if;

  -- 3 · Ninguna de las tres deja entrar a la clave pública.
  select count(*) into v_n
    from pg_policies
   where schemaname = 'public'
     and tablename like 'cocina_formas_venta%'
     and roles::text like '%anon%';
  if v_n <> 0 then
    raise exception 'Quedaron % políticas para anon sobre las formas. Los precios no son públicos.', v_n;
  end if;

  -- 4 · EL TESTIGO DEL VOCABULARIO, con respuesta conocida de antemano:
  --     'almacen' entra, 'ALMACÉN' no puede entrar.
  select id into v_receta from public.cocina_recetas order by created_at limit 1;
  if v_receta is null then
    raise exception 'No hay ni una receta: no puedo probar el candado del vocabulario.';
  end if;

  begin
    insert into public.cocina_formas_venta (receta_id, codigo, nombre)
    values (v_receta, 'ALMACÉN', 'testigo que no tiene que entrar');
    raise exception 'EL CANDADO NO FUNCIONA: aceptó ALMACÉN con tilde, que es justo lo que hay que hacer imposible.';
  exception when check_violation then
    null;
  end;

  insert into public.cocina_formas_venta (receta_id, codigo, nombre, multiplicador)
  values (v_receta, 'almacen', 'testigo', 1)
  returning id into v_forma;

  insert into public.cocina_formas_venta_ingredientes (forma_id, nombre, cantidad, unidad)
  values (v_forma, 'testigo', 1, 'unid.');
  insert into public.cocina_formas_venta_surtido (forma_id, receta_id, cantidad)
  values (v_forma, v_receta, 2);

  -- 5 · El borrado en cascada limpia las tres: si no, el paso 3 deja basura.
  delete from public.cocina_formas_venta where id = v_forma;

  select count(*) into v_n from public.cocina_formas_venta_ingredientes where forma_id = v_forma;
  if v_n <> 0 then
    raise exception 'Borré la forma y quedaron % ingredientes colgados.', v_n;
  end if;
  select count(*) into v_n from public.cocina_formas_venta_surtido where forma_id = v_forma;
  if v_n <> 0 then
    raise exception 'Borré la forma y quedaron % renglones de surtido colgados.', v_n;
  end if;

  -- 6 · Y las tres quedan vacías, como nacieron.
  select (select count(*) from public.cocina_formas_venta)
       + (select count(*) from public.cocina_formas_venta_ingredientes)
       + (select count(*) from public.cocina_formas_venta_surtido)
    into v_n;
  if v_n <> 0 then
    raise exception 'Después del testigo quedaron % filas. Tienen que quedar 0.', v_n;
  end if;

  raise notice 'Paso 1 OK · 3 tablas vacías · RLS en las 3 · 0 políticas anon · el candado rechaza ALMACÉN';
end;
$guardia$;
