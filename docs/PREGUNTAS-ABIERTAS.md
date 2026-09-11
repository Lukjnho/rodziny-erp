# Las 13 preguntas abiertas, agrupadas por quién las puede contestar

**10-sep-2026.** Quedaron después de que se decidiera lo de la venta (pregunta 1, cerrada).

La división es por **qué hace falta para contestar**, no por importancia:

- **Grupo A** — se contestan mirando el código y los datos. **No hace falta ir al local.**
  Varias ya tienen respuesta abajo; las demás son decisiones de modelo.
- **Grupo B** — hacen falta los ojos de Lucas: cómo se trabaja de verdad, qué hay en la
  cámara, qué pasó en junio. **Ningún dato del sistema las contesta.**

---

## Grupo A — se pueden decidir sin pisar el local

### A1 · ¿Cómo se representa una transformación? ✅ *respondida*

Entidad que agrupa N consumos + N producciones, atómica, una sola RPC. Está desarrollado en
`docs/LEDGER-PREVIO.md` §2.1. **Ya decidido.**

### A2 · ¿"Conteo" es un tipo propio? ✅ *respondida*

Sí. Declara un valor absoluto y el sistema calcula la diferencia. La fila guarda **las dos
cosas** — el valor declarado y el delta— para que la suma siga funcionando y el declarado
quede para auditar. `docs/LEDGER-PREVIO.md` §2.2. **Ya decidido.**

### A3 · ¿El ledger arranca de un conteo físico?

**Mi recomendación: sí, y lo viejo se conserva sin migrar.**

El dato duro: `productos.stock_actual` y la suma de `movimientos_stock` **no coinciden en
336 de 429 productos (78 %)**, con un desvío promedio de 448 unidades y máximo de 66.409.
Reconstruir cinco meses sobre eso costaría semanas y daría un número que nadie va a poder
defender — con el agravante de que *parecería* confiable.

Con `conteo` como tipo, el arranque no necesita nada especial: es la primera fila.

**Es una decisión de proyecto, no de negocio. Se puede cerrar sin consultar a nadie.**

### A4 · ¿Se unifica el vocabulario de ubicaciones?

Hoy la cámara se llama `camara_congelado` en `cocina_lotes_pasta` y `camara` en
`cocina_ajustes_stock`. Es el mismo lugar físico con dos palabras.

**Recomendación: sí, antes del paso 5.** Es barato ahora (3 valores, 551 filas) y carísimo
después. Es el mismo patrón que ya nos costó caro con `costo`, con el punto decimal y con
`unid.`.

### A5 · ¿El campo "quién" pasa a ser un usuario de verdad?

**Recomendación: sí, y no es opcional.** `registrado_por` tiene hoy **152 valores distintos
para unas 20 personas**: conviven "Martin" y "martin", "Jere y Martin" y "Martin y Jere",
356 vacíos y **311 UUID crudos**. Como está, no sirve para responder "quién movió esto".

⚠️ **Pero hay un detalle que sí toca al negocio:** las tablets de producción entran **sin
login**. Si el campo pasa a ser un usuario obligatorio, hay que decidir qué se guarda
cuando carga alguien desde el QR. Se cruza con la decisión de que cada persona tiene un PIN
propio (los últimos 4 del DNI). **Esa parte hay que hablarla.**

### A6 · ¿Existe un tipo "Otro"?

**Recomendación: no crearlo.** Hoy hay 14 filas con motivo literal `Otro`. Con `ajuste` +
motivo obligatorio en texto alcanza. Un tipo "otro" se convierte siempre en el tacho de lo
que nadie quiso clasificar, y en dos años es el 20 % de la tabla.

### A7 · Las 25 duplicaciones SQL/frontend que no verifiqué a mano

Siguen con el veredicto del relevamiento automático. **Verificarlas es trabajo mío**, no una
decisión: decime si querés que lo haga y en qué orden.

---

## Grupo B — hacen falta los ojos de Lucas

### B1 · 🔴 ¿El faltante del mostrador es merma?

**La más importante de este grupo, porque bloquea el paso 4 del ledger.**

Cuando el turno cierra con 45 esperadas y 33 contadas, la tablet dice "faltan 12". Hoy esas
12 desaparecen sin dejar rastro. La propia pantalla admite que **no sabe qué son**: *"puede
ser merma, o una venta que todavía no entró al sistema"*.

**Nadie puede contestar esto desde el sistema.** Hay que saber qué pasa de verdad en el
mostrador: ¿se tira pasta al final del turno? ¿se regala? ¿se come el personal? ¿o el
faltante es casi siempre una venta que Fudo todavía no importó?

Escribirlo automáticamente como merma sería **inventar un dato**.

### B2 · 🔴 ¿Qué se hace con el sobrante de masa?

Al cerrar un lote se anota `kg_sobrante` y un `destino` que hoy es texto libre. **203 de 232
lotes** tienen sobrante cargado.

Según a dónde va, es `merma` (se tiró), `transferencia` (volvió a la cámara para mañana) o
`consumo` (se usó en otra cosa). **Depende de lo que hagan en la fábrica**, y probablemente
la respuesta sea "las tres, según el día" — en cuyo caso lo que hay que definir es la lista
de destinos posibles.

### B3 · 🔴 ¿"Sin gluten" pasa a ser un dato del producto?

**Cero columnas** en las 93 tablas mencionan gluten, TACC, alérgeno, celíaco o apto. Lo
único que hay son nombres con "SG" escrito a mano: 32 recetas, 23 productos, 7 insumos.

**La regla real hoy es: "todo lo de Saavedra es sin gluten".** Una propiedad del **lugar**,
no del producto. Funciona mientras nada cruce entre locales.

El ledger mueve mercadería entre ubicaciones **por diseño**. Esta es una decisión de
seguridad alimentaria antes que técnica.

### B4 · ¿Por qué Saavedra no tiene ni un ajuste de stock?

Las **143 correcciones** de cámara y mostrador son **todas de Vedia**. Cero de Saavedra.

O allá nunca hizo falta corregir, o esa pantalla no se usa. Cambia el diseño: si Saavedra no
ajusta, o no lo necesita o no tiene cómo.

### B5 · ¿Por qué se cortaron los ajustes de cámara el 12-jun?

Los de mostrador siguen hasta el 1-sep. Los de cámara se cortan el 12-jun y no vuelven. Algo
cambió a mitad de junio: una pantalla, una costumbre o un permiso.

### B6 · Tres descuentos de $400 y $800: ¿están bien?

| Fecha | Empleado | Monto | Motivo |
|---|---|---:|---|
| 30-abr | Ian Polaski | $400 | `presentismo por parte medica` |
| 15-jun | Ian Polaski | $400 | `400` |
| 15-jun | Jose Velasco | $800 | `800` |

Lo que llama la atención no es el monto: en dos de los tres **el motivo dice el número**. Y
un descuento de presentismo de $400 es raro, porque el presentismo es el 10 % del sueldo.
Se contesta mirando el recibo.

### B7 · Cuatro insumos con costo CERO que son comida de verdad

| Local | Insumo | Movimientos |
|---|---|---:|
| Saavedra | **Jamón Cocido** (La Ucraniana) | 8 |
| Saavedra | **Panceta envasada** | 8 |
| Vedia | **Harina de fuerza** | 1 |
| Vedia | **Perejil seco** | 1 |

Tienen movimientos de stock y el costo en cero. **Hoy no están en ninguna receta**, así que
no rompen ningún costeo — pero el día que alguien los agregue, la receta va a costar de
menos sin avisar. ¿Cuánto salen?

### B8 · Cuatro recetas ACTIVAS de Saavedra nombran subrecetas que no existen

- **Brownie con Nueces (PORCIÓN)** → "Subreceta Brownies con Nueces"
- **Combo Proteico**, **Dulce Encuentro** y **Sabores Del Litoral** → "Subreceta Cafe Con Leche"

No existen en ningún local, así que esos renglones **no se expanden**: el costo y la lista
de compra de esas cuatro recetas están incompletos, en silencio. ¿Hay que crear las
subrecetas o sacar el renglón?

### B9 · Los 15 descartables y productos de limpieza con costo cero

Bolsas, servilletas, papel, rejillas. No entran en ninguna receta, así que no afectan el
costeo de platos — pero subestiman el gasto de esas categorías. ¿Vale la pena cargarlos?

---

## Resumen para decidir rápido

| | Pregunta | Quién | Bloquea |
|---|---|---|---|
| A1 | Cómo se modela una transformación | ✅ resuelta | — |
| A2 | Conteo como tipo propio | ✅ resuelta | — |
| A3 | El ledger arranca de un conteo | vos | paso 2 |
| A4 | Unificar `camara` / `camara_congelado` | vos | paso 5 |
| A5 | "Quién" como usuario de verdad | vos *(el QR sin login, con Lucas)* | paso 0 |
| A6 | Si existe un tipo "Otro" | vos | paso 0 |
| A7 | Verificar las 25 duplicaciones | trabajo mío | nada |
| **B1** | **¿El faltante del mostrador es merma?** | **Lucas** | **paso 4** |
| **B2** | **¿Qué se hace con el sobrante de masa?** | **Lucas** | paso 3 |
| **B3** | **¿"Sin gluten" es dato del producto?** | **Lucas** | paso 5 |
| B4 | Por qué Saavedra no ajusta | Lucas | diseño |
| B5 | Por qué se cortaron los ajustes en junio | Lucas | nada |
| B6 | Los tres descuentos de $400/$800 | Lucas | nada |
| B7 | Costo de jamón, panceta, harina, perejil | Lucas | nada |
| B8 | Las cuatro recetas con subrecetas fantasma | Lucas | nada |
| B9 | Costo de los descartables | Lucas | nada |

**Si Lucas solo puede contestar tres, que sean B1, B2 y B3**: son las únicas de su grupo que
frenan la construcción del ledger.
