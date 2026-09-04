-- 178 — Cinco tablas que se crearon y nunca se usaron
--
-- Todas con **0 filas**, sin claves foráneas que les apunten, sin vistas, sin
-- funciones, sin triggers y sin una sola referencia en el código ni en las 24
-- edge functions. Verificado dos veces (un buscador y un escéptico que intentó
-- demolerlo) y una tercera vez contra la base justo antes de aplicar.
--
--   · correo_mensajes / correo_remitentes
--       La bandeja de mails del contador que se iba a llenar sola desde Outlook.
--       Quedó anunciada como «Paso 2» y nunca se hizo. Lo que hoy funciona
--       —«Documentos del contador»— sube el PDF a mano y guarda en otro lado.
--
--   · cocina_productos_packaging / cocina_productos_adicionales
--       Un intento viejo de manejar packaging y adicionales por canal de venta.
--       Lo reemplazó el campo `rol` de las recetas antes de que entrara un dato.
--
--   · documentos_sueldos
--       Prototipo para subir recibos. Ni siquiera tiene migración: se creó a mano
--       en el panel de Supabase. La reemplazó `recibos_sueldo`, que es la que se
--       usa hoy y NO se toca.
--
-- Va con RESTRICT y no con CASCADE a propósito: si algo dependiera de ellas que
-- no vimos, queremos que esto falle con un error, no que se lleve puesto lo que
-- depende.

drop table if exists public.correo_mensajes              restrict;
drop table if exists public.correo_remitentes            restrict;
drop table if exists public.cocina_productos_packaging   restrict;
drop table if exists public.cocina_productos_adicionales restrict;
drop table if exists public.documentos_sueldos           restrict;
