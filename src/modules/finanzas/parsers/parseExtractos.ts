export interface MovimientoRaw {
  cuenta: 'mercadopago' | 'galicia' | 'icbc'
  fecha: string           // YYYY-MM-DD
  descripcion: string
  debito: number
  credito: number
  saldo: number | null
  referencia: string
  periodo: string         // '2026-02'
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function parseFechaAR(str: string): string {
  // DD/MM/YYYY o DD/MM/YY
  const m = str.trim().match(/(\d{2})\/(\d{2})\/(\d{2,4})/)
  if (!m) return ''
  const year = m[3].length === 2 ? `20${m[3]}` : m[3]
  return `${year}-${m[2]}-${m[1]}`
}

function parseNum(str: string): number {
  if (!str) return 0
  // Formato argentino: puntos de miles, coma decimal → normalizar
  const clean = str.replace(/\./g, '').replace(',', '.').replace(/[^0-9.\-]/g, '')
  return parseFloat(clean) || 0
}

function periodoFromFecha(fecha: string): string {
  return fecha.substring(0, 7)
}

// ─── MercadoPago ──────────────────────────────────────────────────────────────
// Formato legacy (separador ;):
//   DATE;SOURCE_ID;DESCRIPTION;NET_CREDIT_AMOUNT;NET_DEBIT_AMOUNT;...
// Formato nuevo (separador ,):
//   EXTERNAL_REFERENCE,PAYMENT_METHOD_TYPE,PAYMENT_METHOD,TRANSACTION_TYPE,
//   TRANSACTION_AMOUNT,TRANSACTION_DATE,FEE_AMOUNT,SETTLEMENT_NET_AMOUNT,...

// Parser CSV que respeta comas dentro de comillas y JSON embebido
function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current.trim())
  return result
}

export function parseMercadoPago(csv: string, filename: string): MovimientoRaw[] {
  const lines = csv.split('\n').filter(Boolean)
  if (lines.length < 2) return []

  const header = lines[0].trim()

  // Detectar formato por headers
  if (header.startsWith('EXTERNAL_REFERENCE') || header.includes('TRANSACTION_AMOUNT')) {
    return parseMercadoPagoNuevo(lines)
  }
  return parseMercadoPagoLegacy(lines)
}

function parseMercadoPagoNuevo(lines: string[]): MovimientoRaw[] {
  const headers = parseCSVLine(lines[0])
  const colIdx = (name: string) => headers.indexOf(name)

  const iDate    = colIdx('TRANSACTION_DATE')
  const iAmount  = colIdx('TRANSACTION_AMOUNT')
  const iFee     = colIdx('FEE_AMOUNT')
  const iNet     = colIdx('SETTLEMENT_NET_AMOUNT')
  const iTxType  = colIdx('TRANSACTION_TYPE')
  const iMethod  = colIdx('PAYMENT_METHOD')
  const iMethodT = colIdx('PAYMENT_METHOD_TYPE')
  const iRef     = colIdx('EXTERNAL_REFERENCE')
  const iTaxes   = colIdx('TAXES_AMOUNT')
  const iPOS     = colIdx('POS_NAME')
  const iDetail  = colIdx('SALE_DETAIL')

  if (iDate < 0 || iAmount < 0) return []

  const result: MovimientoRaw[] = []

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i])
    if (cols.length < 5) continue

    const rawDate = cols[iDate] ?? ''
    const fecha = rawDate.substring(0, 10)
    if (!fecha || fecha.length < 10) continue

    const txType   = cols[iTxType] ?? ''
    const amount   = parseFloat(cols[iAmount] ?? '0') || 0
    const fee      = parseFloat(cols[iFee] ?? '0') || 0
    const net      = parseFloat(cols[iNet] ?? '0') || 0
    const taxes    = parseFloat(cols[iTaxes] ?? '0') || 0
    const method   = cols[iMethod] ?? ''
    const methodT  = cols[iMethodT] ?? ''
    const ref      = cols[iRef] ?? `mp_${i}`
    const pos      = cols[iPOS] ?? ''
    const detail   = cols[iDetail] ?? ''

    // Descripción legible
    const desc = detail || `${methodT} · ${method}` + (pos ? ` · ${pos}` : '')

    // SETTLEMENT = cobro (ingreso bruto, comisiones y retenciones van como débitos separados)
    // WITHDRAWAL/REFUND = egreso
    if (txType === 'SETTLEMENT') {
      result.push({
        cuenta: 'mercadopago',
        fecha,
        descripcion: desc,
        debito: 0,
        credito: amount,
        saldo: null,
        referencia: ref || `mp_${i}`,
        periodo: periodoFromFecha(fecha),
      })
      // Registrar comisiones como débito separado si hay fee
      if (fee < 0) {
        result.push({
          cuenta: 'mercadopago',
          fecha,
          descripcion: `Comisión MP: ${method}`,
          debito: Math.abs(fee),
          credito: 0,
          saldo: null,
          referencia: `mp_fee_${i}`,
          periodo: periodoFromFecha(fecha),
        })
      }
      // Registrar impuestos retenidos como débito separado
      if (taxes < 0) {
        result.push({
          cuenta: 'mercadopago',
          fecha,
          descripcion: `Retenciones MP: ${method}`,
          debito: Math.abs(taxes),
          credito: 0,
          saldo: null,
          referencia: `mp_tax_${i}`,
          periodo: periodoFromFecha(fecha),
        })
      }
    } else if (txType === 'WITHDRAWAL' || txType === 'REFUND' || txType === 'PAYOUT') {
      result.push({
        cuenta: 'mercadopago',
        fecha,
        descripcion: `${txType}: ${desc}`,
        debito: Math.abs(amount),
        credito: 0,
        saldo: null,
        referencia: ref || `mp_${i}`,
        periodo: periodoFromFecha(fecha),
      })
    }
  }

  return result
}

function parseMercadoPagoLegacy(lines: string[]): MovimientoRaw[] {
  const result: MovimientoRaw[] = []

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(';').map((c) => c.trim().replace(/^"|"$/g, ''))
    if (cols.length < 5) continue

    const rawDate = cols[0]
    const fecha = rawDate.substring(0, 10)
    if (!fecha || fecha.length < 10) continue

    const descripcion = cols[2] ?? ''
    const creditoRaw  = parseFloat(cols[3] ?? '0') || 0
    const debitoRaw   = parseFloat(cols[4] ?? '0') || 0
    const saldo       = parseFloat(cols[12] ?? '0') || null
    const referencia  = cols[1] ?? `mp_${i}`

    if (descripcion === 'reserve_for_payment') continue

    result.push({
      cuenta:      'mercadopago',
      fecha,
      descripcion,
      debito:      debitoRaw,
      credito:     creditoRaw,
      saldo,
      referencia,
      periodo:     periodoFromFecha(fecha),
    })
  }

  return result
}

// ─── ICBC ─────────────────────────────────────────────────────────────────────
// Primera fila = nombre de cuenta → saltear
// Segunda fila = headers
// Separador: ; | decimales: ,

export function parseICBC(csv: string, filename: string): MovimientoRaw[] {
  const lines = csv.split('\n').filter(Boolean)
  if (lines.length < 3) return []

  const result: MovimientoRaw[] = []

  // Línea 0 = "Movimientos de CC $ ..." → skip
  // Línea 1 = headers
  // Línea 2+ = datos
  for (let i = 2; i < lines.length; i++) {
    const cols = lines[i].split(';').map((c) => c.trim().replace(/^"|"$/g, ''))
    if (cols.length < 6) continue

    const fecha = parseFechaAR(cols[0])
    if (!fecha) continue

    const concepto  = cols[2] ?? ''
    const debitoStr = cols[3] ?? ''
    const creditoStr = cols[4] ?? ''
    const saldoStr  = cols[5] ?? ''
    const infoComp  = cols[6] ?? ''

    const debito  = debitoStr  ? Math.abs(parseNum(debitoStr))  : 0
    const credito = creditoStr ? Math.abs(parseNum(creditoStr)) : 0
    const saldo   = saldoStr   ? parseNum(saldoStr)             : null

    result.push({
      cuenta:      'icbc',
      fecha,
      descripcion: concepto,
      debito,
      credito,
      saldo,
      referencia:  infoComp || `icbc_${i}`,
      periodo:     periodoFromFecha(fecha),
    })
  }

  return result
}

// ─── Galicia ──────────────────────────────────────────────────────────────────
// Headers en línea 0:
// Fecha;Descripción;Origen;Débitos;Créditos;Grupo de Conceptos;Concepto;...;Saldo

export function parseGalicia(csv: string, filename: string): MovimientoRaw[] {
  const lines = csv.split('\n').filter(Boolean)
  if (lines.length < 2) return []

  const result: MovimientoRaw[] = []

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(';').map((c) => c.trim().replace(/^"|"$/g, ''))
    if (cols.length < 5) continue

    const fecha = parseFechaAR(cols[0])
    if (!fecha) continue

    const descripcion = cols[1] ?? ''
    const debitoStr   = cols[3] ?? ''
    const creditoStr  = cols[4] ?? ''
    const saldoStr    = cols[15] ?? cols[cols.length - 1] ?? ''
    const nroComp     = cols[9] ?? ''

    const debito  = debitoStr  ? parseNum(debitoStr)  : 0
    const credito = creditoStr ? parseNum(creditoStr) : 0
    // Saldo Galicia viene con + al frente: "+677024,22"
    const saldo   = saldoStr ? parseNum(saldoStr.replace('+', '')) : null

    const concepto = cols[6] ?? ''
    const leyenda1 = cols[10] ?? '' // Leyenda Adicional1: contiene "INVERTIRONLINE S.A.U.", nombre de origen, etc.
    const refUnica = (nroComp && nroComp !== '0') ? nroComp : `gal_${fecha}_${i}_${descripcion.substring(0, 20)}`

    // Descripción enriquecida: descripción + leyenda adicional (origen del movimiento)
    let descFinal = descripcion
    if (leyenda1 && leyenda1 !== '0') descFinal += ` · ${leyenda1}`

    result.push({
      cuenta:      'galicia',
      fecha,
      descripcion: descFinal,
      debito:      Math.abs(debito),
      credito:     Math.abs(credito),
      saldo,
      referencia:  refUnica,
      periodo:     periodoFromFecha(fecha),
    })
  }

  return result
}

// ─── Auto-detector ────────────────────────────────────────────────────────────
export function parseExtracto(content: string, filename: string): MovimientoRaw[] {
  const lower = filename.toLowerCase()
  const firstLine = content.split('\n')[0] ?? ''

  if (lower.includes('mp') || lower.includes('mercadopago') || firstLine.startsWith('DATE;') || firstLine.startsWith('EXTERNAL_REFERENCE'))
    return parseMercadoPago(content, filename)

  if (lower.includes('icbc') || firstLine.startsWith('Movimientos de CC'))
    return parseICBC(content, filename)

  if (lower.includes('galicia') || firstLine.includes('Descripción') || firstLine.includes('Descripcion'))
    return parseGalicia(content, filename)

  return []
}
