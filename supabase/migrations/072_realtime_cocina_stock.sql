-- Habilita Supabase Realtime sobre las 3 tablas que componen el stock de cocina.
-- Sin esto, el tab Cocina>Stock no se entera de los INSERTs hechos desde el QR
-- del celular del mostrador hasta que el admin vuelve a hacer foco en la pestaña.
--
-- Las tablas se agregan a la publication `supabase_realtime`. ALTER PUBLICATION
-- ... ADD TABLE no es idempotente nativamente (falla si la tabla ya está),
-- por eso se envuelve en un DO con chequeo previo en pg_publication_tables.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'cocina_traspasos'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cocina_traspasos;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'cocina_lotes_pasta'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cocina_lotes_pasta;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'cocina_merma'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cocina_merma;
  END IF;
END $$;
