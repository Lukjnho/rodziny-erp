-- 140_medios_pago_hardening.sql
--
-- Cierra los agujeros de permisos que abrieron las migraciones 138 y 139.
--
-- EL PROBLEMA:
--   En Postgres, una vista creada por el dueño de la base corre con SUS permisos,
--   no con los del que la consulta. O sea: se saltea el control de acceso (RLS)
--   de las tablas de abajo. Y encima Supabase le da permiso de lectura al rol
--   `anon` por defecto — el mismo rol que usan las pantallas públicas de QR,
--   que se abren SIN usuario.
--
--   Resultado: cualquiera con la clave pública del ERP podía leer
--   v_egresos_caja (montos de todos los pagos, sueldos y dividendos).
--
-- LA SOLUCIÓN:
--   1) `security_invoker` = la vista pasa a correr con los permisos del que
--      consulta, así respeta el control de acceso de las tablas de abajo.
--   2) Sacarle el permiso a `anon` explícitamente.
--   3) Las funciones de los disparadores no tienen por qué ser llamables desde
--      afuera: se les quita el permiso a todo el mundo. Los disparadores siguen
--      funcionando igual (los ejecuta la base, no el usuario).
--   4) La función de resincronizar pasa a exigir que seas admin.

-- ── 1 y 2: las cuatro vistas nuevas ────────────────────────────────────
ALTER VIEW public.v_egresos_caja            SET (security_invoker = true);
ALTER VIEW public.v_medios_pago_sin_mapear  SET (security_invoker = true);
ALTER VIEW public.v_retiros_sin_clasificar  SET (security_invoker = true);
ALTER VIEW public.v_retiros_descuadrados    SET (security_invoker = true);

REVOKE ALL ON public.v_egresos_caja           FROM anon;
REVOKE ALL ON public.v_medios_pago_sin_mapear FROM anon;
REVOKE ALL ON public.v_retiros_sin_clasificar FROM anon;
REVOKE ALL ON public.v_retiros_descuadrados   FROM anon;

-- ── 3: las funciones de los disparadores no se llaman a mano ───────────
REVOKE ALL ON FUNCTION public.trg_medio_pago_completar()     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_medio_pago_completar_id()  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_cierres_caja_retiros()     FROM PUBLIC, anon, authenticated;

-- ── 4: resincronizar solo para admins ──────────────────────────────────
-- Modifica datos y corre con permisos elevados, así que no puede quedar
-- disponible para cualquier usuario logueado.
CREATE OR REPLACE FUNCTION public.resincronizar_medios_pago()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_tabla   text;
  v_sentido text;
  v_n       bigint;
  v_out     jsonb := '{}'::jsonb;
  v_sin_esp uuid;
BEGIN
  -- auth.uid() es NULL cuando corre desde el editor SQL o service_role: ahí se
  -- permite. Si hay un usuario logueado, tiene que ser admin.
  IF auth.uid() IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.perfiles p WHERE p.user_id = auth.uid() AND p.es_admin) THEN
    RAISE EXCEPTION 'Solo un administrador puede resincronizar los medios de pago';
  END IF;

  SELECT id INTO v_sin_esp FROM public.medios_pago WHERE codigo = 'sin_especificar';

  FOR v_tabla, v_sentido IN
    SELECT * FROM (VALUES
      ('gastos','egreso'), ('pagos_gastos','egreso'), ('pagos_fijos','egreso'),
      ('adelantos','egreso'), ('aguinaldos','egreso'), ('dividendos','egreso'),
      ('pagos_sueldos','egreso'), ('ventas_tickets','venta'), ('ventas_pagos','venta'),
      ('liquidaciones_quincenales','solo_id'), ('almacen_pedidos','solo_id')
    ) AS t(tabla, sentido)
  LOOP
    IF v_sentido = 'solo_id' THEN
      EXECUTE format($q$
        UPDATE public.%I t SET medio_pago_id = m.id
          FROM public.medios_pago_alias a JOIN public.medios_pago m ON m.codigo = a.medio_codigo
         WHERE a.alias = lower(btrim(coalesce(t.medio_pago,''))) AND m.id <> $1
           AND (t.medio_pago_id IS NULL OR t.medio_pago_id = $1)
      $q$, v_tabla) USING v_sin_esp;
    ELSIF v_sentido = 'venta' THEN
      EXECUTE format($q$
        UPDATE public.%I t SET medio_pago_id = m.id, cuenta = COALESCE(t.cuenta, m.cuenta_default_venta)
          FROM public.medios_pago_alias a JOIN public.medios_pago m ON m.codigo = a.medio_codigo
         WHERE a.alias = lower(btrim(coalesce(t.medio_pago,'')))
           AND ( (m.id <> $1 AND (t.medio_pago_id IS NULL OR t.medio_pago_id = $1))
              OR (t.cuenta IS NULL AND m.cuenta_default_venta IS NOT NULL) )
      $q$, v_tabla) USING v_sin_esp;
    ELSE
      EXECUTE format($q$
        UPDATE public.%I t SET medio_pago_id = m.id,
               cuenta = COALESCE(t.cuenta, a.cuenta, CASE WHEN m.es_efectivo THEN m.cuenta_default_egreso END)
          FROM public.medios_pago_alias a JOIN public.medios_pago m ON m.codigo = a.medio_codigo
         WHERE a.alias = lower(btrim(coalesce(t.medio_pago,'')))
           AND ( (m.id <> $1 AND (t.medio_pago_id IS NULL OR t.medio_pago_id = $1))
              OR (t.cuenta IS NULL AND COALESCE(a.cuenta, CASE WHEN m.es_efectivo THEN m.cuenta_default_egreso END) IS NOT NULL) )
      $q$, v_tabla) USING v_sin_esp;
    END IF;

    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN v_out := v_out || jsonb_build_object(v_tabla, v_n); END IF;
  END LOOP;

  RETURN v_out;
END
$fn$;

REVOKE ALL ON FUNCTION public.resincronizar_medios_pago() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resincronizar_medios_pago() TO authenticated;
