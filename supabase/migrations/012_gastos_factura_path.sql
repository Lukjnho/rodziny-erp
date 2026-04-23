-- 012_gastos_factura_path.sql
-- Segundo adjunto en el gasto: comprobante fiscal del proveedor (Factura A / C / Remito / Ticket).
-- El campo comprobante_path existente queda para el comprobante de pago (transferencia MP / voucher).
-- Los dos archivos viven en el mismo bucket 'gastos-comprobantes', solo cambian los paths.

alter table gastos
  add column if not exists factura_path text;

notify pgrst, 'reload schema';
