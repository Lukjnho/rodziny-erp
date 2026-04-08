import * as XLSX from 'xlsx'

// Busca la hoja por múltiples nombres posibles (case-insensitive, parcial)
function findSheet(wb: XLSX.WorkBook, ...candidates: string[]): XLSX.WorkSheet {
  for (const name of candidates) {
    if (wb.Sheets[name]) return wb.Sheets[name]
  }
  const lower = candidates.map((c) => c.toLowerCase())
  for (const name of wb.SheetNames) {
    if (lower.some((c) => name.toLowerCase().includes(c))) return wb.Sheets[name]
  }
  throw new Error(
    `No se encontró la hoja. Buscadas: [${candidates.join(', ')}]. ` +
    `Hojas en el archivo: [${wb.SheetNames.join(', ')}]`
  )
}

function parseNum(val: unknown): number {
  if (typeof val === 'number') return isNaN(val) ? 0 : val
  const s = String(val ?? '').trim().replace(/[^0-9,.-]/g, '').replace(/\./g, '').replace(',', '.')
  return parseFloat(s) || 0
}

export interface DetalleRow {
  gasto_id: string
  fecha: string           // YYYY-MM-DD
  cantidad: number
  unidad: string
  descripcion: string
  precio: number
  cancelado: boolean
}

export interface GastoRow {
  fudo_id: string
  fecha: string           // YYYY-MM-DD
  proveedor: string
  categoria: string
  subcategoria: string
  comentario: string
  estado_pago: string
  importe_total: number
  importe_neto: number | null   // null si no tiene fila en Impuestos
  iva: number
  iibb: number
  medio_pago: string
  tipo_comprobante: string
  nro_comprobante: string
  de_caja: boolean
  cancelado: boolean
}

function excelSerialToDate(serial: number): string {
  const d = new Date((serial - 25569) * 86400 * 1000)
  return d.toISOString().split('T')[0]
}

function parseDate(val: unknown): string {
  if (!val) return ''
  if (typeof val === 'number') return excelSerialToDate(val)
  const str = String(val)
  const m = str.match(/(\d{2})\/(\d{2})\/(\d{2,4})/)
  if (!m) return ''
  const year = m[3].length === 2 ? `20${m[3]}` : m[3]
  return `${year}-${m[2]}-${m[1]}`
}

function norm(s: unknown) {
  return String(s ?? '').toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function findHeaderRow(sheet: XLSX.WorkSheet): number {
  const range  = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1')
  const claves = new Set(['id', 'fecha', 'categoria', 'subcategoria', 'importe', 'proveedor', 'comentario', 'cancelado'])

  for (let r = 0; r <= Math.min(7, range.e.r); r++) {
    let coincidencias = 0
    for (let c = 0; c <= Math.min(15, range.e.c); c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })]
      if (claves.has(norm(cell?.v))) coincidencias++
    }
    if (coincidencias >= 3) return r   // fila con ≥3 columnas conocidas = header
  }
  return 3  // fallback
}

export function parseFudoGastos(
  buffer: ArrayBuffer,
  local: 'vedia' | 'saavedra'
): { gastos: GastoRow[]; detalle: DetalleRow[]; periodo: string; local: 'vedia' | 'saavedra' } {
  const wb = XLSX.read(buffer, { type: 'array' })

  // ---------- Hoja Gastos ----------
  const wsGastos = findSheet(wb, 'Gastos', 'Egresos', 'Gastos y Egresos', 'gastos')
  const headerRow = findHeaderRow(wsGastos)
  const rawGastos = XLSX.utils.sheet_to_json<Record<string, unknown>>(wsGastos, {
    range: headerRow,
    defval: '',
  })

  // ---------- Hoja Impuestos y percepciones ----------
  console.log('[gastos] Hojas en el archivo:', wb.SheetNames)
  let rawImp: Record<string, unknown>[] = []
  try {
    const wsImp = findSheet(wb, 'Impuestos y percepciones', 'Impuestos', 'Percepciones', 'impuestos')
    // Header detection específica para hoja Impuestos (columnas: Id# Gasto, IVA, Neto, etc.)
    const impClaves = new Set(['id', 'iva', 'neto', 'importe', 'gasto', 'brutos', 'percepciones', 'total'])
    const rangeImp = XLSX.utils.decode_range(wsImp['!ref'] ?? 'A1')
    let headerRowImp = 0
    for (let r = 0; r <= Math.min(7, rangeImp.e.r); r++) {
      let coincidencias = 0
      for (let c = 0; c <= Math.min(15, rangeImp.e.c); c++) {
        const cell = wsImp[XLSX.utils.encode_cell({ r, c })]
        const v = norm(cell?.v)
        // Buscar por palabra parcial (ej: "id# gasto" contiene "id" y "gasto")
        for (const clave of impClaves) {
          if (v.includes(clave)) { coincidencias++; break }
        }
      }
      if (coincidencias >= 2) { headerRowImp = r; break }
    }
    console.log('[gastos] Hoja Impuestos encontrada, header en fila:', headerRowImp)
    rawImp = XLSX.utils.sheet_to_json<Record<string, unknown>>(wsImp, { range: headerRowImp, defval: 0 })
    if (rawImp.length > 0) {
      console.log('[gastos] Columnas de Impuestos:', Object.keys(rawImp[0]))
      console.log('[gastos] Primera fila Impuestos:', rawImp[0])
    } else {
      console.log('[gastos] Hoja Impuestos vacía')
    }
  } catch (err) {
    console.warn('[gastos] No se encontró hoja de Impuestos:', err)
  }

  // Mapa id → datos impositivos
  const impMap = new Map<string, { neto: number; iva: number; iibb: number }>()
  for (const row of rawImp) {
    const idKey = String(
      row['Id# Gasto'] ?? row['Id # Gasto'] ?? row['Id. Gasto'] ?? row['Id Gasto'] ?? row['Id'] ?? ''
    )
    if (!idKey || idKey === 'Id# Gasto' || idKey === 'Id. Gasto' || idKey === 'Id') continue
    impMap.set(idKey, {
      neto: parseNum(row['Importe neto $'] ?? row['Importe neto'] ?? row['Neto'] ?? 0),
      iva:  parseNum(row['IVA $'] ?? row['IVA'] ?? row['IVA 21%'] ?? row['Total IVA'] ?? 0),
      iibb: parseNum(row['Ingresos Brutos $'] ?? row['Ingresos Brutos'] ?? row['IIBB'] ?? 0),
    })
  }
  console.log('[gastos] impMap size:', impMap.size, impMap.size > 0 ? '| primer entry:' : '', impMap.size > 0 ? [...impMap.entries()][0] : '')

  const gastos: GastoRow[] = rawGastos
    .filter((r) => r['Id'] && r['Id'] !== 'Id')
    .map((r) => {
      const id = String(r['Id'])
      const imp = impMap.get(id)
      const importeTotal = parseNum(r['Importe'] ?? r['Total'] ?? 0)
      // "Importe SIN IVA" — columna directa en el export de Fudo (primera opción igual que el script)
      const importeSinIva = parseNum(r['Importe SIN IVA'] ?? r['Importe sin IVA'] ?? r['Importe neto'] ?? 0)
      return {
        fudo_id:          id,
        fecha:            parseDate(r['Fecha']),
        proveedor:        String(r['Proveedor'] ?? ''),
        categoria:        String(r['Categoría'] ?? r['Categoria'] ?? ''),
        subcategoria:     String(r['Subcategoría'] ?? r['Subcategoria'] ?? ''),
        comentario:       String(r['Comentario'] ?? ''),
        estado_pago:      String(r['Estado del pago'] ?? ''),
        importe_total:    importeTotal,
        // Prioridad: columna SIN IVA directa > hoja Impuestos > null
        importe_neto:     importeSinIva > 0 && Math.abs(importeSinIva - importeTotal) > 1
                            ? importeSinIva
                            : imp ? imp.neto : null,
        iva:              importeSinIva > 0 && Math.abs(importeSinIva - importeTotal) > 1
                            ? importeTotal - importeSinIva
                            : imp ? imp.iva : 0,
        iibb:             imp ? imp.iibb : 0,
        medio_pago:       String(r['Medio de pago'] ?? ''),
        tipo_comprobante: String(r['Tipo de comprobante'] ?? ''),
        nro_comprobante:  String(r['N° de comprobante'] ?? r['Nro de comprobante'] ?? ''),
        de_caja:          String(r['De Caja'] ?? '').toLowerCase() === 'sí' || String(r['De Caja'] ?? '').toLowerCase() === 'si',
        cancelado:        String(r['Cancelado'] ?? '').toLowerCase() === 'sí' || String(r['Cancelado'] ?? '').toLowerCase() === 'si',
      }
    })

  // ---------- Hoja Detalle ----------
  let detalle: DetalleRow[] = []
  try {
    const wsDetalle = findSheet(wb, 'Detalle', 'Detalle de gastos', 'Items')
    const detClaves = new Set(['id', 'gasto', 'fecha', 'cantidad', 'unidad', 'descripcion', 'precio'])
    const rangeDet = XLSX.utils.decode_range(wsDetalle['!ref'] ?? 'A1')
    let headerRowDet = 0
    for (let r = 0; r <= Math.min(7, rangeDet.e.r); r++) {
      let coincidencias = 0
      for (let c = 0; c <= Math.min(15, rangeDet.e.c); c++) {
        const cell = wsDetalle[XLSX.utils.encode_cell({ r, c })]
        const v = norm(cell?.v)
        for (const clave of detClaves) {
          if (v.includes(clave)) { coincidencias++; break }
        }
      }
      if (coincidencias >= 3) { headerRowDet = r; break }
    }
    console.log('[gastos] Hoja Detalle encontrada, header en fila:', headerRowDet)
    const rawDetalle = XLSX.utils.sheet_to_json<Record<string, unknown>>(wsDetalle, { range: headerRowDet, defval: '' })

    detalle = rawDetalle
      .filter((r) => {
        const id = String(r['Id# Gasto'] ?? r['Id. Gasto'] ?? r['Id Gasto'] ?? '')
        return id && id !== 'Id# Gasto' && id !== 'Id. Gasto'
      })
      .filter((r) => {
        const canc = String(r['Cancelado'] ?? '').toLowerCase()
        return canc !== 'sí' && canc !== 'si'
      })
      .map((r) => ({
        gasto_id: String(r['Id# Gasto'] ?? r['Id. Gasto'] ?? r['Id Gasto'] ?? ''),
        fecha: parseDate(r['Fecha'] ?? ''),
        cantidad: parseNum(r['Cantidad'] ?? 0),
        unidad: String(r['Unidad'] ?? ''),
        descripcion: String(r['Descripción'] ?? r['Descripcion'] ?? r['Nombre'] ?? ''),
        precio: parseNum(r['Precio'] ?? r['Precio unitario'] ?? r['Precio $'] ?? 0),
        cancelado: false,
      }))

    console.log('[gastos] Detalle items parseados:', detalle.length)
  } catch (err) {
    console.warn('[gastos] No se encontró hoja de Detalle:', err)
  }

  const periodo = gastos.find((g) => g.fecha)?.fecha.substring(0, 7) ?? ''
  return { gastos, detalle, periodo, local }
}
