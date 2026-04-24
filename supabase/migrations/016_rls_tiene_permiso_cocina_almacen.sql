-- 016_rls_tiene_permiso_cocina_almacen.sql
-- Agrega soporte para los módulos 'cocina' y 'almacen' en la función tiene_permiso(),
-- que mapea el texto del módulo a la columna puede_ver_* del perfil. Sin esto, las
-- policies de esas tablas no pueden chequear permisos y quedaban abiertas a todos los
-- usuarios autenticados.

CREATE OR REPLACE FUNCTION public.tiene_permiso(modulo text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
        else false end
      from perfiles where user_id = auth.uid()), false)
  end;
$$;
