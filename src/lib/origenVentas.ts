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
 * Hasta la migración 188 esto era una constante ('fudo') escrita acá y repetida
 * como `.eq('origen', ...)` en ocho pantallas. **Ya no.** El corte de Fudo pasa
 * local por local (Saavedra primero, Vedia después) y cuatro de esas consultas
 * miran las DOS casas en la misma query, así que una constante no podía
 * contestarlas.
 *
 * AHORA la regla vive en la base, en `ventas_origen_oficial` (un renglón por
 * local), y los reportes leen estas dos listas, que ya vienen filtradas fila por
 * fila. El día del corte en un local es un `update` de un renglón: sin deploy y
 * reversible en diez segundos.
 *
 *     update public.ventas_origen_oficial set origen = 'pos' where local = 'saavedra';
 *
 * ⚠️ Después de ese update hay que RECARGAR las pantallas abiertas: React Query
 * se guarda la respuesta anterior un rato y sigue mostrando los números viejos.
 */
export const VISTA_TICKETS_OFICIAL = 'v_ventas_tickets_oficial';
export const VISTA_ITEMS_OFICIAL = 'v_ventas_items_oficial';

/**
 * El literal 'fudo', para lo poco que de verdad habla DE FUDO y no de "la venta
 * oficial" — hoy, solo la pantalla de huérfanos de Fudo en Productos. No usarlo
 * en un reporte: para eso están las dos listas de arriba.
 */
export const ORIGEN_FUDO = 'fudo';
