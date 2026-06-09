-- 101: recordatorios de agenda vía Web Push (cron cada 5 min).
create extension if not exists pg_cron;
create extension if not exists pg_net;

alter table agenda_items
  add column if not exists recordatorio_minutos int,
  add column if not exists recordatorio_enviado_at timestamptz;

-- Revisa items con hora y recordatorio pendiente cuya ventana ya se abrió,
-- y dispara el push a creador + asignados. Marca enviado para no repetir.
create or replace function procesar_recordatorios_agenda()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  destinatarios uuid[];
  hora text;
begin
  for r in
    select * from agenda_items
    where not all_day
      and not completado
      and recordatorio_minutos is not null
      and recordatorio_enviado_at is null
      and now() >= fecha_inicio - (recordatorio_minutos || ' minutes')::interval
      and now() < fecha_inicio
  loop
    destinatarios := array(select distinct unnest(array_append(r.asignados, r.usuario_id)));
    hora := to_char(r.fecha_inicio at time zone 'America/Argentina/Cordoba', 'HH24:MI');
    perform net.http_post(
      url := 'https://hiolgfvtcilblmqyxuxm.supabase.co/functions/v1/enviar-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhpb2xnZnZ0Y2lsYmxtcXl4dXhtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1MTM4NDQsImV4cCI6MjA5MTA4OTg0NH0.UVCibXwr074macpmikeB4MSIcfCHIgagVdsrGrgPK0E'
      ),
      body := jsonb_build_object(
        'user_ids', to_jsonb(destinatarios),
        'title', '⏰ ' || r.titulo,
        'body', 'Es a las ' || hora,
        'url', '/agenda'
      )
    );
    update agenda_items set recordatorio_enviado_at = now() where id = r.id;
  end loop;
end;
$$;

revoke all on function procesar_recordatorios_agenda() from public, anon, authenticated;

-- Correr cada 5 minutos.
select cron.unschedule('recordatorios-agenda')
  where exists (select 1 from cron.job where jobname = 'recordatorios-agenda');
select cron.schedule('recordatorios-agenda', '*/5 * * * *', $$select procesar_recordatorios_agenda()$$);
