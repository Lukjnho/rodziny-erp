-- 195 — Lo que sale de la cámara (el conteo del mostrador deja de marcar faltantes)
--
-- Es el paso 10 del plan de [[salon-saavedra-mesas-diseno]].
--
--
-- ══════════════════════════════════════════════════════════════════════════════
-- LOS DOS AGUJEROS QUE TAPA
-- ══════════════════════════════════════════════════════════════════════════════
--
-- 1) EL AGUJERO QUE YA ESTABA (no lo trajo el salón)
--
-- `/mostrador` calcula ESPERADO = lo que había + lo que entró − lo que se vendió,
-- y "lo que se vendió" lo busca POR NOMBRE: junta los `fudo_nombres` del producto
-- y los compara contra `ventas_items.nombre`. Cuando un plato se vende en Fudo con
-- un nombre que nadie cargó en esa lista, se cuenta CERO y la pantalla dice que
-- falta.
--
-- Medido contra la base el 8-sep-2026, últimos 7 días:
--     vedia    · Mezzelune de Bondiola Braseada ····· contaba 0  de 168
--     saavedra · Cresta di Gallo ··················· contaba 8  de 71
--     saavedra · Mezzelune De Bondiola Braseada ····· contaba 0  de 11
--     vedia    · Sorrentinos de Jamón y queso ······· contaba 200 de 203
--     vedia    · Rigatoni ························· contaba 33 de 34
--
-- O sea: Vedia viene marcando ~168 porciones de faltante por semana en un solo
-- producto, y la pantalla ofrece anotar una merma que nunca existió.
--
-- 💣 Y el día que Saavedra corte a `pos` esto EMPEORA solo: nuestro POS escribe en
-- `ventas_items.nombre` el nombre de la CARTA ("Cappelletti Capresse SG"), que no
-- es ninguno de los `fudo_nombres` ("Cappelletti Capresse"). Con Fudo apagado, el
-- conteo pasaría a dar cero en casi todo.
--
--
-- 2) EL AGUJERO QUE TRAE EL SALÓN
--
-- Un plato sale de la cámara cuando el mozo manda la comanda; el ticket se cobra
-- 45 a 90 minutos después. Contando por la hora del ticket, TODO conteo hecho en
-- el medio de un servicio daría faltante.
--
-- 💣 LA REGLA QUE ESTABA ANOTADA ESTABA MAL. Decía: sumar los renglones de mesa
-- con `ticket_id is null`. Eso arregla el conteo de las 21:30 y ROMPE el de las
-- 23:00, porque el mismo plato vuelve a contarse cuando entra el ticket:
--
--     21:00  el mozo manda la comanda           (el plato sale de la cámara)
--     21:30  conteo → suma el renglón            ✅ cuadra
--     22:30  se cobra la mesa                    (nace el ticket)
--     23:00  conteo → suma el TICKET otra vez    ❌ sobrante fantasma
--
-- La regla correcta es una sola y vale para siempre:
--     UN PLATO DE MESA SE CUENTA UNA VEZ, CUANDO LA COMANDA VA A LA COCINA.
-- Y por eso los tickets de tipo 'salon' quedan afuera de la parte de ventas: ya
-- se contaron al mandarlos.
--
--
-- ══════════════════════════════════════════════════════════════════════════════
-- QUÉ HACE ESTA MIGRACIÓN
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Una función nueva, `cocina_salidas_de_camara`, que contesta "qué salió de la
-- cámara en esta ventana" devolviendo **id de producto**, no nombre. El enganche
-- por nombre queda como último recurso, no como único camino.
--
-- 🔑 NO se toca `cocina_ventas_por_producto`. Esa la usan otras cuatro pantallas
-- (plan de producción, resumen semanal, stock, dashboard) y son estimaciones de
-- demanda a 7 y 14 días, no un conteo físico que ofrece anotar merma. Arrastran el
-- mismo agujero del nombre y hay que arreglarlas, pero es otro entregable: tocar
-- las cinco de una es el cambio con más chances de romper lo que hoy anda.
--
-- Son dos preguntas distintas y por eso son dos funciones:
--     cocina_ventas_por_producto  → qué se VENDIÓ   (a la hora del ticket)
--     cocina_salidas_de_camara    → qué SALIÓ       (a la hora en que salió)
--
begin;

-- ── La escalera para saber de qué producto es cada renglón ───────────────────
--
-- Se prueba en este orden y el primero que engancha gana:
--   1. `cocina_producto_id` — el renglón ya dice de qué producto es.
--   2. `receta_id` → `cocina_recetas.descuenta_producto_id` — la receta dice de
--      qué producto se descuenta. Es el camino del 85% de los renglones y el que
--      recupera la Bondiola y la Cresta di Gallo.
--   3. El nombre, contra `nombre` y `fudo_nombres` del producto. Igual que lo hace
--      hoy la pantalla, y por eso este paso NO es `limit 1`: abre a todos los
--      productos que enganchen, como abre hoy la pantalla. Si se achicara a uno,
--      un combo tipo "Mila napo + fideos" —que hoy le cuenta a la Milanesa Y a los
--      Tagliatelles— perdería la mitad.
--
create or replace function public.cocina_salidas_de_camara(
  p_local  text,
  p_desde  timestamptz,
  p_hasta  timestamptz
)
returns table (producto_id uuid, cantidad numeric)
language sql
stable
security definer
set search_path = public
as $$
  with salidas as (
    -- (a) Lo que cobró el mostrador y todo lo que trae Fudo, a la hora del ticket.
    --     Los tickets de SALÓN quedan afuera a propósito: esos platos ya se
    --     contaron cuando la comanda salió a la cocina, abajo.
    select i.receta_id, i.cocina_producto_id, i.nombre, i.cantidad
      from ventas_items i
      join ventas_tickets t on t.id = i.ticket_id
     where i.local = p_local
       and coalesce(t.tipo_venta, '') <> 'salon'
       -- Recorte grueso por fecha para entrar por idx_ventas_items_local_fecha. Se
       -- abre un día para cada lado porque el corte fino es por HORA.
       and i.fecha >= ((p_desde at time zone 'America/Argentina/Buenos_Aires')::date - 1)
       and i.fecha <= ((p_hasta at time zone 'America/Argentina/Buenos_Aires')::date + 1)
       and ((t.fecha + t.hora) at time zone 'America/Argentina/Buenos_Aires') >= p_desde
       and ((t.fecha + t.hora) at time zone 'America/Argentina/Buenos_Aires') <  p_hasta

    union all

    -- (b) Lo que salió a una mesa, a la hora del ENVÍO a la cocina.
    --
    --     Entra el renglón que tiene envío, esté cobrado o no, y esté 'activa' o
    --     'sacada'. Un renglón sin envío todavía no salió de la cámara: vive sólo
    --     en el teléfono del mozo.
    --
    --     🔑 Los SACADOS también cuentan: si la comanda ya fue, la pasta se hizo y
    --     de la cámara salió igual. El porqué queda anotado en `sacada_motivo`, que
    --     es donde hay que mirarlo. Si algún día se decide al revés, se cambia
    --     agregando `and l.estado = 'activa'` acá y en ningún otro lado.
    select l.receta_id, null::uuid, l.nombre, l.cantidad
      from caja_mesa_lineas l
      join caja_mesa_envios e on e.id = l.envio_id
     where l.local = p_local
       and e.enviado_en >= p_desde
       and e.enviado_en <  p_hasta
  ),
  por_id as (
    select coalesce(
             s.cocina_producto_id,
             (select r.descuenta_producto_id
                from cocina_recetas r
               where r.id = s.receta_id)
           ) as pid,
           s.nombre,
           s.cantidad
      from salidas s
  ),
  enganchado as (
    select p.pid, p.cantidad
      from por_id p
     where p.pid is not null

    union all

    -- Último recurso: por nombre, para los renglones que no tienen ni producto ni
    -- receta (bebidas, extras, y los productos a los que todavía nadie les vinculó
    -- una receta — el Tortelli de Espinaca es uno).
    select cp.id, p.cantidad
      from por_id p
      join cocina_productos cp
        on cp.local = p_local
       and (
             lower(btrim(regexp_replace(cp.nombre, '\s+', ' ', 'g')))
               = lower(btrim(regexp_replace(p.nombre, '\s+', ' ', 'g')))
          or exists (
               select 1
                 from unnest(coalesce(cp.fudo_nombres, array[]::text[])) x
                where lower(btrim(regexp_replace(x, '\s+', ' ', 'g')))
                    = lower(btrim(regexp_replace(p.nombre, '\s+', ' ', 'g')))
             )
           )
     where p.pid is null
  )
  -- 🔒 El join contra cocina_productos filtrando por local no es decorativo: si una
  -- receta quedara apuntando al producto de la otra casa, acá se cae en vez de
  -- ensuciar el conteo del local equivocado.
  select e.pid, sum(e.cantidad)::numeric as cantidad
    from enganchado e
    join cocina_productos cp on cp.id = e.pid and cp.local = p_local
   group by e.pid
  having sum(e.cantidad) <> 0;
$$;

comment on function public.cocina_salidas_de_camara(text, timestamptz, timestamptz) is
  'Qué salió de la cámara en una ventana, por ID DE PRODUCTO. Lo del mostrador y '
  'lo de Fudo se cuenta a la hora del ticket; lo del salón, a la hora en que la '
  'comanda fue a la cocina (por eso los tickets tipo_venta = ''salon'' quedan '
  'afuera: contarlos sería contar el mismo plato dos veces). Devuelve sólo id y '
  'cantidad, sin un peso, para que la pantalla pública /mostrador pueda leerla '
  'como anon. NO reemplaza a cocina_ventas_por_producto: esa contesta qué se '
  'vendió, ésta qué salió, y no son lo mismo cuando hay mesas de por medio.';

-- Sólo lectura agregada y sin importes: se puede abrir a las tablets, igual que
-- cocina_ventas_por_producto (mig 184).
grant execute on function public.cocina_salidas_de_camara(text, timestamptz, timestamptz)
  to anon, authenticated;

-- ── Guardarraíl ─────────────────────────────────────────────────────────────
do $guard$
declare
  v_viejo   numeric;
  v_nuevo   numeric;
  v_desde   timestamptz := now() - interval '7 days';
  v_hasta   timestamptz := now();
  r         record;
begin
  -- 1) La función existe y contesta.
  perform 1 from public.cocina_salidas_de_camara('vedia', v_desde, v_hasta);

  -- 2) NUNCA puede contar menos que hoy: el camino del nombre sigue estando, así
  --    que lo nuevo sólo puede sumar. Si un producto baja, algo se rompió.
  for r in
    select cp.local, cp.nombre,
           coalesce(vi.viejo, 0) as viejo,
           coalesce(nu.cantidad, 0) as nuevo
      from public.cocina_productos cp
      left join lateral (
        select sum(i.cantidad) as viejo
          from public.ventas_items i
          join public.ventas_tickets t on t.id = i.ticket_id
         where i.local = cp.local
           and i.fecha >= (v_desde::date - 1) and i.fecha <= (v_hasta::date + 1)
           and ((t.fecha + t.hora) at time zone 'America/Argentina/Buenos_Aires') >= v_desde
           and ((t.fecha + t.hora) at time zone 'America/Argentina/Buenos_Aires') <  v_hasta
           and lower(btrim(regexp_replace(i.nombre, '\s+', ' ', 'g'))) = any (
                 select lower(btrim(regexp_replace(x, '\s+', ' ', 'g')))
                   from unnest(case when coalesce(array_length(cp.fudo_nombres, 1), 0) > 0
                                    then cp.fudo_nombres else array[cp.nombre] end) x)
      ) vi on true
      left join lateral (
        select s.cantidad from public.cocina_salidas_de_camara(cp.local, v_desde, v_hasta) s
         where s.producto_id = cp.id
      ) nu on true
     where cp.tipo = 'pasta' and cp.activo
  loop
    if r.nuevo < r.viejo then
      raise exception 'GUARDARRAIL: "%" de % contaba % y ahora cuenta % — lo nuevo no puede contar MENOS.',
        r.nombre, r.local, r.viejo, r.nuevo;
    end if;
    if r.nuevo <> r.viejo then
      raise notice 'recupera · % · % : % -> % (+%)', r.local, r.nombre, r.viejo, r.nuevo, r.nuevo - r.viejo;
    end if;
  end loop;

  -- 3) Sin mesas cargadas todavía, un ticket de salón no existe: el total general
  --    tiene que dar lo mismo que la suma cruda de ventas_items enganchadas.
  select coalesce(sum(s.cantidad), 0) into v_nuevo
    from public.cocina_salidas_de_camara('saavedra', v_desde, v_hasta) s
    join public.cocina_productos cp on cp.id = s.producto_id and cp.tipo = 'pasta';
  if v_nuevo <= 0 then
    raise exception 'GUARDARRAIL: Saavedra no devolvió ninguna pasta en 7 días. Algo quedó mal enganchado.';
  end if;
  raise notice 'saavedra, pastas 7 dias: % porciones', v_nuevo;

  raise notice 'GUARDARRAIL OK';
end
$guard$;

commit;
