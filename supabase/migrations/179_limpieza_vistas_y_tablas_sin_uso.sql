-- 179 — La cuenta vieja de stock, la tabla de feriados y tres restos más
--
-- Todo verificado dos veces (buscador + escéptico) y una tercera contra la base
-- justo antes de aplicar. Lo que tenía datos se exportó primero fuera del repo.

-- ── 1) La cuenta vieja de stock de pastas ───────────────────────────────────
-- Suma toda la producción de la historia y resta traspasos y merma, pero
-- **ignora los conteos físicos**, así que el número solo crece:
--   Rigatoni Vedia   1.282 porciones  vs  ~140 reales
--   Radiatori        1.277            vs   ~249
--   Ñoquis Saavedra    823            vs    ~95
-- Cuando se unificó el stock en una sola cuenta (migración 161) esta quedó
-- afuera y nadie la borró. No la lee ninguna pantalla, vista ni función, y Lucas
-- confirmó que no hay ningún tablero ni Sheet conectado por fuera del ERP.
-- El riesgo real era el nombre: suena a oficial y el próximo que escriba un
-- reporte la iba a agarrar. Encima estaba abierta a cualquiera sin sesión.
drop view if exists public.cocina_stock_actual restrict;

-- ── 2) La trazabilidad del pizarrón que no tiene pantalla ───────────────────
-- Ata cada ítem del pizarrón con el lote que lo cumplió. Se creó para alimentar
-- una pestaña de trazabilidad que nunca se hizo. No tiene datos propios: es una
-- cuenta en vivo sobre tablas que siguen vivas. Se apoya en
-- v_cocina_lote_pasta_saldo (que SÍ se usa), no al revés: borrarla no la toca.
drop view if exists public.v_cocina_pizarron_trazabilidad restrict;

-- ── 3) Una función de merma huérfana ────────────────────────────────────────
-- Era el disparador de `cocina_conteos_mostrador`, tabla que borró la migración
-- 042. Verificado: esa tabla NO existe y la función no tiene ningún trigger
-- colgado. Es un cascote.
drop function if exists public.registrar_merma_conteo_mostrador() cascade;

-- ── 4) La tabla de feriados que nunca se conectó ────────────────────────────
-- 0 filas, nadie le apunta, RRHH no calcula días hábiles ni ausentismo con ella.
-- Ni siquiera tiene migración: se creó a mano en el panel. Si algún día hace
-- falta calcular feriados, se rehace bien y queda escrito.
drop table if exists public.feriados restrict;

-- ── 5) El conteo de una tarde de abril ──────────────────────────────────────
-- 13 filas, todas del 28-abr-2026 entre las 13:32 y las 14:22. Ese mismo día la
-- pantalla que la usaba cambió de fuente y pasó a escribir en
-- cocina_lotes_produccion; nunca más se tocó. **Las 13 filas se exportaron a
-- Drive antes de borrar** (conteo-stock-abril-2026-04-28.json).
drop table if exists public.cocina_conteo_stock restrict;

-- NOTA: las columnas muzzarella_gramos / semolin_gramos / huevo_gramos de
-- cocina_lotes_pasta NO se borran todavía, a propósito. La pantalla ya dejó de
-- pedirlas, pero una tablet con la versión vieja guardada seguiría mandándolas y
-- el cocinero no podría guardar una pasta. Se borran en una migración aparte
-- cuando todas las tablets tengan la versión nueva. Los datos ya están
-- exportados (gramos-muzzarella-semolin-huevo-2026-09-04.json).
