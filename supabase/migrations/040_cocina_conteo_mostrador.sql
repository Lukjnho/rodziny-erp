-- 040_cocina_conteo_mostrador.sql
-- Conteo físico de pastas en el freezer del mostrador al cierre del servicio.
-- Sirve para auditar la diferencia entre el stock calculado por el sistema
-- (traspasos_hoy − ventas_fudo_hoy − merma_hoy) y lo que el chef cuenta
-- realmente al apagar el local. Cargado desde el QR de Cocina.

CREATE TABLE IF NOT EXISTS cocina_conteo_mostrador (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha date NOT NULL DEFAULT current_date,
  producto_id uuid NOT NULL REFERENCES cocina_productos(id) ON DELETE CASCADE,
  local text NOT NULL CHECK (local IN ('vedia', 'saavedra')),
  porciones_real integer NOT NULL CHECK (porciones_real >= 0),
  -- Snapshot de lo que el sistema creía que había al momento del conteo
  -- (traspasado_hoy − merma_hoy). Se guarda para tener histórico aunque
  -- después se sumen traspasos retroactivos.
  traspasado_hoy integer,
  merma_hoy integer,
  responsable text,
  notas text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cocina_conteo_mostrador_fecha_local_idx
  ON cocina_conteo_mostrador (fecha, local);

ALTER TABLE cocina_conteo_mostrador ENABLE ROW LEVEL SECURITY;

-- El QR es público (PWA por QR sin login), por eso permitimos INSERT a anon
-- como las otras tablas que se cargan desde el QR (cocina_lotes_pasta, etc.).
DROP POLICY IF EXISTS cocina_conteo_anon_insert ON cocina_conteo_mostrador;
CREATE POLICY cocina_conteo_anon_insert ON cocina_conteo_mostrador
  FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS cocina_conteo_authenticated_all ON cocina_conteo_mostrador;
CREATE POLICY cocina_conteo_authenticated_all ON cocina_conteo_mostrador
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
