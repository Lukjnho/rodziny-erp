-- 180 · Las ventas del día entran cada 15 minutos, no una vez por día
--
-- EL PROBLEMA. El stock del mostrador se calcula descontando las ventas
-- posteriores al último conteo físico (v_cocina_stock_mostrador, migración 170).
-- Pero las ventas de Fudo entraban UNA vez por día, en el cron de las 8 de la
-- mañana, y traían las del día anterior. Medido el 4-sep-2026 a la tarde: Fudo
-- tenía 91 ventas de Vedia de ese día y nuestra tabla tenía CERO. Con eso, la
-- cuenta buena mostraba pasta que ya se había vendido, así que ninguna pantalla
-- podía usarla. Era el freno de mano de toda la cadena.
--
-- LO QUE CAMBIÓ EN LA FUNCIÓN `fudo-importar-ventas` (mismo commit):
--   · Modo día nuevo: { local, dia: '2026-09-04' } o { local, dia: 'hoy' }.
--     Le pide a Fudo SOLO ese día con `filter[closedAt]=and(gte.X,lt.Y)` y borra
--     y repone SOLO ese día. El modo mes de siempre queda intacto.
--   · Una sola llamada alcanza: un día son ~90 ventas y la página es de 500.
--     El modo mes necesitaba una búsqueda binaria de ~10 llamadas más el
--     recorrido hacia atrás.
--   · El token pasa por la tabla compartida `fudo_tokens`. Cada instancia de la
--     función arranca con la memoria vacía; sin esto, un sync cada 15 minutos
--     pedía un login nuevo en cada arranque en frío y Fudo bloquea por eso.
--   · Si el borrado previo falla, YA NO se inserta igual. Antes esas tres líneas
--     ignoraban el error, así que un delete que no entrara dejaba todo duplicado
--     en silencio. A 96 corridas por día eso se multiplicaba solo.
--   · edr_partidas NO se toca en modo día: ese bloque borra las cortesías del MES
--     entero antes de reponer, y el acumulador solo vio un día. Las rehace la
--     pasada completa de las 8.
--
-- VERIFICADO contra producción antes de dejarlo prendido:
--   · Vedia 4-sep: entraron 91 tickets / 219 ítems / 90 pagos, 0 ítems huérfanos.
--     Los 91 son exactamente los que devuelve la API para ese día.
--   · Saavedra 4-sep: pasó de 1 ticket a 41.
--   · Reimportar el 3-sep de Vedia (que ya estaba cargado) lo dejó IDÉNTICO:
--     93 tickets / $1.593.000 / 213 ítems / 92 pagos, antes y después. No duplica.
--   · De las ventas de hoy, 90 porciones engancharon con su producto de cocina
--     repartidas en 8 pastas; el resto son bebidas y guarniciones, que no
--     descuentan pasta. O sea: el puente venta→mostrador tiene por dónde pasar.
--
-- ⚠️ LO QUE ESTE RELOJ NO ARREGLA: Fudo solo expone las ventas CERRADAS
-- (`closedAt`). Una mesa abierta todavía no figura. No molesta para el stock
-- porque el conteo físico se hace al cierre del turno, pero explica por qué en
-- pleno servicio el número puede ir unos minutos atrás.

-- Idempotente: si ya está, se rehace.
select cron.unschedule('fudo-importar-ventas-hoy')
where exists (select 1 from cron.job where jobname = 'fudo-importar-ventas-hoy');

-- El comando se construye A PARTIR del cron diario que ya existe. Así hereda la
-- URL y las cabeceras sin tener que volver a escribir ninguna clave acá adentro,
-- y no queda una credencial más suelta en el repo.
--
-- Horario: 14-23 y 0-4 UTC = 11:00 a 01:00 hora Argentina. Fuera del horario de
-- servicio no tiene sentido molestar a la API de Fudo.
--
-- El cron de las 8 (`fudo-importar-ventas-diario`) SE QUEDA COMO CORRECTOR: Fudo
-- no avisa cuando alguien modifica o anula una venta vieja, así que una pasada
-- completa por día sigue haciendo falta.
select cron.schedule(
  'fudo-importar-ventas-hoy',
  '*/15 14-23,0-4 * * *',
  regexp_replace(
    (select command from cron.job where jobname = 'fudo-importar-ventas-diario'),
    'body :=.*timeout_milliseconds := 150000',
    'body := jsonb_build_object(''local'', loc, ''dia'', ''hoy'', ''iniciado_por'', ''cron_15min''), timeout_milliseconds := 90000',
    's'
  )
);
