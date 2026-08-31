-- 147 — El arqueo, medio por medio, y a ciegas para el cajero
--
-- Hasta acá el cierre comparaba UNA sola cosa: el efectivo del cajón. El resto
-- (QR, débito, crédito, transferencia, MP) se guardaba como "lo que dice el
-- sistema" y nadie lo contrastaba contra nada.
--
-- Ahora el cajero declara, medio por medio, cuánto tiene: cuenta la plata del
-- cajón y lee el cierre de lote de cada terminal. Esta tabla guarda las dos
-- puntas — lo que dice el sistema y lo que declaró el cajero — y la diferencia
-- la calcula sola la base.
--
-- ⚠️ ARQUEO A CIEGAS (decisión de Lucas, 31-ago-2026): el cajero **no ve** lo
-- que debería tener; carga lo que tiene y cierra. El que ve los esperados, el
-- total y las diferencias es administración. Si el cajero viera el número,
-- "cuadrar" dejaría de significar algo. Eso se resuelve en la pantalla; acá lo
-- que se hace es guardar las dos puntas por separado para poder compararlas.

begin;

create table if not exists public.cierres_caja_medios (
  id uuid primary key default gen_random_uuid(),
  cierre_caja_id uuid not null references public.cierres_caja(id) on delete cascade,
  medio_pago_id uuid not null references public.medios_pago(id),
  -- lo que dice el sistema que se cobró con ese medio. En efectivo incluye el
  -- fondo de apertura y le resta los retiros: es lo que tiene que estar en el
  -- cajón, no lo que se cobró.
  esperado numeric(14, 2) not null default 0,
  -- lo que el cajero contó / leyó del cierre de lote
  declarado numeric(14, 2) not null default 0,
  diferencia numeric(14, 2) generated always as (declarado - esperado) stored,
  created_at timestamptz not null default now(),
  unique (cierre_caja_id, medio_pago_id)
);

comment on table public.cierres_caja_medios is
  'Arqueo desglosado por medio de pago. `esperado` lo pone el sistema, `declarado` lo carga el cajero sin ver el esperado (arqueo a ciegas).';

create index if not exists idx_cierres_caja_medios_cierre
  on public.cierres_caja_medios (cierre_caja_id);

alter table public.cierres_caja_medios enable row level security;

-- ⚠️ Las tablas nuevas nacen legibles por `anon` por los permisos por defecto
-- de Supabase. Se los sacamos: acá hay plata de la caja.
revoke all on public.cierres_caja_medios from anon;

-- Administración: acceso completo, igual que a `cierres_caja`.
drop policy if exists cierres_caja_medios_admin on public.cierres_caja_medios;
create policy cierres_caja_medios_admin on public.cierres_caja_medios
  for all to authenticated
  using (tiene_permiso('finanzas') or tiene_permiso('gastos'))
  with check (tiene_permiso('finanzas') or tiene_permiso('gastos'));

-- El cajero: solo los renglones de SUS arqueos (los del POS).
drop policy if exists cierres_caja_medios_caja_select on public.cierres_caja_medios;
create policy cierres_caja_medios_caja_select on public.cierres_caja_medios
  for select to authenticated
  using (
    tiene_permiso('caja')
    and exists (
      select 1 from public.cierres_caja c
       where c.id = cierres_caja_medios.cierre_caja_id and c.origen = 'pos'
    )
  );

drop policy if exists cierres_caja_medios_caja_insert on public.cierres_caja_medios;
create policy cierres_caja_medios_caja_insert on public.cierres_caja_medios
  for insert to authenticated
  with check (
    tiene_permiso('caja')
    and exists (
      select 1 from public.cierres_caja c
       where c.id = cierres_caja_medios.cierre_caja_id and c.origen = 'pos'
    )
  );

-- Puede borrar y volver a cargar SOLO mientras el turno sigue abierto. Es lo
-- que permite reintentar un cierre que falló a mitad de camino sin chocar con
-- la clave única. Una vez cerrado, no lo toca más: no hay política de UPDATE
-- para el cajero, así que lo declarado queda como quedó.
drop policy if exists cierres_caja_medios_caja_delete on public.cierres_caja_medios;
create policy cierres_caja_medios_caja_delete on public.cierres_caja_medios
  for delete to authenticated
  using (
    tiene_permiso('caja')
    and exists (
      select 1 from public.cierres_caja c
       where c.id = cierres_caja_medios.cierre_caja_id
         and c.origen = 'pos'
         and c.hora_cierre is null
    )
  );

commit;
