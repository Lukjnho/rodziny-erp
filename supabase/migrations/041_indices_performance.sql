-- 041_indices_performance.sql
-- Cubre las foreign keys sin índice detectadas por el linter de Supabase y
-- agrega un índice compuesto en ventas_tickets para las queries de Finanzas
-- que filtran por (local, fecha, medio_pago) — hoy demoran ~700-800 ms.

-- Ventas: queries del EdR / dividendos filtran por local + rango de fecha + medio_pago
CREATE INDEX IF NOT EXISTS idx_tickets_local_fecha_medio
  ON public.ventas_tickets (local, fecha, medio_pago);

-- Foreign keys sin índice — Cocina
CREATE INDEX IF NOT EXISTS idx_cocina_conteo_mostrador_producto
  ON public.cocina_conteo_mostrador (producto_id);
CREATE INDEX IF NOT EXISTS idx_cocina_conteos_mostrador_producto
  ON public.cocina_conteos_mostrador (producto_id);
CREATE INDEX IF NOT EXISTS idx_cocina_lotes_masa_receta
  ON public.cocina_lotes_masa (receta_id);
CREATE INDEX IF NOT EXISTS idx_cocina_lotes_pasta_lote_masa
  ON public.cocina_lotes_pasta (lote_masa_id);
CREATE INDEX IF NOT EXISTS idx_cocina_lotes_pasta_lote_relleno
  ON public.cocina_lotes_pasta (lote_relleno_id);
CREATE INDEX IF NOT EXISTS idx_cocina_lotes_pasta_producto
  ON public.cocina_lotes_pasta (producto_id);
CREATE INDEX IF NOT EXISTS idx_cocina_lotes_pasta_receta_masa
  ON public.cocina_lotes_pasta (receta_masa_id);
CREATE INDEX IF NOT EXISTS idx_cocina_lotes_pasta_sobrante_origen
  ON public.cocina_lotes_pasta (sobrante_origen_lote_id);
CREATE INDEX IF NOT EXISTS idx_cocina_lotes_produccion_receta
  ON public.cocina_lotes_produccion (receta_id);
CREATE INDEX IF NOT EXISTS idx_cocina_lotes_relleno_receta
  ON public.cocina_lotes_relleno (receta_id);
CREATE INDEX IF NOT EXISTS idx_cocina_merma_producto
  ON public.cocina_merma (producto_id);
CREATE INDEX IF NOT EXISTS idx_cocina_pizarron_items_publicado_por
  ON public.cocina_pizarron_items (publicado_por);
CREATE INDEX IF NOT EXISTS idx_cocina_pizarron_items_receta
  ON public.cocina_pizarron_items (receta_id);
CREATE INDEX IF NOT EXISTS idx_cocina_receta_ingredientes_producto
  ON public.cocina_receta_ingredientes (producto_id);
CREATE INDEX IF NOT EXISTS idx_cocina_receta_ingredientes_receta
  ON public.cocina_receta_ingredientes (receta_id);
CREATE INDEX IF NOT EXISTS idx_cocina_traspasos_producto
  ON public.cocina_traspasos (producto_id);

-- Foreign keys sin índice — Almacén
CREATE INDEX IF NOT EXISTS idx_almacen_pedidos_lote
  ON public.almacen_pedidos (lote_id);
CREATE INDEX IF NOT EXISTS idx_almacen_pedidos_producto
  ON public.almacen_pedidos (producto_id);

-- Foreign keys sin índice — Finanzas / Compras
CREATE INDEX IF NOT EXISTS idx_pagos_fijos_categoria_gasto
  ON public.pagos_fijos (categoria_gasto_id);
CREATE INDEX IF NOT EXISTS idx_pagos_fijos_gasto
  ON public.pagos_fijos (gasto_id);
CREATE INDEX IF NOT EXISTS idx_recepciones_pendientes_gasto
  ON public.recepciones_pendientes (gasto_id);
