-- 206 — El colchón del amarillo también sale de la categoría
--
-- ══════════════════════════════════════════════════════════════════════════════
-- DE DÓNDE VIENE ESTO
-- ══════════════════════════════════════════════════════════════════════════════
--
-- El semáforo del margen tenía los umbrales escritos en el código, y encima
-- distintos en cada pantalla: la carta usaba 0,50 y 0,65, y "En vivo Fudo" usaba
-- 0,40 y 0,60. El mismo plato se pintaba de un color en un lado y de otro en el
-- otro.
--
-- Ayer el PISO pasó a salir de `productos_costeo_config.margen_min`, que ya
-- existía y va de 0,45 a 0,55 según la categoría. Pero el COLCHÓN —cuántos
-- puntos por encima del piso arranca el verde— quedó como constante en el
-- código: `UMBRAL_AMARILLO_SOBRE_MINIMO = 0,15`.
--
-- Mismo criterio que el piso: si depende de la categoría, va al dato. Una pasta
-- con piso 0,55 recién se pone verde en 0,70; un vino con piso 0,45, en 0,60. Que
-- los dos usen 15 puntos es una suposición, no una decisión — y mientras viva en
-- el código nadie la puede cambiar sin un deploy.
--
-- Arranca en 0,15 en las once categorías: es exactamente el colchón que tenía el
-- badge viejo (0,65 − 0,50 = 0,15, y ese 0,50 era el piso de `default`). O sea
-- que **hoy no cambia ni un color**. Lo que cambia es que ahora se puede tocar.
--
begin;

alter table public.productos_costeo_config
  add column if not exists margen_colchon numeric not null default 0.15;

comment on column public.productos_costeo_config.margen_colchon is
  'Cuántos puntos por encima de margen_min arranca el verde del semáforo. '
  '0,15 = quince puntos. Debajo de margen_min es rojo; entre margen_min y '
  'margen_min + margen_colchon es amarillo; de ahí para arriba, verde. '
  'Nació como constante en el código (UMBRAL_AMARILLO_SOBRE_MINIMO) y bajó al '
  'dato en la mig 206, por el mismo motivo que margen_min.';

-- Que nadie cargue un colchón negativo: dejaría el amarillo por debajo del rojo.
alter table public.productos_costeo_config
  drop constraint if exists productos_costeo_config_margen_colchon_check;
alter table public.productos_costeo_config
  add constraint productos_costeo_config_margen_colchon_check
  check (margen_colchon >= 0 and margen_colchon <= 1);

-- ── Guardarraíl: las once categorías tienen que quedar en 0,15 ──────────────
do $guard$
declare
  v_filas int;
  v_fuera int;
begin
  select count(*) into v_filas from public.productos_costeo_config;
  if v_filas < 1 then
    raise exception 'GUARDARRAIL: productos_costeo_config quedó vacía.';
  end if;

  select count(*) into v_fuera
    from public.productos_costeo_config
   where margen_colchon is distinct from 0.15;
  if v_fuera <> 0 then
    raise exception 'GUARDARRAIL: % categoría(s) no quedaron en 0,15. Hoy no tenía que cambiar ningún color.', v_fuera;
  end if;

  raise notice 'OK: % categorías con colchón 0,15 (mismo semáforo que antes).', v_filas;
end
$guard$;

commit;
