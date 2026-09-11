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
