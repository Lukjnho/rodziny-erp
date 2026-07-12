-- Saldos de las cuentas — para que "liquidez" signifique liquidez.
--
-- El Flujo de Caja mostraba "Saldo neto del período" (ingresos − egresos del mes)
-- y lo leía como plata disponible. No lo es: un mes puede cerrar negativo y la
-- empresa tener caja de sobra (o al revés). Faltaba el punto de partida.
--
-- Galicia e ICBC traen el saldo en el extracto (movimientos_bancarios.saldo).
-- MercadoPago NO: de 4.695 movimientos de junio-2026, cero tienen saldo — el
-- export de MP no lo incluye. Y MP es la cuenta principal de salida. Por eso el
-- balance de MP se trae por API en el sync (supabase/functions/sync-mercadopago).
create table if not exists saldos_cuentas (
  id uuid primary key default gen_random_uuid(),
  cuenta text not null check (cuenta in ('galicia', 'icbc', 'mercadopago')),
  fecha date not null,
  saldo numeric(14, 2) not null,
  -- 'api' = traído automáticamente · 'extracto' = leído del export · 'manual' = cargado a mano
  fuente text not null default 'api',
  created_at timestamptz not null default now(),
  -- Un saldo por cuenta y día. El sync corre varias veces al día y pisa el valor.
  unique (cuenta, fecha)
);

create index if not exists idx_saldos_cuentas_cuenta_fecha on saldos_cuentas (cuenta, fecha desc);

alter table saldos_cuentas enable row level security;

drop policy if exists "saldos_cuentas_select" on saldos_cuentas;
create policy "saldos_cuentas_select" on saldos_cuentas for select to authenticated using (true);

drop policy if exists "saldos_cuentas_write" on saldos_cuentas;
create policy "saldos_cuentas_write" on saldos_cuentas for all to authenticated using (true) with check (true);
