-- 176 — La config de precios queda con lo único que manda sobre algo
--
-- LA PANTALLA MENTÍA
-- «Productos › Configuración» ofrecía 6 campos por categoría y **solo uno hacía
-- algo**: `margen_min`, que dispara la alerta de margen bajo en Plan de Acción.
-- Los otros cinco no los leía ninguna pantalla, y encima la ayuda en pantalla
-- decía textual que el markup era «el % que se suma al costo para sacar el
-- precio sugerido» — el precio sugerido estaba fijo en «+5 % redondeado a $100».
--
-- Además los valores sembrados el 15-may-2026 (nunca tocados desde entonces) se
-- contradicen: `markup_objetivo` 0,70 sobre el costo da un margen del 41 %,
-- por debajo del `margen_min` 0,50 de la misma fila. Conectar el markup habría
-- hecho que la pantalla sugiera precios que ella misma marca como margen bajo.
--
-- QUÉ QUEDA (decisión de Lucas, 4-sep-2026: «si nos sirve, vinculemos; si no,
-- quitémosla», y «acordate de ir resumiendo»)
--   · margen_min → el piso. Dispara la alerta Y define el precio objetivo:
--       recibido = costo / (1 − margen_min), y de ahí se vuelve al precio de
--       lista sumando comisión e IVA. Antes la alerta decía cuántos puntos
--       faltaban pero no daba ningún precio.
--   · redondeo  → con qué paso cae ese precio en un número de carta
--       ($50 en panificados, $100 en el resto). Antes estaba fijo en $100.
--
-- QUÉ SE VA
--   · markup_objetivo   → redundante con margen_min, y contradictorio.
--   · margen_max        → nadie lo lee; no hay alerta de «ganás demasiado».
--   · rango_mercado_min → nadie lo lee y **está en NULL en las 11 filas**:
--   · rango_mercado_max   nunca se cargó un precio de mercado.
--
-- Las 11 filas quedaron respaldadas fuera del repo antes de aplicar.

alter table public.productos_costeo_config
  drop column if exists markup_objetivo,
  drop column if exists margen_max,
  drop column if exists rango_mercado_min,
  drop column if exists rango_mercado_max;

comment on table public.productos_costeo_config is
  'Piso de margen y paso de redondeo por categoría. Los dos campos se usan: margen_min '
  'dispara la alerta de margen bajo y define el precio objetivo del Plan de Acción; '
  'redondeo hace que ese precio caiga en un número de carta. Si se agrega una columna '
  'nueva acá, tiene que leerla alguna pantalla — ver migración 176.';
