-- 170 · Una sola cuenta de "cuanto hay en el mostrador"
--
-- EL PROBLEMA. Hoy hay TRES cuentas distintas del mostrador conviviendo, cada una
-- escrita adentro de su pantalla: StockTab, DashboardTab y el QR /mostrador. Las tres
-- tienen la misma intencion pero difieren en los bordes, y ninguna vive en la base.
-- Es el mismo lio que ya tuvimos con el stock de camara y que se arreglo con
-- v_cocina_stock_pastas: la cuenta va en la base y las pantallas la LEEN.
--
-- LA CUENTA, en criollo:
--   arranca del ULTIMO CONTEO FISICO de ese producto (cocina_cierre_dia, tipo='pasta')
--   + lo que bajo de camara despues de ese conteo   (cocina_traspasos)
--   - lo que se vendio despues de ese conteo        (ventas_items, via mig 169)
--   - lo que se tiro despues de ese conteo          (cocina_merma)
--   + los ajustes de mostrador posteriores          (cocina_ajustes_stock)
-- Si el producto nunca se conto, arranca de las 00:00 de hoy hora Argentina.
--
-- ⚠️ REGLA DE LUCAS: LA VENTA DESCUENTA EL MOSTRADOR, NUNCA LA CAMARA. La camara ya la
-- descuenta el traspaso. Por eso esta vista NO toca v_cocina_stock_pastas.
-- Y 1 venta = 1 porcion: se suma `cantidad` tal cual, sin factores de conversion.
--
-- 🔑 LO QUE ESTA CUENTA PUEDE Y LA DE HOY NO. Las tres pantallas le preguntan a la API
-- de Fudo, que no devuelve la hora de cada venta — StockTab lo dice en un comentario y
-- por eso redondea: "si el cierre fue HOY, no descontamos ventas". La tabla propia SI
-- tiene la hora (ventas_tickets.hora), asi que aca se descuentan exactamente las ventas
-- posteriores al conteo DE ESE producto. Eso ademas mata el bug de la ventana del QR,
-- que hoy arranca del cierre mas viejo de TODOS los productos y cuenta de mas.
--
-- ⚠️ LA VISTA NO ESTA AL DIA HASTA QUE SE ARREGLE EL IMPORTADOR. Las ventas de Fudo
-- entran una vez por dia (cron 8am), asi que durante la jornada `ventas_post` va a dar
-- casi cero para lo de Fudo. Las del POS propio si son instantaneas. Por eso NINGUNA
-- pantalla se apunta a esta vista todavia: primero el importador, despues las pantallas.
--
-- VALIDADO contra 349 pares de conteos (mediodia -> noche) de los ultimos 30 dias:
--   245 dan CLAVADO (70%), 293 dentro de 1 porcion (84%), 315 dentro de 3 (90%).
--   Los 31 casos que se pasan de 5 NO son error de la cuenta: son dias de Vedia donde
--   bajaron pasta al mostrador SIN registrar el traspaso (el peor: Ñoquis de papa el
--   21-ago, conteo del mediodia 39 y a la noche contaron 135, con 0 traspasos anotados).
--   La cuenta esta mostrando que falta el papel, no equivocandose.

create or replace view public.v_cocina_stock_mostrador as
with cierre as (
  -- El ultimo conteo fisico del mostrador, por producto y local.
  select distinct on (producto_id, local)
         producto_id, local, cantidad_real, created_at, fecha, turno
  from public.cocina_cierre_dia
  where tipo = 'pasta' and producto_id is not null
  order by producto_id, local, created_at desc
),
base as (
  select p.id as producto_id, p.nombre, p.local, p.codigo,
         c.cantidad_real as conteo_base,
         c.created_at   as ultimo_conteo_at,
         c.fecha        as ultimo_conteo_fecha,
         c.turno        as ultimo_conteo_turno,
         -- El corte, en hora Argentina. Sin conteo, arranca hoy a las 00:00 AR.
         coalesce(
           c.created_at at time zone 'America/Argentina/Buenos_Aires',
           ((now() at time zone 'America/Argentina/Buenos_Aires')::date)::timestamp
         ) as corte
  from public.cocina_productos p
  left join cierre c on c.producto_id = p.id and c.local = p.local
  where p.tipo = 'pasta' and p.activo = true
)
select
  b.producto_id,
  b.nombre,
  b.codigo,
  b.local,
  coalesce(b.conteo_base, 0)::numeric      as conteo_base,
  b.ultimo_conteo_at,
  b.ultimo_conteo_fecha,
  b.ultimo_conteo_turno,
  (b.ultimo_conteo_at is null)             as sin_conteo,
  coalesce(tr.n, 0)::numeric               as traspasos_post,
  coalesce(ve.n, 0)::numeric               as ventas_post,
  coalesce(me.n, 0)::numeric               as merma_post,
  coalesce(aj.n, 0)::numeric               as ajustes_post,
  -- El numero para mostrar: nunca negativo (regla del cero del proyecto).
  greatest(0, coalesce(b.conteo_base,0) + coalesce(tr.n,0) - coalesce(ve.n,0)
                - coalesce(me.n,0) + coalesce(aj.n,0))::numeric as porciones_mostrador,
  -- El crudo, con signo: si da negativo es que se vendio mas de lo que figura que bajo.
  -- Sirve para avisar, no para mostrar.
  (coalesce(b.conteo_base,0) + coalesce(tr.n,0) - coalesce(ve.n,0)
     - coalesce(me.n,0) + coalesce(aj.n,0))::numeric as porciones_mostrador_crudo
from base b
left join lateral (
  select sum(t.porciones) as n from public.cocina_traspasos t
  where t.producto_id = b.producto_id and t.local = b.local
    and (t.created_at at time zone 'America/Argentina/Buenos_Aires') > b.corte
) tr on true
left join lateral (
  select sum(vi.cantidad) as n
  from public.ventas_items vi
  join public.ventas_tickets vt on vt.id = vi.ticket_id
  left join public.cocina_recetas r on r.id = vi.receta_id
  where coalesce(vi.cocina_producto_id, r.descuenta_producto_id) = b.producto_id
    and vi.local = b.local
    and (vt.fecha + vt.hora) > b.corte
) ve on true
left join lateral (
  select sum(m.porciones) as n from public.cocina_merma m
  where m.producto_id = b.producto_id and m.local = b.local
    and (m.created_at at time zone 'America/Argentina/Buenos_Aires') > b.corte
) me on true
left join lateral (
  select sum(a.delta) as n from public.cocina_ajustes_stock a
  where a.producto_id = b.producto_id and a.local = b.local and a.ubicacion = 'mostrador'
    and (a.created_at at time zone 'America/Argentina/Buenos_Aires') > b.corte
) aj on true;

comment on view public.v_cocina_stock_mostrador is
  'La unica cuenta del stock en mostrador. Arranca del ultimo conteo fisico y le suma lo '
  'posterior (traspasos - ventas - merma + ajustes). La venta descuenta ACA, nunca la camara. '
  'Ninguna pantalla debe recalcular esto. Hermana de v_cocina_stock_pastas (camara).';

-- ⚠️ A PROPOSITO: esta vista NO se le abre a anon todavia.
-- Corre con los permisos del dueño, asi que saltea la RLS de ventas_items: si se le diera
-- lectura a anon, cualquiera con la URL de una pantalla publica podria leer cuanto se
-- vende de cada producto. El QR /mostrador la va a necesitar, pero eso se decide aparte
-- y con una vista mas angosta si hace falta. Ver la leccion de los legajos legibles sin
-- sesion. El landmine del proyecto es que las vistas nuevas nacen legibles por anon.
revoke all on public.v_cocina_stock_mostrador from anon;
grant select on public.v_cocina_stock_mostrador to authenticated;
