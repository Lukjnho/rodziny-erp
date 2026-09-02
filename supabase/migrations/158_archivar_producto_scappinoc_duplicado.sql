-- 158 — Archivar el producto duplicado "Scappinoc" (queda solo el "Scarpinocc").
--
-- En Vedia convivían dos productos activos para la misma pasta:
--     'scar' — "Scarpinocc de Vacío de Cerdo"                      → el que se usa
--     'scap' — "Scappinoc De Vacio de Cerdo, Barbacoa y Cerveza"   → duplicado, nunca se usó
-- Duplicado confirmado por Lucas (2-sep-2026).
--
-- VERIFICACIÓN antes de tocar — las 14 tablas que referencian cocina_productos:
--                                'scap'      'scar'
--     ventas_items                    0        1293
--     cocina_lotes_pasta              0          47
--     cocina_cierre_dia               0         217
--     cocina_traspasos                0          45
--     cocina_ajustes_stock            0          20
--     cocina_cierre_camara            0          10
--     cocina_pasta_recetas            0           3
--     cocina_productos_precios_canal  0           2
--     (las otras 6, en cero para ambos)
-- Además 'scap' tiene fudo_nombres vacío — no matchea ninguna venta de Fudo — y 'scar' tiene
-- los 3 nombres cargados. O sea: 'scap' está completamente inerte.
--
-- Se ARCHIVA (activo=false), no se borra: es la convención del proyecto para productos y recetas
-- (misma decisión que en su momento con "Mezzelune Cuadril (perro)"). Con activo=false desaparece
-- del QR de producción, del grid de Costeo y del tab Menú. Al no tener ninguna fila asociada,
-- se podría borrar en duro sin riesgo si más adelante se decide.
--
-- Su receta propia (c352f679, "Scappinoc De Vacio de Cerdo, Barbacoa y Cerveza") ya estaba inactiva.
--
-- Idempotente.

update cocina_productos
set activo = false
where id = '1a2b3963-dcbb-4684-a477-9c6857e10e1e'
  and activo = true;
