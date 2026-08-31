-- ============================================================================
-- 141 — Modelo de venta canónico (F0 del POS propio)
-- ============================================================================
-- PROBLEMA QUE RESUELVE
-- `ventas_items` guarda el nombre del producto como texto suelto y no sabe a
-- qué ticket pertenece ni qué día se vendió: solo local + mes. Por eso:
--   · no se puede reconstruir la canasta (qué se vendió junto),
--   · no se puede analizar por día ni por hora a nivel producto,
--   · cada pantalla re-matchea por nombre por su cuenta y el mismo bug
--     reaparece con otro producto (Parisienne, vinos, Saavedra, etc.).
--
-- QUÉ HACE
-- Todo ADITIVO: agrega columnas y un disparador. No borra ni renombra nada,
-- no toca la importación de Fudo existente y no cambia ningún número.
--
-- DECISIÓN DE LUCAS (30-ago-2026): NO se reconstruye la jerarquía de los
-- combos históricos (Bienal). Fudo no manda la relación padre/hijo — los
-- componentes llegan como líneas hermanas en $0 y lo único que las ata es el
-- orden. Deducirlo hacia atrás sería adivinar. La jerarquía se llena de acá en
-- adelante, cuando la escriba el POS (vinculo_origen = 'pos').
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. ventas_tickets — origen y tickets sin Fudo
-- ---------------------------------------------------------------------------
ALTER TABLE public.ventas_tickets
  ADD COLUMN IF NOT EXISTS origen text NOT NULL DEFAULT 'fudo';

DO $$ BEGIN
  ALTER TABLE public.ventas_tickets
    ADD CONSTRAINT ventas_tickets_origen_check
    CHECK (origen IN ('fudo', 'pos', 'manual'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Un ticket emitido por el POS propio no tiene id de Fudo.
ALTER TABLE public.ventas_tickets ALTER COLUMN fudo_id DROP NOT NULL;

-- ...pero si el origen es Fudo, el id sigue siendo obligatorio.
-- (la UNIQUE (local, fudo_id) que ya existe no molesta: Postgres considera
--  distintos entre sí los NULL, así que los tickets del POS no colisionan)
DO $$ BEGIN
  ALTER TABLE public.ventas_tickets
    ADD CONSTRAINT ventas_tickets_fudo_id_requerido
    CHECK (origen <> 'fudo' OR fudo_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 2. ventas_pagos — vínculo real al ticket
-- ---------------------------------------------------------------------------
-- Hoy se relaciona por texto (fudo_ticket_id). El texto se queda para no
-- romper nada; el vínculo real es el que se usa de acá en adelante.
ALTER TABLE public.ventas_pagos
  ADD COLUMN IF NOT EXISTS ticket_id uuid REFERENCES public.ventas_tickets(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- 3. ventas_items — identidad, jerarquía y vínculo al catálogo
-- ---------------------------------------------------------------------------
ALTER TABLE public.ventas_items
  ADD COLUMN IF NOT EXISTS ticket_id          uuid REFERENCES public.ventas_tickets(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS fecha              date,
  ADD COLUMN IF NOT EXISTS linea              integer,
  ADD COLUMN IF NOT EXISTS linea_padre_id     uuid REFERENCES public.ventas_items(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS vinculo_origen     text,
  ADD COLUMN IF NOT EXISTS receta_id          uuid REFERENCES public.cocina_recetas(id),
  ADD COLUMN IF NOT EXISTS cocina_producto_id uuid REFERENCES public.cocina_productos(id),
  ADD COLUMN IF NOT EXISTS precio_unitario    numeric,
  ADD COLUMN IF NOT EXISTS origen             text NOT NULL DEFAULT 'fudo';

DO $$ BEGIN
  ALTER TABLE public.ventas_items
    ADD CONSTRAINT ventas_items_origen_check CHECK (origen IN ('fudo', 'pos', 'manual'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- De dónde salió el vínculo padre/hijo. 'pos' = lo eligió el cajero (dato
-- cierto). 'fudo_orden' = deducido por el orden de las líneas (dato aproximado,
-- hoy no se usa: no reconstruimos el histórico). 'manual' = lo ató una persona.
DO $$ BEGIN
  ALTER TABLE public.ventas_items
    ADD CONSTRAINT ventas_items_vinculo_origen_check
    CHECK (vinculo_origen IS NULL OR vinculo_origen IN ('pos', 'fudo_orden', 'manual'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Una línea apunta a UNA cosa del catálogo: o a una receta vendible, o a un
-- producto de cocina. Nunca a las dos (sería contar el mismo plato dos veces).
DO $$ BEGIN
  ALTER TABLE public.ventas_items
    ADD CONSTRAINT ventas_items_un_solo_vinculo
    CHECK (num_nonnulls(receta_id, cocina_producto_id) <= 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Una línea no puede colgar de sí misma.
DO $$ BEGIN
  ALTER TABLE public.ventas_items
    ADD CONSTRAINT ventas_items_padre_no_es_hijo
    CHECK (linea_padre_id IS DISTINCT FROM id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 4. Índices
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_ventas_items_ticket     ON public.ventas_items (ticket_id);
CREATE INDEX IF NOT EXISTS idx_ventas_items_padre      ON public.ventas_items (linea_padre_id);
CREATE INDEX IF NOT EXISTS idx_ventas_items_receta     ON public.ventas_items (receta_id);
CREATE INDEX IF NOT EXISTS idx_ventas_items_producto   ON public.ventas_items (cocina_producto_id);
CREATE INDEX IF NOT EXISTS idx_ventas_items_local_fecha ON public.ventas_items (local, fecha);
CREATE INDEX IF NOT EXISTS idx_ventas_pagos_ticket     ON public.ventas_pagos (ticket_id);

-- Para que la resolución por nombre use índice y no recorra la tabla entera.
CREATE INDEX IF NOT EXISTS idx_cocina_recetas_fudo_productos
  ON public.cocina_recetas USING gin (fudo_productos);
CREATE INDEX IF NOT EXISTS idx_cocina_productos_fudo_nombres
  ON public.cocina_productos USING gin (fudo_nombres);

-- ---------------------------------------------------------------------------
-- 5. Backfill del vínculo pago → ticket (100% recuperable, no es deducción)
-- ---------------------------------------------------------------------------
UPDATE public.ventas_pagos p
   SET ticket_id = t.id
  FROM public.ventas_tickets t
 WHERE t.local = p.local
   AND t.fudo_id = p.fudo_ticket_id
   AND p.ticket_id IS NULL;

-- ---------------------------------------------------------------------------
-- 6. Backfill del vínculo item → catálogo
-- ---------------------------------------------------------------------------
-- Aplica exactamente la misma regla que hoy usa la app (useFudoHuerfanos):
-- primero receta vendible, si no hay, producto de cocina. Verificado antes de
-- escribir esto: ningún nombre apunta a dos recetas distintas, y los dos únicos
-- nombres que apuntan a dos productos ("Mila napo + fideos" / "+ ñoquis") tienen
-- receta propia, así que gana la receta. No hay ambigüedad que resolver a dedo.
WITH dic_receta AS (
  SELECT r.local, fp AS nom, r.id AS receta_id
    FROM public.cocina_recetas r, unnest(r.fudo_productos) fp
   WHERE r.vendible AND r.activo AND r.fudo_productos IS NOT NULL
), dic_prod AS (
  -- solo los nombres que apuntan a UN producto: si es ambiguo, se deja suelto
  -- a propósito (mejor sin vincular que mal vinculado)
  SELECT p.local, fn AS nom, (array_agg(p.id ORDER BY p.id))[1] AS producto_id
    FROM public.cocina_productos p, unnest(p.fudo_nombres) fn
   WHERE p.activo AND p.fudo_nombres IS NOT NULL
   GROUP BY p.local, fn
  HAVING count(DISTINCT p.id) = 1
), dic AS (
  SELECT coalesce(r.local, p.local) AS local,
         coalesce(r.nom,   p.nom)   AS nom,
         r.receta_id,
         CASE WHEN r.receta_id IS NULL THEN p.producto_id END AS producto_id
    FROM dic_receta r
    FULL JOIN dic_prod p ON p.local = r.local AND p.nom = r.nom
)
UPDATE public.ventas_items v
   SET receta_id          = dic.receta_id,
       cocina_producto_id = dic.producto_id
  FROM dic
 WHERE dic.local = v.local
   AND dic.nom   = v.nombre
   AND v.receta_id IS NULL
   AND v.cocina_producto_id IS NULL;

-- Precio unitario del histórico: total de la línea / cantidad.
UPDATE public.ventas_items
   SET precio_unitario = round(total / cantidad, 2)
 WHERE precio_unitario IS NULL
   AND cantidad IS NOT NULL AND cantidad <> 0;

-- ---------------------------------------------------------------------------
-- 7. Disparador: que el vínculo al catálogo no se degrade nunca más
-- ---------------------------------------------------------------------------
-- Sin esto, la próxima sincronización de Fudo (que borra y reinserta el mes)
-- dejaría todos los items del mes otra vez sin vincular. Mismo enfoque que
-- funcionó con los medios de pago (migración 138): lo resuelve la base al
-- grabar, no cada pantalla por su cuenta.
CREATE OR REPLACE FUNCTION public.trg_ventas_items_vincular_catalogo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_nom    text := btrim(coalesce(NEW.nombre, ''));
  v_receta uuid;
  v_prods  uuid[];
BEGIN
  -- Si quien graba ya dijo a qué apunta (el POS lo sabe), se respeta.
  IF NEW.receta_id IS NOT NULL OR NEW.cocina_producto_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF v_nom = '' THEN
    RETURN NEW;
  END IF;

  SELECT r.id INTO v_receta
    FROM public.cocina_recetas r
   WHERE r.local = NEW.local
     AND r.vendible AND r.activo
     AND r.fudo_productos @> ARRAY[v_nom]
   ORDER BY r.id
   LIMIT 1;

  IF v_receta IS NOT NULL THEN
    NEW.receta_id := v_receta;
    RETURN NEW;
  END IF;

  SELECT array_agg(DISTINCT p.id) INTO v_prods
    FROM public.cocina_productos p
   WHERE p.local = NEW.local
     AND p.activo
     AND p.fudo_nombres @> ARRAY[v_nom];

  -- Si el nombre apunta a más de un producto, se deja sin vincular.
  IF array_length(v_prods, 1) = 1 THEN
    NEW.cocina_producto_id := v_prods[1];
  END IF;

  RETURN NEW;
END
$fn$;

REVOKE ALL ON FUNCTION public.trg_ventas_items_vincular_catalogo() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ventas_items_vincular ON public.ventas_items;
CREATE TRIGGER trg_ventas_items_vincular
  BEFORE INSERT OR UPDATE OF nombre, local, receta_id, cocina_producto_id
  ON public.ventas_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_ventas_items_vincular_catalogo();

-- ---------------------------------------------------------------------------
-- 8. Vista de control: qué se vendió y no existe en el catálogo
-- ---------------------------------------------------------------------------
-- OJO (landmine de la migración 140): toda vista nueva nace legible por `anon`
-- —el rol de las pantallas QR sin login— y al crearla el dueño de la base se
-- saltea el RLS de las tablas de abajo. Por eso las dos líneas de abajo.
CREATE OR REPLACE VIEW public.v_ventas_items_sin_catalogo AS
SELECT v.local,
       v.periodo,
       v.nombre,
       sum(v.cantidad) AS uds,
       sum(v.total)    AS total,
       count(*)        AS lineas
  FROM public.ventas_items v
 WHERE v.receta_id IS NULL
   AND v.cocina_producto_id IS NULL
 GROUP BY v.local, v.periodo, v.nombre;

ALTER VIEW public.v_ventas_items_sin_catalogo SET (security_invoker = true);
REVOKE ALL ON public.v_ventas_items_sin_catalogo FROM anon;

-- ---------------------------------------------------------------------------
-- 9. Documentación en la propia base
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN public.ventas_items.ticket_id IS
  'Ticket al que pertenece la línea. NULL en el histórico anterior a F0: Fudo lo manda pero la importación vieja no lo guardaba, se recupera reimportando el mes.';
COMMENT ON COLUMN public.ventas_items.fecha IS
  'Fecha de la venta (copiada del ticket para poder agrupar por día sin join). NULL en el histórico anterior a F0.';
COMMENT ON COLUMN public.ventas_items.linea IS
  'Orden de la línea dentro del ticket. Es lo único que en Fudo ata un combo con sus componentes.';
COMMENT ON COLUMN public.ventas_items.linea_padre_id IS
  'Línea de la que cuelga esta (ej: la pasta elegida dentro de un combo). Se llena desde el POS; el histórico de Fudo queda en NULL por decisión, no por olvido.';
COMMENT ON COLUMN public.ventas_items.vinculo_origen IS
  'Cómo se supo el padre: pos = lo eligió el cajero (cierto) | fudo_orden = deducido por orden (aproximado) | manual = lo ató una persona.';
COMMENT ON COLUMN public.ventas_items.receta_id IS
  'Receta vendible del catálogo. Lo completa solo el disparador trg_ventas_items_vincular a partir de cocina_recetas.fudo_productos.';
COMMENT ON COLUMN public.ventas_items.cocina_producto_id IS
  'Producto de cocina, cuando no hay receta vendible que matchee. Lo completa el mismo disparador vía cocina_productos.fudo_nombres.';
COMMENT ON COLUMN public.ventas_items.origen IS
  'fudo = importado | pos = emitido por el POS propio | manual = cargado a mano. Necesario para el shadow mode (cobrar por los dos y comparar).';
COMMENT ON COLUMN public.ventas_tickets.origen IS
  'fudo = importado | pos = emitido por el POS propio | manual. Un ticket con origen fudo tiene fudo_id obligatorio.';
COMMENT ON COLUMN public.ventas_pagos.ticket_id IS
  'Vínculo real al ticket. fudo_ticket_id (texto) se mantiene para no romper lo que ya lo lee.';
