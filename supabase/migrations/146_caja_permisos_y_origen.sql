-- 146 — La caja, vinculada de punta a punta
--
-- Dos cosas, las dos aditivas:
--
-- 1) `cierres_caja.origen`: dice si el arqueo lo abrió el POS o lo cargó
--    administración a mano. Hasta ahora se distinguía mirando `hora_inicio`,
--    que es frágil: el formulario de administración también puede completarla.
--    Con esto el vínculo es explícito.
--
--    ⚠️ Por qué hacía falta: `hora_cierre` está en NULL en las 822 filas de la
--    tabla — administración nunca la completa. O sea que "turno abierto =
--    hora_cierre IS NULL" daba 15 falsos positivos por semana y, peor, el POS
--    podía agarrar un cierre cargado por administración como si fuera el turno
--    del cajero y meterle los tickets adentro.
--
-- 2) El permiso `caja` (migración 143) abría la pantalla pero la base le
--    cerraba la puerta: las políticas pedían finanzas/gastos para los cierres,
--    ventas para los tickets y cocina/productos para el catálogo. O sea que la
--    caja solo la podía usar un administrador. Acá se SUMAN políticas para el
--    cajero, acotadas a lo suyo (origen = 'pos'). No se le saca el permiso a
--    nadie: en Postgres las políticas se suman con OR.

begin;

-- ── 1. De dónde salió el arqueo ──────────────────────────────────────────────

alter table public.cierres_caja
  add column if not exists origen text not null default 'manual';

alter table public.cierres_caja
  drop constraint if exists cierres_caja_origen_check;
alter table public.cierres_caja
  add constraint cierres_caja_origen_check check (origen in ('manual', 'pos'));

comment on column public.cierres_caja.origen is
  'manual = lo cargó administración desde Finanzas → Cierre de Caja; pos = lo abrió y lo cerró el cajero desde el punto de venta.';

-- Backfill: el único arqueo abierto por el POS hasta hoy es el que tiene hora
-- de inicio (administración nunca la carga).
update public.cierres_caja
   set origen = 'pos'
 where hora_inicio is not null
   and origen = 'manual';

-- El POS pregunta todo el tiempo "¿tengo un turno abierto en esta caja?".
create index if not exists idx_cierres_caja_pos_abiertos
  on public.cierres_caja (local, caja, fecha desc)
  where origen = 'pos' and hora_cierre is null;

-- ── 2. Permisos del cajero ───────────────────────────────────────────────────

-- Los arqueos del POS: el cajero los ve, los abre y los cierra. Los cierres
-- cargados por administración NO los ve (ahí hay plata de caja fuerte).
drop policy if exists cierres_caja_del_pos on public.cierres_caja;
create policy cierres_caja_del_pos on public.cierres_caja
  for select to authenticated
  using (tiene_permiso('caja') and origen = 'pos');

drop policy if exists cierres_caja_abrir_pos on public.cierres_caja;
create policy cierres_caja_abrir_pos on public.cierres_caja
  for insert to authenticated
  with check (tiene_permiso('caja') and origen = 'pos');

-- Solo mientras el turno está abierto: una vez cerrado, el cajero no lo toca
-- más. USING mira la fila vieja (todavía sin hora_cierre) y WITH CHECK la
-- nueva, así el propio cierre pasa pero un segundo retoque no.
drop policy if exists cierres_caja_cerrar_pos on public.cierres_caja;
create policy cierres_caja_cerrar_pos on public.cierres_caja
  for update to authenticated
  using (tiene_permiso('caja') and origen = 'pos' and hora_cierre is null)
  with check (tiene_permiso('caja') and origen = 'pos');

-- Las ventas que cobra el POS. Las de Fudo quedan fuera de su alcance.
drop policy if exists ventas_tickets_caja on public.ventas_tickets;
create policy ventas_tickets_caja on public.ventas_tickets
  for all to authenticated
  using (tiene_permiso('caja') and origen = 'pos')
  with check (tiene_permiso('caja') and origen = 'pos');

drop policy if exists ventas_items_caja on public.ventas_items;
create policy ventas_items_caja on public.ventas_items
  for all to authenticated
  using (tiene_permiso('caja') and origen = 'pos')
  with check (tiene_permiso('caja') and origen = 'pos');

-- `ventas_pagos` no tiene columna `origen`: se resuelve por el ticket.
drop policy if exists ventas_pagos_caja on public.ventas_pagos;
create policy ventas_pagos_caja on public.ventas_pagos
  for all to authenticated
  using (
    tiene_permiso('caja')
    and exists (
      select 1 from public.ventas_tickets t
       where t.id = ventas_pagos.ticket_id and t.origen = 'pos'
    )
  )
  with check (
    tiene_permiso('caja')
    and exists (
      select 1 from public.ventas_tickets t
       where t.id = ventas_pagos.ticket_id and t.origen = 'pos'
    )
  );

create index if not exists idx_ventas_pagos_ticket_id
  on public.ventas_pagos (ticket_id);

-- El catálogo: solo lectura. El cajero cobra lo que hay, no lo edita.
drop policy if exists cocina_recetas_caja_select on public.cocina_recetas;
create policy cocina_recetas_caja_select on public.cocina_recetas
  for select to authenticated
  using (tiene_permiso('caja'));

drop policy if exists precios_recetas_canal_caja_select on public.cocina_recetas_precios_canal;
create policy precios_recetas_canal_caja_select on public.cocina_recetas_precios_canal
  for select to authenticated
  using (tiene_permiso('caja'));

commit;
