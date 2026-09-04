-- 173 — Cerrar la cola de masas viejas que quedó abierta por el bug de la 172
--
-- QUÉ PASÓ
-- Desde ~26-may-2026 el botón "Cerrar Masa" y el cierre de panadería no
-- guardaban nada (anon no tenía cómo escribir `cocina_lotes_masa`; arreglado en
-- la migración 172). Resultado: 215 lotes de masa quedaron marcados como
-- abiertos, el más viejo del 28-abr-2026.
--
-- POR QUÉ NO SE BORRAN
-- 147 de esos lotes tienen pasta colgando (`cocina_lotes_pasta.lote_masa_id` y
-- `cocina_lotes_pasta_masas.lote_masa_id`): son las masas con las que se armaron
-- los ravioles y sorrentinos. Borrarlas se llevaría puesta la historia de
-- producción de esas pastas. Se cierran, no se borran.
--
-- POR QUÉ kg_sobrante = 0
-- La masa es fresca: de un lote de abril no queda nada. Cerrar en 0 dice la
-- verdad de hoy —no sobró nada— sin inventar un destino que nadie registró.
-- La nota queda escrita en la fila para que nadie confunda ese 0 con una pesada
-- real.
--
-- POR QUÉ EL CORTE ES A 7 DÍAS Y NO "HASTA AYER"
-- La tablet solo mira los últimos 7 días (DIAS_VENTANA_LOTES_ABIERTOS = 7). Lo
-- anterior ya es invisible para el cocinero: cerrarlo no le saca ninguna masa
-- que hoy podría estar usando. Lo de los últimos 7 días se deja abierto a
-- propósito, para que lo cierre el que lo amasó.

update public.cocina_lotes_masa
   set kg_sobrante      = 0,
       destino_sobrante = null,
       notas = btrim(
         coalesce(notas, '') ||
         ' [cerrado en bloque el 04/09/2026: el botón de la tablet no guardaba desde may-26, no es una pesada real]'
       )
 where kg_sobrante is null
   and fecha < date '2026-08-28';
