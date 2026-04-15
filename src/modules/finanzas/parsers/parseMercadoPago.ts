// Parser del CSV de liquidaciones de MercadoPago.
// Formato real (feb 2026): headers en inglés, separador ';', fechas ISO con tz.
//
// Columnas:
//   DATE;SOURCE_ID;DESCRIPTION;NET_CREDIT_AMOUNT;NET_DEBIT_AMOUNT;GROSS_AMOUNT;
//   MP_FEE_AMOUNT;TAXES_AMOUNT;PAYMENT_METHOD;TRANSACTION_APPROVAL_DATE;
//   BUSINESS_UNIT;SUB_UNIT;BALANCE_AMOUNT
//
// DESCRIPTION: payment | refund | payout | asset_management | reserve_for_*
// Las filas reserve_for_* son reservas técnicas que se cancelan entre sí
// (crédito + débito simultáneo por el mismo monto) — las ignoramos.

export type TipoMovimientoMP = 'payment' | 'refund' | 'payout' | 'asset_management'

export interface MovimientoMP {
  sourceId: string
  fecha: string            // YYYY-MM-DD
  fechaHora: string        // ISO original
  tipo: TipoMovimientoMP
  netoCredito: number
  netoDebito: number
  bruto: number
  comision: number         // negativo (cargo MP)
  impuestos: number        // negativo (retenciones)
  medioPago: string
  fechaAprobacion: string | null  // cuándo se aprobó el pago original
  subUnit: string          // QR / Point / Checkouts / Wallet / ''
  saldoPosterior: number
}

export interface ResultadoParseoMP {
  saldoInicial: number
  saldoFinal: number
  movimientos: MovimientoMP[]
  descartados: number      // reserve_for_* filtrados
}

function toNumber(raw: string): number {
  if (!raw) return 0
  const n = Number(raw.replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

function isoAYmd(iso: string): string {
  // '2026-02-01T07:38:24.000-03:00' → '2026-02-01'
  return iso.slice(0, 10)
}

export function parseMercadoPagoCSV(texto: string): ResultadoParseoMP {
  const lineas = texto.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lineas.length < 2) {
    return { saldoInicial: 0, saldoFinal: 0, movimientos: [], descartados: 0 }
  }

  const header = lineas[0].split(';')
  const idx = (col: string) => header.findIndex((h) => h.trim().toUpperCase() === col)

  const iDate    = idx('DATE')
  const iSource  = idx('SOURCE_ID')
  const iDesc    = idx('DESCRIPTION')
  const iCred    = idx('NET_CREDIT_AMOUNT')
  const iDeb     = idx('NET_DEBIT_AMOUNT')
  const iGross   = idx('GROSS_AMOUNT')
  const iFee     = idx('MP_FEE_AMOUNT')
  const iTax     = idx('TAXES_AMOUNT')
  const iMethod  = idx('PAYMENT_METHOD')
  const iApprov  = idx('TRANSACTION_APPROVAL_DATE')
  const iSub     = idx('SUB_UNIT')
  const iBalance = idx('BALANCE_AMOUNT')

  let saldoInicial = 0
  let saldoFinal = 0
  const movimientos: MovimientoMP[] = []
  let descartados = 0

  for (let i = 1; i < lineas.length; i++) {
    const cols = lineas[i].split(';')
    const desc = (cols[iDesc] || '').trim()
    const sourceId = (cols[iSource] || '').trim()
    const balance = toNumber(cols[iBalance])

    // Fila inicial: sin SOURCE_ID ni descripción, solo BALANCE = saldo inicial.
    if (!sourceId && !desc) {
      saldoInicial = balance
      saldoFinal = balance
      continue
    }

    // Ruido: reservas técnicas que se cancelan entre sí.
    if (desc.startsWith('reserve_for_')) {
      descartados++
      continue
    }

    if (desc !== 'payment' && desc !== 'refund' && desc !== 'payout' && desc !== 'asset_management') {
      descartados++
      continue
    }

    const fechaHora = (cols[iDate] || '').trim()
    movimientos.push({
      sourceId,
      fecha: isoAYmd(fechaHora),
      fechaHora,
      tipo: desc as TipoMovimientoMP,
      netoCredito: toNumber(cols[iCred]),
      netoDebito: toNumber(cols[iDeb]),
      bruto: toNumber(cols[iGross]),
      comision: toNumber(cols[iFee]),
      impuestos: toNumber(cols[iTax]),
      medioPago: (cols[iMethod] || '').trim(),
      fechaAprobacion: (cols[iApprov] || '').trim() || null,
      subUnit: (cols[iSub] || '').trim(),
      saldoPosterior: balance,
    })

    saldoFinal = balance
  }

  return { saldoInicial, saldoFinal, movimientos, descartados }
}

// ── Agregados útiles para KPIs y la tabla ────────────────────────────────────

export interface KPIsMP {
  cobrosBrutos: number        // suma de GROSS_AMOUNT de payments
  cobrosNetos: number         // suma de NET_CREDIT_AMOUNT de payments
  comisiones: number          // abs(MP_FEE_AMOUNT) de payments (cargo MP)
  impuestos: number           // abs(TAXES_AMOUNT) de payments (retenciones)
  cantidadPayments: number
  refunds: number             // total devuelto
  payouts: number             // total transferido a banco / retirado
  rendimientos: number        // asset_management (fondo común)
  ticketPromedio: number
}

export function calcularKPIsMP(movs: MovimientoMP[]): KPIsMP {
  let cobrosBrutos = 0
  let cobrosNetos = 0
  let comisiones = 0
  let impuestos = 0
  let cantidadPayments = 0
  let refunds = 0
  let payouts = 0
  let rendimientos = 0

  for (const m of movs) {
    if (m.tipo === 'payment') {
      cobrosBrutos += m.bruto
      cobrosNetos += m.netoCredito
      comisiones += Math.abs(m.comision)
      impuestos += Math.abs(m.impuestos)
      cantidadPayments++
    } else if (m.tipo === 'refund') {
      refunds += m.netoDebito || Math.abs(m.bruto)
    } else if (m.tipo === 'payout') {
      payouts += m.netoDebito
    } else if (m.tipo === 'asset_management') {
      rendimientos += m.netoCredito
    }
  }

  const ticketPromedio = cantidadPayments > 0 ? cobrosBrutos / cantidadPayments : 0
  return { cobrosBrutos, cobrosNetos, comisiones, impuestos, cantidadPayments, refunds, payouts, rendimientos, ticketPromedio }
}
