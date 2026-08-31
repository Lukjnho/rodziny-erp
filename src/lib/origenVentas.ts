/**
 * ¿De qué sistema salen las ventas que muestran los reportes?
 *
 * Desde la migración 141 cada ticket y cada línea de venta llevan una marca de
 * `origen`: 'fudo' (importado) o 'pos' (emitido por la caja propia del ERP).
 *
 * Mientras el POS propio corre EN PARALELO con Fudo ("shadow mode": se cobra por
 * los dos y se comparan los cierres), la misma venta existe de los dos lados.
 * Si los reportes leyeran todo, cada venta se contaría dos veces y se romperían
 * Ventas, EdR, Flujo de Caja e Ingeniería de Menú a la vez.
 *
 * Por eso TODO reporte lee solo la fuente oficial. Las ventas de prueba de la
 * caja quedan guardadas y visibles desde el propio POS, pero no ensucian ningún
 * número del negocio.
 *
 * CUÁNDO SE CAMBIA: cuando un local deje de usar Fudo y el POS propio pase a ser
 * la fuente de verdad. Ahí esto pasa a 'pos'. Si en algún momento hay que hacerlo
 * local por local (Vedia en POS y Saavedra todavía en Fudo), esto tiene que
 * volverse una función de `local` — y en ese caso hay que agregar el valor a las
 * queryKey de React Query, porque si no la caché de un local le contesta al otro.
 */
export const ORIGEN_VENTAS_OFICIAL = 'fudo';
