-- 102_recepcionar_mercaderia_rpc.sql
-- Function SECURITY DEFINER para que el QR público (anon) de Recepción pueda
-- sumar mercadería al stock. Desde el hardening de junio 2026 (borrado de
-- productos_anon_update) anon perdió el UPDATE sobre productos: el QR insertaba
-- la recepción y el movimiento, pero el UPDATE de stock_actual moría en silencio
-- (RLS lo descarta sin error → 0 filas afectadas). Resultado: las recepciones
-- por QR no movían el stock.
--
-- Esta RPC concentra los 3 pasos (recepción pendiente + movimiento entrada +
-- suma de stock) en una sola transacción atómica, sin reabrir el UPDATE
-- genérico sobre productos. Mismo patrón que porcionar_pasta_lote (mig 029).

create or replace function public.recepcionar_mercaderia(
  p_local text,
  p_items jsonb,
  p_registrado_por text,
  p_foto_path text default null,
  p_notas text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_recepcion_id uuid;
  v_item jsonb;
  v_producto_id uuid;
  v_cantidad numeric;
  v_prod record;
begin
  if p_local not in ('vedia', 'saavedra') then
    raise exception 'Local inválido: %', p_local;
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'No hay productos para recibir';
  end if;
  if nullif(trim(coalesce(p_registrado_por, '')), '') is null then
    raise exception 'Falta el nombre de quien recibe';
  end if;

  -- 1) Recepción pendiente (Martín valida los precios después)
  insert into recepciones_pendientes (local, proveedor, items, registrado_por, notas, foto_path)
  values (p_local, null, p_items, trim(p_registrado_por), nullif(trim(coalesce(p_notas, '')), ''), p_foto_path)
  returning id into v_recepcion_id;

  -- 2) Por cada item: validar producto del local, sumar stock y loguear el movimiento
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_producto_id := (v_item ->> 'producto_id')::uuid;
    v_cantidad := (v_item ->> 'cantidad')::numeric;

    if v_cantidad is null or v_cantidad <= 0 then
      raise exception 'Cantidad inválida para %', coalesce(v_item ->> 'producto_nombre', 'producto');
    end if;

    -- El producto debe existir y pertenecer al local recibido. Bloquea la fila
    -- para evitar perder sumas en recepciones concurrentes del mismo producto.
    select id, nombre, unidad, coalesce(stock_actual, 0) as stock_actual
      into v_prod
      from productos
     where id = v_producto_id and local = p_local
     for update;

    if not found then
      raise exception 'Producto % no pertenece a % o no existe', coalesce(v_item ->> 'producto_nombre', v_producto_id::text), p_local;
    end if;

    update productos
       set stock_actual = v_prod.stock_actual + v_cantidad,
           updated_at = now()
     where id = v_prod.id;

    insert into movimientos_stock (local, producto_id, producto_nombre, tipo, cantidad, unidad, motivo, registrado_por)
    values (p_local, v_prod.id, v_prod.nombre, 'entrada', v_cantidad, v_prod.unidad, 'Recepción mercadería', trim(p_registrado_por));
  end loop;

  return v_recepcion_id;
end;
$$;

revoke all on function public.recepcionar_mercaderia(text, jsonb, text, text, text) from public;
grant execute on function public.recepcionar_mercaderia(text, jsonb, text, text, text) to anon, authenticated;

comment on function public.recepcionar_mercaderia is
  'Registra una recepción de mercadería por QR (anon): inserta la recepción pendiente, suma el stock_actual de cada producto del local y loguea los movimientos de entrada, todo atómico. Único punto de entrada para que el QR sume stock sin reabrir UPDATE genérico sobre productos (ver hardening jun 2026).';
