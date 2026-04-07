import * as XLSX from 'xlsx'

export interface ProductoStock {
  fudo_id: string
  categoria: string
  nombre: string
  disponibilidad: number
  unidad: string
  stock_minimo: number
  proveedor: string
  costo_unitario: number
  costo_total: number
}

function parseNum(val: unknown): number {
  if (typeof val === 'number') return isNaN(val) ? 0 : val
  const s = String(val ?? '').trim().replace(/[^0-9,.-]/g, '').replace(/\./g, '').replace(',', '.')
  return parseFloat(s) || 0
}

function norm(s: unknown) {
  return String(s ?? '').toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function findHeaderRow(sheet: XLSX.WorkSheet): number {
  const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1')
  const claves = new Set(['id', 'categoria', 'nombre', 'disponibilidad', 'stock', 'proveedor', 'costo', 'unidad'])
  for (let r = 0; r <= Math.min(5, range.e.r); r++) {
    let coincidencias = 0
    for (let c = 0; c <= Math.min(15, range.e.c); c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })]
      const v = norm(cell?.v)
      for (const clave of claves) {
        if (v.includes(clave)) { coincidencias++; break }
      }
    }
    if (coincidencias >= 3) return r
  }
  return 0
}

export function parseStockFudo(buffer: ArrayBuffer): ProductoStock[] {
  const wb = XLSX.read(buffer, { type: 'array' })

  // Buscar hoja: Ingredientes, Stock, Productos, etc.
  const candidatos = ['Ingredientes', 'Stock', 'Productos', 'Inventario']
  let ws: XLSX.WorkSheet | null = null
  for (const name of candidatos) {
    if (wb.Sheets[name]) { ws = wb.Sheets[name]; break }
  }
  if (!ws) {
    // Buscar parcial
    for (const name of wb.SheetNames) {
      const n = name.toLowerCase()
      if (candidatos.some((c) => n.includes(c.toLowerCase()))) { ws = wb.Sheets[name]; break }
    }
  }
  if (!ws) ws = wb.Sheets[wb.SheetNames[0]] // fallback: primera hoja

  const headerRow = findHeaderRow(ws)
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { range: headerRow, defval: '' })

  console.log('[stock] Hoja usada, headers:', raw.length > 0 ? Object.keys(raw[0]) : 'VACÍO')

  return raw
    .filter((r) => r['Nombre'] && r['Nombre'] !== 'Nombre')
    .map((r) => {
      // Unidad: puede estar en columna E o F
      const unidad = String(r['Unidad'] ?? r['Unidad_1'] ?? 'unid.').trim()
      return {
        fudo_id:        String(r['Id'] ?? r['Id.'] ?? ''),
        categoria:      String(r['Categoría'] ?? r['Categoria'] ?? ''),
        nombre:         String(r['Nombre'] ?? '').trim(),
        disponibilidad: parseNum(r['Disponibilidad'] ?? r['Stock'] ?? 0),
        unidad:         unidad || 'unid.',
        stock_minimo:   parseNum(r['Stock Mínimo'] ?? r['Stock Minimo'] ?? r['Stock mínimo'] ?? 0),
        proveedor:      String(r['Proveedor'] ?? '').trim(),
        costo_unitario: parseNum(r['Costo unitario'] ?? r['Precio unitario'] ?? 0),
        costo_total:    parseNum(r['Costo total'] ?? r['Total'] ?? 0),
      }
    })
    .filter((p) => p.nombre.length > 0)
}
