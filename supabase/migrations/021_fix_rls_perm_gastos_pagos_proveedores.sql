-- 021_fix_rls_perm_gastos_pagos_proveedores.sql
-- Al blindar con migration 017, las policies de pagos_gastos y proveedores
-- quedaron pidiendo tiene_permiso('compras'). Pero quien tiene permiso de
-- 'gastos' (ej. Tamara, auxiliar administrativa) también necesita poder:
--   - crear el pago asociado al gasto si lo marca como "Pagado"
--   - dar de alta un proveedor nuevo cuando no existe en la lista
-- Se amplían las policies para aceptar 'gastos' como alternativa a 'compras'.

DROP POLICY IF EXISTS "pagos_compras_all" ON pagos_gastos;
CREATE POLICY "pagos_gastos_o_compras_all"
  ON pagos_gastos FOR ALL TO authenticated
  USING (tiene_permiso('compras') OR tiene_permiso('gastos'))
  WITH CHECK (tiene_permiso('compras') OR tiene_permiso('gastos'));

DROP POLICY IF EXISTS "proveedores_compras_all" ON proveedores;
CREATE POLICY "proveedores_compras_o_gastos_all"
  ON proveedores FOR ALL TO authenticated
  USING (tiene_permiso('compras') OR tiene_permiso('gastos'))
  WITH CHECK (tiene_permiso('compras') OR tiene_permiso('gastos'));
