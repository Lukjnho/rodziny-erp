-- 182 — El depósito deja de tragarse los errores
--
-- Dos bugs distintos en la misma función, los dos perdiendo plata HOY, sin que
-- haya ningún descuento automático prendido.
--
-- ────────────────────────────────────────────────────────────────────────────
-- BUG 1 — EL STOCK SE FRENA EN CERO Y NADIE SE ENTERA
--
-- La función hacía:
--     v_nuevo_stock := greatest(0, v_prod.stock_actual - p_cantidad);
-- ...pero el movimiento se grababa con p_cantidad COMPLETA. O sea: el papel dice
-- que salieron 4.300 kg y el stock solamente bajó lo que había. La diferencia se
-- evapora sin dejar registro.
--
-- El piso en cero SE MANTIENE, es una regla del negocio de Lucas y es correcta:
-- un stock negativo no tiene sentido físico, es un error de carga. Lo que estaba
-- mal era el silencio. Ahora la diferencia queda guardada en `cantidad_sin_stock`,
-- así se puede ver qué insumo se pidió más veces de las que había.
--
-- Tamaño: 84 de 390 insumos activos (22%) marcan 0,00 y siguen teniendo salidas.
-- El Queso Danbo de Saavedra tuvo 20 salidas en 30 días con el stock en 0,00.
--
-- ────────────────────────────────────────────────────────────────────────────
-- BUG 2 — NADA FRENA UN NÚMERO IMPOSIBLE
--
-- El 4-sep se cargaron 4.300 kg de Queso Danbo en Saavedra ($37,9 M en una fila).
-- El 20-abr, la misma persona había cargado exactamente lo mismo. Hay 74.000 kg
-- de cuadril, 9.415 kg de jamón, 445 kg de orégano.
--
-- La pantalla de Recepción YA tenía este freno (ver UMBRALES_RECEPCION en
-- RecepcionPage.tsx, puesto justamente para "frenar cargas claramente erróneas").
-- A la del depósito nunca se le puso. Va acá, en la base, para que no dependa de
-- qué pantalla lo llame.
--
-- CALIBRACIÓN CONTRA LA HISTORIA (la lección del guardarraíl del mostrador: mirar
-- QUÉ agarra, no sólo cuántas veces salta). Sobre 5.145 salidas de producción:
--
--   unidades  tope 5.000  →  frena 0    | molesta al 0,36%
--   kg        tope 1.000  →  frena 23   | molesta al 1,49%
--   litros    tope 1.000  →  frena 0    | molesta al 0,30%
--
-- Las 23 de kg que frena son TODAS imposibles (74.000 kg de cuadril, 9.415 de
-- jamón, 8.600 de leche en polvo). Cero falsos positivos en cinco meses.
--
-- Las unidades van con tope aparte y más alto a propósito: 1.000 sorbetes o
-- 1.000 bolsas de arranque SON cargas reales, y un tope bajo las frenaría.

begin;

-- ── 1. Dónde queda lo que el piso se comió ──────────────────────────────────
alter table movimientos_stock
  add column if not exists cantidad_sin_stock numeric;

comment on column movimientos_stock.cantidad_sin_stock is
  'Cuánto de esta salida no tenía stock detrás. El stock nunca baja de cero '
  '(regla del negocio), así que cuando se pide más de lo que hay la diferencia '
  'se guarda acá en vez de evaporarse. NULL o 0 = la salida entró completa.';

-- ── 2. La función, con las dos correcciones ─────────────────────────────────
create or replace function public.registrar_salida_deposito(
  p_local text,
  p_producto_id uuid,
  p_cantidad numeric,
  p_motivo text default null,
  p_observacion text default null,
  p_registrado_por text default null
)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_prod record;
  v_nuevo_stock numeric;
  v_sin_stock numeric;
  v_tope numeric;
begin
  if p_local not in ('vedia', 'saavedra') then
    raise exception 'Local inválido: %', p_local;
  end if;
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'Cantidad inválida';
  end if;

  select id, nombre, unidad, coalesce(stock_actual, 0) as stock_actual
    into v_prod
    from productos
   where id = p_producto_id and local = p_local
   for update;

  if not found then
    raise exception 'Producto % no pertenece a % o no existe', p_producto_id::text, p_local;
  end if;

  -- Freno al número imposible. Va en la base y no en la pantalla para que valga
  -- venga de donde venga la llamada. El mensaje nombra el insumo y la cantidad
  -- porque lo lee un operario en una tablet, no un programador en un log.
  v_tope := case lower(coalesce(v_prod.unidad, ''))
              when 'kg' then 1000
              when 'l' then 1000
              else 5000
            end;

  if p_cantidad > v_tope then
    raise exception
      'Cantidad imposible: % % de "%". El máximo por carga es % %. Fijate si sobra un cero o si pusiste un punto donde iba una coma.',
      p_cantidad, v_prod.unidad, v_prod.nombre, v_tope, v_prod.unidad;
  end if;

  -- El piso en cero se mantiene, pero lo que se come queda anotado.
  v_sin_stock := greatest(0, p_cantidad - v_prod.stock_actual);
  v_nuevo_stock := greatest(0, v_prod.stock_actual - p_cantidad);

  update productos
     set stock_actual = v_nuevo_stock,
         updated_at = now()
   where id = v_prod.id;

  insert into movimientos_stock (
    local, producto_id, producto_nombre, tipo, cantidad, unidad,
    motivo, observacion, registrado_por, cantidad_sin_stock
  )
  values (
    p_local,
    v_prod.id,
    v_prod.nombre,
    'salida',
    p_cantidad,
    v_prod.unidad,
    nullif(trim(coalesce(p_motivo, '')), ''),
    nullif(trim(coalesce(p_observacion, '')), ''),
    nullif(trim(coalesce(p_registrado_por, '')), ''),
    nullif(v_sin_stock, 0)
  );

  return v_nuevo_stock;
end;
$function$;

commit;
