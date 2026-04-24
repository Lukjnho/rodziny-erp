-- 024_cocina_productos_porciones_por_cajon.sql
-- Agrega la cantidad de porciones por cajón a cada producto de cocina.
-- Cuando se traslada pasta de la cámara al freezer del mostrador se mueven
-- cajones enteros — necesitamos saber cuántas porciones tiene cada cajón
-- para mostrarlo bien en el QR y para que el ingreso sea en cajones (no en
-- porciones).
--
-- Nullable: si un producto no tiene el dato cargado, el QR cae al flujo
-- anterior (carga manual en porciones).

alter table cocina_productos
  add column if not exists porciones_por_cajon int
    check (porciones_por_cajon is null or porciones_por_cajon > 0);

comment on column cocina_productos.porciones_por_cajon is
  'Cantidad de porciones que entran en un cajón del freezer/cámara. Se usa para traducir traslados por cajones en el QR de depósito.';
