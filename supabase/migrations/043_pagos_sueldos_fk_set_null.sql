-- Cambia el FK pagos_sueldos.empleado_id de NO ACTION → SET NULL
-- Permite eliminar empleados sin perder el histórico de pagos:
-- la columna `empleado_nombre` (denormalizada) ya conserva el nombre como texto.

ALTER TABLE public.pagos_sueldos
  DROP CONSTRAINT IF EXISTS pagos_sueldos_empleado_id_fkey;

ALTER TABLE public.pagos_sueldos
  ADD CONSTRAINT pagos_sueldos_empleado_id_fkey
  FOREIGN KEY (empleado_id) REFERENCES public.empleados(id) ON DELETE SET NULL;
