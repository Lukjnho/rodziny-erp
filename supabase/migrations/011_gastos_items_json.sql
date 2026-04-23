-- 011_gastos_items_json.sql
-- Persistir los ítems (productos vinculados al stock) dentro del gasto para
-- poder verlos y editarlos al abrir "Editar gasto". Hasta ahora los ítems
-- solo existían como movimientos_stock y se perdían en el UI del modal al editar.
--
-- No se toca movimientos_stock: si el usuario edita ítems (cantidad/producto),
-- los cambios quedan reflejados en gastos.items_json pero el stock actual
-- debe ajustarse manualmente desde "Movimientos" si corresponde.

alter table gastos
  add column if not exists items_json jsonb;

-- Backfill: gastos creados desde una recepción pendiente reutilizan los items
-- que ya guardó la PWA /recepcion en recepciones_pendientes.items.
update gastos g
set items_json = rp.items
from recepciones_pendientes rp
where g.recepcion_id = rp.id
  and g.items_json is null
  and rp.items is not null;

notify pgrst, 'reload schema';
