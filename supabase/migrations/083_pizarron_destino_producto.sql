-- 083_pizarron_destino_producto.sql
-- "Destino" de un relleno/subreceta planificado que alimenta a varios vendibles.
-- Ej: "Pure papa para ñoqui" sirve para "Ñoquis de papa" y "Ñoquis rellenos".
-- Sin esto, planificar el pure se imputa por receta_id a AMBOS ñoquis (doble
-- conteo en el Resumen semanal). Con destino_producto_id, el chef elige a qué
-- vendible se imputa la planificación.
-- NULL = comportamiento legacy (matchea por receta_id).

alter table cocina_pizarron_items
  add column if not exists destino_producto_id uuid
    references cocina_productos(id) on delete set null;

comment on column cocina_pizarron_items.destino_producto_id is
  'Para rellenos/subrecetas que alimentan a varios vendibles (ej: pure de papa → ñoquis rellenos o simples): a qué producto vendible se imputa la planificación en el Resumen semanal. NULL = legacy (matchea por receta_id).';
