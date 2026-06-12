-- 106_registrar_salida_deposito_rpc.sql
-- Gemela de recepcionar_mercaderia (mig 102), pero para SALIDAS de depósito.
--
-- El QR /deposito es una ruta pública (sin login) → corre como anon. anon SÍ
-- puede insertar en movimientos_stock (mov_stock_anon_insert) pero NO puede
-- hacer UPDATE sobre productos (solo productos_anon_select). El DepositoForm
-- insertaba el movimiento y después intentaba un UPDATE directo de stock_actual
-- que la RLS descartaba en silencio (0 filas, sin error y sin chequeo). Resultado:
-- el movimiento quedaba logueado pero el stock NO se movía ("a veces el stock no
-- se actualiza con la carga"). Es el mismo bug que mig 102 arregló para entradas,
-- pero la salida nunca se migró.
--
-- Esta RPC concentra los 2 pasos (resta de stock + movimiento de salida) en una
-- sola transacción atómica leyendo el valor VIVO de la fila (for update), sin
-- reabrir el UPDATE genérico sobre productos. Stock nunca negativo (max 0), como
-- el resto del ERP.

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
as $$
declare
  v_prod record;
  v_nuevo_stock numeric;
begin
  if p_local not in ('vedia', 'saavedra') then
    raise exception 'Local inválido: %', p_local;
  end if;
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'Cantidad inválida';
  end if;

  -- El producto debe existir y pertenecer al local. Bloquea la fila para evitar
  -- perder cambios en salidas/entradas concurrentes del mismo producto.
  select id, nombre, unidad, coalesce(stock_actual, 0) as stock_actual
    into v_prod
    from productos
   where id = p_producto_id and local = p_local
   for update;

  if not found then
    raise exception 'Producto % no pertenece a % o no existe', p_producto_id::text, p_local;
  end if;

  -- Stock nunca negativo: tope en 0 (misma regla que el resto del ERP).
  v_nuevo_stock := greatest(0, v_prod.stock_actual - p_cantidad);

  update productos
     set stock_actual = v_nuevo_stock,
         updated_at = now()
   where id = v_prod.id;

  insert into movimientos_stock (local, producto_id, producto_nombre, tipo, cantidad, unidad, motivo, observacion, registrado_por)
  values (
    p_local,
    v_prod.id,
    v_prod.nombre,
    'salida',
    p_cantidad,
    v_prod.unidad,
    nullif(trim(coalesce(p_motivo, '')), ''),
    nullif(trim(coalesce(p_observacion, '')), ''),
    nullif(trim(coalesce(p_registrado_por, '')), '')
  );

  return v_nuevo_stock;
end;
$$;

revoke all on function public.registrar_salida_deposito(text, uuid, numeric, text, text, text) from public;
grant execute on function public.registrar_salida_deposito(text, uuid, numeric, text, text, text) to anon, authenticated;

comment on function public.registrar_salida_deposito is
  'Registra una salida de depósito por QR (anon): resta el stock_actual del producto del local (tope 0) y loguea el movimiento de salida, atómico. Único punto de entrada para que el QR /deposito mueva stock sin reabrir UPDATE genérico sobre productos (gemela de recepcionar_mercaderia, mig 102).';
