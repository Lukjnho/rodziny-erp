-- 022_fix_rls_gastos_storage_y_cierres_caja.sql
-- Continuación del fix 021. Dos problemas adicionales que Tamara (aux. admin
-- con permiso 'gastos' pero sin 'compras'/'finanzas') seguía chocando:
--
-- a) El bucket storage 'gastos-comprobantes' exigía 'compras' para INSERT/
--    DELETE y 'compras'/'finanzas' para SELECT. Al adjuntar un PDF al
--    crear un gasto, fallaba el upload → error "new row violates row-level
--    security policy". Ampliamos para aceptar 'gastos' también.
-- b) cierres_caja exigía 'finanzas' para todo. El cierre de caja es tarea
--    administrativa diaria que Tamara maneja junto con los gastos.

-- ── Storage bucket: gastos-comprobantes ─────────────────────────────────────
DROP POLICY IF EXISTS "gastos_comp_compras_insert" ON storage.objects;
CREATE POLICY "gastos_comp_gastos_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'gastos-comprobantes' AND (tiene_permiso('compras') OR tiene_permiso('gastos')));

DROP POLICY IF EXISTS "gastos_comp_compras_delete" ON storage.objects;
CREATE POLICY "gastos_comp_gastos_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'gastos-comprobantes' AND (tiene_permiso('compras') OR tiene_permiso('gastos')));

DROP POLICY IF EXISTS "gastos_comp_compras_select" ON storage.objects;
CREATE POLICY "gastos_comp_gastos_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'gastos-comprobantes' AND (tiene_permiso('compras') OR tiene_permiso('gastos') OR tiene_permiso('finanzas')));

-- ── cierres_caja: ampliar a 'gastos' ─────────────────────────────────────
DROP POLICY IF EXISTS "cierres_caja_all" ON cierres_caja;
CREATE POLICY "cierres_caja_finanzas_o_gastos_all"
  ON cierres_caja FOR ALL TO authenticated
  USING (tiene_permiso('finanzas') OR tiene_permiso('gastos'))
  WITH CHECK (tiene_permiso('finanzas') OR tiene_permiso('gastos'));
