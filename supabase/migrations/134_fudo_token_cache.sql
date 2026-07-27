-- Cache del token de Fudo, compartido entre invocaciones de las edge functions.
--
-- Fudo limita los logins: cuando la página Cocina dispara varias llamadas a la
-- vez, cada contenedor frío se logueaba de nuevo y Fudo devolvía 429 "Retry
-- later" → la demanda quedaba en "sin ventas Fudo". El token dura 24 h, así que
-- lo guardamos acá y todas las invocaciones reusan el mismo.
--
-- Contiene una credencial: solo accesible con service_role (sin RLS habilitado
-- ninguna policy alcanza a anon/authenticated, pero además revocamos permisos).
create table if not exists public.fudo_tokens (
  local text primary key,
  token text not null,
  exp bigint not null, -- epoch en segundos (viene de Fudo)
  actualizado_at timestamptz not null default now()
);

alter table public.fudo_tokens enable row level security;

revoke all on public.fudo_tokens from anon, authenticated;
