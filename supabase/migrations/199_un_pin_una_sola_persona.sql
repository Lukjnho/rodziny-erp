-- 199 — Un PIN, una sola persona
--
-- ══════════════════════════════════════════════════════════════════════════════
-- POR QUÉ
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Decisión de Lucas del 10-sep-2026: el PIN de 4 números deja de ser solo la
-- llave del fichaje y pasa a ser LA firma de la persona — fichar entrada y
-- salida, sacar mercadería del depósito, cargar lotes de producción.
-- «Nuestro registro para identificar quién hizo qué.»
--
-- Para que eso sea cierto, dos PIN iguales no pueden existir. Hoy no existen,
-- pero por casualidad, no por candado: `empleados.dni` tiene UNIQUE y
-- `pin_fichaje` no tiene NADA — ni unique, ni check, ni not null.
--
-- MEDIDO CONTRA LA BASE EL 10-sep-2026, ANTES DE ESCRIBIR ESTO:
--   · 38 legajos: 33 activos + 5 de baja.
--   · 37 tienen PIN. El único sin PIN es Lourdes Fernández, de baja.
--   · Los 37 son DISTINTOS (count(pin_fichaje)=37, count(distinct)=37).
--   · Los 37 son exactamente 4 dígitos, sin espacios, y los 37 son los
--     últimos 4 del DNI.
--   ⇒ El candado entra sin tocar un solo dato.
--
--
-- ══════════════════════════════════════════════════════════════════════════════
-- POR QUÉ EL UNIQUE ES SOBRE TODOS Y NO SOLO SOBRE LOS ACTIVOS
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Se evaluó un índice parcial (`where activo`), que dejaría reciclar el PIN de
-- alguien que se fue. Se descartó por tres razones, en este orden:
--
-- 1. NO HACE FALTA. Los 37 PIN son distintos CONTANDO a los 5 de baja. El
--    candado total entra hoy sin limpiar nada. El parcial no compra nada.
--
-- 2. EL TRIGGER REACTIVA. `aplicar_baja_empleado()` pone `activo := true`
--    cuando el estado sale de 'baja' — deshacer una baja es un camino real.
--    Con un índice parcial, corregir una baja EXPLOTA si mientras tanto otro
--    tomó ese PIN. Y ese camino es justo el que nadie prueba.
--
-- 3. LA HISTORIA. Si el PIN es la firma de quién hizo qué, reciclarlo hace que
--    el mismo número apunte a dos personas distintas según la fecha. Es
--    exactamente lo contrario de lo que pidió el CEO.
--
-- EL COSTO, dicho de frente: un ingreso nuevo cuyo DNI termine en 4 dígitos ya
-- usados —aunque sea por alguien que se fue— no va a poder respetar la
-- costumbre de "PIN = últimos 4 del DNI" y hay que darle otro número. Con 38
-- legajos sobre 10.000 combinaciones eso pasa muy de vez en cuando, y la
-- pantalla ahora lo avisa con nombre y apellido antes de guardar.
--
--
-- ══════════════════════════════════════════════════════════════════════════════
-- POR QUÉ TAMBIÉN VA EL CHECK DE FORMATO
-- ══════════════════════════════════════════════════════════════════════════════
--
-- `fichaje_login()` (migración 185) compara con
--     btrim(e.pin_fichaje) = btrim(p_pin) ... limit 1
-- Sin el check, ' 123' y '123 ' conviven felices bajo el unique —como texto son
-- distintos— y el login los confunde: el `limit 1` elige uno cualquiera. Sería
-- un candado con un agujero adentro.
--
-- El check hace que btrim no tenga nada que recortar y de paso garantiza que el
-- PIN sea siempre 4 números. NULL sigue permitido: un legajo puede nacer sin
-- PIN (hoy hay uno así).
--
--
-- ══════════════════════════════════════════════════════════════════════════════
-- QUÉ NO HACE
-- ══════════════════════════════════════════════════════════════════════════════
--
-- · No corre ningún UPDATE ni DELETE. Cero filas modificadas.
-- · No toca `fichaje_login()` ni `fichaje_sesion()`. Fichar sigue igual.
-- · No exige PIN a los activos. Hoy los 33 lo tienen, pero obligarlo impediría
--   abrir un legajo antes de asignarle el número.
-- · No cambia ningún permiso. El guardarraíl verifica que anon siga pudiendo
--   fichar y siga SIN poder leer la columna del PIN.
--
-- Se puede correr dos veces sin romper nada.

begin;

-- ── 0. Antes de nada: que no haya un PIN repetido ───────────────────────────
--
-- Si esta migración se corre algún día contra una base que se movió, que falle
-- con los nombres de las personas y no con un error críptico del índice.
do $pre$
declare
  v_dup text;
begin
  select string_agg(t.pin_fichaje || ' → ' || t.quienes, ' · ')
    into v_dup
    from (
      select e.pin_fichaje,
             string_agg(e.nombre || ' ' || e.apellido, ', ' order by e.apellido) as quienes
        from public.empleados e
       where e.pin_fichaje is not null
       group by e.pin_fichaje
      having count(*) > 1
    ) t;

  if v_dup is not null then
    raise exception
      'No se puede poner el candado del PIN: hay numeros repetidos. Arreglalos primero → %',
      v_dup;
  end if;
end
$pre$;

-- ── 1. El PIN es 4 numeros, o no es ─────────────────────────────────────────
do $fmt$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.empleados'::regclass
       and conname  = 'empleados_pin_fichaje_formato'
  ) then
    alter table public.empleados
      add constraint empleados_pin_fichaje_formato
      check (pin_fichaje is null or pin_fichaje ~ '^[0-9]{4}$');
  end if;
end
$fmt$;

comment on constraint empleados_pin_fichaje_formato on public.empleados is
  'Migracion 199. El PIN es exactamente 4 digitos, sin espacios. Sin esto, fichaje_login() —que compara con btrim()— confundiria '' 123'' con ''123 ''. NULL se permite: un legajo puede no tener PIN todavia.';

-- ── 2. Un PIN, una sola persona ─────────────────────────────────────────────
--
-- Sobre TODOS los legajos, activos y de baja. NULL no choca con NULL (Postgres
-- trata los nulos como distintos), asi que se pueden abrir legajos sin PIN.
create unique index if not exists empleados_pin_fichaje_unico
  on public.empleados (pin_fichaje);

comment on index public.empleados_pin_fichaje_unico is
  'Migracion 199. El PIN identifica a UNA sola persona: es la firma del fichaje, del retiro de deposito y de los lotes de produccion. Vale tambien para los de baja, para que el mismo numero no apunte a dos personas segun la fecha. Si esto salta, la pantalla de RRHH lo traduce (erroresSupabase.ts → POR_RESTRICCION).';

-- ── 3. Guardarrail ──────────────────────────────────────────────────────────
do $guard$
declare
  v_n    int;
  v_con  int;
  v_dist int;
begin
  -- 1) El indice existe y es unico de verdad.
  select count(*) into v_n
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
   where c.relname  = 'empleados_pin_fichaje_unico'
     and i.indrelid = 'public.empleados'::regclass
     and i.indisunique;
  if v_n <> 1 then
    raise exception 'GUARDARRAIL: el unique de pin_fichaje no quedo creado.';
  end if;

  -- 1b) Y es TOTAL, no parcial. Esta migracion dedica tres parrafos a explicar
  --     por que incluye a los de baja; sin este chequeo, nada lo garantizaba.
  --     Si alguien lo vuelve parcial (`where activo`), el reingreso explota:
  --     aplicar_baja_empleado() reactiva legajos y ese camino nadie lo prueba.
  if exists (
    select 1
      from pg_index i
      join pg_class c on c.oid = i.indexrelid
     where c.relname  = 'empleados_pin_fichaje_unico'
       and i.indrelid = 'public.empleados'::regclass
       and i.indpred is not null
  ) then
    raise exception 'GUARDARRAIL: el unique del PIN quedo PARCIAL. Tiene que abarcar tambien a los de baja.';
  end if;

  -- 2) El check de formato existe y esta validado (no quedo NOT VALID).
  select count(*) into v_n
    from pg_constraint
   where conrelid = 'public.empleados'::regclass
     and conname  = 'empleados_pin_fichaje_formato'
     and contype  = 'c'
     and convalidated;
  if v_n <> 1 then
    raise exception 'GUARDARRAIL: el check de formato del PIN no quedo validado.';
  end if;

  -- 3) No se perdio ni se duplico ningun PIN.
  select count(pin_fichaje), count(distinct pin_fichaje)
    into v_con, v_dist
    from public.empleados;
  if v_con <> v_dist then
    raise exception 'GUARDARRAIL: hay % PIN cargados y solo % distintos.', v_con, v_dist;
  end if;
  raise notice 'PIN cargados: %, todos distintos.', v_con;

  -- 4) Y no se rompio ningun PIN con el check.
  select count(*) into v_n
    from public.empleados
   where pin_fichaje is not null
     and pin_fichaje !~ '^[0-9]{4}$';
  if v_n <> 0 then
    raise exception 'GUARDARRAIL: quedaron % PIN con formato invalido.', v_n;
  end if;

  -- 5) Fichar sigue andando: la funcion existe y anon la puede ejecutar.
  if not has_function_privilege('anon', 'public.fichaje_login(text, text)', 'EXECUTE') then
    raise exception 'GUARDARRAIL: anon perdio fichaje_login, nadie podria fichar.';
  end if;

  -- 6) Y el PIN sigue sin salir a la calle (migraciones 185 y 186).
  if has_column_privilege('anon', 'public.empleados', 'pin_fichaje', 'SELECT') then
    raise exception 'GUARDARRAIL: anon puede leer la columna pin_fichaje.';
  end if;

  raise notice 'GUARDARRAIL OK';
end
$guard$;

commit;