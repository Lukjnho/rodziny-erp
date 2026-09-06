-- ─────────────────────────────────────────────────────────────────────────────
-- 186 — Se cierra la puerta de empleados (PARTE 2 de 2)
--
-- ⚠️ ESTA MIGRACIÓN NO SE APLICA HASTA QUE LAS PANTALLAS NUEVAS ESTÉN ARRIBA.
-- Antes de correrla tiene que estar desplegado el código que usa
-- `v_empleados_publicos`, `fichaje_login()` y `fichaje_sesion()` (migración 185).
-- Si se corre antes, la gente no puede fichar y las tablets de Cocina se quedan
-- sin lista de responsables. Ver el encabezado de la 185 para el porqué completo.
--
-- Lo que hace: le saca a `anon` el acceso a la tabla `empleados`. Después de
-- esto, con la clave pública NO se pueden leer más sueldos, DNI, CBU ni PIN.
--
-- Lo que NO cambia: administración (usuarios con permiso de RRHH) sigue viendo
-- todo igual — esas policies son del rol `authenticated` y no se tocan.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists empleados_anon_select on public.empleados;

-- El GRANT también se va: sin él, aunque mañana alguien escriba una policy nueva
-- por error, `anon` sigue sin poder leer la tabla. Son dos candados, no uno.
-- (El INSERT y el UPDATE que `anon` tenía concedidos tampoco tenían por qué
--  existir: ninguna pantalla pública da de alta ni edita empleados.)
revoke all on public.empleados from anon;

-- ── Guardarraíl: que no se vuelva a abrir sin querer ────────────────────────
do $$
declare
  v_policies int;
begin
  select count(*) into v_policies
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
   where c.relname = 'empleados'
     and 'anon' = any (select r.rolname from pg_roles r where r.oid = any (p.polroles));

  if v_policies > 0 then
    raise exception 'Quedaron % policies de empleados para anon.', v_policies;
  end if;

  if has_table_privilege('anon', 'public.empleados', 'SELECT') then
    raise exception 'anon todavía puede leer la tabla empleados.';
  end if;

  if has_column_privilege('anon', 'public.empleados', 'sueldo_neto', 'SELECT') then
    raise exception 'anon todavía puede leer la columna sueldo_neto.';
  end if;

  if has_column_privilege('anon', 'public.empleados', 'pin_fichaje', 'SELECT') then
    raise exception 'anon todavía puede leer la columna pin_fichaje.';
  end if;

  -- y que lo que SÍ tiene que seguir andando, siga andando
  if not has_table_privilege('anon', 'public.v_empleados_publicos', 'SELECT') then
    raise exception 'anon perdió v_empleados_publicos: las tablets de Cocina se quedan sin gente.';
  end if;
  if not has_function_privilege('anon', 'public.fichaje_login(text, text)', 'EXECUTE') then
    raise exception 'anon perdió fichaje_login: nadie puede fichar.';
  end if;
end $$;
