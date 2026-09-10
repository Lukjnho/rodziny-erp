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

Se relevaron **41 inputs de dinero** en todo el ERP y se agruparon por cómo leen
lo que se teclea. **La tanda 1 cerró el grupo B. Faltan C, D y E.**

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

⚠️ **Los cuatro paneles de RRHH no tienen ningún control**: guardan lo que sea.
**`RetirosSinClasificar` sí tiene guardarraíl** (ver punto 3, caso *a*).

### ⛔ PENDIENTE — Grupo D (9 inputs): `type="number"`, lo decide el navegador

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

### ⛔ PENDIENTE — Grupo E (2 inputs): solo dígitos, **no acepta centavos**

`src/modules/rrhh/SueldosTab.tsx` líneas **1706** y **1722** (monto en efectivo y
por transferencia). Usan `replace(/\D/g, '')` (funciones en 1656 y 1661), que
borra todo lo que no sea número: `15.000` funciona bien, pero **`152350,50` se
convierte en 15.235.050**.

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

### Paso 2 — Grupo C (10 inputs)

**Por qué antes que D y E:** es el único grupo que **hoy está escribiendo datos
mal**, con certeza y sin control. Los cuatro paneles de sueldo llevan cinco
meses así. D depende del navegador (puede estar funcionando bien) y E solo falla
con centavos.

⚠️ **Al migrar el grupo C hay una trampa:** cuatro sitios cargan un valor de la
base al input con `String(...)` y **hoy funcionan de casualidad**, porque
`String(152350.5)` produce un punto decimal y la regla vigente lee el punto como
decimal. **En cuanto des vuelta la regla, se rompen.** Van en el mismo commit:

- `caja/RetirosSinClasificar.tsx:231-232`
- `gastos/NuevoGastoForm.tsx:2430, 2566`
- `gastos/NuevoGastoModal.tsx:1220`
- `gastos/NuevoGastoModal.tsx:364, 381`

Usá `montoDesdeBase()` para esos, nunca el parser de tipeo.

### Paso 3 — Grupo D (9 inputs)

**Por qué después:** el daño es incierto (depende del navegador), pero incluye la
caja y el cobro de mesas, así que no puede quedar sin hacer. Al migrarlos el ERP
deja de depender de cómo esté configurada cada tablet.

### Paso 4 — Grupo E (2 inputs) y limpieza final

Migrar los dos de `SueldosTab` conservando el autocompletado entre efectivo y
transferencia. Recién ahí:

- Renombrar `parseDecimal` → algo que diga "cantidad", y documentar la regla en
  `lib/numero.ts`.
- Evaluar si `EditarLoteModal` usa el compartido.

### Paso 5 — Corregir los datos históricos, si el dueño lo decide

Uno por uno, contra el papel. **Nunca un `UPDATE` masivo.** Cada consulta trae
una columna `valor_si_fuera_el_bug` que es una *sugerencia*, no una certeza: un
adelanto de $500 puede ser un adelanto de $500 de verdad.

---

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

- **`CLAUDE.md`** — la regla de entrada de plata, ya escrita ahí.
- **`docs/diagnostico-montos.sql`** — las seis consultas, comentadas.
- **`docs/AUDITORIA.md`** — la auditoría de arquitectura completa del 10-sep, de
  donde salió todo esto. Tiene otros problemas abiertos que **no** son de montos:
  las tres definiciones de "hoy", los tres umbrales distintos de margen, y las
  158 escrituras a la base que no cuentan las filas que tocaron.
