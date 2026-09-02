-- 155 — Caché del ticket de acceso de ARCA
--
-- Para hablar con el web service de facturación hace falta un ticket de acceso
-- (token + firma) que da el WSAA y que dura 12 horas.
--
-- El caché NO es una optimización: es obligatorio. Si se pide un ticket nuevo
-- mientras el anterior sigue vigente, ARCA responde
--   "El CEE ya posee un TA valido para el acceso al WSN solicitado"
-- y rechaza el pedido. Sin caché, la segunda factura del día fallaría.
--
-- El token es un secreto: con él se factura en nombre de Rodziny. La tabla
-- tiene RLS activa y CERO políticas, así que no la lee nadie desde el
-- navegador — solo la edge function, que usa service_role y saltea RLS.

create table if not exists public.arca_tokens (
  cuit        text not null,
  servicio    text not null,
  ambiente    text not null,
  token       text not null,
  sign        text not null,
  generado_at timestamptz not null,
  expira_at   timestamptz not null,
  guardado_at timestamptz not null default now(),

  primary key (cuit, servicio, ambiente),
  constraint arca_tokens_ambiente_ck check (ambiente in ('homologacion','produccion')),
  constraint arca_tokens_cuit_ck     check (cuit ~ '^[0-9]{11}$')
);

comment on table public.arca_tokens is
  'Ticket de acceso del WSAA, válido 12 horas. Pedir uno nuevo mientras el anterior vive hace que ARCA rechace el pedido, así que este caché es obligatorio. Secreto: RLS activa y sin políticas, solo lo lee el servidor.';

alter table public.arca_tokens enable row level security;

revoke all on public.arca_tokens from anon;
revoke all on public.arca_tokens from authenticated;
