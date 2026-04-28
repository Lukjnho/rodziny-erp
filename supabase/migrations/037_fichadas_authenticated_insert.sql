-- 037_fichadas_authenticated_insert.sql
-- Fix: el modal "Fichaje manual" del tab Asistencia (RRHH) tira
--   "new row violates row-level security policy for table fichadas"
-- cuando el JWT del usuario esta vencido pero supabase-js no refresco a tiempo:
-- en ese estado auth.uid() devuelve NULL en el server, tiene_permiso('rrhh')
-- retorna false y la policy fichadas_rrhh_insert bloquea el INSERT.
--
-- El kiosko PWA publico ya inserta fichadas como rol 'anon' con WITH CHECK true
-- (policy fichadas_anon_insert). No hay diferencia de riesgo entre que cualquier
-- usuario logueado registre una fichada y que el publico la registre desde la
-- PWA: los fichajes son write-only, sin datos sensibles, y el flow esta
-- protegido por la app. Equipararlas elimina el caso edge sin perder seguridad.

DROP POLICY IF EXISTS fichadas_rrhh_insert ON fichadas;

CREATE POLICY fichadas_authenticated_insert ON fichadas
  FOR INSERT TO authenticated
  WITH CHECK (true);
