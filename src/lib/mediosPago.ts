// Medios de pago — lo que sabe el catálogo, en un solo lugar.
//
// 💣 Qué venía pasando: "la plata que entra por el POSnet personal de Lucas no es
// venta del negocio, es dividendo" estaba escrita como el texto literal
// 'mercadopago lucas' en SIETE lugares (tres acá en el front, cuatro en el
// importador de Fudo), más `codigo = 'mp_lucas'` en la función que cobra, más un
// `false` fijo en esa misma función que era el agujero: el POS propio grababa el
// ticket sin marcar, y el Estado de Resultados filtra por esa marca.
//
// Ahora el dato vive en `medios_pago.es_dividendo` (migración 205) y hay un
// disparador que lo copia solo a cada ticket y a cada cobro. El código no decide
// nada: pregunta.
//
// Acá quedan las dos cosas que el navegador SÍ necesita resolver antes de grabar,
// y que por eso no las puede hacer el disparador:
//   · cuánto de un ticket mixto hay que descontar del total, y
//   · qué cobros generan una fila en `dividendos`.
//
// Regla del proyecto: esto es nivel 1 (base). Lo puede importar cualquiera; no
// importa nada de arriba.

import { supabase } from '@/lib/supabase';

export interface MedioDividendo {
  id: string;
  codigo: string;
  /** El nombre canónico, tal como hay que escribirlo al grabar. */
  nombre: string;
  /** Cómo lo puede llegar a escribir Fudo o una carga a mano, en minúsculas. */
  alias: string[];
}

/**
 * Los medios de pago marcados como dividendo, con sus alias.
 *
 * Sale de `medios_pago` cruzado con `medios_pago_alias`, que es la misma tabla
 * que usa el disparador de la base para resolver el texto que manda Fudo. Por
 * eso el front y la base no se pueden desincronizar: leen lo mismo.
 *
 * Hoy es uno solo: "Mercado Pago Lucas", con los alias `mercadopago lucas`, `mp`
 * y `mp_lucas`. Sumar una variante es un renglón en la tabla, sin deploy.
 */
export async function mediosDeDividendo(): Promise<MedioDividendo[]> {
  const { data, error } = await supabase
    .from('medios_pago')
    .select('id, codigo, nombre, medios_pago_alias(alias)')
    .eq('es_dividendo', true);
  if (error) throw new Error(`No se pudo leer qué medios de pago son dividendo: ${error.message}`);
  return (data ?? []).map((m) => ({
    id: m.id as string,
    codigo: m.codigo as string,
    nombre: m.nombre as string,
    alias: ((m.medios_pago_alias ?? []) as { alias: string }[]).map((a) =>
      a.alias.toLowerCase().trim(),
    ),
  }));
}

/** Los alias (en minúsculas) de todos los medios de pago marcados como dividendo. */
export async function aliasDeDividendo(): Promise<Set<string>> {
  return new Set((await mediosDeDividendo()).flatMap((m) => m.alias));
}

/**
 * ¿Este cobro es plata del socio y no del negocio?
 *
 * Se compara contra el alias EXACTO (normalizado a minúsculas y sin espacios en
 * los bordes), igual que el disparador `trg_medio_pago_completar` de la base. El
 * código viejo hacía `.includes('mercadopago lucas')`, que además de ser más
 * frágil ante un renombre, no veía las otras dos variantes del catálogo.
 */
export function esCobroDeDividendo(
  medioPago: string | null | undefined,
  alias: Set<string>,
): boolean {
  return alias.has((medioPago ?? '').toLowerCase().trim());
}

// ─────────────────────────────────────────────────────────────────────────────
// EL MEDIO DE PAGO DE UN EGRESO
// ─────────────────────────────────────────────────────────────────────────────
//
// Esto vivía en `src/modules/gastos/types.ts`, o sea en nivel 4. Lo importaban
// `compras` (nivel 4, hermano), `finanzas` (5), `ventas` (5) y `rrhh` (3, que es
// importar para arriba). El medio de pago no es un concepto de Gastos: lo usan
// las compras, los sueldos, los aguinaldos, los pagos fijos y los dividendos.
// Bajó a nivel 1, al lado del resto del vocabulario de medios de pago.
//
// 💣 ESTOS SIETE VALORES SON SIETE FILAS DEL CATÁLOGO. Verificado contra
// `medios_pago_alias` el 11-sep-2026, los siete están y mapean así:
//
//     efectivo               → efectivo      / caja
//     transferencia_mp       → transferencia / mercadopago
//     transferencia_galicia  → transferencia / galicia
//     transferencia_icbc     → transferencia / icbc
//     cheque_galicia         → cheque        / galicia
//     tarjeta_icbc           → credito       / icbc
//     otro                   → sin_especificar
//
// O sea que el tipo de acá es un espejo de compilación de esos alias: junta el
// medio con la cuenta en una sola palabra, que es lo que la pantalla necesita
// elegir ("Transferencia (Galicia)", no "Transferencia" y después el banco).
// El disparador de la base (mig 138) hace la traducción de vuelta.
//
// ⏳ LO QUE FALTA para que el espejo desaparezca: que el desplegable arme sus
// opciones leyendo `medios_pago_alias` en vez de recorrer MEDIO_PAGO_LABEL. No
// se hizo todavía porque la etiqueta rica ("Transferencia (Galicia)") habría que
// componerla del `nombre` más la `cuenta`, y eso cambia texto que se ve en
// cinco pantallas. Mientras tanto, agregar un medio son DOS lugares: un renglón
// acá y un renglón en `medios_pago_alias`.

export type MedioPago =
  | 'efectivo'
  | 'transferencia_mp'
  | 'transferencia_galicia'
  | 'transferencia_icbc'
  | 'cheque_galicia'
  | 'tarjeta_icbc'
  | 'otro';

export const MEDIO_PAGO_LABEL: Record<MedioPago, string> = {
  efectivo: 'Efectivo',
  transferencia_mp: 'Transferencia (MercadoPago)',
  transferencia_galicia: 'Transferencia (Galicia)',
  transferencia_icbc: 'Transferencia (ICBC)',
  cheque_galicia: 'Cheque / ECHEQ (Galicia)',
  tarjeta_icbc: 'Tarjeta Visa (ICBC)',
  otro: 'Otro',
};

// Regla única de conciliación: TODO egreso bancarizado (transferencia, cheque,
// tarjeta, dividendo por transferencia, "otro") requiere comprobante de pago +
// N° de operación obligatorios, porque después se cruza contra el extracto.
// Exentos: efectivo (no genera comprobante) y cuenta corriente (todavía no es un
// pago bancario; el comprobante se exige cuando efectivamente se paga).
// Usar SIEMPRE este helper en vez de comparar contra 'efectivo' suelto, para que
// la regla sea idéntica en todas las vías de carga (gastos, pagos fijos, dividendos…).
// El OCR devuelve un medio genérico ("transferencia", "cheque", "qr"…) y el banco
// de origen por separado; el ERP en cambio necesita la opción concreta
// (transferencia_mp vs transferencia_galicia vs transferencia_icbc). Este mapeo
// junta las dos cosas. Devuelve null cuando no alcanza para decidir — en ese caso
// NO se toca lo que eligió el usuario, que es preferible a poner un banco al azar
// y que después no matchee contra el extracto en la conciliación.
export function mapearMedioPagoOcr(
  medioOcr: string | null | undefined,
  bancoOrigen: string | null | undefined,
): MedioPago | null {
  const m = (medioOcr ?? '').trim().toLowerCase();
  const banco = (bancoOrigen ?? '').trim().toLowerCase();

  if (m === 'efectivo') return 'efectivo';
  if (m === 'cheque') return 'cheque_galicia'; // los echeqs son todos del Galicia
  if (m.startsWith('tarjeta')) return 'tarjeta_icbc'; // única tarjeta de la empresa

  if (m === 'transferencia' || m === 'qr') {
    if (banco.includes('mercado') || banco.includes('mercadopago') || /\bmp\b/.test(banco))
      return 'transferencia_mp';
    if (banco.includes('galicia')) return 'transferencia_galicia';
    if (banco.includes('icbc')) return 'transferencia_icbc';
    // QR sin banco identificado: en la práctica siempre es MercadoPago.
    if (m === 'qr') return 'transferencia_mp';
  }
  return null;
}

export function medioRequiereComprobante(medio: string | null | undefined): boolean {
  if (!medio) return false;
  const m = medio.trim().toLowerCase();
  if (m === 'efectivo') return false;
  if (m.startsWith('cta') || m.includes('corriente')) return false; // cuenta corriente (texto libre)
  return true;
}
