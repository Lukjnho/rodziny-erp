// Escribir a la base y contar las filas que se tocaron. Una sola puerta.
//
// ══════════════════════════════════════════════════════════════════════════════
// 💣 QUÉ VENÍA PASANDO
// ══════════════════════════════════════════════════════════════════════════════
//
// Un UPDATE o un DELETE que la RLS bloquea devuelve **cero filas y NINGÚN
// error**. Compila, corre, no falla, y no hace nada. La pantalla invalida la
// consulta, se refresca y se ve igual que si hubiera guardado.
//
// Mordió tres veces, y las tres costaron plata o confianza:
//   · el candado de local que no se borraba;
//   · el sync de sueldos que pisaba el comprobante;
//   · el aviso entre ventanas de Caja que nunca llegaba.
//
// La regla quedó escrita en CLAUDE.md: toda escritura cuenta sus filas. Pero
// escrita a mano son cuatro renglones y **hay que acordarse del `.select()`**:
// sin él, PostgREST no devuelve nada y las otras tres líneas no sirven.
// Medido el 11-sep-2026: 186 escrituras en el repo, 25 contaban.
//
// ══════════════════════════════════════════════════════════════════════════════
// LA IDEA
// ══════════════════════════════════════════════════════════════════════════════
//
// 🔑 **El `.select()` lo pone esta función, no el que llama.** Por eso no se
// puede olvidar: si usás `guardarContando`, contás; si no la usás, aparecés en
// la lista de `npm run escrituras`.
//
//     await guardarContando(
//       supabase.from('cierres_caja').update(v).eq('id', id),
//       'No se pudo cerrar el turno',
//     );
//
// ══════════════════════════════════════════════════════════════════════════════
// ⚠️ QUÉ **NO** RESUELVE
// ══════════════════════════════════════════════════════════════════════════════
//
//   · Los INSERT. Un insert que la RLS bloquea **sí** devuelve error (42501):
//     no es el modo de falla silencioso y no necesita esto.
//   · Las escrituras que pasan por una función de la base (RPC). Ahí el conteo
//     va adentro de la función.
//   · Deshacer lo que ya se escribió. Si un flujo de tres pasos falla en el
//     tercero, esta función avisa — revertir los dos primeros es del que llama.
//     Ver `deshacerGastoDePagoFijo` en ChecklistPagos.

import { mensajeErrorAmigable } from './erroresSupabase';

/**
 * Un `update`, `delete` o `upsert` de supabase-js **antes** de pedirle las
 * filas de vuelta.
 *
 * Se describe por su forma y no con los tipos de supabase-js a propósito: así
 * entra cualquiera de los tres sin pelear con los genéricos, y el día que
 * cambie la librería este archivo no se entera.
 */
export interface EscrituraPendiente {
  select(columnas?: string): PromiseLike<{ data: unknown[] | null; error: unknown }>;
}

export interface OpcionesDeEscritura {
  /** Cuántas filas TIENEN que volver. Si vuelve otro número, tira. */
  filasEsperadas?: number;
  /**
   * Cero filas es un resultado válido acá ("borrá lo que haya, puede no haber
   * nada"). Hay que ponerlo a mano: el silencio no se acepta por descuido.
   */
  permitirCero?: boolean;
  /** Qué columnas pedir de vuelta. Por defecto todas. */
  columnas?: string;
}

/**
 * Escribe, cuenta las filas y devuelve cuántas fueron.
 *
 * @param escritura  el `.update()` / `.delete()` / `.upsert()` ya armado, SIN `.select()`
 * @param queSeEstabaHaciendo  en castellano y en primera persona del negocio:
 *                             "No se pudo cerrar el turno". Es lo que va a leer
 *                             quien esté en la tablet.
 */
export async function guardarContando(
  escritura: EscrituraPendiente,
  queSeEstabaHaciendo: string,
  opciones: OpcionesDeEscritura = {},
): Promise<number> {
  const { data, error } = await escritura.select(opciones.columnas ?? '*');

  if (error) throw new Error(mensajeErrorAmigable(error, queSeEstabaHaciendo));

  const filas = data?.length ?? 0;

  if (filas === 0 && !opciones.permitirCero) {
    throw new Error(
      `${queSeEstabaHaciendo}: no se guardó ninguna fila. ` +
        'Casi siempre es un permiso que falta, o que alguien más ya cambió ese registro. ' +
        'Actualizá la pantalla y fijate cómo quedó antes de volver a intentar.',
    );
  }

  if (opciones.filasEsperadas != null && filas !== opciones.filasEsperadas) {
    throw new Error(
      `${queSeEstabaHaciendo}: se tocaron ${filas} filas y esperaba ${opciones.filasEsperadas}. ` +
        'No se siguió adelante para no dejar los datos a medio escribir.',
    );
  }

  return filas;
}
