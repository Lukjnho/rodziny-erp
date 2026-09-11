// El ticket promedio, en un solo lugar.
//
// 💣 Qué venía pasando: el promedio era `total / cantidad de tickets`, y adentro de
// esa cantidad entran los tickets VACÍOS — mesas que se abrieron y se cerraron sin
// una sola línea. En agosto-2026 fueron 97 de 5.788, y bajaban el promedio de
// $21.144 a $20.436: **$708 por ticket, un 3,5 %** que no es del negocio, es de
// mesas que nunca existieron. En julio fueron 115 y en septiembre 30.
//
// Un ticket en CERO no es lo mismo que un ticket vacío. Los otros 93 de agosto
// tienen renglones por $1.654.500 (cortesías, consumo del personal, pruebas): ahí
// sí hubo una mesa, hubo comida y hubo costo. Esos siguen contando.
//
// ⚠️ Solo se descarta lo que se puede PROBAR vacío. Antes de julio-2026,
// `ventas_items.ticket_id` está vacío en el 100 % de las filas (13.269 renglones en
// marzo, 13.804 en abril, ninguno atado a su ticket), así que en esos meses no hay
// forma de saber si una mesa tuvo o no renglones. En vez de adivinar, el promedio
// histórico queda EXACTAMENTE como estaba: cuando no se puede saber, no se excluye.
//
// Regla del proyecto: nivel 5 · ventas. Importa de `lib` y nada más.

export interface TicketDelPromedio {
  id: string;
  total_bruto: number | null;
}

export interface PromedioPorTicket {
  /** La plata por ticket, ya sin los vacíos. */
  promedio: number;
  /** Cuántos tickets entraron en la cuenta. */
  contados: number;
  /** Cuántos se dejaron afuera por estar vacíos. */
  excluidos: number;
}

/**
 * ¿Este ticket es una mesa que nunca pasó nada?
 *
 * Las dos condiciones tienen que darse juntas: ni un renglón Y ni un peso. Un
 * ticket sin renglones pero con monto es un dato raro, no una mesa vacía, y se
 * cuenta (esconderlo taparía el problema en vez de mostrarlo).
 */
function estaVacio(t: TicketDelPromedio, conRenglones: Set<string>): boolean {
  return !conRenglones.has(t.id) && (Number(t.total_bruto) || 0) === 0;
}

/**
 * Promedio por ticket descartando los vacíos.
 *
 * @param tickets       los tickets del período, ya filtrados por local/estado
 * @param conRenglones  ids de los tickets que tienen al menos un renglón cargado.
 *                      Si viene VACÍO se toma como "no se puede saber" y no se
 *                      excluye a nadie — es el caso del histórico anterior a
 *                      julio-2026, donde ningún renglón está atado a su ticket.
 */
export function ticketPromedio(
  tickets: TicketDelPromedio[],
  conRenglones: Set<string>,
): PromedioPorTicket {
  const sePuedeSaber = conRenglones.size > 0;
  let suma = 0;
  let contados = 0;
  let excluidos = 0;

  for (const t of tickets) {
    if (sePuedeSaber && estaVacio(t, conRenglones)) {
      excluidos++;
      continue;
    }
    suma += Number(t.total_bruto) || 0;
    contados++;
  }

  return { promedio: contados > 0 ? suma / contados : 0, contados, excluidos };
}
