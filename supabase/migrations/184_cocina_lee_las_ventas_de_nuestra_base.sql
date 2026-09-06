-- 184 — Cocina lee las ventas de NUESTRA base, no de la API de Fudo
--
-- POR QUÉ
-- Siete llamadas en cinco pantallas de Cocina le preguntaban a la API de Fudo EN
-- VIVO (Edge Function `fudo-productos`). El día que Fudo se corte devuelven cero y
-- las pantallas mienten sin dar un solo error: el plan de producción se calcula con
-- demanda cero, el stock muestra cobertura infinita y el conteo del mostrador dice
-- que sobra todo.
--
-- Lucas ya decidió que Fudo se va. Estas dos funciones lo reemplazan leyendo
-- `ventas_items`, que YA escriben los dos orígenes (el importador de Fudo cada 15
-- minutos por la mig 180, y el POS propio).
--
-- VALIDADO CONTRA FUDO, MISMA VENTANA (1 al 4 de septiembre)
--   Vedia:    49 productos, 49 coinciden exacto, 0 difieren. 1.067 unidades = 1.067.
--   Saavedra: 66 productos, 64 exactos. Total 598 = 598.
-- Las 2 diferencias de Saavedra son EL MISMO producto renombrado en Fudo (9 unidades
-- que allá figuran como "Mezzelune de bondiola" y acá como "Mezzelune de vacío de
-- cerdo"). O sea: la API reescribe la historia cuando alguien renombra; nuestra copia
-- guarda el nombre que el producto tenía el día que se vendió.
--
-- POR QUÉ FUNCIÓN Y NO VISTA
-- `/mostrador` es pantalla PÚBLICA: entra a la base como `anon`. Darle lectura a
-- `ventas_items` expondría precios y totales. Estas funciones devuelven SÓLO nombre
-- y cantidad — ni un peso — así que se le puede dar acceso sin exponer plata.
-- (Se verificó que las pantallas declaraban `facturacion` y `categoria` en sus tipos
-- pero NO las usaban en ningún lado; por eso no hacen falta.)
--
-- LA HORA ES ARGENTINA
-- `ventas_tickets.hora` es hora local, no UTC. Verificado contra la distribución
-- real: los picos caen 12-14h y 21-23h. Si fuera UTC el almuerzo aparecería 15-17h.
-- El conteo del mostrador depende de esto: pide "lo vendido desde las 14:35", no
-- "lo vendido hoy".
--
-- SOBRE EL ESTADO DEL TICKET
-- No se filtra por `estado` a propósito. Hoy existe UN SOLO valor ('Cerrada', 44.894
-- tickets) porque el importador sólo trae cerrados. Filtrar por un texto que el POS
-- podría escribir distinto haría desaparecer ventas EN SILENCIO, que es la peor de
-- las dos fallas posibles. Cuando el POS tenga anulaciones, ahí se agrega el filtro
-- a propósito y no antes.

begin;

-- ── Ranking de lo vendido en una ventana ────────────────────────────────────
create or replace function public.cocina_ventas_por_producto(
  p_local text,
  p_desde timestamptz,
  p_hasta timestamptz
)
returns table (nombre text, cantidad numeric)
language sql
stable
security definer
set search_path = public
as $$
  select i.nombre, sum(i.cantidad)::numeric as cantidad
    from ventas_items i
    join ventas_tickets t on t.id = i.ticket_id
   where i.local = p_local
     -- Recorte grueso por fecha para entrar por idx_ventas_items_local_fecha. Se
     -- abre un día para cada lado porque el corte fino es por HORA: una venta de
     -- las 23:50 del día anterior puede caer dentro de la ventana pedida.
     and i.fecha >= ((p_desde at time zone 'America/Argentina/Buenos_Aires')::date - 1)
     and i.fecha <= ((p_hasta at time zone 'America/Argentina/Buenos_Aires')::date + 1)
     -- Corte exacto.
     and ((t.fecha + t.hora) at time zone 'America/Argentina/Buenos_Aires') >= p_desde
     and ((t.fecha + t.hora) at time zone 'America/Argentina/Buenos_Aires') <  p_hasta
   group by i.nombre
  having sum(i.cantidad) <> 0
   order by 2 desc;
$$;

comment on function public.cocina_ventas_por_producto(text, timestamptz, timestamptz) is
  'Lo vendido por producto en una ventana, desde ventas_items (Fudo + POS). Devuelve '
  'sólo nombre y cantidad, sin plata, para poder llamarse desde las pantallas '
  'públicas de tablet. Reemplaza la Edge Function fudo-productos.';

-- ── Tickets por día de semana (lo usa el plan de producción) ────────────────
create or replace function public.cocina_tickets_por_dia_semana(
  p_local text,
  p_desde timestamptz,
  p_hasta timestamptz
)
returns table (dia_semana int, tickets bigint)
language sql
stable
security definer
set search_path = public
as $$
  select extract(dow from t.fecha)::int as dia_semana, count(*)::bigint as tickets
    from ventas_tickets t
   where t.local = p_local
     and t.fecha >= ((p_desde at time zone 'America/Argentina/Buenos_Aires')::date - 1)
     and t.fecha <= ((p_hasta at time zone 'America/Argentina/Buenos_Aires')::date + 1)
     and ((t.fecha + t.hora) at time zone 'America/Argentina/Buenos_Aires') >= p_desde
     and ((t.fecha + t.hora) at time zone 'America/Argentina/Buenos_Aires') <  p_hasta
   group by 1;
$$;

comment on function public.cocina_tickets_por_dia_semana(text, timestamptz, timestamptz) is
  'Cantidad de tickets por día de semana en una ventana. Alimenta el factor "mañana '
  'se vende más/menos que el promedio" del plan de producción. Sin plata.';

-- Sólo lectura agregada y sin importes: se puede abrir a las tablets.
grant execute on function public.cocina_ventas_por_producto(text, timestamptz, timestamptz)
  to anon, authenticated;
grant execute on function public.cocina_tickets_por_dia_semana(text, timestamptz, timestamptz)
  to anon, authenticated;

commit;
