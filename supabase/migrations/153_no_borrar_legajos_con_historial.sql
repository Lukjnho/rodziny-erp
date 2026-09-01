-- 153 — Blindar los legajos: que borrar una persona NO se lleve puesto su historial.
--
-- PROBLEMA DETECTADO (1-sep-2026):
--   10 de las 12 tablas que cuelgan de 'empleados' estaban en ON DELETE CASCADE.
--   Borrar un legajo desde la pantalla de RRHH borraba EN SILENCIO y sin error:
--   fichadas, cronograma, liquidaciones quincenales, sueldos mensuales, adelantos,
--   aguinaldos, vacaciones, bonos, descuentos y sanciones.
--   Las otras 2 (pagos_sueldos, recibos_sueldo) estaban en SET NULL: el pago sobrevivía
--   pero perdía al dueño => plata huérfana en Finanzas.
--
-- SOLUCIÓN: todas pasan a RESTRICT. La base misma rechaza el borrado de cualquier
-- legajo que tenga UN solo registro asociado. Un legajo recién creado por error
-- (sin historial) se sigue pudiendo borrar, que es el único caso legítimo.
--
-- Además: fecha de egreso + motivo de baja, y un disparador que garantiza que una
-- baja corte el fichaje de verdad (hoy hay 3 personas en estado 'baja' con activo=true,
-- o sea que podrían seguir fichando con su DNI + PIN).

-- ── 1. Borrado en cadena => borrado bloqueado ──────────────────────────────
alter table public.adelantos
  drop constraint adelantos_empleado_id_fkey,
  add constraint adelantos_empleado_id_fkey
    foreign key (empleado_id) references public.empleados(id) on delete restrict;

alter table public.aguinaldos
  drop constraint aguinaldos_empleado_id_fkey,
  add constraint aguinaldos_empleado_id_fkey
    foreign key (empleado_id) references public.empleados(id) on delete restrict;

alter table public.bonos
  drop constraint bonos_empleado_id_fkey,
  add constraint bonos_empleado_id_fkey
    foreign key (empleado_id) references public.empleados(id) on delete restrict;

alter table public.cronograma
  drop constraint cronograma_empleado_id_fkey,
  add constraint cronograma_empleado_id_fkey
    foreign key (empleado_id) references public.empleados(id) on delete restrict;

alter table public.descuentos
  drop constraint descuentos_empleado_id_fkey,
  add constraint descuentos_empleado_id_fkey
    foreign key (empleado_id) references public.empleados(id) on delete restrict;

alter table public.fichadas
  drop constraint fichadas_empleado_id_fkey,
  add constraint fichadas_empleado_id_fkey
    foreign key (empleado_id) references public.empleados(id) on delete restrict;

alter table public.liquidaciones_quincenales
  drop constraint liquidaciones_quincenales_empleado_id_fkey,
  add constraint liquidaciones_quincenales_empleado_id_fkey
    foreign key (empleado_id) references public.empleados(id) on delete restrict;

alter table public.sanciones
  drop constraint sanciones_empleado_id_fkey,
  add constraint sanciones_empleado_id_fkey
    foreign key (empleado_id) references public.empleados(id) on delete restrict;

alter table public.sueldos_mensuales
  drop constraint sueldos_mensuales_empleado_id_fkey,
  add constraint sueldos_mensuales_empleado_id_fkey
    foreign key (empleado_id) references public.empleados(id) on delete restrict;

alter table public.vacaciones
  drop constraint vacaciones_empleado_id_fkey,
  add constraint vacaciones_empleado_id_fkey
    foreign key (empleado_id) references public.empleados(id) on delete restrict;

-- ── 2. SET NULL => bloqueado (no más pagos huérfanos) ──────────────────────
alter table public.pagos_sueldos
  drop constraint pagos_sueldos_empleado_id_fkey,
  add constraint pagos_sueldos_empleado_id_fkey
    foreign key (empleado_id) references public.empleados(id) on delete restrict;

alter table public.recibos_sueldo
  drop constraint recibos_sueldo_empleado_id_fkey,
  add constraint recibos_sueldo_empleado_id_fkey
    foreign key (empleado_id) references public.empleados(id) on delete restrict;

-- ── 3. Fecha de egreso y motivo de baja ────────────────────────────────────
alter table public.empleados
  add column if not exists fecha_egreso date,
  add column if not exists motivo_baja text;

alter table public.empleados
  drop constraint if exists empleados_motivo_baja_check;
alter table public.empleados
  add constraint empleados_motivo_baja_check
  check (
    motivo_baja is null
    or motivo_baja in ('renuncia', 'despido', 'fin_contrato', 'abandono', 'acuerdo', 'otro')
  );

comment on column public.empleados.fecha_egreso is
  'Último día trabajado. Se completa sola al pasar el estado laboral a baja.';
comment on column public.empleados.motivo_baja is
  'renuncia | despido | fin_contrato | abandono | acuerdo | otro';

-- ── 4. Que la baja corte el fichaje de verdad ──────────────────────────────
-- La pantalla de fichaje (FicharPage) filtra SOLO por 'activo'. Si alguien marca
-- estado_laboral='baja' pero deja activo=true, la persona sigue pudiendo fichar.
-- Este disparador ata las dos cosas para que no dependa de que nadie se olvide.
create or replace function public.aplicar_baja_empleado()
returns trigger
language plpgsql
as $$
begin
  if new.estado_laboral = 'baja' then
    new.activo := false;
    if new.fecha_egreso is null then
      -- fecha operativa argentina, no UTC
      new.fecha_egreso := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
    end if;
  elsif tg_op = 'UPDATE' and old.estado_laboral = 'baja' and new.estado_laboral <> 'baja' then
    -- baja corregida o reingreso: se reabre el legajo y se limpian los datos de egreso
    new.activo := true;
    new.fecha_egreso := null;
    new.motivo_baja := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_aplicar_baja_empleado on public.empleados;
create trigger trg_aplicar_baja_empleado
  before insert or update on public.empleados
  for each row execute function public.aplicar_baja_empleado();

-- ── 5. Ordenar las bajas que ya existen ────────────────────────────────────
-- 4 personas en estado 'baja', 3 de ellas con activo=true (podían seguir fichando).
-- La fecha de egreso se estima con su última fichada real; si no tiene, con la
-- fecha en que se editó el legajo por última vez. Queda para revisar a mano.
update public.empleados e
set fecha_egreso = coalesce(
      e.fecha_egreso,
      (select max(f.fecha) from public.fichadas f where f.empleado_id = e.id),
      e.updated_at::date
    )
where e.estado_laboral = 'baja';
