# Resultados del diagnóstico — consultas (b) y (g)

**Corridas el 10-sep-2026 contra producción.** Solo lectura: ni un `UPDATE`, ni un
`INSERT`, ni un `DELETE`. Ningún dato se modificó.

> **Cómo leer esto.** Cada consulta busca un daño posible, no lo prueba. Que una devuelva
> cero es una buena noticia; que devuelva filas no significa que estén mal. Abajo separo
> **lo que hay que mirar** de **lo que ya miré y está bien**.

---

## Resumen en cuatro renglones

| Consulta | Qué buscaba | Resultado |
|---|---|---|
| **(b)** | Adelantos, bonos, descuentos y sanciones mil veces más chicos | **0 filas.** 3 para mirar por las dudas |
| **(g)** | Insumos con el costo unitario en CERO | **31 insumos**, 19 activos — **ninguno usado en receta** |
| **(g bis)** | Insumos mil veces más baratos de lo normal | 6 filas, y **las 6 son falsas alarmas** |
| **(g ter)** | El rastro con fecha y usuario | Sin novedad *(ver abajo)* |

**Lo bueno: el daño que temíamos no está.** El bug de los montos existe en el código, pero
los datos de sueldos no se rompieron, y los costos en cero no llegaron a contaminar ninguna
receta.

---

## (b) Adelantos, bonos, descuentos y sanciones

### El resultado: **cero filas**

Ninguna fila está 100 veces por debajo de la mediana de su propio concepto.

### Por qué ese cero es creíble

Un cero puede significar "no hay daño" o "la consulta no tenía con qué encontrarlo". Acá es
lo primero, y estos son los números que lo respaldan:

| Concepto | Filas | Desde | Hasta | Monto mínimo | Mediana | Monto máximo |
|---|---:|---|---|---:|---:|---:|
| adelanto | 40 | 10-abr | 10-sep | $10.000 | $60.000 | $300.000 |
| bono | 71 | 29-abr | 07-sep | $2.500 | $48.000 | $550.000 |
| descuento | 24 | 15-abr | 11-ago | $400 | $22.500 | $258.500 |
| sanción | 5 | 28-abr | 30-ago | $40.000 | $75.000 | $300.000 |

**140 filas en cinco meses.** Ninguna en cero ni negativa. Los mínimos de adelanto, bono y
sanción están en un orden razonable: si alguien hubiera tecleado `150.000` y se hubiera
guardado `150`, aparecería enseguida contra medianas de $48.000 a $75.000.

### ⚠️ Tres descuentos que la consulta NO marcó y conviene mirar

Quedaron justo del lado de adentro del umbral (56 y 28 veces bajo la mediana, no 100).

| Fecha | Empleado | Monto | Período | Motivo | Si fuera el bug |
|---|---|---:|---|---|---:|
| 30-abr | Ian Polaski | **$400** | 2026-04-Q2 | `presentismo por parte medica` | $400.000 |
| 15-jun | Ian Polaski | **$400** | 2026-06-Q1 | `400` | $400.000 |
| 15-jun | Jose Velasco | **$800** | 2026-06-Q1 | `800` | $800.000 |

> 🔍 **Lo que me llama la atención no es el monto, es el motivo.** En dos de los tres, el
> campo "motivo" dice literalmente el número: `400` y `800`. Eso puede ser alguien anotando
> el importe como referencia, o puede ser que el monto se haya cargado en el campo
> equivocado. **No lo puedo decidir yo**: hay que mirarlo contra el recibo.
>
> El primero es distinto: un descuento de presentismo de **$400** es raro, porque el
> presentismo es el 10 % del sueldo. Si el sueldo de ese período era ~$400.000, el descuento
> tendría que haber sido ~$40.000, no $400.

---

## (g) Insumos con el costo unitario en CERO

### El resultado: **31 insumos**, 19 activos y 12 dados de baja

### 🟢 Y la noticia importante: **ninguno se usa en una receta activa**

Lo verifiqué **por los dos caminos**, porque el primero solo cubría parte:

- **Por identificador** (`producto_id`): 0 recetas.
- **Por nombre**: 0 recetas. Este segundo cruce hacía falta porque **el 28 % de los
  ingredientes de recetas activas (290 de 1.035) no tienen enganche por identificador** y
  solo se relacionan por el nombre. Sin ese segundo cruce, el "cero" habría sido un alivio
  falso.

**O sea: el bug del costo en cero existe, pero todavía no contaminó el costeo de ninguna
receta.** Se arregla el campo y listo, sin arrastre.

### Los 19 activos

Casi todos son descartables, empaque y limpieza — cosas que no entran en una receta.

| Local | Categoría | Insumo | Unidad | Movimientos |
|---|---|---|---|---:|
| vedia | Descartables | Bobina de Papel 20cmx400m (Cocina) | unid. | 16 |
| **saavedra** | **Carnes** | **Jamón Cocido** (La Ucraniana) | **kg** | **8** |
| **saavedra** | **Carnes** | **Panceta envasada** | **kg** | **8** |
| vedia | Descartables | Bolsa zipper 35*45 x 100ud. | unid. | 7 |
| saavedra | Descartables | Bolsa zipper 25*35 x 100ud. | unid. | 4 |
| vedia | Descartables | Papel manteca | unid. | 3 |
| vedia | Limpieza | Pulverizador | unid. | 3 |
| saavedra | Empaque | Bolsa polip. 20*40 | unid. | 2 |
| saavedra | Empaque | Tenedor Plástico Vianda | unid. | 2 |
| vedia | Empaque | Bolsa Polipropileno 12*15 | unid. | 2 |
| saavedra | Empaque | Cuchillo Plástico Vianda | unid. | 1 |
| saavedra | Empaque | Portavaso 2 Vasos | unid. | 1 |
| saavedra | Limpieza | Rejilla doble | unid. | 1 |
| saavedra | Descartables | Servilletas 33x32 x 1000 ud | unid. | 1 |
| **vedia** | **Harinas y huevos** | **Harina de fuerza** | **kg** | **1** |
| **vedia** | **Condimentos** | **Perejil seco** | **kg** | **1** |
| saavedra | Descartables | Bolsa zipper 35*45 x 100ud. | unid. | 0 |
| saavedra | Empaque | Dip c/tapa 55 cc x 100ud | unid. | 0 |
| saavedra | Limpieza | Paño microfibra | unid. | 0 |

> 🔴 **Los cuatro en negrita son los que importan**: son comida de verdad, con movimientos
> de stock, y con el costo en cero. **Jamón Cocido** y **Panceta envasada** en Saavedra
> tienen 8 movimientos cada uno. Que hoy no estén en ninguna receta no quiere decir que no
> vayan a estarlo mañana — y el día que alguien los agregue, la receta va a costar de menos
> sin avisar.
>
> Los otros 15 son descartables y limpieza. Su costo en cero **no afecta el costeo de
> platos**, pero sí subestima el gasto de esas categorías.

---

## (g bis) Insumos "mil veces más baratos": **las 6 son falsas alarmas**

La consulta devolvió 6 filas. **Las miré una por una y las 6 tienen el precio correcto.**

| Insumo | Costo | Mediana de su categoría | "Veces más chico" |
|---|---:|---:|---:|
| Sorbete negro | $9,16 | $7.502,81 | 819 |
| Sorbete Negro XL x 1000ud. | $10,54 | $7.502,81 | 712 |
| Sal fina en sobre | $14,42 | $5.500,00 | 381 |
| Vasos descartables 330 cc | $29,49 | $7.502,81 | 254 |
| Edulcorante en sobre | $25,34 | $5.500,00 | 217 |
| Cinta scotch x ud. | $52,93 | $7.502,81 | 142 |

Un sorbete cuesta $9. Un sobre de sal cuesta $14. **Están bien.**

### 💣 Por qué falló el método, que es lo interesante

La consulta compara cada insumo contra la mediana de **su misma categoría y su misma
unidad**. La idea era que eso los hiciera comparables. **No los hace comparables**, y el
motivo es el mismo problema de fondo que venimos encontrando en todo el ERP: **una palabra
con dos significados.**

Mirá lo que convive hoy bajo `unidad = 'unid.'` en la categoría Descartables:

| Insumo | Costo unitario |
|---|---:|
| Sorbete negro | **$9,16** |
| Film 38cm × 1000 mts | **$47.336,48** |
| Rollo de film x1000 | $37.206,83 |
| Papel higiénico x8u. | $18.298,48 |

`unid.` significa **"una pieza"** en un caso y **"un envase entero"** en el otro. Un sorbete
y un rollo de film de mil metros están anotados con la misma unidad. Cualquier comparación
estadística dentro de esa categoría es ruido.

> **Esto no es un problema de la consulta: es un problema del dato.** Y no se arregla con un
> umbral distinto. Se arregla el día que `unidad` diga si es la pieza o el envase — que es
> exactamente el trabajo de vocabulario compartido que ya está anotado como pendiente.

---

## (g ter) El rastro con fecha y usuario

**No aporta nada, y eso ya lo sabíamos.** La tabla `productos_costo_historial` solo la
escribe el camino de Gastos, y ese camino tiene un guardarraíl (`precio_unitario > 0`) que
impide que un cero llegue ahí. Los dos campos culpables —Compras › Stock y Productos ›
Insumos— escriben `productos` derecho, sin dejar historial.

**Por eso, para los 31 insumos en cero, no hay forma de saber quién los puso en cero.** La
tabla `productos` no guarda usuario. Lo único que hay es la fecha de última modificación de
la fila entera, que además se mueve si alguien cambió el nombre después.

---

## Preguntas que quedan para Lucas

1. **Los tres descuentos de $400 y $800**: ¿son correctos, o les faltan tres ceros? Los dos
   de junio tienen el número repetido en el campo "motivo".
2. **Jamón Cocido y Panceta envasada en Saavedra**: tienen movimientos de stock y costo
   cero. ¿Cuánto salen? Hasta que tengan costo, el gasto de carnes de Saavedra está
   subestimado.
3. **Harina de fuerza (Vedia)** y **Perejil seco (Vedia)**: ídem.
4. Los 15 descartables y productos de limpieza en cero: ¿vale la pena cargarles el costo, o
   se dejan así a propósito porque no entran en ninguna receta?
