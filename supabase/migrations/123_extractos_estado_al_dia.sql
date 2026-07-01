-- 123 — Estado "al día" por cuenta bancaria (semáforo de Conciliación)
--
-- El semáforo de las tarjetas de banco (Conciliación) se calculaba solo con la
-- fecha del ÚLTIMO MOVIMIENTO del extracto. Para cuentas de poco movimiento (ICBC),
-- eso deja la tarjeta en rojo "hace 9d" aunque el extracto esté al día: simplemente
-- no hubo movimientos nuevos, no es que falte importar.
--
-- Esta tabla guarda, por cuenta, hasta qué fecha el usuario confirma que el extracto
-- está al día. El semáforo usa el MÁXIMO entre el último movimiento y esta fecha.
-- Es un dato de UI (confirmación manual), compartido entre usuarios.

create table if not exists public.extractos_estado (
  cuenta          text primary key check (cuenta in ('mercadopago', 'galicia', 'icbc')),
  al_dia_hasta    date not null,
  actualizado_por uuid,
  actualizado_en  timestamptz not null default now()
);

alter table public.extractos_estado enable row level security;

-- Mismo alcance que la Conciliación: quien maneja compras/gastos/finanzas.
drop policy if exists extractos_estado_rw on public.extractos_estado;
create policy extractos_estado_rw on public.extractos_estado
  for all to authenticated
  using (tiene_permiso('compras') or tiene_permiso('gastos') or tiene_permiso('finanzas'))
  with check (tiene_permiso('compras') or tiene_permiso('gastos') or tiene_permiso('finanzas'));
