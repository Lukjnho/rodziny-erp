-- 009_pastas_flujo_porcionado.sql
-- Modela el flujo real de producción de pastas:
--   1) Armado de pastas en cajones → freezer de producción (estado "fresco")
--   2) Porcionado al día siguiente → bolsitas 200g → cámara de congelado ("terminado")
-- Además desactiva los productos duplicados en `productos` con categoría "Deposito Pastas"
-- (ahora `cocina_productos` es la única fuente de verdad para pastas terminadas).

-- ─── 1. Agregar columnas a cocina_lotes_pasta ───────────────────────────────
-- Default 'camara_congelado' para no romper el stock histórico (los lotes previos
-- ya estaban porcionados y en cámara). Los lotes nuevos del flujo "armar" setean
-- ubicacion='freezer_produccion' explícitamente desde el código.
alter table cocina_lotes_pasta
  add column if not exists ubicacion text not null default 'camara_congelado'
    check (ubicacion in ('freezer_produccion','camara_congelado')),
  add column if not exists cantidad_cajones int,
  add column if not exists fecha_porcionado date,
  add column if not exists responsable_porcionado text,
  add column if not exists merma_porcionado int not null default 0;

create index if not exists idx_lotes_pasta_ubicacion_local on cocina_lotes_pasta(ubicacion, local);

-- ─── 2. Desactivar productos duplicados en `productos` ──────────────────────
-- Las pastas terminadas pasan a gestionarse exclusivamente en cocina_productos.
-- Se mantiene el histórico (movimientos_stock) intacto, solo se ocultan de listados.
update productos
set activo = false
where categoria ilike '%deposito%pasta%'
  and activo = true;

-- ─── 3. Vista de ayuda: stock actual de pastas terminadas ───────────────────
-- Stock disponible = porciones en cámara − traspasos − merma
-- (los lotes en freezer_produccion NO cuentan como stock disponible)
create or replace view v_cocina_stock_pastas as
select
  p.id as producto_id,
  p.nombre,
  p.codigo,
  p.local,
  p.minimo_produccion,
  coalesce((
    select sum(lp.porciones) from cocina_lotes_pasta lp
    where lp.producto_id = p.id and lp.local = p.local and lp.ubicacion = 'camara_congelado'
  ), 0) as porciones_camara,
  coalesce((
    select sum(lp.porciones) from cocina_lotes_pasta lp
    where lp.producto_id = p.id and lp.local = p.local and lp.ubicacion = 'freezer_produccion'
  ), 0) as porciones_fresco,
  coalesce((
    select sum(t.porciones) from cocina_traspasos t
    where t.producto_id = p.id and t.local = p.local
  ), 0) as porciones_traspasadas,
  coalesce((
    select sum(m.porciones) from cocina_merma m
    where m.producto_id = p.id and m.local = p.local
  ), 0) as porciones_merma
from cocina_productos p
where p.tipo = 'pasta' and p.activo = true;
