-- ─────────────────────────────────────────────────────────────────────────────
-- 185 — Los sueldos dejan de estar a la vista (PARTE 1 de 2: la puerta buena)
--
-- QUÉ PASA HOY (verificado contra producción el 6-sep-2026, no deducido):
-- la tabla `empleados` tiene una policy `empleados_anon_select` con `using (true)`
-- y el rol `anon` tiene GRANT SELECT sobre TODAS las columnas. O sea que con la
-- clave pública —la misma que viaja adentro de la página y que cualquiera puede
-- leer del navegador— un GET a /rest/v1/empleados devuelve, sin usuario ni
-- contraseña, de los dos locales:
--
--     nombre · apellido · DNI · teléfono · email · sueldo_neto · cbu ·
--     alias_bancario · cuenta_sueldo · pin_fichaje · observaciones
--
-- Y hay algo peor: el `pin_fichaje` son LOS ÚLTIMOS 4 DÍGITOS DEL DNI. Así que
-- ni siquiera hace falta leer la tabla: con saber el DNI de alguien ya se tiene
-- su PIN, y con el PIN se ficha por esa persona.
--
-- POR QUÉ ESTÁ ABIERTA: la pantalla de fichaje (/fichar) es pública —entra como
-- `anon` porque el que ficha no tiene usuario del ERP— y hace `select('*')` para
-- comparar el PIN EN EL NAVEGADOR. El navegador es de quien lo tiene en la mano:
-- comparar ahí obliga a mandarle el PIN, y mandarle el PIN obliga a abrir la tabla.
--
-- ⚠️ POR QUÉ ESTO VA EN DOS MIGRACIONES Y NO EN UNA
-- Cerrar la puerta y cambiar las pantallas en el mismo movimiento deja un rato en
-- que la base ya dice que no y el navegador todavía tiene el código viejo —el
-- caché de la PWA se queda pegado— y en ese rato NADIE PUEDE FICHAR. Eso toca
-- sueldos. Así que:
--   · 185 (ésta) abre la puerta buena y NO toca la vieja: no rompe nada.
--   · se cambian las pantallas y se despliega.
--   · 186 recién ahí cierra la puerta vieja.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Lo público: quién trabaja acá ────────────────────────────────────────
--
-- La usan las pantallas de tablet de Cocina (ResponsableSelect y
-- ResponsableBotones) para preguntar "¿quién está haciendo esta tanda?".
-- Necesitan exactamente estas columnas y ninguna más.
--
-- ⚠️ Esta vista va SIN `security_invoker` a propósito (queda en el default, que
-- es "con los permisos del dueño"). Tiene que poder leer una tabla que `anon` ya
-- NO va a poder leer: si fuera invoker devolvería cero filas, en silencio, y las
-- tablets se quedarían sin lista de gente sin ningún error en pantalla.
-- Mismo criterio que `v_cocina_stock_mostrador`.
create or replace view public.v_empleados_publicos as
  select e.id,
         e.nombre,
         e.apellido,
         e.puesto,
         e.es_produccion,
         e.local,
         e.activo
    from public.empleados e
   where e.activo is true;

comment on view public.v_empleados_publicos is
  'Lo único que una pantalla pública necesita saber de una persona: quién es y qué hace. Sin DNI, sin sueldo, sin CBU, sin PIN. Migración 185.';

-- ── 2. El fichaje compara el PIN adentro de la base ─────────────────────────
--
-- Devuelve la fila SOLO si el PIN coincide. Si no, no devuelve nada: la pantalla
-- no puede distinguir "DNI que no existe" de "PIN equivocado", que es justamente
-- lo que evita que alguien pruebe DNIs para ver cuáles existen.
create or replace function public.fichaje_login(p_dni text, p_pin text)
returns table (
  id                          uuid,
  nombre                      text,
  apellido                    text,
  local                       text,
  horario_tipo                text,
  horas_semanales_requeridas  integer
)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, e.nombre, e.apellido, e.local, e.horario_tipo, e.horas_semanales_requeridas
    from public.empleados e
   where e.dni = btrim(coalesce(p_dni, ''))
     and e.activo is true
     and e.pin_fichaje is not null
     and btrim(e.pin_fichaje) = btrim(coalesce(p_pin, ''))
   limit 1;
$$;

comment on function public.fichaje_login(text, text) is
  'Login de /fichar. El PIN se compara acá adentro y NUNCA sale de la base. Si no coincide devuelve cero filas, sin decir si el que falló fue el DNI o el PIN.';

-- La tablet guarda el id de la persona para no pedirle el PIN en cada pantalla.
-- Esto devuelve los mismos datos públicos para ese id — nada sensible, así que
-- alcanza con que el id sea un uuid (no se puede adivinar).
create or replace function public.fichaje_sesion(p_id uuid)
returns table (
  id                          uuid,
  nombre                      text,
  apellido                    text,
  local                       text,
  horario_tipo                text,
  horas_semanales_requeridas  integer
)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, e.nombre, e.apellido, e.local, e.horario_tipo, e.horas_semanales_requeridas
    from public.empleados e
   where e.id = p_id
     and e.activo is true
   limit 1;
$$;

comment on function public.fichaje_sesion(uuid) is
  'Retoma la sesión guardada en la tablet de fichaje. Mismos datos públicos que fichaje_login, sin PIN ni plata.';

-- ── 3. Permisos de lo nuevo ─────────────────────────────────────────────────
grant select on public.v_empleados_publicos to anon, authenticated;

-- Las funciones se conceden explícitamente y se le sacan a `public`, que es el
-- rol que las hereda solo por existir.
revoke all on function public.fichaje_login(text, text)  from public;
revoke all on function public.fichaje_sesion(uuid)       from public;
grant execute on function public.fichaje_login(text, text) to anon, authenticated;
grant execute on function public.fichaje_sesion(uuid)      to anon, authenticated;

-- ── 4. Que la puerta buena de verdad esté abierta ───────────────────────────
do $$
begin
  if not has_table_privilege('anon', 'public.v_empleados_publicos', 'SELECT') then
    raise exception 'anon no puede leer v_empleados_publicos: las tablets de Cocina se quedarían sin lista de gente.';
  end if;
  if not has_function_privilege('anon', 'public.fichaje_login(text, text)', 'EXECUTE') then
    raise exception 'anon no puede ejecutar fichaje_login: nadie podría fichar.';
  end if;
  if not has_function_privilege('anon', 'public.fichaje_sesion(uuid)', 'EXECUTE') then
    raise exception 'anon no puede ejecutar fichaje_sesion.';
  end if;
end $$;
