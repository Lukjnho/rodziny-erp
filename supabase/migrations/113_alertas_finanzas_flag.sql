-- 113 — Flag de supervisión: alertas financieras del Inicio
-- Antes, las cards AlertasOperativasCard + ExtractosAlerta (extractos atrasados,
-- sync MercadoPago, gastos/pagos fijos vencidos, egresos sin conciliar) se mostraban
-- a CUALQUIERA con permiso de finanzas/gastos/flujo_caja, o admin. Eso hacía que
-- quien solo carga gastos (martin, tamara, tomas, maxi) y los socios admin vieran
-- las mismas alertas de supervisión que el CEO.
--
-- Este flag dedicado separa "cargar gastos" de "ver las alertas financieras del
-- Inicio". Default false (nadie), se asigna a mano desde el módulo Usuarios.
-- Es SOLO un gate de UI: no se usa en RLS (los datos ya están protegidos por sus
-- propios permisos). No cambia el acceso de nadie a cargar gastos.
-- Cambio aditivo y retro-compatible.

alter table public.perfiles
  add column if not exists puede_ver_alertas_finanzas boolean not null default false;

-- Arranque: activar solo para Lucas (CEO). El resto queda en false.
update public.perfiles set puede_ver_alertas_finanzas = true where lower(nombre) = 'lucas';
