-- Cargos bancarios en UNA sola línea por banco (no separados por tipo).
-- concepto_canonico_cargo ahora devuelve un único concepto "Gastos bancarios", así
-- crear_cargos_automaticos_bancarios consolida impuestos + IVA + percepciones +
-- comisiones + retenciones + sellos en un solo gasto por (mes, cuenta).
--
-- NOTA (data, una sola vez en prod): se desvincularon los movimientos de los cargos
-- consolidados previos (separados por tipo), se borraron esos gastos auto y se
-- re-corrió crear_cargos_automaticos_bancarios para regenerar 1 línea por banco/mes.
CREATE OR REPLACE FUNCTION concepto_canonico_cargo(p_texto text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 'Gastos bancarios'::text;
$$;
