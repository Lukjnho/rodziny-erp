-- 099 — Redondear sueldo base a múltiplo de 2.000
-- Tras dividir por 1,10 (mig 098) los básicos quedaron con valores feos (ej. 772.727).
-- Redondea HACIA ARRIBA al múltiplo de 2.000 más cercano para que la base de la
-- quincena (mensual ÷ 2) caiga siempre en un múltiplo de 1.000 redondo, sin terminar
-- en 9/90 ni con centavos. Ej: 772.727 → 774.000 (quincena 387.000).
UPDATE empleados
SET sueldo_neto = CEIL(sueldo_neto / 2000.0) * 2000
WHERE sueldo_neto > 0;
