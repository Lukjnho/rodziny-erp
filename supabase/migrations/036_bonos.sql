-- 036_bonos.sql
-- Bonos eventuales sumados al sueldo: horas extra, bono extraordinario, premio,
-- reintegros, etc. Espejo positivo de "sanciones": misma estructura, signo opuesto.

CREATE TABLE IF NOT EXISTS bonos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empleado_id uuid NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
  periodo text NOT NULL,
  fecha date NOT NULL DEFAULT current_date,
  monto numeric NOT NULL CHECK (monto > 0),
  motivo text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bonos_empleado_periodo_idx
  ON bonos (empleado_id, periodo);

ALTER TABLE bonos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bonos_rrhh_all ON bonos;
CREATE POLICY bonos_rrhh_all ON bonos
  FOR ALL TO authenticated
  USING (tiene_permiso('rrhh'))
  WITH CHECK (tiene_permiso('rrhh'));

COMMENT ON TABLE bonos IS
  'Bonos eventuales que SE SUMAN al sueldo neto de la quincena: horas extra, premios, reintegros. Cargan sobre liquidaciones_quincenales via empleado_id+periodo.';
