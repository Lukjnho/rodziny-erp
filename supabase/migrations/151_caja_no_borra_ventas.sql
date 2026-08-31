-- 151 — El cajero no borra ni edita ventas
--
-- La migración 146 le dio al cajero permiso `for all` sobre las ventas del POS
-- con un único filtro: `origen = 'pos'`. O sea que podía borrar o retocar
-- CUALQUIER venta del punto de venta: la de otro turno, la de otro local, la de
-- un turno ya cerrado. Y eso es plata: el esperado del arqueo se calcula
-- sumando los cobros del turno, así que borrando un ticket de efectivo antes de
-- cerrar, el faltante desaparece del cálculo y la caja cuadra con la plata en
-- el bolsillo. Administración ve el mismo número ya mutilado.
--
-- Decisión de Lucas (31-ago-2026): el cajero NO anula ventas. Si se equivocó,
-- pide un administrador. La pantalla se lo dice con todas las letras.
--
-- Acá se parte aquel `for all` en permisos separados: VER y COBRAR sí, EDITAR y
-- BORRAR no. Con una sola excepción, la de abajo.
--
-- ⚠️ LA EXCEPCIÓN — deshacer un cobro a medio grabar
--    Cobrar son tres pasos (ticket → líneas → cobros). Si falla el 2º o el 3º,
--    el código borra el ticket recién creado para no dejar una venta trucha
--    (useCaja.ts, tres lugares). En los tres casos el ticket todavía NO tiene
--    ni un cobro registrado, y una venta de verdad SIEMPRE tiene al menos uno.
--    Por eso el permiso de borrar queda atado a: ticket sin cobros + turno del
--    POS todavía abierto. Es la ventana justa para deshacer, y nada más.
--
-- El administrador no pierde nada: `ventas_tickets_all` (y sus hermanas) piden
-- `tiene_permiso('ventas')`, y `tiene_permiso` devuelve true para cualquier
-- módulo cuando el perfil tiene `es_admin`. Las políticas se suman con OR.

begin;

-- ── ¿El ticket todavía no tiene ningún cobro? ────────────────────────────────
-- Va `security definer` a propósito: si la pregunta se hiciera con los permisos
-- del cajero, un cambio futuro en la RLS de `ventas_pagos` podría esconderle un
-- cobro y hacerle creer que el ticket está vacío — o sea, volver a habilitarle
-- el borrado sin que nadie se entere.
create or replace function public.ticket_pos_sin_cobros(p_ticket uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.ventas_pagos where ticket_id = p_ticket
  );
$$;

comment on function public.ticket_pos_sin_cobros(uuid) is
  'true si el ticket no tiene ningún cobro registrado. Se usa en la política de borrado del POS: es la ventana para deshacer un cobro que falló a mitad de camino.';

revoke all on function public.ticket_pos_sin_cobros(uuid) from public;
grant execute on function public.ticket_pos_sin_cobros(uuid) to authenticated;

-- ── Los tickets ──────────────────────────────────────────────────────────────

drop policy if exists ventas_tickets_caja on public.ventas_tickets;

create policy ventas_tickets_caja_ver on public.ventas_tickets
  for select to authenticated
  using (tiene_permiso('caja') and origen = 'pos');

create policy ventas_tickets_caja_cobrar on public.ventas_tickets
  for insert to authenticated
  with check (tiene_permiso('caja') and origen = 'pos');

-- Sin política de UPDATE: una venta cobrada no se retoca.

create policy ventas_tickets_caja_deshacer on public.ventas_tickets
  for delete to authenticated
  using (
    tiene_permiso('caja')
    and origen = 'pos'
    and public.ticket_pos_sin_cobros(id)
    and exists (
      select 1
        from public.cierres_caja c
       where c.id = ventas_tickets.cierre_caja_id
         and c.origen = 'pos'
         and c.hora_cierre is null
    )
  );

-- ── Las líneas y los cobros ──────────────────────────────────────────────────
-- Solo ver y grabar. No hace falta borrarlos a mano: cuando se deshace un cobro
-- se borra el ticket y las dos tablas se van con él por ON DELETE CASCADE (que
-- corre por cuenta del sistema y no pasa por estas políticas).

drop policy if exists ventas_items_caja on public.ventas_items;

create policy ventas_items_caja_ver on public.ventas_items
  for select to authenticated
  using (tiene_permiso('caja') and origen = 'pos');

create policy ventas_items_caja_cobrar on public.ventas_items
  for insert to authenticated
  with check (tiene_permiso('caja') and origen = 'pos');

drop policy if exists ventas_pagos_caja on public.ventas_pagos;

create policy ventas_pagos_caja_ver on public.ventas_pagos
  for select to authenticated
  using (tiene_permiso('caja') and origen = 'pos');

create policy ventas_pagos_caja_cobrar on public.ventas_pagos
  for insert to authenticated
  with check (tiene_permiso('caja') and origen = 'pos');

commit;
