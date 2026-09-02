/**
 * Lo que convierte un ticket interno en un comprobante fiscal.
 *
 * Un ticket del POS y una factura son dos cosas distintas: el ticket se emite
 * siempre, al cobrar; la factura la autoriza ARCA y puede tardar. Cuando el
 * comprobante ya tiene CAE, estos datos se le suman al ticket y recién ahí el
 * papel vale como factura.
 *
 * Lo que la ley exige que salga impreso (RG 4291, RG 4892 y Ley 27.743):
 *   · datos del emisor: razón social, CUIT, domicilio, ingresos brutos e
 *     inicio de actividades;
 *   · la letra del comprobante y su código, el punto de venta y el número;
 *   · el IVA discriminado y la leyenda de transparencia fiscal;
 *   · el CAE con su vencimiento;
 *   · el código QR.
 */

export interface EmisorFiscal {
  razonSocial: string;
  cuit: string;
  domicilio: string | null;
  ingresosBrutos: string | null;
  inicioActividades: string | null;
}

export interface ReceptorFiscal {
  docTipo: number;
  docNro: string;
  nombre: string | null;
  condicionIva: number;
  domicilio: string | null;
}

export interface DatosFiscales {
  emisor: EmisorFiscal;
  receptor: ReceptorFiscal;
  tipoComprobante: number;
  puntoVenta: number;
  numero: number;
  /** fecha del comprobante en ISO (aaaa-mm-dd) */
  fecha: string;
  neto: number;
  iva: number;
  total: number;
  cae: string;
  caeVencimiento: string;
  /** en ensayo el comprobante no vale: hay que decirlo en el papel */
  ambiente: 'homologacion' | 'produccion';
}

/** Códigos de ARCA. Se validan contra FEParamGetTiposCbte antes de producción. */
export const TIPO_COMPROBANTE: Record<number, { nombre: string; letra: string }> = {
  1: { nombre: 'FACTURA', letra: 'A' },
  2: { nombre: 'NOTA DE DEBITO', letra: 'A' },
  3: { nombre: 'NOTA DE CREDITO', letra: 'A' },
  6: { nombre: 'FACTURA', letra: 'B' },
  7: { nombre: 'NOTA DE DEBITO', letra: 'B' },
  8: { nombre: 'NOTA DE CREDITO', letra: 'B' },
  11: { nombre: 'FACTURA', letra: 'C' },
  12: { nombre: 'NOTA DE DEBITO', letra: 'C' },
  13: { nombre: 'NOTA DE CREDITO', letra: 'C' },
};

export const CONDICION_IVA: Record<number, string> = {
  1: 'IVA Responsable Inscripto',
  4: 'IVA Sujeto Exento',
  5: 'Consumidor Final',
  6: 'Responsable Monotributo',
  7: 'Sujeto No Categorizado',
  8: 'Proveedor del Exterior',
  9: 'Cliente del Exterior',
  10: 'IVA Liberado - Ley 19.640',
  13: 'Monotributista Social',
  15: 'IVA No Alcanzado',
  16: 'Monotributo Trabajador Independiente Promovido',
};

export const DOC_TIPO: Record<number, string> = {
  80: 'CUIT',
  86: 'CUIL',
  96: 'DNI',
  99: 'Consumidor Final',
};

/** "0001-00000123" */
export function numeroFormateado(puntoVenta: number, numero: number): string {
  return `${String(puntoVenta).padStart(4, '0')}-${String(numero).padStart(8, '0')}`;
}

/** "2026-09-02" → "02/09/2026" */
export function fechaLarga(iso: string): string {
  const [a, m, d] = iso.split('-');
  return a && m && d ? `${d}/${m}/${a}` : iso;
}

/**
 * La URL que va adentro del QR, según la RG 4892.
 *
 * ⚠️ Emitiendo por web service el QR lo arma el emisor: ARCA no lo devuelve.
 * Es un JSON con los datos del comprobante, en Base64, colgado de la URL de
 * consulta. Quien lo escanea le está preguntando a ARCA si ese comprobante
 * existe de verdad — por eso los datos tienen que coincidir exactos con lo
 * declarado, o la consulta da "no encontrado".
 */
export function urlQrArca(d: DatosFiscales): string {
  const datos = {
    ver: 1,
    fecha: d.fecha,
    cuit: Number(d.emisor.cuit),
    ptoVta: d.puntoVenta,
    tipoCmp: d.tipoComprobante,
    nroCmp: d.numero,
    importe: Number(d.total.toFixed(2)),
    moneda: 'PES',
    ctz: 1,
    tipoDocRec: d.receptor.docTipo,
    nroDocRec: Number(d.receptor.docNro || '0'),
    tipoCodAut: 'E', // E = CAE (contra "A" = CAEA)
    codAut: Number(d.cae),
  };
  return `https://www.arca.gob.ar/fe/qr/?p=${base64Utf8(JSON.stringify(datos))}`;
}

/** btoa() solo maneja bytes: hay que pasar por UTF-8 primero o se rompe con acentos. */
function base64Utf8(texto: string): string {
  const bytes = new TextEncoder().encode(texto);
  let binario = '';
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario);
}

/**
 * Obligatoria en los comprobantes B desde el 1-abr-2025 (Ley 27.743 y
 * RG 5614/2024): el consumidor final tiene que ver cuánto de lo que paga es IVA.
 */
export const LEYENDA_TRANSPARENCIA =
  'Regimen de Transparencia Fiscal al Consumidor (Ley 27.743)';

/**
 * La misma leyenda, ya partida para el rollo de 80 mm.
 *
 * Entran 48 caracteres por renglón y la leyenda mide 58: si se manda entera, la
 * impresora la corta donde le toca y el sobrante aparece pegado a la izquierda,
 * arruinando el centrado. Partirla acá es la única forma de controlar dónde
 * corta.
 */
export const LEYENDA_TRANSPARENCIA_TERMICA = [
  'Regimen de Transparencia Fiscal',
  'al Consumidor (Ley 27.743)',
];

/** Cómo identificar al receptor en el papel. */
export function receptorImpreso(r: ReceptorFiscal): { linea1: string; linea2: string | null } {
  if (r.docTipo === 99) {
    return { linea1: 'A CONSUMIDOR FINAL', linea2: null };
  }
  return {
    linea1: r.nombre ?? 'Sin nombre',
    linea2: `${DOC_TIPO[r.docTipo] ?? 'Doc'} ${r.docNro}`,
  };
}
