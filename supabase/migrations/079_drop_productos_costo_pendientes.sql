-- Drop del sistema de "variaciones pendientes" — reemplazado por el flujo inline
-- dentro del modal Nuevo gasto (decide al cargar el gasto si actualiza costo_unitario).
--
-- Lo que va: la cola productos_costo_pendientes + RPCs detectar/aceptar/rechazar.
-- Lo que queda: productos_costo_historial (sigue alimentándose cuando el usuario
-- tilda "Actualizar costo" en el item del gasto).

DROP FUNCTION IF EXISTS public.rechazar_variacion_costo(uuid, text, text);
DROP FUNCTION IF EXISTS public.aceptar_variacion_costo(uuid, text);
DROP FUNCTION IF EXISTS public.detectar_variaciones_costo(int, numeric);
DROP TABLE IF EXISTS public.productos_costo_pendientes;
