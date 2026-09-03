-- 168 · La merma de camara tambien descuenta el lote
--
-- El boton «Se perdio» del pizarron del deposito ya esta en produccion y
-- escribe la merma. Pero cocina_merma no tenia NINGUN trigger: la porcion
-- salia del total y el LOTE quedaba entero. Resultado practico: tiras una
-- bandeja podrida y el FIFO del panel te la sigue ofreciendo como «la
-- primera» — la unica lista que le dice al equipo que sacar.
--
-- El circuito ya estaba preparado para esto y nadie lo enchufo:
--   · cocina_lote_consumos.tipo ya acepta 'merma_camara' desde que se creo
--   · fifo_consumir_camara_pasta() ya existe y la usan traspasos y ajustes
-- Faltaba solo el cable, que es este archivo.
--
-- NO MUEVE NINGUN NUMERO DE LA PANTALLA. Verificado sobre la definicion viva
-- de v_cocina_stock_pastas: resta cocina_merma en forma directa
-- (porciones_neto_camara = camara - traspasos - merma) y no lee
-- cocina_lote_consumos en ningun lado. O sea que el total ya descontaba la
-- merma; lo que se corrige aca es el DETALLE POR LOTE, que es lo que se ve
-- en el panel del pizarron.
--
-- SOLO MERMAS DE PASTA. cocina_merma guarda las dos cosas: 25 filas con
-- producto_id (pasta) y 13 con receta_id (salsas, pan, postres). Las de
-- receta no tienen lote de pasta que descontar, asi que el trigger las
-- saltea en vez de fallar. Mismo criterio que usa la vista de stock.
--
-- DE ACA EN ADELANTE. No toca las 25 mermas historicas: ese backfill se
-- corre aparte y a proposito, porque reordena el FIFO que el equipo ve hoy
-- en la tablet del deposito.

create or replace function public.trg_merma_camara_fifo()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if TG_OP in ('UPDATE', 'DELETE') then
    delete from cocina_lote_consumos
    where origen_tabla = 'cocina_merma' and origen_id = OLD.id;
  end if;

  if TG_OP in ('INSERT', 'UPDATE') then
    -- Las mermas de receta (salsa, pan, postre) no tienen lote de pasta.
    if NEW.producto_id is not null then
      perform fifo_consumir_camara_pasta(
        NEW.producto_id, NEW.local, NEW.fecha,
        NEW.porciones::numeric, 'merma_camara',
        'cocina_merma', NEW.id, NEW.motivo
      );
    end if;
    return NEW;
  end if;

  return OLD;
end;
$function$;

-- Los tres triggers, con la misma forma que los de cocina_traspasos:
-- AFTER, FOR EACH ROW, y el UPDATE acotado a las columnas que cambian la cuenta.
drop trigger if exists trg_merma_camara_fifo_ins on public.cocina_merma;
create trigger trg_merma_camara_fifo_ins
  after insert on public.cocina_merma
  for each row execute function public.trg_merma_camara_fifo();

drop trigger if exists trg_merma_camara_fifo_upd on public.cocina_merma;
create trigger trg_merma_camara_fifo_upd
  after update of porciones, producto_id, fecha, local on public.cocina_merma
  for each row execute function public.trg_merma_camara_fifo();

drop trigger if exists trg_merma_camara_fifo_del on public.cocina_merma;
create trigger trg_merma_camara_fifo_del
  after delete on public.cocina_merma
  for each row execute function public.trg_merma_camara_fifo();
