-- 017_rls_blindar_datos_sensibles.sql
-- Cierra policies que hoy permiten acceso anónimo (público) o authenticated sin
-- chequeo de módulo a tablas sensibles: dividendos, pagos_mp, pagos_sueldos,
-- pagos_fijos, descuentos, configuracion, almacen_pedidos.

-- ── dividendos ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS dividendos_public_all ON public.dividendos;
DROP POLICY IF EXISTS dividendos_select ON public.dividendos;
DROP POLICY IF EXISTS dividendos_insert ON public.dividendos;
DROP POLICY IF EXISTS dividendos_update ON public.dividendos;
DROP POLICY IF EXISTS dividendos_delete ON public.dividendos;

CREATE POLICY dividendos_finanzas_all ON public.dividendos
  FOR ALL TO authenticated
  USING (tiene_permiso('finanzas'))
  WITH CHECK (tiene_permiso('finanzas'));

-- ── pagos_mp ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS pagos_mp_anon_all ON public.pagos_mp;

CREATE POLICY pagos_mp_finanzas_all ON public.pagos_mp
  FOR ALL TO authenticated
  USING (tiene_permiso('finanzas'))
  WITH CHECK (tiene_permiso('finanzas'));

-- ── pagos_sueldos (escritura RRHH, lectura también para finanzas) ───────────
DROP POLICY IF EXISTS pagos_sueldos_anon ON public.pagos_sueldos;

CREATE POLICY pagos_sueldos_rrhh_all ON public.pagos_sueldos
  FOR ALL TO authenticated
  USING (tiene_permiso('rrhh'))
  WITH CHECK (tiene_permiso('rrhh'));

CREATE POLICY pagos_sueldos_lectura_finanzas ON public.pagos_sueldos
  FOR SELECT TO authenticated
  USING (tiene_permiso('rrhh') OR tiene_permiso('finanzas'));

-- ── pagos_fijos (finanzas) ───────────────────────────────────────────────────
DROP POLICY IF EXISTS pagos_fijos_authenticated ON public.pagos_fijos;
DROP POLICY IF EXISTS pf_select ON public.pagos_fijos;
DROP POLICY IF EXISTS pf_insert ON public.pagos_fijos;
DROP POLICY IF EXISTS pf_update ON public.pagos_fijos;
DROP POLICY IF EXISTS pf_delete ON public.pagos_fijos;

CREATE POLICY pagos_fijos_finanzas_all ON public.pagos_fijos
  FOR ALL TO authenticated
  USING (tiene_permiso('finanzas'))
  WITH CHECK (tiene_permiso('finanzas'));

-- ── descuentos (RRHH: son descuentos/adelantos de sueldo) ────────────────────
DROP POLICY IF EXISTS descuentos_anon_all ON public.descuentos;
DROP POLICY IF EXISTS descuentos_auth_all ON public.descuentos;

CREATE POLICY descuentos_rrhh_all ON public.descuentos
  FOR ALL TO authenticated
  USING (tiene_permiso('rrhh'))
  WITH CHECK (tiene_permiso('rrhh'));

-- ── configuracion (lectura general para logueados, escritura solo admin) ────
DROP POLICY IF EXISTS cfg_select ON public.configuracion;
DROP POLICY IF EXISTS cfg_insert ON public.configuracion;
DROP POLICY IF EXISTS cfg_update ON public.configuracion;

CREATE POLICY configuracion_lectura_auth ON public.configuracion
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY configuracion_admin_write ON public.configuracion
  FOR ALL TO authenticated
  USING (es_admin_actual())
  WITH CHECK (es_admin_actual());

-- ── almacen_pedidos (módulo almacen) ─────────────────────────────────────────
DROP POLICY IF EXISTS almacen_pedidos_all ON public.almacen_pedidos;

CREATE POLICY almacen_pedidos_almacen_all ON public.almacen_pedidos
  FOR ALL TO authenticated
  USING (tiene_permiso('almacen'))
  WITH CHECK (tiene_permiso('almacen'));
