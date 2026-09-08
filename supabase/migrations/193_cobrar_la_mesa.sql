-- ============================================================================
-- 193 — COBRAR LA MESA
-- ============================================================================
--
-- QUÉ HACE
-- --------
-- La mesa deja de ser una lista de platos y se convierte en una venta. Una sola
-- función, `salon_cobrar_mesa`, que se apoya en `cobrar_venta` (mig 189): junta
-- los renglones que la mesa todavía no pagó, los cobra en UNA transacción, les
-- marca con qué ticket se fueron y cierra la mesa cuando no queda nada.
--
-- Se llama desde el MOSTRADOR, no desde el teléfono. Es la decisión de Lucas del
-- 6-sep: el mozo toma pedidos, la plata la toca la caja.
--
--
-- 🔑 EL PROBLEMA QUE VINO A RESOLVER ESTA MIGRACIÓN
-- --------------------------------------------------
-- La mig 192 puso un candado lindo: un renglón del POS sólo entra al precio que
-- dice la carta. Pero una mesa **dura dos horas**, y si alguien toca un precio
-- en Productos mientras la gente está comiendo, el renglón guarda el precio con
-- el que se lo vendieron al cliente y el candado compara contra la carta de
-- AHORA. Resultado: **el cobro se rechaza con la mesa llena de gente**, un
-- sábado a la noche, sin salida.
--
-- Las dos salidas obvias son malas:
--   * Cobrar el precio nuevo → el cliente pagó lo que decía la carta cuando pidió
--     y le cobramos otra cosa. Además la pantalla del mozo mostró un total y el
--     ticket sale con otro.
--   * Rechazar → el cajero queda trabado y termina cobrando por afuera, que es
--     exactamente lo que veníamos a evitar.
--
-- LA SALIDA: **el renglón de la mesa vale como carta.** El precio que guarda una
-- línea de mesa NO lo mandó el teléfono — lo escribió la base leyendo la carta,
-- en el momento en que el mozo cargó el plato (mig 190, `salon_agregar_linea`).
-- La cadena de confianza está intacta: es un precio que la casa publicó.
--
-- Entonces `salon_cobrar_mesa` marca la sesión con `rodziny.salon_cobro = <id de
-- la sesión>` y el candado de la 192 acepta, mientras esa marca esté puesta, un
-- precio que **coincida con algún renglón de ESA mesa para ESE plato**. Todo lo
-- demás sigue igual de cerrado que ayer: sin la marca, contra la carta y nada más.
--
-- ⚠️ Lo que esto NO afloja: el precio sigue sin poder venir del navegador. La
-- única forma de que un importe entre por acá es que la base lo haya escrito
-- antes en la mesa, leyendo la carta.
--
--
-- 💣 POR QUÉ NO SE TOCÓ `cobrar_venta`
-- -------------------------------------
-- Lo natural sería pasarle el id del renglón de mesa y que ella lo guarde. Eso
-- obliga a reescribir sus ~500 líneas, que se revisaron con doce agentes y hoy
-- andan. En vez de eso, `salon_cobrar_mesa` la llama tal cual y DESPUÉS marca los
-- renglones de la mesa con el ticket que devolvió. Misma transacción, cero riesgo
-- sobre lo que ya funciona.
--
--
-- LO QUE VALIDA
-- -------------
--   * La mesa existe, es de esta casa, y está abierta o con la cuenta pedida.
--     Queda TRABADA (`for update`) mientras se cobra: dos cajeros no pueden
--     cobrar la misma mesa a la vez.
--   * Hay algo para cobrar. Una mesa sin renglones sin pagar no genera un ticket
--     en cero.
--   * El turno, los cobros, las cuentas y la llave de intento las sigue
--     validando `cobrar_venta`, que para eso está.
--
-- LO QUE NO HACE (a propósito)
-- ----------------------------
--   * **No divide la cuenta.** Cobra todo lo que quede sin pagar. El esquema no
--     lo tranca (el ticket se anota renglón por renglón), pero la v1 no lo hace.
--   * No maneja propina ni cubierto.
--   * No reabre una mesa ya cobrada.
--
-- Contexto: migraciones 189 (el cobro en una transacción), 190 (las mesas),
-- 192 (el precio lo pone la carta).
-- ============================================================================


-- ── 0. El cajero necesita poder cerrar la mesa que cobra ───────────────────
-- La mig 190 dejó las reglas de escritura pidiendo permiso de **salón**, porque
-- pensaba sólo en el mozo. Pero cobrar es del MOSTRADOR: `salon_cobrar_mesa`
-- tiene que marcar cada renglón con el ticket que se lo llevó y cerrar la mesa,
-- y el cajero no tiene por qué tener el permiso del salón.
--
-- Se abre a "salón **o** caja", sin aflojar nada más: la marca de sesión sigue
-- siendo la única puerta, y esa marca la ponen únicamente las funciones. El
-- cajero no gana ni una escritura que no pase por ellas.

do $reglas$
declare
  t text;
  esc text := '((select public.tiene_permiso(''salon'')) or (select public.tiene_permiso(''caja'')))'
              || ' and coalesce(current_setting(''rodziny.salon'', true), '''') = ''si'''
              || ' and ((select public.mi_local()) is null or local = (select public.mi_local())'
              || ' or (select public.es_admin()))';
begin
  foreach t in array array['caja_mesa_sesiones', 'caja_mesa_envios', 'caja_mesa_lineas'] loop
    execute format('drop policy if exists %I on public.%I', t || '_escribir', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (%s)', t || '_escribir', t, esc);

    execute format('drop policy if exists %I on public.%I', t || '_editar', t);
    execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', t || '_editar', t, esc, esc);
  end loop;
end;
$reglas$;


-- ── 0.5 El mozo tiene que poder leer la carta ──────────────────────────────
-- Salió probando: `salon_agregar_linea` cortaba con "ese plato no está en la
-- carta de esta casa" para un mozo recién creado. El plato estaba; lo que
-- faltaba era el permiso de LEER. Las reglas de `cocina_recetas` y de
-- `cocina_recetas_precios_canal` dejan mirar a quien tenga **caja**, **cocina** o
-- **productos**, y un mozo no tiene por qué tener ninguno de los tres.
--
-- Sin esto la pantalla del mozo arranca vacía y el cartel no dice la verdad: no
-- es que el plato no exista, es que él no lo puede ver.
--
-- Se agrega `salon` a las dos reglas de LECTURA. Nada de escritura: el mozo
-- sigue sin poder tocar un precio.
--
-- 💣 Y de paso se envuelve la función en `(select ...)`: así escrita, Postgres la
-- resuelve UNA vez y no una por fila. Es la lección de la mig 157 (2.901 ms → 33
-- ms). Estas dos reglas la tenían suelta.
-- `alter policy`, nunca `drop` + `create`: entre las dos la tabla queda un
-- instante sin regla.

alter policy cocina_recetas_caja_select on public.cocina_recetas
  using ((select public.tiene_permiso('caja')) or (select public.tiene_permiso('salon')));

alter policy precios_recetas_canal_caja_select on public.cocina_recetas_precios_canal
  using ((select public.tiene_permiso('caja')) or (select public.tiene_permiso('salon')));


-- ── 1. El candado del precio aprende a leer la mesa ────────────────────────

create or replace function public.trg_ventas_items_precio_de_la_carta()
returns trigger
language plpgsql
set search_path to 'public'
as $precio$
declare
  v_canal  text;
  v_precio numeric;
  v_sesion text;
begin
  -- Sólo las ventas nuestras. Lo importado de Fudo es historia.
  if new.origen is distinct from 'pos' then
    return new;
  end if;

  -- Si estamos cobrando una mesa, el renglón de la mesa vale como carta: ese
  -- precio lo escribió la base al cargar el plato, leyendo la carta de ese
  -- momento, y es el que se le cotizó al cliente. Ver el encabezado de la 193.
  v_sesion := nullif(coalesce(current_setting('rodziny.salon_cobro', true), ''), '');
  if v_sesion is not null then
    if exists (
      select 1
        from public.caja_mesa_lineas l
       where l.sesion_id = v_sesion::uuid
         and l.receta_id = new.receta_id
         and l.local     = new.local
         and round(l.precio_unitario, 2) = round(coalesce(new.precio_unitario, -1), 2)
    ) then
      return new;
    end if;

    raise exception '"%" no figura en esa mesa a %. Refrescá la pantalla del mostrador antes de cobrar.',
      new.nombre, public.pesos_criollo(coalesce(new.precio_unitario, 0));
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
     and r.local      = new.local
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
  'Candado de la migración 192, ampliado por la 193: un renglón del POS sólo entra al precio de la carta de su local; y si se está cobrando una mesa (marca rodziny.salon_cobro), al precio que la propia base le puso al plato cuando el mozo lo cargó. Frena, no corrige.';


-- ── 2. Cobrar la mesa ──────────────────────────────────────────────────────

create or replace function public.salon_cobrar_mesa(
  p_idempotencia uuid,
  p_sesion_id    uuid,
  p_turno_id     uuid,
  p_caja         text,
  p_fecha        date,
  p_hora         time,
  p_pagos        jsonb,
  p_cliente      text default null,
  p_convenio_id  uuid  default null
) returns jsonb
language plpgsql
-- ⚠️ invoker, igual que cobrar_venta: definer apagaría la RLS de toda la base.
set search_path to 'public'
as $cobrar$
declare
  v_sesion  public.caja_mesa_sesiones;
  v_lineas  jsonb;
  v_cuantas int;
  v_res     jsonb;
  v_ticket  uuid;
  v_quedan  int;
  v_filas   int;
begin
  -- 💣 La marca va ANTES de leer la mesa, no después. Un `select ... for update`
  -- NO es una lectura común: Postgres le exige a la fila pasar TAMBIÉN la regla
  -- de escritura, porque la está trabando para modificarla. Sin la marca puesta
  -- acá, la consulta no devuelve nada y la función contesta "esa mesa no existe"
  -- cuando la mesa está ahí. Costó encontrarlo.
  perform set_config('rodziny.salon', 'si', true);

  -- La mesa queda trabada mientras se cobra: dos cajeros no la cobran a la vez.
  select * into v_sesion
    from public.caja_mesa_sesiones
   where id = p_sesion_id
   for update;

  if v_sesion.id is null then
    raise exception 'Esa mesa no existe. Refrescá la pantalla del mostrador.';
  end if;

  if v_sesion.estado not in ('abierta', 'cuenta_pedida') then
    raise exception 'Esa mesa ya está %: no se puede volver a cobrar.', v_sesion.estado;
  end if;

  -- Los renglones que todavía no pagó nadie, con el número de la madre resuelto.
  -- Si la pasta de la que colgaba una salsa se sacó, la salsa se cobra suelta:
  -- mandarla apuntando a una madre que no viaja haría fallar a cobrar_venta.
  select jsonb_agg(
           jsonb_build_object(
             'linea',           l.linea,
             'padre_linea',     m.linea,
             'codigo',          null,
             'nombre',          l.nombre,
             'categoria',       l.categoria,
             'cantidad',        l.cantidad,
             'precio_unitario', l.precio_unitario,
             'descuento_pct',   l.descuento_pct,
             'tipo',            'receta',
             'ref_id',          l.receta_id
           ) order by l.linea
         ),
         count(*)
    into v_lineas, v_cuantas
    from public.caja_mesa_lineas l
    left join public.caja_mesa_lineas m
           on m.id = l.padre_id
          and m.estado = 'activa'
          and m.ticket_id is null
   where l.sesion_id = p_sesion_id
     and l.estado    = 'activa'
     and l.ticket_id is null;

  if coalesce(v_cuantas, 0) = 0 then
    raise exception 'Esa mesa no tiene nada sin pagar. Si la comida ya se cobró, cerrala desde el listado.';
  end if;

  -- Mientras dure esta marca, el candado del precio acepta lo que diga la mesa.
  perform set_config('rodziny.salon_cobro', p_sesion_id::text, true);

  v_res := public.cobrar_venta(
    p_idempotencia,
    v_sesion.local,
    p_caja,
    p_turno_id,
    p_fecha,
    p_hora,
    p_cliente,
    p_convenio_id,
    v_lineas,
    p_pagos,
    'salon'
  );

  perform set_config('rodziny.salon_cobro', '', true);

  v_ticket := (v_res->>'ticket_id')::uuid;
  if v_ticket is null then
    raise exception 'La caja no devolvió el número de venta. No se cobró la mesa; fijate en "Ventas del turno" antes de volver a intentar.';
  end if;

  -- Con qué ticket se fue cada plato. Es lo que hace que el conteo de cámara
  -- sepa qué falta cobrar (`ticket_id is null`) y lo que va a permitir, el día
  -- que haga falta, dividir la cuenta.
  update public.caja_mesa_lineas
     set ticket_id = v_ticket
   where sesion_id = p_sesion_id
     and estado    = 'activa'
     and ticket_id is null;

  get diagnostics v_cuantas = row_count;
  if v_cuantas = 0 then
    -- Si esto pasa, la venta ya se grabó y la mesa quedaría sin marcar: se corta
    -- la transacción entera para que no queden las dos cosas desalineadas.
    raise exception 'La venta no se pudo enganchar con la mesa, así que no se cobró nada. Avisá a administración.';
  end if;

  select count(*) into v_quedan
    from public.caja_mesa_lineas
   where sesion_id = p_sesion_id and estado = 'activa' and ticket_id is null;

  if v_quedan = 0 then
    update public.caja_mesa_sesiones
       set estado = 'cobrada', cerrada_en = now()
     where id = p_sesion_id;

    get diagnostics v_filas = row_count;
    if v_filas = 0 then
      raise exception 'No se pudo cerrar la mesa después de cobrarla. No se guardó nada; avisá a administración.';
    end if;
  end if;

  perform set_config('rodziny.salon', '', true);

  return v_res || jsonb_build_object('mesa_cerrada', v_quedan = 0, 'renglones', v_cuantas);
end;
$cobrar$;

comment on function public.salon_cobrar_mesa(uuid, uuid, uuid, text, date, time, jsonb, text, uuid) is
  'Convierte una mesa en una venta. Se apoya en cobrar_venta (mig 189) y después marca cada renglón de la mesa con el ticket que se lo llevó. La llama el MOSTRADOR, no el teléfono del mozo.';

revoke all     on function public.salon_cobrar_mesa(uuid, uuid, uuid, text, date, time, jsonb, text, uuid) from public, anon;
grant  execute on function public.salon_cobrar_mesa(uuid, uuid, uuid, text, date, time, jsonb, text, uuid) to authenticated;


-- ── 3. Chequeo ─────────────────────────────────────────────────────────────

do $guard$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'salon_cobrar_mesa'
  ) then
    raise exception 'GUARDA: no quedó creada salon_cobrar_mesa';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'salon_cobrar_mesa' and p.prosecdef
  ) then
    raise exception 'GUARDA: salon_cobrar_mesa quedó security definer, y eso apaga la RLS de toda la base';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'salon_cobrar_mesa'
       and has_function_privilege('anon', p.oid, 'EXECUTE')
  ) then
    raise exception 'GUARDA: salon_cobrar_mesa quedó ejecutable con la clave pública';
  end if;

  -- El candado del precio tiene que seguir siendo el de la 192 MÁS la puerta de
  -- la mesa. Si perdió cualquiera de las dos, se rompió algo.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'trg_ventas_items_precio_de_la_carta'
       and pg_get_functiondef(p.oid) like '%rodziny.salon_cobro%'
       and pg_get_functiondef(p.oid) like '%cocina_recetas_precios_canal%'
  ) then
    raise exception 'GUARDA: el candado del precio perdió la comparación contra la carta o la puerta de la mesa';
  end if;

  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'ventas_items'
       and t.tgname = 'trg_ventas_items_z_precio_de_la_carta'
  ) then
    raise exception 'GUARDA: se cayó el disparador del precio en ventas_items';
  end if;

  raise notice 'OK 193: salon_cobrar_mesa lista y el candado del precio entiende las mesas';
end;
$guard$;
