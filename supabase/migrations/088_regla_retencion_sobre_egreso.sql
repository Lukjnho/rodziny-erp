-- Agrega el patrón "Retención sobre egreso ·" (retenciones MP aplicadas sobre
-- egresos/cargos directos) al etiquetador de cargos automáticos. Antes solo
-- matcheaba "Retención MP%" y estas quedaban sueltas en "Movimientos por procesar".
CREATE OR REPLACE FUNCTION aplicar_reglas_sugerencia()
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_etiquetados int;
BEGIN
  WITH upd AS (
    UPDATE public.movimientos_bancarios
    SET sugerencia = CASE
      -- ── Galicia / ICBC ──
      WHEN descripcion ILIKE 'IMP. DEB. LEY 25413%' THEN 'Impuesto al débito (Ley 25.413)'
      WHEN descripcion ILIKE 'IMP. CRE. LEY 25413%' THEN 'Impuesto al crédito (Ley 25.413)'
      WHEN descripcion ILIKE 'IMP S/DEB CT%' THEN 'Impuesto al débito (Ley 25.413)'
      WHEN descripcion = 'IVA RG 2408' THEN 'IVA bancario (RG 2408)'
      WHEN descripcion = 'I V A' OR descripcion = 'IVA REDUCIDA' THEN 'IVA bancario'
      WHEN descripcion ILIKE 'IVA · %' OR descripcion = 'IVA' THEN 'IVA bancario'
      WHEN descripcion ILIKE 'PERCEP. IVA%' THEN 'Percepción IVA bancaria'
      WHEN descripcion ILIKE 'COMISION SERVICIO DE CUENTA%' THEN 'Comisión servicio de cuenta'
      WHEN descripcion ILIKE 'COM.PAQUETES%' THEN 'Comisión paquete bancario'
      WHEN descripcion ILIKE 'DEB LIQ INTER%' THEN 'Débito por liquidación interna'
      WHEN descripcion ILIKE 'COM.CANCELACION CHEQUE%' THEN 'Comisión cancelación cheque'
      WHEN descripcion ILIKE 'COMISION%' THEN 'Comisión bancaria'
      WHEN descripcion ILIKE 'IMPUESTO DE SELLOS%' THEN 'Impuesto de sellos'
      -- ── MercadoPago (Reporte de Transacciones) ──
      WHEN descripcion ILIKE 'Comisi_n MP%' OR descripcion ILIKE 'Comision MP%' THEN 'Comisión MP'
      WHEN descripcion ILIKE 'Retenciones MP%' OR descripcion ILIKE 'Retenci_n MP%' THEN 'Retenciones MP'
      WHEN descripcion ILIKE 'Retenci_n sobre egreso%' THEN 'Retenciones MP'
      WHEN descripcion ILIKE 'Tarifa retiro MP%' THEN 'Tarifa retiro MP'
      WHEN descripcion ILIKE 'Cargo MP%' THEN 'Cargo MP'
      ELSE NULL
    END
    WHERE sugerencia IS NULL
      AND debito > 0
      AND (
        (cuenta IN ('galicia','icbc') AND (
          descripcion ILIKE 'IMP. DEB. LEY 25413%' OR
          descripcion ILIKE 'IMP. CRE. LEY 25413%' OR
          descripcion ILIKE 'IMP S/DEB CT%' OR
          descripcion = 'IVA RG 2408' OR
          descripcion = 'I V A' OR descripcion = 'IVA REDUCIDA' OR
          descripcion ILIKE 'IVA · %' OR descripcion = 'IVA' OR
          descripcion ILIKE 'PERCEP. IVA%' OR
          descripcion ILIKE 'COMISION SERVICIO DE CUENTA%' OR
          descripcion ILIKE 'COM.PAQUETES%' OR
          descripcion ILIKE 'DEB LIQ INTER%' OR
          descripcion ILIKE 'COM.CANCELACION CHEQUE%' OR
          descripcion ILIKE 'COMISION%' OR
          descripcion ILIKE 'IMPUESTO DE SELLOS%'
        ))
        OR
        (cuenta = 'mercadopago' AND (
          descripcion ILIKE 'Comisi_n MP%' OR
          descripcion ILIKE 'Comision MP%' OR
          descripcion ILIKE 'Retenciones MP%' OR
          descripcion ILIKE 'Retenci_n MP%' OR
          descripcion ILIKE 'Retenci_n sobre egreso%' OR
          descripcion ILIKE 'Tarifa retiro MP%' OR
          descripcion ILIKE 'Cargo MP%'
        ))
      )
    RETURNING id
  )
  SELECT count(*) INTO v_etiquetados FROM upd;

  RETURN jsonb_build_object('etiquetados', v_etiquetados);
END $$;
