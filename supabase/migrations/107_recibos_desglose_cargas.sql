-- 107: Desglose real del recibo de sueldo.
-- El recibo del contador trae bruto + aportes del EMPLEADO (jubilación/OS/PAMI) + neto.
-- Lo extrae el OCR (ocr-contador-doc) y se guarda acá, junto al neto que ya teníamos.
-- Las contribuciones PATRONALES NO van acá: no figuran en el recibo (se pagan por F.931/VEP).

alter table recibos_sueldo
  add column if not exists bruto numeric,
  add column if not exists aporte_jubilacion numeric,
  add column if not exists aporte_obra_social numeric,
  add column if not exists aporte_pami numeric,
  add column if not exists total_aportes numeric;
