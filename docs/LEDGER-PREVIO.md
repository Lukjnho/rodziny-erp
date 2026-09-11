# El ledger de stock — modelo y orden de construcción

**Revisión 2 · 10-sep-2026.** Incorpora la decisión sobre la venta y las dos correcciones
al modelo. Sigue siendo **análisis: no creé ninguna tabla, ninguna migración y no toqué un
solo dato.**

> **Qué es el ledger:** una sola tabla donde cada cambio de stock es una **fila que no se
> modifica nunca** — qué producto, qué cantidad con signo, de dónde a dónde, cuándo, quién y
> por qué documento. El stock de cualquier momento se **calcula sumando filas**, en vez de
> guardarse en una columna que se pisa.

---

## 1. La decisión sobre la venta, escrita

**Son dos eventos distintos y los dos se registran.**

| Evento | Cuándo | Qué escribe | Toca stock |
|---|---|---|:-:|
| **Sale a la cocina** | La comanda se manda desde el teléfono del mozo | Movimiento tipo **`venta`**, negativo | **Sí** |
| **Se cobra** | En Caja, cuando el cliente paga | El cobro, en las tablas de plata | **No** |
| **Se anula la mesa** | Después de que la comanda ya salió | Movimiento tipo **`merma`**, negativo | **Sí** |

**Por qué así, en criollo:** la pasta sale del freezer cuando el cocinero la agarra, no
cuando el cliente paga. Si se anula la mesa, esa pasta **ya se cocinó y no vuelve** — es
merma, no es una venta que se deshace. Y la plata es otra pregunta, que se contesta en Caja.

### 🟢 La decisión ya está implementada — y conviene saberlo

La función `cocina_salidas_de_camara` (migración 195) **ya hace exactamente esto**:

- Los tickets de salón quedan **afuera** del conteo de ventas (línea 107), porque esos
  platos ya se contaron cuando la comanda fue a la cocina.
- El salón se cuenta por `caja_mesa_envios` (línea 129), o sea **por el envío**.
- Mostrador y Fudo se cuentan **a la hora del ticket**, porque ahí no hay comanda: la venta
  *es* el momento en que sale.

**Lo que decidiste no cambia el criterio: lo ratifica y lo vuelve oficial.** Eso baja
muchísimo el riesgo del paso más importante de la construcción — no hay que inventar la
regla, hay que mudarla de "se calcula al mirar" a "se escribe cuando pasa".

> ⚠️ **Pero hoy nadie escribe nada.** `cocina_salidas_de_camara` **calcula al vuelo** cada
> vez que alguien abre la pantalla. Ninguna venta deja una fila de stock. Ese es el trabajo.

---

## 2. Las dos correcciones al modelo

### 2.1 Una transformación no es un movimiento

**Producción sale de la lista de tipos y pasa a ser una entidad que agrupa.**

Una transformación es **N consumos + N producciones que entran juntas o no entra ninguna**,
en una sola función de la base. No es un tipo más: es el sobre que contiene los renglones.

```
TRANSFORMACIÓN  #a3f1  ·  "Armado de sorrentinos"  ·  28-abr 09:14  ·  Vedia  ·  Martín
   ├── consumo     −12,00 kg   Masa de huevo          (lote M-0412)
   ├── consumo     − 8,50 kg   Relleno de jamón       (lote R-0288)
   └── produccion  +200 porc.  Sorrentinos J&Q        (lote P-1130)
```

**Por qué importa, con el caso real que ya existe:** hoy el botón de Panadería descuenta la
masa en un paso y da de alta el pan en otro. **Si el segundo falla, la masa desapareció y el
pan no existe.** El propio código lo sabe y muestra un cartel pidiendo que lo carguen a
mano desde la PC. Con una transacción atómica ese estado intermedio **no puede existir**.

**Lo que hace falta para que funcione:**

- Un identificador de transformación que compartan todos los renglones.
- **Una sola RPC** que escriba todo adentro de una transacción. No el navegador haciendo
  dos llamadas.
- Esa RPC tiene que **contar las filas que tocó** y fallar si son cero. En este proyecto eso
  no es opcional: hoy el **91 % de las escrituras de stock** no lo hace, y una escritura que
  la seguridad de fila bloquea devuelve 0 filas y **ningún** error.

> 💣 **El dato hoy casi no existe.** Solo **21 de 408 lotes de pasta (5 %)** registran de qué
> masa salieron. El modelo nuevo le da un lugar, pero el dato hay que empezar a capturarlo:
> la primera transformación de verdad va a ser la primera vez que el sistema sepa qué se
> consumió para hacer algo.

### 2.2 Un conteo declara, no ajusta

**El conteo dice "acá hay 40". El sistema calcula la diferencia. No al revés.**

| | Ajuste | Conteo |
|---|---|---|
| Qué escribe la persona | el **delta** ("sumá 3") | el **valor absoluto** ("acá hay 40") |
| De dónde sale el número | de la cabeza del que corrige | de contar físicamente |
| Quién gana | el sistema tenía razón, se corrige un error puntual | **el conteo gana**: es la verdad |
| Para qué sirve después | para nada más | para **medir cuánto le erró el sistema** |

Esa última fila es la que justifica separarlos. Si el conteo guarda el valor declarado, cada
conteo mide el desvío acumulado desde el anterior — y eso es la única forma de saber si el
ledger está funcionando. Si se guarda solo el delta, esa información se pierde.

**Cómo se implementa sin romper "el stock es la suma de las filas":** la fila de conteo
guarda **las dos cosas** — el valor declarado y el delta calculado. La suma sigue
funcionando; el valor declarado queda para auditar.

> 💣 **Hoy ese dato se está perdiendo.** `movimientos_stock` guarda el delta del inventario
> físico, no lo que se contó. Son **1.875 filas** (el 19 % de todos los movimientos del
> almacén) donde el valor contado ya no se puede recuperar.

---

## 3. ¿Los 7 tipos siguen alcanzando?

**No. Quedan 8 tipos y 1 entidad que agrupa.** El cambio es chico pero cambia el modelo.

| # | Tipo | Signo | Qué es | Cambió |
|---:|---|:-:|---|---|
| 1 | `recepcion` | + | Entró mercadería de un proveedor | — |
| 2 | `transferencia` | ± | Cambió de lugar, no de cantidad | — |
| 3 | `consumo` | − | Se usó y no registramos qué salió | — |
| 4 | `produccion` | + | Se fabricó algo | ⚠️ **ahora vive adentro de una transformación** (puede ir suelto mientras no capturemos el insumo) |
| 5 | `venta` | − | Salió a la cocina (salón) o se vendió (mostrador y Fudo) | ✅ **definido** |
| 6 | `merma` | − | Se perdió. **Incluye la mesa anulada** | ✅ **ampliado** |
| 7 | `ajuste` | ± | "Me equivoqué, corregí" | ⚠️ **más angosto**: ya no absorbe los conteos |
| 8 | **`conteo`** | = | **"Acá hay 40."** Declara un absoluto | 🆕 **nuevo** |

Más **`transformacion`**, que no es un tipo: es la entidad que agrupa renglones de
`consumo` y `produccion` para que entren juntos o no entre ninguno.

### Tres cosas que se resuelven solas con este cambio

**El arranque del ledger ya tiene forma.** El saldo inicial es un `conteo`, no un tipo
especial de apertura. El día que se prenda, se carga el conteo físico y listo.

**La mesa anulada tiene lugar.** Con la decisión, `merma` cubre el caso sin inventar un tipo
"devolución" que mentiría (la pasta no volvió al freezer).

**"Otro" desaparece.** Hoy hay 14 filas con motivo literal `Otro`. Con `ajuste` + un motivo
obligatorio en texto, no hace falta un tipo comodín. **Mi recomendación es no crearlo**: un
tipo "otro" se convierte siempre en el tacho donde va a parar lo que nadie quiso clasificar.

### Lo que sigue sin resolverse solo

**El sobrante de masa.** Al cerrar un lote se anota `kg_sobrante` y un `destino` que hoy es
texto libre. Hay **203 de 232 lotes** con sobrante cargado. Según a dónde fue, es `merma`
(se tiró), `transferencia` (volvió a la cámara) o `consumo` (se usó en otra cosa). **Esto lo
tiene que decidir Lucas mirando qué hacen de verdad en la fábrica.**

---

## 4. Orden de construcción

**El principio:** en cada paso el ledger se vuelve dueño de **un pedazo más** del stock, y el
sistema viejo sigue siendo dueño del resto. Nunca hay un momento en que el ledger esté "a
medias sobre todo" — está **completo sobre poco** y va creciendo.

Y cada paso se puede **verificar contra un conteo físico**. Si no cuadra, no se avanza.

---

### Paso 0 — La tabla y la función de saldo, vacías

La tabla de movimientos, la entidad de transformación, y **una sola función** `stock_de(producto, ubicacion, momento)`.

**Nadie la lee todavía.** Es confiable porque nada depende de ella.

> 💡 **La función importa tanto como la tabla.** Hoy hay **cinco pantallas que calculan el
> stock cada una a su manera**. Una tabla común no les impone una fórmula común: si cada una
> sigue eligiendo qué filas suma, las diferencias vuelven con otra ropa. **La regla tiene que
> ser: nadie suma filas del ledger por su cuenta. Todos llaman a la función.**

---

### Paso 1 — 🔴 LAS VENTAS. Primero, como dijiste

Las tres puertas por donde sale mercadería vendida:

| Puerta | Cuándo escribe | Qué hoy |
|---|---|---|
| Comanda del mozo → cocina | al enviar | `caja_mesa_envios`, sin stock |
| Cobro en el mostrador (POS propio) | al cobrar el ticket | `ventas_items`, sin stock |
| Importador de Fudo (cada 15 min) | al importar el ticket | `ventas_items`, sin stock |

**La regla ya está escrita** en `cocina_salidas_de_camara`. El trabajo es mudarla de
"calcular al mirar" a "escribir cuando pasa".

⚠️ **La trampa del importador de Fudo:** borra el período y lo repone entero cada vez. Si
escribe movimientos de stock de la misma forma, va a **duplicar** o **borrar** stock en cada
corrida. Necesita ser idempotente: una marca por ticket que impida escribirlo dos veces.
**Este es el riesgo técnico más grande de todo el plan.**

**Al terminar este paso todavía no se puede leer el stock del ledger** — falta de dónde
parte. Pero las filas ya se están acumulando, y eso permite compararlas contra lo que
calcula la pantalla vieja **antes** de confiar en ellas. Una semana de comparación en
paralelo, sin que nadie dependa del número nuevo.

---

### Paso 2 — ✅ EL MÍNIMO VIABLE: conteo de apertura + ventas

**Acá ya tenés un número confiable que resta lo vendido.**

1. Se cuenta físicamente la pasta congelada de un local.
2. Ese conteo entra como filas de tipo `conteo`.
3. Desde ese momento: **stock = conteo + lo que entró − lo vendido**.

**Alcance de este mínimo, a propósito chiquito:** pasta congelada, un solo local, la cámara.
Nada más. **Ese número ya es más confiable que todo lo que hay hoy**, porque arranca de la
realidad y se mueve solo con eventos registrados.

**Cómo se sabe que funciona:** al siguiente conteo físico, la diferencia entre lo que dice el
ledger y lo que hay tiene que ser **chica y explicable**. Si es chica, se avanza. Si no, se
averigua qué falta antes de seguir.

> Esto es lo que pediste: **el mínimo viable que ya resta lo vendido.** Dos tipos de
> movimiento (`conteo` y `venta`), una función de lectura, un local, un tipo de producto.

---

### Paso 3 — La producción entra

Los lotes de pasta escriben `produccion`. El número ya sube y baja solo.

Acá **todavía no** hace falta la transformación completa: se puede registrar la producción
sin registrar qué se consumió. **Es la decisión correcta para este paso**, porque hoy solo el
5 % de los lotes sabe de qué masa salió — exigirlo de entrada frenaría todo.

Al terminar: el ciclo completo de la pasta congelada vive en el ledger.

---

### Paso 4 — Merma y mesas anuladas

El botón "Se perdió" y la anulación de mesa escriben `merma`.

Y acá se cierra un agujero que hoy está abierto: la merma del mostrador **se calcula y no se
registra** (38 filas en la tabla, **cero** imputaciones a lote, 584 porciones sin rastro).

⚠️ **Pero ojo, y esto es una decisión pendiente:** el faltante del mostrador **no es
necesariamente merma**. La propia pantalla lo admite: *"puede ser merma, o una venta que
todavía no entró al sistema"*. Escribirlo automáticamente como merma sería **inventar un
dato**. Hasta que eso se decida, el faltante tiene que quedar visible como faltante, sin tipo.

---

### Paso 5 — Transferencias

Cámara → mostrador escribe `transferencia`. Recién acá el ledger conoce las dos ubicaciones.

**Antes de este paso hay que unificar el vocabulario**: hoy la cámara se llama
`camara_congelado` en una tabla y `camara` en otra.

---

### Paso 6 — El almacén de insumos

El mundo grande: 10.015 movimientos, recepción y consumo. Se muda `recepcion`, `consumo`,
`ajuste` y `conteo` del almacén.

Va último **a propósito**, aunque sea el más grande:

- Es el que peor está (el stock guardado y la suma de movimientos **no coinciden en el 78 %
  de los productos**).
- Es el que menos ubicaciones tiene (hoy: ninguna).
- Y es el único donde **conviene la transformación completa**, porque es el que conecta con
  el costeo: hasta que no sepamos qué insumo se consumió para hacer qué, el costo de receta
  sigue siendo teórico.

---

### Paso 7 — Apagar lo viejo

Recién acá se reescriben las 12 pantallas y vistas que hoy leen stock, y se apagan
`productos.stock_actual` y los cálculos propios de cada pantalla.

**Mientras tanto conviven los dos.** Es incómodo y vale la pena: es lo que permite comparar.

---

## 5. Lo que sigue sin decidirse

1. **El faltante del mostrador: ¿es merma?** (paso 4) — Hoy nadie lo sabe y la pantalla lo
   dice.
2. **El sobrante de masa: ¿merma, transferencia o consumo?** — 203 lotes esperando.
3. **¿"Sin gluten" pasa a ser un dato del producto?** — Hoy es una propiedad del **lugar**
   ("todo lo de Saavedra es sin gluten") y **cero columnas** en las 93 tablas mencionan
   gluten. El ledger mueve mercadería entre lugares por diseño.
4. **¿El campo "quién" pasa a ser un usuario de verdad?** — Hoy `registrado_por` es texto
   libre: **152 valores distintos** para unas 20 personas, 356 vacíos y 311 UUID crudos.
5. **¿Se unifica `camara` / `camara_congelado`?** (paso 5)

---

## Lo que este documento no cubre

- **No vi la propuesta original de Willy.** Trabajé sobre los 7 tipos que me pasaron; si su
  diseño ya resolvía algo de esto, puede haber solapamiento.
- **No hay diseño de tablas.** Ni columnas, ni tipos de dato, ni migraciones. A propósito:
  eso viene después de que estas decisiones estén cerradas.
- **No revisé permisos ni RLS**, y va a ser central. El 91 % de las escrituras de stock hoy
  no comprueba si la RLS las bloqueó.
- **Los casos que no entran son los que encontré**, mirando los datos reales y las 82
  escrituras. Puede haber más en un rincón.
