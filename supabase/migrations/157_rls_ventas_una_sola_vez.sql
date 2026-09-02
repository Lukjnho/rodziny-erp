-- ============================================================================
-- 157 — Ventas y Estado de Resultados dejan de tirar error 500
-- ============================================================================
-- SÍNTOMA (1-sep-2026): ~51 respuestas HTTP 500 en Ventas, Ingeniería de Menú,
-- Estado de Resultados y Análisis de Gastos. El motivo real está en los logs:
--   {"code":"57014","message":"canceling statement due to statement timeout"}
-- El rol `authenticated` corta a los 8 segundos (statement_timeout=8s).
--
-- NO FALTA NINGÚN ÍNDICE. `idx_items_local_periodo` existe y el plan lo usa.
--
-- CAUSA REAL: `tiene_permiso()` nunca se declaró STABLE — las migraciones 016,
-- 104 y 143 la crean sin marca de volatilidad, así que queda VOLATILE. Una
-- condición VOLATILE dentro de una política RLS no se puede calcular una sola
-- vez: PostgreSQL la ejecuta FILA POR FILA, y cada llamada es una consulta a
-- `perfiles`. Encima, desde la 146/151 hay DOS políticas permisivas de SELECT
-- sobre estas tablas, así que se ejecuta dos veces por fila.
--
-- Medido con EXPLAIN (ANALYZE, BUFFERS) contra producción, base tranquila:
--
--   ventas_items — 31.417 filas (Ingeniería de Menú, 3 meses de Vedia)
--     Index Scan using idx_items_local_periodo
--       Filter: (origen='fudo' AND ((tiene_permiso('caja') AND origen='pos')
--                                    OR tiene_permiso('ventas')))
--       Buffers: shared hit=64024    Execution Time: 2901 ms
--     con (select ...):
--       Buffers: shared hit=1191     Execution Time: 33 ms     <- 88x
--
--   ventas_tickets — 34.000 filas (Análisis de Gastos, página 34 de 34)
--       Buffers: shared hit=68999    Execution Time: 3031 ms
--     con (select ...):
--       Buffers: shared hit=1000     Execution Time: 17 ms     <- 176x
--
--   edr_resumen_ventas('vedia','2026') — devuelve 9 filas
--       Buffers: shared hit=64592    Execution Time: 3026 ms
--
-- Los ~63.000 buffers de más son las lecturas a `perfiles`, una por fila y por
-- política. Y esos 3 segundos son con la base ociosa: la pantalla de Gastos pide
-- 34 páginas seguidas y el Estado de Resultados llama al RPC una vez por local.
-- Con dos o tres consultas en paralelo se pasan de los 8 segundos.
--
-- ARREGLO: envolver la llamada en `(select ...)`. Eso la convierte en un
-- InitPlan, que se calcula UNA sola vez por consulta. No cambia quién ve qué:
-- las expresiones son literalmente las mismas, sólo envueltas.
--
-- Se usa ALTER POLICY y no drop+create, para no dejar la tabla ni un instante
-- sin su política y para no arriesgarse a perder el `to authenticated`.
--
-- VERIFICACION OBLIGATORIA (filas visibles por clase de usuario, tomada antes
-- de aplicar — tiene que dar IDENTICO despues):
--        usuario            ventas_items  ventas_tickets  ventas_pagos
--   admin (Lucas, Karina)       122.102          44.123        42.867
--   ventas (tomas)              122.102          44.123        42.867
--   caja (Marcos)                     4               2             4
--   sin permisos (7 usuarios)         0               0             0
--
-- NO se toca `ventas_tickets_caja_deshacer`: es política de DELETE (no
-- interviene en estos timeouts) y depende de ticket_sin_comprobante(), que es
-- de la migración 154 de facturación ARCA (otra sesión).
--
-- Renumerada de 156 a 157: la 156 quedó tomada por 156_fix_lote_mezz.
-- ============================================================================

begin;

-- -- Las líneas de venta ------------------------------------------------------
alter policy ventas_items_all on public.ventas_items
  using ((select public.tiene_permiso('ventas')))
  with check ((select public.tiene_permiso('ventas')));

alter policy ventas_items_caja_ver on public.ventas_items
  using ((select public.tiene_permiso('caja')) and origen = 'pos');

alter policy ventas_items_caja_cobrar on public.ventas_items
  with check ((select public.tiene_permiso('caja')) and origen = 'pos');

-- -- Los tickets --------------------------------------------------------------
alter policy ventas_tickets_all on public.ventas_tickets
  using ((select public.tiene_permiso('ventas')))
  with check ((select public.tiene_permiso('ventas')));

alter policy ventas_tickets_caja_ver on public.ventas_tickets
  using ((select public.tiene_permiso('caja')) and origen = 'pos');

alter policy ventas_tickets_caja_cobrar on public.ventas_tickets
  with check ((select public.tiene_permiso('caja')) and origen = 'pos');

-- -- Los cobros ---------------------------------------------------------------
alter policy ventas_pagos_all on public.ventas_pagos
  using ((select public.tiene_permiso('ventas')))
  with check ((select public.tiene_permiso('ventas')));

alter policy ventas_pagos_caja_ver on public.ventas_pagos
  using ((select public.tiene_permiso('caja')) and origen = 'pos');

alter policy ventas_pagos_caja_cobrar on public.ventas_pagos
  with check ((select public.tiene_permiso('caja')) and origen = 'pos');

commit;
