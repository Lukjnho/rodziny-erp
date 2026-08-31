-- ============================================================================
-- 143 — Permiso del módulo Caja (el POS propio)
-- ============================================================================
-- La caja la usa el cajero, que no tiene por qué ver finanzas ni compras. Por
-- eso es un módulo propio y no una pestaña colgada de otro.
-- Arranca en false para todos: se habilita usuario por usuario desde Usuarios.
-- Los admin entran igual (tiene_permiso corta antes por es_admin).
-- ============================================================================

ALTER TABLE public.perfiles
  ADD COLUMN IF NOT EXISTS puede_ver_caja boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.perfiles.puede_ver_caja IS
  'Acceso al modulo Caja (POS propio): abrir turno, cobrar, cerrar turno.';

CREATE OR REPLACE FUNCTION public.tiene_permiso(modulo text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select case
    when auth.uid() is null then false
    when (select es_admin from perfiles where user_id = auth.uid()) then true
    else coalesce(
      (select case modulo
        when 'dashboard' then puede_ver_dashboard
        when 'ventas' then puede_ver_ventas
        when 'finanzas' then puede_ver_finanzas
        when 'edr' then puede_ver_edr
        when 'gastos' then puede_ver_gastos
        when 'amortizaciones' then puede_ver_amortizaciones
        when 'rrhh' then puede_ver_rrhh
        when 'compras' then puede_ver_compras
        when 'usuarios' then puede_ver_usuarios
        when 'cocina' then puede_ver_cocina
        when 'almacen' then puede_ver_almacen
        when 'integraciones' then puede_ver_integraciones
        when 'caja' then puede_ver_caja
        else false end
      from perfiles where user_id = auth.uid()), false)
  end;
$function$;
