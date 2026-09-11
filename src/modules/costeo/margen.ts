// El margen, en un solo lugar.
//
// ══════════════════════════════════════════════════════════════════════════════
// 💣 QUÉ VENÍA PASANDO
// ══════════════════════════════════════════════════════════════════════════════
//
// El mismo plato daba un margen distinto según la pestaña, porque la cuenta
// estaba escrita tres veces:
//
//   · MenuTab.tsx:245          `margenEscenario`, devuelve FRACCIÓN (0,62)
//   · useCostoPorFudo.ts:116   `getMargenPct`,    devuelve ESCALA 0-100 (62)
//   · useMenuEngineering:381   suelta adentro del bucle, devuelve FRACCIÓN
//
// Las tres hacen la misma cadena —sacarle el IVA al precio, sacarle la comisión,
// comparar con el costo— pero una devuelve 0,62 y otra 62. Eso no rompe hasta
// que alguien compara los dos números, y ahí un plato con 62 % de margen parece
// tener 6.200 %.
//
// Y encima el semáforo del badge tenía los umbrales CLAVADOS en 0,50 y 0,65,
// mientras que `productos_costeo_config` guarda un margen mínimo POR CATEGORÍA
// que va de 0,45 a 0,55 y que ya usaban el Plan de Acción y la Ingeniería de
// Menú. O sea: la misma pasta estaba "en amarillo" en una pantalla y "bien" en
// la otra, las dos mirando el mismo número.
//
// ══════════════════════════════════════════════════════════════════════════════
// LA REGLA, UNA VEZ
// ══════════════════════════════════════════════════════════════════════════════
//
//   precio de lista (IVA incluido)
//     − descuento del escenario        → precio cobrado
//     ÷ (1 + IVA)                      → neto
//     − comisión bancaria sobre el neto → LO QUE RECIBIMOS
//
//   margen = (lo que recibimos − costo) / lo que recibimos
//
// 🔑 **Siempre FRACCIÓN.** 0,62 es sesenta y dos por ciento. El ×100 se hace al
// dibujar, nunca al calcular. Si una función de acá devolviera 62, volveríamos
// a tener dos escalas.
//
// ⚠️ Ojo con la palabra: `CostoReceta.margenPct` del motor de costeo **no es
// esto**. Ese es el MARGEN DE SEGURIDAD, un colchón que se le suma al costo
// para cubrir desvíos de producción. Misma palabra, otra cosa. No unificar.

/** Lo que hace falta saber para pasar de un precio de carta a plata en la mano. */
export interface CondicionesDeCobro {
  /** 0,21 = 21 %. */
  ivaPct: number;
  /** Comisión bancaria sobre el neto. 0 en efectivo. */
  comisionPct: number;
  /** Descuento del escenario (efectivo, convenio). 0 = precio de lista. */
  descuentoPct?: number;
}

export type SemaforoMargen = 'rojo' | 'amarillo' | 'verde';

/**
 * Cuánto queda en la mano después del descuento, el IVA y la comisión.
 *
 * Devuelve `null` cuando no hay precio o la cuenta da cero o menos — que pasa
 * de verdad si la comisión fuera del 100 %.
 */
export function loQueRecibimos(
  precioBruto: number | null | undefined,
  cond: CondicionesDeCobro,
): number | null {
  if (!precioBruto || precioBruto <= 0) return null;
  const cobrado = precioBruto * (1 - (cond.descuentoPct ?? 0));
  const neto = cobrado / (1 + cond.ivaPct);
  const recibido = neto - neto * cond.comisionPct;
  return recibido > 0 ? recibido : null;
}

/** Cada escalón entre el precio de carta y la plata en la mano. */
export interface DesgloseDeCobro {
  precioLista: number;
  descuento: number;
  precioCobrado: number;
  iva: number;
  neto: number;
  comision: number;
  recibido: number;
}

/**
 * La misma cadena de `loQueRecibimos`, pero devolviendo cada escalón.
 *
 * Existe para las pantallas que muestran el desglose ("−IVA … −comisión … te
 * queda"). Sin esto, esas pantallas vuelven a escribir la cadena a mano para
 * poder mostrar los pasos intermedios, y ahí es donde se desincroniza de la
 * cuenta buena. `recibido` acá es exactamente lo que devuelve `loQueRecibimos`.
 */
export function desgloseDeCobro(
  precioBruto: number,
  cond: CondicionesDeCobro,
): DesgloseDeCobro {
  const descuento = precioBruto * (cond.descuentoPct ?? 0);
  const precioCobrado = precioBruto - descuento;
  const neto = precioCobrado / (1 + cond.ivaPct);
  const comision = neto * cond.comisionPct;
  return {
    precioLista: precioBruto,
    descuento,
    precioCobrado,
    iva: precioCobrado - neto,
    neto,
    comision,
    recibido: neto - comision,
  };
}

/**
 * El margen sobre lo recibido, como FRACCIÓN (0,62 = 62 %).
 *
 * `null` si falta el precio o el costo: eso es "no se sabe", que no es lo mismo
 * que cero y no se puede dibujar como si fuera un margen malo.
 */
export function margenSobreRecibido(
  precioBruto: number | null | undefined,
  costo: number | null | undefined,
  cond: CondicionesDeCobro,
): number | null {
  if (costo == null) return null;
  const recibido = loQueRecibimos(precioBruto, cond);
  if (recibido == null) return null;
  return (recibido - costo) / recibido;
}

/**
 * El camino de vuelta: a qué precio de lista hay que vender para llegar a un
 * margen dado. Es la misma cadena invertida, y por eso vive al lado.
 *
 * Lo usa el Plan de Acción para decir "ponelo en $X". Con una comisión del
 * 100 % o un margen objetivo del 100 % no hay precio posible: devuelve `null`.
 */
export function precioParaMargen(
  costo: number | null | undefined,
  margenObjetivo: number,
  cond: CondicionesDeCobro,
): number | null {
  if (costo == null || costo <= 0) return null;
  if (margenObjetivo >= 1 || cond.comisionPct >= 1) return null;
  const recibidoObjetivo = costo / (1 - margenObjetivo);
  const cobrado = (recibidoObjetivo * (1 + cond.ivaPct)) / (1 - cond.comisionPct);
  return cobrado / (1 - (cond.descuentoPct ?? 0));
}

/**
 * El colchón de respaldo, y SOLO de respaldo.
 *
 * El colchón de verdad vive en `productos_costeo_config.margen_colchon`
 * (migración 206), una columna por categoría. Este 0,15 se usa nada más que
 * mientras la configuración todavía no cargó en el navegador.
 *
 * 💣 El número no es inventado: es la diferencia que tenía clavado el badge
 * viejo de MenuTab (0,65 − 0,50), y ese 0,50 era justo el `margen_min` de la
 * categoría `default`.
 */
export const COLCHON_POR_DEFECTO = 0.15;

/**
 * El semáforo del margen, contra los dos números de SU categoría.
 *
 * Los dos salen de `productos_costeo_config`: `margen_min` (0,45 a 0,55 según
 * la categoría) y `margen_colchon` (cuántos puntos más arriba arranca el
 * verde). Acá no se inventa ninguno de los dos — si no hay config para esa
 * categoría, el que llama pasa la de `default`.
 *
 *     margen < mínimo                      → rojo
 *     mínimo ≤ margen < mínimo + colchón   → amarillo
 *     mínimo + colchón ≤ margen            → verde
 */
export function semaforoDeMargen(
  margen: number,
  margenMinimo: number,
  colchon: number = COLCHON_POR_DEFECTO,
): SemaforoMargen {
  if (margen < margenMinimo) return 'rojo';
  if (margen < margenMinimo + colchon) return 'amarillo';
  return 'verde';
}
