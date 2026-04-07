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
// Separador: ; | decimales: . | fecha ISO | columnas:
// DATE;SOURCE_ID;DESCRIPTION;NET_CREDIT_AMOUNT;NET_DEBIT_AMOUNT;GROSS_AMOUNT;MP_FEE_AMOUNT;TAXES_AMOUNT;PAYMENT_METHOD;...

export function parseMercadoPago(csv: string, filename: string): MovimientoRaw[] {
  const lines = csv.split('\n').filter(Boolean)
  if (lines.length < 2) return []

  const result: MovimientoRaw[] = []

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(';').map((c) => c.trim().replace(/^"|"$/g, ''))
    if (cols.length < 5) continue

    const rawDate = cols[0] // ISO 8601 con timezone
    const fecha = rawDate.substring(0, 10) // YYYY-MM-DD
    if (!fecha || fecha.length < 10) continue

    const descripcion = cols[2] ?? ''
    const creditoRaw  = parseFloat(cols[3] ?? '0') || 0
    const debitoRaw   = parseFloat(cols[4] ?? '0') || 0
    const saldo       = parseFloat(cols[12] ?? '0') || null
    const referencia  = cols[1] ?? `mp_${i}`

    // Solo movimientos reales (ignorar reserve_for_payment duplicados)
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

    result.push({
      cuenta:      'galicia',
      fecha,
      descripcion,
      debito:      Math.abs(debito),
      credito:     Math.abs(credito),
      saldo,
      referencia:  nroComp || `gal_${i}`,
      periodo:     periodoFromFecha(fecha),
    })
  }

  return result
}

// ─── Auto-detector ────────────────────────────────────────────────────────────
export function parseExtracto(content: string, filename: string): MovimientoRaw[] {
  const lower = filename.toLowerCase()
  const firstLine = content.split('\n')[0] ?? ''

  if (lower.includes('mp') || lower.includes('mercadopago') || firstLine.startsWith('DATE;'))
    return parseMercadoPago(content, filename)

  if (lower.includes('icbc') || firstLine.startsWith('Movimientos de CC'))
    return parseICBC(content, filename)

  if (lower.includes('galicia') || firstLine.includes('Descripción') || firstLine.includes('Descripcion'))
    return parseGalicia(content, filename)

  return []
}
