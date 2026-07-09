-- Versionado del maestro de PROVEEDORES y su matcher.
--
-- Contexto: la tabla `proveedores` y la función `buscar_proveedor_por_texto`
-- preceden a la carpeta de migraciones y vivían SOLO en la base productiva (no
-- en git). Esto las deja versionadas para poder revisarlas, revertirlas y
-- reconstruir un entorno desde cero. Es idempotente y refleja EXACTAMENTE el
-- estado de prod al 2026-07-09, así que aplicarla sobre prod es un no-op.
-- (Fase 4 · pata 1 del linaje de proveedores; ver docs de la sesión.)

-- ── Tabla ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.proveedores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  razon_social text NOT NULL,
  cuit text,
  condicion_iva text CHECK (condicion_iva = ANY (ARRAY[
    'responsable_inscripto'::text, 'monotributo'::text, 'exento'::text, 'consumidor_final'::text
  ])),
  categoria_default_id uuid,
  medio_pago_default text,
  dias_pago integer DEFAULT 0,
  contacto text,
  telefono text,
  email text,
  activo boolean NOT NULL DEFAULT true,
  notas text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  nombre_comercial text,   -- preferido para display (ver proveedorDisplay.tsx)
  aliases text[],          -- variantes de nombre en extractos/gastos a mano
  cuits_alt text[]         -- CUITs alternativos del titular de la cuenta destino
);

-- ── Índices ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_proveedores_razon ON public.proveedores (razon_social);
CREATE UNIQUE INDEX IF NOT EXISTS ux_proveedores_cuit ON public.proveedores (cuit) WHERE cuit IS NOT NULL;
CREATE INDEX IF NOT EXISTS proveedores_aliases_gin ON public.proveedores USING gin (aliases);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.proveedores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS proveedores_compras_o_gastos_all ON public.proveedores;
CREATE POLICY proveedores_compras_o_gastos_all ON public.proveedores
  FOR ALL TO authenticated
  USING (tiene_permiso('compras') OR tiene_permiso('gastos'))
  WITH CHECK (tiene_permiso('compras') OR tiene_permiso('gastos'));

DROP POLICY IF EXISTS proveedores_lectura_general ON public.proveedores;
CREATE POLICY proveedores_lectura_general ON public.proveedores
  FOR SELECT TO authenticated
  USING (tiene_permiso('compras') OR tiene_permiso('gastos') OR tiene_permiso('finanzas'));

-- ── Matcher texto → proveedor (usado por la conciliación bancaria) ───────────
-- Score por LIKE/igualdad sobre razón, nombre comercial, aliases y CUITs.
-- LIMITACIONES CONOCIDAS (candidatas a mejorar en Fase 4 · pata 2):
--   * No normaliza acentos ni puntuación ("S.A." != "SA", "Frigorífico" != "Frigorifico").
--   * El match de aliases (score 70) es bidireccional por substring, así que un
--     alias corto genérico (ej. "ICBC") da falsos positivos.
CREATE OR REPLACE FUNCTION public.buscar_proveedor_por_texto(p_texto text)
 RETURNS TABLE(id uuid, razon_social text, nombre_comercial text, cuit text, score integer)
 LANGUAGE sql
 STABLE
AS $function$
  WITH norm AS (SELECT trim(lower(p_texto)) AS t),
  scored AS (
    SELECT
      p.id,
      p.razon_social,
      p.nombre_comercial,
      p.cuit,
      GREATEST(
        CASE WHEN lower(p.razon_social) = (SELECT t FROM norm) THEN 100 ELSE 0 END,
        CASE WHEN lower(p.nombre_comercial) = (SELECT t FROM norm) THEN 100 ELSE 0 END,
        CASE WHEN lower(p.razon_social) LIKE (SELECT t FROM norm) || '%' THEN 80 ELSE 0 END,
        CASE WHEN lower(p.nombre_comercial) LIKE (SELECT t FROM norm) || '%' THEN 80 ELSE 0 END,
        CASE WHEN lower(p.razon_social) LIKE '%' || (SELECT t FROM norm) || '%' THEN 60 ELSE 0 END,
        CASE WHEN lower(p.nombre_comercial) LIKE '%' || (SELECT t FROM norm) || '%' THEN 60 ELSE 0 END,
        CASE WHEN p.aliases IS NOT NULL AND EXISTS (
          SELECT 1 FROM unnest(p.aliases) a
          WHERE lower(a) LIKE '%' || (SELECT t FROM norm) || '%'
            OR (SELECT t FROM norm) LIKE '%' || lower(a) || '%'
        ) THEN 70 ELSE 0 END,
        CASE WHEN p.cuit IS NOT NULL AND p_texto LIKE '%' || p.cuit || '%' THEN 90 ELSE 0 END,
        CASE WHEN p.cuits_alt IS NOT NULL AND EXISTS (
          SELECT 1 FROM unnest(p.cuits_alt) c
          WHERE c IS NOT NULL AND length(c) > 0 AND p_texto LIKE '%' || c || '%'
        ) THEN 90 ELSE 0 END
      )::int AS score
    FROM public.proveedores p
    WHERE p.activo IS NOT FALSE
  )
  SELECT id, razon_social, nombre_comercial, cuit, score
  FROM scored
  WHERE score > 0
  ORDER BY score DESC, razon_social
  LIMIT 5;
$function$;

-- Hardening: nunca anon; solo usuarios logueados (ver hardening seguridad).
REVOKE ALL ON FUNCTION public.buscar_proveedor_por_texto(text) FROM public;
REVOKE ALL ON FUNCTION public.buscar_proveedor_por_texto(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.buscar_proveedor_por_texto(text) TO authenticated;
