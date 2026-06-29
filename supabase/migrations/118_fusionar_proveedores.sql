-- Fusión de proveedores duplicados.
--
-- Caso: el mismo proveedor cargado dos veces (ej: "Casa Gabardini Sa" y
-- "CASA GABARDINI S.A."). Esta RPC combina dos registros en uno solo de forma
-- atómica:
--   1) Re-apunta TODOS los gastos del que se elimina al que se mantiene.
--   2) Junta en el que queda los aliases y CUITs alternativos del otro (+ su
--      razón social y nombre comercial como aliases), para que la conciliación
--      por nombre/CUIT del histórico siga encontrándolo.
--   3) Hereda CUIT / nombre comercial si al que queda le faltaban.
--   4) Elimina el registro duplicado (ya sin gastos apuntándolo).
--
-- Solo un admin (es_admin_actual) puede ejecutarla. Único FK a proveedores es
-- gastos.proveedor_id, así que con re-apuntar gastos no quedan huérfanos.

CREATE OR REPLACE FUNCTION public.fusionar_proveedores(
  p_mantener uuid,
  p_eliminar uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_keep public.proveedores%ROWTYPE;
  v_drop public.proveedores%ROWTYPE;
  v_gastos_movidos int;
  v_nuevos_aliases text[];
  v_nuevos_cuits text[];
BEGIN
  IF NOT public.es_admin_actual() THEN
    RAISE EXCEPTION 'Solo un administrador puede fusionar proveedores';
  END IF;

  IF p_mantener IS NULL OR p_eliminar IS NULL THEN
    RAISE EXCEPTION 'Faltan los proveedores a fusionar';
  END IF;

  IF p_mantener = p_eliminar THEN
    RAISE EXCEPTION 'No se puede fusionar un proveedor consigo mismo';
  END IF;

  SELECT * INTO v_keep FROM public.proveedores WHERE id = p_mantener;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El proveedor a mantener no existe';
  END IF;

  SELECT * INTO v_drop FROM public.proveedores WHERE id = p_eliminar;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El proveedor a eliminar no existe';
  END IF;

  -- 1) Re-apuntar los gastos
  UPDATE public.gastos SET proveedor_id = p_mantener WHERE proveedor_id = p_eliminar;
  GET DIAGNOSTICS v_gastos_movidos = ROW_COUNT;

  -- 2) Juntar aliases (sin duplicar los nombres propios del que queda)
  v_nuevos_aliases := (
    SELECT array_agg(DISTINCT a)
    FROM (
      SELECT unnest(coalesce(v_keep.aliases, '{}')) AS a
      UNION
      SELECT unnest(coalesce(v_drop.aliases, '{}'))
      UNION
      SELECT v_drop.razon_social WHERE v_drop.razon_social IS NOT NULL
      UNION
      SELECT v_drop.nombre_comercial WHERE v_drop.nombre_comercial IS NOT NULL
    ) s
    WHERE a IS NOT NULL
      AND btrim(a) <> ''
      AND lower(a) <> lower(coalesce(v_keep.razon_social, ''))
      AND lower(a) <> lower(coalesce(v_keep.nombre_comercial, ''))
  );

  -- 3) Juntar CUITs alternativos (+ CUIT fiscal del que se elimina si difiere)
  v_nuevos_cuits := (
    SELECT array_agg(DISTINCT c)
    FROM (
      SELECT unnest(coalesce(v_keep.cuits_alt, '{}')) AS c
      UNION
      SELECT unnest(coalesce(v_drop.cuits_alt, '{}'))
      UNION
      SELECT v_drop.cuit WHERE v_drop.cuit IS NOT NULL
    ) s
    WHERE c IS NOT NULL
      AND btrim(c) <> ''
      AND c <> coalesce(v_keep.cuit, '')
  );

  UPDATE public.proveedores SET
    aliases = v_nuevos_aliases,
    cuits_alt = v_nuevos_cuits,
    cuit = coalesce(v_keep.cuit, v_drop.cuit),
    nombre_comercial = coalesce(v_keep.nombre_comercial, v_drop.nombre_comercial),
    updated_at = now()
  WHERE id = p_mantener;

  -- 4) Eliminar el duplicado
  DELETE FROM public.proveedores WHERE id = p_eliminar;

  RETURN jsonb_build_object(
    'ok', true,
    'gastos_movidos', v_gastos_movidos,
    'mantenido', v_keep.razon_social,
    'eliminado', v_drop.razon_social
  );
END;
$$;

-- Nunca exponer a anon (regla de hardening). Solo usuarios logueados; la propia
-- función valida que sea admin.
REVOKE ALL ON FUNCTION public.fusionar_proveedores(uuid, uuid) FROM public;
REVOKE ALL ON FUNCTION public.fusionar_proveedores(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fusionar_proveedores(uuid, uuid) TO authenticated;
