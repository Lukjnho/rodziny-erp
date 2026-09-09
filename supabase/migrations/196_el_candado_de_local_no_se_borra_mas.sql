-- 196 — El candado de local deja de borrarse solo, y anular sale de su propia casilla
--
--
-- ══════════════════════════════════════════════════════════════════════════════
-- LA TRAMPA QUE SE CIERRA
-- ══════════════════════════════════════════════════════════════════════════════
--
-- La migración 187 hizo que cada cajero vea solo la plata de su casa. Pero dejó
-- una trampa escrita en su propio encabezado:
--
--     «Darle al cajero el permiso de `ventas` o el de `finanzas`/`gastos` anula la
--      frontera entera, en silencio.»
--
-- Postgres suma las reglas permisivas con OR. Cinco reglas de administración
-- quedaron SIN filtro de local a propósito, para el consolidado:
--
--     ventas_tickets_all · ventas_items_all · ventas_pagos_all
--     cierres_caja_finanzas_o_gastos_all · cierres_caja_medios_admin
--
-- Y la pantalla del POS empuja justo a pedirlas:
--     · para ver "cuánto tendría que haber" en el arqueo hacía falta finanzas/gastos
--     · para anular una venta cobrada hacía falta ventas
--
-- ⇒ El día que el cajero de Saavedra recibiera cualquiera de las dos, volvía a ver
--   la plata de Vedia entera. Sin cartel, sin error, sin manera de notarlo.
--
--
-- ══════════════════════════════════════════════════════════════════════════════
-- POR QUÉ ESTO NO LE CAMBIA NADA A NADIE (medido antes de escribirlo)
-- ══════════════════════════════════════════════════════════════════════════════
--
-- `mi_local()` devuelve `perfiles.local_restringido`, que es NULL para todos los de
-- administración. El filtro que se agrega abajo empieza con
-- `(select mi_local()) is null` ⇒ para ellos pasa siempre, como hasta ahora.
--
-- Y al 8-sep-2026, contra la base: de las 11 personas del sistema, las 5 que tienen
-- local restringido (Nicolás, Rodziny SG, Vero, José, Marcos) NO tienen ninguno de
-- los tres permisos; y las 4 que sí los tienen (martin, maxi, tamara, tomas) NO
-- tienen local restringido. **La intersección hoy es vacía**: nadie cambia de
-- alcance con esta migración. Lo que cambia es que mañana, cuando esa intersección
-- deje de ser vacía, la frontera aguanta.
--
-- 🔑 Es el arreglo de fondo, no el rodeo: en vez de esquivar los permisos que
-- rompen el candado, el candado deja de poder romperse.
--
--
-- ══════════════════════════════════════════════════════════════════════════════
-- Y LA CASILLA QUE FALTABA
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Aun con el candado arreglado, darle `ventas` a un cajero para que pueda anular
-- es un martillazo: `ventas_*_all` es permiso ALL, o sea que podría además EDITAR
-- cualquier venta vieja de su casa, de cualquier turno, incluso cerrado.
--
-- Se agregan dos casillas propias:
--   · `puede_anular_ventas`   — anular una venta cobrada, SOLO del turno abierto,
--                               SOLO de su casa y SOLO si no tiene comprobante fiscal.
--   · `puede_ver_esperado_caja` — ver los esperados del arqueo.
--     ⚠️ Esta APAGA el arqueo a ciegas de esa persona: hoy el cajero cuenta la plata
--     sin saber cuánto tendría que haber, y por eso el conteo sirve de control. Es
--     una decisión de negocio, no un detalle técnico. Por eso es una casilla aparte
--     y el rótulo lo dice.
--
begin;

-- ══════════════════════════════════════════════════════════════════════════════
-- §1 · LAS CINCO REGLAS DE ADMINISTRACIÓN APRENDEN EL LOCAL
-- ══════════════════════════════════════════════════════════════════════════════
--
-- 💣 `alter policy`, NUNCA `drop` + `create`: con drop la tabla queda un instante
-- sin regla y todas las filas quedan visibles.
--
-- 💣 Y el filtro va DESARMADO, con los `(select ...)` afuera, para que Postgres los
-- levante a InitPlan y por fila corra solo un `=`. Pasarle la columna a una función
-- la hace correr una vez por fila: medido sobre ventas_items (124.869 filas), 217 ms
-- contra 2.246 ms. Es la lección de la mig 157.

alter policy ventas_tickets_all on public.ventas_tickets
  using (
    (select public.tiene_permiso('ventas'))
    and (
      (select public.mi_local()) is null
      or local = (select public.mi_local())
      or (select public.es_admin())
    )
  )
  with check (
    (select public.tiene_permiso('ventas'))
    and (
      (select public.mi_local()) is null
      or local = (select public.mi_local())
      or (select public.es_admin())
    )
  );

alter policy ventas_items_all on public.ventas_items
  using (
    (select public.tiene_permiso('ventas'))
    and (
      (select public.mi_local()) is null
      or local = (select public.mi_local())
      or (select public.es_admin())
    )
  )
  with check (
    (select public.tiene_permiso('ventas'))
    and (
      (select public.mi_local()) is null
      or local = (select public.mi_local())
      or (select public.es_admin())
    )
  );

alter policy ventas_pagos_all on public.ventas_pagos
  using (
    (select public.tiene_permiso('ventas'))
    and (
      (select public.mi_local()) is null
      or local = (select public.mi_local())
      or (select public.es_admin())
    )
  )
  with check (
    (select public.tiene_permiso('ventas'))
    and (
      (select public.mi_local()) is null
      or local = (select public.mi_local())
      or (select public.es_admin())
    )
  );

alter policy cierres_caja_finanzas_o_gastos_all on public.cierres_caja
  using (
    ((select public.tiene_permiso('finanzas')) or (select public.tiene_permiso('gastos')))
    and (
      (select public.mi_local()) is null
      or local = (select public.mi_local())
      or (select public.es_admin())
    )
  )
  with check (
    ((select public.tiene_permiso('finanzas')) or (select public.tiene_permiso('gastos')))
    and (
      (select public.mi_local()) is null
      or local = (select public.mi_local())
      or (select public.es_admin())
    )
  );

-- `cierres_caja_medios` no tiene columna `local`: el local se pregunta subiendo al
-- cierre, igual que ya lo hacen las tres reglas del cajero sobre esta misma tabla.
alter policy cierres_caja_medios_admin on public.cierres_caja_medios
  using (
    ((select public.tiene_permiso('finanzas')) or (select public.tiene_permiso('gastos')))
    and (
      (select public.mi_local()) is null
      or (select public.es_admin())
      or exists (
        select 1 from public.cierres_caja c
         where c.id = cierres_caja_medios.cierre_caja_id
           and c.local = (select public.mi_local())
      )
    )
  )
  with check (
    ((select public.tiene_permiso('finanzas')) or (select public.tiene_permiso('gastos')))
    and (
      (select public.mi_local()) is null
      or (select public.es_admin())
      or exists (
        select 1 from public.cierres_caja c
         where c.id = cierres_caja_medios.cierre_caja_id
           and c.local = (select public.mi_local())
      )
    )
  );

-- ══════════════════════════════════════════════════════════════════════════════
-- §2 · LAS DOS CASILLAS NUEVAS
-- ══════════════════════════════════════════════════════════════════════════════

alter table public.perfiles
  add column if not exists puede_anular_ventas boolean not null default false;
alter table public.perfiles
  add column if not exists puede_ver_esperado_caja boolean not null default false;

comment on column public.perfiles.puede_anular_ventas is
  'Puede anular una venta ya cobrada desde el POS: solo del turno abierto, solo de '
  'su local y solo si no tiene comprobante fiscal. Existe para no tener que dar el '
  'permiso de ventas entero, que además deja editar cualquier venta vieja.';
comment on column public.perfiles.puede_ver_esperado_caja is
  '⚠️ APAGA EL ARQUEO A CIEGAS de esta persona: le muestra cuánto tendría que haber '
  'antes de contar la plata. El conteo deja de servir como control. Es una decisión '
  'de negocio, no un permiso técnico.';

-- 💣 `create or replace`, jamás `drop`: 96 policies cuelgan de esta función y un
-- `drop ... cascade` deja el ERP mudo.
create or replace function public.tiene_permiso(modulo text)
returns boolean
language sql
stable
security definer
set search_path = public
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
        when 'flujo_caja' then puede_ver_flujo_caja
        when 'productos' then puede_ver_productos
        when 'agenda' then puede_ver_agenda
        when 'convenios' then puede_ver_convenios
        when 'alertas_finanzas' then puede_ver_alertas_finanzas
        when 'salon' then puede_ver_salon
        -- los dos nuevos (mig 196):
        when 'anular_ventas' then puede_anular_ventas
        when 'ver_esperado_caja' then puede_ver_esperado_caja
        else false end
      from perfiles where user_id = auth.uid()), false)
  end;
$$;

-- ══════════════════════════════════════════════════════════════════════════════
-- §3 · ANULAR UNA VENTA COBRADA, CON LÍMITES
-- ══════════════════════════════════════════════════════════════════════════════
--
-- La regla que ya existía (`ventas_tickets_caja_deshacer`) deja al cajero borrar un
-- ticket SIN cobros: es el rescate de una venta a medio hacer. Esta es distinta: la
-- venta ya se cobró y hay que darla de baja.
--
-- Los renglones y los cobros se van solos por ON DELETE CASCADE, y el cascade lo
-- ejecuta el sistema: no vuelve a pasar por las reglas de esas tablas. Es lo mismo
-- que ya hace la regla de deshacer, que anda.
--
-- Los cuatro límites, y por qué:
--   · `origen = 'pos'`            — lo que trae Fudo no se toca desde acá.
--   · turno abierto               — con el turno cerrado el arqueo ya se firmó;
--                                   borrar un ticket ahí deja el cierre mintiendo.
--   · sin comprobante fiscal      — si salió por ARCA, no se borra: se hace una NC.
--   · el local de siempre         — la frontera de la 187, sin excepción.
drop policy if exists ventas_tickets_anular on public.ventas_tickets;
create policy ventas_tickets_anular on public.ventas_tickets
  for delete to authenticated
  using (
    (select public.tiene_permiso('anular_ventas'))
    and origen = 'pos'
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

-- ══════════════════════════════════════════════════════════════════════════════
-- §4 · GUARDARRAÍL
-- ══════════════════════════════════════════════════════════════════════════════
do $guard$
declare
  v_n     int;
  v_sin   int;
begin
  -- 1) Las cinco reglas quedaron con el filtro de local puesto.
  select count(*) into v_n
    from pg_policy p join pg_class c on c.oid = p.polrelid
   where p.polname in ('ventas_tickets_all', 'ventas_items_all', 'ventas_pagos_all',
                       'cierres_caja_finanzas_o_gastos_all', 'cierres_caja_medios_admin')
     and pg_get_expr(p.polqual, p.polrelid) like '%mi_local%';
  if v_n <> 5 then
    raise exception 'GUARDARRAIL: esperaba 5 reglas con filtro de local y hay %.', v_n;
  end if;

  -- 2) Nadie cambia de alcance hoy: la intersección "tiene local restringido" ∩
  --    "tiene ventas/finanzas/gastos" tiene que seguir vacía. Si algún día no lo
  --    está, esta migración le CAMBIA lo que ve a esa persona — y hay que saberlo.
  select count(*) into v_n
    from public.perfiles
   where local_restringido is not null
     and not es_admin
     and (puede_ver_ventas or puede_ver_finanzas or puede_ver_gastos);
  if v_n > 0 then
    raise notice 'ATENCION: % persona(s) con local restringido tienen ventas/finanzas/gastos. A partir de ahora ven SOLO su casa (que es lo correcto, pero es un cambio para ellos).', v_n;
  else
    raise notice 'nadie cambia de alcance: la interseccion esta vacia';
  end if;

  -- 3) Las casillas nuevas nacen apagadas para todos.
  select count(*) into v_sin
    from public.perfiles
   where puede_anular_ventas or puede_ver_esperado_caja;
  if v_sin <> 0 then
    raise exception 'GUARDARRAIL: las casillas nuevas tendrian que nacer apagadas y hay % prendida(s).', v_sin;
  end if;

  -- 4) tiene_permiso sigue contestando lo de siempre y entiende lo nuevo.
  if public.tiene_permiso('ventas') is null or public.tiene_permiso('anular_ventas') is null
     or public.tiene_permiso('ver_esperado_caja') is null then
    raise exception 'GUARDARRAIL: tiene_permiso devolvio null.';
  end if;

  -- 5) La regla de anular existe y es solo de DELETE.
  select count(*) into v_n
    from pg_policy p join pg_class c on c.oid = p.polrelid
   where c.relname = 'ventas_tickets' and p.polname = 'ventas_tickets_anular' and p.polcmd = 'd';
  if v_n <> 1 then
    raise exception 'GUARDARRAIL: la regla de anular no quedo como DELETE.';
  end if;

  raise notice 'GUARDARRAIL OK';
end
$guard$;

commit;
