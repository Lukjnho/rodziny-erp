-- 039_cocina_productos_fudo_nombres.sql
-- Permite configurar por producto los aliases con que aparece en Fudo, así el
-- matcher de ventas Fudo↔Stock no depende de un mapa hardcodeado en código.
-- Caso real: el Stock muestra "Sorrentinos de Jamón y queso" pero Fudo lo
-- vende como "Sorrentino Jamón, Queso y Cebollas". Sin alias el matcher no
-- conecta y la columna "Vendido hoy" queda en blanco.

ALTER TABLE cocina_productos
  ADD COLUMN IF NOT EXISTS fudo_nombres text[] NOT NULL DEFAULT '{}';

-- Prepoblado con los aliases que ya estaban en PRODUCTOS_COCINA (DashboardTab.tsx),
-- para los productos pasta de Vedia (único local con API Fudo activa hoy).
UPDATE cocina_productos SET fudo_nombres = ARRAY[
  'Cappelletti de pollo y puerro',
  'Cappelletti de pollo y puerro VIANDA'
] WHERE codigo = 'cap' AND local = 'vedia';

UPDATE cocina_productos SET fudo_nombres = ARRAY[
  'Ñoquis de Papa',
  'Ñoquis de Papa VIANDA'
] WHERE codigo = 'noq' AND local = 'vedia';

UPDATE cocina_productos SET fudo_nombres = ARRAY[
  'Ñoquis rellenos',
  'Ñoquis rellenos VIANDA'
] WHERE codigo = 'noqr' AND local = 'vedia';

UPDATE cocina_productos SET fudo_nombres = ARRAY[
  'Ravioli de espinaca y quesos',
  'Ravioli de espinaca y quesos VIANDA',
  'Ravioli espinaca y quesos CONGELADA'
] WHERE codigo = 'rav' AND local = 'vedia';

UPDATE cocina_productos SET fudo_nombres = ARRAY[
  'Scapinocc Vacio de cerdo, cerveza y barbacoa',
  'Scapinocc Vacio de cerdo, cerveza y barbacoa VIANDA'
] WHERE codigo = 'scar' AND local = 'vedia';

UPDATE cocina_productos SET fudo_nombres = ARRAY[
  'Sorrentino Jamón, Queso y Cebollas',
  'Sorrentino Jamón, Cebollas y Quesos VIANDA',
  'Sorrentino de Jamón, Quesos y Cebollas Confitadas CONGELADA'
] WHERE codigo = 'sor' AND local = 'vedia';

UPDATE cocina_productos SET fudo_nombres = ARRAY[
  'Tagliatelles al Huevo',
  'Tagliatelles al Huevo VIANDA'
] WHERE codigo = 'tag' AND local = 'vedia';

UPDATE cocina_productos SET fudo_nombres = ARRAY[
  'Tagliatelles mix',
  'Tagliatelles Mixtos VIANDA',
  'Tagliatelles mix CONGELADA'
] WHERE codigo = 'tagm' AND local = 'vedia';
