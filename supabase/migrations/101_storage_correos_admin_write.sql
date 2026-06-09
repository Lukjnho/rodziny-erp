-- 101 — Permite al admin SUBIR archivos al bucket de documentos del contador.
-- (La lectura ya estaba en mig 100; faltaba el insert para el drag-and-drop del front.)
create policy correos_contadores_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'correos-contadores' and es_admin_actual());
