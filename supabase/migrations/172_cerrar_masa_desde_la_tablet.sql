-- 172 — Cerrar masa desde la tablet (pantalla pública /produccion)
--
-- EL PROBLEMA
-- `cocina_lotes_masa` tiene policies de INSERT y SELECT para `anon`, pero NO de
-- UPDATE. Como un UPDATE que la RLS bloquea devuelve 0 filas y error NULL, las
-- dos pantallas que cierran masa venían diciendo "listo" sin guardar nada:
--
--   1. "Cerrar Masa"       → 218 masas cargadas, 3 cerradas (las 3 de mayo, y
--                            desde el ERP con sesión). Junio 0/31, julio 0/62,
--                            agosto 0/74. Quedaron 215 masas abiertas.
--   2. "Cargar Panadería"  → descuenta la masa cerrando el lote con el sobrante.
--                            54 cargas desde junio, 0 descuentos: la misma masa
--                            se podía volver a usar infinitas veces.
--
-- POR QUÉ UNA FUNCIÓN Y NO UNA POLICY ABIERTA
-- La clave `anon` viaja dentro de la página, así que lo que puede anon lo puede
-- cualquiera que la abra. Una policy `USING (true)` dejaría reescribir CUALQUIER
-- columna de CUALQUIER lote (kg_producidos, local, fecha). Esta función toca
-- exactamente dos columnas, valida antes de escribir y DEVUELVE LA FILA, así la
-- pantalla puede comprobar que el cambio ocurrió de verdad en vez de confiar en
-- que "no hubo error".

create or replace function public.cocina_cerrar_masa(
  p_lote_id     uuid,
  p_kg_sobrante numeric,
  p_destino     text default null
)
returns public.cocina_lotes_masa
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lote    public.cocina_lotes_masa;
  v_destino text;
begin
  select * into v_lote
    from public.cocina_lotes_masa
   where id = p_lote_id;

  if not found then
    raise exception 'No existe esa masa.';
  end if;

  if v_lote.kg_sobrante is not null then
    raise exception 'Esa masa ya se había cerrado el % con % kg de sobrante.',
      to_char(v_lote.fecha, 'DD/MM'), v_lote.kg_sobrante;
  end if;

  if p_kg_sobrante is null or p_kg_sobrante < 0 then
    raise exception 'Indicá cuántos kg sobraron (0 si no queda nada).';
  end if;

  -- +1 g de tolerancia: la balanza y el redondeo del front no tienen por qué
  -- coincidir al gramo con lo que se cargó como producido.
  if p_kg_sobrante > v_lote.kg_producidos + 0.001 then
    raise exception 'El sobrante (% kg) no puede ser más que lo producido (% kg).',
      p_kg_sobrante, v_lote.kg_producidos;
  end if;

  v_destino := nullif(btrim(coalesce(p_destino, '')), '');

  -- Si sobró masa hay que decir a dónde fue. Si no lo tiene, no guarda.
  if p_kg_sobrante > 0 and v_destino is null then
    raise exception 'Indicá a dónde va el sobrante.';
  end if;

  update public.cocina_lotes_masa
     set kg_sobrante      = p_kg_sobrante,
         destino_sobrante = case when p_kg_sobrante > 0 then v_destino else null end
   where id = p_lote_id
  returning * into v_lote;

  return v_lote;
end;
$$;

comment on function public.cocina_cerrar_masa(uuid, numeric, text) is
  'Cierra un lote de masa (kg_sobrante + destino) desde la tablet pública. Existe '
  'porque anon no tiene UPDATE sobre cocina_lotes_masa y un UPDATE bloqueado por '
  'RLS devuelve 0 filas sin error: los botones "Cerrar Masa" y "Cargar Panadería" '
  'decían que guardaban y no guardaban nada. Devuelve la fila para que la pantalla '
  'pueda verificar el efecto.';

-- Que no la pueda ejecutar cualquiera por defecto, solo las dos puntas que la usan.
revoke all     on function public.cocina_cerrar_masa(uuid, numeric, text) from public;
grant  execute on function public.cocina_cerrar_masa(uuid, numeric, text) to anon, authenticated;
