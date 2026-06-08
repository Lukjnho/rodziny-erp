-- 099: suscripciones Web Push (un registro por dispositivo/navegador del usuario).
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx on push_subscriptions (user_id);

alter table push_subscriptions enable row level security;

-- Cada usuario gestiona solo sus propias suscripciones.
-- El edge function lee con service_role (bypassa RLS) para enviar.
drop policy if exists push_subscriptions_select_own on push_subscriptions;
create policy push_subscriptions_select_own on push_subscriptions
  for select using (user_id = auth.uid());

drop policy if exists push_subscriptions_insert_own on push_subscriptions;
create policy push_subscriptions_insert_own on push_subscriptions
  for insert with check (user_id = auth.uid());

drop policy if exists push_subscriptions_update_own on push_subscriptions;
create policy push_subscriptions_update_own on push_subscriptions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists push_subscriptions_delete_own on push_subscriptions;
create policy push_subscriptions_delete_own on push_subscriptions
  for delete using (user_id = auth.uid());
