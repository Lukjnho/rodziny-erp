# Rodziny ERP — lo que hay que saber antes de opinar

**Al 10-sep-2026.** Este documento **se explica solo**: no hace falta tener el repositorio
abierto para usarlo. Todos los hechos que importan están acá adentro. Las rutas de archivo
aparecen para que el dueño sepa dónde mirar, no para que vos las abras.

> **Si sos una IA leyendo esto:** trabajás sobre el mismo proyecto que otra sesión de Claude.
> Los dos le contestan a Lucas, que es el dueño y **no programa**. Escribile en castellano
> rioplatense llano, sin jerga. Y hay cosas acá que **si las aconsejás mal, cuestan plata de
> verdad** — están marcadas con 💣.

---

## 1. El negocio, en cinco renglones

Rodziny hace pasta fresca en Argentina. **Dos locales que NO son el mismo modelo:**

- **Vedia** — fábrica + restaurante. Ahí se produce.
- **Saavedra** — restaurante, **100 % sin gluten**. 💣 Que un producto sea sin gluten no se
  deduce del nombre: la regla es el local.

Vende por mostrador, salón, y por Fudo (el sistema de punto de venta que están reemplazando
por uno propio). El ERP se usa desde computadoras y desde **tablets Android** en la cocina y
el salón — y las tablets se portan distinto, sobre todo con el teclado numérico.

**Stack:** React + TypeScript + Vite en el frente, Supabase (PostgreSQL) atrás, con edge
functions en Deno. Despliegue en Vercel.

---

## 2. Las dos reglas que si las rompés no se nota hasta que cuesta plata

### 💣 Regla 1 — El punto significa dos cosas opuestas, y las dos son correctas

| Dónde | Qué significa el punto | Ejemplo |
|---|---|---|
| **Dinero** | separador de **MILES** | `15.000` = quince mil pesos |
| **Cantidades de cocina** (kg, porciones) | **coma decimal** | `8.9` = ocho kilos novecientos |

Las dos reglas están bien, cada una en su mundo. El operario de la fábrica carga kilos en una
tablet y muchos teclados Android solo ofrecen el punto; por eso ahí el punto tiene que ser
decimal, o alguien produce veinticinco mil kilos de pasta sin querer.

**Si alguna vez te tienta "unificar esto para que quede prolijo": no.** Aplicar la regla del
dinero a las cantidades multiplica la producción por mil. Aplicar la de cantidades al dinero
divide los montos por mil. **Ninguna de las dos falla con un error: guardan un número absurdo
en silencio.**

Hay una tercera trampa, más sutil: **un valor que viene de la base NUNCA se vuelve a leer con
el parser de tipeo.** Son dos caminos distintos. Postgres devuelve `2350.50` como texto; si
eso se lee con la regla de miles, el punto desaparece y queda `23505` — diez veces más. Eso
pasaba de verdad, y en el editor de la carta alcanzaba con **entrar al campo y salir, sin
escribir nada**, para que el precio se multiplicara por diez.

### 💣 Regla 2 — Una escritura bloqueada no falla: no hace nada

Un `UPDATE` o `DELETE` que la seguridad a nivel de fila (RLS) bloquea devuelve **0 filas y
ningún error**. Compila, corre, no falla, y no hace nada.

Ya mordió tres veces. El caso más caro: los botones "Cerrar Masa" y "Cargar Panadería" de la
tablet decían que habían guardado y no guardaban — **215 lotes de masa quedaron abiertos** y
la misma masa se podía volver a usar sin que nada chillara.

**Toda escritura tiene que contar las filas que tocó y avisar si fueron cero.** Hoy eso se
cumple en el **16 % de los casos** (29 de 187 escrituras, medido). Si aconsejás una escritura
nueva, incluí el conteo.

---

## 3. El problema de fondo: el vocabulario

Casi todos los errores caros de este proyecto tienen la misma forma. **No son errores de
cálculo: son una palabra que significa dos cosas y ningún lugar del código que diga cuál.**
Y el compilador no ayuda, porque los dos significados tienen el mismo tipo.

| Palabra | Significado A | Significado B | Qué pasa al mezclarlos |
|---|---|---|---|
| **el punto** | miles (dinero) | decimal (cocina) | ×1000 o ÷1000, en silencio |
| **`costo`** | plata que alguien **tipea** | plata que el sistema **calcula** | se excluyó del vocabulario de dinero y tapó 3 campos rotos |
| **`hoy`** | día **operativo** de cocina: de 00:00 a 04:59 devuelve *ayer* | día del calendario | los cierres nocturnos caen en el día equivocado |
| **`margen`** | fracción (`0,62`) | escala 0-100 (`62`) | ×100, y TypeScript no avisa: las dos son `number` |
| **"vendido"** | cuando se **cobró** el ticket | cuando la comanda **fue a la cocina** | dos pantallas descuentan stock en momentos distintos |

**Antes de aconsejar "unificar" dos cosas que parecen iguales, preguntá cuál de los dos
significados es.** En este repo, dos funciones con el mismo nombre casi nunca hacen lo mismo.

---

## 4. Cómo está armada la base

**93 tablas · 1.162 columnas · 116 claves foráneas · 13 vistas · 56 funciones de Postgres
(13 transaccionales) · 31 triggers · 19 edge functions.**

Lo que importa es **la cadena**: cada escalón se apoya en el anterior, y un error arriba se
arrastra hasta abajo sin que nadie lo note.

```
  COSTO         productos.costo_unitario ─── productos_costo_historial
    │           (lo que sale un insumo)      (quién lo cambió y cuándo)
    ▼
  RECETA        cocina_recetas ── cocina_receta_ingredientes ── cocina_pasta_recetas
    │           (qué lleva cada plato, y las subrecetas que cuelgan de él)
    ▼
  PRODUCCIÓN    cocina_lotes_masa ─┐
    │           cocina_lotes_relleno ─┼─► cocina_lotes_pasta ──► cocina_pizarron_items
    │           cocina_lotes_produccion ─┘
    ▼
  STOCK         movimientos_stock · cocina_ajustes_stock · cocina_merma · cocina_traspasos
    │           (FIFO: se consume el lote más viejo primero)
    ▼
  VENTA         ventas_tickets ── ventas_items ── ventas_pagos
    │           caja_mesa_sesiones ── caja_mesa_lineas
    ▼
  MARGEN        cocina_recetas_precios_canal · productos_costeo_config
                (precio − IVA − comisión − costo)
```

**Dos cosas del modelo que no son obvias y confunden a cualquiera que llegue:**

- **Un producto y su receta son dos interruptores distintos.** Apagar la receta no apaga el
  producto: hay 18 pastas muertas que siguen apareciendo en el QR.
- **El relleno no lleva stock propio.** Es a propósito, no es un olvido.

---

## 5. 💣 Doce contradicciones que están activas hoy

El sistema tiene **32 reglas de negocio escritas dos veces** — una en la base y otra en el
código de pantalla. **De esas 32, treinta dan resultados distintos.** Estas doce son las que
pueden mover plata o stock sin que nadie lo note.

Están verificadas leyendo el código. **Tres las comprobó Lucas a mano** (marcadas ✔) y eran
exactas; las otras nueve salen de un relevamiento automático.

### Plata

**1. ✔ El IVA del Estado de Resultados es todo-o-nada.**
El código hace `ivaReal > 0 ? ivaReal : ivaEstimado`. Si en un mes **un solo ticket** trae IVA
del archivo fiscal, el estimado mensual cargado a mano **se descarta entero**. Un mes con
$50.000.000 facturados donde el archivo fiscal cubrió $1.000.000 descuenta **$173.554 en vez
de ~$8.700.000**, y el resultado del mes queda inflado ~$8,5M. El cartel de aviso solo salta
cuando el IVA es **cero**, nunca cuando es parcial.

**2. Los sueldos del EdR tienen el MISMO patrón todo-o-nada.**
Alcanza **un** pago tildado en RRHH para que se descarte todo el renglón que calculó la base.
Un mes con $9.000.000 de sueldos cargados y un solo empleado tildado por $600.000 muestra
**$600.000** — y se come $8,4M de costo de personal, inflando el EBITDA. Encima las dos
fuentes no son comparables: una guarda el **neto** pagado y la otra el **bruto**.

> 🔍 **Esto es un patrón, no dos casos sueltos.** "Si la base me dio algo, tiro el estimado
> entero" aparece al menos dos veces. Vale la pena buscar si está en más lugares.

**3. La plata de "Mercado Pago Lucas" es venta o es dividendo según por dónde entró.**
Es un retiro del dueño, no venta. Importada de Fudo el ticket queda marcado como dividendo y
el EdR cuenta $0. Cobrada por el punto de venta propio, el mismo cobro cuenta como **$30.000
de venta**. Ese medio de pago está activo y el cajero lo puede usar hoy. No hay cartel ni
diferencia de arqueo: es mudo.

### Costeo y margen

**4. ✔ El mismo plato da dos márgenes en dos pestañas del mismo módulo.**
Una pantalla suma el costo del empaque y la otra no. Un sorrentino de $3.000 de receta con
$450 de empaque: una dice 68,8 % de margen, la otra 64,1 %. Casi cinco puntos.

**5. ✔ El respaldo del 21 % de IVA nunca se dispara.**
La función que lee la configuración devuelve `0` cuando el dato falta, y `0 ?? 0.21` da `0`,
no `0.21`. Si la fila de configuración no está cargada, `neto = precio / 1` y **todos** los
márgenes del menú salen **21 puntos más altos** de lo que son.

**6. La Calculadora de Cocina pide mil veces de más.**
Un renglón de "Subreceta Pomodoro 500 g" con un Pomodoro que rinde 20 kg: la base calcula
2,5 % del lote, la Calculadora calcula **25 lotes**. Además **cruza locales**: si a Saavedra
le falta una subreceta, agarra la de Vedia — que lleva harina de trigo, en un local que es
100 % sin gluten.

**7. La expansión de subrecetas está escrita tres veces** (una en SQL, dos en el frente) y
enganchan **por nombre**, no por identificador. Renombrar una subreceta corta el enganche en
silencio.

### Stock

**8. El stock de congelados de Saavedra mostraba 2.715 porciones cuando la cámara tenía 272.**
Diez veces más. Suma la producción desde siempre y nunca resta lo vendido. Ya tiene un cartel
rojo avisando, **pero el número se sigue calculando igual** y sigue alimentando los
indicadores "OK / bajo mínimo / sin stock" de esa pantalla, que no tienen cartel.

**9. La merma del mostrador se calcula y no se registra.**
Turno con 45 esperados y 33 contados: la tablet muestra "faltan 12", el cierre se guarda con
33, y **las 12 porciones desaparecen sin dejar una sola fila de merma**. La única forma de que
quede anotada es que alguien la cargue a mano.

**10. "Lo esperado en el mostrador" se calcula distinto en la base y en la tablet.**
La base resta la merma, la tablet no. Con 40 contadas, 10 tiradas y 5 vendidas: la base dice
25, la tablet dice 35 — y manda a buscar pasta que no está.

**11. "Vendido" quiere decir dos momentos distintos.**
Para el salón, la base cuenta cuando la comanda **va a la cocina**; la tablet cuenta cuando se
**cobra**. Una mesa que pide a las 21:10 y paga a las 22:40, con conteo a las 22:00, se cuenta
en un día en una pantalla y en otro día en la otra.

**12. Recibir mercadería tiene dos caminos que se pisan.**
Uno lee el stock, le suma y lo escribe; el otro usa una función de la base. Si dos personas
reciben a la vez, el segundo pisa al primero con un número viejo. Y al borrar una entrada
cargada por error, el piso en cero se come el descuadre sin dejar registro.

---

## 6. Qué está en curso y qué está frenado

### El arreglo de la entrada de dinero — a mitad de camino

Hay **49 campos** en el ERP donde una persona escribe un importe. Están agrupados así:

| Grupo | Qué le pasa | Cuántos | Estado |
|---|---|---:|---|
| A | Ya usa el componente correcto | 22 | ✅ hecho |
| C | El punto se lee como coma decimal | 11 | ⛔ **guardan mal HOY** |
| D | Lo interpreta el navegador | 14 | ⛔ pendiente |
| E | Solo dígitos, no acepta centavos | 2 | ⛔ **rompe en las dos puntas** |

Los 27 que faltan **siguen guardando mal en este momento**. Los del grupo C tienen un aviso
provisorio en pantalla que dice *"Escribí el monto sin puntos"*. **Cinco campos más se
descubrieron después y no tienen ni ese aviso.**

⛔ **Está frenado a propósito.** El código del arreglo existe pero no está integrado, porque
falta probarlo en la tablet del local. **No aconsejes migrar campos de dinero hasta que Lucas
diga que se destrabó**, o vas a chocar con trabajo ya hecho.

⛔ **Ningún dato histórico se tocó.** Hay siete consultas de solo lectura preparadas para
revisar si algo quedó mal guardado, y **Lucas las corre él**, de a una. No aconsejes correr
nada masivo contra la base.

### Un bug distinto y más grave: costos que se guardan en CERO

En Compras, el campo del costo unitario deja el valor en **cero** si alguien escribe un
importe con puntos, **sin un solo cartel**. Un cero no llama la atención —parece "todavía no
lo cargué"— y el costo del insumo entra en el costeo de **cada receta que lo usa**. No rompe
nada: hace que la receta parezca más rentable de lo que es.

---

## 7. Qué NO aconsejar

1. **No unifiques las dos reglas del punto.** Ver la sección 2.
2. **No migres campos de dinero.** Está frenado y hay trabajo hecho sin integrar.
3. **No corras nada masivo contra la base**, ni siquiera un arreglo que parezca obvio. Un
   `UPDATE` masivo sobre datos que todavía no se revisaron es irreversible.
4. **No renombres funciones que parecen duplicadas** sin confirmar cuál de los dos
   significados tiene cada una.
5. **No supongas que porque una migración está escrita, está aplicada.** Ya pasó que una
   estuvo escrita meses sin aplicarse. Y las restricciones tipo CHECK **no se pueden
   verificar** desde los archivos: la foto del esquema no las exporta.
6. **No des por muerta una función porque nadie la llama.** La de facturación de ARCA está
   terminada y esperando un certificado; otra la llama Microsoft, no nuestro código.

---

## 8. Si necesitás más detalle

Lucas tiene estos documentos y te los puede pasar. **Pedile el que corresponda al tema, no
todos** — el primero solo pesa 200 KB.

| Documento | Qué tiene | Cuándo pedirlo |
|---|---|---|
| `CONTEXTO-DATOS.md` | Las 93 tablas con columnas y tipos, las 56 funciones, las 32 duplicaciones enteras | Si tocás la base o querés el detalle de una contradicción |
| `TRASPASO-MONTOS.md` | La entrada de dinero completa, con una ZONA ROJA de lo que no se toca | Si tocás algo de plata |
| `INVENTARIO-MONTOS.md` | Los 49 campos, uno por uno, con archivo y línea | Si vas a migrar campos |
| `AUDITORIA.md` | Auditoría de arquitectura: archivos gigantes, acoplamiento, duplicados | Si vas a reorganizar código |
| `CHECKLIST-MONTOS.md` | 9 pruebas manuales escritas para alguien que no programa | Si hay que probar algo en el local |
| `diagnostico-montos.sql` | 7 consultas de solo lectura sobre datos históricos | Nunca las ejecutes vos |

**Y lo más importante que le podés pedir a Lucas: que te diga en qué parte del sistema estás
trabajando.** Las reglas de negocio de este proyecto —precios, márgenes, qué suma y qué pisa—
no se deducen del código. Varias están aplicadas a medias, y la mitad de las contradicciones
de la sección 5 son decisiones suyas que se implementaron distinto en dos lugares.
