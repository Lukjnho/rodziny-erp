-- ═══════════════════════════════════════════════════════════════════════════
-- El candado que impide subirse los permisos no miraba "anular ventas"
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 💥 QUÉ PASABA, medido el 11-sep-2026
--
-- Cualquier usuario logueado puede escribir SU PROPIA fila de `perfiles`:
--
--     perfiles_update_propio · UPDATE · using (auth.uid() = user_id)
--
-- Eso es a propósito (cambiarse el nombre, el PIN). Lo único que impide que
-- además se regale permisos es el disparador `trg_perfiles_no_autoescalar`
-- (migración 150), que recorre las columnas y frena las que cambian:
--
--     if v_campo like 'puede\_ver\_%' or v_campo = 'local_restringido' then
--
-- 🔑 **Ese patrón deja una sola columna afuera, y es la peor.** La migración
-- 196 agregó dos permisos nuevos:
--
--     puede_ver_esperado_caja   → empieza con `puede_ver_`, queda protegida
--     puede_anular_ventas       → NO empieza con `puede_ver_`, QUEDA AFUERA
--
-- Y `puede_anular_ventas` es justamente la que **borra una venta ya cobrada**.
-- De las 21 casillas de permiso, la única que se podía autoasignar era ésa.
-- `es_admin` no entra en el agujero: tiene su propio chequeo, arriba del bucle.
--
-- No es una decisión que alguien tomó: es que la casilla se llamó distinto.
-- Por eso esto no se consulta, se arregla.
--
-- ── QUÉ CAMBIA ─────────────────────────────────────────────────────────────
--
-- El patrón pasa de `puede\_ver\_%` a `puede\_%`. Nada más. El candado sólo se
-- vuelve MÁS estricto: los administradores siguen saliendo por el
-- `es_admin_actual()` de arriba y ninguna pantalla del ERP deja que un
-- no-administrador toque permisos, así que no hay flujo legítimo que se rompa.
--
-- Es una función, no una columna: no rompe ningún `select` del código viejo.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.trg_perfiles_no_autoescalar()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_viejo jsonb;
  v_nuevo jsonb;
  v_campo text;
begin
  if auth.uid() is null then
    return NEW;
  end if;

  if es_admin_actual() then
    return NEW;
  end if;

  if NEW.es_admin is distinct from OLD.es_admin then
    raise exception 'Solo un administrador puede dar o sacar el permiso de administrador.'
      using errcode = 'insufficient_privilege';
  end if;

  v_viejo := to_jsonb(OLD);
  v_nuevo := to_jsonb(NEW);

  for v_campo in select jsonb_object_keys(v_viejo) loop
    -- 💣 Antes decía `puede\_ver\_%` y dejaba afuera `puede_anular_ventas`, que
    -- es la casilla que borra ventas cobradas. Cualquier casilla que empiece
    -- con `puede_` es un permiso: se miran todas.
    if v_campo like 'puede\_%' or v_campo = 'local_restringido' then
      if v_viejo -> v_campo is distinct from v_nuevo -> v_campo then
        raise exception
          'Solo un administrador puede cambiar los permisos (intentaste cambiar "%").', v_campo
          using errcode = 'insufficient_privilege';
      end if;
    end if;
  end loop;

  return NEW;
end
$fn$;

-- ═══════════════════════════════════════════════════════════════════════════
-- GUARDARRAÍL
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠️ No se puede probar el disparador desde acá: la Management API corre como
-- `postgres`, `auth.uid()` da nulo y la función sale por la primera guarda.
-- Lo que SÍ se puede verificar, y es lo que importa, es que no quede ninguna
-- casilla de permiso fuera del patrón — hoy y el día que se agregue otra.
do $guardia$
declare
  v_afuera text;
  v_n      integer;
  v_def    text;
begin
  -- 1 · Ninguna columna de permiso queda fuera del candado.
  select string_agg(column_name, ', '), count(*)
    into v_afuera, v_n
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'perfiles'
     and data_type = 'boolean'
     and column_name <> 'es_admin'
     and not (column_name like 'puede\_%');
  if v_n > 0 then
    raise exception 'Quedaron % casilla(s) de permiso fuera del candado: %. Hay que nombrarlas puede_… o agregarlas a mano.', v_n, v_afuera;
  end if;

  -- 2 · Y el disparador está prendido sobre la tabla.
  --
  -- ⚠️ El disparador se llama `perfiles_no_autoescalar` y la función
  -- `trg_perfiles_no_autoescalar`: el prefijo `trg_` está del lado de la
  -- FUNCIÓN, al revés de lo que se usa en el resto del repo. Este guardarraíl
  -- se puso rojo la primera vez justo por eso, así que por las dudas se busca
  -- por la función que ejecuta y no por el nombre.
  select count(*) into v_n
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where c.relname = 'perfiles' and not t.tgisinternal
     and pg_get_triggerdef(t.oid) like '%trg_perfiles_no_autoescalar()%';
  if v_n <> 1 then
    raise exception 'Esperaba 1 disparador que ejecute trg_perfiles_no_autoescalar sobre perfiles y encontré %.', v_n;
  end if;

  -- 3 · El testigo del cambio: la función ya no lleva el patrón viejo.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'trg_perfiles_no_autoescalar';
  if v_def like '%puede\_ver\_%%' then
    raise exception 'La función sigue con el patrón viejo puede_ver_: el agujero no se cerró.';
  end if;
  if v_def not like '%puede\_%%' then
    raise exception 'La función quedó sin ningún patrón de permisos. Algo salió mal.';
  end if;

  raise notice 'Candado OK · las 21 casillas de permiso quedan adentro, incluida puede_anular_ventas';
end;
$guardia$;
