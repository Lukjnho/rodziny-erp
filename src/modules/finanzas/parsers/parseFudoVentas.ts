import * as XLSX from 'xlsx';
import { excelSerialToDate } from '@/lib/utils';

export interface TicketRow {
  fudo_id: string;
  fecha: string; // YYYY-MM-DD
  hora: string | null;
  caja: string;
  estado: string;
  tipo_venta: string;
  medio_pago: string;
  total_bruto: number;
  es_fiscal: boolean;
}

export interface TicketFiscalRow {
  fudo_id: string;
  total_neto: number; // sin IVA
  iva: number;
}

export interface ProductoRow {
  codigo: string;
  categoria: string;
  subcategoria: string;
  nombre: string;
  cantidad: number;
  total: number;
}

export interface PagoRow {
  fudo_ticket_id: string;
  fecha: string | null;
  medio_pago: string;
  monto: number;
  tipo_venta: string;
  caja: string;
}

export interface DescuentoResumen {
  cortesias_cant: number;
  cortesias_monto: number;
  otros_descuentos_monto: number;
}

export interface ParsedVentas {
  tickets: TicketRow[];
  fiscales: TicketFiscalRow[];
  productos: ProductoRow[];
  pagos: PagoRow[];
  descuentos: DescuentoResumen;
  periodo: string; // '2026-03'
  local: 'vedia' | 'saavedra';
}

// Parsea números que pueden venir como texto con formato español ("1.500,00") o como number
function parseNum(val: unknown): number {
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const s = String(val ?? '')
    .trim()
    .replace(/[^0-9,.-]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  return parseFloat(s) || 0;
}

function parseDate(val: unknown): string | null {
  if (!val) return null;
  if (typeof val === 'number') {
    const d = excelSerialToDate(val);
    return d.toISOString().split('T')[0];
  }
  // formato "31/03/26 23:13" o "31/03/2026"
  const str = String(val);
  const m = str.match(/(\d{2})\/(\d{2})\/(\d{2,4})/);
  if (!m) return null;
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${year}-${m[2]}-${m[1]}`;
}

function parseHora(val: unknown): string | null {
  if (!val) return null;
  const str = String(val);
  const m = str.match(/(\d{2}:\d{2})/);
  return m ? m[1] : null;
}

// Busca la fila de headers escaneando múltiples columnas (igual que parseFudoGastos)
function norm(s: unknown) {
  return String(s ?? '')
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function findHeaderRow(sheet: XLSX.WorkSheet): number {
  const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');
  const claves = new Set([
    'id',
    'fecha',
    'total',
    'estado',
    'fiscal',
    'caja',
    'venta',
    'medio',
    'nombre',
    'categoria',
    'subcategoria',
    'cantidad',
    'codigo',
    'monto',
    'cancelado',
    'cliente',
    'pago',
  ]);

  for (let r = 0; r <= Math.min(7, range.e.r); r++) {
    let coincidencias = 0;
    for (let c = 0; c <= Math.min(15, range.e.c); c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      const v = norm(cell?.v);
      // Busca match exacto o por primera palabra (ej: "total ($)" → "total")
      if (claves.has(v) || claves.has(v.split(' ')[0]) || claves.has(v.split('.')[0]))
        coincidencias++;
    }
    if (coincidencias >= 3) return r;
  }
  return 0; // fallback: si no encuentra, asumir que el header está en la fila 0
}

export function parseFudoVentas(buffer: ArrayBuffer, local: 'vedia' | 'saavedra'): ParsedVentas {
  const wb = XLSX.read(buffer, { type: 'array' });

  // ---------- Hoja Ventas ----------
  const wsVentas = wb.Sheets['Ventas'];
  const headerRow = findHeaderRow(wsVentas);
  const rawVentas = XLSX.utils.sheet_to_json<Record<string, unknown>>(wsVentas, {
    range: headerRow,
    defval: '',
  });

  const tickets: TicketRow[] = rawVentas
    .filter((r) => r['Id'] && r['Id'] !== 'Id')
    .map((r) => {
      const fechaVal = r['Fecha'];
      const cierreVal = r['Cerrada'];
      const fechaStr = parseDate(fechaVal) ?? parseDate(cierreVal) ?? '';
      const horaStr = parseHora(String(cierreVal ?? ''));
      return {
        fudo_id: String(r['Id']),
        fecha: fechaStr,
        hora: horaStr,
        caja: String(r['Caja'] ?? ''),
        estado: String(r['Estado'] ?? 'Cerrada'),
        tipo_venta: String(r['Tipo de Venta'] ?? ''),
        medio_pago: String(r['Medio de Pago'] ?? ''),
        total_bruto: parseNum(r['Total'] ?? 0),
        es_fiscal: (() => {
          const v = r['Fiscal'];
          if (typeof v === 'boolean') return v;
          const s = String(v ?? '')
            .toLowerCase()
            .trim();
          return s === 'sí' || s === 'si' || s === 'true' || s === '1';
        })(),
      };
    });

  // Detectar periodo desde primera fecha válida
  const primeraFecha = tickets.find((t) => t.fecha)?.fecha ?? '';
  const periodo = primeraFecha ? primeraFecha.substring(0, 7) : '';

  // ---------- Hoja Ventas Fiscales ----------
  const wsFiscales = wb.Sheets['Ventas Fiscales'];
  const rawFiscales = XLSX.utils.sheet_to_json<Record<string, unknown>>(wsFiscales, { defval: '' });

  const fiscales: TicketFiscalRow[] = rawFiscales
    .filter((r) => {
      const id = r['Id. Venta'] ?? r['Id# Venta'] ?? r['Id Venta'] ?? '';
      return id && id !== 'Id. Venta' && id !== 'Id# Venta';
    })
    .map((r) => {
      const id = r['Id. Venta'] ?? r['Id# Venta'] ?? r['Id Venta'] ?? '';
      return {
        fudo_id: String(id),
        total_neto: parseNum(r['Total sin impuestos'] ?? 0),
        iva: parseNum(r['Total IVA'] ?? r['IVA 21'] ?? 0),
      };
    });

  // ---------- Hoja Productos ----------
  const wsProductos = wb.Sheets['Productos'];
  const headerRowP = findHeaderRow(wsProductos);
  const rawProductos = XLSX.utils.sheet_to_json<Record<string, unknown>>(wsProductos, {
    range: headerRowP,
    defval: '',
  });

  const productos: ProductoRow[] = rawProductos
    .filter((r) => r['Nombre'] && r['Nombre'] !== 'Nombre')
    .map((r) => ({
      codigo: String(r['Código'] ?? r['Codigo'] ?? ''),
      categoria: String(r['Categoría'] ?? r['Categoria'] ?? ''),
      subcategoria: String(r['Subcategoría'] ?? r['Subcategoria'] ?? ''),
      nombre: String(r['Nombre']),
      cantidad: parseNum(r['Cantidad'] ?? 0),
      total: parseNum(r['Total ($)'] ?? r['Total'] ?? 0),
    }));

  // ---------- Hoja Pagos ----------
  const wsPagos = wb.Sheets['Pagos'];
  const headerRowPg = findHeaderRow(wsPagos);
  const rawPagos = XLSX.utils.sheet_to_json<Record<string, unknown>>(wsPagos, {
    range: headerRowPg,
    defval: '',
  });

  const pagos: PagoRow[] = rawPagos
    .filter((r) => {
      const id = r['Id. Venta'] ?? r['Id# Venta'] ?? r['Id Venta'] ?? '';
      return id && id !== 'Id. Venta' && id !== 'Id# Venta';
    })
    .map((r) => ({
      fudo_ticket_id: String(r['Id. Venta'] ?? r['Id# Venta'] ?? r['Id Venta'] ?? ''),
      fecha: parseDate(r['Fecha Pago']),
      medio_pago: String(r['Medio de Pago'] ?? ''),
      monto: parseNum(r['Monto'] ?? 0),
      tipo_venta: String(r['Tipo de Venta'] ?? ''),
      caja: String(r['Caja'] ?? ''),
    }));

  // ---------- Hoja Descuentos ----------
  let descuentos: DescuentoResumen = {
    cortesias_cant: 0,
    cortesias_monto: 0,
    otros_descuentos_monto: 0,
  };
  const wsDesc = wb.Sheets['Descuentos'];
  if (wsDesc) {
    const rawDesc = XLSX.utils.sheet_to_json<Record<string, unknown>>(wsDesc, { defval: '' });
    for (const r of rawDesc) {
      const cancelado = String(r['Cancelado'] ?? '').toLowerCase();
      if (cancelado === 'sí' || cancelado === 'si') continue;
      const valor = parseNum(r['Valor'] ?? 0);
      const porcentaje = parseNum(r['Porcentaje'] ?? 0);
      if (porcentaje === 100) {
        descuentos.cortesias_cant++;
        descuentos.cortesias_monto += valor;
      } else {
        descuentos.otros_descuentos_monto += valor;
      }
    }
  }

  return { tickets, fiscales, productos, pagos, descuentos, periodo, local };
}
