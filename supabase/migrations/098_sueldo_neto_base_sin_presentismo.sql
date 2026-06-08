-- 098 — Presentismo como beneficio (no como descuento)
-- Cambia la semántica de empleados.sueldo_neto:
--   ANTES: neto en mano CON presentismo incluido
--   AHORA: sueldo base SIN presentismo (el presentismo es un +10% que se suma al tildarse)
-- Para preservar el "en mano con presentismo" idéntico a hoy: base = neto / 1.10,
-- redondeado a pesos enteros (sin centavos).
UPDATE empleados
SET sueldo_neto = ROUND(sueldo_neto / 1.10)
WHERE sueldo_neto > 0;
