# Informe de la sesión autónoma — 10-sep-2026

Trabajé solo unas dos horas sobre los cuatro bloques, en orden. **No tomé ninguna decisión
de negocio**, no toqué la entrada de montos, y contra la base **solo leí**: ni un `UPDATE`,
`INSERT` ni `DELETE`.

---

## Los cuatro bloques, en una línea cada uno

| Bloque | Qué salió |
|---|---|
| **1** Arreglos chicos | Los dos hechos. Build y 27 tests en verde |
| **2** Radiografía del stock | `docs/STOCK-HOY.md` — 82 escrituras, y el 91 % no comprueba si escribió |
| **3** Consultas (b) y (g) | `docs/RESULTADOS-DIAGNOSTICO.md` — **el daño que temíamos no está** |
| **4** Terreno del ledger | `docs/LEDGER-PREVIO.md` — 4 casos reales no entran en los 7 tipos |

---

## Bloque 1 — los dos arreglos

**a) La Calculadora ya no cruza locales.** El mapa que resuelve subrecetas anidadas se
armaba solo por nombre. Ahora la clave incluye el local, y si la subreceta no está en ese
local **no se expande** — el renglón queda a la vista sin abrir.

*La lista que pediste:* **un solo caso cruza hoy**, y es una subreceta **inactiva**
("Canelones de Osobuco" → "Crema de Hongos", 6,8 kg, que en Vedia está activa). Las otras 13
apariciones son subrecetas que no existen **en ningún** local, así que ya se comportaban
bien. El mecanismo estaba abierto igual, y con la regla del gluten dependiendo del local, lo
importante era cerrarlo.

> ⚠️ **Pero hay cuatro recetas ACTIVAS de Saavedra que nombran una subreceta que no existe
> en ningún lado**: "Brownie con Nueces (PORCIÓN)" y tres que usan "Subreceta Cafe Con
> Leche". Esas no se expanden, así que su costo y su lista de compra están incompletos, en
> silencio. **No es el bug que arreglé — es un dato que falta.**

**b) El `?? 0.21` ya se dispara.** El hook devolvía **cero** cuando el dato faltaba, y `??`
no actúa sobre cero. Ahora los campos son `number | null`: null = no cargado, cero = cargado
y vale cero. `tsc` marcó el único lugar que asumía lo contrario. La pantalla de
Configuración muestra el campo **vacío** en vez de un "0.0" que parecía configurado, y avisa
en rojo cuál falta.

*Los otros casos del mismo patrón:* revisé los 14 `?? valor` del proyecto uno por uno.
**Solo uno más es real:** `categorias_gasto.orden` tiene **3 filas en cero**, así que su
`?? 100` tampoco se dispara — es orden de lista, cosmético. Los demás son seguros: o el
valor nunca puede ser cero, o el campo es de verdad `null` cuando falta. **No los toqué.**

---

## Bloque 3 — la mejor noticia del día

**Las dos consultas dieron bien.**

**(b) Adelantos, bonos, descuentos y sanciones: cero filas.** Y el cero es creíble: 140
filas en cinco meses, ninguna en cero ni negativa, con mínimos en un orden razonable contra
medianas de $48.000 a $75.000. Si alguien hubiera tecleado `150.000` y se hubiera guardado
`150`, saltaba.

**(g) Costos en cero: 31 insumos, y ninguno se usa en una receta activa.** Lo verifiqué por
los dos caminos, y el segundo hacía falta: **el 28 % de los ingredientes de recetas activas
(290 de 1.035) no tiene enganche por identificador** y solo se relaciona por nombre. Sin ese
cruce, el "cero recetas afectadas" habría sido un alivio falso.

**O sea: el bug del costo en cero existe pero todavía no contaminó ningún costeo.** Se
arregla el campo y no hay arrastre que limpiar.

---

## Lo que encontré y no esperábamos

### 1. 🔴 El stock guardado y los movimientos no coinciden en el 78 % de los productos

De 429 productos con movimientos, **cuadran 93**. Desvío promedio 448 unidades, máximo
66.409. Esto decide el punto 5 del bloque 2: **el histórico no se puede reconstruir.** El
ledger tiene que arrancar de un conteo físico.

### 2. 🔴 El 91 % de las escrituras de stock no comprueba si escribió

75 de 82. Es peor que el 84 % que ya sabíamos para el ERP entero. Y en stock duele más,
porque las tablets entran sin login y son justo las que más restricciones de seguridad
tienen encima.

### 3. 🔴 Ninguna venta escribe stock. Ninguna.

Ni el POS propio, ni el importador de Fudo, ni la comanda del mozo. El stock de pasta se
**estima al momento de mirarlo**, restando ventas leídas de otra tabla. Si el ledger se
arma sin conectar las ventas, va a dar peor que lo de hoy — porque va a *parecer* completo.

### 4. 🔴 La merma se anota y nunca se imputa a un lote

38 filas, 584 porciones, **cero** imputaciones en la tabla de trazabilidad. Y de los
traspasos, **402 porciones quedaron sin imputar**: la función FIFO reparte lo que puede y
cuando no le alcanza el stock **no falla, avisa por un canal que nadie lee**.

### 5. 🔴 No hay modelo de ubicaciones: hay tres palabras

En toda la base existen **tres valores** — `mostrador`, `camara`, `camara_congelado` — y los
dos últimos **son el mismo lugar con dos nombres**. La tabla más grande, 10.015 movimientos,
no tiene ubicación: una bolsa de harina está "en Vedia" y nada más.

Además: **Saavedra no tiene ni una fila de ajuste.** Las 143 son todas de Vedia. Y los
ajustes de cámara se cortaron el 12-jun.

### 6. 🟠 Producción no es un movimiento, es una transformación

Los 7 tipos del ledger asumen que cada fila mueve una cosa. Armar sorrentinos consume masa
y relleno y crea sorrentinos: son varias filas que **solo tienen sentido juntas**. Si entran
sueltas se puede descontar la masa y que falle el alta — que es **el bug que ya existe** en
el botón de Panadería. Y hoy **solo 21 de 408 lotes (5 %)** dicen de qué masa salieron.

### 7. 🟠 El conteo físico no es un ajuste, y son 7.000 filas

"Inventario físico" son 1.875 movimientos del almacén (19 % del total), más 4.987 cierres de
mostrador y 136 de cámara. Un ajuste dice *"sumá 3"*; un conteo dice *"acá hay 40"* y le gana
al sistema. Meterlos en la misma bolsa pierde lo único que permite medir cuánto le erra el
sistema entre conteo y conteo.

### 8. 🟠 TACC no existe como dato

**Cero columnas** en las 93 tablas mencionan gluten, TACC, alérgeno, celíaco ni apto. Solo
hay nombres con "SG" escrito a mano. La regla real es *"todo lo de Saavedra es sin gluten"*
— una propiedad **del lugar**. Y el ledger mueve mercadería entre lugares por diseño.

### 9. 🟡 El campo "quién lo hizo" no sirve

`registrado_por` tiene **152 valores distintos** para unas 20 personas: conviven "Martin" y
"martin", "Jere y Martin" y "Martin y Jere", 356 vacíos y **311 UUID crudos**.

### 10. 🟡 Otra aparición del problema de vocabulario

La consulta (g bis) marcó 6 insumos como "mil veces más baratos". **Los 6 tienen el precio
correcto.** Falló el método, porque bajo `unidad = 'unid.'` conviven "una pieza" (un sorbete,
$9,16) y "un envase entero" (un rollo de film de 1000 metros, $47.336). No se arregla con
otro umbral.

---

## Preguntas para vos, ordenadas por cuánto bloquean

### ⛔ Bloquean el ledger — sin esto no se puede empezar

1. **¿La venta va a escribir en el ledger?** Y si sí, **¿en qué momento cuenta?** ¿Cuando la
   comanda va a la cocina, o cuando se cobra? Las dos respuestas son legítimas —el stock
   quiere una, la plata quiere la otra— y hoy conviven las dos. **Esta es la más importante
   de toda la lista.**
2. **¿"Sin gluten" pasa a ser un dato del producto, o sigue siendo una propiedad del local?**
   Hoy la única garantía es que nada cruza entre locales.
3. **¿Cómo se representa una transformación** (masa + relleno → pasta)?
4. **¿"Conteo" es un tipo propio de movimiento?**

### 🟠 Bloquean el arranque, no el diseño

5. **¿El ledger arranca de un conteo físico nuevo?** Mi recomendación es que sí, y que lo
   viejo se conserve sin migrar. Reconstruir cinco meses sobre datos que no cuadran en el
   78 % costaría semanas y daría un número que nadie va a poder defender. **Pero la decisión
   es tuya.**
6. **¿Qué es el sobrante de masa** — merma, transferencia o consumo? Hay 203 lotes con
   sobrante cargado y el destino es texto libre.

### 🟡 Se pueden decidir después, pero mejor antes

7. **¿Unificamos el vocabulario de ubicaciones** (`camara` vs `camara_congelado`)?
8. **¿El campo "quién" pasa a ser un usuario de verdad** en vez de texto libre?
9. **¿Por qué Saavedra no tiene ni un ajuste de stock?** ¿Esa pantalla allá no se usa?
10. **¿Por qué se cortaron los ajustes de cámara el 12-jun?**

### 🔵 De los datos, para cuando tengas un rato

11. **Tres descuentos de $400 y $800** (Ian Polaski ×2, Jose Velasco): ¿están bien o les
    faltan tres ceros? En dos de los tres el campo "motivo" dice literalmente el número.
12. **Jamón Cocido y Panceta envasada (Saavedra)**, **Harina de fuerza y Perejil seco
    (Vedia)**: tienen movimientos de stock y costo **cero**. ¿Cuánto salen?
13. **Cuatro recetas activas de Saavedra** nombran subrecetas que no existen ("Brownie con
    Nueces", y tres con "Cafe Con Leche"). ¿Hay que crearlas o sacar el renglón?
14. Los 15 descartables y productos de limpieza con costo cero: ¿se cargan o se dejan así?

---

## Lo que quedó sin hacer, y por qué

- **La tanda 2 de montos**: frenada, como pediste. No la toqué.
- **El grafo**: quedó pausado donde lo dejaste, 4 de 7 partes, con el respaldo intacto.
- **El bug del ×1000 en la Calculadora**: la misma función que arreglé tiene otro problema
  —un renglón en gramos se divide por un rinde en kilos, y la lista de compra pide mil veces
  de más—. **No lo toqué porque no estaba en el encargo.** Es un arreglo chico y lo puedo
  hacer cuando digas.
- **Las 25 duplicaciones SQL/frontend que no verifiqué a mano**: siguen con el veredicto del
  relevamiento automático, no con una comprobación mía.

## Los commits de la sesión

| Commit | Qué |
|---|---|
| `9f977fc` | Los dos arreglos del bloque 1 |
| `56c38cc` | Resultados de las consultas (b) y (g) |
| `50af343` | La radiografía del stock |
| `507c3f9` | El análisis previo del ledger |

Todo en la rama `fix/entrada-montos`. Build y 27 tests en verde.
