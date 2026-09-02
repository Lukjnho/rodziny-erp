-- 156 — Fix puntual de datos: lote mezz-0109 (Vedia, 1-sep-2026) no aparecía para porcionar.
--
-- PROBLEMA DETECTADO (2-sep-2026):
--   Los chicos de Vedia armaron mezzelune el 1-sep y al día siguiente el lote NO
--   aparecía en "Porcionar Pasta" del QR.
--
-- CAUSA RAÍZ (datos maestros, no del operario):
--   El producto "Mezzelune de Bondiola Braseada" (vedia, 1ba373c0-…) no tiene NINGUNA
--   fila en cocina_pasta_recetas. El QR usa eso para decidir si una pasta lleva relleno:
--     productoAdmiteRelleno = pastasConRelleno.has(producto.id)   [ProduccionQRPage.tsx]
--   Sin receta de relleno mapeada => el selector de relleno se deshabilita mostrando
--   "No aplica para fideos" => esPastaSinRelleno = !loteRellenoId = true => el insert
--   manda ubicacion='camara_congelado' + porciones + fecha_porcionado=hoy.
--   La lista de porcionar filtra por ubicacion='freezer_produccion', así que el lote
--   quedaba invisible y además inflaba el stock de cámara con "7 porciones" que en
--   realidad son 7 bandejas sin porcionar.
--   Bonus: el useEffect que limpia loteRellenoId NO limpia el state rellenoKg, por eso
--   las filas quedaron con relleno_kg=5,4 pero lote_relleno_id=null.
--
--   Mismo patrón, mismo síntoma: rav-2105 del 21-may-2026.
--
-- CARGA DUPLICADA:
--   Le tiró el bug a los chicos y volvieron a cargar. Quedaron 2 filas mezz-0109:
--     18:46 Tobias Buena  — masa del 29-ago (las masas del 1-sep todavía no estaban cargadas)
--     18:51 Bruno Cardozo — masa Pimentón del 1-sep + nota de la masa de cúrcuma  ← la buena
--   Confirmado por Lucas: es el mismo lote cargado dos veces.
--   Backup de ambas filas antes del fix: c:/tmp/backup-mezz-0109-2026-09-02.json
--
-- IDEMPOTENTE: el delete es no-op si ya corrió; el update sólo se gatilla si el lote
-- sigue en cámara, así que no vuelve a apilar la nota.
--
-- PENDIENTE APARTE (no lo arregla esta migración):
--   a) Vincular recetas (masa + relleno) a los productos sin mapear: Mezzelune de
--      Bondiola Braseada (vedia y saavedra), Scappinoc De Vacio de Cerdo.
--   b) Fix de código en ProduccionQRPage.tsx: no asumir "fideo" cuando el producto no
--      tiene recetas mapeadas, limpiar rellenoKg junto con loteRellenoId, y bloquear el
--      guardado si hay relleno_kg > 0 sin lote de relleno.

-- ── 1. Eliminar la carga duplicada ────────────────────────────────────────────
-- (libera además los 1,3 kg que sobre-consumía de la masa de huevo del 29-ago)
delete from cocina_lotes_pasta
where id = '90349400-4e49-48c4-912b-44fc8c0610e9';

-- ── 2. El lote bueno vuelve a estar pendiente de porcionar ────────────────────
-- 7 = bandejas armadas, no porciones. Se le vincula el relleno de bondiola del 1-sep
-- (36cb899d-…, 5,4 kg) que figuraba con consumo 0 pese a haberse usado entero.
update cocina_lotes_pasta set
  ubicacion              = 'freezer_produccion',
  cantidad_cajones       = 7,
  porciones              = null,
  fecha_porcionado       = null,
  porcionado_at          = null,
  responsable_porcionado = null,
  lote_relleno_id        = '36cb899d-fd36-48b3-8a8d-410309a9e344',
  notas = coalesce(notas || ' | ', '')
          || 'Corregido 2-sep: se habia guardado como pasta sin relleno (7 = bandejas, no porciones). Se elimino la carga duplicada de las 18:46.'
where id = '09567d95-c749-4aa7-94a0-8129ec8bcb82'
  and ubicacion = 'camara_congelado';
