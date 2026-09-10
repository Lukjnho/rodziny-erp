# Traspaso — unificación de la entrada de montos

**Fecha:** 10-sep-2026 · **Rama:** `fix/entrada-montos` (11 commits, sin mergear)
**Para:** quien siga este trabajo, sin haber estado en las conversaciones previas.

> Este documento se explica solo. No hace falta leer nada más para continuar,
> pero **sí hace falta leer esto antes de tocar cualquier campo de plata**.
>
> Hay **dos personas/IAs trabajando sobre el mismo repositorio**. La mitad de
> este documento existe para que no deshagas algo que parece un error y no lo es.

---

## 0. El problema, en sesenta segundos

En este ERP el punto (`.`) significaba **dos cosas opuestas** según la pantalla:

- **Separador de miles** → `15.000` es quince mil pesos. *(regla correcta)*
- **Coma decimal** → `15.000` es quince. *(regla equivocada para plata)*

Las dos convivían. El cajero que escribía `15.000` en una pantalla repartía
**$15** y en otra **$15.000**.

Además había un segundo daño, distinto y **opuesto**: un valor que ya estaba
guardado en la base (por ejemplo `2350.50`) se convertía a texto y se volvía a
leer con el parser de tipeo, que le borra el punto → `23505`. **Diez veces más
grande.** Solo pasaba con montos que tenían centavos.

**La regla, decidida por el dueño (Lucas) el 10-sep-2026:**
👉 **el punto es SEPARADOR DE MILES. Punto final.**
Vale **solo para dinero**. Las cantidades de cocina (kilos, porciones) usan la
regla contraria **a propósito** — ver la Zona Roja.

### Las tres piezas que hay que conocer

Todo vive en **`src/lib/monto.ts`**. Son tres caminos con nombre propio y
**nunca se mezclan**:

| Camino | Función | Qué significa el punto ahí |
|---|---|---|
| base → app | `montoDesdeBase()` | **decimal** (así lo manda Postgres) |
| número → pantalla | `montoADisplay()` | — |
| **tipeo** → número | `montoDesdeTipeo()` | **miles** (así escribe la gente) |

Y **`src/components/ui/MontoInput.tsx`** es el único componente que se usa para
escribir plata. Recibe y devuelve `number | null`, nunca texto.

    import { MontoInput } from '@/components/ui/MontoInput';
    <MontoInput value={monto} onChange={setMonto} />

`null` significa "no cargó nada", que **no es lo mismo que cero** (un arqueo de
caja en cero es un cierre válido).

---

## 1. Qué se migró y qué queda

> ## 📋 La lista completa está en `docs/INVENTARIO-MONTOS.md`
>
> **Son 49 campos, no 41.** Ese documento tiene la lista cerrada, campo por campo,
> con archivo y línea. Se armó barriendo las 444 apariciones de `<input>`,
> `<textarea>` y `<MontoInput>` de `src/`, con verificación adversarial.
>
> **Leelo antes de migrar nada.** Acá abajo está el resumen y el plan; ahí está el
> detalle y tres advertencias que no se ven en este resumen.

Los 49 campos se agrupan por cómo leen lo que se teclea.
**La tanda 1 cerró el grupo B. Faltan C, D y E.**

### ✅ TANDA 1 — HECHO (grupo B: 17 inputs)

Eran los que ya usaban la regla correcta pero con el parser copiado a mano en
cada archivo. Se migraron a `MontoInput` y su estado pasó de texto a
`number | null`. **Sin cambio de comportamiento.**

| Archivo | Inputs | Qué se eliminó de paso |
|---|---:|---|
| `src/modules/finanzas/components/CierreCaja.tsx` | 11 | **5 copias** del mismo parser |
| `src/modules/gastos/NuevoGastoForm.tsx` | 2 | `parseNumeroAR` |
| `src/modules/gastos/PagarGastoModal.tsx` | 2 | `parseNumeroAR` + `formatNumeroAR` |
| `src/modules/finanzas/components/FlujoCaja.tsx` | 1 | parser inline del dividendo |
| `src/modules/productos/components/MenuTab.tsx` | 1 | parser inline del precio |

Ya usaban `MontoInput` desde antes y no se tocaron: `ChecklistPagos.tsx` (2) y
`NuevoGastoModal.tsx` (los campos de importe).

**Hoy queda UN SOLO parser de tipeo en todo el proyecto**, en `lib/monto.ts`.

#### Tres decisiones de la tanda 1 que no son obvias

1. **El botón "Guardar cierre" ahora compara `fContado == null`, no `!fContado`.**
   Con texto, un `"0"` pasaba el chequeo; con número, `!0` es verdadero y el cero
   habría bloqueado el botón. Un arqueo en cero es válido. **No lo "simplifiques"
   de vuelta a `!fContado`.**
2. **`MontoInput` aprendió Enter y Escape.** MenuTab los tenía y los iba a perder.
   Enter confirma, Escape revierte sin guardar.
3. **Se migró un input que no estaba en el encargo original**: el descuento de
   `PagarGastoModal`. Es del mismo grupo y usaba el mismo parser que había que
   borrar; dejarlo afuera obligaba a conservar la copia.

### ⛔ PENDIENTE — Grupo C (10 inputs): la regla contraria, **y siguen rotos hoy**

Interpretan el punto como coma decimal ⇒ **los montos se guardan mil veces más
chicos**. Es el grupo que más daño hace y el que hay que atacar primero.

| Archivo | Input (línea) | Dónde parsea |
|---|---|---|
| `src/modules/rrhh/sueldos/PanelAdelantos.tsx` | 153 | `parseFloat(monto.replace(',', '.'))` en 75 |
| `src/modules/rrhh/sueldos/PanelBonos.tsx` | 99 | 32 |
| `src/modules/rrhh/sueldos/PanelDescuentos.tsx` | 95 | 24 |
| `src/modules/rrhh/sueldos/PanelSanciones.tsx` | 91 | 24 |
| `src/modules/finanzas/components/FlujoCaja.tsx` | 1500 (`saldoMPInput`) | `parseDecimal` en 640 |
| `src/modules/caja/RetirosSinClasificar.tsx` | 291, 307 | `parseDecimal` en 196-197 |
| `src/modules/gastos/NuevoGastoForm.tsx` | 2430, 2566 (subtotal de ítem) | `parseFloat(valor.replace(',', '.'))` en 669 |
| `src/modules/gastos/NuevoGastoModal.tsx` | 1220 (subtotal de ítem) | 508 |
| `src/modules/rrhh/sueldos/SeccionImpuestos.tsx` | **156** (monto a pagar ARCA) | `parseFloat(...replace(',', '.'))` en el `onBlur`, 158 |

⚠️ **Los cuatro paneles de RRHH no tienen ningún control**: guardan lo que sea.
**`RetirosSinClasificar` sí tiene guardarraíl** (ver punto 3, caso *a*).

> 🔎 **`SeccionImpuestos` apareció después, y vale la pena saber cómo.** El
> relevamiento manual buscaba `value={...}` y ese campo usa `defaultValue={...}`,
> así que se escapó. Lo encontró **la regla de ESLint** (ver más abajo) la
> primera vez que se corrió. Son **11 inputs en el grupo C, no 10**.
> Todavía no tiene el aviso provisorio en pantalla que sí tienen los otros diez.

### ⛔ PENDIENTE — Grupo D (14 inputs): `type="number"`, lo decide el navegador

No hay regla nuestra: **la interpretación depende del navegador y del idioma del
aparato**. La tablet del salón y la computadora de administración pueden leer
`15.000` distinto y el código no lo controla.

| Archivo | Línea | Qué es |
|---|---:|---|
| `src/modules/caja/CajaPage.tsx` | 481 | Fondo inicial del turno |
| `src/modules/caja/CajaPage.tsx` | **1556** | **El monto que se cobra** |
| `src/modules/caja/CajaPage.tsx` | 1759 | Retiro para cambio |
| `src/modules/caja/CajaPage.tsx` | 1770 | Retiro para pagos |
| `src/modules/caja/CajaPage.tsx` | **1813** | **El arqueo, medio por medio** |
| `src/modules/salon/MesasMostradorPage.tsx` | **248** | **El cobro de la mesa** |
| `src/modules/rrhh/RRHHPage.tsx` | 1207 | Sueldo base del legajo |
| `src/modules/rrhh/AguinaldoTab.tsx` | 726 | Monto real pagado del aguinaldo |
| `src/modules/finanzas/components/ProyeccionFlujo.tsx` | 474 | Monto proyectado |

Los tres en negrita son los de mayor exposición: son la caja y el cobro.

**Faltan 5 en esa tabla** que aparecieron en el barrido completo —dos costos
unitarios, un redondeo y los dos saldos iniciales de la proyección—: están en
`docs/INVENTARIO-MONTOS.md`.

> 💣 **Tres de los 14 no son solo D: tienen un parser del grupo C adentro.**
> `compras/ComprasPage.tsx:4386`, `productos/InsumosTab.tsx:188` y
> `productos/ConfiguracionTab.tsx:240`. **Cambiar solo el `type="number"` deja el
> parser roto.** Hay que cambiar los dos. El de Compras además guarda **cero en
> silencio** si lo tipeado no es un número válido.

### ⛔ PENDIENTE — Grupo E (2 inputs): solo dígitos, **no acepta centavos**

`src/modules/rrhh/SueldosTab.tsx` líneas **1706** y **1722** (monto en efectivo y
por transferencia). Usan `replace(/\D/g, '')` (funciones en 1656 y 1661), que
borra todo lo que no sea número: `15.000` funciona bien, pero **`152350,50` se
convierte en 15.235.050**.

⚠️ **Y es peor que "no acepta centavos": también rompe al recargar.** En las
líneas **1232, 1236, 1270 y 1274** el valor ya guardado se mete al campo con
`String(fila.montoEfectivoPagado)`. Si ese monto tiene centavos, `String()`
produce `"152350.5"`, el campo le borra el punto y queda **1.523.505** — el
mismo bug de 10x que tenían el precio de la carta y los campos de Fudo. Esto lo
detectó la regla de ESLint; el relevamiento manual solo había visto la parte de
"no se pueden tipear centavos".

💥 **Y todavía peor: no hace falta reabrir un pago viejo.** La sugerencia 50/50
del modal (`SueldosTab.tsx:1223-1224` y `1261-1262`) redondea `mitad` pero deja
los centavos de la quincena en `otra`. Si el sueldo neto es impar, la quincena
termina en `,50` y el campo **muestra 1.750.005 la primera vez que se abre**,
sin que nadie haya tocado nada.

Ojo al migrarlos: los dos campos se autocompletan entre sí (efectivo =
total − transferencia). Esa lógica hay que conservarla.

---

## 2. 🔴 ZONA ROJA — lo que NO se toca

### 🔴 `parseDecimal` y `normalizarDecimal` siguen vivos A PROPÓSITO

Están en `src/lib/numero.ts` y usan **la regla contraria** (punto = coma
decimal). **Eso está bien.** Tienen dos usos completamente distintos:

**Uso 1 — cantidades de cocina y compras (119 usos). NO TOCAR NUNCA.**

| Archivo | Usos |
|---|---:|
| `src/modules/cocina/ProduccionQRPage.tsx` | 86 |
| `src/modules/compras/ComprasPage.tsx` | 8 |
| `src/modules/compras/components/DepositoForm.tsx` | 7 |
| `src/modules/cocina/components/IngredientesGrilla.tsx` | 5 |
| `src/modules/cocina/MostradorPage.tsx` | 5 |
| `src/modules/compras/RecepcionPage.tsx` | 4 |
| `src/modules/cocina/CalculadoraTab.tsx` | 4 |

> 💣 **Por qué es correcto acá y no en plata.** El operario de la fábrica carga
> kilos en una tablet: escribe `8,9` o `8.9` para ocho kilos novecientos, y
> algunos teclados Android solo ofrecen el punto. `normalizarDecimal` convierte
> todo punto en coma mientras se escribe, justamente para que nadie cargue
> `25.000` y termine produciendo veinticinco mil kilos de pasta.
>
> **Si "unificás" esto con la regla de miles, rompés la carga de producción
> entera** — y peor: no va a fallar, va a guardar números absurdos en silencio.

**Uso 2 — los 10 inputs del grupo C, que sí hay que migrar** (lista arriba).
Son 8 usos: `RetirosSinClasificar.tsx` (5) y `FlujoCaja.tsx` (3, uno es el
import).

**Recién cuando el grupo C esté migrado**, `parseDecimal` queda usado *solo*
para cantidades y ahí sí conviene renombrarlo a algo que lo diga
(`parseCantidad`, por ejemplo) y documentar la regla arriba del archivo. **Antes
de eso, no.**

### 🔴 Otras cosas que parecen inconsistentes y son deliberadas

**`cocina/components/EditarLoteModal.tsx:48` tiene su propio `parseDecimal`
local** (8 usos). No importa el de `lib/numero.ts`. Es cantidad, no plata.
Consolidarlo con el compartido es cosmético y de bajo riesgo, pero **no es parte
de este trabajo** y no cambia ningún comportamiento.

**`FlujoCaja.tsx` importa `parseDecimal` Y usa `MontoInput` al mismo tiempo.**
No es un descuido: el dividendo ya se migró (grupo B) y el saldo de Mercado Pago
todavía no (grupo C). Hay un comentario en el import que lo explica. **No saques
ese import hasta migrar el saldo de MP.**

**`NuevoGastoForm.tsx` conserva `formatNumeroAR`** aunque se borró su gemelo
`parseNumeroAR`. Sobrevive porque lo usan tres lugares que **muestran** plata
(el neto, el IVA y el cartel del OCR), que no son campos de entrada.

**`hoyAR()` de `src/lib/fechaAR.ts` no es "hoy en Argentina"**, es el día
operativo de cocina: entre las 00:00 y las 04:59 devuelve *el día anterior*.
Finanzas tiene su propio `hoy()` a propósito. No los unifiques sin hablarlo:
está documentado en `docs/AUDITORIA.md` y es un problema abierto **distinto** de
éste.

**El comentario `impeccable-disable-next-line gray-on-color` en
`CierreCaja.tsx`** es un falso positivo verificado del detector de diseño (cruza
el color base del texto con el fondo del hover). No lo saques.

### 🔴 Regla del proyecto que aplica a todo esto

Está en `CLAUDE.md` y es la que más veces mordió: **un `UPDATE` o `DELETE` que
la RLS bloquea devuelve 0 filas y NINGÚN error.** Compila, corre, no falla y no
hace nada. Toda escritura tiene que contar las filas que tocó y avisar si fueron
cero. Hoy se cumple en el **16%** de los casos (medido: 29 de 187).

---

## 2 bis. 🧭 El problema de fondo es el vocabulario

**Ninguno de estos bugs es un bug de tipeo.** Todos tienen la misma forma: *una
palabra que significa dos cosas, y ningún lugar del código que diga cuál de las
dos.* El punto en `15.000` no está mal escrito — está esperando que alguien
decida si esa pantalla habla el idioma de la plata o el de los kilos. Arreglar
`MontoInput` no arregla eso; solo le pone un cartel a un campo por vez.

### El caso que nos costó tres campos: `costo`

El barrido manual dio 41 campos y después 49. Los tres que faltaban se llaman
`costo`. Se escaparon porque yo había sacado esa palabra del vocabulario de
plata del `eslint.config.js`, con este comentario escrito de mi puño:

> *"Deliberadamente NO incluye `total`, `cantidad`, `costo` ni `valor`: en
> Cocina esos son kilos, y la regla del punto es la contraria."*

**Esa frase es falsa para `costo`, y lo medí.** En Cocina `costo` es plata
igual que en Compras: `costoPorKg`, `costoPorPorcion`, `costoBase` — todos
pesos. Lo que pasa es que en Cocina el costo se **calcula** y nadie lo tipea,
así que nunca aparece como campo de entrada. De ahí salió la impresión de que
"en Cocina costo son kilos". No lo es. Me equivoqué yo, escribiendo el
vocabulario.

Lo medido, agregando cada palabra excluida a la regla de ESLint y contando los
avisos (base sin ninguna: **10 avisos**):

| Palabra excluida | Avisos | Contra la base | ¿El aviso extra era plata? |
|---|---:|---:|---|
| `costo` | 11 | **+1** | ✅ **SÍ** — `InsumosTab.tsx:206`, uno de los tres perdidos |
| `valor` | 11 | +1 | ❌ no — `cocina/DashboardTab.tsx:1432`, es un conteo de stock |
| `cantidad` | 16 | +6 | ❌ no |
| `total` | 23 | +13 | ❌ no |

Tres de las cuatro exclusiones estaban bien. **La única que estaba mal es
justo la que tapó los tres campos.** Y no costaba nada: sumar `costo` trae un
hallazgo real y cero ruido. Ya está corregido en `eslint.config.js`.

> 💣 **La lección, que es la parte que importa:** *el filtro que evita ruido en
> un módulo tapa hallazgos en otro.* Cualquier lista de palabras que separe
> "plata" de "no plata" va a fallar en los bordes, porque los bordes son
> exactamente donde las dos reglas se tocan. Un vocabulario compartido no es
> documentación: es la herramienta de detección.

### No es un caso aislado: es el patrón del ERP

Las mismas palabras significan cosas distintas según el barrio, y en los cuatro
casos el compilador no dice nada porque los dos significados tienen el mismo
tipo:

| Palabra | Significado A | Significado B | Qué pasa si los mezclás |
|---|---|---|---|
| **el punto** en un número | separador de **miles** (plata) | **coma decimal** (kg, porciones) | ×1000 o ÷1000, en silencio — *es este documento entero* |
| **`costo`** | plata que alguien **tipea** (Compras, Insumos) | plata que el sistema **calcula** (Cocina) | se excluyó del vocabulario y tapó 3 campos |
| **`hoy`** | `hoyAR()` = el **día operativo** de cocina: de 00:00 a 04:59 devuelve *ayer* | `hoy()` de Finanzas = el día del calendario | los cierres nocturnos caen en el día equivocado |
| **`margen`** | fracción (`0,62`) en `MenuTab` y `useMenuEngineering` | escala 0-100 (`62`) en `useCostoPorFudo` | ×100 — y TypeScript no avisa: las dos son `number` |

Y hay un quinto que es el mismo problema sin la palabra: **"margen bueno" está
definido tres veces con tres umbrales distintos** (`cfg.margen_min` de la base,
0,50/0,65 en `MenuTab`, 40/60 en `FudoLiveTab`). Un plato al 62 % sale verde en
una pantalla y ámbar en otra, al mismo tiempo y con el mismo dato. Está en
`docs/AUDITORIA.md`, hallazgos 5 y 6.

### Qué hacer con esto (no ahora)

**Esto no es tarea de la tanda 2.** La tanda 2 sigue siendo migrar campos. Pero
cuando se abra el trabajo de vocabulario compartido, **el punto de partida es
esta tabla**, y el orden que sugiero es:

1. **Escribir el vocabulario antes que el código.** Una lista corta de palabras
   con UN significado cada una, decidida con Lucas, no deducida del código.
2. **Que la lista sea ejecutable.** El `eslint.config.js` de este trabajo es la
   prueba de concepto: un vocabulario que no se puede correr no se cumple.
   Cubre hoy la mitad de los 49 campos — es una red, no una garantía.
3. **Renombrar en el código lo que quede ambiguo**, empezando por `parseDecimal`
   → `parseCantidad` (ver la ZONA ROJA: recién se puede después del grupo C).

⚠️ **Lo que NO hay que hacer es "unificar" para que quede prolijo.** Las dos
reglas del punto son las dos correctas, cada una en su mundo. El problema no es
que haya dos: es que nada en el código dice en cuál de los dos estás parado.

---

## 3. Estado de los seis casos de diagnóstico

Las consultas están en **`docs/diagnostico-montos.sql`**, con el rango de fechas
y el commit que originó cada bug.

> ### ⛔ NINGÚN DATO HISTÓRICO FUE MODIFICADO
> No se ejecutó ni una sola de las seis consultas. No se corrió ningún `UPDATE`.
> Todo lo que se arregló hasta ahora es **código**, no datos.
> **El dueño tiene que revisar los resultados a mano antes de tocar nada**, y esa
> revisión todavía no pasó.

| Caso | Qué busca | Código | Datos |
|---|---|---|---|
| **(a)** Retiros de caja | montos mil veces más chicos | ⛔ abierto (grupo C) | sin revisar |
| **(b)** Adelantos, bonos, descuentos, sanciones | ídem | ⛔ abierto (grupo C) | sin revisar |
| **(c)** Saldo de Mercado Pago | ídem | ⛔ abierto (grupo C) | sin revisar |
| **(d)** Subtotales de ítems de factura | ídem | ⛔ abierto (grupo C) | sin revisar |
| **(e)** Precio de la carta | 10x/100x más grande | ✅ corregido (`8f3139b`) | sin revisar |
| **(f)** Campos de Fudo del cierre | 10x/100x más grande | ✅ corregido (`dbee13b`) | sin revisar |

**Notas por caso, importantes al leer los resultados:**

- **(a) esperamos que dé vacío, y eso no es un error.** Esa pantalla exige que
  cambio + pagos den igual al total ya retirado y **deshabilita el botón** si no
  cuadra (`RetirosSinClasificar.tsx:200` y `:332`). El bug está en el código pero
  el guardarraíl le tapó la salida. **Si aparecen filas, salieron por otro camino
  y hay que averiguar cuál.**
- **(b) es el más expuesto de todos.** Los cuatro paneles guardan sin ningún
  control desde el 11-abr-2026. Casi cinco meses.
- **(e) era el más traicionero**: el precio se guardaba **al salir del campo**,
  sin escribir nada. Alcanzaba con hacer clic en un precio con centavos y clic
  afuera. Solo afectaba precios con centavos; los redondos nunca corrieron riesgo.
- **(f)** los campos de Fudo son los más expuestos al bug de 10x porque casi
  siempre traen centavos. Se disparaba al **reabrir** un cierre guardado.

---

## 4. En qué orden seguir, y por qué

### Paso 1 — Que el dueño revise el diagnóstico *(bloquea todo lo demás)*

Correr las seis consultas de `docs/diagnostico-montos.sql` y mirar los
resultados. **Ninguna corrección de datos hasta que esa revisión pase.**

**Por qué primero:** los grupos C y D siguen rotos, así que **hoy se siguen
generando datos malos**. Cuanto más tarde la revisión, más filas hay que revisar
después. Y saber cuánto daño real hubo cambia la urgencia del resto.

### Paso 2 — Grupo C (11 inputs)

**Por qué primero:** es el grupo que **hoy escribe datos mal con certeza y sin
control**. Los cuatro paneles de sueldo llevan cinco meses así, y uno de los
campos es el monto a pagar de ARCA.

⚠️ **Al migrar el grupo C hay una trampa:** cuatro sitios cargan un valor de la
base al input con `String(...)` y **hoy funcionan de casualidad**, porque
`String(152350.5)` produce un punto decimal y la regla vigente lee el punto como
decimal. **En cuanto des vuelta la regla, se rompen.** Van en el mismo commit:

- `caja/RetirosSinClasificar.tsx:231-232`
- `gastos/NuevoGastoForm.tsx:2430, 2566`
- `gastos/NuevoGastoModal.tsx:1220`
- `gastos/NuevoGastoModal.tsx:364, 381`

Usá `montoDesdeBase()` para esos, nunca el parser de tipeo.

### Paso 3 — Grupo E (2 inputs) ⬆️ *subió de prioridad*

**Estaba último y pasó a tercero.** El motivo: hasta ahora figuraba como "no
acepta centavos", que suena a incomodidad. Al revisarlo con la regla de ESLint
apareció lo otro: **también rompe al recargar**, con el mismo bug de 10x que ya
se corrigió en el precio de la carta y en el cierre de caja
(`SueldosTab.tsx:1232, 1236, 1270, 1274`).

Sube por encima del grupo D por tres razones:

1. **Es un bug confirmado**, no una dependencia del navegador como el grupo D.
2. **Está en la liquidación de sueldos**: el monto en efectivo y el monto por
   transferencia que se le paga a cada persona.
3. **Son solo 2 campos.** Mucho menos trabajo que los 9 del grupo D, y con más
   daño evitado por hora de trabajo.

Migrarlos conservando el autocompletado entre los dos campos (efectivo =
total − transferencia).

### Paso 4 — Grupo D (14 inputs)

**Por qué queda para el final de la migración:** el daño es **incierto** — puede
estar funcionando bien según el navegador y el idioma del aparato. Pero incluye
la caja, el arqueo y el cobro de mesas, así que no puede quedar sin hacer: al
migrarlos, el ERP deja de depender de cómo esté configurada cada tablet.

### Paso 5 — Limpieza final

Recién cuando C, D y E estén migrados:

- Renombrar `parseDecimal` → algo que diga "cantidad", y documentar la regla en
  `lib/numero.ts`.
- Evaluar si `EditarLoteModal` usa el compartido.
- Borrar los avisos provisorios: `grep -rn "MITIGACION-MONTOS" src`.
- Pasar la regla de ESLint de `warn` a `error`.

### Paso 6 — Corregir los datos históricos, si el dueño lo decide

Uno por uno, contra el papel. **Nunca un `UPDATE` masivo.** Cada consulta trae
una columna `valor_si_fuera_el_bug` que es una *sugerencia*, no una certeza: un
adelanto de $500 puede ser un adelanto de $500 de verdad.

---

## Dos redes de seguridad que ya están puestas

### 1. El aviso provisorio en pantalla

Debajo de los **11 campos del grupo C** dice **"Escribí el monto sin puntos.
Ejemplo: 150000"**. Es texto, no toca el parseo. Existe solo para frenar el daño
mientras la migración está pendiente.

Son 9 avisos para 11 campos: en *Retiros sin clasificar* los dos campos están uno
al lado del otro y comparten la línea, y en las dos tablas de ítems el subtotal se
repite por renglón, así que el aviso va una vez arriba de la tabla.

**Se borra cuando cada campo pase a `MontoInput`.** Están todos marcados:

    grep -rn "MITIGACION-MONTOS" src

### 2. La regla de ESLint

En `eslint.config.js` hay una regla que avisa cuando un campo de plata se
convierte a texto con `String(...)` o `.toString()` — sea para meterlo en un
input (`value={...}`) o para guardarlo en el estado (`setAlgo(String(monto))`).
Esa segunda forma es la que rompió el cierre de caja.

Hoy tira **10 avisos, todos reales**: son exactamente los sitios del grupo C y E
que faltan migrar. **A medida que la tanda 2 avance, el número tiene que bajar a
cero.** Cuando llegue a cero, conviene pasarla de `warn` a `error`.

**Lo que la regla NO puede detectar** (para que nadie confíe de más):

- Un monto guardado en una variable con nombre neutro. El bug original de
  `MenuTab` era `String(valor)` — "valor" no está en el vocabulario de plata y
  no hay forma de saber que era un precio sin información de tipos, que este
  proyecto no tiene configurada en ESLint.
- Un monto que pasa por una función intermedia antes de convertirse a texto.

O sea: **la regla es una red, no una garantía.** La garantía es usar
`MontoInput` siempre.

## Cómo verificar que no rompiste nada

    npm run build    # tsc -b && vite build
    npm test         # vitest run — 27 casos sobre lib/monto.ts

Los tests están en `src/lib/monto.test.ts`. Incluyen el ciclo completo
base → pantalla → guardado, los 6 campos de Fudo con centavos, y **un test que
reproduce el bug viejo a propósito**: si alguien vuelve a juntar el camino de la
base con el del tipeo, ese test se pone rojo.

Antes de esta tanda el proyecto **no tenía ningún test ni framework**. Se agregó
`vitest` como dependencia de desarrollo. La idea no es cubrir todo: se agrega un
test cuando un bug **costó plata**, para que no vuelva.

## Los commits de la tanda 1

    a6a8d94  feat(montos)     una sola puerta para escribir plata  ← lib/monto.ts
    dbee13b  fix(cierre-caja) deja de reparsear lo que ya es numero
    e14a3ff  fix(gastos)      MontoInput + se van las copias del parser
    e1994a1  fix(finanzas)    el monto del dividendo usa MontoInput
    8f3139b  fix(productos)   el precio de la carta deja de multiplicarse por 10
    e2e34dc  test(montos)     el ciclo completo numero -> pantalla -> numero
    9ed4de6  docs(montos)     la regla queda escrita en CLAUDE.md
    789d020  docs(montos)     las consultas de diagnostico historico
    d593353  docs(auditoria)  el informe de arquitectura del 10-sep
    2cd4291  chore(diseno)    falso positivo de gray-on-color
    6741e42  refactor(diseno) anclar ese falso positivo al codigo

## Para leer más

- **`docs/INVENTARIO-MONTOS.md`** — **la lista cerrada de los 49 campos**, con las
  tres advertencias que hay que leer antes de migrar. Es el documento que dice
  QUÉ tocar; éste dice CÓMO y en qué orden.
- **`docs/CHECKLIST-MONTOS.md`** — las 7 pruebas manuales antes de mergear.
- **`CLAUDE.md`** — la regla de entrada de plata, ya escrita ahí.
- **`docs/diagnostico-montos.sql`** — las seis consultas, comentadas.
- **`docs/AUDITORIA.md`** — la auditoría de arquitectura completa del 10-sep, de
  donde salió todo esto. Tiene otros problemas abiertos que **no** son de montos:
  las tres definiciones de "hoy", los tres umbrales distintos de margen, y las
  158 escrituras a la base que no cuentan las filas que tocaron.
