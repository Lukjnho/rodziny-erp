-- ============================================================================
-- 187 — CADA CAJERO VE SOLO SU CASA
-- ============================================================================
--
-- QUÉ PASA HOY
-- ------------
-- Las reglas del POS dicen apenas "tiene permiso de caja y el ticket es del
-- POS". No dicen NADA del local. O sea que Marcos, que en la pantalla figura
-- "solo vedia", puede leer desde la consola del navegador los turnos, los
-- tickets, los renglones y los cobros de Saavedra. La columna
-- `perfiles.local_restringido` existe desde hace meses y NO la usa ninguna
-- regla de la base: hasta hoy fue un filtro de pantalla, no una frontera.
--
-- Esta migración la baja a la base. Es el piso del salón de Saavedra: sin esto,
-- el cajero nuevo de Saavedra vería y tocaría la plata de Vedia.
--
--
-- LA REGLA, EN CRIOLLO
-- --------------------
--   * El que NO tiene local asignado sigue viendo TODO (es lo que necesita
--     administración para mirar consolidado, y es como funciona hoy).
--   * El que tiene local asignado, ve y escribe SOLO ese local.
--   * El administrador ve todo, siempre.
--
-- Decidido el 7-sep-2026 con Lucas: NO se agrega un candado en la base que
-- prohíba "caja sin local". Se resolvió en la pantalla de Usuarios (commit
-- b3fe72a): el alta obliga a elegir local para un cajero, y la grilla no deja
-- prender la casilla de Caja si la persona no tiene uno.
--
--
-- ⚠️ HASTA DÓNDE LLEGA ESTA FRONTERA (leer antes de confiar en ella)
-- ------------------------------------------------------------------
-- Cubre LA PLATA: turnos, arqueo, tickets, renglones, cobros y comprobantes.
--
-- NO cubre, a propósito (decisión de Lucas, 7-sep-2026): la carta y sus costos
-- (`cocina_recetas`, `cocina_recetas_precios_canal`), los convenios
-- (`convenios`), la configuración fiscal (`arca_config`) ni los datos de los
-- clientes (`clientes_fiscales`). El cajero de Saavedra va a seguir pudiendo
-- leer el catálogo, los precios y los convenios de Vedia si los pide a mano.
-- En pantalla no se nota porque el POS ya filtra por local.
--
-- ⚠️⚠️ Y LO MÁS IMPORTANTE: ESTA FRONTERA SE BORRA SOLA SI AL CAJERO SE LE DA
-- EL PERMISO DE **ventas** O EL DE **finanzas/gastos**. En Postgres las reglas
-- permisivas se SUMAN con O, no se restan, y `ventas_tickets_all`,
-- `ventas_items_all`, `ventas_pagos_all` y `cierres_caja_finanzas_o_gastos_all`
-- quedan SIN filtro de local, a propósito (los usa administración para el
-- consolidado). Con cualquiera de esos permisos el cajero vuelve a ver y a
-- escribir las dos casas enteras, sin un cartel.
--
-- Y la pantalla del POS empuja justo a eso:
--   * CajaPage.tsx:530  → para que el cajero vea "cuánto tendría que haber" en
--                         el arqueo hace falta finanzas o gastos.
--   * CajaPage.tsx:1162 → para que pueda anular una venta hace falta ventas.
-- El día que haga falta cualquiera de las dos, esos botones tienen que salir de
-- una casilla propia, NO de finanzas/gastos/ventas. Si no, esta migración deja
-- de servir para algo.
--
--
-- 💣 POR QUÉ EL FILTRO ESTÁ ESCRITO DESARMADO Y NO COMO UNA FUNCIÓN
-- ------------------------------------------------------------------
-- Lo natural sería `es_de_mi_local(local)`. NO se hace: al pasarle la columna,
-- Postgres tiene que llamar a la función UNA VEZ POR FILA, y adentro cada
-- llamada consulta `perfiles` de nuevo. Medido sobre `ventas_items` (124.869
-- filas): 217 ms contra 2.246 ms. Es exactamente el problema que la migración
-- 157 vino a sacar (2.901 ms → 33 ms envolviendo la función en `(select ...)`).
--
-- Por eso el filtro va escrito así, con los `(select ...)` afuera:
--
--     (select public.mi_local()) is null
--     or local = (select public.mi_local())
--     or (select public.es_admin())
--
-- Postgres resuelve los tres `select` UNA sola vez para toda la consulta, y lo
-- único que corre por fila es un `=`. De paso se envuelve `tiene_permiso` en
-- `(select ...)` en las 9 reglas que la 157 se salteó.
--
--
-- 💣 SE USA `alter policy`, NUNCA `drop` + `create`
-- --------------------------------------------------
-- Con drop+create la tabla queda un instante SIN regla y todas las filas
-- visibles. Y `tiene_permiso` NO se dropea nunca: hay 96 reglas colgando de
-- ella, un `drop ... cascade` las borraría todas y el ERP quedaría mudo.
-- Se reemplaza con `create or replace`, que conserva los permisos.
--
--
-- LO QUE ESTA MIGRACIÓN **NO** HACE
-- ----------------------------------
-- No crea el cajero de Saavedra. Los perfiles nacen de un disparador cuando se
-- crea el login (`on_auth_user_created`), así que hace falta un mail y una
-- contraseña: eso se hace desde Usuarios → Crear usuario, eligiendo el rol
-- "Cajero" y el local Saavedra.
--
-- ⚠️ REGLA DE ORO OPERATIVA: NUNCA cambiarle el local a alguien que tenga la
-- caja abierta. Si se hace, el turno le desaparece de la pantalla, el POS le
-- ofrece abrir uno nuevo, y el viejo queda abierto para siempre con la plata
-- adentro — y solo lo destraba un administrador. La pantalla de Usuarios ahora
-- avisa antes de dejarlo cambiar.
-- ============================================================================


-- ── 1. El permiso nuevo del salón ───────────────────────────────────────────
-- Nace protegido solo: el disparador `perfiles_no_autoescalar` (migración 150)
-- recorre TODAS las columnas que empiecen con `puede_ver_`, no tiene la lista
-- escrita a mano. Así que nadie puede auto-asignárselo.
alter table public.perfiles
  add column if not exists puede_ver_salon boolean not null default false;

comment on column public.perfiles.puede_ver_salon is
  'Deja entrar a la pantalla de mesas del salón (Saavedra). Queda colgado hasta que exista esa pantalla.';


-- ── 2. La función de permisos, con los módulos que le faltaban ──────────────
-- Le faltaban CINCO que existen en `perfiles` desde hace meses y devolvían
-- false siempre: flujo_caja, productos, agenda, convenios y alertas_finanzas.
-- Nadie lo notó porque ninguna regla de la base pregunta por ellos todavía
-- (verificado sobre las 96 reglas y las 136 llamadas del repo) — o sea que
-- esto CORRIGE una contradicción, no le abre la puerta a nadie.
--
-- Se declara STABLE, que es lo que de verdad es. Aclaración honesta: eso NO la
-- hace más rápida. Lo que la aceleró en la 157 fue envolverla en `(select ...)`
-- en cada regla, con la función todavía volátil.
create or replace function public.tiene_permiso(modulo text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when auth.uid() is null then false
    when (select es_admin from perfiles where user_id = auth.uid()) then true
    else coalesce(
      (select case modulo
        when 'dashboard' then puede_ver_dashboard
        when 'ventas' then puede_ver_ventas
        when 'finanzas' then puede_ver_finanzas
        when 'edr' then puede_ver_edr
        when 'gastos' then puede_ver_gastos
        when 'amortizaciones' then puede_ver_amortizaciones
        when 'rrhh' then puede_ver_rrhh
        when 'compras' then puede_ver_compras
        when 'usuarios' then puede_ver_usuarios
        when 'cocina' then puede_ver_cocina
        when 'almacen' then puede_ver_almacen
        when 'integraciones' then puede_ver_integraciones
        when 'caja' then puede_ver_caja
        -- los cinco que faltaban:
        when 'flujo_caja' then puede_ver_flujo_caja
        when 'productos' then puede_ver_productos
        when 'agenda' then puede_ver_agenda
        when 'convenios' then puede_ver_convenios
        when 'alertas_finanzas' then puede_ver_alertas_finanzas
        -- el nuevo:
        when 'salon' then puede_ver_salon
        else false end
      from perfiles where user_id = auth.uid()), false)
  end;
$$;


-- ── 3. Con qué local trabaja el que está mirando ────────────────────────────
-- NULL = no tiene local asignado = ve las dos casas.
-- Es SECURITY DEFINER porque `perfiles` no la puede leer cualquiera; devuelve
-- una sola palabra ('vedia' / 'saavedra'), ningún dato sensible.
create or replace function public.mi_local()
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select local_restringido from public.perfiles where user_id = auth.uid();
$$;

comment on function public.mi_local() is
  'El local al que está atado el usuario actual, o NULL si ve los dos. Usada por las reglas del POS (migración 187).';

-- Mismos permisos que es_admin() (migración 154): anon la puede llamar y le
-- contesta NULL, así nunca aparece un "permission denied for function".
revoke all on function public.mi_local() from public;
grant execute on function public.mi_local() to anon, authenticated, service_role;


-- ============================================================================
-- 4. LAS 15 REGLAS DEL POS
-- ============================================================================
-- Son 15, no 6: si UNA sola se queda sin el filtro, la puerta sigue abierta por
-- ese lado (las reglas se suman con O).
-- ============================================================================

-- ── cierres_caja: los turnos ────────────────────────────────────────────────

alter policy cierres_caja_del_pos on public.cierres_caja
  using (
    (select public.tiene_permiso('caja'))
    and origen = 'pos'
    and (
      (select public.mi_local()) is null
      or local = (select public.mi_local())
      or (select public.es_admin())
    )
  );

alter policy cierres_caja_abrir_pos on public.cierres_caja
  with check (
    (select public.tiene_permiso('caja'))
    and origen = 'pos'
    and (
      (select public.mi_local()) is null
      or local = (select public.mi_local())
      or (select public.es_admin())
    )
  );

-- ⚠️ El filtro va en las DOS mitades. El disparador de la 152 congela
-- `fondo_apertura` y `origen` de un turno abierto, pero NO congela `local`: sin
-- el WITH CHECK, un cajero podría mudarse su propio turno abierto (con su
-- arqueo y sus ventas) a la otra casa desde la consola del navegador.
alter policy cierres_caja_cerrar_pos on public.cierres_caja
  using (
    (select public.tiene_permiso('caja'))
    and origen = 'pos'
    and hora_cierre is null
    and (
      (select public.mi_local()) is null
      or local = (select public.mi_local())
      or (select public.es_admin())
    )
  )
  with check (
    (select public.tiene_permiso('caja'))
    and origen = 'pos'
    and (
      (select public.mi_local()) is null
      or local = (select public.mi_local())
      or (select public.es_admin())
    )
  );


-- ── cierres_caja_medios: el desglose del arqueo ─────────────────────────────
-- Esta tabla NO tiene columna `local`: cuelga del turno, así que el filtro va
-- adentro del EXISTS, sobre el local del turno padre.

alter policy cierres_caja_medios_caja_select on public.cierres_caja_medios
  using (
    (select public.tiene_permiso('caja'))
    and exists (
      select 1 from public.cierres_caja c
       where c.id = cierres_caja_medios.cierre_caja_id
         and c.origen = 'pos'
         and (
           (select public.mi_local()) is null
           or c.local = (select public.mi_local())
           or (select public.es_admin())
         )
    )
  );

alter policy cierres_caja_medios_caja_insert on public.cierres_caja_medios
  with check (
    (select public.tiene_permiso('caja'))
    and exists (
      select 1 from public.cierres_caja c
       where c.id = cierres_caja_medios.cierre_caja_id
         and c.origen = 'pos'
         and (
           (select public.mi_local()) is null
           or c.local = (select public.mi_local())
           or (select public.es_admin())
         )
    )
  );

alter policy cierres_caja_medios_caja_delete on public.cierres_caja_medios
  using (
    (select public.tiene_permiso('caja'))
    and exists (
      select 1 from public.cierres_caja c
       where c.id = cierres_caja_medios.cierre_caja_id
         and c.origen = 'pos'
         and c.hora_cierre is null
         and (
           (select public.mi_local()) is null
           or c.local = (select public.mi_local())
           or (select public.es_admin())
         )
    )
  );


-- ── ventas_tickets ──────────────────────────────────────────────────────────

alter policy ventas_tickets_caja_ver on public.ventas_tickets
  using (
    (select public.tiene_permiso('caja'))
    and origen = 'pos'
    and (
      (select public.mi_local()) is null
      or local = (select public.mi_local())
      or (select public.es_admin())
    )
  );

alter policy ventas_tickets_caja_cobrar on public.ventas_tickets
  with check (
    (select public.tiene_permiso('caja'))
    and origen = 'pos'
    and (
      (select public.mi_local()) is null
      or local = (select public.mi_local())
      or (select public.es_admin())
    )
  );

-- Esta es la única forma que tiene el cajero de BORRAR, y la 157 la había
-- dejado afuera. Entra a propósito: un cajero no tiene por qué poder deshacer
-- un ticket de la otra casa.
alter policy ventas_tickets_caja_deshacer on public.ventas_tickets
  using (
    (select public.tiene_permiso('caja'))
    and origen = 'pos'
    and public.ticket_pos_sin_cobros(id)
    and public.ticket_sin_comprobante(id)
    and exists (
      select 1 from public.cierres_caja c
       where c.id = ventas_tickets.cierre_caja_id
         and c.origen = 'pos'
         and c.hora_cierre is null
    )
    and (
      (select public.mi_local()) is null
      or local = (select public.mi_local())
      or (select public.es_admin())
    )
  );


-- ── ventas_items ────────────────────────────────────────────────────────────

alter policy ventas_items_caja_ver on public.ventas_items
  using (
    (select public.tiene_permiso('caja'))
    and origen = 'pos'
    and (
      (select public.mi_local()) is null
      or local = (select public.mi_local())
      or (select public.es_admin())
    )
  );

alter policy ventas_items_caja_cobrar on public.ventas_items
  with check (
    (select public.tiene_permiso('caja'))
    and origen = 'pos'
    and (
      (select public.mi_local()) is null
      or local = (select public.mi_local())
      or (select public.es_admin())
    )
  );


-- ── ventas_pagos ────────────────────────────────────────────────────────────

alter policy ventas_pagos_caja_ver on public.ventas_pagos
  using (
    (select public.tiene_permiso('caja'))
    and origen = 'pos'
    and (
      (select public.mi_local()) is null
      or local = (select public.mi_local())
      or (select public.es_admin())
    )
  );

alter policy ventas_pagos_caja_cobrar on public.ventas_pagos
  with check (
    (select public.tiene_permiso('caja'))
    and origen = 'pos'
    and (
      (select public.mi_local()) is null
      or local = (select public.mi_local())
      or (select public.es_admin())
    )
  );


-- ── ventas_comprobantes (facturas de ARCA) ──────────────────────────────────
-- 💣 Acá 'ventas' y 'caja' viven en la MISMA regla con un O. Si el filtro se
-- colgara al final con un AND, se le aplicaría también a 'ventas', que esta
-- migración dice explícitamente que NO toca. Por eso el filtro va DENTRO del
-- paréntesis, pegado solo a la rama de caja.

alter policy ventas_comprobantes_ver on public.ventas_comprobantes
  using (
    (select public.tiene_permiso('ventas'))
    or (
      (select public.tiene_permiso('caja'))
      and (
        (select public.mi_local()) is null
        or local = (select public.mi_local())
        or (select public.es_admin())
      )
    )
  );

alter policy ventas_comprobantes_encolar on public.ventas_comprobantes
  with check (
    (
      (select public.tiene_permiso('ventas'))
      or (
        (select public.tiene_permiso('caja'))
        and (
          (select public.mi_local()) is null
          or local = (select public.mi_local())
          or (select public.es_admin())
        )
      )
    )
    and estado = 'pendiente'
    and cae is null
    and numero is null
    and cae_vencimiento is null
    and emitido_at is null
    and intentos = 0
  );


-- ============================================================================
-- 5. GUARDARRAÍL — si algo de esto no se cumple, la migración revienta acá
-- ============================================================================
do $$
declare
  v_secdef boolean;
  v_volatil "char";
  v_config text[];
  v_def text;
  v_con_filtro int;
  v_dependen int;
  v_falta text;
begin
  -- 5.1 La columna del salón existe
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'perfiles'
       and column_name = 'puede_ver_salon'
  ) then
    raise exception 'Falta perfiles.puede_ver_salon';
  end if;

  -- 5.2 tiene_permiso conserva el blindaje (security definer + search_path)
  select p.prosecdef, p.provolatile, p.proconfig, pg_get_functiondef(p.oid)
    into v_secdef, v_volatil, v_config, v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'tiene_permiso' and p.prokind = 'f';

  if v_secdef is not true then
    raise exception 'tiene_permiso perdió el SECURITY DEFINER';
  end if;
  if v_volatil <> 's' then
    raise exception 'tiene_permiso no quedó STABLE (quedó %)', v_volatil;
  end if;
  if v_config is null or not (v_config @> array['search_path=public']) then
    raise exception 'tiene_permiso perdió el search_path fijo (quedó %)', v_config;
  end if;

  -- 5.3 Los cinco módulos que faltaban + el nuevo están en la función
  select string_agg(m, ', ')
    into v_falta
    from unnest(array['flujo_caja','productos','agenda','convenios','alertas_finanzas','salon']) m
   where position(quote_literal(m) in v_def) = 0;
  if v_falta is not null then
    raise exception 'tiene_permiso todavía no resuelve: %', v_falta;
  end if;

  -- 5.4 mi_local existe, con blindaje, y la puede llamar el que se loguea
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'mi_local' and p.prokind = 'f'
       and p.prosecdef and p.provolatile = 's'
  ) then
    raise exception 'mi_local() no quedó bien creada (stable + security definer)';
  end if;
  if not has_function_privilege('authenticated', 'public.mi_local()', 'execute') then
    raise exception 'authenticated no puede ejecutar mi_local(): las reglas del POS reventarían y la caja no abriría';
  end if;
  if not has_function_privilege('authenticated', 'public.tiene_permiso(text)', 'execute') then
    raise exception 'authenticated perdió el execute sobre tiene_permiso(): el ERP quedaría mudo';
  end if;

  -- 5.5 Las 15 reglas del POS tienen el filtro puesto
  select count(*) into v_con_filtro
    from pg_policy p join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and p.polname in (
       'cierres_caja_del_pos','cierres_caja_abrir_pos','cierres_caja_cerrar_pos',
       'cierres_caja_medios_caja_select','cierres_caja_medios_caja_insert','cierres_caja_medios_caja_delete',
       'ventas_tickets_caja_ver','ventas_tickets_caja_cobrar','ventas_tickets_caja_deshacer',
       'ventas_items_caja_ver','ventas_items_caja_cobrar',
       'ventas_pagos_caja_ver','ventas_pagos_caja_cobrar',
       'ventas_comprobantes_ver','ventas_comprobantes_encolar'
     )
     and (
       coalesce(pg_get_expr(p.polqual, p.polrelid), '') like '%mi_local%'
       or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') like '%mi_local%'
     );
  if v_con_filtro <> 15 then
    raise exception 'Solo % de las 15 reglas del POS quedaron con el filtro de local', v_con_filtro;
  end if;

  -- 5.6 No se perdió ninguna regla colgada de tiene_permiso
  select count(*) into v_dependen
    from pg_policy p
   where coalesce(pg_get_expr(p.polqual, p.polrelid), '') like '%tiene_permiso%'
      or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') like '%tiene_permiso%';
  if v_dependen < 96 then
    raise exception 'Quedaron solo % reglas usando tiene_permiso (eran 96 antes de esta migración): se perdió alguna', v_dependen;
  end if;

  raise notice 'OK 187: % reglas del POS con filtro de local, % reglas usando tiene_permiso', v_con_filtro, v_dependen;
end $$;
