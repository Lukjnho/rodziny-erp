# Sin gluten como dato del producto — plan

**10-sep-2026.** Decidido: *"sin gluten" deja de ser una propiedad del **local** y pasa a ser
un **dato del producto**, con una validación que impida que algo con TACC entre a una
ubicación de un local sin gluten.* Y va **antes** del ledger.

> Esto es el plan. **No creé la columna, no escribí la migración y no toqué un dato.**

---

## Por qué va antes del ledger, y no después

Hoy la única garantía de que un celíaco no coma gluten en Saavedra es que **nada cruza entre
locales**. No hay una regla escrita: hay una separación física que el sistema refleja por
casualidad, porque cada producto está cargado en un local y ahí se queda.

**El ledger mueve mercadería entre ubicaciones por diseño.** Es literalmente su tipo
`transferencia`. El día que exista, la separación física deja de ser una garantía
automática: va a haber una pantalla que permita mover cosas, y nada que sepa que esa cosa
no puede ir ahí.

Construir el ledger primero sería **quitar la baranda antes de poner el pasamanos.**

---

## Lo que hay hoy

**Nada.** Cero columnas en las 93 tablas mencionan gluten, TACC, alérgeno, celíaco o apto.

Lo único que existe son **nombres**: 7 insumos, 32 recetas y 23 productos de cocina tienen
"SG", "sin gluten" o "TACC" escrito en el nombre. Es una convención de tipeo.

### 💣 Y por nombre no se puede resolver. Estas dos filas lo prueban

| Producto | Local | ¿Tiene gluten? | ¿El nombre lo dice? |
|---|---|---|---|
| **Harina de Trigo Sarraceno** | Saavedra | **No** (el alforfón no es trigo) | Dice "trigo" → un filtro por nombre lo marcaría mal, **para el lado seguro** |
| **Harina de fuerza** | Vedia | **Sí, es trigo puro** | No dice "trigo" → un filtro por nombre **lo dejaría pasar** |

El segundo caso es el que importa: **el nombre falla también para el lado peligroso.**
Cualquier plan que empiece por "busquemos 'trigo' en el nombre" nace roto.

---

## La foto de los datos

| | Vedia | Saavedra | Total |
|---|---:|---:|---:|
| Productos | 318 | 262 | **580** |
| Activos | 187 | 206 | **393** |
| Con señal en el nombre | 0 | 7 | 7 |

Y el cruce, que es lo que decide el plan:

| Situación | Nombres distintos | Con alguno activo |
|---|---:|---:|
| Existe **solo en Vedia** | 201 | 107 |
| Existe **solo en Saavedra** | 146 | 115 |
| **Existe en los DOS locales** | **116** | **96** |

> 🔑 **Los 116 que están en los dos locales son el corazón del problema.** Para ellos el
> local no puede ser el discriminador: el mismo nombre está de los dos lados. Y no
> necesariamente son el mismo producto — pueden ser dos marcas o dos formulaciones
> distintas cargadas con el mismo nombre.

### La buena noticia: el conjunto riesgoso es chico

De los 393 productos activos, la enorme mayoría son productos de limpieza (59), descartables
(37), empaque (41) y bebidas (50): **no entran en ninguna receta y el gluten no está en
discusión.** Las categorías donde de verdad se juega algo:

| Categoría | Vedia | Saavedra |
|---|---:|---:|
| **Harinas y huevos** | 5 | 7 |
| **Ingredientes para pastelería/panadería** | 0 | 22 |
| Condimentos y aderezos | 26 | 27 |
| Lácteos y quesos | 12 | 12 |

**Las harinas son 12 en total.** Eso se revisa a mano en diez minutos.

Y cuando las miré, **están perfectamente separadas**: las 6 de Saavedra son de almendras,
arroz, garbanzos, maíz, sorgo y trigo sarraceno —todas sin gluten—; las 5 de Vedia son 000,
0000, de fuerza, semolín y pan rallado —todas de trigo—. **Cero contaminación en los datos
de hoy.** La práctica de la fábrica es sólida; lo que falta es que el sistema lo sepa.

---

## El modelo: no alcanza con un sí/no

Un booleano `sin_gluten` obliga a mentir en el arranque: los 580 productos tendrían que
nacer en `true` o en `false`, y las dos opciones son malas. En `true` decís que algo es
apto sin que nadie lo haya mirado. En `false` marcás como peligroso medio almacén y nadie
te va a creer.

**Hacen falta dos datos, no uno:**

| Campo | Valores | Para qué |
|---|---|---|
| `sin_gluten` | `true` / `false` / **`null`** | Qué sabemos |
| `sin_gluten_origen` | `confirmado` / `heredado_del_local` / `sin_revisar` | **Cuánto vale lo que sabemos** |

`null` = *"nadie lo miró todavía"*, y es distinto de *"tiene gluten"*. El segundo campo es
el que permite que la validación sea estricta donde importa sin frenar todo el sistema el
primer día.

> **Por qué esto y no un booleano:** la pregunta que la validación tiene que poder hacer no
> es *"¿esto es sin gluten?"* sino *"¿alguien confirmó que esto es sin gluten?"*. Son
> distintas, y la diferencia es exactamente el riesgo.

---

## Cómo se carga el dato en los 580 que ya existen

El riesgo **no es simétrico**: marcar como apto algo que tiene gluten puede enfermar a una
persona; marcar como dudoso algo que es apto solo molesta. Todo el plan se inclina para ese
lado.

### Paso 1 — Lo que se puede deducir con seguridad: los de Saavedra

**Todo producto cargado en Saavedra está físicamente en un local 100 % sin gluten.** Eso es
una afirmación fuerte y verificable: si algo con TACC estuviera ahí, ya sería un problema
hoy, sin ledger.

→ Los **262 productos de Saavedra** arrancan en `sin_gluten = true`, origen
`heredado_del_local`.

**No es una confirmación, es un punto de partida honesto.** Y queda marcado como tal.

### Paso 2 — Lo que NO se puede deducir: los de Vedia

Acá está el error de razonamiento que hay que evitar: **que un producto esté en Vedia no
quiere decir que tenga gluten.** Vedia no es "el local con gluten": es el local que no está
certificado. La sal, el tomate y el queso de Vedia no tienen gluten.

→ Los **318 productos de Vedia** arrancan en `sin_gluten = null`, origen `sin_revisar`.

### Paso 3 — La revisión a mano, acotada

No hay que revisar 580 productos. Hay que revisar **los que pueden entrar a Saavedra o a
una receta de Saavedra**, que es un conjunto mucho más chico:

1. **Las 12 harinas** — las más importantes, y ya sabemos que están bien separadas.
2. **Los 22 de pastelería/panadería** (todos de Saavedra, hoy heredados).
3. **Los 96 nombres activos que están en los dos locales** — para confirmar si son el
   mismo producto o dos distintos con el mismo nombre.
4. El resto queda en `null` hasta que alguien lo necesite.

**Eso es del orden de 100 decisiones, no 580.** Y se pueden tomar de a poco: el sistema
funciona con `null`, solo que no deja pasar esos productos a Saavedra hasta que se confirmen.

### Paso 4 — Confirmar desde el proveedor, más adelante

Lo correcto a futuro es que el dato venga del rótulo del producto (el logo "Sin TACC" es
información del fabricante, no una opinión nuestra). Eso se puede cargar cuando se reciba
mercadería, pero **no es parte de este plan**: primero hay que tener dónde guardarlo.

---

## La validación

**Dónde va: en la base, no en la pantalla.** Si va solo en el frontend, la primera pantalla
nueva que alguien escriba se la saltea sin darse cuenta. Y este proyecto ya tiene el
antecedente: hay reglas que viven en dos lados y no coinciden.

**Qué tiene que impedir:** que un producto que no esté confirmado como sin gluten termine
en una ubicación de un local sin gluten.

```
  Si el local de destino es sin gluten
     y el producto NO tiene sin_gluten = true
        → se rechaza, con un mensaje que diga QUÉ producto y POR QUÉ
```

**Tres cosas que hay que definir para que eso funcione:**

1. **Qué local es "sin gluten"** tiene que ser un dato, no un `if local = 'saavedra'`
   escrito en el código. Si mañana abre un tercer local, o si Vedia se certifica, la regla
   tiene que cambiar sola.
2. **Por dónde entra mercadería a un local.** Hoy: recepción (QR y Compras), alta de
   producto, y producción. Con el ledger se suma `transferencia`. **Todas** esas puertas
   tienen que pasar por la misma validación — y esa es otra razón para que viva en la base.
3. **Qué pasa con lo que ya está.** La validación mira lo que entra de ahora en adelante.
   Lo que ya está en Saavedra queda como `heredado_del_local` y se confirma con calma.

> ⚠️ **Una cosa que la validación NO puede hacer sola:** no sabe nada de las recetas. Un
> producto sin gluten usado en una receta de Saavedra junto a una subreceta de Vedia sigue
> siendo un problema, y eso se resuelve en el costeo y en la Calculadora — donde el arreglo
> de hoy ya cerró el agujero más grande.

---

## El orden

| # | Qué | Depende de |
|---|---|---|
| 1 | Las dos columnas en `productos`, todo en `null` / `sin_revisar` | — |
| 2 | Marcar "qué local es sin gluten" como dato | — |
| 3 | Sembrar los 262 de Saavedra como `heredado_del_local` | 1 y 2 |
| 4 | Mostrar el dato en pantalla (Insumos, Compras › Stock) y poder confirmarlo | 3 |
| 5 | Revisar a mano las 12 harinas y los 22 de pastelería | 4 |
| 6 | La validación en la base, **en modo aviso** (deja pasar y registra) | 3 |
| 7 | La validación **bloqueando** | 5 y 6 |
| 8 | Recién acá: arrancar el ledger | 7 |

**El paso 6 en modo aviso es el que evita el desastre de arranque:** si se bloquea desde el
día uno, cualquier recepción de un producto sin revisar se frena y la cocina no puede
trabajar. Una semana de avisos muestra qué productos hace falta confirmar de verdad, y
recién ahí se cierra la puerta.

---

## Lo que necesita a Lucas

1. **¿Vedia podría certificarse sin gluten alguna vez?** Cambia si "local sin gluten" es un
   dato configurable o una constante. (Mi recomendación es dato configurable igual.)
2. **Los 96 nombres que están en los dos locales**: ¿son el mismo producto comprado dos
   veces, o productos distintos con el mismo nombre? Cambia si el dato se puede propagar de
   un local al otro o no.
3. **¿Quién confirma que un producto es sin gluten?** No es una tarea de cualquiera: es la
   persona que mira el rótulo y se hace responsable. Tiene que quedar registrado quién fue.
4. **¿Hay algún producto que hoy esté en Saavedra y NO sea sin gluten?** Los datos dicen que
   no, pero los datos no son la cámara. Esta pregunta se contesta caminando el depósito, y
   conviene contestarla antes del paso 3 — porque ese paso da por bueno que la respuesta es
   "ninguno".
