-- 026_cocina_conteos_mostrador.sql
-- Control final de servicio — al cierre del turno el encargado del mostrador
-- cuenta físicamente cada pasta/salsa/postre y carga el número real.
-- El sistema genera la merma automática si hay diferencia con lo esperado.
--
-- Esto define el "punto de verdad" del stock del freezer mostrador: lo que
-- quedó físicamente contado, no un cálculo dinámico que puede divergir.

CREATE TABLE IF NOT EXISTS cocina_conteos_mostrador (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha date NOT NULL,
  turno text NOT NULL CHECK (turno IN ('mediodia', 'noche', 'unico')),
  local text NOT NULL CHECK (local IN ('vedia', 'saavedra')),
  producto_id uuid NOT NULL REFERENCES cocina_productos(id) ON DELETE CASCADE,
  cantidad_inicial int NOT NULL,
  cantidad_vendida int NOT NULL DEFAULT 0,
  cantidad_real int NOT NULL,
  motivo_merma text,
  responsable text,
  notas text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Un conteo por producto por turno por local
CREATE UNIQUE INDEX cocina_conteos_mostrador_unico_idx
  ON cocina_conteos_mostrador (fecha, turno, local, producto_id);

CREATE INDEX cocina_conteos_mostrador_fecha_local_idx
  ON cocina_conteos_mostrador (fecha DESC, local);

COMMENT ON TABLE cocina_conteos_mostrador IS
  'Conteo físico al cierre de cada turno en el mostrador. Baseline del stock real para el próximo turno.';

-- ── RLS: QR público del mostrador ───────────────────────────────────────────
ALTER TABLE cocina_conteos_mostrador ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cocina_conteos_mostrador_anon_select"
  ON cocina_conteos_mostrador FOR SELECT TO anon USING (true);

CREATE POLICY "cocina_conteos_mostrador_anon_insert"
  ON cocina_conteos_mostrador FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "cocina_conteos_mostrador_anon_update"
  ON cocina_conteos_mostrador FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "cocina_conteos_mostrador_cocina_all"
  ON cocina_conteos_mostrador FOR ALL TO authenticated
  USING (tiene_permiso('cocina')) WITH CHECK (tiene_permiso('cocina'));

-- ── Trigger: si hay merma (inicial - vendida - real > 0), registrarla en cocina_merma ──
CREATE OR REPLACE FUNCTION public.registrar_merma_conteo_mostrador()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_merma int;
BEGIN
  v_merma := NEW.cantidad_inicial - NEW.cantidad_vendida - NEW.cantidad_real;
  IF v_merma > 0 THEN
    INSERT INTO cocina_merma (
      producto_id, porciones, local, fecha, motivo, responsable, notas
    ) VALUES (
      NEW.producto_id,
      v_merma,
      NEW.local,
      NEW.fecha,
      'Cierre mostrador — turno ' || NEW.turno,
      NEW.responsable,
      coalesce(NEW.motivo_merma, NEW.notas)
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_merma_conteo_mostrador
  AFTER INSERT ON cocina_conteos_mostrador
  FOR EACH ROW EXECUTE FUNCTION public.registrar_merma_conteo_mostrador();

-- ── Habilitar anon SELECT en cocina_lotes_produccion (salsas/postres para stock) ──
CREATE POLICY "cocina_lotes_produccion_anon_select"
  ON cocina_lotes_produccion FOR SELECT TO anon USING (true);
