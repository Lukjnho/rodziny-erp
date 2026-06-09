-- ════════════════════════════════════════════════════════════════════════════
-- 100 — Integración de correo (Outlook) — lectura de mails de contadores
-- Recibos de sueldo → RRHH · VEPs → Finanzas · alerta in-app
-- Paso 1: base de datos (conexión + remitentes + destinos). El sync/cron va en Paso 2.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) Estado de la conexión (singleton). BLINDADA: sin policies → solo service_role.
--    Guarda los tokens OAuth. El navegador NUNCA accede a esta tabla.
create table if not exists public.correo_integracion (
  id            smallint primary key default 1 check (id = 1),
  proveedor     text not null default 'outlook',
  email_casilla text,
  refresh_token text,
  access_token  text,
  token_expira_en timestamptz,
  conectado     boolean not null default false,
  oauth_state   text,
  ultima_lectura timestamptz,
  ultimo_error  text,
  updated_at    timestamptz not null default now()
);
insert into public.correo_integracion (id) values (1) on conflict (id) do nothing;
alter table public.correo_integracion enable row level security;
-- Sin policies a propósito: ningún rol cliente (anon/authenticated) puede leer/escribir.
-- Solo el service_role (edge functions) la toca, porque bypassa RLS.

-- ── 2) Remitentes de contadores (lista editable por admin). El sync filtra por acá.
create table if not exists public.correo_remitentes (
  id        uuid primary key default gen_random_uuid(),
  email     text not null,
  nombre    text,
  activo    boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists correo_remitentes_email_uniq
  on public.correo_remitentes (lower(email));
alter table public.correo_remitentes enable row level security;
create policy correo_remitentes_admin_all on public.correo_remitentes
  for all to authenticated using (es_admin_actual()) with check (es_admin_actual());

-- ── 3) Bandeja de mensajes procesados (auditoría + idempotencia por message_id).
create table if not exists public.correo_mensajes (
  id              uuid primary key default gen_random_uuid(),
  message_id      text not null unique,
  remitente       text,
  remitente_nombre text,
  asunto          text,
  recibido_en     timestamptz,
  tipo            text check (tipo in ('recibo','vep','desconocido')),
  estado          text not null default 'pendiente'
                    check (estado in ('procesado','error','sin_adjunto','pendiente')),
  adjuntos        jsonb not null default '[]'::jsonb,
  recibo_id       uuid,
  vep_id          uuid,
  error           text,
  created_at      timestamptz not null default now()
);
alter table public.correo_mensajes enable row level security;
create policy correo_mensajes_admin_read on public.correo_mensajes
  for select to authenticated using (es_admin_actual());

-- ── 4) Recibos de sueldo (destino RRHH). Se vinculan al empleado por CUIL.
create table if not exists public.recibos_sueldo (
  id              uuid primary key default gen_random_uuid(),
  empleado_id     uuid references public.empleados(id) on delete set null,
  cuil_detectado  text,
  nombre_detectado text,
  periodo         text,
  monto_neto      numeric,
  archivo_path    text not null,
  message_id      text,
  created_at      timestamptz not null default now()
);
create index if not exists recibos_sueldo_empleado_idx on public.recibos_sueldo (empleado_id);
alter table public.recibos_sueldo enable row level security;
create policy recibos_sueldo_admin_all on public.recibos_sueldo
  for all to authenticated using (es_admin_actual()) with check (es_admin_actual());

-- ── 5) VEPs a pagar (destino Finanzas/Impuestos).
create table if not exists public.veps (
  id           uuid primary key default gen_random_uuid(),
  descripcion  text,
  impuesto     text,
  periodo      text,
  vencimiento  date,
  monto        numeric,
  archivo_path text,
  pagado       boolean not null default false,
  fecha_pago   date,
  message_id   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists veps_pendientes_idx on public.veps (pagado, vencimiento);
alter table public.veps enable row level security;
create policy veps_admin_all on public.veps
  for all to authenticated using (es_admin_actual()) with check (es_admin_actual());

-- ── 6) Estado de la conexión para la UI (sin exponer tokens). Admin-only.
create or replace function public.correo_integracion_estado()
returns table (
  conectado boolean,
  email_casilla text,
  ultima_lectura timestamptz,
  ultimo_error text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not es_admin_actual() then
    raise exception 'no autorizado';
  end if;
  return query
    select c.conectado, c.email_casilla, c.ultima_lectura, c.ultimo_error, c.updated_at
    from public.correo_integracion c where c.id = 1;
end;
$$;
revoke all on function public.correo_integracion_estado() from anon;
grant execute on function public.correo_integracion_estado() to authenticated;

-- ── 7) Storage: bucket privado para adjuntos de correo (recibos/VEPs).
insert into storage.buckets (id, name, public)
values ('correos-contadores', 'correos-contadores', false)
on conflict (id) do nothing;
-- Admin puede leer (para generar signed URLs). El service_role escribe (bypassa RLS).
create policy correos_contadores_admin_read on storage.objects
  for select to authenticated
  using (bucket_id = 'correos-contadores' and es_admin_actual());
