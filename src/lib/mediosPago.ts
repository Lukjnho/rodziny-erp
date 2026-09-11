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

/**
 * Los alias (en minúsculas) de todos los medios de pago marcados como dividendo.
 *
 * Sale de `medios_pago_alias` cruzado con `medios_pago.es_dividendo`, que es la
 * misma tabla que usa el disparador de la base para resolver el texto que manda
 * Fudo. Por eso el front y la base no se pueden desincronizar: leen lo mismo.
 *
 * Hoy devuelve `mercadopago lucas`, `mp` y `mp_lucas`. Agregar una variante nueva
 * es un renglón en `medios_pago_alias`, sin deploy.
 */
export async function aliasDeDividendo(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('medios_pago_alias')
    .select('alias, medios_pago!inner(es_dividendo)')
    .eq('medios_pago.es_dividendo', true);
  if (error) throw new Error(`No se pudo leer qué medios de pago son dividendo: ${error.message}`);
  return new Set((data ?? []).map((r) => (r.alias as string).toLowerCase().trim()));
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
