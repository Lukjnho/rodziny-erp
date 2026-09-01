-- 152 — El turno que el cajero tiene ABIERTO tampoco se pisa
--
-- La migración 148 protegió los arqueos que el cajero YA CERRÓ, pero se
-- desactivaba justo cuando `hora_cierre is null` — o sea, mientras el turno
-- está abierto. Y ese hueco es el peor de los dos:
--
--   El formulario de Finanzas → Cierre de Caja guarda con un `upsert` por
--   (local, fecha, turno, caja). Si administración carga un cierre para una
--   caja que el cajero tiene abierta en ese momento, el upsert NO inserta una
--   fila nueva: entra por la clave única y le reescribe la del cajero. Le pisa
--   el fondo con el que abrió, lo que lleva contado y los retiros. Y si además
--   completa "hora de cierre", le cierra el turno por debajo: el POS deja de
--   encontrarlo, el cajero ya no puede cerrarlo (la política pide
--   `hora_cierre is null`) y tampoco puede volver a abrirlo, porque choca con
--   la misma clave única. Queda encerrado, con las ventas ya cobradas colgadas
--   de un arqueo que dice otra cosa.
--
--   Y no hay forma de que administración lo vea venir: la lista del mes
--   esconde a propósito los turnos abiertos del POS (se siguen en vivo desde el
--   módulo Caja), así que la fila que está por pisar es invisible.
--
-- Acá van las dos patas de la protección en la base. La tercera —avisarle a
-- administración ANTES de guardar, en criollo— va en el formulario.

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
  -- ¿Quien escribe es la caja? Se calcula solo cuando hace falta (o sea, sobre
  -- un turno del POS abierto): `tiene_permiso` es una consulta más, y esto
  -- corre fila por fila en las importaciones masivas de cierres.
  -- Sin sesión de usuario es la service_role: las edge functions y los procesos
  -- de fondo pasan derecho, si no no se podría importar ni corregir nada.
  v_es_la_caja boolean;
begin
  if TG_OP = 'DELETE' then
    if OLD.origen <> 'pos' then
      return OLD;
    end if;

    -- Un turno abierto es de quien lo está usando. Borrarlo desde
    -- administración le saca la caja de abajo de los pies al cajero.
    if OLD.hora_cierre is null then
      v_es_la_caja := auth.uid() is null or tiene_permiso('caja');
      if not v_es_la_caja then
        raise exception
          'Esa caja tiene un turno abierto en el punto de venta: no se puede borrar desde aca. Espera a que el cajero lo cierre.'
          using errcode = 'check_violation';
      end if;
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

  -- ── UPDATE sobre un turno del POS TODAVÍA ABIERTO ──────────────────────────
  if OLD.origen = 'pos' and OLD.hora_cierre is null then
    -- El fondo con el que se abrió es el punto de partida del arqueo: si se
    -- reescribe, el cajero cierra midiéndose contra plata que nunca recibió.
    -- No lo cambia nadie, ni la propia caja.
    if NEW.fondo_apertura is distinct from OLD.fondo_apertura then
      raise exception
        'El turno se abrio con un fondo de $% y ese numero no se reescribe: es contra el que se mide el arqueo. Si el fondo estaba mal, que el cajero cierre y se corrija despues.',
        coalesce(OLD.fondo_apertura, 0) using errcode = 'check_violation';
    end if;

    -- Un arqueo no cambia de dueño a mitad de camino.
    if NEW.origen is distinct from OLD.origen then
      raise exception
        'Un turno abierto en el punto de venta no se puede convertir en un cierre manual.'
        using errcode = 'check_violation';
    end if;

    -- Y el resto solo lo toca la caja: cerrar el turno es justamente cambiar
    -- estos campos, y el que tiene que hacerlo es el cajero.
    v_es_la_caja := auth.uid() is null or tiene_permiso('caja');
    if not v_es_la_caja then
      raise exception
        'Esa caja tiene un turno abierto en el punto de venta. Espera a que el cajero lo cierre: recien ahi aparece en esta pantalla para controlarlo.'
        using errcode = 'check_violation';
    end if;

    return NEW;
  end if;

  -- Cualquier otro turno abierto (los manuales) sigue como estaba.
  if OLD.origen <> 'pos' then
    return NEW;
  end if;

  -- ── UPDATE sobre un arqueo del POS YA CERRADO (migración 148) ──────────────
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

-- El disparador ya existe desde la 148 sobre update y delete; se deja igual.

commit;
