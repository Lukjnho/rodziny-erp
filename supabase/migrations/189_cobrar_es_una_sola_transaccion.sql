-- ============================================================================
-- 189 — COBRAR ES UNA SOLA TRANSACCIÓN (lo estrena el mostrador)
-- ============================================================================
--
-- Archivo:  supabase/migrations/189_cobrar_es_una_sola_transaccion.sql
-- Version:  20260907140000        (la última aplicada es la 188)
--
-- ⚠️ ANTES de crear el archivo: confirmar que la otra sesión no tomó el 189.
--    Ya pasó cinco veces; en supabase/migrations/ conviven dos archivos 157_*.
-- ⚠️ APLICAR CON LA CAJA CERRADA. Ver "CÓMO SE APLICA" al final del encabezado.
--
--
-- QUÉ PASA HOY
-- ------------
-- Cobrar una venta son CUATRO viajes del navegador a la base
-- (src/modules/caja/useCaja.ts, useCobrarVenta):
--
--   1. insert en ventas_tickets              → devuelve el id
--   2. insert en ventas_items (las madres)   → devuelve los ids
--   3. insert en ventas_items (las hijas: la salsa que cuelga de la pasta)
--   4. insert en ventas_pagos
--
-- Si falla el 2, el 3 o el 4 se llama a deshacerTicket() (useCaja.ts:768, desde
-- los throw de las líneas 878, 901 y 925), que BORRA el ticket a mano. Eso es un
-- rollback casero y falla justo cuando más se lo necesita: la única regla que
-- deja borrar al cajero (`ventas_tickets_caja_deshacer`) exige que el ticket no
-- tenga cobros, que no tenga comprobante y que el turno siga ABIERTO. Si alguna
-- no se cumple —el turno se cerró desde la otra ventana, o el que falló fue el
-- paso 4 y ya entró algún pago— el DELETE devuelve CERO FILAS SIN ERROR y el
-- ticket queda colgado del turno.
--
-- Y un ticket colgado no es un dato feo, es plata mal contada:
--   * El tablero del ERP y el cartel "Turno en curso" del menú suman
--     ventas_tickets.total_bruto de TODOS los tickets del turno
--     (useCaja.ts:314-330): muestran más cobrado de lo que se cobró.
--   * La lista "Ventas del turno", que lee los cobros, lo muestra en $0.
--     Dos números de la misma pantalla que no cierran entre sí.
--   * Cocina cuenta ventas_items sin filtrar estado ni origen (a propósito,
--     migración 184): esos renglones fantasma le descuentan stock de la cámara
--     y le inflan la demanda de mañana, en silencio.
--
--
-- LO QUE HACE ESTA MIGRACIÓN
-- --------------------------
-- Una sola función, `cobrar_venta`: ticket + renglones (madres e hijas) + cobros
-- en UNA transacción. Todo o nada. Si algo falla, Postgres deshace todo solo —de
-- verdad, no a mano— y no queda ni un ticket a medio grabar. El borrado
-- compensatorio desaparece del camino del cobro.
--
-- Y de paso pone SEIS candados que hoy no existen:
--   * el turno tiene que estar ABIERTO, ser del POS y ser de esta casa — y se
--     TRABA mientras se cobra, así no puede cerrarse a mitad de la venta;
--   * las cuentas del ticket las rehace la base y los cobros tienen que cerrar
--     EXACTO con la venta;
--   * un cobro del POS no puede ser negativo, ni cero, ni colgar de la nada
--     (CHECK a nivel tabla: vale por cualquier camino, para siempre);
--   * la salsa no puede quedar huérfana ni el renglón sin producto de la carta;
--   * el convenio tiene que existir, estar activo, vigente y ser de esta casa;
--   * un reintento después de un corte de red NO cobra dos veces.
--
-- Y cierra la puerta de atrás: desde ahora, para un usuario de caja, la ÚNICA
-- forma de escribir en ventas_tickets / ventas_items / ventas_pagos es esta
-- función (ver 💣 LA PUERTA DE ATRÁS, más abajo).
--
-- La estrena el MOSTRADOR. Por eso la función se llama `cobrar_venta` y no
-- `cobrar_venta_mostrador`, y recibe p_tipo_venta: el salón (mig 190) la va a
-- usar tal cual, sin reescribirla.
--
--
-- 💣 POR QUÉ **NO** VA `security definer`
-- ---------------------------------------
-- Todas las RPC de este repo son SECURITY DEFINER, pero por una razón que acá NO
-- corre: existen para que `anon` (las tablets, el QR) escriba tablas que la RLS
-- le cierra. Acá el que cobra es un usuario CON sesión y CON permiso de caja.
--
-- Las funciones de este repo son de `postgres`, que tiene rolbypassrls = true
-- (verificado en pg_roles), sobre tablas con relforcerowsecurity = false: una
-- función SECURITY DEFINER acá corre con la RLS APAGADA para TODA la base. Se
-- saltearía entera la frontera de local de la migración 187 y el cajero de Vedia
-- podría cobrar en Saavedra pasando p_local = 'saavedra' desde la consola.
--
-- Con INVOKER la RLS sigue viva adentro: la frontera se mantiene sin escribirla
-- dos veces. El problema que esta migración resuelve es de ATOMICIDAD, no de
-- permisos: una función plpgsql corre completa dentro de una transacción aunque
-- sea INVOKER. Y no hace falta contar filas afectadas: un INSERT que la RLS
-- rechaza SÍ tira error (42501). Los que se tragan el rechazo y devuelven cero
-- filas mudas son el UPDATE y el DELETE, no el INSERT.
--
--
-- 💣 LA PUERTA DE ATRÁS (esto es nuevo, y es el corazón de la migración)
-- ---------------------------------------------------------------------
-- Las tres reglas `*_caja_cobrar` sólo miran permiso + origen='pos' + local. NO
-- miran el ticket_id ni el monto. O sea que hoy, desde la consola del navegador,
-- un cajero puede colgar renglones de CUALQUIER ticket de su local (Cocina los
-- cuenta y le descuenta stock, mig 184) e insertar un cobro NEGATIVO sobre un
-- ticket de su turno para hacer desaparecer un faltante de efectivo del arqueo —
-- el mismo fraude que la 151 cerró por la puerta del DELETE, abierto por la
-- puerta del INSERT.
--
-- Se revisó si se podían dejar abiertas "porque el salón sigue con el camino
-- viejo": ES FALSO. No existe el módulo salón (`ls src/modules/` no lo tiene,
-- `puede_ver_salon` no aparece en una sola línea de src/) y, después de esta
-- migración, el ÚNICO escritor POS del repo es esta función. Dejarlas abiertas
-- no protege a nadie: convierte en decorativas todas las validaciones nuevas,
-- porque se saltean desde la consola.
--
-- Cómo se cierran sin volver a DEFINER: la función marca la sesión
-- (`set_config('rodziny.cobro','si', true)`, que dura lo que dura la
-- transacción) y las tres reglas piden esa marca. El cliente no la puede poner:
-- PostgREST sólo expone GUCs con prefijo `request.`, y una llamada RPC es una
-- sola sentencia. Administración NO se entera: sigue entrando por
-- `ventas_*_all` (permiso de ventas), que no se toca. El importador de Fudo usa
-- service_role, que saltea RLS.
--
-- ⚠️ SI ESTO FALLA, LA CAJA NO COBRA. Probarlo con el usuario CAJERO antes de
--    abrir (el usuario de Lucas es admin y pasa por otra regla: NO sirve para
--    probar esto). Vuelta atrás, tres renglones, sin migración:
--      alter policy ventas_tickets_caja_cobrar on public.ventas_tickets
--        with check ((select tiene_permiso('caja')) and origen='pos'
--          and ((select mi_local()) is null or local=(select mi_local()) or (select es_admin())));
--      (ídem ventas_items_caja_cobrar y ventas_pagos_caja_cobrar)
--
--
-- 💣 total_bruto NO ES EL BRUTO
-- -----------------------------
-- En los tickets del POS, `total_bruto` guarda lo COBRADO, con el descuento ya
-- restado. Se llama mal desde siempre y así lo leen siete pantallas (el cobrado
-- del turno, CierreMesPanel, GastosPage, AnalisisGastos, ResumenTab,
-- InteranualTab, useProyeccionFlujo) y el trigger comprobante_coincide_con_venta
-- de ARCA, que lo compara contra el importe de la factura con un centavo de
-- tolerancia. Esta función NO lo "arregla": sigue escribiendo el neto cobrado.
--
--
-- 💣 LA PLATA NO SE CREE, SE REHACE — Y CIERRA EXACTO
-- --------------------------------------------------
-- El navegador manda cantidad, precio y porcentaje. Los importes los rehace la
-- base con la MISMA fórmula de la pantalla (el redondeo va sobre el producto:
-- round(bruto * pct) / 100, useCaja.ts:131-134). Cada renglón se redondea a dos
-- decimales ANTES de sumar, que es como se guarda (numeric(14,2)): así la suma
-- de los renglones ES el total del ticket.
--
-- Y la igualdad con los cobros es EXACTA, sin tolerancia. Un diseño anterior
-- aceptaba un centavo por renglón: eso guardaba un ticket cuyo total no cerraba
-- con sus cobros —el mismo síntoma que esta migración dice venir a terminar— a
-- cambio de nada, porque los 226 precios del canal 'plato' son enteros
-- (verificado: cero con decimales) y las dos fórmulas dan idéntico. Si algún día
-- se carga un precio con decimales y aparece un rechazo por un centavo, el
-- cartel lo dice en criollo y se corrige el precio: mejor un rechazo visible que
-- una diferencia muda que aparece en el arqueo.
--
-- ⚠️ Lo que esto NO cierra: el PRECIO lo sigue mandando el navegador. Con la
-- consola abierta todavía se puede cobrar un Ragú a $1 y el arqueo cierra,
-- porque el esperado se calcula sobre lo cobrado. El candado que falta es que la
-- base busque el precio en cocina_recetas_precios_canal; no entró acá porque el
-- salón puede usar otro canal y rompería cualquier ítem sin precio cargado.
-- Tampoco se toca el descuento a mano por renglón: la pantalla lo permite a
-- propósito (CajaPage.tsx:922-923, "a veces la bonificación es sólo sobre un
-- plato"). Lo que sí se valida ahora es el CONVENIO.
--
--
-- 💣 EL REINTENTO NO COBRA DOS VECES — Y NO ALCANZA CON MIRAR EL TOTAL
-- -------------------------------------------------------------------
-- Con el cobro atómico, un reintento después de un corte de red pasa de dejar
-- medio ticket a dejar una VENTA ENTERA cobrada dos veces. Por eso el POS manda
-- una llave de intento y la base la guarda.
--
-- Pero "mismo total" NO es "misma venta": en agosto, 2.670 de los 4.199 tickets
-- de Vedia (el 63,6%) repiten un total el mismo día — dos Ragú seguidos es la
-- rutina del mostrador. Si se comparara sólo el importe, la venta del cliente
-- siguiente se tragaría el ticket del anterior y quedaría plata en el cajón sin
-- ticket. Por eso junto a la llave se guarda una HUELLA de la venta (turno +
-- renglones + cobros). Misma llave y misma huella = es el mismo intento: se
-- devuelve el ticket que ya existe y se avisa que ya estaba cobrada (la pantalla
-- NO reimprime la comanda: cocina no hace el plato dos veces). Misma llave y
-- otra huella = ya se cobró y esto es otra venta: no se adivina, se frena y se
-- explica qué hacer.
--
--
-- 💣 EL TICKET CON PAGO MIXTO SIGUE APUNTANDO A UN MEDIO DADO DE BAJA
-- ------------------------------------------------------------------
-- Con más de un medio el ticket se guarda con medio_pago='Mixto' y
-- medio_pago_id NULL, y el trigger trg_medio_pago_completar lo resuelve por
-- alias al medio 'mixto' (cfe26298…, activo=false, cuenta_default_venta=NULL).
-- Los dos tickets POS que ya existen quedaron así. Esta función lo REPLICA tal
-- cual, a propósito: tocarlo movería el agrupamiento por medio en Ventas y en el
-- EdR en la misma migración que cambia el camino de cobro, y después nadie
-- sabría cuál de las dos cosas movió los números. Los COBROS quedan bien: cada
-- fila de ventas_pagos lleva su medio real y el arqueo cierra.
--
--
-- LO QUE ESTA MIGRACIÓN NO HACE
-- -----------------------------
--   * NO ata el ticket al CAJERO. Se miró: cierres_caja.creado_por es TEXTO
--     LIBRE ("Lucas", "Marcos"), no un usuario, así que no hay con qué comparar.
--     Un cajero puede cobrar contra otro turno abierto de SU MISMA casa, igual
--     que hoy. Queda para cuando el turno guarde el user_id.
--   * NO borra la regla `ventas_tickets_caja_deshacer`: es la única forma que
--     tiene el cajero de deshacer y no molesta a nadie.
--   * NO emite comprobante de ARCA. Si algún día se emitiera dentro de esta
--     misma transacción, ojo: el rollback borra la fila local pero el número que
--     ARCA ya entregó no vuelve, y ese salto de numeración no se perdona.
--   * NO recrea las vistas de la 188. Se le agregan dos columnas a
--     ventas_tickets, pero las vistas son `select t.*` congelado: simplemente no
--     las van a tener, y ninguna pantalla las necesita (es plomería interna).
--   * NO cambia ninguna fila existente.
--
--
-- CÓMO SE APLICA
-- --------------
-- Con la caja CERRADA, fuera de horario. Los tres CHECK y los dos índices toman
-- lock exclusivo sobre ventas_items (124.893 filas) y ventas_pagos (43.890) y,
-- como toda la migración corre en una transacción, ese lock se sostiene hasta el
-- final: si se aplica con el POS cobrando o con el cron de las 8 corriendo, se
-- encolan. Va un `lock_timeout` para que falle rápido y limpio en vez de colgar
-- la caja. Verificado antes de escribir esto: cero filas violan los candados
-- nuevos, así que la validación pasa.
--
-- Decidido el 7-sep-2026 con Lucas.
-- ============================================================================

-- Que no se cuelgue esperando un lock: si no lo consigue, la migración falla
-- entera y no queda nada a medias.
set lock_timeout = '5s';


-- ── 1. La llave contra el doble cobro, y la huella de la venta ──────────────
alter table public.ventas_tickets
  add column if not exists idempotencia uuid;

alter table public.ventas_tickets
  add column if not exists cobro_huella text;

comment on column public.ventas_tickets.idempotencia is
  'Llave del intento de cobro, la genera el POS. Si llega dos veces la misma, cobrar_venta() no cobra de nuevo. NULL en todo lo que no viene del POS.';

comment on column public.ventas_tickets.cobro_huella is
  'Resumen (md5) de la venta que se cobró con esa llave: turno + renglones + cobros. Sirve para distinguir "es el mismo intento" de "es otra venta con la llave vieja": dos ventas seguidas por el mismo importe son la rutina del mostrador, así que el importe solo no alcanza.';

create unique index if not exists ventas_tickets_idempotencia_key
  on public.ventas_tickets (idempotencia)
  where idempotencia is not null;


-- ── 2. Candados de plata que hoy no existen ────────────────────────────────
-- Van SOLO para origen='pos': el histórico de Fudo tiene 82.072 renglones sin
-- ticket. Verificado: cero filas del POS los violan.
do $candados$
begin
  if not exists (select 1 from pg_constraint where conname = 'ventas_items_pos_con_ticket') then
    alter table public.ventas_items
      add constraint ventas_items_pos_con_ticket
      check (origen <> 'pos' or ticket_id is not null);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'ventas_pagos_pos_con_ticket') then
    alter table public.ventas_pagos
      add constraint ventas_pagos_pos_con_ticket
      check (origen <> 'pos' or ticket_id is not null);
  end if;

  -- El truco para hacer desaparecer un faltante de efectivo del arqueo: un cobro
  -- de monto negativo colgado de un ticket del propio turno. Prohibido por la
  -- base, o sea por cualquier camino y para siempre.
  if not exists (select 1 from pg_constraint where conname = 'ventas_pagos_pos_monto_positivo') then
    alter table public.ventas_pagos
      add constraint ventas_pagos_pos_monto_positivo
      check (origen <> 'pos' or monto > 0);
  end if;

  -- ventas_pagos.local es texto libre: no tiene ni CHECK ni FK, a diferencia de
  -- tickets e items. Un local con un typo entra sin protestar y ese cobro queda
  -- invisible para el arqueo y para los reportes.
  if not exists (select 1 from pg_constraint where conname = 'ventas_pagos_pos_local_check') then
    alter table public.ventas_pagos
      add constraint ventas_pagos_pos_local_check
      check (origen <> 'pos' or local in ('vedia','saavedra'));
  end if;
end;
$candados$;

-- El número de renglón deja de ser decorativo: ordena la comanda y dice de qué
-- pasta cuelga cada salsa.
create unique index if not exists ventas_items_pos_ticket_linea_key
  on public.ventas_items (ticket_id, linea)
  where origen = 'pos';


-- ── 3. Dos cuentas que tienen que estar escritas UNA sola vez ──────────────
create or replace function public.venta_descuento_de_linea(p_bruto numeric, p_pct numeric)
returns numeric
language sql
immutable
set search_path to 'public'
as $$
  -- Espejo exacto de descuentoDeLinea() del POS (useCaja.ts:131-134): el
  -- redondeo va sobre el PRODUCTO, no sobre el resultado de dividir. Vive suelta
  -- porque el total del ticket y el total de cada renglón se calculan en dos
  -- statements distintos: si la fórmula estuviera escrita dos veces, el día que
  -- alguien toque una sola el ticket dejaría de cerrar con sus líneas.
  select case
           when coalesce(p_pct, 0) <= 0 then 0::numeric
           else round(p_bruto * least(p_pct, 100)) / 100
         end;
$$;

comment on function public.venta_descuento_de_linea(numeric, numeric) is
  'Lo que se bonifica en un renglón de venta. Espejo exacto de descuentoDeLinea() del POS. Una sola verdad para el total del ticket y para el total de cada línea.';

create or replace function public.pesos_criollo(p_monto numeric)
returns text
language sql
immutable
set search_path to 'public'
as $$
  -- La base habla en inglés (lc_numeric = en_US.UTF-8): to_char devuelve
  -- 1,500,000.50 y en la casa se escribe $1.500.000,50. El baile de la X es para
  -- no pisar un separador con el otro a mitad de camino. Sin esto, los carteles
  -- de la caja salían con dieciséis decimales.
  select '$' || replace(replace(replace(
           to_char(round(coalesce(p_monto, 0), 2), 'FM999G999G999G990D00'),
           ',', 'X'), '.', ','), 'X', '.');
$$;

comment on function public.pesos_criollo(numeric) is
  'Formatea plata como se escribe en la casa ($1.500.000,50) para los mensajes que lee el cajero.';

revoke all     on function public.venta_descuento_de_linea(numeric, numeric) from public, anon;
grant  execute on function public.venta_descuento_de_linea(numeric, numeric) to authenticated;
revoke all     on function public.pesos_criollo(numeric) from public, anon;
grant  execute on function public.pesos_criollo(numeric) to authenticated;


-- ── 4. Cobrar, de una sola vez ─────────────────────────────────────────────
create or replace function public.cobrar_venta(
  p_idempotencia uuid,
  p_local        text,
  p_caja         text,
  p_turno_id     uuid,
  p_fecha        date,
  p_hora         time,
  p_cliente      text,
  p_convenio_id  uuid,
  -- Un objeto por renglón, en el orden en que se cargaron:
  --   { linea, padre_linea, codigo, nombre, categoria, cantidad,
  --     precio_unitario, descuento_pct, tipo ('receta'|'producto'), ref_id }
  --   · linea       = posición en la venta (1..n). Ordena la comanda; NO es el
  --                   orden en que se guardan (primero van las pastas).
  --   · padre_linea = número de renglón de la pasta de la que cuelga la salsa.
  --   · tipo/ref_id = la función lo traduce a receta_id o cocina_producto_id,
  --                   nunca los dos y nunca ninguno.
  --   · NO se manda el total: las cuentas las rehace la base.
  p_lineas       jsonb,
  -- Un objeto por cobro: { medio_pago_id, monto }. El nombre, la cuenta y "es
  -- dividendo" salen de medios_pago, no del navegador.
  p_pagos        jsonb,
  p_tipo_venta   text default 'mostrador'
)
returns jsonb
language plpgsql
-- ⚠️ sin `security definer`, a propósito. Ver el encabezado: acá definer
--    apagaría la RLS de toda la base y borraría la frontera de la mig 187.
set search_path to 'public'
as $fn$
declare
  v_ticket      public.ventas_tickets;
  v_previo      public.ventas_tickets;
  v_turno       public.cierres_caja;
  v_conv        public.convenios;
  v_caja        text;
  v_periodo     text := to_char(p_fecha, 'YYYY-MM');
  v_total       numeric(14,2) := 0;
  v_descuento   numeric(14,2) := 0;
  v_pagado      numeric(14,2) := 0;
  v_huella      text;
  v_cuantas     int;
  v_distintas   int;
  v_madres      int;
  v_hijas       int;
  v_filas       int;
  v_nros        int[];
  v_medios      int;
  v_medio_id    uuid;
  v_medio_txt   text;
  v_l           jsonb;
  v_p           jsonb;
  v_vuelta      int;
  v_restriccion text;
begin
  -- ── 4.1 Lo que no puede faltar ────────────────────────────────────────────
  if p_idempotencia is null then
    raise exception 'A esta venta le falta el número de intento. Cerrá el cobro, apretá "Vaciar" y cargala de nuevo.';
  end if;

  if p_local is null or p_local not in ('vedia', 'saavedra') then
    raise exception 'No se puede cobrar en "%": la caja cobra en Vedia o en Saavedra.', coalesce(p_local, '(vacío)');
  end if;

  if p_tipo_venta is null or p_tipo_venta not in ('mostrador', 'salon') then
    raise exception 'No sé qué clase de venta es "%": tiene que ser mostrador o salon.', coalesce(p_tipo_venta, '(vacío)');
  end if;

  if p_fecha is null or p_hora is null then
    raise exception 'La venta vino sin fecha o sin hora. Cerrá la pantalla del POS, volvé a entrar y cobrá de nuevo.';
  end if;

  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'No hay nada para cobrar: la venta no tiene ni un renglón.';
  end if;

  if p_pagos is null or jsonb_typeof(p_pagos) <> 'array' or jsonb_array_length(p_pagos) = 0 then
    raise exception 'No se puede guardar una venta sin cobro: cargá con qué la pagan.';
  end if;

  -- ── 4.2 Los renglones, uno por uno, ANTES de escribir nada ────────────────
  --       Un renglón mal armado que entra igual es peor que un cobro que no
  --       entra: al que entra no lo ve nadie hasta el cierre.
  for v_l in select l.value from jsonb_array_elements(p_lineas) l loop
    if nullif(btrim(coalesce(v_l->>'nombre', '')), '') is null then
      raise exception 'Hay un renglón sin nombre. Cerrá el cobro y cargá la venta de nuevo.';
    end if;

    if jsonb_typeof(v_l->'linea') <> 'number' or (v_l->>'linea')::numeric < 1 then
      raise exception 'El renglón "%" vino sin número de orden. Cerrá el cobro y cargá la venta de nuevo.', v_l->>'nombre';
    end if;

    if jsonb_typeof(v_l->'cantidad') <> 'number' or (v_l->>'cantidad')::numeric <= 0 then
      raise exception 'El renglón "%" tiene una cantidad imposible. Corregila y volvé a cobrar.', v_l->>'nombre';
    end if;

    if jsonb_typeof(v_l->'precio_unitario') <> 'number' or (v_l->>'precio_unitario')::numeric < 0 then
      raise exception 'El renglón "%" vino sin precio. Salí y volvé a entrar a la caja para refrescar la carta.', v_l->>'nombre';
    end if;

    if coalesce(jsonb_typeof(v_l->'descuento_pct'), 'null') <> 'null'
       and (jsonb_typeof(v_l->'descuento_pct') <> 'number'
            or (v_l->>'descuento_pct')::numeric < 0
            or (v_l->>'descuento_pct')::numeric > 100) then
      raise exception 'El descuento del renglón "%" no puede ser de %: va de 0 a 100 por ciento.',
        v_l->>'nombre', v_l->>'descuento_pct';
    end if;

    -- Uno de los dos vínculos, nunca los dos y nunca ninguno: si llegaran los
    -- dos revienta el CHECK ventas_items_un_solo_vinculo, y si no llegara
    -- ninguno el trigger del catálogo se pone a adivinar el producto por el
    -- nombre y puede enganchar OTRA receta en silencio.
    if coalesce(v_l->>'tipo', '') not in ('receta', 'producto')
       or nullif(btrim(coalesce(v_l->>'ref_id', '')), '') is null then
      raise exception 'El renglón "%" no está enganchado a ningún producto de la carta. Salí y volvé a entrar a la caja para refrescar la carta.', v_l->>'nombre';
    end if;

    if coalesce(jsonb_typeof(v_l->'padre_linea'), 'null') <> 'null'
       and jsonb_typeof(v_l->'padre_linea') <> 'number' then
      raise exception 'El renglón "%" dice colgar de una pasta que no se entiende cuál es. Cerrá el cobro y cargá la venta de nuevo.', v_l->>'nombre';
    end if;
  end loop;

  -- Los números de renglón no se pueden repetir.
  select count(*), count(distinct (l.value->>'linea')::int)
    into v_cuantas, v_distintas
    from jsonb_array_elements(p_lineas) l;

  if v_cuantas <> v_distintas then
    raise exception 'Hay dos renglones con el mismo número de orden. Cerrá el cobro y cargá la venta de nuevo.';
  end if;

  -- Las madres (las que no cuelgan de nadie) y a quién puede colgarse una hija.
  select array_agg((l.value->>'linea')::int)
    into v_nros
    from jsonb_array_elements(p_lineas) l
   where coalesce(jsonb_typeof(l.value->'padre_linea'), 'null') = 'null';

  if v_nros is null then
    raise exception 'Todos los renglones cuelgan de otro y ninguno es la pasta. Cerrá el cobro y cargá la venta de nuevo.';
  end if;

  for v_l in
    select l.value from jsonb_array_elements(p_lineas) l
     where coalesce(jsonb_typeof(l.value->'padre_linea'), 'null') <> 'null'
  loop
    if not ((v_l->>'padre_linea')::int = any (v_nros)) then
      -- Una salsa suelta NO se guarda en silencio: es exactamente lo que el
      -- modelo canónico (migración 141) vino a evitar.
      raise exception 'El renglón "%" quedó sin la pasta de la que cuelga. No se guarda la venta a medias: cerrá el cobro y cargala de nuevo.', v_l->>'nombre';
    end if;
  end loop;

  v_madres := array_length(v_nros, 1);
  v_hijas  := jsonb_array_length(p_lineas) - v_madres;

  -- ── 4.3 El convenio ───────────────────────────────────────────────────────
  --       Hoy no lo mira NADIE: la llave foránea sólo verifica que el uuid
  --       exista, así que se puede guardar una venta con el convenio de la otra
  --       casa o con uno dado de baja, y eso es lo que después se le liquida a
  --       la empresa. (El PORCENTAJE por renglón sigue libre a propósito: la
  --       pantalla deja bonificar un solo plato, CajaPage.tsx:922-923.)
  if p_convenio_id is not null then
    select * into v_conv
      from public.convenios
     where id = p_convenio_id
       and activo
       and local = p_local
       and (vigencia_desde is null or vigencia_desde <= p_fecha)
       and (vigencia_hasta is null or vigencia_hasta >= p_fecha);

    if not found then
      raise exception 'Ese convenio no está vigente en esta casa. Sacalo del cobro o elegí otro.';
    end if;
  end if;

  -- ── 4.4 Las cuentas se rehacen ACÁ ────────────────────────────────────────
  --       Lo que manda el navegador se controla, no se cree: es plata. Cada
  --       renglón se redondea a dos decimales ANTES de sumar, que es como se
  --       guarda: así la suma de los renglones ES el total del ticket.
  select coalesce(sum(round(d.bruto - d.descuento, 2)), 0),
         coalesce(sum(round(d.descuento, 2)), 0)
    into v_total, v_descuento
    from jsonb_array_elements(p_lineas) l
    cross join lateral (
      select round((l.value->>'precio_unitario')::numeric * (l.value->>'cantidad')::numeric, 2) as bruto
    ) b
    cross join lateral (
      select b.bruto,
             public.venta_descuento_de_linea(b.bruto, coalesce((l.value->>'descuento_pct')::numeric, 0)) as descuento
    ) d;

  if v_total <= 0 then
    raise exception 'La venta da %. Revisá las cantidades y los descuentos antes de cobrar.', public.pesos_criollo(v_total);
  end if;

  -- ── 4.5 Los cobros ────────────────────────────────────────────────────────
  --       El medio se manda por id y el nombre lo pone la base: el trigger
  --       trg_medio_pago es MUDO — si el texto no engancha con ningún alias,
  --       pone "sin especificar" y la plata queda cobrada pero sin clasificar.
  for v_p in select p.value from jsonb_array_elements(p_pagos) p loop
    if jsonb_typeof(v_p->'monto') <> 'number' or (v_p->>'monto')::numeric <= 0 then
      raise exception 'Hay un cobro de %. Los cobros tienen que sumar plata, no restarla.',
        public.pesos_criollo(coalesce((v_p->>'monto')::numeric, 0));
    end if;

    if nullif(btrim(coalesce(v_p->>'medio_pago_id', '')), '') is null
       or not exists (
         select 1 from public.medios_pago m
          where m.id = (v_p->>'medio_pago_id')::uuid
            and m.activo
            and m.aplica_ventas
            and m.codigo <> 'sin_especificar'
       ) then
      raise exception 'Uno de los medios de pago ya no se usa en la caja. Elegí otro y volvé a cobrar.';
    end if;
  end loop;

  select coalesce(sum(round((p.value->>'monto')::numeric, 2)), 0)
    into v_pagado
    from jsonb_array_elements(p_pagos) p;

  -- Sin tolerancia. El modal topea cada pago en lo que falta
  -- (Math.min(monto, restante), CajaPage.tsx:1432), no deja confirmar hasta que
  -- no falte nada y el vuelto NO se guarda como cobro: los cobros suman
  -- exactamente el total. Con los precios enteros de hoy, la cuenta del
  -- navegador y la de la base dan idéntico.
  if v_pagado <> v_total then
    raise exception 'Los cobros suman % y la venta es de %. No se guarda hasta que cierre.',
      public.pesos_criollo(v_pagado), public.pesos_criollo(v_total);
  end if;

  -- Con un solo medio, el ticket lleva ese medio. Con varios se guarda "Mixto",
  -- igual que el importador de Fudo (ver el 💣 del encabezado).
  select count(distinct p.value->>'medio_pago_id')
    into v_medios
    from jsonb_array_elements(p_pagos) p;

  if v_medios = 1 then
    select m.id, m.nombre
      into v_medio_id, v_medio_txt
      from public.medios_pago m
     where m.id = ((p_pagos->0)->>'medio_pago_id')::uuid;
  else
    v_medio_id  := null;
    v_medio_txt := 'Mixto';
  end if;

  -- ── 4.6 La huella de esta venta ───────────────────────────────────────────
  --       Turno + renglones + cobros. Es lo que distingue "el mismo intento que
  --       se cortó" de "otra venta con la llave vieja". El importe solo no
  --       alcanza: dos ventas seguidas por lo mismo son la rutina del mostrador.
  select md5(
           p_turno_id::text || '|' || p_local || '|' ||
           coalesce((
             select string_agg(
                      (l.value->>'linea') || ':' ||
                      coalesce(l.value->>'padre_linea', '-') || ':' ||
                      coalesce(l.value->>'tipo', '') || ':' ||
                      coalesce(l.value->>'ref_id', '') || ':' ||
                      btrim(coalesce(l.value->>'nombre', '')) || ':' ||
                      round((l.value->>'cantidad')::numeric, 3)::text || ':' ||
                      round((l.value->>'precio_unitario')::numeric, 2)::text || ':' ||
                      round(coalesce((l.value->>'descuento_pct')::numeric, 0), 2)::text,
                      ';' order by (l.value->>'linea')::int)
               from jsonb_array_elements(p_lineas) l), '') || '|' ||
           coalesce((
             select string_agg(
                      (p.value->>'medio_pago_id') || ':' ||
                      round((p.value->>'monto')::numeric, 2)::text,
                      ';' order by (p.value->>'medio_pago_id'),
                                   round((p.value->>'monto')::numeric, 2))
               from jsonb_array_elements(p_pagos) p), '')
         )
    into v_huella;

  -- ── 4.7 Cobrar (o reconocer que esto ya se cobró) ─────────────────────────
  --       Dos vueltas: si en la primera otra pantalla nos ganó de mano con la
  --       misma llave, en la segunda la encontramos y la devolvemos. El chequeo
  --       de "¿ya se cobró?" está escrito UNA sola vez, que es justo lo que hay
  --       que exigirle al único guardarraíl contra el doble cobro.
  for v_vuelta in 1..2 loop

    select * into v_previo
      from public.ventas_tickets
     where idempotencia = p_idempotencia;

    if found then
      if v_previo.cobro_huella is not distinct from v_huella then
        -- Es el mismo intento: NO se cobra de nuevo.
        return jsonb_build_object(
          'ticket_id', v_previo.id,
          'numero',    left(v_previo.id::text, 8),
          'total',     v_previo.total_bruto,
          'ya_estaba', true
        );
      end if;

      raise exception
        'Esta venta ya se cobró (ticket %) por %. Si ahora es OTRA venta, apretá "Vaciar" y cargala de nuevo; si a esta le agregaste algo, cobrá aparte lo que falte.',
        left(v_previo.id::text, 8), public.pesos_criollo(v_previo.total_bruto);
    end if;

    if v_vuelta = 2 then
      raise exception 'Esta venta se está cobrando en otra pantalla. Esperá unos segundos y fijate en "Ventas del turno" antes de volver a cobrar.';
    end if;

    begin
      -- La marca que le dice a la base "esto viene de la caja, por la puerta de
      -- adelante". Dura lo que dura la transacción. Sin ella, las tres reglas de
      -- cobro rechazan la fila: es lo que cierra la puerta de atrás.
      perform set_config('rodziny.cobro', 'si', true);

      -- El turno: abierto, del POS, de esta casa — y TRABADO mientras se cobra.
      -- Hoy la base no chequea nada de esto (la regla de cobro ni menciona
      -- cierre_caja_id): se puede colgar una venta de un turno YA CERRADO y ese
      -- arqueo cambia después de arqueado. El `for share` es lo que impide que
      -- se cierre entre que lo miramos y guardamos: el cierre queda esperando y,
      -- cuando le toca, el ticket ya está adentro (o nosotros vemos que se
      -- cerró y frenamos). Como el select lo hace el que llama, la regla
      -- `cierres_caja_del_pos` (mig 187) ya recorta por local: el turno de la
      -- otra casa acá directamente "no existe".
      select * into v_turno
        from public.cierres_caja
       where id     = p_turno_id
         and origen = 'pos'
         and hora_cierre is null
         for share;

      if not found then
        raise exception 'Ese turno de caja no está abierto (o no es de esta casa). Actualizá la pantalla y fijate cómo quedó antes de volver a cobrar.';
      end if;

      if v_turno.local is distinct from p_local then
        raise exception 'El turno abierto es de %, y esta pantalla está cobrando en %. Cerrá la caja y volvé a entrar.',
          v_turno.local, p_local;
      end if;

      -- La caja del turno puede estar sin cargar (la columna es nullable): sólo
      -- se frena si las dos están cargadas y son distintas, que ahí sí hay dos
      -- pantallas desincronizadas. Lo que se GUARDA es la caja del turno.
      if v_turno.caja is not null and p_caja is not null and v_turno.caja <> p_caja then
        raise exception 'El turno abierto es de la caja "%" y estás cobrando en "%". Cerrá la pantalla del POS y volvé a entrar.',
          v_turno.caja, p_caja;
      end if;

      v_caja := coalesce(v_turno.caja, p_caja);

      -- El ticket.
      insert into public.ventas_tickets (
        local, fudo_id, origen, cierre_caja_id, fecha, hora, periodo, caja,
        cliente, convenio_id, descuento_total, estado, tipo_venta,
        medio_pago, medio_pago_id, total_bruto, es_fiscal, es_dividendo,
        idempotencia, cobro_huella
      ) values (
        p_local,
        null,        -- fudo_id: esta venta no viene de Fudo
        'pos',       -- sin esto el importador de las 8 de la mañana la borra (mig 150)
        p_turno_id, p_fecha, p_hora, v_periodo, v_caja,
        nullif(btrim(coalesce(p_cliente, '')), ''), p_convenio_id, v_descuento,
        'Cerrada',   -- explícito: el default de la columna es 'cerrada' en
                     -- minúscula y no lo filtra ninguna pantalla
        p_tipo_venta,
        v_medio_txt, v_medio_id,
        v_total,     -- ⚠️ total_bruto es lo COBRADO, con el descuento ya restado
        false, false,
        p_idempotencia, v_huella
      )
      returning * into v_ticket;

      -- Las pastas primero: las salsas necesitan su id.
      insert into public.ventas_items (
        ticket_id, local, periodo, fecha, linea, codigo, nombre, categoria,
        subcategoria, cantidad, precio_unitario, descuento_pct, descuento_monto,
        total, receta_id, cocina_producto_id, origen
      )
      select v_ticket.id, p_local, v_periodo, p_fecha,
             (l.value->>'linea')::int,
             nullif(btrim(coalesce(l.value->>'codigo', '')), ''),
             btrim(l.value->>'nombre'),
             nullif(btrim(coalesce(l.value->>'categoria', '')), ''),
             null,
             (l.value->>'cantidad')::numeric,
             (l.value->>'precio_unitario')::numeric,
             coalesce((l.value->>'descuento_pct')::numeric, 0),
             round(d.descuento, 2),
             round(d.bruto - d.descuento, 2),
             case when l.value->>'tipo' = 'receta'   then (l.value->>'ref_id')::uuid end,
             case when l.value->>'tipo' = 'producto' then (l.value->>'ref_id')::uuid end,
             'pos'
        from jsonb_array_elements(p_lineas) l
        cross join lateral (
          select round((l.value->>'precio_unitario')::numeric * (l.value->>'cantidad')::numeric, 2) as bruto
        ) b
        cross join lateral (
          select b.bruto,
                 public.venta_descuento_de_linea(b.bruto, coalesce((l.value->>'descuento_pct')::numeric, 0)) as descuento
        ) d
       where coalesce(jsonb_typeof(l.value->'padre_linea'), 'null') = 'null';

      get diagnostics v_filas = row_count;
      if v_filas <> v_madres then
        raise exception 'No se pudieron guardar todos los renglones de la venta (% de %). No se guardó nada: volvé a cobrar.', v_filas, v_madres;
      end if;

      -- Y ahora las salsas, cada una colgada de SU pasta, por número de renglón.
      if v_hijas > 0 then
        insert into public.ventas_items (
          ticket_id, local, periodo, fecha, linea, codigo, nombre, categoria,
          subcategoria, cantidad, precio_unitario, descuento_pct, descuento_monto,
          total, receta_id, cocina_producto_id, origen,
          linea_padre_id, vinculo_origen
        )
        select v_ticket.id, p_local, v_periodo, p_fecha,
               (l.value->>'linea')::int,
               nullif(btrim(coalesce(l.value->>'codigo', '')), ''),
               btrim(l.value->>'nombre'),
               nullif(btrim(coalesce(l.value->>'categoria', '')), ''),
               null,
               (l.value->>'cantidad')::numeric,
               (l.value->>'precio_unitario')::numeric,
               coalesce((l.value->>'descuento_pct')::numeric, 0),
               round(d.descuento, 2),
               round(d.bruto - d.descuento, 2),
               case when l.value->>'tipo' = 'receta'   then (l.value->>'ref_id')::uuid end,
               case when l.value->>'tipo' = 'producto' then (l.value->>'ref_id')::uuid end,
               'pos',
               m.id,
               'pos'
          from jsonb_array_elements(p_lineas) l
          join public.ventas_items m
            on m.ticket_id = v_ticket.id
           and m.linea = (l.value->>'padre_linea')::int
           and m.linea_padre_id is null
          cross join lateral (
            select round((l.value->>'precio_unitario')::numeric * (l.value->>'cantidad')::numeric, 2) as bruto
          ) b
          cross join lateral (
            select b.bruto,
                   public.venta_descuento_de_linea(b.bruto, coalesce((l.value->>'descuento_pct')::numeric, 0)) as descuento
          ) d
         where coalesce(jsonb_typeof(l.value->'padre_linea'), 'null') <> 'null';

        get diagnostics v_filas = row_count;
        if v_filas <> v_hijas then
          raise exception 'Quedó % renglón(es) colgando de una pasta que no se guardó. No se guardó nada: cerrá el cobro y cargá la venta de nuevo.', v_hijas - v_filas;
        end if;
      end if;

      -- Los cobros. El nombre, la cuenta y "es dividendo" salen de medios_pago,
      -- no del navegador: es lo que decide si esta plata va a Dividendos.
      insert into public.ventas_pagos (
        ticket_id, local, periodo, fudo_ticket_id, fecha,
        medio_pago, medio_pago_id, monto, tipo_venta, caja, es_dividendo, origen
      )
      select v_ticket.id, p_local, v_periodo,
             'pos-' || v_ticket.id::text,  -- fudo_ticket_id es NOT NULL aunque
                                           -- esto no venga de Fudo
             p_fecha,
             m.nombre, m.id,
             round((p.value->>'monto')::numeric, 2),
             p_tipo_venta, v_caja,
             (m.codigo = 'mp_lucas'),
             'pos'
        from jsonb_array_elements(p_pagos) p
        join public.medios_pago m on m.id = (p.value->>'medio_pago_id')::uuid;

      get diagnostics v_filas = row_count;
      if v_filas <> jsonb_array_length(p_pagos) then
        raise exception 'No se pudieron guardar todos los cobros de la venta (% de %). No se guardó nada: volvé a cobrar.', v_filas, jsonb_array_length(p_pagos);
      end if;

      perform set_config('rodziny.cobro', '', true);

      return jsonb_build_object(
        'ticket_id', v_ticket.id,
        'numero',    left(v_ticket.id::text, 8),
        'total',     v_ticket.total_bruto,
        'ya_estaba', false
      );

    exception when unique_violation then
      get stacked diagnostics v_restriccion = constraint_name;
      -- Sólo se perdona la carrera por la llave de intento: cualquier otro
      -- choque (dos renglones con el mismo número, por ejemplo) es un problema
      -- de verdad y tiene que salir a la superficie.
      if v_restriccion is distinct from 'ventas_tickets_idempotencia_key' then
        raise;
      end if;
      -- La otra pantalla ganó: en la vuelta 2 la buscamos y la devolvemos.
    end;
  end loop;

  raise exception 'No se pudo cobrar. Fijate en "Ventas del turno" antes de volver a intentar.';
end;
$fn$;

comment on function public.cobrar_venta(uuid, text, text, uuid, date, time, text, uuid, jsonb, jsonb, text) is
  'Cobra una venta en UNA sola transacción: ticket + renglones (pastas y las salsas que cuelgan de ellas) + cobros. Reemplaza los cuatro viajes de useCobrarVenta y el borrado compensatorio de deshacerTicket(), que quedaba mudo cuando la regla de borrado no dejaba y dejaba un ticket colgado inflando el turno. Corre con los permisos del que llama (NO es security definer), así respeta la frontera de local de la migración 187. Valida lo que la base no valida sola: turno abierto, de esta casa y trabado mientras se cobra; convenio vigente; las cuentas rehechas acá; los cobros que cierran exacto con la venta; y una llave de intento con huella para que un reintento no cobre dos veces. Marca la sesión con rodziny.cobro: es lo que permite que las tres reglas de cobro sólo dejen entrar por esta puerta. La estrena el mostrador; el salón la reusa con p_tipo_venta.';

-- Esto es plata y la clave pública viaja adentro de la página: la ejecuta sólo
-- un usuario con sesión, y adentro la RLS le sigue pidiendo el permiso de caja y
-- su local. (El revoke a `public` le saca el execute también a service_role: hoy
-- no la llama nada del servidor. Si mañana una edge function tiene que cobrar,
-- va un grant explícito.)
revoke all     on function public.cobrar_venta(uuid, text, text, uuid, date, time, text, uuid, jsonb, jsonb, text) from public, anon;
grant  execute on function public.cobrar_venta(uuid, text, text, uuid, date, time, text, uuid, jsonb, jsonb, text) to authenticated;


-- ── 5. Se cierra la puerta de atrás ────────────────────────────────────────
-- Las tres reglas siguen pidiendo lo mismo de siempre (permiso de caja, origen
-- pos, tu local) y AHORA además la marca que sólo pone cobrar_venta(). Van con
-- `alter policy`: nunca drop+create, que deja la tabla un instante sin regla.
-- Administración no se entera: entra por ventas_*_all (permiso de ventas).
alter policy ventas_tickets_caja_cobrar on public.ventas_tickets
  with check (
    (select public.tiene_permiso('caja')) and origen = 'pos'
    and (((select public.mi_local()) is null) or local = (select public.mi_local()) or (select public.es_admin()))
    and coalesce(current_setting('rodziny.cobro', true), '') = 'si'
  );

alter policy ventas_items_caja_cobrar on public.ventas_items
  with check (
    (select public.tiene_permiso('caja')) and origen = 'pos'
    and (((select public.mi_local()) is null) or local = (select public.mi_local()) or (select public.es_admin()))
    and coalesce(current_setting('rodziny.cobro', true), '') = 'si'
  );

alter policy ventas_pagos_caja_cobrar on public.ventas_pagos
  with check (
    (select public.tiene_permiso('caja')) and origen = 'pos'
    and (((select public.mi_local()) is null) or local = (select public.mi_local()) or (select public.es_admin()))
    and coalesce(current_setting('rodziny.cobro', true), '') = 'si'
  );


-- ── 6. Chequeo: si algo de esto no quedó, la migración revienta acá ────────
do $guard$
declare
  v_secdef   boolean;
  v_conf     text[];
  v_fn       text := 'public.cobrar_venta(uuid, text, text, uuid, date, time, text, uuid, jsonb, jsonb, text)';
  v_regla    text;
  v_check    text;
  v_vista    text;
  v_tickets  int;
  v_items    int;
  v_pagos    int;
  v_colgados int;
begin
  -- 6.1 la función existe, NO es definer y tiene el search_path clavado
  select p.prosecdef, p.proconfig
    into v_secdef, v_conf
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'cobrar_venta';

  if not found then
    raise exception 'GUARDA: no quedó creada cobrar_venta';
  end if;
  if v_secdef then
    raise exception 'GUARDA: cobrar_venta quedó SECURITY DEFINER: se saltearía la RLS entera y con ella la frontera de local de la migración 187 (el cajero de Vedia podría cobrar en Saavedra)';
  end if;
  if v_conf is null or not (v_conf @> array['search_path=public']) then
    raise exception 'GUARDA: cobrar_venta quedó sin search_path fijo';
  end if;

  -- 6.2 la clave pública NO cobra; el usuario con sesión SÍ
  if has_function_privilege('anon', v_fn, 'execute') then
    raise exception 'GUARDA: la clave pública puede cobrar ventas';
  end if;
  if not has_function_privilege('authenticated', v_fn, 'execute') then
    raise exception 'GUARDA: un usuario con sesión no puede cobrar: la caja quedaría muerta';
  end if;
  if has_function_privilege('anon', 'public.venta_descuento_de_linea(numeric, numeric)', 'execute')
     or has_function_privilege('anon', 'public.pesos_criollo(numeric)', 'execute') then
    raise exception 'GUARDA: la clave pública puede ejecutar las funciones de apoyo';
  end if;

  -- 6.3 las columnas nuevas
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='ventas_tickets'
                    and column_name in ('idempotencia','cobro_huella')
                  having count(*) = 2) then
    raise exception 'GUARDA: faltan las columnas del intento de cobro en ventas_tickets';
  end if;

  -- 6.4 las tres reglas de cobro siguen en pie Y ahora piden la marca. Si esto
  --     no quedó, la puerta de atrás sigue abierta y todo lo que valida la
  --     función se puede saltear desde la consola del navegador.
  foreach v_regla in array array[
    'ventas_tickets_caja_cobrar', 'ventas_items_caja_cobrar', 'ventas_pagos_caja_cobrar'
  ] loop
    if not exists (select 1 from pg_policies
                    where schemaname = 'public' and policyname = v_regla) then
      raise exception 'GUARDA: falta la regla %; sin ella la caja deja de cobrar', v_regla;
    end if;
    if not exists (select 1 from pg_policies
                    where schemaname = 'public' and policyname = v_regla
                      and with_check like '%rodziny.cobro%') then
      raise exception 'GUARDA: la regla % quedó sin la marca de la caja: la puerta de atrás sigue abierta', v_regla;
    end if;
  end loop;

  -- la de deshacer se deja como está: es la única forma que tiene el cajero de
  -- deshacer y no molesta a nadie
  if not exists (select 1 from pg_policies
                  where schemaname='public' and policyname='ventas_tickets_caja_deshacer') then
    raise exception 'GUARDA: se perdió la regla de deshacer del cajero';
  end if;

  -- 6.5 la llave contra el doble cobro, el número de renglón y los candados
  if not exists (select 1 from pg_indexes
                  where schemaname = 'public' and indexname = 'ventas_tickets_idempotencia_key') then
    raise exception 'GUARDA: falta la llave de idempotencia: un reintento cobraría dos veces';
  end if;
  if not exists (select 1 from pg_indexes
                  where schemaname = 'public' and indexname = 'ventas_items_pos_ticket_linea_key') then
    raise exception 'GUARDA: falta el número de renglón único: la comanda podría salir mezclada';
  end if;

  foreach v_check in array array[
    'ventas_items_pos_con_ticket', 'ventas_pagos_pos_con_ticket',
    'ventas_pagos_pos_monto_positivo', 'ventas_pagos_pos_local_check'
  ] loop
    if not exists (select 1 from pg_constraint where conname = v_check and convalidated) then
      raise exception 'GUARDA: falta (o quedó sin validar) el candado %', v_check;
    end if;
  end loop;

  -- 6.6 las dos listas oficiales de la 188 siguen enteras (se le agregaron dos
  --     columnas a la tabla de abajo, no a ellas)
  foreach v_vista in array array['v_ventas_tickets_oficial', 'v_ventas_items_oficial'] loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = v_vista and c.relkind = 'v'
         and c.reloptions @> array['security_invoker=true']
    ) then
      raise exception 'GUARDA: la vista % se rompió', v_vista;
    end if;
  end loop;

  -- 6.7 Foto de los datos. Esta migración NO cambia ni una fila: queda como
  --     constancia, no bloquea.
  select count(*) into v_tickets from public.ventas_tickets where origen = 'pos';
  select count(*) into v_items   from public.ventas_items   where origen = 'pos';
  select count(*) into v_pagos   from public.ventas_pagos   where origen = 'pos';
  select count(*) into v_colgados
    from public.ventas_tickets t
   where t.origen = 'pos'
     and not exists (select 1 from public.ventas_pagos g where g.ticket_id = t.id);

  raise notice 'OK 189: cobrar_venta creada · invoker · search_path fijo · sólo con sesión · puerta de atrás cerrada';
  raise notice 'OK 189: % tickets del POS · % renglones · % cobros · % tickets colgados sin cobro (de acá en más no puede quedar ninguno)',
    v_tickets, v_items, v_pagos, v_colgados;
  raise notice 'OJO 189: probar UN COBRO REAL con el usuario CAJERO antes de abrir. El usuario admin pasa por otra regla y NO prueba el candado nuevo.';
end;
$guard$;


-- Que PostgREST vea la función nueva de una. Si no, el primer cobro puede decir
-- que la función no existe hasta que Supabase recargue el esquema solo.
notify pgrst, 'reload schema';