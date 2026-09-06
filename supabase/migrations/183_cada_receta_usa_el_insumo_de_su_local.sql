-- 183 — Cada receta usa el insumo de SU local
--
-- EL PROBLEMA
-- 44 renglones de recetas ACTIVAS apuntan al insumo del otro local. Los insumos
-- están duplicados a propósito, uno por local (eso es correcto y no se toca), pero
-- el renglón agarró el gemelo equivocado.
--
-- QUÉ ROMPE HOY (sin ningún descuento automático prendido)
-- El costeo usa el precio del local equivocado. Medido, y casi todo para el mismo
-- lado — las recetas quedan SUBCOSTEADAS, o sea parecen más baratas de lo que son
-- y con eso se fijó el precio:
--
--   Crema de Hongos (BIENAL)  saavedra   76 tandas/90d   -8,0%
--   Pomodoro Base             vedia       8 tandas/90d   -7,3%
--   Relleno de Espinaca       saavedra                   -5,3%
--   Relleno de Bondiola       saavedra                   -2,9%
--   Milanesa de carne         saavedra   51 tandas/90d   -2,1%
--   Pure papa para ñoqui      saavedra                  -16,9%
--   Jugo De naranja           vedia                     +21,9%
--
-- 💣 UN CASO APARTE, PEOR QUE EL PRECIO: "Milanesa de carne" (Saavedra, 51 tandas)
-- apunta al Cuadril de VEDIA, que está DADO DE BAJA y con stock 0, mientras el de
-- Saavedra está activo con 15 kg. Como la ficha está de baja ni siquiera aparece en
-- las pantallas del almacén: el número se rompe donde nadie lo mira.
--
-- QUÉ HACE
-- Repunta SÓLO los renglones donde existe EXACTAMENTE UN insumo activo con el mismo
-- nombre en el local de la receta. Son 35. Si hubiera dos candidatos no toca nada:
-- elegir por nombre entre dos es adivinar, y acá se adivina cero.
--
-- QUÉ NO HACE, Y POR QUÉ
-- Los otros 9 renglones se dejan como están. No es un olvido: esos insumos existen
-- en UN SOLO local (Azúcar, Sal Fina, Ajo en Polvo, Mix frutas congeladas, Aceite de
-- Oliva SIN TACC, Sal fina SIN TACC, el Malbec). Ahí la pregunta no es técnica —hay
-- que decidir si se crea la ficha en el otro local o si esa compra es centralizada—
-- y hasta que se decida, dejarlos apuntando cruzado es MENOS malo que romperlos:
-- hoy al menos costean con un precio real de un insumo real.
--
-- El nombre del renglón (cocina_receta_ingredientes.nombre) NO se toca: es el texto
-- como lo escribió el cocinero ("Cuadril 1 kg") y sirve de rastro de qué decía antes.

begin;

update cocina_receta_ingredientes i
   set producto_id = destino.id
  from cocina_recetas r,
       productos p,
       lateral (
         select q.id
           from productos q
          where lower(trim(q.nombre)) = lower(trim(p.nombre))
            and q.local = r.local
            and q.activo
       ) destino
 where r.id = i.receta_id
   and p.id = i.producto_id
   and r.activo
   and r.local is not null
   and p.local is not null
   and r.local <> p.local
   -- Exactamente un candidato. Con dos, no se toca.
   and (
     select count(*) from productos q2
      where lower(trim(q2.nombre)) = lower(trim(p.nombre))
        and q2.local = r.local
        and q2.activo
   ) = 1;

-- Guardarraíl: después de esto no puede quedar NINGÚN renglón de receta activa
-- apuntando al otro local teniendo gemelo en el propio. Si queda, algo falló y la
-- migración avisa en vez de dejarlo pasar.
do $$
declare
  quedan int;
begin
  select count(*)
    into quedan
    from cocina_receta_ingredientes i
    join cocina_recetas r on r.id = i.receta_id and r.activo
    join productos p on p.id = i.producto_id
   where r.local is not null and p.local is not null and r.local <> p.local
     and exists (
       select 1 from productos q
        where lower(trim(q.nombre)) = lower(trim(p.nombre))
          and q.local = r.local and q.activo
     );
  if quedan > 0 then
    raise exception 'Quedaron % renglones cruzados que sí tenían gemelo en su local', quedan;
  end if;
end $$;

commit;
