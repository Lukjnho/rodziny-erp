# Radiografía del stock — cómo está hoy

**10-sep-2026.** Todo medido: el código lo leyeron cuatro relevamientos en paralelo, y
los números salen de consultas de **solo lectura** contra producción. Ni un `UPDATE`.

---

## Lo que hay que saber antes de leer el resto

**1. El stock guardado y la suma de los movimientos no coinciden.**
De 429 productos con movimientos, **solo 93 cuadran (21,7 %)**. Los otros 336 no. El
desvío promedio es de **448 unidades** y el máximo llega a **66.409**.

**2. Casi nadie comprueba que la escritura haya entrado.** De las **82 escrituras de**
**stock, 75 no verifican cuántas filas tocaron: el 91 %.** En este proyecto eso no es un
detalle de estilo — un `UPDATE` que la seguridad de fila bloquea devuelve 0 filas y
ningún error, así que la pantalla dice "guardado" y no guardó nada.

**3. No hay un modelo de ubicaciones. Hay tres palabras sueltas.**
En toda la base existen **tres valores de ubicación** y usan **dos vocabularios**
distintos para el mismo lugar físico. La tabla más grande —10.015 movimientos— no tiene
ubicación en absoluto.

**4. La merma se anota y nunca se imputa a un lote.** 38 filas, 584 porciones, y **cero**
imputaciones en `cocina_lote_consumos`. La trazabilidad de la merma no existe.

---

## 1. Inventario de escrituras de stock

**82 lugares** suman, restan o pisan una cantidad.

| | |
|---|---:|
| En frontend | 57 |
| En rpc | 15 |
| En trigger | 9 |
| En edge | 1 |
| **No verifican filas afectadas** | **75 de 82 (91 %)** |
| Riesgo alto | 35 |
| Riesgo medio | 28 |
| Riesgo bajo | 19 |

### 🔴 Las 35 de riesgo alto

Éstas son las que pueden dejar el stock mal sin que nadie se entere.

| Dónde | Pantalla | Tabla | Qué hace | ¿Transacción? | ¿Verifica? |
|---|---|---|---|---|:-:|
| `C:/dev/rodziny-erp/src/modules/cocina/ProduccionQRPage.tsx:4129` | QR de producción → "Panadería" (segundo paso: dar de alta el pan) | `cocina_lotes_produccion` | suma — cantidad_producida (unidades de pan) — SUMA al stock, cada horneada se acumula | no — la masa ya se descontó en un paso anterior y separado | **NO** |
| `C:/dev/rodziny-erp/src/modules/cocina/ProduccionQRPage.tsx:5136` | QR de producción → "Cargar Milanesas" (paso 1: apagar el pesaje anterior) | `cocina_lotes_produccion` | pisa — en_stock = false sobre TODOS los lotes activos de esa receta y ese local | no — es el primero de dos pasos sueltos | **NO** |
| `C:/dev/rodziny-erp/src/modules/cocina/ProduccionQRPage.tsx:5146` | QR de producción → "Cargar Milanesas" (paso 2) | `cocina_lotes_produccion` | inserta — cantidad_producida en kg de milanesa | no — segundo de dos pasos sueltos | **NO** |
| `C:/dev/rodziny-erp/src/modules/cocina/ProduccionQRPage.tsx:5552` | QR de producción → flujo genérico (salsa, postre, pastelería, prueba…) — paso 1: apagar lo anterior | `cocina_lotes_produccion` | pisa — en_stock = false sobre los lotes activos de esa receta / nombre libre + local | no — dos pasos sueltos | **NO** |
| `C:/dev/rodziny-erp/src/modules/cocina/ProduccionQRPage.tsx:5568` | QR de producción → flujo genérico (salsa, postre, pastelería, prueba…) — paso 2 | `cocina_lotes_produccion` | suma — cantidad_producida + merma_cantidad, en la unidad del rubro | no — segundo de dos pasos sueltos | **NO** |
| `C:/dev/rodziny-erp/src/modules/cocina/StockTab.tsx:464` | Cocina → tab Stock → conteo físico de cámara | `cocina_cierre_camara` | pisa — cantidad_real — es un BASELINE: el stock arranca de nuevo desde ese número | si — un solo insert | **NO** |
| `C:/dev/rodziny-erp/src/modules/cocina/StockTab.tsx:1266` | Cocina → tab Stock → catálogo (salsas/postres/panificados) → "poner stock en X" (paso 1a: apagar por receta) | `cocina_lotes_produccion` | pisa — en_stock = false de los lotes activos con esa receta_id | no — son TRES pasos sueltos (apagar por receta, apagar por nombre, insertar) | **NO** |
| `C:/dev/rodziny-erp/src/modules/cocina/StockTab.tsx:1274` | Cocina → tab Stock → "poner stock en X" (paso 1b: apagar por nombre libre) | `cocina_lotes_produccion` | pisa — en_stock = false de los lotes con ese nombre_libre | no | **NO** |
| `C:/dev/rodziny-erp/src/modules/cocina/StockTab.tsx:1280` | Cocina → tab Stock → "poner stock en X" (paso 2: cargar el conteo) | `cocina_lotes_produccion` | inserta — cantidad_producida = el valor contado a mano | no | **NO** |
| `C:/dev/rodziny-erp/src/modules/cocina/DashboardTab.tsx:1192` | Cocina → tab Dashboard → cargar conteo de una salsa/postre (paso 1) | `cocina_lotes_produccion` | pisa — en_stock = false de los lotes activos de esa receta o nombre libre | no — dos pasos sueltos | **NO** |
| `C:/dev/rodziny-erp/src/modules/cocina/DashboardTab.tsx:1205` | Cocina → tab Dashboard → cargar conteo de una salsa/postre (paso 2) | `cocina_lotes_produccion` | inserta — cantidad_producida = el total real contado | no | **NO** |
| `C:/dev/rodziny-erp/src/modules/cocina/MostradorPage.tsx:639` | /mostrador → guardar cierre de pastas del turno (paso 1: borrar el cierre previo) | `cocina_cierre_dia` | borra — borra las filas del cierre anterior de ese local/fecha/turno | no — borra y después inserta, en dos llamadas | **NO** |
| `C:/dev/rodziny-erp/src/modules/cocina/MostradorPage.tsx:660` | /mostrador → guardar cierre de pastas del turno (paso 2) | `cocina_cierre_dia` | inserta — cantidad_real, inicial, entrega, vendido por producto | no | **NO** |
| `C:/dev/rodziny-erp/src/modules/cocina/MostradorPage.tsx:1132` | /mostrador → cierre simple (salsas / postres / panadería), paso 1: borrar el cierre previo | `cocina_cierre_dia` | borra — borra las filas del cierre anterior de ese local/fecha/tipo | no — es el primero de una cadena de hasta 4 escrituras POR PRODUCTO | **NO** |
| `C:/dev/rodziny-erp/src/modules/cocina/MostradorPage.tsx:1195` | /mostrador → cierre simple (salsas / postres / panadería), paso 2 | `cocina_cierre_dia` | inserta — cantidad_real contada de cada ítem | no | **NO** |
| `C:/dev/rodziny-erp/src/modules/cocina/MostradorPage.tsx:1207` | /mostrador → cierre simple, paso 3a (por cada producto: apagar lotes de esa receta) | `cocina_lotes_produccion` | pisa — en_stock = false | no — corre en un for, un producto por vez | **NO** |
| `C:/dev/rodziny-erp/src/modules/cocina/MostradorPage.tsx:1220` | /mostrador → cierre simple, paso 3b (apagar lotes por nombre libre) | `cocina_lotes_produccion` | pisa — en_stock = false, matcheando por nombre con ilike | no | **NO** |
| `C:/dev/rodziny-erp/src/modules/cocina/MostradorPage.tsx:1235` | /mostrador → cierre simple, paso 3c (crear el lote con lo contado) | `cocina_lotes_produccion` | inserta — cantidad_producida = lo que se contó al cerrar | no | **NO** |
| `C:/dev/rodziny-erp/src/modules/cocina/ProduccionTab.tsx:907` | Cocina → tab Producción → borrar un lote de pasta | `cocina_lotes_pasta` | borra — saca del stock las porciones / bandejas del lote | si — un solo delete | **NO** |
| `C:/dev/rodziny-erp/src/modules/cocina/ProduccionTab.tsx:1505` | Cocina → tab Producción → modal "Cerrar lote de masa" (desde la PC) | `cocina_lotes_masa` | pisa — kg_sobrante y destino_sobrante — descuenta la masa usada | no — UPDATE directo, sin pasar por la función | **NO** |
| `C:/dev/rodziny-erp/src/modules/cocina/components/PizarronPanelPasta.tsx:135` | /pizarron (tablet del depósito) → "Contar" | `cocina_cierre_camara` | pisa — cantidad_real — baseline nuevo de la cámara para ese producto | si — un solo insert | **NO** |
| `C:/dev/rodziny-erp/src/modules/cocina/components/EditarLoteModal.tsx:144` | Cocina → tab Producción → lápiz de "editar lote" (relleno, masa, pasta o producción) | `cocina_lotes_relleno / cocina_lotes_masa / cocina_lotes_pasta / cocina_lotes_produccion` | pisa — según la tabla: peso_total_kg, kg_producidos, kg_sobrante, masa_kg, relleno_kg, porciones, cantidad_cajones, merma_porcionado, sobrante_gramos, cantidad_producida | si — un solo update | **NO** |
| `C:/dev/rodziny-erp/src/modules/compras/ComprasPage.tsx:1628` | Compras → Recepción desde el export de Fudo → "Confirmar recepción" (paso 1) | `movimientos_stock` | inserta — cantidad recibida, como movimiento de entrada | no — dos escrituras sueltas por producto, dentro de un for | **NO** |
| `C:/dev/rodziny-erp/src/modules/compras/ComprasPage.tsx:1642` | Compras → Recepción desde el export de Fudo → "Confirmar recepción" (paso 2) | `productos` | suma — stock_actual = stock que tenía el navegador + lo recibido | no | **NO** |
| `C:/dev/rodziny-erp/src/modules/compras/ComprasPage.tsx:2306` | Compras → Almacén → modo "Conteo de inventario" → Confirmar ajuste (paso 1, por producto) | `movimientos_stock` | inserta — la diferencia entre lo contado y lo que decía el sistema, como entrada o salida | no — dos escrituras sueltas por producto, en un for | **NO** |
| `C:/dev/rodziny-erp/src/modules/compras/ComprasPage.tsx:2321` | Compras → Almacén → modo "Conteo de inventario" → Confirmar ajuste (paso 2, por producto) | `productos` | pisa — stock_actual = el valor contado (lo reemplaza) | no | **NO** |
| `C:/dev/rodziny-erp/src/modules/compras/ComprasPage.tsx:2829` | Compras → Almacén → lista de movimientos → botón ✕ "Eliminar y revertir stock" (paso 1) | `productos` | pisa — stock_actual revertido: si fue salida suma, si fue entrada resta | no — lee, calcula en el navegador y escribe, en tres llamadas separadas | **NO** |
| `C:/dev/rodziny-erp/src/modules/compras/ComprasPage.tsx:2833` | Compras → Almacén → lista de movimientos → botón ✕ "Eliminar y revertir stock" (paso 2) | `movimientos_stock` | borra — borra el movimiento | no | **NO** |
| `C:/dev/rodziny-erp/src/modules/compras/ComprasPage.tsx:4500` | Compras → Almacén → modal "Ajustar stock" de un producto (paso 2) | `productos` | pisa — stock_actual = el número que puso la persona (lo reemplaza) | no | **NO** |
| `supabase/migrations/050_cocina_lote_trazabilidad.sql:54 — fifo_consumir_camara_pasta()` | ninguna directa: la llaman los tres triggers de FIFO (traspaso, ajuste de camara, merma) | `cocina_lote_consumos` | inserta — cantidad — cuantas porciones se le imputan a cada lote al salir de la camara | si — corre dentro de la transaccion del trigger que la llamo | **NO** |
| `supabase/migrations/190_las_mesas_del_salon.sql:470 — salon_sacar_linea()` | telefono del mozo / mostrador: sacar un plato de la mesa | `caja_mesa_lineas` | pisa — estado del renglon pasa a 'sacada' (el plato deja de contar en la cuenta) | si — un solo UPDATE | **NO** |
| `supabase/migrations/190_las_mesas_del_salon.sql:512 — salon_enviar_a_cocina()` | telefono del mozo: mandar la comanda a la cocina | `caja_mesa_envios (inserta) + caja_mesa_lineas (envio_id)` | pisa — engancha cada renglon con el envio; es lo que despues cuenta como salida de camara | si — insert del envio y update de los renglones en la misma funcion | **NO** |
| `supabase/migrations/050_cocina_lote_trazabilidad.sql:130 — trg_traspaso_fifo() sobre cocina_traspasos (ins/upd/del)` | Cocina: traspaso de porciones de la camara al mostrador | `cocina_lote_consumos` | borra — cuantas porciones se le descuentan a cada lote | si — el DELETE y el re-armado van en la transaccion del traspaso | **NO** |
| `supabase/migrations/050_cocina_lote_trazabilidad.sql:172 — trg_ajuste_camara_fifo() sobre cocina_ajustes_stock (ins/upd/del)` | Cocina: ajuste manual de stock de camara | `cocina_lote_consumos` | borra — el delta negativo se reparte entre los lotes en camara | si — dentro de la transaccion del ajuste | **NO** |
| `supabase/migrations/168_merma_camara_descuenta_lotes.sql:30 — trg_merma_camara_fifo() sobre cocina_merma (ins/upd/del)` | pizarron del deposito, boton «Se perdio» | `cocina_lote_consumos` | borra — las porciones de la merma se descuentan del lote concreto | si — dentro de la transaccion de la merma | **NO** |

<details><summary><b>El detalle de por qué cada una es de riesgo alto</b></summary>

**`C:/dev/rodziny-erp/src/modules/cocina/ProduccionQRPage.tsx:4129`** — Si esto falla, la masa YA quedó descontada y el pan no existe: stock perdido de los dos lados. El código lo sabe y muestra el aviso "la masa ya quedó descontada, avisá para cargar el pan desde la PC", pero sólo si vino error. Si vuelve 0 filas sin error, nadie se entera.

**`C:/dev/rodziny-erp/src/modules/cocina/ProduccionQRPage.tsx:5136`** — Este es exactamente el caso peligroso: un UPDATE masivo que la RLS puede bloquear devolviendo 0 filas y ningún error. Si eso pasa, el paso 2 igual inserta el lote nuevo y el stock de milanesa queda DUPLICADO (el viejo nunca se apagó).

**`C:/dev/rodziny-erp/src/modules/cocina/ProduccionQRPage.tsx:5146`** — Si el paso 1 apagó los lotes viejos y este falla, la milanesa desaparece del stock (quedó todo apagado y nada nuevo). Modelo 'último pesaje manda'.

**`C:/dev/rodziny-erp/src/modules/cocina/ProduccionQRPage.tsx:5552`** — Sólo corre para los rubros NO aditivos (pasta/milanesa). Mismo riesgo que el de milanesa: 0 filas sin error = stock duplicado. Ojo con las salsas: la pantalla avisa que SUMAN y pide confirmación explícita, así que ahí no se apaga nada.

**`C:/dev/rodziny-erp/src/modules/cocina/ProduccionQRPage.tsx:5568`** — Si el paso 1 apagó y este no entra, el stock del producto queda en cero sin que nadie lo note.

**`C:/dev/rodziny-erp/src/modules/cocina/StockTab.tsx:464`** — Es la escritura que más manda sobre el stock de pastas (todo lo posterior se cuenta a partir de acá) y no confirma nada más que la ausencia de error. Si no entra, el conteo del día se pierde y el sistema sigue con el número viejo.

**`C:/dev/rodziny-erp/src/modules/cocina/StockTab.tsx:1266`** — Tres escrituras encadenadas sin transacción y ninguna cuenta filas. Cualquier corte a mitad de camino deja el stock inventado.

**`C:/dev/rodziny-erp/src/modules/cocina/StockTab.tsx:1274`** — Mismo bloque que el anterior. Apaga por nombre para barrer los lotes viejos sin receta.

**`C:/dev/rodziny-erp/src/modules/cocina/StockTab.tsx:1280`** — Si los dos updates de arriba funcionaron y este no entra, el producto queda en cero.

**`C:/dev/rodziny-erp/src/modules/cocina/DashboardTab.tsx:1192`** — Tercera pantalla distinta que hace el mismo apagá-e-insertá (QR, Stock y Dashboard). Ninguna cuenta filas.

**`C:/dev/rodziny-erp/src/modules/cocina/DashboardTab.tsx:1205`** — Sólo mira el error.

**`C:/dev/rodziny-erp/src/modules/cocina/MostradorPage.tsx:639`** — Un DELETE que la RLS bloquea devuelve 0 filas sin error; después el insert choca contra el índice único y el cierre se pierde con un error confuso. Ya cambiaron el borrado para que vaya por local/fecha/tipo/turno en vez de por ids viejos, pero sigue sin contar.

**`C:/dev/rodziny-erp/src/modules/cocina/MostradorPage.tsx:660`** — El cierre define el stock inicial del turno siguiente. Antes de guardar sí hay un guardarraíl bueno: si un número supera el máximo histórico, pide confirmación.

**`C:/dev/rodziny-erp/src/modules/cocina/MostradorPage.tsx:1132`** — Arranca la cadena más larga de todo el frontend: borrar, insertar cierre, y después por cada producto apagar por receta, apagar por nombre e insertar lote nuevo. Todo suelto.

**`C:/dev/rodziny-erp/src/modules/cocina/MostradorPage.tsx:1195`** — Buenos guardarraíles previos: rechaza números que no parsean y rebota valores absurdos (más de 100 kg / 1000 unidades) por si cargaron gramos como kilos.

**`C:/dev/rodziny-erp/src/modules/cocina/MostradorPage.tsx:1207`** — Si esto se bloquea en silencio para un producto, ese producto queda con el stock viejo MÁS el nuevo del cierre: contás 10 y el sistema muestra 30.

**`C:/dev/rodziny-erp/src/modules/cocina/MostradorPage.tsx:1220`** — Existe para barrer los lotes huérfanos del modelo viejo. Igual de ciego que el anterior.

**`C:/dev/rodziny-erp/src/modules/cocina/MostradorPage.tsx:1235`** — Marca origen='cierre' para que el pizarrón no lo confunda con producción real. Si falla a mitad del for, quedan productos re-baseliniados y otros no.

**`C:/dev/rodziny-erp/src/modules/cocina/ProduccionTab.tsx:907`** — Es el borrado que más plata mueve (un lote de pasta son cientos de porciones) y no confirma nada.

**`C:/dev/rodziny-erp/src/modules/cocina/ProduccionTab.tsx:1505`** — ⚠️ Es el MISMO cierre de masa que en el QR va por la RPC cocina_cerrar_masa (que sí confirma). Acá quedó el UPDATE directo viejo, sin contar filas: es exactamente el bug que la migración 172 arregló del otro lado. Si la RLS lo bloquea, la masa nunca se descuenta y se puede volver a usar.

**`C:/dev/rodziny-erp/src/modules/cocina/components/PizarronPanelPasta.tsx:135`** — Sólo mira el error. Es la misma escritura que el conteo del tab Stock: re-baseliniza todo el stock del producto.

**`C:/dev/rodziny-erp/src/modules/cocina/components/EditarLoteModal.tsx:144`** — Es la puerta que puede reescribir CUALQUIER cantidad de CUALQUIER lote de cocina, y no cuenta filas. Un UPDATE bloqueado cierra el modal, invalida las queries y muestra los valores viejos como si los hubiera guardado.

**`C:/dev/rodziny-erp/src/modules/compras/ComprasPage.tsx:1628`** — 💣 Acá NI SIQUIERA se mira el error: es `await supabase.from('movimientos_stock').insert({...})` a secas, sin destructurar. Y como supabase-js no tira excepción, el try/catch que lo envuelve no atrapa nada. La pantalla siempre dice "X items recepcionados".

**`C:/dev/rodziny-erp/src/modules/compras/ComprasPage.tsx:1642`** — 💣 Dos problemas juntos: tampoco mira el error, y suma sobre `prod.stock_actual`, que es el número que el navegador cargó cuando abrió la pantalla. Si otro movió el stock mientras tanto, este UPDATE le pisa el cambio. La versión buena de esto es la RPC recepcionar_mercaderia que usa /recepcion.

**`C:/dev/rodziny-erp/src/modules/compras/ComprasPage.tsx:2306`** — Sí mira el error (mejor que el flujo de Fudo) y lleva una lista de fallidos para reportar cuáles no se pudieron guardar. Pero no cuenta filas: un bloqueo de RLS entra en la cuenta de "guardados".

**`C:/dev/rodziny-erp/src/modules/compras/ComprasPage.tsx:2321`** — Si el movimiento entró y este UPDATE se bloquea en silencio, queda el papel del ajuste pero el stock sin corregir: el movimiento y el stock dejan de cuadrar.

**`C:/dev/rodziny-erp/src/modules/compras/ComprasPage.tsx:2829`** — 💣 Ni error ni filas: `await supabase.from('productos').update({...})` pelado. Además es leer-calcular-escribir sin bloqueo, así que dos personas reviertiendo a la vez se pisan.

**`C:/dev/rodziny-erp/src/modules/compras/ComprasPage.tsx:2833`** — 💣 Tampoco mira el error. El caso feo: el stock se revierte y el movimiento NO se borra → se puede revertir dos veces el mismo movimiento.

**`C:/dev/rodziny-erp/src/modules/compras/ComprasPage.tsx:4500`** — Mira el error pero no las filas. Si se bloquea, el movimiento del paso 1 ya quedó registrado y el stock no cambió: la pantalla muestra el ajuste en la lista de resultados igual.

**`supabase/migrations/050_cocina_lote_trazabilidad.sql:54 — fifo_consumir_camara_pasta()`** — EL AGUJERO MAS CARO DEL INVENTARIO. Recorre los lotes en camara en orden FIFO y va insertando consumos hasta cubrir la cantidad pedida. Si el stock no alcanza, reparte lo que hay, deja el resto sin imputar y avisa con un RAISE NOTICE — que va al log del servidor y no lo lee nadie. Devuelve cuanto pudo asignar, pero los TRES triggers que la usan la llaman con PERFORM, o sea que descartan ese numero. Traduccion: tiras una bandeja de 20 porciones y si en camara habia 12, descuenta 12 y las otras 8 desaparecen sin una sola senal.

**`supabase/migrations/190_las_mesas_del_salon.sql:470 — salon_sacar_linea()`** — ES EXACTAMENTE EL CASO DE LA REGLA. Es invoker (NO security definer): la RLS le pega de verdad. Valida bastante antes (que el plato exista, que no este cobrado, que la mesa este abierta) pero despues hace el UPDATE y no mira nada. Si la regla lo descarta, devuelve 0 filas y NINGUN error: el mozo ve «sacado» y el plato sigue en la cuenta del cliente.

**`supabase/migrations/190_las_mesas_del_salon.sql:512 — salon_enviar_a_cocina()`** — La mas cara de las del salon. Invoker, sin conteo de filas en el UPDATE. Si el UPDATE no entra, la comanda queda creada y vacia: los renglones quedan con envio_id null. Y como cocina_salidas_de_camara (mig 195) cuenta lo que salio del salon POR ENVIO, esas porciones nunca se descuentan de la camara. El stock queda alto y la falta aparece recien en el conteo fisico.

**`supabase/migrations/050_cocina_lote_trazabilidad.sql:130 — trg_traspaso_fifo() sobre cocina_traspasos (ins/upd/del)`** — Patron borrar-y-rehacer: en UPDATE y DELETE borra TODOS los consumos viejos de ese traspaso y despues vuelve a repartir con fifo_consumir_camara_pasta. El DELETE no cuenta filas y el reparto tampoco: si al rehacer no alcanza el stock, ya borro lo viejo y repuso menos. Es SECURITY DEFINER, asi que la RLS no lo frena hoy, pero el silencio del FIFO sigue estando.

**`supabase/migrations/050_cocina_lote_trazabilidad.sql:172 — trg_ajuste_camara_fifo() sobre cocina_ajustes_stock (ins/upd/del)`** — Mismo borrar-y-rehacer que el de traspasos y el mismo silencio del FIFO. Los ajustes POSITIVOS no se imputan a ningun lote a proposito (no hay lote de origen): quedan como ajuste libre, o sea que suman al total pero no aparecen en el detalle por lote.

**`supabase/migrations/168_merma_camara_descuenta_lotes.sql:30 — trg_merma_camara_fifo() sobre cocina_merma (ins/upd/del)`** — El mas nuevo de los tres (sep 2026) y hereda los dos problemas: borrar-y-rehacer sin contar filas, y el FIFO que reparte de menos en silencio. Dos cosas mas, que estan escritas en la propia migracion: saltea las mermas de receta (salsas, pan, postres) porque no tienen lote de pasta, y NO toco las 25 mermas historicas — ese backfill quedo pendiente a proposito.

</details>

<details><summary><b>Las otras 47 escrituras</b></summary>

| Dónde | Capa | Tabla | Qué hace | ¿Verifica? | Riesgo |
|---|---|---|---|:-:|---|
| `C:/dev/rodziny-erp/src/modules/cocina/ProduccionQRPage.tsx:3728` | frontend | `cocina_lotes_pasta (vía RPC porcionar_pasta_lote)` | pisa — porciones, merma_porcionado, sobrante_gramos, fecha/hora de porcionado del lote | no | bajo |
| `C:/dev/rodziny-erp/src/modules/cocina/ProduccionTab.tsx:1369` | frontend | `cocina_lotes_pasta (vía RPC porcionar_pasta_lote)` | pisa — porciones y merma del lote de pasta | no | bajo |
| `C:/dev/rodziny-erp/src/modules/cocina/ProduccionQRPage.tsx:3088` | frontend | `cocina_lotes_pasta` | inserta — masa_kg, relleno_kg, porciones o cantidad_cajones — el alta del lote que después es stock de cámara/freezer | sí | bajo |
| `C:/dev/rodziny-erp/src/modules/cocina/ProduccionQRPage.tsx:3141` | frontend | `cocina_lotes_pasta_masas` | inserta — masa_kg consumida de cada lote de masa | no | medio |
| `C:/dev/rodziny-erp/src/modules/cocina/ProduccionQRPage.tsx:2517` | frontend | `cocina_lotes_relleno` | inserta — peso_total_kg (kg de puré que van al depósito), bolsas, kg_papa | no | medio |
| `C:/dev/rodziny-erp/src/modules/cocina/ProduccionQRPage.tsx:2574` | frontend | `cocina_lotes_relleno` | inserta — peso_total_kg, cantidad_recetas | no | medio |
| `C:/dev/rodziny-erp/src/modules/cocina/ProduccionQRPage.tsx:4344` | frontend | `cocina_lotes_masa` | inserta — kg_producidos | no | medio |
| `C:/dev/rodziny-erp/src/modules/cocina/ProduccionQRPage.tsx:4499` | frontend | `cocina_lotes_masa (vía RPC cocina_cerrar_masa)` | resta — kg_sobrante y destino del sobrante — cierra el lote y descuenta la masa | sí | bajo |
| `C:/dev/rodziny-erp/src/modules/cocina/ProduccionQRPage.tsx:4100` | frontend | `cocina_lotes_masa (vía RPC cocina_cerrar_masa)` | resta — kg_sobrante — descuenta la masa que se usó para el pan | sí | bajo |
| `C:/dev/rodziny-erp/src/modules/cocina/ProduccionQRPage.tsx:4854` | frontend | `cocina_lotes_produccion` | suma — cantidad_producida (porciones de postre) | no | medio |
| `C:/dev/rodziny-erp/src/modules/cocina/ProduccionQRPage.tsx:6017` | frontend | `cocina_merma` | resta — porciones perdidas — la vista de stock las resta | no | medio |
| `C:/dev/rodziny-erp/src/modules/cocina/StockTab.tsx:437` | frontend | `cocina_ajustes_stock` | suma — delta (positivo o negativo) de porciones | no | medio |
| `C:/dev/rodziny-erp/src/modules/cocina/MostradorPage.tsx:535` | frontend | `cocina_traspasos` | suma — porciones bajadas del freezer al mostrador | sí | bajo |
| `C:/dev/rodziny-erp/src/modules/cocina/TraspasosTab.tsx:515` | frontend | `cocina_traspasos` | resta — porciones que bajan de cámara al mostrador | no | medio |
| `C:/dev/rodziny-erp/src/modules/cocina/TraspasosTab.tsx:671` | frontend | `cocina_merma` | resta — porciones perdidas | no | medio |
| `C:/dev/rodziny-erp/src/modules/cocina/TraspasosTab.tsx:168` | frontend | `cocina_traspasos` | borra — elimina porciones ya bajadas — el stock vuelve para arriba | no | medio |
| `C:/dev/rodziny-erp/src/modules/cocina/TraspasosTab.tsx:179` | frontend | `cocina_merma` | borra — elimina porciones dadas de baja — el stock vuelve para arriba | no | medio |
| `C:/dev/rodziny-erp/src/modules/cocina/ProduccionTab.tsx:889` | frontend | `cocina_lotes_relleno` | borra — saca del stock los kg de relleno del lote | no | medio |
| `C:/dev/rodziny-erp/src/modules/cocina/ProduccionTab.tsx:898` | frontend | `cocina_lotes_masa` | borra — saca del stock los kg de masa del lote | no | medio |
| `C:/dev/rodziny-erp/src/modules/cocina/ProduccionTab.tsx:920` | frontend | `cocina_lotes_produccion` | borra — saca del stock la cantidad producida del lote | no | medio |
| `C:/dev/rodziny-erp/src/modules/cocina/components/PizarronPanelPasta.tsx:158` | frontend | `cocina_traspasos` | resta — porciones que salen de la cámara | no | medio |
| `C:/dev/rodziny-erp/src/modules/cocina/components/PizarronPanelPasta.tsx:169` | frontend | `cocina_merma` | resta — porciones perdidas en cámara | no | medio |
| `C:/dev/rodziny-erp/src/modules/compras/RecepcionPage.tsx:237` | frontend | `productos.stock_actual + movimientos_stock + recepciones_pendientes (vía RPC recepcionar_mercaderia)` | suma — suma la cantidad recibida al stock de cada insumo y deja el movimiento de entrada | no | bajo |
| `C:/dev/rodziny-erp/src/modules/compras/components/DepositoForm.tsx:128` | frontend | `productos.stock_actual + movimientos_stock (vía RPC registrar_salida_deposito)` | resta — resta la cantidad que sale del insumo | no | medio |
| `C:/dev/rodziny-erp/src/modules/compras/components/TrasladoPastasForm.tsx:125` | frontend | `cocina_traspasos` | resta — porciones y cantidad_cajones trasladados | no | medio |
| `C:/dev/rodziny-erp/src/modules/compras/ComprasPage.tsx:4480` | frontend | `movimientos_stock` | inserta — la diferencia contra el stock actual, como entrada o salida | no | medio |
| `C:/dev/rodziny-erp/src/modules/compras/ComprasPage.tsx:4277` | frontend | `productos` | inserta — stock_actual = 0 al crear el insumo | no | bajo |
| `C:/dev/rodziny-erp/src/modules/productos/components/InsumosTab.tsx:56` | frontend | `productos` | pisa — NO toca stock: pisa costo_unitario o merma_pct | no | bajo |
| `supabase/migrations/108_camara_baseline_porcionado.sql:27 — porcionar_pasta_lote()` | rpc | `cocina_lotes_pasta` | pisa — porciones (y merma_porcionado, sobrante_gramos, ubicacion pasa de freezer_produccion a camara_congelado) | no | medio |
| `supabase/migrations/102_recepcionar_mercaderia_rpc.sql:13 — recepcionar_mercaderia()` | rpc | `productos (stock_actual) + movimientos_stock + recepciones_pendientes` | suma — productos.stock_actual (suma) y movimientos_stock.cantidad (entrada) | no | bajo |
| `supabase/migrations/182_el_deposito_deja_de_tragarse_los_errores.sql:60 — registrar_salida_deposito()` | rpc | `productos (stock_actual) + movimientos_stock` | resta — productos.stock_actual (resta con piso en cero) y movimientos_stock.cantidad + cantidad_sin_stock | no | bajo |
| `supabase/migrations/172_cerrar_masa_desde_la_tablet.sql:23 — cocina_cerrar_masa()` | rpc | `cocina_lotes_masa` | pisa — kg_sobrante y destino_sobrante | sí | bajo |
| `supabase/migrations/049_pizarron_carry_over_lotes.sql:18 — recalcular_pizarron_para_lote()` | rpc | `cocina_pizarron_items` | pisa — cantidad_hecha y estado del item del plan (en_produccion / en_bandejas / ciclo_completo) | no | medio |
| `supabase/migrations/105_pizarron_pasta_simple_cumplido.sql:61 — recalcular_pizarron_pasta_simple()` | rpc | `cocina_pizarron_items` | pisa — cantidad_hecha = suma de porciones de pasta simple de ese producto/fecha/local | no | medio |
| `supabase/migrations/189_cobrar_es_una_sola_transaccion.sql:334 — cobrar_venta()` | rpc | `ventas_tickets + ventas_items + ventas_pagos` | inserta — ventas_items.cantidad (cantidad VENDIDA, no stock) y los montos | sí | bajo |
| `supabase/migrations/193_cobrar_la_mesa.sql:219 — salon_cobrar_mesa()` | rpc | `caja_mesa_lineas (ticket_id) + caja_mesa_sesiones (estado) + todo lo que escribe cobrar_venta` | pisa — marca cada renglon de la mesa con el ticket que se lo llevo, y cierra la sesion | sí | bajo |
| `supabase/migrations/190_las_mesas_del_salon.sql:597 — salon_anular_sesion()` | rpc | `caja_mesa_lineas + caja_mesa_sesiones` | pisa — pone todos los renglones en 'sacada' y la sesion en 'anulada' | no | medio |
| `supabase/migrations/190_las_mesas_del_salon.sql:558 — salon_pedir_la_cuenta()` | rpc | `caja_mesa_sesiones` | pisa — estado de la sesion pasa a 'cuenta_pedida' | no | medio |
| `supabase/migrations/190_las_mesas_del_salon.sql:388 — salon_agregar_linea()` | rpc | `caja_mesa_lineas` | inserta — cantidad y precio_unitario del renglon (el precio lo pone la carta, no el telefono) | no | bajo |
| `supabase/migrations/078_cocina_lotes_produccion_origen.sql:30 — trg_pizarron_lote_produccion() sobre cocina_lotes_produccion (AFTER INSERT)` | trigger | `cocina_pizarron_items` | pisa — cantidad_hecha y estado del item del plan, que pasa a 'ciclo_completo' | no | medio |
| `supabase/migrations/105_pizarron_pasta_simple_cumplido.sql:130 — trg_pizarron_lote_pasta() sobre cocina_lotes_pasta (AFTER INSERT y AFTER UPDATE OF ubicacion)` | trigger | `cocina_pizarron_items (via recalcular_pizarron_para_lote y recalcular_pizarron_pasta_simple)` | pisa — estado y cantidad_hecha del item del plan | no | medio |
| `supabase/migrations/031_pizarron_etapas_pasta.sql:128 y :145 — trg_pizarron_lote_relleno() y trg_pizarron_lote_masa() sobre cocina_lotes_relleno y cocina_lotes_masa (AFTER INSERT)` | trigger | `cocina_pizarron_items (via recalcular_pizarron_para_lote)` | pisa — estado y cantidad_hecha del item del plan | no | bajo |
| `supabase/migrations/105_pizarron_pasta_simple_cumplido.sql:171 — trg_pizarron_reset_pasta_simple_del() sobre cocina_lotes_pasta (AFTER DELETE)` | trigger | `cocina_pizarron_items (via recalcular_pizarron_pasta_simple)` | pisa — vuelve a calcular cantidad_hecha y estado del item del plan | no | bajo |
| `supabase/esquema-aplicado.sql:2086 — trg_pizarron_reset_on_lote_delete()` | trigger | `cocina_pizarron_items (presunto)` | pisa — no lo pude determinar | no | medio |
| `supabase/migrations/027_mostrador_entrega_deposito.sql:21 — registrar_merma_conteo_mostrador() / trigger trg_merma_conteo_mostrador` | trigger | `cocina_merma (insertaba)` | inserta — insertaba la merma calculada como inicial + entrega - vendido - real | no | bajo |
| `supabase/functions/fudo-importar-ventas/index.ts:670 (borrado) y :708 (reposicion)` | edge | `ventas_tickets + ventas_pagos + ventas_items` | borra — ventas_items.cantidad — cantidad VENDIDA, no stock | no | medio |
| `supabase/esquema-aplicado.sql:2026 — snapshot_inventario_actual(p_local)` | rpc | `ninguna — es lectura` | pisa — devuelve montos valorizados de alimentos, bebidas e indirectos; no escribe | no | bajo |

</details>

---

## 2. Las tablas que guardan cantidades

### Las cuatro que pediste, con filas reales

| Tabla | Filas | Desde | Hasta | Columna de cantidad | Qué guarda |
|---|---:|---|---|---|---|
| `movimientos_stock` | 10.015 | 08-abr | 10-sep | `cantidad` + `tipo` (entrada/salida) | El almacén de insumos. La más grande de todas. |
| `cocina_ajustes_stock` | 143 | 30-abr | 01-sep | `delta` (con signo) | Correcciones a mano de cámara y mostrador. **Solo Vedia.** |
| `cocina_merma` | 38 | 06-jun | 03-sep | `porciones` | Lo que se tiró. |
| `cocina_traspasos` | 525 | 28-abr | 09-sep | `porciones` + `cantidad_cajones` | De la cámara al mostrador. |

### Y hay nueve más que también guardan cantidades

La pregunta era si había más. Hay.

| Tabla | Filas | Desde | Hasta | Qué cantidad guarda |
|---|---:|---|---|---|
| `cocina_lote_consumos` | 729 | 28-abr | 09-sep | Qué lote de cámara se consumió en cada salida (la trazabilidad FIFO) |
| `cocina_lotes_pasta` | 408 | 28-abr | 10-sep | `porciones` producidas — es el stock de cámara |
| `cocina_lotes_produccion` | 4.615 | 28-abr | 10-sep | `cantidad_producida` de salsas, postres, panes, milanesas |
| `cocina_lotes_masa` | 232 | 28-abr | 10-sep | `kg_producidos` y `kg_sobrante` |
| `cocina_lotes_relleno` | 245 | 28-abr | 10-sep | `peso_total_kg` |
| `cocina_lotes_pasta_masas` | 55 | — | — | Qué masa se usó en qué pasta — **solo 21 de 408 lotes** |
| `cocina_cierre_camara` | 136 | 12-jun | 08-sep | Conteo físico de la cámara |
| `cocina_cierre_dia` | 4.987 | 30-abr | 10-sep | Conteo físico del mostrador |
| `productos.stock_actual` | 429 | — | — | El saldo del almacén, **pisado en cada cambio** |

> 💣 **`cocina_lotes_pasta_masas` es el agujero de trazabilidad más grande.** Es la tabla
> que dice de qué masa salió cada pasta, y **solo cubre 21 de los 408 lotes (5 %)**. Para
> el 95 % de la producción no hay forma de saber qué se consumió para hacerla.

<details><summary><b>Quién escribe y quién lee cada tabla (del relevamiento del código)</b></summary>

| Tabla | Para qué | Quién escribe | Quién lee |
|---|---|---|---|
| `movimientos_stock` | El libro de entradas y salidas del almacen de insumos (harina, bebidas, packaging): cada movimiento queda anotado y aparte se pisa productos.stock_actual. | src/modules/compras/ComprasPage.tsx:1628 — confirmar recepcion desde el export de Fudo (INSERT suelto), src/modules/compras/ComprasPage.tsx:2306 — conteo fisico masivo (Inventario fisico), src/modules/compras/ComprasPage.tsx:4480 — modal de ajuste de stock de un producto, src/modules/compras/ComprasPage.tsx:2833 — DELETE de un movimiento (deshacer), src/modules/compras/RecepcionPage.tsx:237 — QR /recepcion, via RPC recepcionar_mercaderia (mig 102), src/modules/compras/components/DepositoForm.tsx:129 — QR /deposito, via RPC registrar_salida_deposito (mig 106/182) | src/modules/compras/ComprasPage.tsx:357 — listado de movimientos del periodo (y el calculo de neto en la linea 395) |
| `cocina_ajustes_stock` | El 'me sobra/me falta' de las porciones de pasta ya hechas: guarda la DIFERENCIA contra lo que la cuenta decia, no el numero contado. | src/modules/cocina/StockTab.tsx:437 — mutation guardarAjuste, disparada desde el modal de ajuste. Hoy solo se usa para MOSTRADOR: desde el baseline de camara (mig 108) el boton de camara escribe en cocina_cierre_camara, no aca (StockTab.tsx:993) | Ningun archivo del front la lee directo, Vista v_cocina_stock_pastas (mig 108/125/161/163/164) — suma los delta de ubicacion='camara', Vista v_cocina_stock_mostrador (mig 170) — suma los delta de ubicacion='mostrador' posteriores al ultimo corte, Trigger trg_ajuste_camara_fifo (mig 050) — si ubicacion='camara' y delta<0, imputa el consumo a lotes por FIFO |
| `cocina_merma` | Pasta que se perdio: se tiro, se rompio, se vencio. Resta del stock en las dos ubicaciones (camara y mostrador). | src/modules/cocina/TraspasosTab.tsx:671 — modal 'Registrar merma', src/modules/cocina/ProduccionQRPage.tsx:6017 — flujo de merma del QR de produccion (acepta producto_id O receta_id), src/modules/cocina/components/PizarronPanelPasta.tsx:169 — boton 'Sacar → perdido' del pizarron del deposito, src/modules/cocina/TraspasosTab.tsx:179 — DELETE de una merma cargada | src/modules/cocina/TraspasosTab.tsx:131 — listado del dia, src/modules/cocina/DashboardTab.tsx:931 — merma de hoy, src/modules/almacen/StockCongeladosTab.tsx:78 — stock de congelados de Saavedra, src/modules/cocina/StockTab.tsx:226 — suscripcion realtime (para refrescar, no para leer datos), Vistas v_cocina_stock_pastas y v_cocina_stock_mostrador, Trigger trg_merma_camara_fifo (mig 050) |
| `cocina_traspasos` | El viaje de la pasta de la camara al mostrador. En Vedia se anota; en Saavedra no existe (una sola sala, no hay etapa intermedia) — el comentario de MostradorPage.tsx:278 dice que no hay NI UNA fila de Saavedra en cinco meses. | src/modules/cocina/TraspasosTab.tsx:515 — modal 'Registrar traspaso', src/modules/compras/components/TrasladoPastasForm.tsx:125 — QR de traslado de pastas, src/modules/cocina/components/PizarronPanelPasta.tsx:158 — boton 'Sacar → mostrador' del pizarron, src/modules/cocina/MostradorPage.tsx:535 — boton 'anotar el traspaso que falto' durante el cierre de mostrador, src/modules/cocina/TraspasosTab.tsx:168 — DELETE | src/modules/cocina/TraspasosTab.tsx:118, src/modules/cocina/MostradorPage.tsx:264 — para calcular la entrega desde el ultimo cierre, src/modules/almacen/StockCongeladosTab.tsx:65, src/modules/cocina/PizarronPage.tsx:114, src/modules/cocina/StockTab.tsx:212 — realtime, Vistas v_cocina_stock_pastas, v_cocina_stock_mostrador y v_cocina_lote_pasta_saldo, Trigger FIFO de mig 050 (INSERT/UPDATE/DELETE) |
| `cocina_cierre_camara` | El conteo fisico de la camara. NO es un ajuste: guarda el numero contado como PUNTO DE PARTIDA (baseline, mig 108). Lo que se porciona despues suma encima. | src/modules/cocina/StockTab.tsx:464 — mutation guardarCierreCamara (el boton de ajuste de camara la manda aca), src/modules/cocina/components/PizarronPanelPasta.tsx:135 — boton 'Contar' del pizarron del deposito | src/modules/cocina/PizarronPage.tsx:123, Vistas v_cocina_stock_pastas y v_cocina_stock_mostrador (define el corte desde el cual se cuentan traspasos, mermas y ventas) |
| `cocina_cierre_dia` | Cierre obligatorio por turno o fin de dia del mostrador y de otros rubros: cuanto quedo fisicamente al cerrar. | src/modules/cocina/MostradorPage.tsx:660 — cierre de mostrador, src/modules/cocina/MostradorPage.tsx:1195 — segundo flujo de cierre (y despues sincroniza cocina_lotes_produccion en 1207/1220/1235) | src/modules/cocina/CierresTab.tsx:154 y 234, src/modules/cocina/hooks/useCierresFaltantes.ts:93, src/modules/cocina/MostradorPage.tsx:332, 362, 638, 1084, 1131, Vistas de stock de Saavedra (migs 125 y 161 lo usan como baseline de camara para ese local) |
| `cocina_lote_consumos` | Trazabilidad: cada salida de camara queda imputada a UN lote concreto por FIFO. Es la unica forma de saber el saldo vivo de un lote. | NADIE desde el front. Solo la base: la funcion fifo_consumir_camara_pasta (mig 050) llamada por los triggers trg_traspaso_fifo, trg_ajuste_camara_fifo y trg_merma_camara_fifo | Vistas v_cocina_lote_pasta_saldo y v_cocina_pizarron_trazabilidad, que son las que consume el front |
| `cocina_lotes_pasta` | Cada tanda de pasta armada. Es la fuente principal del stock de pastas: lo que hay en camara es la suma de porciones de los lotes con ubicacion='camara_congelado' menos lo consumido. | src/modules/cocina/ProduccionQRPage.tsx:3088 — alta del lote de pasta armada (define la ubicacion inicial en la linea 3115), src/modules/cocina/ProduccionQRPage.tsx:3728 y src/modules/cocina/ProduccionTab.tsx:1369 — RPC porcionar_pasta_lote (migs 029/108): mueve el lote de freezer_produccion a camara_congelado y le carga las porciones reales, src/modules/cocina/components/EditarLoteModal.tsx — edicion manual de un lote | src/modules/cocina/StockTab.tsx:363, src/modules/cocina/ProduccionTab.tsx:425, 441, 504, 524, 907, src/modules/cocina/ProduccionQRPage.tsx:460, 567, 791, 904, 923, 953, src/modules/cocina/PizarronPage.tsx:106, src/modules/cocina/MostradorPage.tsx:292, src/modules/almacen/StockCongeladosTab.tsx:50, src/modules/cocina/components/PlanSemanal.tsx:290, PlanProduccionEditor.tsx:430, ResumenSemanalCard.tsx:299, Vistas v_cocina_stock_pastas, v_cocina_stock_mostrador, v_cocina_lote_pasta_saldo |
| `cocina_lotes_produccion` | Los lotes de todo lo que NO es pasta armada: salsas, postres, pasteleria, panes. El stock de esos rubros sale de aca (lotes con en_stock=true). | src/modules/cocina/DashboardTab.tsx:1205, src/modules/cocina/MostradorPage.tsx:1235 (y updates en 1207/1220), src/modules/cocina/ProduccionQRPage.tsx:4129, 4854, 5146, 5568, src/modules/cocina/components/EditarLoteModal.tsx:89/126 | src/modules/cocina/DashboardTab.tsx:1007, 1192, src/modules/cocina/StockTab.tsx:1266, 1274, 1280, 1312, src/modules/cocina/ProduccionTab.tsx:488, 920, src/modules/cocina/ProduccionQRPage.tsx:487, 3988, 4727, 5073, 5135, 5424, 5551, src/modules/cocina/components/PlanProduccionEditor.tsx:391, ResumenSemanalCard.tsx:187 |
| `cocina_lotes_masa` | Tandas de masa producida, antes de que se convierta en pasta armada. | src/modules/cocina/ProduccionTab.tsx:1505, src/modules/cocina/ProduccionQRPage.tsx:3973, 4344, RPC de mig 172 (cerrar la masa desde la tablet) y mig 173 | src/modules/cocina/ProduccionQRPage.tsx:476, 766, src/modules/cocina/ProduccionTab.tsx:473, 898, src/modules/cocina/components/PlanSemanal.tsx:276 |
| `cocina_lotes_relleno` | Tandas de relleno. Segun la decision del 9-sep el relleno NO lleva stock, pero la tanda igual se anota con su peso. | src/modules/cocina/ProduccionQRPage.tsx:2517, 2574 | src/modules/cocina/ProduccionQRPage.tsx:467, 750, src/modules/cocina/ProduccionTab.tsx:458, 889 |
| `cocina_lotes_pasta_masas` | Tabla puente: cuando un lote de pasta usa varias masas, guarda cuantos kg de cada una. | src/modules/cocina/ProduccionQRPage.tsx:3141 (junto con el alta del lote de pasta) | src/modules/cocina/ProduccionQRPage.tsx:816 |
| `cocina_pizarron_items` | El plan: cuanto HAY QUE hacer y cuanto se hizo. No es mercaderia en stock, es la intencion, pero guarda cantidades y se cruza con los lotes. | src/modules/cocina/components/PlanProduccionEditor.tsx:326, 608, 634, src/modules/cocina/ProduccionQRPage.tsx:2037 | src/modules/cocina/components/PlanSemanal.tsx:260, ResumenSemanalCard.tsx:129, src/modules/cocina/ProduccionQRPage.tsx:716 |
| `productos` | El catalogo de INSUMOS del almacen, y ademas el saldo vivo de cada uno. El saldo esta pisado en la fila, no derivado de los movimientos. | src/modules/compras/ComprasPage.tsx:1640 (recepcion Fudo), 2318 (conteo masivo), 4498 (ajuste puntual), RPC recepcionar_mercaderia (mig 102) — suma, RPC registrar_salida_deposito (mig 106/182) — resta con piso en cero y lee con for update | src/modules/compras/ComprasPage.tsx (varios), src/modules/compras/components/DepositoForm.tsx, src/modules/compras/RecepcionPage.tsx, src/modules/gastos/NuevoGastoForm.tsx |
| `almacen_pedidos` | Pedidos de clientes del almacen de Saavedra. Los entregados se descuentan del stock de congelados. | src/modules/almacen/PedidosTab.tsx:577 (update al editar) y 587 (insert al crear), src/modules/almacen/PedidosTab.tsx:117 — cambio de estado (es lo que decide si descuenta o no) | src/modules/almacen/PedidosTab.tsx:85, 99, src/modules/almacen/CalendarioTab.tsx:64, src/modules/almacen/StockCongeladosTab.tsx:91 — resta los 'entregado' del stock, src/modules/cocina/components/PlanProduccionEditor.tsx:413, ResumenSemanalCard.tsx:245 |
| `recepciones_pendientes` | Lo que entro por el QR de recepcion y todavia no tiene factura cargada. Las cantidades viven adentro de un jsonb, no en columnas. | src/modules/compras/RecepcionPage.tsx:237 via RPC recepcionar_mercaderia, src/modules/compras/ComprasPage.tsx:648 — descartar recepcion, src/modules/gastos/NuevoGastoForm.tsx:1750 — marcarla validada al cargar el gasto | src/modules/compras/ComprasPage.tsx:577, src/modules/gastos/NuevoGastoModal.tsx:823 |
| `ventas_items` | Cada renglon vendido. Es lo que RESTA del mostrador en la cuenta de stock de pastas. | supabase/functions/fudo-importar-ventas/index.ts — el importador que corre cada 15 minutos, src/modules/finanzas/components/UploadFudo.tsx:212, 224 — carga manual de un export, RPC cobrar_venta (mig 189), llamada desde src/modules/caja/useCaja.ts:859 — el POS propio | Vista v_cocina_stock_mostrador (mig 170) — descuenta las ventas posteriores al ultimo conteo, src/modules/cocina/StockTab.tsx:413 via esa vista, src/modules/productos/hooks/usePrecioCobrado.ts:72, useFudoHuerfanos.ts:43 |
| `caja_mesa_lineas` | Lo que se pidio en cada mesa del salon antes de cobrar. Cantidades de platos, no de mercaderia en deposito. | Se escribe desde el flujo de mesas del salon; el hook que las lee es src/modules/salon/useMesas.ts:80. No rastreé el insert linea por linea, asi que no puedo afirmar donde escribe ni si verifica filas. | src/modules/salon/useMesas.ts:80 |
| `cocina_receta_ingredientes / cocina_recetas` | NO son stock: son las recetas. cocina_receta_ingredientes.cantidad es cuanto lleva la receta, y cocina_recetas guarda los rendimientos (rendimiento_kg, rendimiento_porciones, gramos_por_porcion, kg_por_bolsa, g_semolin_por_kg, g_huevo_por_kg). | Modulo Cocina, pantalla de recetas (no la abri en esta pasada) | Todo el costeo y las conversiones de kg a porciones |

</details>

---

## 3. Mapa de ubicaciones reales

Esto es lo que pediste saber, y la respuesta corta es incómoda: **no existe un modelo de**
**ubicaciones. Existen tres palabras, en dos vocabularios, y una tabla enorme sin ninguna.**

### Lo que hay EN LOS DATOS (medido, no leído del código)

| Dónde vive | Valor | Vedia | Saavedra | Desde | Hasta |
|---|---|---:|---:|---|---|
| `cocina_ajustes_stock.ubicacion` | `mostrador` | 81 | **0** | 30-abr | 01-sep |
| `cocina_ajustes_stock.ubicacion` | `camara` | 62 | **0** | 30-abr | 12-jun |
| `cocina_lotes_pasta.ubicacion` | `camara_congelado` | 339 | 69 | 28-abr | 10-sep |
| `cocina_lotes_pasta.ubicacion` | `freezer_produccion` | **0** | **0** | — | — |
| `movimientos_stock` | *(no tiene ubicación)* | 5.295 | 4.720 | 08-abr | 10-sep |

**Son tres valores en total** — `mostrador`, `camara`, `camara_congelado` — sobre 10.015 +
143 + 408 filas.

### Cinco cosas que salen de ahí

**1. 💣 La cámara tiene dos nombres.** Se llama `camara_congelado` en `cocina_lotes_pasta`
y `camara` en `cocina_ajustes_stock`. Es el mismo lugar físico con dos palabras. Es el
mismo patrón de vocabulario que ya nos mordió con `costo`, con el punto y con `unid.`.

**2. `freezer_produccion` está declarado y hoy no tiene ni una fila.** El CHECK de la
migración 009 lo permite y el tipo de TypeScript lo repite en cuatro archivos, pero los
408 lotes están en `camara_congelado`. No está muerto: es un estado de paso, y hoy no hay
ningún lote sin porcionar. Pero nadie que lea el código lo sabría.

**3. Saavedra no tiene una sola fila de ajuste.** Las 143 correcciones de cámara y
mostrador son **todas de Vedia**. O en Saavedra nunca hizo falta corregir, o esa pantalla
allá no se usa. Cualquiera de las dos cosas importa antes de diseñar nada.

**4. Los ajustes de cámara se cortaron el 12-jun.** Los de mostrador siguen hasta
septiembre. Algo cambió a mitad de junio y conviene saber qué.

**5. El almacén de insumos no tiene ubicación, punto.** Una bolsa de harina está "en
Vedia" y nada más. No se sabe si está en el depósito, en la cámara o en la cocina — y son
10.015 movimientos, la mayor parte del sistema.

### Lo que el CÓDIGO cree que existe

| Cómo se representa | Dónde | Valores que el código espera |
|---|---|---|
| columna texto con CHECK escrito en la migracion 009 (check (ubicacion in ('freezer_produccion','camara_congelado'))), default 'camara_congelado' | cocina_lotes_pasta.ubicacion | `freezer_produccion`, `camara_congelado` |
| columna texto con CHECK escrito en la migracion 045 (CHECK (ubicacion IN ('camara','mostrador'))) | cocina_ajustes_stock.ubicacion | `camara`, `mostrador` |
| no existe — la ubicacion esta implicita en el significado de la tabla | cocina_traspasos (no tiene columna de ubicacion) | `camara (origen, implicito)`, `mostrador (destino, implicito)` |
| no existe — se deduce | cocina_merma (no tiene columna de ubicacion) | `camara (lo asume el trigger trg_merma_camara_fifo, mig 050)` |
| no existe — la ubicacion esta en el NOMBRE de la tabla | cocina_cierre_camara (no tiene columna de ubicacion) | `camara (implicito)` |
| columnas de texto, pero describen QUE se cuenta y CUANDO, no donde | cocina_cierre_dia.tipo / .turno | `no pude listar los valores de tipo desde el codigo sin abrir MostradorPage.tsx entero; el CHECK, si existe, esta en la migracion 042 y no en el esquema aplicado` |
| no existe — solo el local | movimientos_stock y productos (almacen de insumos) | `vedia`, `saavedra` |
| no existe — solo el local | cocina_lotes_produccion, cocina_lotes_masa, cocina_lotes_relleno | `vedia`, `saavedra` |
| tabla aparte (la unica ubicacion modelada como tabla en todo el sistema) | caja_mesas.sala_id → caja_salas | `los nombres de sala son datos, no constantes del codigo: caja_salas tiene local, nombre, orden, activo` |
| columnas booleanas de PERMISO, no de ubicacion | perfiles.puede_ver_almacen / puede_ver_salon | `true`, `false` |
| booleano de CANAL de venta, no de ubicacion | cocina_productos.disponible_almacen | `true`, `false` |
| — | LO QUE NO PUDE VERIFICAR | `freezer_produccion`, `camara_congelado`, `camara`, `mostrador`, `vedia`, `saavedra` |

<details><summary><b>Las notas del relevamiento, una por una</b></summary>

**cocina_lotes_pasta.ubicacion** — Es LA ubicacion principal del sistema: define si un lote ya cuenta como stock disponible o todavia esta esperando que lo porcionen. El tipo de TypeScript esta escrito literal en cuatro lugares (StockTab.tsx:37, ProduccionTab.tsx:142, PlanSemanal.tsx:49 y :217) como "'freezer_produccion' | 'camara_congelado'", asi que si alguien agrega un valor nuevo en la base, el front no lo va a reconocer. Quien escribe: ProduccionQRPage.tsx:3115 al dar de alta el lote (pasta sin relleno va directo a 'camara_congelado', con relleno arranca en 'freezer_produccion'), y la RPC porcionar_pasta_lote (migs 029/108) que lo mueve de uno al otro. Ojo: el esquema aplicado (supabase/esquema-aplicado.sql) NO vuelca los CHECK, solo las claves foraneas — asi que el CHECK lo veo escrito en la migracion, pero desde el archivo no puedo confirmar que este vivo en produccion.

**cocina_ajustes_stock.ubicacion** — 💣 EL PROBLEMA MAS GRANDE DEL MAPA DE UBICACIONES: son DOS VOCABULARIOS DISTINTOS PARA EL MISMO LUGAR FISICO. La camara se llama 'camara_congelado' en cocina_lotes_pasta y 'camara' en cocina_ajustes_stock. Y 'mostrador' existe en ajustes pero NO existe en lotes_pasta. Cada vista tiene que traducir a mano: mira las migs 046, 108, 125, 161, 163, 164 — todas repiten el par lp.ubicacion='camara_congelado' + a.ubicacion='camara'. Un valor mal escrito en cualquiera de las dos puntas hace que el numero de la pantalla de mal sin tirar ningun error. El tipo de TypeScript aparece literal en StockTab.tsx:314, :432 y :1035 como "'camara' | 'mostrador'".

**cocina_traspasos (no tiene columna de ubicacion)** — Un traspaso ES 'de la camara al mostrador'. Origen y destino no se guardan en ningun lado: estan cableados en la logica de las vistas y de los triggers. Por eso no se puede anotar un movimiento a otro lugar (por ejemplo camara → freezer) sin cambiar codigo. Y en Saavedra la tabla directamente no se usa: MostradorPage.tsx:278 explica que en ese local no hay etapa intermedia y que las migs 125/161 usan el cierre de turno como baseline en su lugar.

**cocina_merma (no tiene columna de ubicacion)** — La merma resta en las dos ubicaciones a la vez (lo dice el comentario en StockTab.tsx:228), pero el FIFO la imputa a lotes de camara. El unico rastro de DONDE se perdio es el texto libre de motivo: PizarronPanelPasta.tsx:169 escribe 'Perdido en camara' a mano, TraspasosTab.tsx usa un motivo elegido por el usuario y el QR usa texto libre. Eso NO es un dato consultable, es prosa.

**cocina_cierre_camara (no tiene columna de ubicacion)** — Es el conteo de camara. Su gemela para el mostrador es cocina_cierre_dia. Dos tablas separadas para lo que conceptualmente es 'conteo fisico en tal lugar'.

**cocina_cierre_dia.tipo / .turno** — En la practica esta tabla ES el conteo de mostrador (MostradorPage.tsx es la unica que escribe), pero eso no esta declarado en ninguna columna: se deduce de que pantalla la escribe. En Saavedra ademas cumple doble funcion, porque las migs 125 y 161 la usan como baseline de CAMARA para ese local.

**movimientos_stock y productos (almacen de insumos)** — El almacen de insumos NO tiene concepto de ubicacion. Una bolsa de harina esta 'en Vedia' y nada mas: no se sabe si esta en el deposito, en la camara o en la cocina. El QR se llama /deposito y la RPC registrar_salida_deposito, pero 'deposito' ahi es el nombre del flujo, no un valor guardado en ninguna columna. Si manana se quiere separar deposito de camara para insumos, hoy no hay donde anotarlo.

**cocina_lotes_produccion, cocina_lotes_masa, cocina_lotes_relleno** — Salsas, postres, panes, masa y relleno no tienen ubicacion. La unica marca parecida es cocina_lotes_produccion.en_stock (booleano: cuenta o no cuenta), que es un interruptor, no un lugar. Y cocina_lotes_masa.destino_sobrante es texto libre sobre a que se destina el sobrante (ProduccionTab.tsx:636 muestra 'fideos' cuando esta vacio), no donde queda guardado.

**caja_mesas.sala_id → caja_salas** — Es ubicacion de MESAS del salon (con coordenadas pos_x, pos_y para dibujar el plano), no de mercaderia. La menciono porque si buscas 'salon' aparece esto, y porque muestra que cuando el proyecto quiso modelar lugares en serio, uso una tabla — no un texto.

**perfiles.puede_ver_almacen / puede_ver_salon** — Aparecen si buscas 'almacen' o 'salon' en el esquema, pero son casillas de permiso por rol (la decision del 10-sep), no dicen donde esta nada.

**cocina_productos.disponible_almacen** — Dice si el producto se ofrece en el almacen de Saavedra. Es canal, no lugar.

**LO QUE NO PUDE VERIFICAR** — Esta lista de arriba es la de valores que el CODIGO escribe o espera, sacada de las migraciones (009, 045, 046, 050, 108, 125, 156, 161, 163, 164), de los tipos de TypeScript y de los literales en los .tsx. QUE VALORES HAY REALMENTE EN LOS DATOS NO LO SE Y NO LO PUEDO SABER DESDE ACA: no tengo acceso a la base y la foto del esquema (supabase/esquema-aplicado.sql) no trae ni los CHECK ni las filas. Si en la base hay un lote con ubicacion='freezer' o un ajuste con ubicacion='deposito' escrito a mano por SQL, ninguna de las pantallas lo va a mostrar bien y desde el codigo no se nota. Eso lo tiene que medir alguien con las tools de Supabase MCP, con un select distinct sobre cocina_lotes_pasta.ubicacion y cocina_ajustes_stock.ubicacion. Tampoco pude confirmar que los dos CHECK esten realmente aplicados en produccion: estan escritos en las migraciones 009 y 045, pero el volcado del esquema aplicado solo incluye claves foraneas.

</details>

---

## 4. Los cinco bugs de stock, y si el ledger los resuelve

**El ledger resuelve entero 1 de 5, a medias 3, y 1 no lo toca.**

| | Bug | ¿El ledger lo resuelve? |
|:-:|---|---|
| 🟠 | 1 · El stock de congelados de Saavedra decía 2.715 porciones y en la cámara había 272 | **PARCIAL** |
| 🟠 | 2 · La merma del mostrador se calcula y no se registra: dice "faltan 12" y no queda fila en cocina_merma | **PARCIAL** |
| 🟠 | 3 · "Lo esperado en el mostrador" se calcula distinto en la vista SQL y en la tablet | **PARCIAL** |
| ❌ | 4 · "Vendido" significa dos momentos distintos: la comanda a la cocina, o el cobro | **NO** |
| ✅ | 5 · Recibir mercadería tiene dos caminos que se pisan | **SI** |

### 🟠 1 · El stock de congelados de Saavedra decía 2.715 porciones y en la cámara había 272

**El código que lo causa:** C:\dev\rodziny-erp\src\modules\almacen\StockCongeladosTab.tsx:163 — `item.stock = item.producido - item.traspasado - item.merma - item.entregadoPedidos;`

Y las cuatro consultas que lo alimentan, todas SIN filtro de fecha y sin arrancar de ningún conteo físico:
· línea 49-54: `.from('cocina_lotes_pasta').select('producto_id, porciones, ...').eq('local','saavedra')` → TODA la producción desde siempre
· línea 64-67: `.from('cocina_traspasos')...eq('local','saavedra')` → en Saavedra esta tabla no tiene UNA SOLA FILA en cinco meses (así lo dice el comentario de MostradorPage.tsx:273-285)
· línea 76-80: `cocina_merma`
· línea 90-94: `almacen_pedidos` estado='entregado'

**Por qué pasa.** La resta no tiene el término más grande de todos: LO QUE SE VENDIÓ. El número suma cada lote que se produjo desde abril y le resta tres cosas que en Saavedra casi no existen (traspasos = cero filas, merma = casi nada, pedidos de almacén = poco). Encima no arranca de ningún conteo físico: no hay una línea que diga "el 8 de septiembre contamos 272, seguí desde ahí". Es una cuenta que solo puede subir. La diferencia de 2.443 porciones no es un error de cálculo, es cinco meses de ventas que la fórmula nunca vio.

Dato honesto: hoy esto no está arreglado, está ROTULADO. Las líneas 189-195 son un cartel rojo que dice "este stock está mal contado y no lo uses". La cuenta sigue igual abajo.

**¿El ledger lo resuelve? PARCIAL.** SÍ en lo que el ledger hace bien: con una tabla de movimientos, la venta sería un renglón `venta` con signo negativo y el número dejaría de ser una acumulación ciega. Y como cada renglón dice de dónde vino, cuando el número no cuadre se puede abrir y ver qué lo movió.

PERO NO ALCANZA, y hay dos agujeros grandes:

1) HOY NADIE ESCRIBE LA VENTA COMO MOVIMIENTO DE STOCK. Las ventas entran a `ventas_items` desde el importador de Fudo (cada 15 minutos) y desde el POS propio. Ninguno de los dos escribe una fila de stock. Si armás el ledger y no le enganchás esos dos orígenes, la tabla nueva va a estar igual de incompleta que la cuenta vieja, con la diferencia de que ahora parece confiable. Ese enganche es trabajo aparte y es el trabajo grande.

2) EL LEDGER SOLO NO LLEGA A 272. Ese 272 salió de que alguien fue y contó. Un ledger perfecto sin conteos físicos sigue derivando: la pasta que se rompió, la que se comió alguien, la que se regaló. Hace falta que el conteo de cámara (cocina_cierre_dia / el QR de conteo) entre al ledger como renglón `ajuste` que RE-ARRANCA la cuenta, igual que hoy hace v_cocina_stock_pastas. Sin eso el ledger te dice con precisión de dónde viene un número equivocado.

3) Y esta pantalla tiene que DEJAR de hacer su propia resta y leer el ledger. Si no, terminás con ledger y con la línea 163 conviviendo, que es exactamente el bug 3 con otro nombre.

### 🟠 2 · La merma del mostrador se calcula y no se registra: dice "faltan 12" y no queda fila en cocina_merma

**El código que lo causa:** DÓNDE SE CALCULA Y MUERE — C:\dev\rodziny-erp\src\modules\cocina\MostradorPage.tsx:789-792:
`const esperado = Math.max(0, tope - vendido);`
`const dif = real - esperado;`
y líneas 819-821 `: dif < 0 ? 'faltan ' + -dif` y 945-950 `Faltan {-dif}. Puede ser merma, o una venta que todavía no entró al sistema.` — es texto en pantalla, nada más.

LO QUE SÍ SE GUARDA — MostradorPage.tsx:646-660: el payload a `cocina_cierre_dia` lleva fecha, local, producto_id, tipo, turno, cantidad_real, unidad, inicial, entrega, vendido, responsable. NO lleva merma. Y en todo el archivo (1.382 líneas) no hay ni un `from('cocina_merma')`.

EL TRIGGER ESTÁ MUERTO, Y SE PUEDE FECHAR:
· supabase\migrations\026_cocina_conteos_mostrador.sql:78-80 — `CREATE TRIGGER trg_merma_conteo_mostrador AFTER INSERT ON cocina_conteos_mostrador`
· 027_mostrador_entrega_deposito.sql:30 — le agrega la entrega a la fórmula
· 💀 042_cocina_cierre_dia.sql:7 — `DROP TABLE IF EXISTS public.cocina_conteos_mostrador;` — al caer la tabla cae el trigger colgado de ella
· 💀 179_limpieza_vistas_y_tablas_sin_uso.sql:30 — `drop function if exists public.registrar_merma_conteo_mostrador() cascade;` con el comentario "Es un cascote"
· Y ninguna migración crea un trigger sobre `cocina_cierre_dia`, que es la tabla que reemplazó a la vieja. Verificado con grep sobre los 207 .sql.

**Por qué pasa.** La cuenta de la merma vivía en un trigger de la base, colgado de la tabla `cocina_conteos_mostrador`. En la migración 042 esa tabla se reemplazó por `cocina_cierre_dia` ("verificadas vacías", dice el comentario) y el trigger se fue con ella. La tabla nueva nació sin reemplazo. Nadie lo notó porque la pantalla siguió mostrando el faltante: el número se calcula en el navegador, en el render, y no depende de que la base lo guarde. Se ve bien y no queda nada.

Consecuencia: cada faltante del mostrador desde la migración 042 se mostró una vez en una tablet y se perdió al recargar la página. No hay historial de merma de mostrador.

**¿El ledger lo resuelve? PARCIAL.** El ledger te da EL LUGAR donde poner el renglón, pero no hace que alguien lo escriba. Hoy ese 12 existe solo en la memoria del navegador; con ledger seguiría existiendo solo ahí hasta que alguien programe el insert. Es un bug de "el dato no se registra nunca", no de "el número se pisó", y esos el ledger no los toca.

Y hay algo más incómodo que hay que decidir ANTES de escribir nada: ESE FALTANTE NO ES MERMA. La propia pantalla lo admite en la línea 947: "Puede ser merma, o una venta que todavía no entró al sistema". También puede ser una producción que nadie cargó, o un dedazo al contar. Si el cierre escribe automáticamente un renglón `merma` por cada diferencia, estás inventando datos con cara de oficiales — y como el ledger es inmutable, esa invención queda para siempre y hay que corregirla con un contra-asiento.

QUÉ HARÍA FALTA ADEMÁS DEL LEDGER:
1) Una decisión de Lucas sobre qué ES la diferencia. Mi lectura del código es que necesitás un tipo aparte (`diferencia_de_conteo` o el `ajuste` de la lista) distinto de `merma`, y que `merma` se reserve para cuando la persona dice explícitamente "esto se tiró".
2) Que el guardado del cierre escriba ese renglón — código nuevo en MostradorPage.tsx, no existe.
3) Contar las filas. Y acá hay algo que encontré de paso y que conviene mirar: el borrado previo del cierre (MostradorPage.tsx:637-644, `.delete().eq(...)`) y el insert (línea 660) NO cuentan filas afectadas. Peor: esa pantalla corre como `anon` (línea 10, `supabaseAnon`) y en las migraciones tal como están escritas `cocina_cierre_dia` le da a anon SELECT e INSERT pero NINGUNA policy de DELETE (042_cocina_cierre_dia.sql:46-58). Si eso es también lo aplicado, el delete borra 0 filas en silencio y el insert después choca contra el índice único `ux_cocina_cierre_dia_con_turno`. NO PUDE VERIFICARLO: la foto `supabase\esquema-aplicado.sql` no trae las policies de RLS, y la regla del proyecto es que eso se mide entrando como anon, no leyendo archivos. Lo dejo marcado para que alguien lo pruebe contra la base.

### 🟠 3 · "Lo esperado en el mostrador" se calcula distinto en la vista SQL y en la tablet

**El código que lo causa:** LA VISTA — supabase\migrations\170_cuenta_unica_del_mostrador.sql:79-80 (idéntica en la foto de lo aplicado, supabase\esquema-aplicado.sql:1526):
`greatest(0, coalesce(b.conteo_base,0) + coalesce(tr.n,0) - coalesce(ve.n,0) - coalesce(me.n,0) + coalesce(aj.n,0))`

LA TABLET — C:\dev\rodziny-erp\src\modules\cocina\MostradorPage.tsx:788-789:
`const tope = inicial + entrega;`
`const esperado = Math.max(0, tope - vendido);`

**Por qué pasa.** Son cuatro diferencias, no una:

1) MERMA. La vista resta `merma_post` (líneas 100-104 de la 170, lee cocina_merma). La tablet NO la resta: en su fórmula la merma no aparece por ningún lado.

2) AJUSTES. La vista suma `ajustes_post` de `cocina_ajustes_stock` con ubicacion='mostrador' (líneas 105-108). La tablet los ignora.

3) LO QUE ENTRÓ. La vista SIEMPRE usa `cocina_traspasos` (líneas 86-90). La tablet, en Saavedra, usa la PRODUCCIÓN (`cocina_lotes_pasta`) en vez de los traspasos — MostradorPage.tsx:466-480, con un comentario largo en 273-285 explicando por qué: Saavedra no registra traspasos, no tiene una sola fila en cinco meses. O sea: para Saavedra el `traspasos_post` de la vista es SIEMPRE CERO y el `entrega` de la tablet es la producción real. Para el mismo producto, la vista y la tablet no pueden coincidir nunca.

4) VENDIDO. Fuentes distintas — es el bug 4.

Y las dos cuentas están en pantalla al mismo tiempo, para la misma gente: la vista alimenta Cocina→Stock (StockTab.tsx:413) y el Dashboard (DashboardTab.tsx:962); la fórmula de la tablet alimenta /mostrador. La ironía es que la migración 170 se escribió justo para terminar con esto — su comentario de apertura dice "hay TRES cuentas distintas del mostrador conviviendo" — pero la tablet nunca se pasó a la vista, y no puede: la línea 122 de la 170 le REVOCA la lectura a anon, y /mostrador entra como anon.

**¿El ledger lo resuelve? PARCIAL.** SÍ resuelve las diferencias 1, 2 y 3: merma, ajustes y entradas son todas renglones del ledger, y si las dos pantallas suman los mismos renglones dejan de discrepar por omisión. Hoy discrepan porque cada una eligió qué tablas mirar; con una sola tabla esa elección desaparece.

PERO NO RESUELVE EL FONDO, Y ESTO ES IMPORTANTE: el ledger es una tabla de DATOS. "Esperado" es una DEFINICIÓN, y dos pantallas pueden escribir dos fórmulas distintas sobre las mismas filas con la misma facilidad con que hoy escriben dos fórmulas sobre tablas distintas. Nada en un ledger impide que la tablet siga haciendo su resta a mano en el render (línea 789) mientras StockTab llama a otra cosa.

QUÉ HARÍA FALTA ADEMÁS:
1) UNA función o vista que conteste "cuánto debería haber en el mostrador ahora", y que la tablet la LEA en vez de calcular. Eso implica resolver el permiso: hoy la vista está revocada para anon a propósito (170:116-122, porque expondría cuánto se vende de cada producto) y /mostrador es anon. Se arregla como se arregló la 195: una función SECURITY DEFINER que devuelva solo id y cantidad, sin plata.
2) Decidir Saavedra. Sin traspasos, "mostrador" y "cámara" son el MISMO freezer. El ledger pide una ubicación de origen y una de destino en cada fila: si nadie decide en qué ubicación cae la producción de Saavedra, la ambigüedad de hoy se muda al ledger con nombres nuevos. Esa es una decisión de Lucas, no del código.

### ❌ 4 · "Vendido" significa dos momentos distintos: la comanda a la cocina, o el cobro

**El código que lo causa:** DEFINICIÓN A — SALIÓ DE LA CÁMARA (hora de la comanda). supabase\migrations\195_lo_que_sale_de_la_camara.sql:
· línea 107: `and coalesce(t.tipo_venta, '') <> 'salon'` — saca los tickets de salón
· líneas 127-132: `select l.receta_id, ... from caja_mesa_lineas l join caja_mesa_envios e on e.id = l.envio_id where ... e.enviado_en >= p_desde` — los cuenta a la hora del ENVÍO

DEFINICIÓN B — SE COBRÓ (hora del ticket). supabase\migrations\184_cocina_lee_las_ventas_de_nuestra_base.sql:56-70: `from ventas_items i join ventas_tickets t on t.id = i.ticket_id ... and ((t.fecha + t.hora) at time zone ...) >= p_desde` — sin excluir salón, y agrupando POR NOMBRE.
Y la vista del bug 3, migración 170:91-99, hace exactamente lo mismo: hora del ticket, salón incluido.

EL REPARTIDOR — C:\dev\rodziny-erp\src\modules\cocina\lib\ventasCocina.ts sirve LAS DOS desde el mismo archivo:
· línea 141: `client.rpc('cocina_salidas_de_camara', ...)` → definición A
· línea 65: `client.rpc('cocina_ventas_por_producto', ...)` → definición B

**Por qué pasa.** CORRIJO EL PLANTEO, porque leyendo el código no es así: no es "la base contra la tablet". La tablet /mostrador usa la definición BUENA — MostradorPage.tsx:425 llama a `salidasDeCamara`, que es la de la hora de la comanda. Las DOS definiciones viven en la base, son dos funciones distintas, y el reparto está mezclado dentro del mismo módulo Cocina:

· hora de la COMANDA: /mostrador (MostradorPage.tsx:425), PlanProduccionEditor.tsx:348, ResumenSemanalCard.tsx:278, StockTab.tsx:492 y 1337 — todos vía `salidasPorDias`
· hora del COBRO: la vista v_cocina_stock_mostrador que leen StockTab.tsx:413 y DashboardTab.tsx:962, más DashboardTab.tsx:1042 y 1158 vía `ventasPorDias`

Mirá StockTab: usa las dos, en la misma pantalla. Y DashboardTab también.

Por qué quedó así está escrito y es una decisión defendible, no un descuido: la 195 dice en las líneas 63-67 que no toca `cocina_ventas_por_producto` porque la usan cuatro pantallas de estimación de demanda y "tocar las cinco de una es el cambio con más chances de romper lo que hoy anda". Se tapó el agujero donde dolía (el conteo físico) y se dejó anotado el resto. El problema es que quedó a mitad de camino y nadie escribió la segunda mitad.

La diferencia importa porque son 45 a 90 minutos: la comanda sale 21:00, la mesa se cobra 22:30. Un conteo a las 21:30 con la definición del cobro marca faltante en todo.

**¿El ledger lo resuelve? NO.** Este es el que quiero que quede clarísimo: EL LEDGER NO ARREGLA ESTO, y en un punto lo empeora.

POR QUÉ NO. Un renglón de ledger tiene UN timestamp. Eso te obliga a elegir un momento, lo cual está bien y es más de lo que hay hoy. Pero elegir cuál es una decisión de negocio que el ledger no toma. Y las dos preguntas son legítimas y distintas: el stock quiere saber cuándo salió la pasta del freezer; la plata quiere saber cuándo se cobró. Si el ledger se escribe a la hora de la comanda —que es lo correcto para stock— entonces las cuatro pantallas de estimación de demanda que hoy usan la hora del cobro tienen que aceptar cambiar de definición, o vas a seguir con dos números. Nadie decidió eso todavía.

DÓNDE EMPEORA. Hoy el doble conteo es un error de lectura que se corrige cambiando una consulta. Con ledger pasa a ser un error de ESCRITURA sobre filas inmutables. El riesgo está descripto en la propia migración 195, líneas 44-52: el mozo manda la comanda a las 21:00 y a las 22:30 nace el ticket por el mismo plato. Si el POS escribe un renglón al enviar la comanda Y el importador de Fudo escribe otro cuando entra el ticket, el ledger cuenta el plato dos veces y esas filas no se pisan: se SUMAN. Un stock inflado y permanente, que hay que corregir con contra-asientos.

QUÉ HARÍA FALTA ADEMÁS DEL LEDGER:
1) Una decisión escrita de qué momento es el bueno para stock (mi lectura del código dice: la comanda) y las cuatro pantallas de demanda migradas o declaradas excepción a conciencia.
2) Una clave de deduplicación en el ledger (ticket_id + renglón, o envio_id + renglón) con índice único, para que el mismo plato no pueda entrar dos veces por dos caminos. Sin eso el ledger no es más seguro que hoy, es más difícil de arreglar.
3) La escalera de enganche por nombre de la 195 (líneas 145-169) sigue existiendo: hoy hay renglones que solo tienen nombre y no id de producto. Un ledger EXIGE un producto_id en cada fila. Si el nombre engancha con el producto equivocado, esa fila queda mal para siempre. Hace falta resolver el enganche antes de empezar a escribir filas inmutables, no después.

### ✅ 5 · Recibir mercadería tiene dos caminos que se pisan

**El código que lo causa:** CAMINO BUENO (QR de recepción) — supabase\migrations\102_recepcionar_mercaderia_rpc.sql, una sola transacción:
· líneas 43-45: escribe `recepciones_pendientes`
· líneas 59-63: `select ... from productos where id = ... for update` — BLOQUEA la fila
· líneas 69-72: `update productos set stock_actual = v_prod.stock_actual + v_cantidad` — sobre el valor que acaba de leer bloqueado
· líneas 74-75: `insert into movimientos_stock`
Lo llama C:\dev\rodziny-erp\src\modules\compras\RecepcionPage.tsx:237-244 (y sí chequea el error, línea 244).

CAMINO QUE LO PISA — C:\dev\rodziny-erp\src\modules\compras\ComprasPage.tsx:1602-1661, función `confirmarRecepcion`:
· 1628-1637: `await supabase.from('movimientos_stock').insert({...})` — el resultado se TIRA. Ni `error`, ni `.select()`, ni conteo de filas.
· 1640-1646: `await supabase.from('productos').update({ stock_actual: prod.stock_actual + totalCantidad, ... }).eq('id', prod.id)` — el resultado también se tira.
· 1649-1651: `setRecResultado(\`${confirmados.length} items recepcionados...\`)` — el cartel de éxito se muestra pase lo que pase.
· Y nunca escribe `recepciones_pendientes`.

**Por qué pasa.** Tres problemas apilados en el camino B:

1) LECTURA VIEJA. `prod.stock_actual` (línea 1643) no sale de la base en ese momento: sale del snapshot de react-query que se cargó al abrir la pantalla. Es leer-modificar-escribir sobre un número que puede tener horas. Si mientras tanto entró una recepción por el QR, o alguien ajustó el stock en otra pestaña, este update PISA ese valor con el viejo + lo nuevo. La plata que entró en el medio desaparece. La RPC no tiene este problema porque hace `for update` y lee la fila fresca y bloqueada.

2) NADIE CUENTA LAS FILAS. Ni el insert ni el update miran el resultado. Es exactamente la regla del proyecto: un UPDATE que la RLS bloquea devuelve 0 filas y ningún error. La pantalla escribe "12 items recepcionados" con la misma seguridad si movió el stock que si no movió nada.

3) NO HAY TRANSACCIÓN. El loop de la línea 1626 hace dos llamadas separadas por producto. Si la segunda falla, el movimiento ya quedó anotado y el stock no se movió: el papel dice que entró y el número dice que no. El `catch` de la 1656 no revierte nada.

Y el rastro documental queda partido: el mismo remito cargado por el QR deja fila en `recepciones_pendientes` (para que Martín valide los precios) y cargado por Compras no deja ninguna.

Por qué nadie lo vio: la RPC se escribió en junio 2026 porque anon había perdido el UPDATE sobre productos y las recepciones del QR morían en silencio (lo cuenta el encabezado de la 102). Se arregló el camino de anon y el camino del administrador quedó como estaba — porque logueado con permisos el UPDATE sí funciona, así que no falla nunca de forma visible. Solo pisa.

**¿El ledger lo resuelve? SI.** Este es el caso de manual, y es el más fuerte de los cinco a favor del ledger.

EL LEDGER MATA LA CAUSA RAÍZ. El problema es `stock_actual`: una columna que se lee, se le suma algo en el navegador y se vuelve a escribir. Si el stock deja de ser una columna y pasa a ser la suma de los renglones, no hay nada que pisar. Los dos caminos se vuelven "insertá una fila de tipo `recepcion`", y dos recepciones simultáneas son dos filas que se suman, no dos updates donde gana el último. Además queda a la vista: si algo entró dos veces, se ven las dos filas con su hora y su documento, en vez de un número que quedó raro y nadie sabe por qué.

AHORA LO QUE NO ARREGLA, Y HAY QUE DECIRLO:

1) DOS CAMINOS SIGUEN SIENDO DOS CAMINOS. El ledger unifica cómo se guarda el stock, no unifica el flujo. Uno va a seguir escribiendo `recepciones_pendientes` y el otro no, así que Martín va a seguir sin ver la mitad de los remitos. El campo `documento` del ledger hace VISIBLE el agujero (filas de recepción sin documento asociado), pero no lo tapa. Eso se tapa haciendo que ComprasPage llame a la misma RPC que el QR, que es una línea de código y una decisión, no una tabla nueva.

2) LA REGLA DE CONTAR FILAS SIGUE VIGENTE, IGUAL. Un INSERT que la RLS bloquea devuelve 0 filas y ningún error, exactamente como el UPDATE. La línea 1628 hoy ni siquiera lee `error`. Si mañana esa línea inserta en el ledger con el mismo descuido, va a seguir diciendo "recepcionados" sin haber escrito nada. Un ledger sin chequear que el insert entró es el mismo silencio en una tabla nueva y más grande.

3) EL MATCHING SIGUE SIENDO POR PARECIDO DE TEXTO. ComprasPage.tsx:1562 usa `similitud(d.descripcion, p.nombre)` y las líneas 1571-1572 aceptan el match desde 0.4 y lo AUTO-CONFIRMAN desde 0.6. Eso puede pegarle la recepción al producto equivocado. Con stock en columna se corrige editando el número; con ledger inmutable hay que emitir un contra-asiento, que es más correcto pero también más trabajo. El ledger no valida a qué producto pertenece lo que llegó.

---

## 5. ¿Se puede reconstruir el histórico?

### La respuesta corta: **no. El ledger tiene que arrancar de un conteo físico.**

No es una opinión, es una medición. Comparé `productos.stock_actual` contra la suma de
todas las entradas menos las salidas de `movimientos_stock`, producto por producto:

| | |
|---|---:|
| Productos con movimientos | 429 |
| **Cuadran** | **93 (21,7 %)** |
| **No cuadran** | **336 (78,3 %)** |
| Desvío promedio | 448 unidades |
| Desvío máximo | 66.409 unidades |

**Si el saldo guardado y la suma de los movimientos discrepan en 4 de cada 5 productos,**
**los movimientos no son un registro completo de lo que pasó.** Reconstruir el histórico
sumándolos daría un número tan malo como el actual, con la diferencia de que parecería
confiable.

### Por qué no cuadran

Hay al menos tres causas, y las tres están medidas o leídas en el código:

1. **Falta el saldo inicial.** `movimientos_stock` arranca el 8-abr-2026 y los productos
   ya tenían stock antes. Nadie cargó una fila de apertura.
2. **Hay escrituras que no dejan movimiento.** El 91 % de las escrituras no verifica nada,
   y la recepción tiene dos caminos (uno pisa `stock_actual` desde el navegador). En 54 de
   429 productos la fila se tocó *después* de su último movimiento.
3. **El piso en cero se come el descuadre sin registrarlo.** Cuando una salida dejaría el
   stock negativo, se guarda 0 y la diferencia desaparece.

### Lo que sí se puede rescatar

| Qué | Desde cuándo | Qué tan confiable |
|---|---|---|
| Conteos físicos del mostrador (`cocina_cierre_dia`) | 30-abr-2026 · 4.987 filas | Alta: es gente contando |
| Conteos físicos de cámara (`cocina_cierre_camara`) | 12-jun-2026 · 136 filas | Alta |
| Inventarios físicos del almacén (`movimientos_stock`) | 20-abr-2026 · 1.875 filas | Alta, pero guarda el **delta**, no el valor contado |
| Producción de pasta (`cocina_lotes_pasta`) | 28-abr-2026 · 408 lotes | Alta para el *cuánto*; nula para el *de qué salió* (5 %) |
| Traspasos | 28-abr-2026 · 525 filas | Media: **402 porciones no se imputaron a ningún lote** |
| Merma | 06-jun-2026 · 38 filas | Baja: existe el registro, pero **cero** imputaciones a lote |

### La fecha

**El último conteo físico de almacén es del 7-sep-2026** (392 de 429 productos tienen
algún conteo). El de cámara más reciente es del **8-sep-2026**.

> **Mi recomendación, para que la decida Lucas:** el ledger arranca con un conteo físico
> nuevo, hecho el día que se prenda, cargado como filas de apertura. Lo anterior se
> conserva como está —sin migrar— y se consulta aparte cuando haga falta mirar para atrás.
> Intentar reconstruir cinco meses sobre datos que no cuadran en el 78 % de los casos
> costaría semanas y daría un número que nadie va a poder defender.

---

## Lo que este documento no cubre

- **Permisos y RLS.** No sé quién puede escribir qué. Y eso importa mucho acá, porque el
  91 % de las escrituras no comprueba si la escribió.
- **Si los CHECK de ubicación están aplicados.** Salen de las migraciones; la foto del
  esquema no exporta CHECKs.
- **Las escrituras que no encontré.** El relevamiento buscó por nombre de tabla y por
  patrones. Una escritura hecha por un camino raro puede haber quedado afuera.
