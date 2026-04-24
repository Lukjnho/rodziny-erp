-- 027_mostrador_entrega_deposito.sql
-- Ajusta cocina_conteos_mostrador para replicar la planilla física de Vedia:
-- el control tiene 4 columnas editables (inicial, entrega, vendido, real) y
-- una columna calculada (merma).
--
-- Fórmula real:
--   merma = cantidad_inicial + entrega_deposito − cantidad_vendida − cantidad_real
--
-- El "inicial" lo carga el encargado contando físicamente pre-servicio (no se
-- infiere del sistema). "entrega_deposito" es lo que trajeron del depósito
-- durante el turno.

alter table cocina_conteos_mostrador
  add column if not exists entrega_deposito int not null default 0
    check (entrega_deposito >= 0);

comment on column cocina_conteos_mostrador.entrega_deposito is
  'Porciones que el depósito entregó al mostrador DURANTE el turno (no el stock inicial).';

-- Trigger actualizado para incluir entrega_deposito en el cálculo
CREATE OR REPLACE FUNCTION public.registrar_merma_conteo_mostrador()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_merma int;
BEGIN
  v_merma := NEW.cantidad_inicial + NEW.entrega_deposito - NEW.cantidad_vendida - NEW.cantidad_real;
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
