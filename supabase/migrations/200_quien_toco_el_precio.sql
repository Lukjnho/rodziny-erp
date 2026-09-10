-- ─────────────────────────────────────────────────────────────────────────────
-- 200_quien_toco_el_precio_de_la_carta.sql
--
-- EL PORQUÉ
-- cocina_recetas_precios_canal es la tabla que factura: desde la mig 192 el POS
-- cobra ESE precio y rechaza el cobro si la pantalla dice otra cosa. Pero no
-- guarda ni quién lo cambió ni cuánto valía antes. Solo tiene updated_at, que
-- pisa el toque anterior.
-- Consecuencia real: un aumento cargado el 17-ago entró en Vedia el 21-ago y en
-- Saavedra recién del 5 al 8 de septiembre. Tres semanas cobrando de menos, y
-- hoy ni siquiera se puede reconstruir qué pasó, porque updated_at solo guarda
-- la última fecha (medido: quedan 23 días con rastro y el 21-ago ya no figura).
-- Son 9 los perfiles que pueden tocar precios (los 7 con puede_ver_productos
-- más los 2 admin), y uno de ellos es la cuenta compartida "Rodziny Sin gluten".
--
-- QUÉ ES ESTO
-- El espejo de la mig 059 (cocina_productos_precio_historial), apuntado a la
-- tabla que de verdad cobra. La 059 quedó anotando cocina_productos, que está
-- congelada desde el 28-may: su última fila es de ese día.
--
-- DIFERENCIAS A PROPÓSITO CON LA 059 (cuatro, todas con motivo):
--   1. El disparador NO puede frenar una carga de precios. En la 059 el INSERT
--      al historial está sin red: si falla, el precio no se guarda. Acá todo el
--      cuerpo va adentro de un bloque con EXCEPTION que solo tira WARNING.
--   2. Cubre INSERT y DELETE además de UPDATE. El front escribe con upsert
--      (MenuTab.tsx:325), así que el alta de un plato nuevo es un INSERT.
--   3. receta_id va SIN foreign key, y se guarda copia del nombre y del local.
--      Con FK, borrar una receta borraría su historial en cascada (o peor: la
--      cascada dispararía un INSERT contra un padre ya borrado y frenaría el
--      borrado). Un libro de auditoría tiene que sobrevivir al borrado.
--   4. auth.uid() envuelto en (select ...) en la policy, para que la RLS se
--      evalúe una vez y no fila por fila.
--
-- NO HAY BACKFILL POSIBLE: no existe ninguna columna en la base que guarde un
-- precio anterior. La libreta arranca vacía y anota de acá en adelante.
-- ─────────────────────────────────────────────────────────────────────────────

-- Va entera adentro de una transacción, igual que la 199: si el guardarraíl del
-- final encuentra algo mal, no queda media migración aplicada. Nada de lo que
-- crea acá necesita correr fuera de transacción.
begin;

-- ─── La libreta ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cocina_recetas_precios_historial (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receta_id       uuid NOT NULL,          -- sin FK a propósito, ver encabezado
  receta_nombre   text,                   -- copia al momento del cambio
  local           text,                   -- copia al momento del cambio
  canal           text NOT NULL,          -- plato | vianda | congelado
  accion          text NOT NULL DEFAULT 'cambio'
                    CHECK (accion IN ('alta', 'cambio', 'baja')),
  precio_anterior numeric,                -- NULL en un alta
  precio_nuevo    numeric,                -- NULL en una baja
  variacion_pct   numeric,                -- solo cuando hay antes Y después
  fecha           timestamptz NOT NULL DEFAULT now(),
  usuario         text,                   -- perfiles.nombre del que lo hizo
  usuario_id      uuid,                   -- auth.uid(), por si se renombra
  origen          text,                   -- de dónde vino el cambio, ver abajo
  motivo          text                    -- lo llena la pantalla, si algún día
);

COMMENT ON TABLE public.cocina_recetas_precios_historial IS
  'Quién tocó el precio de la carta, cuándo, y cuánto valía antes. Lo llena solo el disparador trg_log_precios_recetas_canal sobre cocina_recetas_precios_canal, que es la tabla que factura desde la mig 192. Es un libro: se lee, no se escribe ni se corrige.';

COMMENT ON COLUMN public.cocina_recetas_precios_historial.receta_id IS
  'Sin foreign key a propósito: si mañana se borra la receta, el historial tiene que quedar. Por eso también se copian receta_nombre y local.';

COMMENT ON COLUMN public.cocina_recetas_precios_historial.origen IS
  'De dónde vino el cambio: ''authenticated'' (una persona en el ERP), ''service_role'' (un script o una edge function) o ''sql_directo'' (alguien con la consola de Supabase abierta). Sin esta columna las tres firman igual —en blanco— y un aumento sin firma no se puede distinguir de un historial roto. Hoy ningún cron toca precios, así que el blanco sería justo el caso que más importa auditar.';

COMMENT ON COLUMN public.cocina_recetas_precios_historial.motivo IS
  'Nace vacío. En la libreta gemela (mig 059) quedaron 0 de 59 filas con motivo porque ninguna pantalla lo pide. Si no se agrega el campo en la UI, esta columna no se llena sola.';

CREATE INDEX IF NOT EXISTS idx_recetas_precio_hist_receta
  ON public.cocina_recetas_precios_historial (receta_id, canal, fecha DESC);

CREATE INDEX IF NOT EXISTS idx_recetas_precio_hist_fecha
  ON public.cocina_recetas_precios_historial (fecha DESC);

-- ─── El que anota ────────────────────────────────────────────────────────────
-- REGLA DE LA CASA: esto NO puede frenar una carga de precios legítima.
-- Todo el cuerpo va adentro de un bloque con EXCEPTION WHEN OTHERS. Si el
-- historial se rompe (tabla llena, permiso raro, lo que sea), tira un WARNING
-- al log de Postgres y el precio se guarda igual. Nunca al revés.
CREATE OR REPLACE FUNCTION public.cocina_recetas_precios_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_accion  text;
  v_receta  uuid;
  v_canal   text;
  v_ant     numeric;
  v_nue     numeric;
  v_var     numeric;
  v_nombre  text;
  v_local   text;
  v_uid     uuid;
  v_usuario text;
  v_origen  text;
BEGIN
  BEGIN
    IF TG_OP = 'INSERT' THEN
      v_accion := 'alta';
      v_receta := NEW.receta_id;
      v_canal  := NEW.canal;
      v_ant    := NULL;
      v_nue    := NEW.precio;

    ELSIF TG_OP = 'DELETE' THEN
      -- Si la receta padre ya no existe, este DELETE es la cascada de borrarla
      -- y el disparador del padre YA anotó la baja con nombre y local. Anotar
      -- acá otra vez dejaría una fila fantasma, sin nombre, imposible de leer.
      IF NOT EXISTS (SELECT 1 FROM public.cocina_recetas r WHERE r.id = OLD.receta_id) THEN
        RETURN OLD;
      END IF;
      v_accion := 'baja';
      v_receta := OLD.receta_id;
      v_canal  := OLD.canal;
      v_ant    := OLD.precio;
      v_nue    := NULL;

    ELSE
      -- El upsert del front reescribe la fila aunque el precio sea el mismo, y
      -- el trigger de updated_at la toca siempre. Si no cambió nada que importe,
      -- no anotamos: la libreta se llenaría de ruido.
      IF NEW.precio    IS NOT DISTINCT FROM OLD.precio
     AND NEW.canal     IS NOT DISTINCT FROM OLD.canal
     AND NEW.receta_id IS NOT DISTINCT FROM OLD.receta_id THEN
        RETURN NEW;
      END IF;
      v_accion := 'cambio';
      v_receta := NEW.receta_id;
      v_canal  := NEW.canal;
      v_ant    := OLD.precio;
      v_nue    := NEW.precio;
    END IF;

    IF v_ant IS NOT NULL AND v_ant > 0 AND v_nue IS NOT NULL THEN
      v_var := (v_nue - v_ant) / v_ant;
    END IF;

    v_uid := auth.uid();
    -- auth.role() distingue lo que auth.uid() no: con la llave de servicio dice
    -- 'service_role', desde la consola SQL da nulo. Sin esto, un script y una
    -- persona con la consola abierta dejan la misma celda vacía.
    v_origen := coalesce(auth.role(), 'sql_directo');

    SELECT p.nombre
      INTO v_usuario
      FROM public.perfiles p
     WHERE p.user_id = v_uid;

    SELECT r.nombre, r.local
      INTO v_nombre, v_local
      FROM public.cocina_recetas r
     WHERE r.id = v_receta;

    INSERT INTO public.cocina_recetas_precios_historial (
      receta_id, receta_nombre, local, canal, accion,
      precio_anterior, precio_nuevo, variacion_pct, usuario, usuario_id, origen
    ) VALUES (
      v_receta, v_nombre, v_local, v_canal, v_accion,
      v_ant, v_nue, v_var, v_usuario, v_uid, v_origen
    );

  EXCEPTION WHEN OTHERS THEN
    -- Se anota en el log de Postgres y la vida sigue. El precio manda.
    RAISE WARNING 'historial de precios: no pude anotar el cambio (receta=%, canal=%, op=%): %',
      v_receta, v_canal, TG_OP, SQLERRM;
  END;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.cocina_recetas_precios_log() IS
  'Anota en cocina_recetas_precios_historial. Todo el cuerpo está envuelto en EXCEPTION WHEN OTHERS: si el historial falla, el precio se guarda igual. No tocar esa red.';

DROP TRIGGER IF EXISTS trg_log_precios_recetas_canal
  ON public.cocina_recetas_precios_canal;

CREATE TRIGGER trg_log_precios_recetas_canal
  AFTER INSERT OR UPDATE OR DELETE ON public.cocina_recetas_precios_canal
  FOR EACH ROW EXECUTE FUNCTION public.cocina_recetas_precios_log();

-- ─── Cuando se borra la receta entera ────────────────────────────────────────
-- cocina_recetas_precios_canal.receta_id tiene ON DELETE CASCADE (verificado el
-- 10-sep-2026). Al borrar una receta, Postgres borra los precios PRIMERO, así
-- que para cuando el disparador del hijo quiere buscar el nombre, la receta ya
-- no está y anotaría una baja anónima. Acá todavía existe: OLD.nombre y
-- OLD.local están a mano.
CREATE OR REPLACE FUNCTION public.cocina_recetas_baja_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
BEGIN
  BEGIN
    v_uid := auth.uid();
    INSERT INTO public.cocina_recetas_precios_historial (
      receta_id, receta_nombre, local, canal, accion,
      precio_anterior, precio_nuevo, usuario, usuario_id, origen, motivo
    )
    SELECT OLD.id, OLD.nombre, OLD.local, pc.canal, 'baja',
           pc.precio, NULL,
           (SELECT p.nombre FROM public.perfiles p WHERE p.user_id = v_uid),
           v_uid, coalesce(auth.role(), 'sql_directo'),
           'se borró la receta entera'
      FROM public.cocina_recetas_precios_canal pc
     WHERE pc.receta_id = OLD.id;
  EXCEPTION WHEN OTHERS THEN
    -- Misma red que el otro: el historial nunca frena un borrado.
    RAISE WARNING 'historial de precios: no pude anotar la baja de la receta %: %', OLD.id, SQLERRM;
  END;
  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION public.cocina_recetas_baja_log() IS
  'Anota la baja de todos los precios cuando se borra una receta. Va en el PADRE porque el ON DELETE CASCADE borra los hijos primero y ahí ya no queda de dónde sacar el nombre.';

DROP TRIGGER IF EXISTS trg_log_baja_receta ON public.cocina_recetas;

CREATE TRIGGER trg_log_baja_receta
  BEFORE DELETE ON public.cocina_recetas
  FOR EACH ROW EXECUTE FUNCTION public.cocina_recetas_baja_log();

-- ─── Quién lo puede leer ─────────────────────────────────────────────────────
-- Mismo criterio que la libreta gemela de la 059: admin, productos o cocina.
-- Medido: son 9 de los 11 perfiles. La caja y el salón NO entran (leen precios,
-- no auditoría). Nada de atar esto al nombre de nadie: son casillas del perfil.
ALTER TABLE public.cocina_recetas_precios_historial ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sel_recetas_precio_historial
  ON public.cocina_recetas_precios_historial;

CREATE POLICY sel_recetas_precio_historial
  ON public.cocina_recetas_precios_historial FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.perfiles p
       WHERE p.user_id = (SELECT auth.uid())
         AND (p.es_admin OR p.puede_ver_productos OR p.puede_ver_cocina)
    )
  );

-- No hay policy de INSERT/UPDATE/DELETE: el libro es de solo lectura para todo
-- el mundo. El disparador escribe porque es SECURITY DEFINER y se saltea la RLS.
-- Además le sacamos el permiso de tabla, porque Supabase se lo da por default a
-- anon y authenticated en TODA tabla nueva de public (medido en pg_class.relacl).
REVOKE ALL ON public.cocina_recetas_precios_historial FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON public.cocina_recetas_precios_historial FROM authenticated;

-- ─── Contar lo que quedó, en vez de confiar ──────────────────────────────────
-- En esta base lo que falla no grita. Si algo de esto no quedó puesto, que se
-- caiga la migración acá y no dentro de tres semanas.
DO $verificar$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'cocina_recetas_precios_canal'
       AND t.tgname  = 'trg_log_precios_recetas_canal'
       AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'El disparador del historial de precios NO quedó instalado.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'cocina_recetas_precios_historial'
       AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'La tabla del historial quedó SIN RLS prendida. Eso la deja abierta.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'cocina_recetas_precios_historial'
       AND policyname = 'sel_recetas_precio_historial'
  ) THEN
    RAISE EXCEPTION 'Falta la policy de lectura del historial: nadie lo podría ver.';
  END IF;

  RAISE NOTICE 'Historial de precios de la carta: tabla, disparador y RLS OK.';
END
$verificar$;

commit;
