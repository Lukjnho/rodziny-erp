-- 018_rls_blindar_cocina_y_misc.sql
-- 1) Reemplaza policies `true/true` de tablas cocina_* por chequeo tiene_permiso('cocina'),
--    preservando el acceso anon específico que necesitan las PWAs (/produccion, /recepcion,
--    /deposito). 2) Cierra fichadas_authenticated con tiene_permiso('rrhh'). 3) Recrea las
--    views SECURITY DEFINER en modo SECURITY INVOKER. 4) Fija search_path en funciones
--    mutables reportadas por el advisor.

-- ── cocina_productos (anon SELECT + auth por cocina) ─────────────────────────
DROP POLICY IF EXISTS cocina_productos_anon ON public.cocina_productos;
DROP POLICY IF EXISTS cocina_productos_auth ON public.cocina_productos;

CREATE POLICY cocina_productos_anon_select ON public.cocina_productos
  FOR SELECT TO anon USING (true);

CREATE POLICY cocina_productos_cocina_all ON public.cocina_productos
  FOR ALL TO authenticated
  USING (tiene_permiso('cocina'))
  WITH CHECK (tiene_permiso('cocina'));

-- ── cocina_recetas ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS cocina_recetas_anon ON public.cocina_recetas;
DROP POLICY IF EXISTS cocina_recetas_auth ON public.cocina_recetas;

CREATE POLICY cocina_recetas_anon_select ON public.cocina_recetas
  FOR SELECT TO anon USING (true);

CREATE POLICY cocina_recetas_cocina_all ON public.cocina_recetas
  FOR ALL TO authenticated
  USING (tiene_permiso('cocina'))
  WITH CHECK (tiene_permiso('cocina'));

-- ── cocina_receta_ingredientes ───────────────────────────────────────────────
DROP POLICY IF EXISTS cocina_receta_ingredientes_all ON public.cocina_receta_ingredientes;

CREATE POLICY cocina_receta_ingredientes_anon_select ON public.cocina_receta_ingredientes
  FOR SELECT TO anon USING (true);

CREATE POLICY cocina_receta_ingredientes_cocina_all ON public.cocina_receta_ingredientes
  FOR ALL TO authenticated
  USING (tiene_permiso('cocina'))
  WITH CHECK (tiene_permiso('cocina'));

-- ── cocina_lotes_pasta (anon SELECT+INSERT para /produccion) ─────────────────
DROP POLICY IF EXISTS cocina_lotes_pasta_anon ON public.cocina_lotes_pasta;
DROP POLICY IF EXISTS cocina_lotes_pasta_auth ON public.cocina_lotes_pasta;

CREATE POLICY cocina_lotes_pasta_anon_select ON public.cocina_lotes_pasta
  FOR SELECT TO anon USING (true);
CREATE POLICY cocina_lotes_pasta_anon_insert ON public.cocina_lotes_pasta
  FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY cocina_lotes_pasta_cocina_all ON public.cocina_lotes_pasta
  FOR ALL TO authenticated
  USING (tiene_permiso('cocina'))
  WITH CHECK (tiene_permiso('cocina'));

-- ── cocina_lotes_masa ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS cocina_lotes_masa_anon ON public.cocina_lotes_masa;
DROP POLICY IF EXISTS cocina_lotes_masa_authenticated ON public.cocina_lotes_masa;

CREATE POLICY cocina_lotes_masa_anon_select ON public.cocina_lotes_masa
  FOR SELECT TO anon USING (true);
CREATE POLICY cocina_lotes_masa_anon_insert ON public.cocina_lotes_masa
  FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY cocina_lotes_masa_cocina_all ON public.cocina_lotes_masa
  FOR ALL TO authenticated
  USING (tiene_permiso('cocina'))
  WITH CHECK (tiene_permiso('cocina'));

-- ── cocina_lotes_relleno ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS cocina_lotes_relleno_anon ON public.cocina_lotes_relleno;
DROP POLICY IF EXISTS cocina_lotes_relleno_auth ON public.cocina_lotes_relleno;

CREATE POLICY cocina_lotes_relleno_anon_select ON public.cocina_lotes_relleno
  FOR SELECT TO anon USING (true);
CREATE POLICY cocina_lotes_relleno_anon_insert ON public.cocina_lotes_relleno
  FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY cocina_lotes_relleno_cocina_all ON public.cocina_lotes_relleno
  FOR ALL TO authenticated
  USING (tiene_permiso('cocina'))
  WITH CHECK (tiene_permiso('cocina'));

-- ── cocina_lotes_produccion (solo INSERT anon, ALL cocina) ───────────────────
DROP POLICY IF EXISTS clp_select ON public.cocina_lotes_produccion;
DROP POLICY IF EXISTS clp_insert ON public.cocina_lotes_produccion;
DROP POLICY IF EXISTS clp_update ON public.cocina_lotes_produccion;
DROP POLICY IF EXISTS clp_delete ON public.cocina_lotes_produccion;

CREATE POLICY cocina_lotes_produccion_anon_insert ON public.cocina_lotes_produccion
  FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY cocina_lotes_produccion_cocina_all ON public.cocina_lotes_produccion
  FOR ALL TO authenticated
  USING (tiene_permiso('cocina'))
  WITH CHECK (tiene_permiso('cocina'));

-- ── cocina_traspasos (solo auth cocina) ──────────────────────────────────────
DROP POLICY IF EXISTS cocina_traspasos_anon ON public.cocina_traspasos;
DROP POLICY IF EXISTS cocina_traspasos_auth ON public.cocina_traspasos;

CREATE POLICY cocina_traspasos_cocina_all ON public.cocina_traspasos
  FOR ALL TO authenticated
  USING (tiene_permiso('cocina'))
  WITH CHECK (tiene_permiso('cocina'));

-- ── cocina_merma (solo auth cocina) ──────────────────────────────────────────
DROP POLICY IF EXISTS cocina_merma_anon ON public.cocina_merma;
DROP POLICY IF EXISTS cocina_merma_auth ON public.cocina_merma;

CREATE POLICY cocina_merma_cocina_all ON public.cocina_merma
  FOR ALL TO authenticated
  USING (tiene_permiso('cocina'))
  WITH CHECK (tiene_permiso('cocina'));

-- ── fichadas: cerrar authenticated `true/true` (la PWA /fichar es anon, ok) ──
DROP POLICY IF EXISTS fichadas_authenticated ON public.fichadas;
-- Las policies fichadas_rrhh_select/update/delete y fichadas_anon_insert/select
-- ya cubren todos los casos. No hace falta agregar nada más.

-- ── movimientos_stock: deduplicar anon INSERT ────────────────────────────────
-- Hay dos policies casi idénticas (mov_stock_anon_insert y movimientos_stock_anon_insert)
-- y una ALL true/true (movimientos_stock_anon). Se deja sólo una INSERT anon.
DROP POLICY IF EXISTS movimientos_stock_anon ON public.movimientos_stock;
DROP POLICY IF EXISTS movimientos_stock_anon_insert ON public.movimientos_stock;
-- mov_stock_anon_insert (INSERT anon con WITH CHECK true) se conserva.

-- ── productos: deduplicar policies anon ──────────────────────────────────────
-- Policies actuales: productos_anon ALL true/true, productos_anon_select, productos_anon_update.
-- Se deja sólo SELECT y UPDATE (lo que requieren /deposito y /recepcion).
DROP POLICY IF EXISTS productos_anon ON public.productos;

-- ── recepciones_pendientes: deduplicar ──────────────────────────────────────
DROP POLICY IF EXISTS recepciones_pendientes_anon ON public.recepciones_pendientes;
DROP POLICY IF EXISTS recepciones_pendientes_anon_insert ON public.recepciones_pendientes;
DROP POLICY IF EXISTS recepciones_pendientes_anon_select ON public.recepciones_pendientes;
-- recepciones_anon_insert (INSERT anon) se conserva.

-- ── Views cocina_stock en modo SECURITY INVOKER (PG 15+) ─────────────────────
ALTER VIEW public.v_cocina_stock_pastas SET (security_invoker = true);
ALTER VIEW public.cocina_stock_actual SET (security_invoker = true);

-- ── Fijar search_path en funciones mutables del advisor ─────────────────────
ALTER FUNCTION public.edr_resumen_ventas(text, text) SET search_path = public;
ALTER FUNCTION public.edr_resumen_gastos(text, text) SET search_path = public;
ALTER FUNCTION public.amort_resumen_anual(text, text) SET search_path = public;
ALTER FUNCTION public.fusionar_producto(uuid, uuid) SET search_path = public;
ALTER FUNCTION public.migrar_ambos_a_locales() SET search_path = public;
