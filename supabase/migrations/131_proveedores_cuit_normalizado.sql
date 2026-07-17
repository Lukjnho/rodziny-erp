-- 131_proveedores_cuit_normalizado.sql
--
-- Problema: los CUIT de proveedores estaban guardados con formatos mezclados
-- (unos con guiones "30-71206276-9", otros como número entero "30715194275").
-- El matcher por texto comparaba el CUIT LITERAL contra el texto de la factura/
-- extracto, así que si el formato no coincidía, no matcheaba por CUIT y caía al
-- match por nombre → riesgo de crear un proveedor duplicado que solo difiere por
-- el guion.
--
-- Dos arreglos, ambos idempotentes:
--   1) Normalizar los CUIT existentes de 11 dígitos al formato canónico XX-XXXXXXXX-D.
--   2) Blindar buscar_proveedor_por_texto para que compare el CUIT SIN guiones de
--      los dos lados (dígitos contra dígitos), así el formato nunca más bloquea un match.
--
-- Se deja intencionalmente afuera cualquier CUIT que no tenga 11 dígitos exactos
-- (ej. CASA GABARDINI "303624450400" = 12 dígitos, es un typo a corregir a mano).

-- 1) Normalización de datos ---------------------------------------------------
UPDATE public.proveedores
SET cuit = substr(regexp_replace(cuit, '[^0-9]', '', 'g'), 1, 2) || '-'
        || substr(regexp_replace(cuit, '[^0-9]', '', 'g'), 3, 8) || '-'
        || substr(regexp_replace(cuit, '[^0-9]', '', 'g'), 11, 1)
WHERE cuit IS NOT NULL
  AND length(regexp_replace(cuit, '[^0-9]', '', 'g')) = 11
  AND cuit <> substr(regexp_replace(cuit, '[^0-9]', '', 'g'), 1, 2) || '-'
           || substr(regexp_replace(cuit, '[^0-9]', '', 'g'), 3, 8) || '-'
           || substr(regexp_replace(cuit, '[^0-9]', '', 'g'), 11, 1);

-- 2) Matcher robusto al formato del CUIT -------------------------------------
CREATE OR REPLACE FUNCTION public.buscar_proveedor_por_texto(p_texto text)
 RETURNS TABLE(id uuid, razon_social text, nombre_comercial text, cuit text, score integer)
 LANGUAGE sql
 STABLE
AS $function$
  WITH norm AS (
    SELECT trim(lower(p_texto)) AS t,
           regexp_replace(coalesce(p_texto, ''), '[^0-9]', '', 'g') AS td
  ),
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
        -- CUIT principal: comparo solo dígitos de los dos lados. Requiere >= 8
        -- dígitos para no matchear con un CUIT vacío/corrupto ('%%' matchea todo).
        CASE WHEN length(regexp_replace(coalesce(p.cuit, ''), '[^0-9]', '', 'g')) >= 8
              AND (SELECT td FROM norm) LIKE '%' || regexp_replace(p.cuit, '[^0-9]', '', 'g') || '%'
             THEN 90 ELSE 0 END,
        -- CUITs alternativos (mismo titular, ej. SRL vs persona física): idem.
        CASE WHEN p.cuits_alt IS NOT NULL AND EXISTS (
          SELECT 1 FROM unnest(p.cuits_alt) c
          WHERE length(regexp_replace(coalesce(c, ''), '[^0-9]', '', 'g')) >= 8
            AND (SELECT td FROM norm) LIKE '%' || regexp_replace(c, '[^0-9]', '', 'g') || '%'
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
