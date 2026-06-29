-- 120_fix_fecha_lotes_produccion_utc.sql
-- Corrige la fecha de los lotes guardados con +1 día por el bug de zona horaria.
--
-- El QR usaba new Date().toISOString().slice(0,10) (fecha UTC) para `fecha`. Toda
-- carga hecha entre las 21:00 y las 23:59 AR caía en el día siguiente en UTC, así
-- que el lote quedaba fechado un día adelante: se mostraba en el día equivocado
-- y podía "saltar" a la semana siguiente en el apartado de Lotes registrados.
-- (Las salsas/postres son las más afectadas porque se cargan a la noche.)
--
-- El código ya quedó arreglado (hoyAR en src/lib/fechaAR.ts). Esto corrige los
-- datos históricos. Día operativo AR = (created_at en hora AR) − 5h (corte de
-- jornada: la madrugada cuenta como el día anterior, igual que el cierre).
--
-- Regla acotada y segura: solo toca filas con fecha = día_operativo + 1, que es
-- la firma exacta del bug. Las correcciones manuales de fecha (otro desfasaje)
-- no se tocan. Idempotente: tras correr, fecha = día_operativo y ya no matchea.

UPDATE cocina_lotes_produccion
SET fecha = (((created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') - interval '5 hours'))::date
WHERE fecha = (((created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') - interval '5 hours'))::date + 1;

UPDATE cocina_lotes_pasta
SET fecha = (((created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') - interval '5 hours'))::date
WHERE fecha = (((created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') - interval '5 hours'))::date + 1;
