-- ============================================================================
-- DIAGNÓSTICO DE MONTOS HISTÓRICOS — rodziny-erp
-- Generado el 10-sep-2026
--
-- ⛔ ESTE ARCHIVO NO MODIFICA NADA. Son siete consultas de SOLO LECTURA para
--    revisar a mano si algún dato quedó mal guardado por los bugs de entrada
--    de plata. NINGUNA se ejecutó todavía.
--
-- ⚠️ NO LAS CORRAS TODAS DE UNA. Correlas de a una y mirá los resultados: la
--    idea es que vos decidas caso por caso, no que el sistema "arregle" solo.
--
-- ----------------------------------------------------------------------------
-- LOS TRES BUGS, EN CRIOLLO
-- ----------------------------------------------------------------------------
--
-- Al escribir plata, el punto puede significar dos cosas, y en el ERP convivían
-- las dos. De ahí salen dos daños distintos y OPUESTOS:
--
-- 💥 BUG A — "el punto es coma decimal" → los montos quedan MIL VECES MÁS CHICOS
--    Alguien teclea 15.000 pensando quince mil y el sistema entiende 15.
--    Afecta: adelantos, bonos, descuentos y sanciones de sueldo; el saldo de
--    Mercado Pago; los subtotales de ítems de factura; y los retiros de caja.
--    ⏳ SIGUE ACTIVO al 10-sep-2026. Se corrige en la tanda 2.
--
-- 💥 BUG B — "el valor de la base se vuelve a leer como si lo hubieran tecleado"
--    → los montos quedan 10 o 100 VECES MÁS GRANDES
--    Un valor guardado como 2350.50 se mostraba como texto "2350.5" y al
--    releerlo se le borraba el punto: 23505. Solo pasa con montos que tienen
--    CENTAVOS; los redondos nunca se tocaron.
--    Afecta: el precio de la carta y los campos de Fudo del cierre de caja.
--    ✅ CORREGIDO el 10-sep-2026 (commits 8f3139b y dbee13b).
--
-- 💥 BUG C — "el costo se guarda en CERO" → el más callado y el más caro
--    En Compras › Stock el campo del costo unitario es `type="number"`. Si
--    alguien teclea un importe con puntos, el navegador lo rechaza y devuelve
--    vacío; el código lo convierte en CERO y lo guarda sin avisar nada.
--    No es un monto raro que alguien vaya a mirar: es un casillero vacío que
--    parece pendiente. Y el costo del insumo no se queda ahí — entra en el
--    costeo de cada receta que lo usa, y de ahí al margen y al precio sugerido.
--    Un insumo en cero hace que la receta parezca MÁS rentable de lo que es.
--    Afecta: costos de insumos de Compras, de Productos › Insumos, y los
--    ítems de cada gasto.
--    ⏳ SIGUE ACTIVO al 10-sep-2026. Es la consulta (g).
--
-- ----------------------------------------------------------------------------
-- CÓMO LEER LOS RESULTADOS
-- ----------------------------------------------------------------------------
-- Cada consulta trae una columna `valor_si_fuera_el_bug`: es lo que el número
-- DEBERÍA decir si efectivamente se rompió. No es una corrección automática:
-- es una sugerencia para que la contrastes con el papel, el recibo o el banco.
--
-- Ninguna consulta puede probar sola que un dato está mal. Un adelanto de $500
-- puede ser un adelanto de $500 de verdad. Por eso todas ordenan por "lo más
-- sospechoso primero" y ninguna borra ni cambia nada.
-- ============================================================================


-- ============================================================================
-- (a) RETIROS DE CAJA CON MONTO SOSPECHOSAMENTE BAJO
-- ----------------------------------------------------------------------------
-- Bug:      A (mil veces más chico) — pantalla "Retiros sin clasificar"
-- Desde:    04-sep-2026 (commit 221b703, cuando se creó la pantalla)
-- Hasta:    sigue activo
--
-- 🟢 ESPERO QUE ESTA CONSULTA NO DEVUELVA NADA, y conviene explicar por qué.
--    Esa pantalla tiene un guardarraíl: el botón Guardar está deshabilitado
--    hasta que cambio + pagos den igual al total ya retirado (con 1 peso de
--    tolerancia). Si el bug achicara los números mil veces, la suma no cerraría
--    y no se podría guardar. O sea: el bug existe en el código, pero el
--    guardarraíl le tapó la salida.
--
--    Si igual aparecen filas acá, NO vinieron de esa pantalla: hay que buscar
--    de dónde salieron. Por eso vale la pena correrla.
-- ============================================================================

select
    c.fecha,
    c.local,
    c.turno,
    c.caja,
    c.creado_por                                  as cargado_por,
    c.otros_retiros                               as total_retirado_original,
    c.retiro_cambio,
    c.retiro_pagos,
    coalesce(c.retiro_cambio, 0) + coalesce(c.retiro_pagos, 0) as suma_del_desglose,
    -- Lo que falta para que el desglose cierre con el total. Si es grande,
    -- el desglose se guardó por otro camino que salteó el guardarraíl.
    c.otros_retiros - (coalesce(c.retiro_cambio, 0) + coalesce(c.retiro_pagos, 0)) as diferencia,
    (coalesce(c.retiro_cambio, 0) + coalesce(c.retiro_pagos, 0)) * 1000 as valor_si_fuera_el_bug
from public.cierres_caja c
where c.otros_retiros > 0
  and c.retiro_cambio is not null
  and c.retiro_pagos is not null
  -- El desglose no cierra con el total por más de 1 peso.
  and abs(c.otros_retiros - (coalesce(c.retiro_cambio, 0) + coalesce(c.retiro_pagos, 0))) > 1
order by diferencia desc;


-- ============================================================================
-- (b) ADELANTOS, BONOS, DESCUENTOS Y SANCIONES CON MONTO BAJO
-- ----------------------------------------------------------------------------
-- Bug:      A (mil veces más chico)
-- Desde:    11-abr-2026 adelantos y sanciones (commit 6df0601)
--           15-abr-2026 descuentos          (commit d7ffa47)
--           28-abr-2026 bonos               (commit f57b8ff)
-- Hasta:    sigue activo
--
-- 🔴 ESTOS SÍ ESTÁN EXPUESTOS: los cuatro paneles guardan sin ningún control de
--    que el monto sea razonable. Son casi cinco meses de carga.
--
-- Método: en vez de inventar un piso en pesos (que la inflación deja viejo en
-- dos meses), cada fila se compara contra la MEDIANA de su propio concepto.
-- Una fila mil veces más chica que la mediana canta sola. Se usa mediana y no
-- promedio justamente para que los valores rotos no ensucien la referencia.
-- ============================================================================

with todos as (
    select 'adelanto'  as concepto, a.id, a.empleado_id, a.fecha, a.periodo, a.monto, a.motivo
      from public.adelantos a
    union all
    select 'bono',       b.id, b.empleado_id, b.fecha, b.periodo, b.monto, b.motivo
      from public.bonos b
    union all
    select 'descuento',  d.id, d.empleado_id, d.fecha, d.periodo, d.monto, d.motivo
      from public.descuentos d
    union all
    select 'sancion',    s.id, s.empleado_id, s.fecha, s.periodo, s.monto, s.motivo
      from public.sanciones s
),
referencia as (
    select concepto,
           percentile_cont(0.5) within group (order by monto)::numeric as mediana
      from todos
     where monto > 0
     group by concepto
)
select
    t.concepto,
    t.fecha,
    t.periodo,
    coalesce(e.nombre || ' ' || e.apellido, t.empleado_id::text) as empleado,
    t.monto,
    round(r.mediana, 2)                as mediana_del_concepto,
    round(r.mediana / nullif(t.monto, 0), 0) as cuantas_veces_mas_chico,
    t.monto * 1000                     as valor_si_fuera_el_bug,
    t.motivo
from todos t
join referencia r on r.concepto = t.concepto
left join public.empleados e on e.id = t.empleado_id
where t.monto > 0
  -- Al menos 100 veces por debajo de lo normal para ese concepto.
  -- El bug divide por 1000, así que un umbral de 100 deja margen de sobra.
  and t.monto < r.mediana / 100
order by cuantas_veces_mas_chico desc, t.fecha desc;


-- ============================================================================
-- (c) SALDOS DE MERCADO PAGO CARGADOS CON VALOR BAJO
-- ----------------------------------------------------------------------------
-- Bug:      A (mil veces más chico) — campo "saldo MP" del Flujo de Caja
-- Desde:    12-jul-2026 (commit a5f0215)
-- Hasta:    sigue activo
--
-- El saldo se carga a mano y no tiene ningún control. Se compara cada saldo
-- cargado a mano contra el saldo anterior y el siguiente de la MISMA cuenta:
-- un salto brusco hacia abajo y una vuelta inmediata hacia arriba es la firma
-- del bug (el saldo real no desaparece y reaparece de un día para el otro).
-- ============================================================================

with s as (
    select
        sc.id,
        sc.cuenta,
        sc.fecha,
        sc.saldo,
        sc.fuente,
        lag(sc.saldo)  over (partition by sc.cuenta order by sc.fecha) as saldo_anterior,
        lead(sc.saldo) over (partition by sc.cuenta order by sc.fecha) as saldo_siguiente
    from public.saldos_cuentas sc
    where sc.fecha >= date '2026-07-12'   -- desde que existe el campo
)
select
    s.cuenta,
    s.fecha,
    s.saldo,
    s.saldo_anterior,
    s.saldo_siguiente,
    s.fuente,
    round(s.saldo_anterior / nullif(s.saldo, 0), 0) as cuantas_veces_mas_chico,
    s.saldo * 1000 as valor_si_fuera_el_bug
from s
where s.saldo > 0
  -- Cae por lo menos 100 veces respecto del día anterior...
  and s.saldo_anterior is not null
  and s.saldo < s.saldo_anterior / 100
  -- ...y vuelve a subir después: el saldo no se evaporó, se cargó mal.
  and s.saldo_siguiente is not null
  and s.saldo_siguiente > s.saldo * 100
order by cuantas_veces_mas_chico desc;


-- ============================================================================
-- (d) SUBTOTALES DE ÍTEMS QUE NO CUADRAN CON EL TOTAL DEL GASTO
-- ----------------------------------------------------------------------------
-- Bug:      A (mil veces más chico) — subtotal por ítem al cargar una factura
-- Desde:    08-may-2026 (commit df6813d)
-- Hasta:    sigue activo
--
-- Los ítems viven en gastos.items_json. El importe total del gasto se carga por
-- separado (y ese campo SÍ estaba bien, usa la regla correcta), así que cuando
-- el subtotal de un ítem se guardó mil veces más chico la suma de los ítems no
-- llega ni cerca del total. Esa diferencia es el detector.
--
-- ⚠️ Ojo al leer: que no cuadre NO siempre es este bug. Una factura cargada a
--    medias, o con un ítem sin subtotal, también da diferencia. Mirá la columna
--    `proporcion`: si la suma de los ítems da más o menos la milésima parte del
--    total, ahí sí es el bug.
-- ============================================================================

with g as (
    select
        gs.id,
        gs.fecha,
        gs.importe_total,
        gs.nro_comprobante,
        gs.proveedor_id,
        (
            select sum((it ->> 'subtotal')::numeric)
            from jsonb_array_elements(gs.items_json) as it
        ) as suma_items,
        jsonb_array_length(gs.items_json) as cantidad_items
    from public.gastos gs
    where gs.items_json is not null
      and jsonb_typeof(gs.items_json) = 'array'
      and jsonb_array_length(gs.items_json) > 0
      and gs.importe_total > 0
      and gs.fecha >= date '2026-05-08'
)
select
    g.fecha,
    coalesce(p.nombre_comercial, p.razon_social, '(sin proveedor)') as proveedor,
    g.nro_comprobante,
    g.cantidad_items,
    g.importe_total,
    round(g.suma_items, 2)                              as suma_de_los_items,
    round(g.importe_total - g.suma_items, 2)            as diferencia,
    round(g.suma_items / nullif(g.importe_total, 0), 5) as proporcion,
    round(g.suma_items * 1000, 2)                       as valor_si_fuera_el_bug
from g
left join public.proveedores p on p.id = g.proveedor_id
where g.suma_items is not null
  -- Los ítems suman menos del 10% del total: no es un redondeo, falta plata.
  and g.suma_items < g.importe_total * 0.10
order by proporcion asc, g.fecha desc;


-- ============================================================================
-- (e) PRECIOS DE LA CARTA QUE SALTARON ~10x DE GOLPE
-- ----------------------------------------------------------------------------
-- Bug:      B (diez o cien veces más grande) — editor de precios del Menú
-- Desde:    18-may-2026 (commit a69d2d7, cuando nació el módulo Productos)
-- Hasta:    ✅ 10-sep-2026 (commit 8f3139b)
--
-- 🔴 Este es el más traicionero de todos: el precio se guardaba al SALIR del
--    campo, sin necesidad de escribir nada. Alcanzaba con hacer clic en el
--    precio de un plato y clic afuera. Solo afectaba a precios con centavos.
--
-- Por suerte hay un registro histórico (cocina_productos_precio_historial) que
-- guarda precio anterior, precio nuevo y variación. Un salto de +900% (10x) o
-- +9900% (100x) sin motivo es la firma exacta del bug.
-- ============================================================================

select
    h.fecha,
    cp.nombre                       as producto,
    cp.local,
    h.precio_anterior,
    h.precio_nuevo,
    round(h.precio_nuevo / nullif(h.precio_anterior, 0), 1) as veces_mas_caro,
    h.usuario,
    h.motivo,
    -- Si fue el bug, el precio correcto es el anterior con los centavos que tenía.
    h.precio_anterior               as valor_si_fuera_el_bug,
    -- ¿El precio sigue mal HOY, o alguien ya lo corrigió a mano después?
    pc.precio                       as precio_actual_del_canal
from public.cocina_productos_precio_historial h
join public.cocina_productos cp on cp.id = h.cocina_producto_id
left join public.cocina_productos_precios_canal pc
       on pc.cocina_producto_id = h.cocina_producto_id
      and pc.canal = 'plato'
where h.fecha >= date '2026-05-18'
  and h.fecha <  date '2026-09-11'
  and h.precio_anterior > 0
  -- Saltó al menos 8 veces: deja lugar para el 10x y el 100x, y descarta los
  -- aumentos de precio normales, que ni de cerca multiplican por ocho.
  and h.precio_nuevo >= h.precio_anterior * 8
  -- El bug solo podía pasar si el precio anterior tenía centavos.
  and (h.precio_anterior * 100)::bigint % 100 <> 0
order by veces_mas_caro desc, h.fecha desc;


-- ----------------------------------------------------------------------------
-- (e bis) RED DE SEGURIDAD: precios de hoy fuera de escala en su categoría
-- ----------------------------------------------------------------------------
-- La consulta de arriba depende de que el historial se haya escrito siempre.
-- Esta no depende de nada: compara el precio de cada plato contra la mediana
-- de los demás platos del MISMO local, y muestra los que están 8 veces arriba.
-- Sirve para pescar lo que se le haya escapado al historial.
-- ----------------------------------------------------------------------------

with precios as (
    select cp.id, cp.nombre, cp.local, pc.canal, pc.precio
    from public.cocina_productos cp
    join public.cocina_productos_precios_canal pc on pc.cocina_producto_id = cp.id
    where cp.activo = true
      and pc.precio > 0
),
mediana as (
    select local, canal,
           percentile_cont(0.5) within group (order by precio)::numeric as precio_tipico
    from precios
    group by local, canal
)
select
    p.local,
    p.canal,
    p.nombre                                  as producto,
    p.precio,
    round(m.precio_tipico, 2)                 as precio_tipico_del_local,
    round(p.precio / nullif(m.precio_tipico, 0), 1) as veces_sobre_lo_tipico,
    round(p.precio / 10, 2)                   as valor_si_fuera_el_bug_10x,
    round(p.precio / 100, 2)                  as valor_si_fuera_el_bug_100x
from precios p
join mediana m on m.local = p.local and m.canal = p.canal
where p.precio > m.precio_tipico * 8
order by veces_sobre_lo_tipico desc;


-- ============================================================================
-- (f) CIERRES DE CAJA CON CAMPOS DE FUDO ~10x FUERA DE ESCALA
-- ----------------------------------------------------------------------------
-- Bug:      B (diez o cien veces más grande) — al REABRIR un cierre y guardarlo
-- Desde:    23-abr-2026 (commit b483ef1, cuando apareció el botón Editar)
--           14-may-2026 para el campo MP Lucas (commit 44d87b0)
-- Hasta:    ✅ 10-sep-2026 (commit dbee13b)
--
-- 🔴 Los campos de Fudo son los más expuestos de todo el ERP a este bug, porque
--    casi siempre traen centavos. El daño se producía al EDITAR un cierre ya
--    guardado: se abría, se tocaba cualquier cosa, se guardaba, y los seis
--    campos salían multiplicados.
--
-- Método: cada campo se compara contra la mediana de ese MISMO campo, en el
-- MISMO local, en los 30 días alrededor. Así el crecimiento normal de las
-- ventas (y la inflación) no genera falsos positivos.
--
-- 💡 Pista extra: si un cierre está roto por este bug, `diferencia` (que se
--    calculó al guardar) suele quedar absurda. Vale la pena mirar esa columna.
-- ============================================================================

with campos as (
    select c.id, c.fecha, c.local, c.turno, c.caja, c.diferencia, c.creado_por,
           x.campo, x.valor
    from public.cierres_caja c
    cross join lateral (values
        ('fudo_efectivo',      c.fudo_efectivo),
        ('fudo_qr',            c.fudo_qr),
        ('fudo_debito',        c.fudo_debito),
        ('fudo_credito',       c.fudo_credito),
        ('fudo_transferencia', c.fudo_transferencia),
        ('fudo_mp_lucas',      c.fudo_mp_lucas),
        ('monto_contado',      c.monto_contado),
        ('fondo_apertura',     c.fondo_apertura)
    ) as x(campo, valor)
    where c.fecha >= date '2026-04-23'
      and c.fecha <  date '2026-09-11'
      and x.valor > 0
),
referencia as (
    select a.id, a.campo,
           percentile_cont(0.5) within group (order by b.valor)::numeric as tipico_alrededor,
           count(*)                                             as cierres_comparados
    from campos a
    join campos b
      on b.local = a.local
     and b.campo = a.campo
     and b.id <> a.id
     and b.fecha between a.fecha - 15 and a.fecha + 15
    group by a.id, a.campo
)
select
    c.fecha,
    c.local,
    c.turno,
    c.caja,
    c.campo,
    c.valor,
    round(r.tipico_alrededor, 2)                        as tipico_esos_dias,
    r.cierres_comparados,
    round(c.valor / nullif(r.tipico_alrededor, 0), 1)   as veces_sobre_lo_tipico,
    round(c.valor / 10, 2)                              as valor_si_fuera_el_bug_10x,
    round(c.valor / 100, 2)                             as valor_si_fuera_el_bug_100x,
    c.diferencia                                        as diferencia_del_arqueo,
    c.creado_por
from campos c
join referencia r on r.id = c.id and r.campo = c.campo
where r.cierres_comparados >= 3        -- sin al menos 3 cierres cerca no hay con qué comparar
  and c.valor > r.tipico_alrededor * 8
order by veces_sobre_lo_tipico desc, c.fecha desc;



-- ============================================================================
-- (g) COSTOS UNITARIOS EN CERO O SOSPECHOSAMENTE BAJOS (compras e insumos)
-- ----------------------------------------------------------------------------
-- Bug:      C (el costo que se guarda en CERO) + A (mil veces más chico)
-- Desde:    20-abr-2026 Compras › Stock › alta/edición de producto
--                       (commit 9a1f009 — "CRUD de productos en tab Stock")
--           08-may-2026 Gastos › Nuevo gasto › subtotal de cada ítem
--                       (commit df6813d — "unificar modal de pagos")
--           18-may-2026 Productos › Insumos › edición en la grilla
--                       (commit a69d2d7 — "módulo Productos")
-- Hasta:    los tres siguen activos al 10-sep-2026
--
-- ----------------------------------------------------------------------------
-- POR QUÉ ESTE ES PEOR QUE LOS OTROS DOS
-- ----------------------------------------------------------------------------
-- Un monto mil veces más chico se ve raro y alguien lo mira. Un CERO no: en una
-- grilla de insumos pasa por "todavía no lo cargué". Y el costo del insumo no
-- se queda quieto donde está: entra en el costeo de cada receta que lo usa, y
-- de ahí al margen, al precio sugerido y a la Ingeniería de Menú. Un insumo en
-- cero no rompe nada — hace que la receta parezca MÁS rentable de lo que es.
--
-- Cómo se produce, en criollo:
--
--   Compras › Stock (el peor de los tres)
--     El campo es `type="number"`. Si alguien teclea 1.234,56 el navegador no
--     lo acepta y devuelve VACÍO. El código hace `parseFloat('') || 0` y guarda
--     CERO, sin un solo aviso en pantalla.
--     Si teclea 1.234 pensando mil doscientos treinta y cuatro, el navegador
--     sí lo acepta — como UNO CON DOSCIENTOS TREINTA Y CUATRO.
--
--   Productos › Insumos
--     Mismo campo `type="number"`, pero acá hay media red: si el resultado no
--     es un número, no guarda nada. O sea que CERO no puede llegar por este
--     camino; sí puede llegar 1.234 leído como 1,234.
--
--   Gastos › Nuevo gasto › subtotal del ítem
--     Ese sí usa el parser viejo (`replace(',', '.')`), así que 15.000 se lee
--     como 15. El precio unitario se calcula dividiendo subtotal / cantidad, y
--     si el encargado tilda "actualizar costo", ese precio pisa el costo real
--     del insumo. Además, si la cantidad queda en cero, el precio unitario se
--     fuerza a CERO por definición.
--
-- ----------------------------------------------------------------------------
-- 💣 LO QUE ESTA CONSULTA NO PUEDE DECIRTE
-- ----------------------------------------------------------------------------
-- **La tabla `productos` no guarda QUIÉN tocó el costo.** No tiene columna de
-- usuario. Lo único que hay es `updated_at`, y encima es la fecha de la ÚLTIMA
-- modificación de la fila entera: si después alguien le cambió el nombre o el
-- stock mínimo, esa fecha ya no es la del costo.
--
-- El único rastro con nombre y apellido está en `productos_costo_historial`,
-- y esa tabla la escribe SOLO el camino de Gastos. Los dos campos culpables
-- (Compras › Stock y Productos › Insumos) escriben `productos` derecho, sin
-- dejar historial. Por eso esto son TRES consultas y no una:
--
--   (g)     el daño, sin usuario   → qué insumos están en cero hoy
--   (g bis) el daño, sin usuario   → qué insumos están mil veces más baratos
--   (g ter) el rastro CON usuario  → lo poco que quedó registrado
--
-- Si (g) trae filas y (g ter) no las explica, la respuesta a "quién fue" no
-- está en la base. Está en preguntarle al encargado del local.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- (g) Insumos con el costo unitario en CERO (o nunca cargado)
--     Ordenados por cuántas recetas los usan: ése es el tamaño del incendio.
-- ----------------------------------------------------------------------------
with insumos as (
    select p.id, p.nombre, p.marca, p.categoria, p.unidad, p.local,
           p.costo_unitario, p.updated_at, p.activo
      from public.productos p
     where p.updated_at >= timestamptz '2026-04-20 00:00:00-03'
       and p.updated_at <  timestamptz '2026-09-11 00:00:00-03'
),
uso_en_recetas as (
    select ri.producto_id,
           count(distinct r.id)                               as recetas_que_lo_usan,
           string_agg(distinct r.nombre, ' · ' order by r.nombre) as recetas
      from public.cocina_receta_ingredientes ri
      join public.cocina_recetas r on r.id = ri.receta_id
     where ri.producto_id is not null
       and r.activo
     group by ri.producto_id
)
select
    i.local,
    i.categoria,
    i.nombre,
    coalesce(i.marca, '')                       as marca,
    i.unidad,
    i.costo_unitario,
    case when i.costo_unitario is null then 'nunca se cargó'
         else 'se guardó en CERO'
    end                                         as pinta,
    i.updated_at::date                          as ultima_modificacion,
    coalesce(i.activo, true)                    as insumo_activo,
    coalesce(u.recetas_que_lo_usan, 0)          as recetas_que_lo_usan,
    u.recetas
from insumos i
left join uso_en_recetas u on u.producto_id = i.id
where coalesce(i.costo_unitario, 0) = 0
order by coalesce(u.recetas_que_lo_usan, 0) desc,
         i.updated_at desc;

-- 💡 Al leer el resultado: un insumo en cero que NO lo usa ninguna receta y
--    está inactivo es ruido. Uno en cero que usan 6 recetas activas es plata
--    que se está calculando mal todos los días.
--
-- ⚠️ Los ingredientes que la receta engancha SOLO POR NOMBRE (sin producto_id)
--    no aparecen en la columna `recetas_que_lo_usan`. O sea que ese número es
--    un PISO, no el total.


-- ----------------------------------------------------------------------------
-- (g bis) Insumos con el costo mil veces más chico de lo que debería
--     Mismo criterio que la consulta (b): en vez de inventar un piso en pesos
--     —que la inflación deja viejo en dos meses— cada insumo se compara contra
--     la MEDIANA de su propia categoría y unidad.
-- ----------------------------------------------------------------------------
with insumos as (
    select p.id, p.nombre, p.marca, p.categoria, p.unidad, p.local,
           p.costo_unitario, p.updated_at
      from public.productos p
     where p.costo_unitario is not null
       and p.costo_unitario > 0
),
referencia as (
    select categoria,
           unidad,
           percentile_cont(0.5) within group (order by costo_unitario)::numeric as mediana,
           count(*)                                                    as insumos_comparados
      from insumos
     group by categoria, unidad
)
select
    i.local,
    i.categoria,
    i.nombre,
    coalesce(i.marca, '')                               as marca,
    i.unidad,
    i.costo_unitario,
    round(r.mediana, 2)                                 as mediana_de_su_categoria,
    r.insumos_comparados,
    round(r.mediana / nullif(i.costo_unitario, 0), 0)   as cuantas_veces_mas_chico,
    i.costo_unitario * 1000                             as valor_si_fuera_el_bug,
    case when i.costo_unitario <> round(i.costo_unitario, 2)
         then 'tiene más de 2 decimales → pinta a punto leído como coma'
         else '—'
    end                                                 as pista_extra,
    i.updated_at::date                                  as ultima_modificacion
from insumos i
join referencia r on r.categoria = i.categoria and r.unidad = i.unidad
where r.insumos_comparados >= 4          -- sin al menos 4 insumos no hay con qué comparar
  and i.costo_unitario < r.mediana / 100 -- el bug divide por 1000; 100 deja margen de sobra
  and i.updated_at >= timestamptz '2026-04-20 00:00:00-03'
  and i.updated_at <  timestamptz '2026-09-11 00:00:00-03'
order by cuantas_veces_mas_chico desc,
         i.updated_at desc;

-- 💡 La columna `pista_extra` es la firma del bug de Compras › Stock: un costo
--    de 1,234 no lo tipea nadie. Es "1.234" leído por el navegador como uno con
--    doscientos treinta y cuatro.


-- ----------------------------------------------------------------------------
-- (g ter) El único rastro que SÍ tiene fecha y usuario
--     Dos fuentes distintas, una abajo de la otra:
--       1. productos_costo_historial — solo registra el camino de Gastos
--       2. los ítems guardados dentro de cada gasto (`gastos.items_json`)
-- ----------------------------------------------------------------------------

-- 1. Cambios de costo registrados: se fue a cero, o se desplomó más de 100 veces
select
    'historial de costos'                       as fuente_del_dato,
    h.fecha::date                               as fecha,
    h.usuario,
    p.local,
    p.categoria,
    p.nombre                                    as insumo,
    p.unidad,
    h.costo_anterior,
    h.costo_nuevo,
    round(h.variacion_pct * 100, 1)             as variacion_pct,
    h.costo_nuevo * 1000                        as valor_si_fuera_el_bug,
    h.fuente                                    as origen_del_cambio,
    h.comentario
from public.productos_costo_historial h
join public.productos p on p.id = h.producto_id
where h.fecha >= timestamptz '2026-04-20 00:00:00-03'
  and h.fecha <  timestamptz '2026-09-11 00:00:00-03'
  and (
        h.costo_nuevo = 0
     or (h.costo_anterior > 0 and h.costo_nuevo < h.costo_anterior / 100)
      )
order by h.fecha desc;

-- 2. Ítems de gasto con el precio unitario o el subtotal en cero
--    (El `case` de adentro es a propósito: si algún gasto viejo guardó un
--     objeto en vez de una lista, la consulta lo saltea en vez de reventar.)
select
    g.fecha,
    g.local,
    g.proveedor,
    g.creado_por                                            as usuario,
    it->>'producto_nombre'                                  as insumo,
    (it->>'cantidad')::numeric                              as cantidad,
    (it->>'precio_unitario')::numeric                       as precio_unitario,
    (it->>'subtotal')::numeric                              as subtotal,
    g.importe_total                                         as total_del_gasto,
    round(coalesce((it->>'subtotal')::numeric, 0) * 1000, 2) as subtotal_si_fuera_el_bug,
    g.nro_comprobante,
    g.id                                                    as gasto_id
from public.gastos g
cross join lateral jsonb_array_elements(
    case when jsonb_typeof(g.items_json) = 'array' then g.items_json
         else '[]'::jsonb end
) as it
where g.fecha >= date '2026-04-20'
  and g.fecha <  date '2026-09-11'
  and coalesce(g.cancelado, false) = false
  and (
        coalesce((it->>'precio_unitario')::numeric, 0) = 0
     or coalesce((it->>'subtotal')::numeric, 0) = 0
      )
order by g.fecha desc;

-- 💡 Un ítem con precio unitario en cero y subtotal en cero puede ser una línea
--    que alguien empezó a cargar y abandonó. Uno con subtotal cargado y precio
--    unitario en cero es el otro caso: la cantidad quedó en cero y la división
--    lo forzó. Ese es el que puede haber pisado el costo del insumo.
-- ============================================================================
-- FIN. Ninguna de estas consultas escribe. Si alguna trae filas, el paso
-- siguiente es mirarlas de a una contra el papel — no correr un UPDATE masivo.
-- ============================================================================
