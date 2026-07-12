-- Dividendos MP Lucas: una sola fuente de verdad (el cierre de caja).
--
-- PROBLEMA
-- Los cobros con el POSnet personal de Lucas se registraban como dividendo por
-- DOS caminos que no se conocían entre sí:
--   a) el cierre de caja        → 1 fila agregada por turno (cierres_caja.fudo_mp_lucas),
--                                 vinculada en cierres_caja.dividendo_id. Idempotente.
--   b) el import de ventas Fudo → 1 fila por CADA cobro (creado_por='import_fudo').
--   c) una migración vieja      → creado_por='migracion_mp_lucas'.
-- Resultado: el mismo cobro se contaba 2 veces y el Flujo de Caja restaba
-- dividendos que no existían. $6.378.000 inflados entre ene/mar/jun/jul 2026.
--
-- DECISIÓN (Lucas, jul-2026): la fuente única es el CIERRE DE CAJA. El import de
-- Fudo deja de crear dividendos (ver supabase/functions/fudo-importar-ventas).
--
-- CUIDADO — por qué esto no es un DELETE masivo:
-- Mayo y abril 2026 tienen dividendos MP Lucas creados SOLO por el import (no se
-- hacían cierres con fudo_mp_lucas todavía). Borrar todo lo del import les
-- volaría $3,7M de dividendos reales. Por eso el borrado es quirúrgico: solo se
-- elimina el duplicado cuando existe un dividendo del cierre para el MISMO
-- local+fecha. Lo demás se conserva y se blinda como histórico.

begin;

-- Los dividendos que corresponden a cobros con el POSnet personal.
create temporary table _mp_lucas on commit drop as
select
  d.id,
  d.local,
  d.fecha,
  d.periodo,
  d.monto,
  d.creado_por,
  (d.id in (select dividendo_id from cierres_caja where dividendo_id is not null)) as es_del_cierre
from dividendos d
where lower(coalesce(d.medio_pago, '')) like '%mercadopago lucas%'
   or lower(coalesce(d.concepto, '')) like '%posnet%'
   or lower(coalesce(d.concepto, '')) like '%mp lucas%';

-- Días (local + fecha) donde el cierre de caja ya generó el dividendo agregado.
create temporary table _dias_con_cierre on commit drop as
select distinct local, fecha from _mp_lucas where es_del_cierre;

-- 1) Duplicados del cierre: mismo local+fecha ya cubierto por el cierre de caja.
--    (jul-2026: 47 filas / $1.173.100 · jun-2026: 92 filas / $2.091.100)
delete from dividendos d
using _mp_lucas m
where d.id = m.id
  and not m.es_del_cierre
  and exists (
    select 1 from _dias_con_cierre c where c.local = m.local and c.fecha = m.fecha
  );

-- 2) Duplicados de la migración vieja contra el import de Fudo, en días SIN cierre.
--    Gana el import (viene de la API de Fudo, cobro por cobro).
--    (mar-2026: 41 filas / $990.300 · ene-2026: 81 filas / $2.123.500)
delete from dividendos d
using _mp_lucas m
where d.id = m.id
  and m.creado_por = 'migracion_mp_lucas'
  and not exists (
    select 1 from _dias_con_cierre c where c.local = m.local and c.fecha = m.fecha
  )
  and exists (
    select 1 from _mp_lucas i
    where i.creado_por = 'import_fudo' and i.local = m.local and i.fecha = m.fecha
  );

-- 3) Blindar los sobrevivientes del import (abr/may/ene/mar: meses sin cierre).
--    El import de Fudo borra por `creado_por='import_fudo'` antes de reinsertar.
--    Al dejar de crear dividendos, un reimport de esos meses los borraría sin
--    recrearlos. Renombrarlos los saca del alcance de ese DELETE para siempre.
update dividendos
set creado_por = 'historico_mp_lucas'
where id in (select id from _mp_lucas where creado_por = 'import_fudo')
  and id in (select id from dividendos); -- solo los que sobrevivieron

commit;
