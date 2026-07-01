-- 122_drop_aprobaciones_gastos.sql
-- Elimina la función de "aprobación de gastos por umbral", que quedó sin uso.
-- El flujo nunca tuvo pantalla de aprobación: la columna solo se escribía y
-- nadie la leía. Se quita del form (ver NuevoGastoForm.tsx) y acá de la base.
--
-- Objetos que se eliminan:
--   - índice parcial idx_gastos_estado_aprobacion
--   - columna gastos.estado_aprobacion
--   - tabla config_aprobaciones (guardaba umbral_minimo / activo)

drop index if exists public.idx_gastos_estado_aprobacion;

alter table public.gastos drop column if exists estado_aprobacion;

drop table if exists public.config_aprobaciones;
