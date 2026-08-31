-- 150 — Dos agujeros que encontró la revisión del 31-ago-2026
--
-- ── 1. Cualquier usuario podía darse `es_admin = true` ──────────────────────
--
-- La política `perfiles_update_propio` deja a cada usuario editar SU propia fila
-- de `perfiles`, y el rol `authenticated` tiene GRANT UPDATE sobre todas las
-- columnas — `es_admin` incluida. No había nada que lo frenara.
--
-- O sea que el cajero que se crea con el preset "Cajero (solo la caja)" podía,
-- desde la consola del navegador y en una línea, hacerse administrador y ver
-- finanzas, sueldos, costos y la plata de la caja fuerte. Todo el arqueo a
-- ciegas y las políticas acotadas de las migraciones 146 y 147 se salteaban así.
-- Comprobado en la base: el UPDATE pasaba y quedaba es_admin = true.
--
-- No alcanza con arreglar la política: WITH CHECK no puede mirar la fila vieja,
-- así que no puede distinguir "se subió el permiso" de "ya lo tenía". Y revocar
-- el GRANT de columna rompería la pantalla de Usuarios, porque el administrador
-- también entra como `authenticated`. Por eso va un disparador.
--
-- ── 2. `ventas_pagos` no sabía de dónde venía ───────────────────────────────
--
-- El importador de Fudo BORRA y reinserta los últimos 2 meses filtrando solo por
-- local y período. `ventas_tickets` y `ventas_items` tienen `origen` (migración
-- 141) pero `ventas_pagos` no, así que no había forma de dejar afuera los pagos
-- del POS. Con el cron diario de las 8, las ventas propias se borraban solas
-- todas las mañanas. Acá se le da la misma columna que a las otras dos.

begin;

-- ── 1. Nadie se asciende solo ────────────────────────────────────────────────

create or replace function public.trg_perfiles_no_autoescalar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_viejo jsonb;
  v_nuevo jsonb;
  v_campo text;
begin
  -- Llamada del servidor (edge function con service_role): no hay usuario y RLS
  -- ya quedó atrás. Es el camino por el que `gestionar-usuario` crea usuarios y
  -- les asigna el preset; si lo bloqueáramos, no se podría dar de alta a nadie.
  if auth.uid() is null then
    return NEW;
  end if;

  -- Un administrador sí puede repartir permisos: es su trabajo.
  if es_admin_actual() then
    return NEW;
  end if;

  if NEW.es_admin is distinct from OLD.es_admin then
    raise exception 'Solo un administrador puede dar o sacar el permiso de administrador.'
      using errcode = 'insufficient_privilege';
  end if;

  v_viejo := to_jsonb(OLD);
  v_nuevo := to_jsonb(NEW);

  for v_campo in select jsonb_object_keys(v_viejo) loop
    if v_campo like 'puede\_ver\_%' or v_campo = 'local_restringido' then
      if v_viejo -> v_campo is distinct from v_nuevo -> v_campo then
        raise exception
          'Solo un administrador puede cambiar los permisos (intentaste cambiar "%").', v_campo
          using errcode = 'insufficient_privilege';
      end if;
    end if;
  end loop;

  return NEW;
end
$fn$;

drop trigger if exists perfiles_no_autoescalar on public.perfiles;
create trigger perfiles_no_autoescalar
  before update on public.perfiles
  for each row execute function public.trg_perfiles_no_autoescalar();

-- ── 2. De dónde viene cada pago ──────────────────────────────────────────────

alter table public.ventas_pagos
  add column if not exists origen text not null default 'fudo';

alter table public.ventas_pagos
  drop constraint if exists ventas_pagos_origen_check;
alter table public.ventas_pagos
  add constraint ventas_pagos_origen_check check (origen in ('fudo', 'pos', 'manual'));

comment on column public.ventas_pagos.origen is
  'fudo | pos | manual. Igual que en ventas_tickets y ventas_items. El importador BORRA y reinserta meses enteros: sin esta columna se llevaba puestos los pagos del POS.';

-- Los pagos existentes heredan el origen de su ticket; los que quedaron sin
-- ticket son de Fudo (el POS siempre lo enlaza).
update public.ventas_pagos p
   set origen = t.origen
  from public.ventas_tickets t
 where t.id = p.ticket_id
   and p.origen is distinct from t.origen;

create index if not exists idx_ventas_pagos_origen on public.ventas_pagos (local, periodo, origen);

-- Ahora la política del cajero se resuelve por la columna, sin subconsulta.
drop policy if exists ventas_pagos_caja on public.ventas_pagos;
create policy ventas_pagos_caja on public.ventas_pagos
  for all to authenticated
  using (tiene_permiso('caja') and origen = 'pos')
  with check (tiene_permiso('caja') and origen = 'pos');

commit;
