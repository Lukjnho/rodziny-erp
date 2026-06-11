-- 104 — Permiso propio para Integraciones (Documentos del contador)
-- Convierte el acceso de "solo-admin" a un permiso por módulo (puede_ver_integraciones)
-- y abre las tablas que usa la página a ese permiso, para dar acceso a no-admins de confianza.

alter table public.perfiles
  add column if not exists puede_ver_integraciones boolean not null default false;

-- tiene_permiso: agrega el caso 'integraciones' preservando los existentes.
create or replace function public.tiene_permiso(modulo text)
returns boolean language sql security definer set search_path to 'public'
as $function$
  select case
    when auth.uid() is null then false
    when (select es_admin from perfiles where user_id = auth.uid()) then true
    else coalesce(
      (select case modulo
        when 'dashboard' then puede_ver_dashboard
        when 'ventas' then puede_ver_ventas
        when 'finanzas' then puede_ver_finanzas
        when 'edr' then puede_ver_edr
        when 'gastos' then puede_ver_gastos
        when 'amortizaciones' then puede_ver_amortizaciones
        when 'rrhh' then puede_ver_rrhh
        when 'compras' then puede_ver_compras
        when 'usuarios' then puede_ver_usuarios
        when 'cocina' then puede_ver_cocina
        when 'almacen' then puede_ver_almacen
        when 'integraciones' then puede_ver_integraciones
        else false end
      from perfiles where user_id = auth.uid()), false)
  end;
$function$;

-- ── Tablas propias de Integraciones: pasar de solo-admin a tiene_permiso('integraciones') ──
drop policy if exists recibos_sueldo_admin_all on public.recibos_sueldo;
drop policy if exists recibos_sueldo_integraciones on public.recibos_sueldo;
create policy recibos_sueldo_integraciones on public.recibos_sueldo
  for all to authenticated using (tiene_permiso('integraciones')) with check (tiene_permiso('integraciones'));

drop policy if exists veps_admin_all on public.veps;
drop policy if exists veps_integraciones on public.veps;
create policy veps_integraciones on public.veps
  for all to authenticated using (tiene_permiso('integraciones')) with check (tiene_permiso('integraciones'));

drop policy if exists correo_remitentes_admin_all on public.correo_remitentes;
drop policy if exists correo_remitentes_integraciones on public.correo_remitentes;
create policy correo_remitentes_integraciones on public.correo_remitentes
  for all to authenticated using (tiene_permiso('integraciones')) with check (tiene_permiso('integraciones'));

drop policy if exists correo_mensajes_admin_read on public.correo_mensajes;
drop policy if exists correo_mensajes_integraciones on public.correo_mensajes;
create policy correo_mensajes_integraciones on public.correo_mensajes
  for select to authenticated using (tiene_permiso('integraciones'));

-- ── Storage del bucket de documentos: leer/subir/borrar para integraciones ──
-- (el front borra el PDF completo tras cortarlo por empleado; antes faltaba el delete)
drop policy if exists correos_contadores_admin_read on storage.objects;
drop policy if exists correos_contadores_admin_insert on storage.objects;
drop policy if exists correos_contadores_integraciones_read on storage.objects;
drop policy if exists correos_contadores_integraciones_insert on storage.objects;
drop policy if exists correos_contadores_integraciones_delete on storage.objects;
create policy correos_contadores_integraciones_read on storage.objects
  for select to authenticated using (bucket_id = 'correos-contadores' and tiene_permiso('integraciones'));
create policy correos_contadores_integraciones_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'correos-contadores' and tiene_permiso('integraciones'));
create policy correos_contadores_integraciones_delete on storage.objects
  for delete to authenticated using (bucket_id = 'correos-contadores' and tiene_permiso('integraciones'));

-- RPC de estado de conexión: abrir a integraciones (Outlook dormido)
create or replace function public.correo_integracion_estado()
returns table (conectado boolean, email_casilla text, ultima_lectura timestamptz, ultimo_error text, updated_at timestamptz)
language plpgsql security definer set search_path to 'public'
as $$
begin
  if not tiene_permiso('integraciones') then raise exception 'no autorizado'; end if;
  return query select c.conectado, c.email_casilla, c.ultima_lectura, c.ultimo_error, c.updated_at
    from public.correo_integracion c where c.id = 1;
end; $$;

-- ── pagos_fijos: permiso ADITIVO de inserción para que Integraciones cree el Pago Fijo del VEP ──
-- (no les da ver/editar el resto de la parte financiera; solo insertar)
drop policy if exists pagos_fijos_integraciones_insert on public.pagos_fijos;
create policy pagos_fijos_integraciones_insert on public.pagos_fijos
  for insert to authenticated with check (tiene_permiso('integraciones'));
