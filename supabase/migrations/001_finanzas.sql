-- ============================================================
-- MÓDULO FINANZAS — Rodziny ERP
-- Ejecutar en: Supabase → SQL Editor
-- ============================================================

-- Tickets de ventas (importados desde Fudo XLS)
CREATE TABLE IF NOT EXISTS ventas_tickets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  local           TEXT NOT NULL CHECK (local IN ('vedia', 'saavedra')),
  fudo_id         TEXT NOT NULL,
  fecha           DATE NOT NULL,
  hora            TIME,
  caja            TEXT,
  estado          TEXT DEFAULT 'cerrada',
  tipo_venta      TEXT,           -- 'Mostrador' | 'Mesa'
  medio_pago      TEXT,
  total_bruto     NUMERIC(14,2) NOT NULL DEFAULT 0,  -- con descuentos ya aplicados
  total_neto      NUMERIC(14,2),  -- sin IVA (solo facturas)
  iva             NUMERIC(14,2) DEFAULT 0,
  es_fiscal       BOOLEAN DEFAULT FALSE,
  periodo         TEXT NOT NULL,  -- '2026-03'
  UNIQUE(local, fudo_id)
);

-- Items de ventas (hoja Productos de Fudo)
CREATE TABLE IF NOT EXISTS ventas_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  local           TEXT NOT NULL,
  periodo         TEXT NOT NULL,
  codigo          TEXT,
  categoria       TEXT,
  subcategoria    TEXT,
  nombre          TEXT NOT NULL,
  cantidad        NUMERIC(10,2) NOT NULL DEFAULT 0,
  total           NUMERIC(14,2) NOT NULL DEFAULT 0
);

-- Pagos por ticket (hoja Pagos de Fudo)
CREATE TABLE IF NOT EXISTS ventas_pagos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  local           TEXT NOT NULL,
  periodo         TEXT NOT NULL,
  fudo_ticket_id  TEXT NOT NULL,
  fecha           DATE,
  medio_pago      TEXT NOT NULL,
  monto           NUMERIC(14,2) NOT NULL,
  tipo_venta      TEXT,
  caja            TEXT
);

-- Movimientos bancarios (extractos MP, Galicia, ICBC)
CREATE TABLE IF NOT EXISTS movimientos_bancarios (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta          TEXT NOT NULL CHECK (cuenta IN ('mercadopago','galicia','icbc')),
  fecha           DATE NOT NULL,
  descripcion     TEXT,
  debito          NUMERIC(14,2) DEFAULT 0,
  credito         NUMERIC(14,2) DEFAULT 0,
  saldo           NUMERIC(14,2),
  categoria       TEXT DEFAULT 'sin_clasificar',
  local           TEXT DEFAULT 'general',
  es_dividendo    BOOLEAN DEFAULT FALSE,
  referencia      TEXT,           -- SOURCE_ID de MP, N° comprobante, etc.
  periodo         TEXT NOT NULL,  -- '2026-02'
  fuente          TEXT NOT NULL,  -- nombre del archivo importado
  UNIQUE(cuenta, fecha, referencia, debito, credito)
);

-- Gastos operativos (importados desde Fudo XLSX)
CREATE TABLE IF NOT EXISTS gastos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  local           TEXT NOT NULL CHECK (local IN ('vedia', 'saavedra')),
  fudo_id         TEXT NOT NULL,
  fecha           DATE NOT NULL,
  proveedor       TEXT,
  categoria       TEXT,
  subcategoria    TEXT,
  comentario      TEXT,
  estado_pago     TEXT,
  importe_total   NUMERIC(14,2) NOT NULL DEFAULT 0,
  importe_neto    NUMERIC(14,2),  -- sin IVA (de hoja Impuestos)
  iva             NUMERIC(14,2) DEFAULT 0,
  iibb            NUMERIC(14,2) DEFAULT 0,
  medio_pago      TEXT,
  tipo_comprobante TEXT,
  nro_comprobante TEXT,
  de_caja         BOOLEAN DEFAULT FALSE,
  cancelado       BOOLEAN DEFAULT FALSE,
  periodo         TEXT NOT NULL,
  UNIQUE(local, fudo_id)
);

-- Cierres de caja (entrada manual diaria)
CREATE TABLE IF NOT EXISTS cierres_caja (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  local           TEXT NOT NULL CHECK (local IN ('vedia', 'saavedra')),
  fecha           DATE NOT NULL,
  turno           TEXT DEFAULT 'unico',   -- 'manana' | 'tarde' | 'noche' | 'unico'
  caja            TEXT,
  monto_esperado  NUMERIC(14,2),          -- según Fudo
  monto_contado   NUMERIC(14,2) NOT NULL, -- conteo físico
  diferencia      NUMERIC(14,2) GENERATED ALWAYS AS (monto_contado - COALESCE(monto_esperado, monto_contado)) STORED,
  nota            TEXT,
  creado_por      TEXT DEFAULT 'Lucas',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(local, fecha, turno, caja)
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_tickets_local_periodo  ON ventas_tickets(local, periodo);
CREATE INDEX IF NOT EXISTS idx_tickets_fecha          ON ventas_tickets(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_items_local_periodo    ON ventas_items(local, periodo);
CREATE INDEX IF NOT EXISTS idx_pagos_local_periodo    ON ventas_pagos(local, periodo);
CREATE INDEX IF NOT EXISTS idx_movimientos_cuenta     ON movimientos_bancarios(cuenta, periodo);
CREATE INDEX IF NOT EXISTS idx_gastos_local_periodo   ON gastos(local, periodo);
CREATE INDEX IF NOT EXISTS idx_cierres_local_fecha    ON cierres_caja(local, fecha DESC);
