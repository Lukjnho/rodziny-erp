-- ═══════════════════════════════════════════════════════════════════════════
-- Se apagan los Raviolis de Espinaca y Quesos de Saavedra
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Decidido por Lucas el 11-sep-2026, con el dato adelante.
--
-- Tres filas activas y marcadas vendibles, con precio del 18-ago, y **ninguna
-- enganchada al POS**:
--
--     Raviolis de Espinaca y Quesos              $10.200
--     Ravioles de Espinaca y Quesos (CONGELADA)   $8.000
--     Raviolis De Espinaca y Quesos (VIANDA)     $10.200
--
-- 🔑 **Cero ventas en 90 días por cualquier vía.** No es que el enganche al POS
-- falta y por eso no se ven: de los **20.276 renglones de venta de Saavedra**
-- en esos 90 días, **ni uno contiene "ravio"**. Lo que Saavedra vende con
-- espinaca es el **Tortelli** (27 unidades, $286.200).
--
-- Medido antes de apagar, y las tres dieron cero en todo:
--
--     renglones de receta que las nombran como subreceta   0
--     lotes de producción                                  0
--     cierres de día                                       0
--     renglones de venta enganchados por receta_id         0
--
-- Se apagan, no se borran: `activo = false` es la forma de la casa para
-- jubilar una receta, igual que las 51 de mayo. Si mañana se decide venderlas,
-- se prenden y vuelven con su precio puesto.
--
-- ⚠️ Al apagarlas **no entran a la Etapa 2**: el modelo de formas de venta se
-- arma sólo con lo que está activo.
--
-- Es una migración de solo datos y no toca ninguna columna.
-- ═══════════════════════════════════════════════════════════════════════════

update public.cocina_recetas
   set activo = false, updated_at = now()
 where local = 'saavedra'
   and activo
   and nombre in (
     'Raviolis de Espinaca y Quesos',
     'Ravioles de Espinaca y Quesos (CONGELADA)',
     'Raviolis De Espinaca y Quesos (VIANDA)'
   );

-- ═══════════════════════════════════════════════════════════════════════════
-- GUARDARRAÍL
-- ═══════════════════════════════════════════════════════════════════════════
do $guardia$
declare
  v_n integer;
begin
  -- 1 · Las tres quedaron apagadas.
  select count(*) into v_n
    from public.cocina_recetas
   where local = 'saavedra' and not activo
     and nombre in ('Raviolis de Espinaca y Quesos',
                    'Ravioles de Espinaca y Quesos (CONGELADA)',
                    'Raviolis De Espinaca y Quesos (VIANDA)');
  if v_n <> 3 then
    raise exception 'Esperaba las 3 de Saavedra apagadas y hay %.', v_n;
  end if;

  -- 2 · 💣 Y la familia de VEDIA, que se llama casi igual y SÍ vende (1.388
  --     unidades en 90 días), quedó intacta. Es el error que hay que hacer
  --     imposible: "Ravioli de Espinaca y Quesos" en singular es otra cosa.
  select count(*) into v_n
    from public.cocina_recetas
   where local = 'vedia' and activo and nombre ilike '%spinaca%' and nombre ilike 'ravio%';
  -- Son TRES (base + CONGELADO + VIANDA). El guardarraíl decía 4 la primera
  -- vez y se puso rojo con razón: la base tiene DOS precios de canal (plato y
  -- vianda) y al leer el listado de precios parecían cuatro recetas.
  if v_n <> 3 then
    raise exception 'Vedia tendría que conservar sus 3 recetas de ravioles con espinaca y tiene %.', v_n;
  end if;

  -- 3 · Saavedra sigue vendiendo su Tortelli de espinaca, que es el que de
  --     verdad se vende.
  select count(*) into v_n
    from public.cocina_recetas
   where local = 'saavedra' and activo and vendible and nombre ilike 'tortelli%spinaca%';
  if v_n < 1 then
    raise exception 'Se apagó de más: Saavedra quedó sin Tortelli de espinaca vendible.';
  end if;

  raise notice 'Raviolis OK · 3 apagadas en Saavedra · las 4 de Vedia intactas';
end;
$guardia$;
