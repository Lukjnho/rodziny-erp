-- 138_medios_pago_cuenta_efectivo_y_triggers.sql
--
-- CIERRE DE LA FASE B — consistencia del efectivo y auto-mantenimiento.
--
-- QUÉ RESUELVE (en criollo):
--
--   1) ASIMETRÍA DEL EFECTIVO. La 137 marcó el efectivo de las VENTAS como
--      cuenta 'caja', pero el efectivo de los EGRESOS quedó sin cuenta. Por eso
--      "Caja" mostraba $346M de entradas y $0 de salidas, que es falso.
--
--   2) EL DATO SE DEGRADABA SOLO. Ninguna pantalla escribe medio_pago_id ni
--      cuenta. Peor: SueldosTab.tsx:400-427 borra y reinserta los pagos de
--      sueldos escribiendo `cuenta: null`, así que cada re-guardado perdía la
--      clasificación. Se resuelve con DISPARADORES (triggers) en la base: en vez
--      de tocar las ~15 pantallas que graban el medio de pago, la base completa
--      sola la clasificación cada vez que se graba una fila — venga de donde
--      venga (pantalla, importación de Fudo o corrección a mano).
--
--   3) EL MERCADO PAGO PERSONAL DE LUCAS estaba mezclado con el de la empresa:
--      276 dividendos ($13.679.900) y 536 cobros ($13.327.300) marcados como
--      cuenta 'mercadopago' cuando esa plata nunca pasó por la cuenta de la SAS.
--      Pasa a ser una cuenta propia: 'mp_lucas'.
--
-- QUÉ *NO* HACE:
--   - No toca el texto viejo `medio_pago`. Las ~20 pantallas y las 3 funciones
--     de conciliación siguen leyendo exactamente lo mismo que hoy.
--   - No toca la lógica de liquidez de FlujoCaja (caja chica / caja fuerte).
--   - No toca conciliar_adelantos / conciliar_dividendos / conciliar_sueldos_
--     consolidados: deducen el banco del TEXTO y funcionan. Se migran en Fase D.
--
-- ⚠️ ADVERTENCIA DE MODELO (ver v_egresos_caja al final):
--   `cuenta` responde CON QUÉ se pagó, NO de qué saldo salió. cuenta='caja'
--   significa "el medio fue efectivo". NO es una cuenta contable con saldo.
--   El saldo de efectivo se calcula SOLO desde cierres_caja, como hoy.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. UNA SOLA VERDAD PARA EL EFECTIVO
-- ═══════════════════════════════════════════════════════════════════════
-- Antes el catálogo decía "el efectivo no tiene cuenta" y ventas decía 'caja'.

UPDATE public.medios_pago       SET cuenta_default_egreso = 'caja' WHERE codigo = 'efectivo';
UPDATE public.medios_pago_alias SET cuenta = 'caja'                WHERE alias  = 'efectivo';

-- ═══════════════════════════════════════════════════════════════════════
-- 2. CUENTA PROPIA PARA EL MERCADO PAGO DE LUCAS
-- ═══════════════════════════════════════════════════════════════════════

UPDATE public.medios_pago
   SET cuenta_default_egreso = 'mp_lucas',
       cuenta_default_venta  = 'mp_lucas'
 WHERE codigo = 'mp_lucas';

UPDATE public.medios_pago_alias
   SET cuenta = 'mp_lucas'
 WHERE medio_codigo = 'mp_lucas';

-- Recorrer lo ya clasificado (estaba como 'mercadopago')
UPDATE public.dividendos     t SET cuenta = 'mp_lucas'
  FROM public.medios_pago m WHERE m.id = t.medio_pago_id AND m.codigo = 'mp_lucas';
UPDATE public.ventas_pagos   t SET cuenta = 'mp_lucas'
  FROM public.medios_pago m WHERE m.id = t.medio_pago_id AND m.codigo = 'mp_lucas';
UPDATE public.ventas_tickets t SET cuenta = 'mp_lucas'
  FROM public.medios_pago m WHERE m.id = t.medio_pago_id AND m.codigo = 'mp_lucas';

-- ═══════════════════════════════════════════════════════════════════════
-- 3. FORMAS DE ESCRIBIR QUE HOY QUEDARÍAN SIN CLASIFICAR
-- ═══════════════════════════════════════════════════════════════════════
-- El diccionario compara EXACTO. Hay código vivo que escribe textos que no
-- están mapeados. Hoy no hay ninguna fila con estos valores: se agregan como
-- defensa para que nunca caiga nada en "Sin especificar" por una diferencia
-- de espacio o guion bajo.

INSERT INTO public.medios_pago_alias (alias, medio_codigo, cuenta, nota) VALUES
  ('transferencia mercadopago','transferencia',  'mercadopago','PanelAdelantos.tsx:88 arma `transferencia ${medio}` CON ESPACIO'),
  ('transferencia galicia',    'transferencia',  'galicia',    'idem PanelAdelantos.tsx:88'),
  ('transferencia icbc',       'transferencia',  'icbc',       'idem PanelAdelantos.tsx:88'),
  ('mercado pago (point)',     'sin_especificar', NULL,        'PedidosTab.tsx:50 lo escribe CON ESPACIO; Fudo lo escribe sin espacio'),
  ('debito_mp',                'debito',         'mercadopago','defensivo: valor muerto del tipo en AguinaldoTab.tsx'),
  ('debito_galicia',           'debito',         'galicia',    'defensivo'),
  ('debito_icbc',              'debito',         'icbc',       'defensivo')
ON CONFLICT (alias) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. LOS DISPARADORES (que el dato se mantenga solo)
-- ═══════════════════════════════════════════════════════════════════════
--
-- Reglas, en orden de prioridad:
--   a) Si viene el medio elegido de la lista (medio_pago_id explícito) → gana ese.
--   b) Si viene solo el texto → se busca en el diccionario (misma regla que la 136).
--   c) Si la cuenta viene cargada a mano → SE RESPETA SIEMPRE. Crítico:
--      SueldosTab.tsx:432 manda el banco explícito y hay 23 filas así.
--   d) Si la cuenta viene vacía → la completa el disparador. Esto tapa el bug
--      de SueldosTab.tsx:424 (`cuenta: null`) sin tocar el archivo.
--   e) Si cambió el texto y nadie tocó la cuenta → se recalcula (si el medio
--      pasó de transferencia a efectivo, el banco viejo ya no aplica).
--   f) Si el texto no está en el diccionario → "Sin especificar" y aparece en
--      la vista de control v_medios_pago_sin_mapear.
--   g) NUNCA se inventa un banco: una "Transferencia" sin aclarar queda sin cuenta.

-- Para las 9 tablas que tienen columna `cuenta`.
CREATE OR REPLACE FUNCTION public.trg_medio_pago_completar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_es_venta    boolean := COALESCE(TG_ARGV[0], 'egreso') = 'venta';
  v_alias       text;
  v_medio_id    uuid;
  v_cuenta      text;
  v_txt_cambio  boolean;
  v_id_expl     boolean;
  v_cta_intacta boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_txt_cambio  := NEW.medio_pago    IS DISTINCT FROM OLD.medio_pago;
    v_id_expl     := NEW.medio_pago_id IS DISTINCT FROM OLD.medio_pago_id
                     AND NEW.medio_pago_id IS NOT NULL;
    v_cta_intacta := NEW.cuenta        IS NOT DISTINCT FROM OLD.cuenta;
    -- Atajo: si no cambió nada relevante y ya está completo, no miramos el catálogo.
    IF NOT v_txt_cambio AND NOT v_id_expl
       AND NEW.medio_pago_id IS NOT NULL AND NEW.cuenta IS NOT NULL THEN
      RETURN NEW;
    END IF;
  ELSE
    v_txt_cambio  := TRUE;
    v_id_expl     := NEW.medio_pago_id IS NOT NULL;
    v_cta_intacta := TRUE;
  END IF;

  IF v_id_expl THEN
    -- (a) Eligió de la lista. La cuenta sale del catálogo, y SOLO cuando es
    --     inequívoca: efectivo → caja, mp_lucas → mp_lucas. Para transferencia
    --     o tarjeta el banco depende del caso, así que no se adivina.
    SELECT CASE
             WHEN v_es_venta THEN m.cuenta_default_venta
             WHEN m.codigo IN ('efectivo','mp_lucas') THEN m.cuenta_default_egreso
             ELSE NULL
           END
      INTO v_cuenta
      FROM public.medios_pago m
     WHERE m.id = NEW.medio_pago_id;
  ELSE
    -- (b) Manda el texto. Reproduce exactamente la 136 (egresos) y la 137 (ventas).
    v_alias := lower(btrim(coalesce(NEW.medio_pago, '')));
    SELECT m.id,
           CASE WHEN v_es_venta THEN m.cuenta_default_venta
                ELSE COALESCE(a.cuenta,
                              CASE WHEN m.es_efectivo THEN m.cuenta_default_egreso END)
           END
      INTO v_medio_id, v_cuenta
      FROM public.medios_pago_alias a
      JOIN public.medios_pago m ON m.codigo = a.medio_codigo
     WHERE a.alias = v_alias;

    IF v_medio_id IS NULL THEN
      -- (f) Texto desconocido: se clasifica igual para que los totales cierren,
      --     y queda visible en v_medios_pago_sin_mapear.
      SELECT id INTO v_medio_id FROM public.medios_pago WHERE codigo = 'sin_especificar';
      v_cuenta := NULL;
    END IF;
    NEW.medio_pago_id := v_medio_id;
  END IF;

  IF NEW.cuenta IS NULL THEN
    NEW.cuenta := v_cuenta;                    -- (d)
  ELSIF TG_OP = 'UPDATE' AND v_txt_cambio AND v_cta_intacta THEN
    NEW.cuenta := v_cuenta;                    -- (e)
  END IF;                                      -- si no: (c) gana lo explícito

  RETURN NEW;
END
$fn$;

COMMENT ON FUNCTION public.trg_medio_pago_completar() IS
  'Completa medio_pago_id y cuenta desde el texto de medio_pago usando medios_pago_alias. TG_ARGV[0] = egreso|venta. Respeta siempre lo cargado explícitamente. Ver migración 138.';

-- Para las 2 tablas SIN columna `cuenta` (liquidaciones_quincenales, almacen_pedidos).
-- Hace falta una función aparte: PL/pgSQL compila el cuerpo entero contra cada
-- tabla, así que una rama que nombre NEW.cuenta falla aunque nunca se ejecute.
CREATE OR REPLACE FUNCTION public.trg_medio_pago_completar_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_alias    text;
  v_medio_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.medio_pago_id IS DISTINCT FROM OLD.medio_pago_id AND NEW.medio_pago_id IS NOT NULL THEN
      RETURN NEW;                                        -- explícito gana
    END IF;
    IF NEW.medio_pago IS NOT DISTINCT FROM OLD.medio_pago AND NEW.medio_pago_id IS NOT NULL THEN
      RETURN NEW;                                        -- nada relevante cambió
    END IF;
  ELSIF NEW.medio_pago_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_alias := lower(btrim(coalesce(NEW.medio_pago, '')));
  SELECT m.id INTO v_medio_id
    FROM public.medios_pago_alias a
    JOIN public.medios_pago m ON m.codigo = a.medio_codigo
   WHERE a.alias = v_alias;
  IF v_medio_id IS NULL THEN
    SELECT id INTO v_medio_id FROM public.medios_pago WHERE codigo = 'sin_especificar';
  END IF;
  NEW.medio_pago_id := v_medio_id;
  RETURN NEW;
END
$fn$;

-- ── Declaración de los 11 disparadores ─────────────────────────────────
-- `UPDATE OF medio_pago, medio_pago_id, cuenta` hace que ni se activen cuando
-- se graba otra cosa (ej: al conciliar un pago se toca conciliado_movimiento_id
-- y nada más). Así no cuestan nada en los caminos calientes.

DROP TRIGGER IF EXISTS trg_medio_pago ON public.gastos;
CREATE TRIGGER trg_medio_pago BEFORE INSERT OR UPDATE OF medio_pago, medio_pago_id, cuenta
  ON public.gastos FOR EACH ROW EXECUTE FUNCTION public.trg_medio_pago_completar('egreso');

DROP TRIGGER IF EXISTS trg_medio_pago ON public.pagos_gastos;
CREATE TRIGGER trg_medio_pago BEFORE INSERT OR UPDATE OF medio_pago, medio_pago_id, cuenta
  ON public.pagos_gastos FOR EACH ROW EXECUTE FUNCTION public.trg_medio_pago_completar('egreso');

DROP TRIGGER IF EXISTS trg_medio_pago ON public.pagos_fijos;
CREATE TRIGGER trg_medio_pago BEFORE INSERT OR UPDATE OF medio_pago, medio_pago_id, cuenta
  ON public.pagos_fijos FOR EACH ROW EXECUTE FUNCTION public.trg_medio_pago_completar('egreso');

DROP TRIGGER IF EXISTS trg_medio_pago ON public.adelantos;
CREATE TRIGGER trg_medio_pago BEFORE INSERT OR UPDATE OF medio_pago, medio_pago_id, cuenta
  ON public.adelantos FOR EACH ROW EXECUTE FUNCTION public.trg_medio_pago_completar('egreso');

DROP TRIGGER IF EXISTS trg_medio_pago ON public.aguinaldos;
CREATE TRIGGER trg_medio_pago BEFORE INSERT OR UPDATE OF medio_pago, medio_pago_id, cuenta
  ON public.aguinaldos FOR EACH ROW EXECUTE FUNCTION public.trg_medio_pago_completar('egreso');

DROP TRIGGER IF EXISTS trg_medio_pago ON public.dividendos;
CREATE TRIGGER trg_medio_pago BEFORE INSERT OR UPDATE OF medio_pago, medio_pago_id, cuenta
  ON public.dividendos FOR EACH ROW EXECUTE FUNCTION public.trg_medio_pago_completar('egreso');

DROP TRIGGER IF EXISTS trg_medio_pago ON public.pagos_sueldos;
CREATE TRIGGER trg_medio_pago BEFORE INSERT OR UPDATE OF medio_pago, medio_pago_id, cuenta
  ON public.pagos_sueldos FOR EACH ROW EXECUTE FUNCTION public.trg_medio_pago_completar('egreso');

DROP TRIGGER IF EXISTS trg_medio_pago ON public.ventas_tickets;
CREATE TRIGGER trg_medio_pago BEFORE INSERT OR UPDATE OF medio_pago, medio_pago_id, cuenta
  ON public.ventas_tickets FOR EACH ROW EXECUTE FUNCTION public.trg_medio_pago_completar('venta');

DROP TRIGGER IF EXISTS trg_medio_pago ON public.ventas_pagos;
CREATE TRIGGER trg_medio_pago BEFORE INSERT OR UPDATE OF medio_pago, medio_pago_id, cuenta
  ON public.ventas_pagos FOR EACH ROW EXECUTE FUNCTION public.trg_medio_pago_completar('venta');

DROP TRIGGER IF EXISTS trg_medio_pago ON public.liquidaciones_quincenales;
CREATE TRIGGER trg_medio_pago BEFORE INSERT OR UPDATE OF medio_pago, medio_pago_id
  ON public.liquidaciones_quincenales FOR EACH ROW EXECUTE FUNCTION public.trg_medio_pago_completar_id();

DROP TRIGGER IF EXISTS trg_medio_pago ON public.almacen_pedidos;
CREATE TRIGGER trg_medio_pago BEFORE INSERT OR UPDATE OF medio_pago, medio_pago_id
  ON public.almacen_pedidos FOR EACH ROW EXECUTE FUNCTION public.trg_medio_pago_completar_id();

-- ═══════════════════════════════════════════════════════════════════════
-- 5. MARCAR EL EFECTIVO DE LOS EGRESOS (la asimetría que motivó todo esto)
-- ═══════════════════════════════════════════════════════════════════════
-- 1.107 filas medidas, cero conflictos (ninguna tiene cuenta cargada).

UPDATE public.gastos        t SET cuenta = 'caja' FROM public.medios_pago m
  WHERE m.id = t.medio_pago_id AND m.es_efectivo AND t.cuenta IS NULL;
UPDATE public.pagos_gastos  t SET cuenta = 'caja' FROM public.medios_pago m
  WHERE m.id = t.medio_pago_id AND m.es_efectivo AND t.cuenta IS NULL;
UPDATE public.pagos_fijos   t SET cuenta = 'caja' FROM public.medios_pago m
  WHERE m.id = t.medio_pago_id AND m.es_efectivo AND t.cuenta IS NULL;
UPDATE public.adelantos     t SET cuenta = 'caja' FROM public.medios_pago m
  WHERE m.id = t.medio_pago_id AND m.es_efectivo AND t.cuenta IS NULL;
UPDATE public.aguinaldos    t SET cuenta = 'caja' FROM public.medios_pago m
  WHERE m.id = t.medio_pago_id AND m.es_efectivo AND t.cuenta IS NULL;
UPDATE public.dividendos    t SET cuenta = 'caja' FROM public.medios_pago m
  WHERE m.id = t.medio_pago_id AND m.es_efectivo AND t.cuenta IS NULL;
UPDATE public.pagos_sueldos t SET cuenta = 'caja' FROM public.medios_pago m
  WHERE m.id = t.medio_pago_id AND m.es_efectivo AND t.cuenta IS NULL;

-- ═══════════════════════════════════════════════════════════════════════
-- 6. BOTÓN DE RESINCRONIZAR
-- ═══════════════════════════════════════════════════════════════════════
-- Para cuando se agrega un texto nuevo al diccionario: repara el histórico.
-- Conservadora: solo toca filas sin clasificar o marcadas "Sin especificar",
-- y solo rellena cuentas VACÍAS — nunca pisa un banco cargado a mano.

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
  SELECT id INTO v_sin_esp FROM public.medios_pago WHERE codigo = 'sin_especificar';

  FOR v_tabla, v_sentido IN
    SELECT * FROM (VALUES
      ('gastos','egreso'), ('pagos_gastos','egreso'), ('pagos_fijos','egreso'),
      ('adelantos','egreso'), ('aguinaldos','egreso'), ('dividendos','egreso'),
      ('pagos_sueldos','egreso'),
      ('ventas_tickets','venta'), ('ventas_pagos','venta'),
      ('liquidaciones_quincenales','solo_id'), ('almacen_pedidos','solo_id')
    ) AS t(tabla, sentido)
  LOOP
    IF v_sentido = 'solo_id' THEN
      EXECUTE format($q$
        UPDATE public.%I t SET medio_pago_id = m.id
          FROM public.medios_pago_alias a JOIN public.medios_pago m ON m.codigo = a.medio_codigo
         WHERE a.alias = lower(btrim(coalesce(t.medio_pago,'')))
           AND m.id <> $1
           AND (t.medio_pago_id IS NULL OR t.medio_pago_id = $1)
      $q$, v_tabla) USING v_sin_esp;

    ELSIF v_sentido = 'venta' THEN
      EXECUTE format($q$
        UPDATE public.%I t
           SET medio_pago_id = m.id,
               cuenta = COALESCE(t.cuenta, m.cuenta_default_venta)
          FROM public.medios_pago_alias a JOIN public.medios_pago m ON m.codigo = a.medio_codigo
         WHERE a.alias = lower(btrim(coalesce(t.medio_pago,'')))
           AND ( (m.id <> $1 AND (t.medio_pago_id IS NULL OR t.medio_pago_id = $1))
              OR (t.cuenta IS NULL AND m.cuenta_default_venta IS NOT NULL) )
      $q$, v_tabla) USING v_sin_esp;

    ELSE
      EXECUTE format($q$
        UPDATE public.%I t
           SET medio_pago_id = m.id,
               cuenta = COALESCE(t.cuenta, a.cuenta,
                                 CASE WHEN m.es_efectivo THEN m.cuenta_default_egreso END)
          FROM public.medios_pago_alias a JOIN public.medios_pago m ON m.codigo = a.medio_codigo
         WHERE a.alias = lower(btrim(coalesce(t.medio_pago,'')))
           AND ( (m.id <> $1 AND (t.medio_pago_id IS NULL OR t.medio_pago_id = $1))
              OR (t.cuenta IS NULL AND COALESCE(a.cuenta,
                    CASE WHEN m.es_efectivo THEN m.cuenta_default_egreso END) IS NOT NULL) )
      $q$, v_tabla) USING v_sin_esp;
    END IF;

    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN v_out := v_out || jsonb_build_object(v_tabla, v_n); END IF;
  END LOOP;

  RETURN v_out;
END
$fn$;

COMMENT ON FUNCTION public.resincronizar_medios_pago() IS
  'Repara el histórico después de agregar un alias nuevo. Devuelve {tabla: filas_tocadas}. Nunca pisa una cuenta ya cargada.';

REVOKE ALL ON FUNCTION public.resincronizar_medios_pago() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resincronizar_medios_pago() TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 7. VISTAS DE CONTROL
-- ═══════════════════════════════════════════════════════════════════════

-- 7.a — Textos que aparecieron y el diccionario no conoce.
--       Es lo que hace que el modelo se mantenga solo: si cae algo nuevo, se ve.
CREATE OR REPLACE VIEW public.v_medios_pago_sin_mapear AS
WITH t AS (
            SELECT 'gastos'::text                    AS tabla, lower(btrim(coalesce(medio_pago,''))) AS txt FROM public.gastos
  UNION ALL SELECT 'pagos_gastos',                          lower(btrim(coalesce(medio_pago,'')))     FROM public.pagos_gastos
  UNION ALL SELECT 'pagos_fijos',                           lower(btrim(coalesce(medio_pago,'')))     FROM public.pagos_fijos
  UNION ALL SELECT 'adelantos',                             lower(btrim(coalesce(medio_pago,'')))     FROM public.adelantos
  UNION ALL SELECT 'aguinaldos',                            lower(btrim(coalesce(medio_pago,'')))     FROM public.aguinaldos
  UNION ALL SELECT 'dividendos',                            lower(btrim(coalesce(medio_pago,'')))     FROM public.dividendos
  UNION ALL SELECT 'pagos_sueldos',                         lower(btrim(coalesce(medio_pago,'')))     FROM public.pagos_sueldos
  UNION ALL SELECT 'ventas_tickets',                        lower(btrim(coalesce(medio_pago,'')))     FROM public.ventas_tickets
  UNION ALL SELECT 'ventas_pagos',                          lower(btrim(coalesce(medio_pago,'')))     FROM public.ventas_pagos
  UNION ALL SELECT 'liquidaciones_quincenales',             lower(btrim(coalesce(medio_pago,'')))     FROM public.liquidaciones_quincenales
  UNION ALL SELECT 'almacen_pedidos',                       lower(btrim(coalesce(medio_pago,'')))     FROM public.almacen_pedidos
)
SELECT t.tabla, t.txt AS texto, count(*) AS filas
  FROM t LEFT JOIN public.medios_pago_alias a ON a.alias = t.txt
 WHERE a.alias IS NULL
 GROUP BY 1, 2
 ORDER BY 3 DESC;

COMMENT ON VIEW public.v_medios_pago_sin_mapear IS
  'Textos de medio de pago que ninguna fila de medios_pago_alias reconoce. Debe dar 0 filas. Si aparece algo: agregar el alias y correr resincronizar_medios_pago().';

-- 7.b — EL libro de egresos por caja.
CREATE OR REPLACE VIEW public.v_egresos_caja AS
            SELECT 'pagos_gastos'::text AS origen, pg.id, pg.fecha_pago AS fecha, pg.monto, pg.cuenta, pg.medio_pago_id
              FROM public.pagos_gastos pg
             WHERE NOT COALESCE(pg.programado, false)
  UNION ALL SELECT 'pagos_sueldos', ps.id, ps.fecha_pago, ps.monto, ps.cuenta, ps.medio_pago_id
              FROM public.pagos_sueldos ps
  UNION ALL SELECT 'dividendos', d.id, d.fecha, d.monto, d.cuenta, d.medio_pago_id
              FROM public.dividendos d;

COMMENT ON VIEW public.v_egresos_caja IS
  'EL libro de egresos por caja. Deliberadamente NO incluye: gastos (es lo devengado, se duplicaria con pagos_gastos), pagos_fijos ni aguinaldos (espejan gastos+pagos_gastos, ver ChecklistPagos.tsx:582 y AguinaldoTab.tsx:554), adelantos (se netean en la liquidacion, no son egreso propio). Sumar cualquiera de esas tablas ADEMAS de esta vista DUPLICA plata. ⚠️ ADVERTENCIA: SUM(monto) FILTER (WHERE cuenta=''caja'') NO es "salidas de caja" — los pagos hechos con plata del cajon ya estan restados en cierres_caja.otros_retiros. Recien con la migracion 139 (retiro_cambio / retiro_pagos) se puede netear.';

-- ═══════════════════════════════════════════════════════════════════════
-- 8. QUÉ SIGNIFICA `cuenta` (para que nadie la use mal)
-- ═══════════════════════════════════════════════════════════════════════

DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['gastos','pagos_gastos','pagos_fijos','adelantos','aguinaldos','dividendos','pagos_sueldos']
  LOOP
    EXECUTE format(
      'COMMENT ON COLUMN public.%I.cuenta IS %L', t,
      'CON QUE se pago / de donde salio: mercadopago | galicia | icbc | caja | mp_lucas. '
      'NO es una cuenta contable con saldo: cuenta=''caja'' solo significa "el medio fue efectivo". '
      'El saldo de efectivo se calcula SOLO desde cierres_caja (caja chica + caja fuerte). '
      'Ver v_egresos_caja antes de sumar nada.');
  END LOOP;
END
$do$;
