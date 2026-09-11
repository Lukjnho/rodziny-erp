-- 205 — El medio de pago dice si es dividendo (y deja de decirlo el texto)
--
-- ══════════════════════════════════════════════════════════════════════════════
-- LO QUE ESTABA PASANDO
-- ══════════════════════════════════════════════════════════════════════════════
--
-- "La plata que entra por el POSnet personal de Lucas no es venta del negocio, es
-- dividendo" está escrita NUEVE veces, y ninguna de las nueve es la fuente:
--
--   1. fudo-importar-ventas:549   pmName.toLowerCase().includes('mercadopago lucas')
--   2. fudo-importar-ventas:538   (la misma cadena, para sumar el monto)
--   3. fudo-importar-ventas:553   (la misma cadena otra vez, para el contador)
--   4. fudo-importar-ventas:556   esDividendoCompleto → ventas_tickets
--   5. UploadFudo.tsx:111         la misma cadena
--   6. UploadFudo.tsx:247         la misma cadena
--   7. UploadFudo.tsx:261         la misma cadena
--   8. mig 189 (cobrar_venta)     m.codigo = 'mp_lucas'   → ventas_pagos
--   9. mig 189 (cobrar_venta)     false, a secas          → ventas_tickets  ← el agujero
--
-- 💣 EL AGUJERO. El Estado de Resultados filtra por `ventas_tickets.es_dividendo`,
-- y el POS propio graba ese campo en `false` fijo: solo marca el RENGLÓN del cobro.
-- O sea que el día que Lucas pase su POSnet desde nuestra caja, esa plata entra
-- como venta. Hoy no se nota porque el POS lleva 2 tickets de prueba por $28.600;
-- por Fudo son $11.853.900 en seis meses que sí están bien marcados.
--
--
-- ══════════════════════════════════════════════════════════════════════════════
-- DÓNDE QUEDA LA REGLA
-- ══════════════════════════════════════════════════════════════════════════════
--
-- En el catálogo: una columna `es_dividendo` en `medios_pago`. Es un dato del medio
-- de pago, no de cada venta.
--
-- Y se aplica sola, en la puerta que ya existe. La migración 138 dejó un disparador
-- (`trg_medio_pago`) en once tablas que traduce el TEXTO del medio de pago a su fila
-- del catálogo, usando `medios_pago_alias`. Por eso las 45.564 filas de
-- `ventas_tickets` tienen `medio_pago_id` cargado aunque ningún importador lo
-- escriba. Acá se le engancha un segundo disparador que copia `es_dividendo` desde
-- el catálogo — así ni el importador de Fudo, ni el Excel, ni el POS tienen que
-- acordarse de nada.
--
-- 🔑 Y va en el `UPDATE OF` a propósito: si alguien intenta marcar a mano un ticket
-- como dividendo, el disparador lo vuelve a leer del catálogo. Es la puerta única
-- de verdad, no una convención.
--
-- 📏 MEDIDO ANTES DE ESCRIBIR, y por eso esto no puede mover un peso:
--
--                       marcados con el flag   con medio_pago_id = mp_lucas   difieren
--     ventas_tickets            562                      562                    0
--     ventas_pagos              562                      562                    0
--
-- Los dos caminos ya dan exactamente lo mismo sobre el histórico. Lo que cambia no
-- es el número: es que ahora hay un solo lugar donde se decide.
--
-- ⚠️ LO QUE ESTA MIGRACIÓN **NO** ARREGLA, y queda anotado: un cobro MIXTO en el POS
-- propio (parte con el POSnet de Lucas, parte con otro medio). Fudo, cuando el
-- ticket es mixto, le RESTA la parte de Lucas al total del ticket; el POS propio
-- guarda el total entero. Emparejarlos obliga a reescribir `cobrar_venta`, que son
-- ~500 líneas de la función que mueve la plata, y la versión que está aplicada no
-- se puede diferenciar contra el repo sin bajarla entera. Hoy afecta a CERO tickets.
-- Va aparte, con su propia prueba.
--
begin;

-- ── 1) El dato, en el catálogo ──────────────────────────────────────────────
alter table public.medios_pago
  add column if not exists es_dividendo boolean not null default false;

comment on column public.medios_pago.es_dividendo is
  'true = la plata cobrada por este medio NO es venta del negocio, es del socio '
  '(el POSnet personal de Lucas). Lo copian a ventas_tickets y ventas_pagos los '
  'disparadores trg_medio_pago_dividendo. Único lugar donde se decide. Mig 205.';

do $seed$
declare v_filas int;
begin
  update public.medios_pago set es_dividendo = true where codigo = 'mp_lucas';
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'Esperaba marcar 1 medio de pago (mp_lucas) y toqué %.', v_filas;
  end if;
end
$seed$;

-- ── 2) El disparador que lo copia ───────────────────────────────────────────
-- Va aparte de trg_medio_pago_completar() y no adentro: esa función corre sobre
-- once tablas y PL/pgSQL compila el cuerpo entero contra cada una, así que una
-- línea que nombre NEW.es_dividendo reventaría en las nueve que no tienen la
-- columna. Es la misma razón por la que la 138 ya tuvo que partirse en dos.
--
-- Corre DESPUÉS de trg_medio_pago porque los disparadores BEFORE del mismo evento
-- se ejecutan por orden alfabético de nombre, y "trg_medio_pago" es prefijo de
-- "trg_medio_pago_dividendo". Para cuando éste corre, medio_pago_id ya está resuelto.
create or replace function public.trg_medio_pago_dividendo()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  select coalesce(m.es_dividendo, false)
    into new.es_dividendo
    from public.medios_pago m
   where m.id = new.medio_pago_id;

  -- Sin medio de pago resuelto no se puede afirmar que sea del socio: queda en
  -- false, que es lo mismo que hacía el código hasta ahora.
  new.es_dividendo := coalesce(new.es_dividendo, false);
  return new;
end
$fn$;

comment on function public.trg_medio_pago_dividendo() is
  'Copia medios_pago.es_dividendo a la fila. Corre después de trg_medio_pago (orden '
  'alfabético), que es quien resuelve medio_pago_id desde el texto. Mig 205.';

drop trigger if exists trg_medio_pago_dividendo on public.ventas_tickets;
create trigger trg_medio_pago_dividendo
  before insert or update of medio_pago, medio_pago_id, es_dividendo
  on public.ventas_tickets
  for each row execute function public.trg_medio_pago_dividendo();

drop trigger if exists trg_medio_pago_dividendo on public.ventas_pagos;
create trigger trg_medio_pago_dividendo
  before insert or update of medio_pago, medio_pago_id, es_dividendo
  on public.ventas_pagos
  for each row execute function public.trg_medio_pago_dividendo();

-- ── 3) El Estado de Resultados lee el catálogo, no el flag de la fila ───────
create or replace function public.edr_resumen_ventas(p_local text, p_anio text)
returns table(periodo text, ing_bruto numeric, iva_debito numeric, ticket_count bigint)
language sql
stable
set search_path to 'public'
as $$
  select
    t.periodo,
    sum(t.total_bruto) as ing_bruto,
    sum(coalesce(t.iva, 0)) as iva_debito,
    count(*) as ticket_count
  from v_ventas_tickets_oficial t
  left join public.medios_pago mp on mp.id = t.medio_pago_id
  where t.local = p_local
    and t.periodo >= p_anio || '-01'
    and t.periodo <= p_anio || '-12'
    and t.estado != 'Cancelada'
    and t.estado != 'Eliminada'
    -- Lo cobrado con el POSnet personal del socio no es venta del negocio. Se
    -- pregunta al CATÁLOGO (mig 205) y no al flag de la fila: el flag lo escribían
    -- cuatro lugares distintos y el POS propio lo dejaba en false siempre.
    -- left join a propósito: un ticket sin medio resuelto sigue contando como venta.
    and coalesce(mp.es_dividendo, false) = false
  group by t.periodo
$$;

comment on function public.edr_resumen_ventas(text, text) is
  'Ingresos del Estado de Resultados por mes. Lee v_ventas_tickets_oficial, que '
  'resuelve por local cuál es el origen que vale (mig 188), y descarta los cobros '
  'del POSnet personal preguntándole a medios_pago.es_dividendo (mig 205), no al '
  'flag de cada ticket.';

-- ── Guardarraíl: esto NO puede mover un peso ────────────────────────────────
do $guard$
declare
  v_local  text;
  v_viejo  numeric;
  v_nuevo  numeric;
  v_anio   text := to_char(current_date, 'YYYY');
  v_desig  int;
begin
  -- 1) Los dos caminos tienen que coincidir fila por fila, en las dos tablas.
  select count(*) into v_desig from public.ventas_tickets t
    left join public.medios_pago m on m.id = t.medio_pago_id
   where coalesce(t.es_dividendo, false) is distinct from coalesce(m.es_dividendo, false);
  if v_desig <> 0 then
    raise exception 'GUARDARRAIL: % ticket(s) donde el flag y el catálogo no coinciden.', v_desig;
  end if;

  select count(*) into v_desig from public.ventas_pagos p
    left join public.medios_pago m on m.id = p.medio_pago_id
   where coalesce(p.es_dividendo, false) is distinct from coalesce(m.es_dividendo, false);
  if v_desig <> 0 then
    raise exception 'GUARDARRAIL: % cobro(s) donde el flag y el catálogo no coinciden.', v_desig;
  end if;

  -- 2) Y el EdR de este año tiene que dar exactamente lo mismo que antes.
  foreach v_local in array array['vedia', 'saavedra'] loop
    select coalesce(sum(total_bruto), 0) into v_viejo
      from public.v_ventas_tickets_oficial
     where local = v_local
       and periodo >= v_anio || '-01' and periodo <= v_anio || '-12'
       and estado != 'Cancelada' and estado != 'Eliminada'
       and coalesce(es_dividendo, false) = false;

    select coalesce(sum(ing_bruto), 0) into v_nuevo
      from public.edr_resumen_ventas(v_local, v_anio);

    if round(v_viejo, 2) <> round(v_nuevo, 2) then
      raise exception 'GUARDARRAIL: % pasó de % a %. Tenía que dar igual.', v_local, v_viejo, v_nuevo;
    end if;
    raise notice '% sin cambios: %', v_local, v_nuevo;
  end loop;

  raise notice 'GUARDARRAIL OK — la regla se mudó al catálogo sin mover un peso.';
end
$guard$;

commit;
