-- 159 — Repara una regresión introducida por la migración 157 (mismo día, 2-sep-2026).
--
-- QUÉ PASÓ:
--   pastasCandidatas (ProduccionQRPage.tsx:1730) filtra el paso "2) Pasta a armar" según el relleno
--   elegido: si esa receta de relleno TIENE algún mapeo en cocina_pasta_recetas, muestra SOLO las
--   pastas mapeadas; si no tiene ninguno, cae al fallback "mostrar todas".
--   Antes de la 157 el "Relleno de Bondiola Braseada" no tenía ningún mapeo → fallback → se veían
--   todas las pastas. La 157 lo mapeó EXCLUSIVAMENTE a las Mezzelune y con eso escondió del paso 2
--   a las otras pastas que se arman con ese mismo relleno.
--   Cambiamos un bug silencioso (la pasta se guarda mal) por uno ruidoso (la pasta ni aparece).
--
-- USO REAL VERIFICADO (lotes desde jun-2026: cocina_lotes_pasta → cocina_lotes_relleno → receta):
--   vedia     Relleno de Bondiola Braseada → Scarpinocc de Vacío de Cerdo    13 lotes, últ. 29-ago  ← se escondía
--   vedia     Relleno de Bondiola Braseada → Mezzelune de Bondiola Braseada   1 lote,  últ.  1-sep  (mapeado por la 157)
--   saavedra  Relleno de Bondiola Braseada → Mezzelune de vacío de cerdo      1 lote,  últ. 25-ago  ← se escondía
--
-- NOTA DE FONDO (no la resuelve esta migración):
--   El Scarpinocc cambió de relleno en agosto — 22 lotes con "Relleno de Vacio de cerdo, cerveza y
--   barbacoa" hasta el 8-ago, después 13 con el de bondiola — y el mapeo nunca se actualizó; por eso
--   su receta mapeada quedó inactiva y su costeo no calcula. Es el mismo movimiento que se está
--   haciendo ahora con el Mezzelune de Saavedra. Definir el nombre canónico del producto y cuál es
--   su receta queda pendiente.
--
-- Es estrictamente ADITIVO: agrega pastas candidatas, no saca ninguna.
-- Idempotente por el UNIQUE (pasta_id, receta_id).
--
-- VERIFICADO DESPUÉS DE APLICAR: cero combinaciones relleno↔pasta con uso real y sin mapeo.

insert into cocina_pasta_recetas (pasta_id, receta_id)
values
  -- Scarpinocc de Vacío de Cerdo (vedia)   ← Relleno de Bondiola Braseada (vedia)
  ('51c523cd-2f59-45d8-bd7d-feab3d674eb3', 'a2c5c7f2-1acf-4d9b-8252-983481ba8a7b'),
  -- Mezzelune de vacío de cerdo (saavedra) ← Relleno de Bondiola Braseada (saavedra)
  ('244e211c-3e2b-457c-a697-431c488a5950', 'b0463701-c7f6-4c57-97ee-951093e6482e')
on conflict (pasta_id, receta_id) do nothing;
