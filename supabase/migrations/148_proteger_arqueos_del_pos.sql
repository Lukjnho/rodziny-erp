-- 148 — El arqueo cerrado por el cajero no se reescribe
--
-- El formulario de Finanzas → Cierre de Caja guarda con un `upsert` por
-- (local, fecha, turno, caja). Si administración cargaba un cierre para una
-- fecha y turno que el POS ya había cerrado, **le pisaba el arqueo del cajero
-- sin avisar**: monto contado, medios, retiros. Y el desglose de
-- `cierres_caja_medios` quedaba apuntando a números que ya no existían.
-- El botón de eliminar era peor: borrar el cierre **desvincula todas las
-- ventas de ese turno** (ON DELETE SET NULL de la migración 144).
--
-- El punto del arqueo a ciegas es que la declaración del cajero valga como
-- control. Si administración la puede reescribir, deja de probar nada. Así que
-- administración controla —verifica, marca la caja fuerte, deja una nota— pero
-- no reescribe.
--
-- ⚠️ Solo protege los arqueos YA CERRADOS. Mientras el turno está abierto el
-- cajero tiene que poder cerrarlo, que es justamente cambiar esos campos.

begin;

create or replace function public.trg_cierres_caja_proteger_pos()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  -- Lo único que administración puede tocar de un arqueo cerrado por la caja.
  -- Todo lo demás queda congelado: si mañana se agrega una columna, nace
  -- protegida sin que haya que acordarse de nada.
  v_permitidas constant text[] := array[
    'verificado', 'verificado_por', 'verificado_at',
    'monto_llevado_caja_fuerte', 'nota_caja_fuerte', 'nota',
    -- ⚠️ `diferencia` es una columna CALCULADA. En un trigger BEFORE todavía no
    -- está computada, así que en NEW llega en NULL y compararla contra OLD daría
    -- SIEMPRE distinto: bloquearía hasta el "recibido en caja fuerte". No hace
    -- falta protegerla: sale de monto_contado y monto_esperado, que sí lo están.
    'diferencia'
  ];
  v_viejo jsonb;
  v_nuevo jsonb;
  v_campo text;
  v_ventas int;
begin
  if TG_OP = 'DELETE' then
    if OLD.origen <> 'pos' then
      return OLD;
    end if;
    select count(*) into v_ventas
      from public.ventas_tickets where cierre_caja_id = OLD.id;
    if v_ventas > 0 then
      raise exception
        'Este arqueo lo cerro el cajero desde la caja y tiene % venta(s) enganchadas. Borrarlo las dejaria sin turno. Si hay algo mal, deja una nota en vez de borrarlo.',
        v_ventas using errcode = 'check_violation';
    end if;
    -- un turno del POS que quedo vacio (se abrio por error) si se puede tirar
    return OLD;
  end if;

  -- UPDATE. Mientras el turno sigue abierto no se toca nada: el cajero tiene
  -- que poder cerrarlo.
  if OLD.origen <> 'pos' or OLD.hora_cierre is null then
    return NEW;
  end if;

  v_viejo := to_jsonb(OLD);
  v_nuevo := to_jsonb(NEW);

  for v_campo in select jsonb_object_keys(v_viejo) loop
    if v_campo = any(v_permitidas) then
      continue;
    end if;
    if v_viejo -> v_campo is distinct from v_nuevo -> v_campo then
      raise exception
        'Este arqueo lo cerro el cajero desde la caja: sus numeros no se reescriben (intentaste cambiar "%"). Administracion lo verifica, marca la caja fuerte y puede dejar una nota. Si hay una diferencia, ese es el dato.',
        v_campo using errcode = 'check_violation';
    end if;
  end loop;

  return NEW;
end
$fn$;

drop trigger if exists cierres_caja_proteger_pos on public.cierres_caja;
create trigger cierres_caja_proteger_pos
  before update or delete on public.cierres_caja
  for each row execute function public.trg_cierres_caja_proteger_pos();

commit;
