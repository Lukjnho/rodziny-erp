-- ICBC pone el concepto real en la REFERENCIA (ej: "907176 - IMP. DEB. LEY 25413",
-- "907172 - PERCEP. IVA", "907118 - INTERESES SOBRE SALDOS DEUDORES"), no en la
-- descripción (que es un código tipo "0001"). El etiquetador ahora matchea contra
-- descripción + referencia para Galicia/ICBC e incluye intereses. NO toca egresos
-- reales (TRANSF. AFIP, ECHEQ, PAGO VISA, DEB. AUTOM. DE SERV., PAGO DE SERVICIOS).
CREATE OR REPLACE FUNCTION aplicar_reglas_sugerencia()
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_etiquetados int;
BEGIN
  WITH base AS (
    SELECT id, cuenta, descripcion,
           (COALESCE(descripcion, '') || ' ' || COALESCE(referencia, '')) AS t
    FROM public.movimientos_bancarios
    WHERE sugerencia IS NULL AND debito > 0
      AND es_transferencia_interna IS NOT TRUE
  ),
  clasif AS (
    SELECT id, CASE
      -- ── MercadoPago (concepto en la descripción del parser) ──
      WHEN cuenta = 'mercadopago' AND (descripcion ILIKE 'Comisi_n MP%' OR descripcion ILIKE 'Comision MP%') THEN 'Comisión MP'
      WHEN cuenta = 'mercadopago' AND (descripcion ILIKE 'Retenciones MP%' OR descripcion ILIKE 'Retenci_n MP%' OR descripcion ILIKE 'Retenci_n sobre egreso%') THEN 'Retenciones MP'
      WHEN cuenta = 'mercadopago' AND descripcion ILIKE 'Tarifa retiro MP%' THEN 'Tarifa retiro MP'
      WHEN cuenta = 'mercadopago' AND descripcion ILIKE 'Cargo MP%' THEN 'Cargo MP'
      -- ── Galicia / ICBC (concepto en descripción O en referencia) ──
      WHEN cuenta IN ('galicia','icbc') AND t ILIKE '%PERCEP%IVA%' THEN 'Percepción IVA bancaria'
      WHEN cuenta IN ('galicia','icbc') AND (t ILIKE '%IMP. DEB. LEY 25413%' OR t ILIKE '%IMP. DEB. LEY 25.413%' OR t ILIKE '%IMP S/DEB CT%') THEN 'Impuesto al débito (Ley 25.413)'
      WHEN cuenta IN ('galicia','icbc') AND (t ILIKE '%IMP. CRE. LEY 25413%' OR t ILIKE '%IMP. CRE. LEY 25.413%') THEN 'Impuesto al crédito (Ley 25.413)'
      WHEN cuenta IN ('galicia','icbc') AND t ILIKE '%IVA RG 2408%' THEN 'IVA bancario (RG 2408)'
      WHEN cuenta IN ('galicia','icbc') AND (t ILIKE '%- IVA%' OR t ILIKE '% I V A%' OR t ILIKE '%IVA REDUCIDA%' OR descripcion = 'IVA' OR descripcion ILIKE 'IVA · %') THEN 'IVA bancario'
      WHEN cuenta IN ('galicia','icbc') AND t ILIKE '%INTERESES%' THEN 'Intereses bancarios'
      WHEN cuenta IN ('galicia','icbc') AND t ILIKE '%DEB LIQ INTER%' THEN 'Débito por liquidación interna'
      WHEN cuenta IN ('galicia','icbc') AND t ILIKE '%IMPUESTO DE SELLOS%' THEN 'Impuesto de sellos'
      WHEN cuenta IN ('galicia','icbc') AND t ILIKE '%COMISION SERVICIO DE CUENTA%' THEN 'Comisión servicio de cuenta'
      WHEN cuenta IN ('galicia','icbc') AND t ILIKE '%COM.PAQUETES%' THEN 'Comisión paquete bancario'
      WHEN cuenta IN ('galicia','icbc') AND t ILIKE '%COM.CANCELACION CHEQUE%' THEN 'Comisión cancelación cheque'
      WHEN cuenta IN ('galicia','icbc') AND (t ILIKE '%COMISION%' OR t ILIKE '%COMISIÓN%') THEN 'Comisión bancaria'
      ELSE NULL
    END AS sug
    FROM base
  ),
  upd AS (
    UPDATE public.movimientos_bancarios mb
    SET sugerencia = c.sug
    FROM clasif c
    WHERE mb.id = c.id AND c.sug IS NOT NULL
    RETURNING mb.id
  )
  SELECT count(*) INTO v_etiquetados FROM upd;

  RETURN jsonb_build_object('etiquetados', v_etiquetados);
END $$;