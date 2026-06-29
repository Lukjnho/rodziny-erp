-- Cron diario que sincroniza las ventas de Fudo (API) hacia ventas_tickets.
-- Antes el sync solo corría a mano desde Finanzas > Estado de Resultados, así
-- que el mes en curso quedaba desactualizado varios días. Esto lo automatiza.
--
-- Corre a las 08:00 ARG (11:00 UTC) y baja mes anterior + mes actual de ambos
-- locales. La edge function fudo-importar-ventas registra cada corrida en
-- fudo_sync_runs (iniciado_por = 'cron_diario').
--
-- Auth: la función tiene verify_jwt activo, así que el gateway exige un JWT
-- válido. Usamos el anon key (público, igual que el cron de MercadoPago). El
-- secret key (sb_secret) NO sirve acá: devuelve 401 UNAUTHORIZED_INVALID_JWT_FORMAT.

select cron.unschedule('fudo-importar-ventas-diario')
  where exists (select 1 from cron.job where jobname = 'fudo-importar-ventas-diario');

select cron.schedule(
  'fudo-importar-ventas-diario',
  '0 11 * * *',
  $cron$
  select net.http_post(
    url := 'https://hiolgfvtcilblmqyxuxm.supabase.co/functions/v1/fudo-importar-ventas',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhpb2xnZnZ0Y2lsYmxtcXl4dXhtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1MTM4NDQsImV4cCI6MjA5MTA4OTg0NH0.UVCibXwr074macpmikeB4MSIcfCHIgagVdsrGrgPK0E',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhpb2xnZnZ0Y2lsYmxtcXl4dXhtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1MTM4NDQsImV4cCI6MjA5MTA4OTg0NH0.UVCibXwr074macpmikeB4MSIcfCHIgagVdsrGrgPK0E'
    ),
    body := jsonb_build_object(
      'local', loc,
      'anio', to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYY'),
      'meses', jsonb_build_array(
        to_char((now() at time zone 'America/Argentina/Buenos_Aires') - interval '1 month', 'YYYY-MM'),
        to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM')
      ),
      'iniciado_por', 'cron_diario'
    ),
    timeout_milliseconds := 150000
  )
  from (values ('vedia'), ('saavedra')) as t(loc);
  $cron$
);
