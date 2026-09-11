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
 * Cómo se llama cada medio de pago, por su código del catálogo.
 *
 * 💣 OJO, no confundir con `MEDIO_PAGO_LABEL` de más abajo: **son dos
 * vocabularios distintos**. Éste va por el CÓDIGO de `medios_pago`
 * (`efectivo`, `qr`, `debito`, `credito`, `transferencia`, `mp_lucas`) y es el
 * que usan las tablas de configuración —`comision_mp_config`, por ejemplo—.
 * `MEDIO_PAGO_LABEL` va por la opción de EGRESO, que junta medio y banco en una
 * palabra (`transferencia_galicia`). Mismo tema, dos llaves; usar la que
 * corresponde a la tabla que se está mostrando.
 *
 * Sale del catálogo y no de una tabla escrita a mano, que es lo que había en
 * `ConfiguracionTab`: si mañana se agrega o se renombra un medio, la pantalla
 * se entera sola.
 */
export async function nombrePorCodigo(): Promise<Map<string, string>> {
  const { data, error } = await supabase.from('medios_pago').select('codigo, nombre');
  if (error) throw new Error(`No se pudo leer el catálogo de medios de pago: ${error.message}`);
  return new Map((data ?? []).map((m) => [m.codigo as string, m.nombre as string]));
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
// QUÉ CLASE DE MEDIO ES UNA FILA DE PLATA
// ─────────────────────────────────────────────────────────────────────────────
//
// Casi todas las tablas de plata guardan DOS cosas: `medio_pago`, que es el
// texto tal como quedó cargado, y `medio_pago_id`, la clave foránea al
// catálogo que completa el disparador de la migración 138.
//
// 💣 LO QUE VENÍA FALLANDO: comparar el TEXTO contra un literal. Medido el
// 11-sep-2026, esto es lo que hay realmente escrito en cada tabla:
//
//     pagos_sueldos   efectivo · transferencia
//     pagos_gastos    transferencia_mp · efectivo · cheque_galicia ·
//                     transferencia_galicia · otro · tarjeta_icbc
//     dividendos      Mercadopago Lucas · efectivo · mp · transferencia_mp ·
//                     cheque_galicia
//
// O sea que `medio_pago === 'transferencia'` es verdadero en sueldos y FALSO
// SIEMPRE en dividendos y en gastos, donde ninguna fila dice esa palabra sola.
// La misma línea de código significa una cosa en una pantalla y otra en la de
// al lado, según qué tabla le toque.
//
// La clave foránea no tiene ese problema: apunta a UNA fila del catálogo, y
// está puesta en el 100% de las filas de las cuatro tablas (verificado, no
// supuesto). Por eso la pregunta se le hace al catálogo.

/** Lo mínimo del catálogo para clasificar una fila. Es lo que trae SELECT_MEDIO. */
export interface MedioDelCatalogo {
  codigo: string;
  es_efectivo?: boolean | null;
}

/**
 * Lo que hay que sumarle al `.select()` para traer el catálogo por la clave
 * foránea `medio_pago_id`. Se escribe una vez acá para que ninguna pantalla
 * se olvide una columna y después clasifique mal en silencio.
 */
export const SELECT_MEDIO = 'medios_pago(codigo, es_efectivo)';

/** Lo que devuelve el embebido: una fila, o —si PostgREST no pudo probar que la
 *  relación es a uno— un arreglo de una. */
export type MedioEmbebido = MedioDelCatalogo | MedioDelCatalogo[] | null | undefined;

// 💣 Por qué esto existe: PostgREST devuelve el embebido como OBJETO cuando ve
// que la clave foránea apunta a una sola fila, y como ARREGLO cuando no lo puede
// probar (una vista, por ejemplo). Si llega el arreglo, `m.es_efectivo` es
// `undefined` y todo se clasifica como "no es efectivo" sin un solo error. Es
// exactamente la clase de falla silenciosa que este repo ya pagó cara.
function unaFila(m: MedioEmbebido): MedioDelCatalogo | null {
  if (!m) return null;
  return Array.isArray(m) ? (m[0] ?? null) : m;
}

/**
 * ¿Esta plata se movió en billetes?
 *
 * Sale de `medios_pago.es_efectivo`, que es una columna del catálogo desde la
 * migración 136. Hoy es `true` en una sola fila (`efectivo`), pero el día que
 * se agregue otra —una caja chica, un vale— las pantallas se enteran solas.
 */
export function esEfectivo(m: MedioEmbebido): boolean {
  return unaFila(m)?.es_efectivo === true;
}

/**
 * ¿Esta plata se movió por transferencia bancaria?
 *
 * Va por el CÓDIGO del catálogo, que es uno solo (`transferencia`) sin importar
 * el banco: `transferencia_mp`, `transferencia_galicia` y `transferencia_icbc`
 * son tres alias de la misma fila. Ese es justo el caso que rompía comparando
 * texto, porque ninguno de los tres es igual a la palabra "transferencia".
 */
export function esTransferencia(m: MedioEmbebido): boolean {
  return unaFila(m)?.codigo === 'transferencia';
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
