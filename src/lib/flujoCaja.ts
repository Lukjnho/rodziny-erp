// Reglas únicas del Flujo de Caja. Se comparten entre FlujoCaja (vista mensual),
// ProyeccionFlujo y la Conciliación para que las tres cuenten LO MISMO.
//
// El flujo de caja responde una sola pregunta: ¿cuánta plata entró y salió de
// verdad? No "cuánto debo" ni "cuánto gasté" (eso es el EdR). Por eso acá hay
// dos distinciones que el módulo no hacía y que inflaban los egresos:
//
//  1. EJECUTADO vs COMPROMETIDO. Un echeq al 23/07 o un consumo de tarjeta que
//     se debita con el resumen del 22/07 son COMPROMISOS: la plata todavía está
//     en la cuenta. Contarlos hoy como egreso hunde el saldo del mes en curso.
//
//  2. Un débito del extracto NO siempre es un egreso nuevo. Puede ser (a) plata
//     moviéndose entre cuentas propias, (b) la contrapartida bancaria de algo
//     que el ERP ya contó (un sueldo, un gasto, un dividendo). Sumarlo otra vez
//     es doble conteo. Antes solo se detectaba el caso de los gastos (gasto_id);
//     los sueldos por transferencia ("ACRED. HABERES") y las transferencias
//     entre cuentas propias se contaban dos veces.

// ── 1. Ejecutado vs comprometido ─────────────────────────────────────────────

// Un pago cuenta en el flujo el día que la plata SALE de la cuenta.
//
// Deliberadamente NO usamos el flag `programado`: nadie lo apaga cuando el
// cheque efectivamente se debita, así que un echeq de junio ya cobrado seguiría
// marcado como programado para siempre y desaparecería del flujo. La fecha de
// pago es el dato que no miente: si ya pasó, la plata salió.
export function esPagoEjecutado(fechaPago: string, hoy: string): boolean {
  return fechaPago <= hoy;
}

// Comprometido = plata que ya tiene fecha y destinatario pero todavía no salió.
// Se muestra aparte y se resta de la liquidez disponible, nunca del saldo del mes.
export function esPagoComprometido(fechaPago: string, hoy: string): boolean {
  return fechaPago > hoy;
}

// ── 2. Clasificación de débitos bancarios ────────────────────────────────────

export type ClaseDebito =
  | 'interna' // plata entre cuentas propias — no es egreso
  | 'ya_registrado' // contrapartida de un gasto/sueldo/dividendo ya contado
  | 'costo_bancario' // comisión, impuesto al débito, interés — egreso real
  | 'sin_registrar'; // egreso real que el ERP no conoce → hay que cargarlo

// Sueldos pagados por transferencia. Galicia los debita como un único
// "SERVICIO ACREDITAMIENTO DE HABERES" que ya está contado en pagos_sueldos.
// pagos_sueldos no tiene gasto_id, así que el filtro por gasto_id nunca los
// atrapaba: eran doble conteo garantizado (~$10,5M solo en junio).
const PATRONES_HABERES = [/acreditamiento\s+de\s+haberes/i, /acred\.?\s*haberes/i];

// Pago del resumen de la tarjeta. Los consumos individuales ya se cargan como
// gastos con medio_pago 'tarjeta_icbc'; pagar el resumen no es un egreso nuevo,
// es cancelar lo que ya contamos.
const PATRONES_PAGO_TARJETA = [/pago\s+visa/i, /pago\s+tarjeta/i, /pago\s+mastercard/i];

// Movimientos entre cuentas propias (Galicia ↔ MP ↔ ICBC). No son egresos:
// la plata sigue siendo de la empresa, solo cambió de bolsillo.
const PATRONES_INTERNA = [
  /transf\.?\s*ctas?\s*propias?/i,
  /transferencia\s*de\s*cuenta\s*propia/i,
  /credito\s*inmediato/i,
  /credito\s*transferencia\s*coelsa/i,
];

// Costos financieros puros: no tienen (ni van a tener) un gasto cargado detrás.
const PATRONES_COSTO_BANCARIO = [
  /comisi[oó]n/i,
  /impuesto\s+al\s+d[eé]bito/i,
  /ley\s*25\.?413/i,
  /i\s*v\s*a\b/i,
  /inter[eé]s/i,
  /percepci[oó]n/i,
  /retenci[oó]n/i,
  /gasto\s+de\s+mantenimiento/i,
];

function matchea(descripcion: string | null, patrones: RegExp[]): boolean {
  const d = descripcion ?? '';
  return patrones.some((p) => p.test(d));
}

export interface DebitoClasificable {
  id: string;
  cuenta: string;
  descripcion: string | null;
  debito: number;
  tipo: string | null;
  gasto_id: string | null;
  es_transferencia_interna?: boolean | null;
  transferencia_par_id?: string | null;
}

// `movsYaContados` = ids de movimientos_bancarios referenciados desde
// pagos_gastos / pagos_sueldos / dividendos vía conciliado_movimiento_id.
// Esas 3 tablas ya tienen la columna; el flujo simplemente no la miraba.
export function clasificarDebito(
  m: DebitoClasificable,
  movsYaContados: ReadonlySet<string>,
): ClaseDebito {
  // Plata entre cuentas propias. La bandera de la DB manda sobre el texto.
  if (m.es_transferencia_interna || m.transferencia_par_id) return 'interna';
  if (matchea(m.descripcion, PATRONES_INTERNA)) return 'interna';

  // Ya lo contamos por el lado del ERP.
  if (m.gasto_id) return 'ya_registrado';
  if (movsYaContados.has(m.id)) return 'ya_registrado';
  if (matchea(m.descripcion, PATRONES_HABERES)) return 'ya_registrado';
  if (matchea(m.descripcion, PATRONES_PAGO_TARJETA)) return 'ya_registrado';

  // Costos financieros: los cargos de MP vienen tipados desde el sync.
  if (m.tipo === 'cargo_mp') return 'costo_bancario';
  if (matchea(m.descripcion, PATRONES_COSTO_BANCARIO)) return 'costo_bancario';

  // Salió plata y el ERP no sabe por qué. Se cuenta (es real) y se marca para
  // que alguien lo cargue o lo concilie.
  return 'sin_registrar';
}

// ── 3. Qué cobro de MercadoPago es una venta ─────────────────────────────────
//
// El sync trae TODO lo que entra a la cuenta MP y el Flujo lo llamaba "Ventas
// digitales". No todo lo que entra es una venta: en julio-2026, $22,4M (casi la
// mitad del "ingreso") eran plata propia moviéndose.
//
// La pista es el local. Un cobro del POS trae store_id/pos_id y se resuelve a
// vedia o saavedra; los que quedan en 'ambos' no pasaron por ninguna caja. Sus
// tickets promedio lo confirman: $194k–$283k contra los $16k–$40k de una venta
// real (el ticket promedio de Vedia es $17.779 y el de Saavedra $27.517).
//
// De esos cobros sin local (confirmado con Lucas, jul-2026):
//   · bank_transfer  → retiros de InvertirOnline (cuenta comitente) = capital
//   · account_money  → transferencias entre cuentas propias
// Ninguno de los dos es ingreso del negocio. Las tarjetas sí: nadie se hace una
// transferencia a sí mismo con tarjeta de crédito, así que un cobro con tarjeta
// sin local resuelto es una venta a la que le falta el store_id.
const MEDIOS_TARJETA = ['credit_card', 'debit_card', 'prepaid_card', 'digital_currency'];

export interface PagoMPClasificable {
  local: string;
  medio_pago: string;
}

export function esVentaMP(p: PagoMPClasificable): boolean {
  if (p.local === 'vedia' || p.local === 'saavedra') return true;
  return MEDIOS_TARJETA.includes(p.medio_pago);
}

// Para los que no son venta: distinguir capital (IOL) de transferencia propia.
// Ambos son no operativos, pero conviene verlos separados.
export function tipoIngresoMPNoVenta(p: PagoMPClasificable): 'capital' | 'transferencia_propia' {
  return p.medio_pago === 'bank_transfer' ? 'capital' : 'transferencia_propia';
}

// Etiquetas para la UI — que el usuario entienda por qué un débito no suma.
export const CLASE_DEBITO_LABEL: Record<ClaseDebito, string> = {
  interna: 'Entre cuentas propias (no es egreso)',
  ya_registrado: 'Ya registrado en el ERP (no se suma de nuevo)',
  costo_bancario: 'Costos bancarios y financieros',
  sin_registrar: 'Débitos sin registrar en el ERP',
};
