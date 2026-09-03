/**
 * El stock de pastas terminadas: una sola cuenta, tres capas.
 *
 * La resta vive en la base (`v_cocina_stock_pastas`, migración 161) y NO se
 * vuelve a escribir en ninguna pantalla. Este archivo solo tiene el tipo de la
 * fila, el string del select, y dos funciones de una línea cuyo único trabajo
 * es que el nombre de la variable diga QUÉ capa se está usando.
 *
 * POR QUÉ EXISTE. Antes cada pantalla hacía su propia resta sobre las columnas
 * crudas de la vista, y salieron tres definiciones distintas de "disponible":
 * Dashboard, Traspasos y el panel de Compras restaban una cosa; el Plan de
 * Producción y el Resumen Semanal otra; y el tab Stock reimplementaba la vista
 * entera en el navegador. El mismo producto daba números distintos según la
 * pantalla que mirabas.
 *
 * LA REGLA:
 *   · Quien MUEVE o VENDE pasta usa `vendibleHoy`  → Traspasos, Mostrador.
 *   · Quien PLANIFICA producción usa `paraPlanificar` → Plan, Resumen Semanal.
 *   · Quien MIRA el estado muestra las capas separadas → Dashboard, Stock.
 *
 * ⚠️ Nunca darle `paraPlanificar` a una pantalla que traslada mercadería: ese
 * número incluye bandejas que todavía nadie cortó, y habilitaría bajar al
 * mostrador porciones que físicamente no existen.
 */

/** Las columnas de la cuenta única. Nadie debería pedir las crudas. */
export const SELECT_STOCK_PASTAS =
  'producto_id, nombre, codigo, local, minimo_produccion, ' +
  'porciones_neto_camara, bandejas_en_proceso, porciones_en_proceso_est, ' +
  'en_proceso_sin_ratio, porciones_proyectadas';

export interface StockPastaRow {
  producto_id: string;
  nombre: string;
  codigo: string;
  local: string;
  minimo_produccion: number | null;
  /** Vendible HOY: porcionado, en cámara. Ya viene con la resta hecha y sin negativos. */
  porciones_neto_camara: number | null;
  /** Bandejas armadas esperando el porcionado. El dato crudo que ve el cocinero. */
  bandejas_en_proceso: number | null;
  /** Esas bandejas traducidas a porciones (estimación por kilos, no conteo). */
  porciones_en_proceso_est: number | null;
  /** Hay algo en el freezer y NO se puede estimar: mostrar "?", nunca un 0. */
  en_proceso_sin_ratio: boolean | null;
  /** Para planificar: neto de cámara + lo armado sin porcionar. */
  porciones_proyectadas: number | null;
}

/** Lo que se puede trasladar o vender AHORA. */
export function vendibleHoy(r: StockPastaRow): number {
  return Math.max(0, Number(r.porciones_neto_camara ?? 0));
}

/** Lo que va a haber cuando se termine de porcionar lo armado. Para planificar. */
export function paraPlanificar(r: StockPastaRow): number {
  return Math.max(0, Number(r.porciones_proyectadas ?? 0));
}

/** Bandejas armadas sin porcionar. Se muestra aparte, nunca sumado al vendible. */
export function bandejasEnProceso(r: StockPastaRow): number {
  return Number(r.bandejas_en_proceso ?? 0);
}
