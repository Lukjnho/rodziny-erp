# Antes de construir el ledger — qué hay que decidir primero

**10-sep-2026.** Esto es **análisis, no diseño**. No creé ninguna tabla, no escribí ninguna
migración y no toqué un solo dato. Los números salen de consultas de solo lectura contra
producción y de leer el código.

> **Qué entiendo por "ledger"**, para que no discutamos cosas distintas: una sola tabla
> donde cada cambio de stock es una **fila que no se modifica nunca** — qué producto, qué
> cantidad con signo, de dónde a dónde, cuándo, quién y por qué documento. El stock de
> cualquier momento se **calcula sumando filas**, en vez de guardarse en una columna que se
> pisa.
>
> ⚠️ **No vi la propuesta original de Willy.** Trabajo sobre los 7 tipos que me pasaron
> (recepción, transferencia, consumo, producción, venta, merma, ajuste). Si su propuesta
> tiene más piezas, esto puede estar opinando sobre algo que él ya resolvió.

---

## 1. ¿Los 7 tipos cubren lo que hoy existe?

**No del todo. Encontré cuatro casos reales que no entran, y uno de ellos es estructural.**

### 🔴 El grande: **producción no es un movimiento, es una transformación**

Los otros seis tipos mueven **una** cosa: entra, sale, o cambia de lugar. Producción hace
otra cosa: **consume varias cosas y crea una distinta.** Armar sorrentinos consume masa y
relleno, y produce porciones de sorrentino. Eso no es una fila con signo: son N filas
negativas y una positiva que **solo tienen sentido juntas**.

Si cada una entra suelta, se puede dar de baja la masa y que falle el alta del sorrentino —
que es **exactamente el bug que ya existe hoy** en el botón de Panadería: la masa se
descuenta en un paso y el pan se da de alta en otro, y si el segundo falla, la masa
desapareció y el pan no existe.

**Un ledger de filas sueltas no arregla eso por sí solo.** Hace falta que las filas de una
transformación compartan un identificador y entren o fallen todas juntas.

> **Y hay un agravante medido:** hoy **solo 21 de 408 lotes de pasta (5 %)** registran de
> qué masa salieron. La relación insumo→producto casi no existe en los datos. El ledger
> puede darle un lugar, pero el dato hay que empezar a capturarlo.

### 🟠 El frecuente: **el conteo físico no es un ajuste**

| Cómo se cuenta hoy | Filas | Desde |
|---|---:|---|
| `movimientos_stock` con motivo "Inventario físico" | **1.875** | 20-abr-2026 |
| `cocina_cierre_dia` (conteo del mostrador) | 4.987 | 30-abr-2026 |
| `cocina_cierre_camara` (conteo de cámara) | 136 | 12-jun-2026 |

Los "Inventario físico" son el **19 % de todos los movimientos del almacén**. Y un conteo
no es un ajuste:

- Un **ajuste** dice *"sumá 3, me había equivocado"*. Es un delta, y el que lo escribe sabe
  cuánto se equivocó.
- Un **conteo** dice *"acá hay 40"*. Es un valor absoluto, y es **la verdad que le gana al
  sistema**. El delta es una consecuencia, no el dato.

Meter los dos en `ajuste` pierde la diferencia, y con ella se pierde lo único que permite
medir si el sistema le está errando: cuánto se desvió entre conteo y conteo.

> 💣 Y hay un detalle que complica la reconstrucción: hoy `movimientos_stock` guarda el
> **delta** del conteo, no lo que se contó. El valor absoluto se perdió.

### 🟡 El que ya está: **"Otro"**

`movimientos_stock` tiene 14 filas con motivo literal **"Otro"**. Es la válvula de escape
que aparece siempre. Sea cual sea la lista final de tipos, alguien va a necesitar una — y
conviene decidir de antemano si existe y qué se hace con lo que cae ahí, en vez de que
aparezca sola.

### 🟡 El ambiguo: **el sobrante de masa**

Al cerrar un lote de masa se anota `kg_sobrante` y un `destino`. **203 de 232 lotes** tienen
sobrante cargado. Ese sobrante no es claramente ninguno de los siete: según a dónde fue,
puede ser merma (se tiró), transferencia (volvió a la cámara) o consumo (se usó en otra
cosa). Hoy el destino es texto libre.

**Esto es una pregunta para Lucas, no una decisión mía.**

---

## 2. Qué escribiría cada pantalla en el modelo nuevo

Relevé **82 escrituras de stock** repartidas en estas pantallas. Así se mapearían:

| Pantalla / acción | Hoy escribe en | Tipo en el ledger |
|---|---|---|
| **/recepcion** (QR, sin login) | `movimientos_stock`, `productos.stock_actual` | `recepcion` |
| **Compras › Stock** — confirmar recepción | ídem, por otro camino | `recepcion` ⚠️ *hoy son dos caminos que se pisan* |
| **/deposito** (QR, sin login) — sacar insumo | `movimientos_stock`, `productos.stock_actual` | `consumo` |
| **Compras › Movimientos** — alta/baja manual | `movimientos_stock` | `ajuste` |
| **Compras › Stock** — inventario físico | `movimientos_stock` | ❌ **`conteo`** *(tipo que falta)* |
| **QR producción** — Cargar Masa | `cocina_lotes_masa` | `produccion` |
| **QR producción** — Cargar Relleno | `cocina_lotes_relleno` | `produccion` |
| **QR producción** — Armar Pasta | `cocina_lotes_pasta` (+ `_masas`) | ❌ **`transformacion`**: consume masa y relleno, produce pasta |
| **QR producción** — Porcionar | `cocina_lotes_pasta.ubicacion` | `transferencia` (freezer → cámara) |
| **QR producción** — Cerrar Masa | `cocina_lotes_masa.kg_sobrante` | ⚠️ *depende del destino: merma, transferencia o consumo* |
| **QR producción** — Panadería | `cocina_lotes_masa` **y** `cocina_lotes_produccion` | ❌ **`transformacion`** *(hoy son dos pasos sueltos: es el bug)* |
| **QR producción** — Salsas / postres / milanesas | `cocina_lotes_produccion` | `produccion` |
| **Cocina › Stock** — traspaso cámara→mostrador | `cocina_traspasos` | `transferencia` |
| **Cocina › Stock** — ajuste manual | `cocina_ajustes_stock` | `ajuste` |
| **/mostrador** — cierre de turno | `cocina_cierre_dia` | ❌ **`conteo`** |
| **Cocina** — cierre de cámara | `cocina_cierre_camara` | ❌ **`conteo`** |
| **/pizarron** — botón "Se perdió" | `cocina_merma` | `merma` |
| **Caja / POS** — cobrar | `ventas_tickets`, `ventas_items` | `venta` ⚠️ *hoy **no** escribe stock* |
| **Teléfono del mozo** — comanda a la cocina | `caja_mesa_envios` | `venta` ⚠️ *ídem, y con **otro** momento* |
| **Importador de Fudo** (cada 15 min) | `ventas_items` | `venta` ⚠️ *ídem* |

### 💣 Lo que salta a la vista de esa tabla

**Ninguna venta escribe stock hoy.** Ni el POS propio, ni el importador de Fudo, ni la
comanda del mozo. El stock de pasta se estima **restando ventas leídas desde otra tabla**,
en el momento de mirar. Si el ledger se arma y las ventas no le escriben, el ledger nace
incompleto y va a dar peor que lo de hoy — porque va a *parecer* completo.

**Tres pantallas escriben conteos y ninguna tiene tipo.** Son 7.000 filas de conteo entre
las tres.

---

## 3. Qué se rompe

Todo esto lee stock hoy y habría que reescribirlo:

| Qué | Dónde | Por qué se rompe |
|---|---|---|
| Vista `v_cocina_stock_pastas` | SQL | Calcula el neto de cámara desde 4 tablas |
| Vista `v_cocina_stock_mostrador` | SQL | Ídem para el mostrador |
| **Cocina › Stock** | `StockTab.tsx` | Consume las dos vistas |
| **/mostrador** | `MostradorPage.tsx` | Calcula "esperado" por su cuenta con su propia fórmula |
| **Almacén › Congelados** | `StockCongeladosTab.tsx` | Hace **cuatro consultas crudas** propias — es el del 2.715 vs 272 |
| **Cocina › Dashboard** | `DashboardTab.tsx` | KPI de OK / bajo mínimo / sin stock |
| **Compras › Stock** | `ComprasPage.tsx` | Lee `productos.stock_actual` directo |
| **Almacén › Pedidos** | `PedidosTab.tsx` | Sugiere pedidos contra el mínimo |
| **Pizarrón** | `PizarronPage.tsx` + triggers | Se marca solo según lo producido |
| **Calculadora de Cocina** | `CalculadoraTab.tsx` | Lista de compra contra lo que hay |
| **Cierre de inventario / CMV** | `finanzas/` | Valoriza el stock a fin de mes |
| `snapshot_inventario_actual` | RPC | Foto del inventario para el cierre |

**Doce lugares.** Y hay un detalle que conviene mirar de frente: **cinco de ellos calculan
el stock a su manera**, no leen un número común. El ledger les daría una fuente única, pero
**no les impone la misma fórmula**: si cada pantalla sigue decidiendo qué filas suma, las
diferencias vuelven. Eso hay que resolverlo con **una sola función que devuelva el stock**,
no solo con una sola tabla.

---

## 4. El tema TACC

### La respuesta corta: **no existe. Hoy se deduce del local, y nada más.**

Busqué en toda la base una columna que diga si algo lleva gluten:

```
gluten · tacc · alergeno · celiaco · apto
```

**Cero columnas, en las 93 tablas.**

Lo único que hay son **nombres**: 32 recetas, 23 productos de cocina y 7 insumos tienen
"sin gluten", "SG" o "TACC" escrito en el nombre. Eso es una convención de tipeo, no un
dato: no se puede filtrar con garantía, nadie valida que esté bien escrito, y un producto
sin la sigla en el nombre es indistinguible de uno apto.

**Entonces la regla real hoy es: "todo lo de Saavedra es sin gluten".** Funciona mientras
Saavedra sea 100 % sin gluten y nada cruce entre locales.

> 🔴 **Y por eso el arreglo de la Calculadora que hice hoy importa más de lo que parecía.**
> Esa pantalla podía bajar una subreceta de Vedia —con harina de trigo— dentro de una receta
> de Saavedra, porque enganchaba por nombre sin mirar el local. Con la ubicación deducida
> del local, **cualquier cosa que cruce locales rompe la única garantía de gluten que hay.**
>
> El ledger va a mover mercadería entre ubicaciones por diseño. Antes de que eso exista,
> hay que decidir si "sin gluten" pasa a ser un dato del producto o sigue siendo una
> propiedad del lugar. **No es una decisión técnica.**

---

## 5. Lo que hay que decidir antes de escribir una línea

Ordenado por cuánto bloquea:

1. **¿La venta va a escribir en el ledger?** Sin esto el ledger nace incompleto. Y hay que
   elegir **qué momento** cuenta: la comanda a la cocina o el cobro. Las dos respuestas son
   legítimas y hoy conviven las dos.
2. **¿Cómo se representa una transformación** (masa + relleno → pasta)? ¿Filas agrupadas por
   un identificador de documento, o algo distinto?
3. **¿"Conteo" es un tipo propio?** Son 7.000 filas históricas que hoy se disfrazan de otra
   cosa.
4. **¿"Sin gluten" pasa a ser un dato del producto?** Ver arriba.
5. **¿Qué es el sobrante de masa** — merma, transferencia o consumo? 203 lotes esperando.
6. **El campo "quién".** Hoy `registrado_por` es texto libre: **152 valores distintos** para
   unas 20 personas, más 356 vacíos y 311 UUID crudos. Conviven "Martin" y "martin", "Jere y
   Martin" y "Martin y Jere". Si el ledger nace con un campo de texto, nace con el mismo
   problema.
7. **¿Se unifica el vocabulario de ubicaciones?** Hoy la cámara se llama `camara` en una
   tabla y `camara_congelado` en otra.

---

## Lo que no cubre este documento

- **No vi la propuesta de Willy.** Trabajé sobre los 7 tipos que me pasaron.
- **No diseñé nada.** No hay tablas, ni columnas, ni migraciones propuestas acá. A propósito.
- **No revisé permisos ni RLS**, que va a ser central: hoy el 91 % de las escrituras de
  stock no comprueba si la RLS las bloqueó.
- **Los casos que no entran en los 7 tipos son los que encontré**, no necesariamente todos.
  Salieron de mirar los datos reales y las 82 escrituras; puede haber más en un rincón.
