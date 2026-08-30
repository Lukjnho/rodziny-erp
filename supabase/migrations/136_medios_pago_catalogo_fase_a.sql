-- 136_medios_pago_catalogo_fase_a.sql
--
-- PASO 1 del proyecto POS — FASE A: lista única de medios de pago.
--
-- QUÉ HACE (en criollo):
--   Hoy el "medio de pago" se guarda como texto escrito a mano en 12 tablas.
--   Eso hace que "Tarjeta de débito" y "Tarjeta de debito" (sin tilde) se cuenten
--   como dos cosas distintas, y que "transferencia_mp" mezcle el medio
--   (transferencia) con la cuenta de donde salió la plata (Mercado Pago).
--
--   Esta migración crea la lista oficial de medios y, al lado de cada registro,
--   agrega DOS DATOS NUEVOS: a qué medio de la lista corresponde, y de qué
--   cuenta salió/entró la plata.
--
-- QUÉ *NO* HACE (importante):
--   NO toca ni borra el texto viejo. Todo lo que funciona hoy sigue igual,
--   porque las pantallas y las funciones automáticas siguen leyendo ese texto.
--   Por eso esta migración no puede romper nada: solo agrega.
--
--   Tampoco toca `pagos_mp` (es un espejo de Mercado Pago: se rellena solo en
--   cada sincronización, si le cambiamos los nombres vuelven los originales)
--   ni `comision_mp_config` (esos textos no son etiquetas, son las llaves con
--   las que el sistema busca la comisión de cada medio).
--
-- Fases siguientes (NO están en este archivo):
--   B: apuntar las pantallas de análisis al dato nuevo → ahí se arreglan los números.
--   C: pasar las pantallas de carga a lista desplegable (se acaba el texto libre).
--   D: apagar la columna de texto vieja.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. LA LISTA OFICIAL DE MEDIOS DE PAGO
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.medios_pago (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo                 TEXT NOT NULL UNIQUE,
  nombre                 TEXT NOT NULL,
  es_efectivo            BOOLEAN NOT NULL DEFAULT FALSE,
  cuenta_default_egreso  TEXT,
  aplica_ventas          BOOLEAN NOT NULL DEFAULT TRUE,
  aplica_egresos         BOOLEAN NOT NULL DEFAULT TRUE,
  activo                 BOOLEAN NOT NULL DEFAULT TRUE,
  orden                  INT NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE  public.medios_pago IS
  'Lista oficial de medios de pago. Reemplaza el texto libre. El `codigo` coincide a propósito con las llaves de comision_mp_config para no duplicar la fuente de comisiones.';
COMMENT ON COLUMN public.medios_pago.es_efectivo IS
  'TRUE = suma al arqueo de caja físico. Hoy cada pantalla lo adivinaba por el nombre.';
COMMENT ON COLUMN public.medios_pago.cuenta_default_egreso IS
  'Cuenta sugerida cuando Rodziny PAGA con este medio (regla de Lucas 30-ago-2026: transferencias salen de MP, ARCA se debita de Galicia, tarjetas del ICBC). Es solo una sugerencia para la pantalla: el dato real va en la columna `cuenta` de cada registro.';
COMMENT ON COLUMN public.medios_pago.activo IS
  'FALSE = no se puede elegir para registros nuevos, pero se sigue mostrando en el histórico (caso "Mixto").';

-- ═══════════════════════════════════════════════════════════════════════
-- 2. LOS ALIAS: cada forma en que se escribió históricamente
-- ═══════════════════════════════════════════════════════════════════════
-- Esta tabla es el diccionario de traducción. Si mañana aparece una forma
-- nueva de escribir un medio, se agrega acá una fila y listo — no hay que
-- tocar código.

CREATE TABLE IF NOT EXISTS public.medios_pago_alias (
  alias          TEXT PRIMARY KEY,
  medio_codigo   TEXT NOT NULL REFERENCES public.medios_pago(codigo) ON UPDATE CASCADE,
  cuenta         TEXT,
  nota           TEXT
);

COMMENT ON TABLE public.medios_pago_alias IS
  'Diccionario: cómo se escribió históricamente cada medio → a qué medio de la lista corresponde. El alias se guarda en minúsculas y sin espacios de sobra.';
COMMENT ON COLUMN public.medios_pago_alias.cuenta IS
  'Si el texto viejo también decía de qué cuenta salió la plata (ej: transferencia_galicia), acá queda separada.';

-- ── Permisos: lee cualquiera con sesión, edita solo el admin ───────────
ALTER TABLE public.medios_pago       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medios_pago_alias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sel_medios_pago ON public.medios_pago;
CREATE POLICY sel_medios_pago ON public.medios_pago
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS mod_medios_pago ON public.medios_pago;
CREATE POLICY mod_medios_pago ON public.medios_pago
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM perfiles WHERE perfiles.user_id = auth.uid() AND perfiles.es_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM perfiles WHERE perfiles.user_id = auth.uid() AND perfiles.es_admin));

DROP POLICY IF EXISTS sel_medios_pago_alias ON public.medios_pago_alias;
CREATE POLICY sel_medios_pago_alias ON public.medios_pago_alias
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS mod_medios_pago_alias ON public.medios_pago_alias;
CREATE POLICY mod_medios_pago_alias ON public.medios_pago_alias
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM perfiles WHERE perfiles.user_id = auth.uid() AND perfiles.es_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM perfiles WHERE perfiles.user_id = auth.uid() AND perfiles.es_admin));

-- ═══════════════════════════════════════════════════════════════════════
-- 3. CARGA DE LA LISTA
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO public.medios_pago (codigo, nombre, es_efectivo, cuenta_default_egreso, aplica_ventas, aplica_egresos, activo, orden) VALUES
  ('efectivo',        'Efectivo',           TRUE,  NULL,          TRUE,  TRUE,  TRUE,  10),
  ('qr',              'Código QR',          FALSE, 'mercadopago', TRUE,  FALSE, TRUE,  20),
  ('debito',          'Tarjeta de débito',  FALSE, 'icbc',        TRUE,  TRUE,  TRUE,  30),
  ('credito',         'Tarjeta de crédito', FALSE, 'icbc',        TRUE,  TRUE,  TRUE,  40),
  ('transferencia',   'Transferencia',      FALSE, 'mercadopago', TRUE,  TRUE,  TRUE,  50),
  ('cheque',          'Cheque / e-cheq',    FALSE, 'galicia',     FALSE, TRUE,  TRUE,  60),
  ('mp_lucas',        'Mercado Pago Lucas', FALSE, 'mercadopago', TRUE,  TRUE,  TRUE,  70),
  ('mixto',           'Mixto (histórico)',  FALSE, NULL,          TRUE,  FALSE, FALSE, 80),
  ('sin_especificar', 'Sin especificar',    FALSE, NULL,          TRUE,  TRUE,  TRUE,  99)
ON CONFLICT (codigo) DO NOTHING;

-- ── Diccionario de alias: las 36 formas encontradas al 30-ago-2026 ─────
INSERT INTO public.medios_pago_alias (alias, medio_codigo, cuenta, nota) VALUES
  ('efectivo',              'efectivo',        NULL,          NULL),
  ('codigo qr',             'qr',              'mercadopago', NULL),
  ('código qr',             'qr',              'mercadopago', NULL),
  ('qr',                    'qr',              'mercadopago', NULL),
  ('mercado pago (qr)',     'qr',              'mercadopago', NULL),
  ('tarjeta de débito',     'debito',          NULL,          NULL),
  ('tarjeta de debito',     'debito',          NULL,          'Sin tilde: 1.777 registros que caían afuera del análisis'),
  ('debito',                'debito',          NULL,          NULL),
  ('débito',                'debito',          NULL,          NULL),
  ('tarjeta de crédito',    'credito',         NULL,          NULL),
  ('tarjeta de credito',    'credito',         NULL,          'Sin tilde: 684 registros'),
  ('credito',               'credito',         NULL,          NULL),
  ('crédito',               'credito',         NULL,          NULL),
  ('tarjeta_icbc',          'credito',         'icbc',        'Rodziny pagando con su tarjeta del ICBC'),
  ('transferencia',         'transferencia',   NULL,          'Cuenta desconocida: no se inventa'),
  ('transferencia_mp',      'transferencia',   'mercadopago', NULL),
  ('transferencia_galicia', 'transferencia',   'galicia',     NULL),
  ('transferencia_icbc',    'transferencia',   'icbc',        NULL),
  ('cheque',                'cheque',          NULL,          NULL),
  ('cheque_galicia',        'cheque',          'galicia',     NULL),
  ('mercadopago lucas',     'mp_lucas',        'mercadopago', 'Dispara el marcado de dividendo de Lucas'),
  ('mp',                    'mp_lucas',        'mercadopago', NULL),
  ('mp_lucas',              'mp_lucas',        'mercadopago', NULL),
  ('mixto',                 'mixto',           NULL,          'El detalle real de cómo pagó está en ventas_pagos'),
  ('mercadopago (point)',   'sin_especificar', NULL,          '2 registros: lector de tarjetas MP, no se sabe si fue débito o crédito'),
  ('cta. cte.',             'sin_especificar', NULL,          'NO es un medio de pago: era "comprado a cuenta corriente, aún no pagado" (decisión de Lucas 30-ago-2026)'),
  ('otro',                  'sin_especificar', NULL,          NULL),
  ('',                      'sin_especificar', NULL,          'Vacío')
ON CONFLICT (alias) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. LOS DOS DATOS NUEVOS EN CADA TABLA
-- ═══════════════════════════════════════════════════════════════════════
-- Ojo: se agregan SIN restricción obligatoria a propósito. Si pusiéramos la
-- lista como obligatoria ahora, las pantallas que todavía guardan texto libre
-- empezarían a fallar al grabar. Eso se activa recién en la Fase C.

ALTER TABLE public.adelantos               ADD COLUMN IF NOT EXISTS medio_pago_id UUID REFERENCES public.medios_pago(id);
ALTER TABLE public.aguinaldos              ADD COLUMN IF NOT EXISTS medio_pago_id UUID REFERENCES public.medios_pago(id);
ALTER TABLE public.almacen_pedidos         ADD COLUMN IF NOT EXISTS medio_pago_id UUID REFERENCES public.medios_pago(id);
ALTER TABLE public.dividendos              ADD COLUMN IF NOT EXISTS medio_pago_id UUID REFERENCES public.medios_pago(id);
ALTER TABLE public.gastos                  ADD COLUMN IF NOT EXISTS medio_pago_id UUID REFERENCES public.medios_pago(id);
ALTER TABLE public.liquidaciones_quincenales ADD COLUMN IF NOT EXISTS medio_pago_id UUID REFERENCES public.medios_pago(id);
ALTER TABLE public.pagos_fijos             ADD COLUMN IF NOT EXISTS medio_pago_id UUID REFERENCES public.medios_pago(id);
ALTER TABLE public.pagos_gastos            ADD COLUMN IF NOT EXISTS medio_pago_id UUID REFERENCES public.medios_pago(id);
ALTER TABLE public.pagos_sueldos           ADD COLUMN IF NOT EXISTS medio_pago_id UUID REFERENCES public.medios_pago(id);
ALTER TABLE public.ventas_pagos            ADD COLUMN IF NOT EXISTS medio_pago_id UUID REFERENCES public.medios_pago(id);
ALTER TABLE public.ventas_tickets          ADD COLUMN IF NOT EXISTS medio_pago_id UUID REFERENCES public.medios_pago(id);
ALTER TABLE public.proveedores             ADD COLUMN IF NOT EXISTS medio_pago_default_id UUID REFERENCES public.medios_pago(id);

-- La cuenta separada del medio (solo donde el texto viejo la traía adentro).
-- pagos_sueldos ya tenía `cuenta`: no se toca la definición, solo se completa.
ALTER TABLE public.gastos       ADD COLUMN IF NOT EXISTS cuenta TEXT;
ALTER TABLE public.pagos_gastos ADD COLUMN IF NOT EXISTS cuenta TEXT;
ALTER TABLE public.pagos_fijos  ADD COLUMN IF NOT EXISTS cuenta TEXT;
ALTER TABLE public.adelantos    ADD COLUMN IF NOT EXISTS cuenta TEXT;
ALTER TABLE public.aguinaldos   ADD COLUMN IF NOT EXISTS cuenta TEXT;
ALTER TABLE public.dividendos   ADD COLUMN IF NOT EXISTS cuenta TEXT;

COMMENT ON COLUMN public.gastos.cuenta IS
  'De qué cuenta salió la plata: mercadopago | galicia | icbc. Mismos nombres que movimientos_bancarios.cuenta. Antes venía pegado adentro del texto del medio de pago.';

-- ═══════════════════════════════════════════════════════════════════════
-- 5. COMPLETAR LOS DATOS NUEVOS A PARTIR DEL TEXTO VIEJO
-- ═══════════════════════════════════════════════════════════════════════

-- 5.a — Lo que matchea con el diccionario
UPDATE public.adelantos t SET medio_pago_id = m.id, cuenta = COALESCE(t.cuenta, a.cuenta)
  FROM public.medios_pago_alias a JOIN public.medios_pago m ON m.codigo = a.medio_codigo
  WHERE LOWER(BTRIM(COALESCE(t.medio_pago,''))) = a.alias;

UPDATE public.aguinaldos t SET medio_pago_id = m.id, cuenta = COALESCE(t.cuenta, a.cuenta)
  FROM public.medios_pago_alias a JOIN public.medios_pago m ON m.codigo = a.medio_codigo
  WHERE LOWER(BTRIM(COALESCE(t.medio_pago,''))) = a.alias;

UPDATE public.almacen_pedidos t SET medio_pago_id = m.id
  FROM public.medios_pago_alias a JOIN public.medios_pago m ON m.codigo = a.medio_codigo
  WHERE LOWER(BTRIM(COALESCE(t.medio_pago,''))) = a.alias;

UPDATE public.dividendos t SET medio_pago_id = m.id, cuenta = COALESCE(t.cuenta, a.cuenta)
  FROM public.medios_pago_alias a JOIN public.medios_pago m ON m.codigo = a.medio_codigo
  WHERE LOWER(BTRIM(COALESCE(t.medio_pago,''))) = a.alias;

UPDATE public.gastos t SET medio_pago_id = m.id, cuenta = COALESCE(t.cuenta, a.cuenta)
  FROM public.medios_pago_alias a JOIN public.medios_pago m ON m.codigo = a.medio_codigo
  WHERE LOWER(BTRIM(COALESCE(t.medio_pago,''))) = a.alias;

UPDATE public.liquidaciones_quincenales t SET medio_pago_id = m.id
  FROM public.medios_pago_alias a JOIN public.medios_pago m ON m.codigo = a.medio_codigo
  WHERE LOWER(BTRIM(COALESCE(t.medio_pago,''))) = a.alias;

UPDATE public.pagos_fijos t SET medio_pago_id = m.id, cuenta = COALESCE(t.cuenta, a.cuenta)
  FROM public.medios_pago_alias a JOIN public.medios_pago m ON m.codigo = a.medio_codigo
  WHERE LOWER(BTRIM(COALESCE(t.medio_pago,''))) = a.alias;

UPDATE public.pagos_gastos t SET medio_pago_id = m.id, cuenta = COALESCE(t.cuenta, a.cuenta)
  FROM public.medios_pago_alias a JOIN public.medios_pago m ON m.codigo = a.medio_codigo
  WHERE LOWER(BTRIM(COALESCE(t.medio_pago,''))) = a.alias;

UPDATE public.pagos_sueldos t SET medio_pago_id = m.id, cuenta = COALESCE(t.cuenta, a.cuenta)
  FROM public.medios_pago_alias a JOIN public.medios_pago m ON m.codigo = a.medio_codigo
  WHERE LOWER(BTRIM(COALESCE(t.medio_pago,''))) = a.alias;

UPDATE public.ventas_pagos t SET medio_pago_id = m.id
  FROM public.medios_pago_alias a JOIN public.medios_pago m ON m.codigo = a.medio_codigo
  WHERE LOWER(BTRIM(COALESCE(t.medio_pago,''))) = a.alias;

UPDATE public.ventas_tickets t SET medio_pago_id = m.id
  FROM public.medios_pago_alias a JOIN public.medios_pago m ON m.codigo = a.medio_codigo
  WHERE LOWER(BTRIM(COALESCE(t.medio_pago,''))) = a.alias;

UPDATE public.proveedores t SET medio_pago_default_id = m.id
  FROM public.medios_pago_alias a JOIN public.medios_pago m ON m.codigo = a.medio_codigo
  WHERE LOWER(BTRIM(COALESCE(t.medio_pago_default,''))) = a.alias;

-- 5.b — Lo que no matcheó (texto raro o nulo) queda como "Sin especificar".
--       Así ninguna fila queda sin clasificar y los totales cierran.
UPDATE public.adelantos               SET medio_pago_id = (SELECT id FROM public.medios_pago WHERE codigo='sin_especificar') WHERE medio_pago_id IS NULL;
UPDATE public.aguinaldos              SET medio_pago_id = (SELECT id FROM public.medios_pago WHERE codigo='sin_especificar') WHERE medio_pago_id IS NULL;
UPDATE public.almacen_pedidos         SET medio_pago_id = (SELECT id FROM public.medios_pago WHERE codigo='sin_especificar') WHERE medio_pago_id IS NULL;
UPDATE public.dividendos              SET medio_pago_id = (SELECT id FROM public.medios_pago WHERE codigo='sin_especificar') WHERE medio_pago_id IS NULL;
UPDATE public.gastos                  SET medio_pago_id = (SELECT id FROM public.medios_pago WHERE codigo='sin_especificar') WHERE medio_pago_id IS NULL;
UPDATE public.liquidaciones_quincenales SET medio_pago_id = (SELECT id FROM public.medios_pago WHERE codigo='sin_especificar') WHERE medio_pago_id IS NULL;
UPDATE public.pagos_fijos             SET medio_pago_id = (SELECT id FROM public.medios_pago WHERE codigo='sin_especificar') WHERE medio_pago_id IS NULL;
UPDATE public.pagos_gastos            SET medio_pago_id = (SELECT id FROM public.medios_pago WHERE codigo='sin_especificar') WHERE medio_pago_id IS NULL;
UPDATE public.pagos_sueldos           SET medio_pago_id = (SELECT id FROM public.medios_pago WHERE codigo='sin_especificar') WHERE medio_pago_id IS NULL;
UPDATE public.ventas_pagos            SET medio_pago_id = (SELECT id FROM public.medios_pago WHERE codigo='sin_especificar') WHERE medio_pago_id IS NULL;
UPDATE public.ventas_tickets          SET medio_pago_id = (SELECT id FROM public.medios_pago WHERE codigo='sin_especificar') WHERE medio_pago_id IS NULL;
-- proveedores queda en NULL a propósito: "sin medio preferido" es un estado válido.

-- ═══════════════════════════════════════════════════════════════════════
-- 6. ÍNDICES (para que los análisis por medio de pago sigan siendo rápidos)
-- ═══════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_ventas_pagos_medio    ON public.ventas_pagos(medio_pago_id);
CREATE INDEX IF NOT EXISTS idx_ventas_tickets_medio  ON public.ventas_tickets(medio_pago_id);
CREATE INDEX IF NOT EXISTS idx_gastos_medio          ON public.gastos(medio_pago_id);
CREATE INDEX IF NOT EXISTS idx_pagos_gastos_medio    ON public.pagos_gastos(medio_pago_id);
CREATE INDEX IF NOT EXISTS idx_gastos_cuenta         ON public.gastos(cuenta);
CREATE INDEX IF NOT EXISTS idx_pagos_gastos_cuenta   ON public.pagos_gastos(cuenta);
