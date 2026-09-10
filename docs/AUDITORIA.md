# Auditoría de arquitectura — rodziny-erp

**Fecha:** 10-sep-2026 · **Alcance:** lectura solamente, no se tocó ni un archivo del código.
**Qué se midió:** los 196 archivos `.ts`/`.tsx` de `src/`, más el resto del repo para el inventario.

> ### Cómo leer esto
> Cada número de acá salió de contar, no de estimar. Donde no pude verificar algo, lo digo.
> Los hallazgos graves los comprobé abriendo el código, uno por uno.
>
> **Dos advertencias de honestidad sobre el método**, antes que nada:
>
> 1. **La primera pasada del análisis estuvo mal y se corrigió.** El detector de imports no
>    reconocía los `import` escritos en varias líneas, así que se comió 47 conexiones reales y
>    reportó 9 archivos como "muertos" que en realidad están todos vivos y en uso. Está
>    arreglado y **todos los números de este informe son los de después del arreglo**. Vale la
>    pena anotarlo porque es exactamente el modo de falla que ya está registrado en la memoria
>    del proyecto: *el detector de código muerto no sirve acá*. Sigue sin servir si no se lo
>    arregla primero.
> 2. **La sección 6 quedó a medias.** De las cuatro búsquedas de duplicados que lancé,
>    terminaron dos (fechas y plata). Las otras dos —impuestos y acceso a datos— se cortaron
>    por límite de cuota. Cubrí a mano una parte de "acceso a datos" (la medición de la regla
>    de escritura) y **impuestos quedó sin auditar**. Está anotado al final.

---

## 1. Inventario

### El repo entero, hasta 3 niveles

Se excluyen `node_modules`, `dist`, `.git` y las carpetas generadas (`graphify-out`, `.code-review-graph`, `.impeccable`).

| Carpeta | Archivos | Líneas |
|---|---:|---:|
| **(raíz)** | 18 | 5.376 |
| `agente-impresion/` | 3 | 720 |
| `data/` | 2 | 482 |
| `docs/` | 1 | 145 |
| ↳ `docs/estrategia/` | 1 | 145 |
| `public/` | 5 | 80 |
| `scripts/` | 11 | 1.336 |
| ↳ `scripts/graphify/` | 3 | 390 |
| ↳ `scripts/mapa-erp/` | 4 | 462 |
| ↳ `scripts/marca/` | 1 | 199 |
| ↳ `scripts/verificar/` | 1 | 73 |
| **`src/`** | **198** | **94.907** |
| ↳ `src/components/` | 8 | 1.327 |
| &nbsp;&nbsp;&nbsp;↳ `src/components/layout/` | 2 | 195 |
| &nbsp;&nbsp;&nbsp;↳ `src/components/ui/` | 4 | 237 |
| ↳ `src/lib/` | 23 | 2.422 |
| ↳ `src/modules/` | 162 | 90.536 |
| **`supabase/`** | **239** | **25.586** |
| ↳ `supabase/functions/` | 22 | 5.217 |
| ↳ `supabase/migrations/` | 207 | 17.838 |
| **TOTAL** | **477** | **128.632** |

### `src/modules/` en detalle

| Módulo | Archivos | Líneas | % de `src/modules` |
|---|---:|---:|---:|
| `cocina` | 32 | 22.260 | 24,6 % |
| `rrhh` | 20 | 13.236 | 14,6 % |
| `finanzas` | 17 | 12.901 | 14,3 % |
| `compras` | 13 | 9.996 | 11,0 % |
| `gastos` | 16 | 9.823 | 10,9 % |
| `productos` | 22 | 7.671 | 8,5 % |
| `caja` | 6 | 4.305 | 4,8 % |
| `ventas` | 8 | 2.667 | 2,9 % |
| `salon` | 5 | 1.752 | 1,9 % |
| `almacen` | 4 | 1.580 | 1,7 % |
| `agenda` | 7 | 1.525 | 1,7 % |
| `convenios` | 6 | 822 | 0,9 % |
| `integraciones` | 1 | 620 | 0,7 % |
| `dashboard` | 2 | 556 | 0,6 % |
| `usuarios` | 1 | 480 | 0,5 % |
| `inicio` | 1 | 237 | 0,3 % |
| `auth` | 1 | 105 | 0,1 % |

### Por extensión

| | Archivos | Líneas |
|---|---:|---:|
| `.tsx` | 126 | 83.767 |
| `.sql` | 208 | 20.360 |
| `.ts` | 92 | 16.099 |
| `.json` | 9 | 5.019 |
| resto (`.ps1`, `.py`, `.md`, `.cjs`, `.csv`, `.css`…) | 42 | 3.387 |

### Lo que salta a la vista

**El 96 % del código de la aplicación vive en `src/modules/`.** `src/lib/` (lo compartido) son
2.422 líneas y `src/components/` (lo visual reutilizable) son 1.327: **el 4 %**. Es un proyecto
donde casi no hay piezas comunes; cada módulo se resolvió solo. La sección 6 muestra el precio.

**No existe ninguna carpeta de acceso a datos.** No hay `services/`, ni `api/`, ni
`repositories/`, ni `queries/`. Las pantallas hablan con la base directamente: hay **492 llamadas
a `supabase.from()`, y 408 de ellas están adentro de archivos `.tsx`**, o sea dentro de la
pantalla misma.

**Los 15 archivos más grandes son 27.000 líneas, casi un tercio del front.** El más grande,
`src/modules/cocina/ProduccionQRPage.tsx`, tiene **6.108 líneas** él solo — más que los módulos
de Salón, Almacén, Agenda, Convenios, Dashboard, Usuarios e Inicio juntos.

---

## 2. God-files: los 15 más importados

Contando cuántos archivos distintos importan a cada uno (grafo de imports resuelto, con alias
`@/`, `index.ts` e `import()` dinámico).

| # | Archivo | Lo importan | Líneas |
|---:|---|---:|---:|
| 1 | `src/lib/utils.ts` | **107** de 196 | 57 |
| 2 | `src/lib/supabase.ts` | **105** | 7 |
| 3 | `src/lib/auth.tsx` | 46 | 227 |
| 4 | `src/lib/erroresSupabase.ts` | 23 | 297 |
| 5 | `src/lib/fechaAR.ts` | 19 | 18 |
| 6 | `src/modules/rrhh/utils.ts` | 19 | 377 |
| 7 | `src/components/layout/PageContainer.tsx` | 18 | 27 |
| 8 | `src/modules/rrhh/RRHHPage.tsx` | 14 | **1.608** |
| 9 | `src/modules/gastos/proveedorDisplay.tsx` | 12 | 147 |
| 10 | `src/components/ui/LocalSelector.tsx` | 12 | 38 |
| 11 | `src/lib/supabaseAnon.ts` | 10 | 22 |
| 12 | `src/modules/gastos/types.ts` | 10 | 210 |
| 13 | `src/components/ui/KPICard.tsx` | 10 | 78 |
| 14 | `src/lib/comprimirImagen.ts` | 9 | 126 |
| 15 | `src/lib/numero.ts` | 9 | 54 |

**Clasificación usada:** (a) lógica de negocio de un dominio · (b) helper genérico reutilizable ·
(c) query a Supabase / acceso a datos · (d) tipo de datos.

---

### 1. `src/lib/utils.ts` — 107 importadores, 57 líneas

| Export | Cat. | Nota |
|---|:--:|---|
| `formatARS` | b | Formateador de moneda. Bien ubicado. |
| `fmtCantidad` | b | **Duplica a `formatNum` de `numero.ts`** con otra política de decimales. |
| `formatFecha` | b | Bien resuelto: esquiva el corrimiento de día por UTC. |
| `excelSerialToDate` | b | **Mal ubicado**: un solo importador, y `parseFudoGastos.ts:58` tiene su propia copia. |
| `cn` | b | Concatenador de clases CSS, 2 líneas. |

> 💣 **La dependencia más pesada del proyecto es una función de dos líneas.** `cn` la usan 96
> archivos y `formatARS` 50; ese es el motivo real por el que 107 de 196 archivos importan este
> archivo. Es un cajón de sastre: en 57 líneas conviven plata, cantidades, fechas, series de
> Excel y clases de CSS, cinco cosas sin relación entre sí.
>
> 💣 **Solapa con `lib/numero.ts` y ya se nota en pantalla.** `fmtCantidad` fuerza 2 decimales;
> `formatNum` da hasta 3 y se come los ceros. El **mismo campo** sale distinto en dos pantallas
> del mismo módulo: `ProduccionTab.tsx:644` imprime `fmtCantidad(l.kg_producidos)` y
> `ProduccionQRPage.tsx:993` imprime `formatNum(l.kg_producidos)`. No hay ninguna regla escrita
> que diga cuál usar: quedó por la historia de cada pantalla.

### 2. `src/lib/supabase.ts` — 105 importadores, 7 líneas

| Export | Cat. | Nota |
|---|:--:|---|
| `supabase` | c | El único cliente de la app. Bien en sí mismo. |

> 💣 **El problema no es lo que tiene adentro sino lo que falta afuera.** Estas 7 líneas son la
> única pieza entre 100 archivos de `src/modules` y Postgres. **492 consultas, 408 dentro de
> `.tsx`.** Cuatro consecuencias medidas:
>
> 1. Una regla que hay que aplicar en toda consulta —el filtro por local, el corte de Fudo,
>    contar las filas que tocó un UPDATE— **no tiene un solo lugar donde vivir**. Hay que
>    repetirla en 492 puntos y alcanza con olvidarla en uno.
> 2. Cambiar el nombre de una tabla o de una columna obliga a tocar decenas de pantallas.
> 3. Nada de eso se puede probar sin levantar la interfaz.
> 4. **La regla del `CLAUDE.md` de contar las filas afectadas no se puede imponer.** Con una capa
>    intermedia sería automático; hoy depende de que cada pantalla se acuerde. Ver sección 6.

### 3. `src/lib/auth.tsx` — 46 importadores, 227 líneas

| Export | Cat. | Nota |
|---|:--:|---|
| `Modulo` | d | Catálogo de módulos… pero dos miembros (`anular_ventas`, `ver_esperado_caja`) **no son módulos, son permisos sueltos**: el tipo miente sobre su propio nombre. |
| `Perfil` | d | Espejo de la tabla `perfiles`. Mal ubicado: forma de datos adentro de un provider de React. |
| `AuthProvider` | a — *Usuarios y permisos* | Adentro tiene las tres cosas: el switch de `tienePermiso`, el select a `perfiles` y el manejo de sesión. |
| `useAuth` | a — *Usuarios y permisos* | 47 archivos lo usan. Es la API pública de los permisos. |

> 💣 **El mapa de permisos está escrito dos veces.** El `switch` de `auth.tsx:165-206` y el array
> `MODULOS` de `usuarios/UsuariosPage.tsx:8-35` dicen lo mismo en dos lugares. Agregar un permiso
> obliga a tocar **4 puntos** (el tipo `Modulo`, la interfaz `Perfil`, el switch y el array) y
> **TypeScript no avisa de los dos últimos**.
>
> 💣 **`local_restringido` ya se escapó del archivo**: se lee crudo en unos 15 archivos (Caja,
> Cocina, Productos, Salón, Sidebar), cada uno con su propio cast y su propio valor por defecto,
> en vez de salir por una función. La regla del candado de local vive repartida.

### 4. `src/lib/erroresSupabase.ts` — 23 importadores, 297 líneas

| Export | Cat. | Nota |
|---|:--:|---|
| `mensajeErrorAmigable` | b | 88 usos. Traduce códigos de Postgres a castellano. |
| `mensajeErrorEdgeFunction` | b | Lee el cuerpo del error que `supabase-js` descarta. |

> El armazón es genérico, pero adentro tiene pegadas cosas de dominios concretos: el diccionario
> nombra tres restricciones puntuales (`cocina_lotes_pasta_codigo_unico_por_local` de Cocina,
> `empleados_pin_fichaje_unico` y `empleados_pin_fichaje_formato` de RRHH) y el mensaje del error
> 23503 habla de "un lote de relleno o masa". **Cada restricción nueva de cualquier módulo obliga
> a editar un archivo que importan 23 módulos**: Cocina y RRHH se pisan en el mismo lugar.

### 5. `src/lib/fechaAR.ts` — 19 importadores, 18 líneas

| Export | Cat. | Nota |
|---|:--:|---|
| `CORTE_JORNADA_H` | a — *Cocina* | Parece constante técnica, es una regla de negocio. |
| `hoyAR` | a — *Cocina* | **Mal nombrado**: parece "hoy en Argentina" y es "hoy operativo de cocina". |

> 💣 **El nombre promete una fecha argentina genérica y entrega el día operativo de Cocina.**
> Resta 3 horas de huso **más** 5 de corte de jornada, así que entre 00:00 y 04:59 devuelve *el
> día anterior*. Veinte archivos de Cocina, Compras, Finanzas, Gastos, Almacén, Productos e
> Integraciones lo llaman a ciegas.
>
> 💣 **Y ya mordió**: `finanzas/components/ChecklistPagos.tsx:162` dejó escrito que **no** usa
> `hoyAR()` justamente por el corte de las 5 AM, y se escribió su propio `hoy()`. El archivo que
> debería ser la única fuente **no lo es**: la constante está copiada a mano en
> `cocina/hooks/useCierresFaltantes.ts:59`, `cocina/MostradorPage.tsx:145` y
> `rrhh/FicharPage.tsx:63`. Detalle completo en la sección 6.

### 6. `src/modules/rrhh/utils.ts` — 19 importadores, 377 líneas, **33 exports**

Los 33, agrupados por lo que realmente son:

| Grupo | Cat. | Exports |
|---|:--:|---|
| Calendario y texto **genéricos** | b / d | `ymd`, `parseYmd`, `sumarDias`, `ultimoDiaDelMes`, `diffHoras`, `hhmm`, `etiquetaDia`, `normalizarTexto`, `DIAS_SEMANA`, `DIAS_SEMANA_LARGO`, `MESES` |
| Reglas del **fichaje** (CCT) | a — *RRHH* | `TOLERANCIA_MIN`, `TARDANZA_MAX_MIN`, `esTardanzaReal`, `ANTIREBOTE_SEG`, `VENTANA_TURNO_ABIERTO_H`, `decidirProximaFichada`, `diffMinutosVsTurnos`, `sumHorasTurnos`, `formatTurnos` |
| Reglas de **liquidación** | a — *RRHH* | `PRESENTISMO_PCT`, `montoPresentismo`, `remuneracionConPresentismo`, `diasDeQuincena`, `quincenaDeFecha`, `trabajoEnElPeriodo` |
| **Tipos** | d | `Quincena`, `TurnoCrono`, `FichadaMin`, `CronoDia`, `DecisionFichada`, `EmpleadoDelPeriodo` |
| **Muerto** | — | `diffMinutosVsHorario` (nadie lo usa; lo reemplazó `diffMinutosVsTurnos`) |

**Cero exports de categoría (c): en 377 líneas no hay una sola consulta a la base.** Es lógica
pura, y eso está muy bien — el problema es dónde vive.

> 💣 **Duele de las dos puntas, y está medido.**
> **Hacia afuera:** lo genérico quedó enterrado en una carpeta de RRHH y el resto del repo lo
> reescribe. `ymd` está redefinido en agenda, compras, dashboard, gastos, ventas y hasta en
> `BienalTab` del propio RRHH — **7 copias**. `sumarDias` tiene 3 copias en cocina y una cuarta
> (`sumarDiasYmd`) en `VacacionesTab`, del mismo módulo. El `normalize('NFD')` de
> `normalizarTexto` está copiado a mano en unos 20 archivos, **incluido `RRHHPage.tsx:467-475`,
> que ni siquiera usa el de su propio módulo**.
> **Hacia adentro:** módulos ajenos entran a buscar cosas acá. `finanzas/useProyeccionFlujo`
> importa `remuneracionConPresentismo` y `parseYmd`; `productos/useManoObra` importa
> `remuneracionConPresentismo`; e `integraciones/IntegracionesPage` importa `normalizarTexto`
> — o sea, **Integraciones depende de RRHH para sacarle las tildes a un texto**.

### 7. `src/components/layout/PageContainer.tsx` — 18 importadores, 27 líneas

| Export | Cat. | Nota |
|---|:--:|---|
| `PageContainer` | b | Cáscara de layout pura. **No mezcla nada. Bien ubicado.** |

### 8. `src/modules/rrhh/RRHHPage.tsx` — 14 importadores, **1.608 líneas**

| Export | Cat. | Nota |
|---|:--:|---|
| `Empleado` | d | Interfaz de 30 campos. **Es lo único que se llevan los 13 archivos que la importan.** |
| `RRHHPage` | a — *RRHH* | El componente de la página. |

En un archivo conviven: el tipo compartido (d); queries y mutations a `empleados`,
`recibos_sueldo`, storage y la edge function de OCR (c); reglas de RRHH —PIN único, limpieza de
datos de egreso, alerta de período de prueba a los 75 días, vencimiento de manipulación de
alimentos— (a); y unas 900 líneas de interfaz.

> **Sobre el ciclo de imports: hay que ser preciso, porque hoy no cuesta nada.** `RRHHPage`
> importa 9 pestañas y esas mismas pestañas importan `Empleado` de vuelta desde `RRHHPage`. Es un
> ciclo — pero los 13 lo hacen con `import type` y el proyecto tiene `verbatimModuleSyntax: true`,
> así que **TypeScript borra ese import al compilar y el costo en la aplicación es exactamente
> cero**. No arrastra ningún pedazo de código extra.
>
> 💣 **Lo que sí cuesta hoy es humano, y ya se cobró una víctima.** Para saber qué forma tiene una
> fila de `empleados` hay que abrir un archivo de 1.608 líneas. **`FicharPage.tsx:112` se rindió y
> se definió su propio `interface Empleado` de 7 campos.** Ahora hay dos definiciones del mismo
> empleado en el mismo módulo.
>
> ⚠️ **Y el día que alguien importe un *valor* de `RRHHPage` —no un tipo— el ciclo pasa a ser
> real.** El módulo ya sabe dónde debería ir: existe `src/modules/rrhh/sueldos/tipos.ts`, pero no
> existe `src/modules/rrhh/tipos.ts`.

### 9. `src/modules/gastos/proveedorDisplay.tsx` — 12 importadores, 147 líneas

| Export | Cat. | Nota |
|---|:--:|---|
| `ProveedorNombre`, `ProveedorDisplay`, `ProveedorMapInfo`, `ProveedoresMap`, `ConProveedor` | d | Tipos del concepto Proveedor. |
| `displayProveedor` | a — *Proveedores* | Regla decidida con Lucas (jun-2026): comercial si existe, si no razón social. |
| `resolverProveedor`, `nombreProveedor`, `proveedorSearchSpace` | a — *Proveedores* | Precedencia: gana el registro maestro sobre el texto libre viejo. |
| `useProveedoresMap` | c | Query a `proveedores`, cacheada 5 min. |
| `ProveedorLabel` | b | Componente de presentación. |

> **La mezcla acá es defendible** —es un paquete coherente alrededor de un concepto—, pero el
> archivo **está mal ubicado**: de sus 12 importadores, **7 están fuera de Gastos** (compras:
> `ComprasPage`, `ConciliacionTab`, `VincularPagosMovModal`, `CalendarioPagosCtaCte`; finanzas:
> `FlujoCaja`, `ChecklistPagos`, `AmortizacionesPage`). Proveedores es un dominio propio que hoy
> vive de prestado adentro de Gastos.

### 10. `src/components/ui/LocalSelector.tsx` — 12 importadores, 38 líneas

| Export | Cat. | Nota |
|---|:--:|---|
| `LocalSelector` | a — *Locales / estructura societaria* | **Mal ubicado.** |

> 💣 **Parece un componente decorativo y adentro tiene el catálogo de la empresa.** `LABELS`
> (líneas 11-18) sabe que existen Vedia, Saavedra, Bienal y la SAS, y decide que `ambos`,
> `consolidado` y `sas` —**tres alcances distintos**— se muestren los tres como "Empresa". Abrir
> un local nuevo obliga a editar un archivo que por su carpeta parece cosmético. Y el catálogo
> quedó desconectado de `local_restringido` de `auth.tsx`, que solo admite `vedia` y `saavedra`.

### 11. `src/lib/supabaseAnon.ts` — 10 importadores, 22 líneas

| Export | Cat. | Nota |
|---|:--:|---|
| `supabaseAnon` | c | Segundo cliente, sin sesión persistida, para las pantallas públicas. |

> Bien ubicado y bien comentado. La observación: **qué pantallas son públicas vive solo en un
> comentario**. Nada impide importar el cliente equivocado. Verifiqué los 10 importadores y hoy
> el reparto es correcto, pero lo sostiene la memoria de quien escribe, no el código.

### 12. `src/modules/gastos/types.ts` — 10 importadores, 210 líneas

| Export | Cat. | Nota |
|---|:--:|---|
| `CondicionIVA`, `TipoComprobante`, `TIPO_COMPROBANTE_LABEL`, `EstadoPago` | d | Vocabulario fiscal argentino, no de Gastos. |
| `TipoEdr` | d | **Mal ubicado**: es el catálogo de líneas del Estado de Resultados → Finanzas. |
| `MedioPago`, `MEDIO_PAGO_LABEL` | d | **Mal ubicado**: catálogo de todo el ERP. |
| `LocalGasto` | d | Ídem: vocabulario común. |
| `Proveedor`, `CategoriaGasto`, `Gasto`, `PagoGasto`, `ItemGastoStock` | d | Estos sí son de Gastos. |
| `mapearMedioPagoOcr` | a — *Gastos / OCR* | Regla escondida en un archivo llamado "types". |
| `medioRequiereComprobante` | a — *Pagos* | Regla que usan RRHH y Finanzas. |

> 💣 **Ya se rompió por la mitad, y se puede señalar el punto exacto:**
> `rrhh/AguinaldoTab.tsx:22-27` se definió **su propio** tipo `MedioPagoGasto` con 4 de los 7
> valores en vez de importar `MedioPago`… **pero sí importa `medioRequiereComprobante` del mismo
> archivo.** Es decir: se llevó la regla y se copió el vocabulario. Ahí hay dos listas de medios
> de pago que pueden separarse sin que nada avise.

### 13. `src/components/ui/KPICard.tsx` — 10 importadores, 78 líneas

| Export | Cat. | Nota |
|---|:--:|---|
| `KPICard` | b | Presentación pura, no calcula nada. **Bien ubicado.** |

### 14. `src/lib/comprimirImagen.ts` — 9 importadores, 126 líneas

| Export | Cat. | Nota |
|---|:--:|---|
| `comprimirImagen`, `esArchivoHeic`, `extensionDe` | b | Genéricos de verdad. Bien ubicados. |
| `ComprimirOpts` | d | Interfaz de opciones. |
| `OPTS_OCR` | d | Preset calibrado para comprobantes de Mercado Pago: **decisión de dominio disfrazada de valor por defecto**. |
| `MENSAJE_HEIC` | d | **Mal ubicado**: es texto de interfaz. Cambiar una palabra obliga a tocar `lib/`. |

### 15. `src/lib/numero.ts` — 9 importadores, 54 líneas

| Export | Cat. | Nota |
|---|:--:|---|
| `parseDecimal` | b | El que evita que "25.000" entre como 25000. **Ver la trampa de la sección 6.** |
| `normalizarDecimal` | b | Fuerza formato es-AR mientras se tipea. |
| `formatNum` | b | La otra mitad del solapamiento con `fmtCantidad`. |
| `equivalenteKgGramos` | b | El más "de dominio" del archivo: el salto a toneladas es un guardarraíl para la fábrica. |

---

### Resumen de la sección 2

**De los 15 archivos, solo 3 están limpios**: `PageContainer`, `KPICard` y `supabaseAnon` — una
responsabilidad, bien ubicados, sin mezcla.

**El patrón que se repite en los otros 12** es siempre el mismo y tiene nombre:
**lógica de negocio de Rodziny viviendo en carpetas que prometen ser genéricas.**
`src/lib/` debería ser código que serviría en cualquier proyecto, y adentro tiene el corte de
jornada de la cocina, las reglas de permisos de la empresa y los nombres de las restricciones de
la base. `components/ui/` debería ser decorativo y tiene el catálogo de locales y sociedades.

**Los dos `utils.ts` y el `types.ts` que pediste mirar con atención confirman la sospecha:**
son los tres cajones de sastre del proyecto. `lib/utils.ts` mezcla cinco temas sin relación;
`rrhh/utils.ts` mezcla cuatro capas y esconde 11 helpers genéricos que el resto del repo
reescribe; `gastos/types.ts` no es de Gastos ni son solo tipos.

---

## 3. Código muerto

### Archivos que nadie importa: **ninguno**

De los 196 archivos de `src/`, **los 196 se usan**. Todas las cadenas terminan en una ruta del
router o en una pestaña realmente montada.

> 💣 **Este resultado corrige el de la primera pasada, y la corrección es la lección.** El primer
> análisis reportó 9 archivos muertos. Al verificarlos uno por uno, **los 9 estaban vivos**, y los
> 9 tenían la misma característica: los importan con un bloque `import {` escrito en varias
> líneas, que el detector no reconocía. La correlación fue del 100 %.
>
> **No era un problema de esos 9 archivos: era el detector.** Cualquier archivo del repo importado
> con llaves en varias líneas iba a aparecer como muerto. Los nueve, para el registro:
> `caja/Impresion.tsx`, `finanzas/hooks/useProyeccionFlujo.ts`, `salon/useMesas.ts`,
> `rrhh/bienalHoras.ts`, `caja/comprobanteFiscal.ts`, `cocina/hooks/useEfemerides.ts`,
> `gastos/matchearPorIdOperacion.ts`, `ventas/hooks/useFacturacion.ts` y
> `finanzas/hooks/useExtractosFrescura.ts`. **Borrar cualquiera de ellos rompía una pantalla en
> uso.**

### Donde sí hay código muerto es adentro de los archivos

| | Cantidad | Qué significa |
|---|---:|---|
| Exports que **nadie usa, ni afuera ni adentro** | **11** | Código muerto de verdad. |
| Exports usados **solo dentro de su propio archivo** | **97** | No son muertos: están *exportados de más*. |

**Los 11 muertos de verdad:**

| Archivo | Línea | Qué es |
|---|---:|---|
| `src/modules/rrhh/utils.ts` | 7 | `DIAS_SEMANA_LARGO` |
| `src/modules/rrhh/utils.ts` | 129 | `diffMinutosVsHorario` — lo reemplazó `diffMinutosVsTurnos` |
| `src/modules/rrhh/utils.ts` | 344 | `quincenaDeFecha` |
| `src/lib/fudoApi.ts` | 11 | `PAYMENT_METHOD_IDS` |
| `src/lib/fudoApi.ts` | 21 | `PM` |
| `src/lib/unidades.ts` | 61 | `UnidadCanonica` |
| `src/lib/unidades.ts` | 99 | `mismaUnidad` |
| `src/modules/productos/hooks/usePreciosCanal.ts` | 7 | `CANALES_PRECIO` |
| `src/modules/productos/hooks/usePreciosCanal.ts` | 21 | **`usePreciosCanal`** — el hook que da nombre al archivo |
| `src/lib/impresoraDirecta.ts` | 187 | `vistaPreviaPrueba` |
| `src/modules/salon/useMesas.ts` | 202 | **`useAnularMesa`** |

### Dos de esos once no son basura: son funciones que nunca se enchufaron

⚠️ **`useAnularMesa` (`salon/useMesas.ts:202`) — no hay forma de anular una mesa desde la app.**
El hook existe y llama a la función `salon_anular_sesion` de la base. El tipo `EstadoSesion`
contempla el estado `anulada`. O sea: **la base y el modelo lo soportan, pero no hay ni un botón
en ninguna pantalla.** Busqué `anularMesa`, `anular_mesa` y "anul" en todo `src/modules/salon/`:
cero resultados en la interfaz. Esto no parece código que sobró, parece **un cabo suelto de la
migración 193 que quedó sin terminar**. No lo borraría sin preguntar.

⚠️ **`usePreciosCanal` — el hook está muerto pero el archivo está vivo.**
`productos/components/MenuTab.tsx:9` importa de ese archivo… **solo el tipo `CanalPrecio`.** El
hook que le da nombre y razón de existir no lo llama nadie. Los precios por canal (salón,
mostrador, delivery) están modelados y no se usan.

**Los otros 97 exports** son cosmética de bajo riesgo: sacarles la palabra `export` no rompe nada,
pero borrar el símbolo sí. No los toqué ni recomiendo tocarlos ahora.

---

## 4. Acoplamiento

### Cuánto sale y cuánto entra, por carpeta de primer nivel

| Carpeta | Imports que **salen** | Imports que **entran** |
|---|---:|---:|
| `lib` | (no aplica) | **366** |
| `components` | 10 | 47 |
| `modules/cocina` | **79** | 23 |
| `modules/finanzas` | 58 | 6 |
| `modules/productos` | 57 | 2 |
| `modules/compras` | 57 | 5 |
| `modules/gastos` | 51 | **18** |
| `modules/rrhh` | 45 | 5 |
| `(src raíz)` | 29 | — |
| `modules/ventas` | 22 | 1 |
| `modules/caja` | 18 | 8 |
| `modules/agenda` | 15 | 3 |
| `modules/salon` | 15 | 3 |
| `modules/almacen` | 9 | 1 |
| `modules/inicio` | 9 | 1 |
| `modules/convenios` | 6 | 1 |
| `modules/dashboard` | 5 | 2 |
| `modules/integraciones` | 5 | 1 |
| `modules/usuarios` | 4 | 1 |
| `modules/auth` | 1 | 1 |

**El 88 % de todo lo que cruza de carpeta va a `lib/` o a `components/`** (413 de 470). Eso está
bien: es lo esperable. Lo que interesa es el 12 % restante.

### Módulo → módulo (la tabla que importa)

| Origen | Destino | Imports | Qué se lleva |
|---|---|---:|---|
| `productos` | `cocina` | **15** | `useCostosRecetas`, `useConfigCosteo`, `recetas/modelo`, `recetas/componentes`, `lib/costeoEngine` |
| `compras` | `gastos` | **11** | `proveedorDisplay`, `types`, `PagarGastoModal`, `NuevoGastoModal` |
| `finanzas` | `gastos` | 6 | `proveedorDisplay`, `GastosPage`, `types`, `recomputarEstadoGasto` |
| `salon` | `caja` | 3 | `useCaja` |
| `compras` | `cocina` | 3 | `lib/stockPastas`, `lib/invalidarStock` |
| `compras` | `finanzas` | 2 | `ExtractosAlerta`, `parseFudoGastos` |
| `inicio` | `dashboard` | 2 | dos tarjetas |
| `inicio` | `agenda` | 2 | `useAgenda`, `types` |
| `cocina` | `compras` | 1 | `TrasladoPastasForm` |
| `finanzas` | `compras` | 1 | `ConciliacionTab` |
| `gastos` | `finanzas` | 1 | `parseExtractos` |
| `inicio` | `finanzas` | 1 | `ExtractosAlerta` |
| `inicio` | `cocina` | 1 | `ProximasEfemeridesCard` |
| `integraciones` | `rrhh` | 1 | `utils` (para sacar tildes) |
| `rrhh` | `gastos` | 1 | `types` |
| `ventas` | `productos` | 1 | `useCostoPorFudo` |
| `productos` | `rrhh` | 1 | `utils` |
| `productos` | `caja` | 1 | `useCaja` |
| `finanzas` | `caja` | 1 | `useCaja` |
| `finanzas` | `rrhh` | 1 | `utils` |

### Los cuatro ciclos

Cuatro pares se importan **en las dos direcciones**:

| Ciclo | Ida | Vuelta |
|---|---|---|
| `finanzas` ↔ `gastos` | 6 (`proveedorDisplay`, `types`…) | 1 (`parseExtractos`) |
| `compras` ↔ `cocina` | 3 (`stockPastas`, `invalidarStock`) | 1 (`TrasladoPastasForm`) |
| `compras` ↔ `finanzas` | 2 (`ExtractosAlerta`, `parseFudoGastos`) | 1 (`ConciliacionTab`) |
| `caja` ↔ `components` | 1 (`PageContainer`) | 1 (`useCaja`) |

⚠️ El último es el más raro de todos: **`src/components/` —la carpeta de lo visual reutilizable—
importa un hook del módulo Caja.** Una pieza que debería servir en cualquier pantalla depende de
un módulo concreto.

### Lo que dice esta tabla

**`productos → cocina` (15) no es acoplamiento accidental: es un módulo partido al medio.** Todo
el motor de costeo —recetas, ingredientes, configuración de costeo— vive en Cocina, y Productos,
que es quien pone los precios, tiene que ir a buscarlo ahí. Son dos módulos que en realidad son
uno: **el costeo**. Es el candidato número uno a reagrupar.

**`compras → gastos` (11) y `finanzas → gastos` (6) apuntan al mismo lugar.** Los dos van a buscar
`proveedorDisplay` y `types`. No es que Compras y Finanzas dependan de Gastos: es que **el
vocabulario común del ERP (proveedores, medios de pago, comprobantes) está guardado adentro de
Gastos** y los demás tienen que entrar a buscarlo. Sacar esas dos piezas a un lugar común
elimina la mayor parte de las 17 dependencias de una sola vez.

**Cocina es el que más sale (79) y de los que más entra (23): es el corazón del sistema.** Es
coherente con que sea el módulo más grande (24,6 % del código).

---

## 5. Imports profundos

**No existe ni uno solo que entre a más de 2 niveles dentro de otra carpeta.**

| Profundidad | Cantidad |
|---|---:|
| 1 nivel adentro (ej. `@/lib/utils`, `@/modules/caja/useCaja`) | 398 |
| 2 niveles adentro (ej. `@/components/ui/KPICard`) | 72 |
| **más de 2 niveles** | **0** |

El patrón que pusiste de ejemplo (`'../cocina/components/algo/Otro'`) **no aparece en el repo**.
Esta es la mejor noticia del informe: la estructura de carpetas es plana y nadie se metió en las
tripas de otro módulo.

De los 72 de dos niveles, **45 son `@/components/ui/...` y `@/components/layout/...`**, o sea el
uso normal de la biblioteca visual. Los **27 restantes son módulo → módulo**, y son los mismos
que ya salieron en la sección 4:

| Origen → Destino | Cantidad |
|---|---:|
| `productos` → `cocina` (`hooks/`, `recetas/`, `lib/`) | 15 |
| `compras` → `cocina` (`lib/`) | 3 |
| `compras` → `finanzas` (`components/`, `parsers/`) | 2 |
| `inicio` → `dashboard` (`components/`) | 2 |
| `productos` → `caja`, `cocina` → `compras`, `gastos` → `finanzas`, `inicio` → `cocina`, `inicio` → `finanzas` | 1 c/u |

Ninguno es alarmante por su profundidad. El de `productos → cocina` importa porque son 15, no
porque entre dos niveles.

---

## 6. Duplicados

> **Alcance de esta sección.** Se completaron dos de las cuatro búsquedas previstas: **fechas** y
> **plata**. Las de **impuestos** y **acceso a datos** se cortaron por límite de cuota; de la
> segunda cubrí a mano la parte más importante (la regla de escritura, al final). **Impuestos
> quedó sin auditar.** Los cinco hallazgos marcados 🔴 los verifiqué yo abriendo el código.

### 🔴 1. `hoyAR()` está copiado a mano en tres archivos

**Canónico:** `src/lib/fechaAR.ts:15` (lo importan 19 archivos).
**Copias:** `cocina/hooks/useCierresFaltantes.ts:59-64`, `cocina/MostradorPage.tsx:145-152`,
y `CORTE_JORNADA_H = 5` una cuarta vez en `rrhh/FicharPage.tsx:63`.

Los cuerpos son idénticos salvo cómo obtienen la hora. Y los comentarios se avisan entre sí:
`useCierresFaltantes.ts:58` dice literalmente **"Debe coincidir con `CORTE_JORNADA_H` en
`MostradorPage.tsx`"** — que es la confesión de que nadie puede garantizarlo.

**Qué se rompe:** si la cocina decide que la jornada corta a las 4 o a las 6, hay que tocar cuatro
números en cuatro archivos. Si se toca uno solo, el cierre de mostrador se guarda con una fecha y
el detector de cierres faltantes busca en otra: **la pantalla va a reclamar un cierre que ya
existe, o va a dar por cerrado un día que no se cerró.**

### 🔴 2. En Gastos y Pagos la fecha se **escribe** con un "hoy" y se **evalúa** con otro

Este es el más caro del informe, y **no es un descuido: son dos decisiones correctas que se cruzan.**

Hay tres fórmulas de "hoy" conviviendo:

| Fórmula | Dónde | Qué hace |
|---|---|---|
| `hoyAR()` | `lib/fechaAR.ts:15` | UTC − 8 h (3 de huso **+ 5 de corte de jornada**) |
| `hoy()` | `finanzas/ChecklistPagos.tsx:164` | UTC − 3 h (**calendario**, sin corte) |
| `new Date().toISOString()` | 4 pantallas de Gastos | UTC crudo, sin restar nada |

La segunda es **deliberada**. El comentario de `ChecklistPagos.tsx:162-163` lo explica:
*"No usamos `hoyAR()`: ese además resta el corte de jornada de cocina (5 AM), y para finanzas un
pago cargado a las 2 AM es de hoy, no de ayer."* **Tiene toda la razón.**

**El problema es que las dos se encuentran en el mismo camino:**

1. `ChecklistPagos.tsx:550` graba `fecha_pago = hoy()` → calendario argentino.
2. Después llama a `recomputarEstadoGasto` (`gastos/recomputarEstadoGasto.ts:32`), que compara esa
   fecha contra **`hoyAR()`**.
3. `esPagoEjecutado` (`lib/flujoCaja.ts:28`) es `fechaPago <= hoy`.

**Entre las 00:00 y las 04:59 de Argentina, `hoyAR()` todavía devuelve ayer.** Entonces el pago
recién cargado queda con fecha **mayor** que "hoy" y **no cuenta como ejecutado**: el gasto se
queda en Pendiente aunque la plata ya salió, y en la misma pantalla cae en el balde "a vencer" en
vez de "pagados".

**Y por la otra punta:** los formularios que usan UTC crudo hacen que un gasto cargado entre las
21:00 y las 23:59 se guarde con la fecha de **mañana**. Si es día 31, **el gasto se va al mes
siguiente** y el Flujo de Caja y la conciliación lo imputan al período equivocado.

*Arreglar una de las tres fórmulas no arregla las otras dos.*

### 🔴 3. Ocho funciones se llaman `ymd`, y una hace lo contrario que las otras siete

Siete son el mismo cuerpo palabra por palabra (fecha **local**). La excepción es
**`dashboard/components/AlertasOperativasCard.tsx:59`**, que usa `toISOString()`, o sea **UTC**.

Y el comentario que tiene arriba promete que *"el número coincide con lo que Lucas ve al entrar al
tab Conciliación"*. **No coincide:** `ConciliacionTab.tsx` arma su rango con `hoyAR()` y con *su*
`ymd`, que es local. Después de las 21:00 el "hoy" de la alerta ya es mañana y el último día del
mes se le escapa del rango; entre las 00:00 y las 04:59 del día 1, Conciliación todavía muestra el
mes anterior y la alerta ya muestra el nuevo.

⚠️ Y como **las ocho se llaman igual**, cualquiera que "unifique" copiando la equivocada se lleva
el error de UTC a RRHH, Gastos o el Calendario de pagos sin que nada avise.

### 🔴 4. El punto significa **dos cosas opuestas** al tipear plata

| Regla | Dónde | "15.000" da |
|---|---|---|
| **punto = coma decimal** | `lib/numero.ts:7` (`parseDecimal` + `normalizarDecimal`), usado en `caja/RetirosSinClasificar.tsx:291,307` | **15** |
| **punto = separador de miles** | `ui/MontoInput.tsx:42`, `gastos/NuevoGastoForm.tsx:126`, `gastos/PagarGastoModal.tsx:43`, `finanzas/CierreCaja.tsx:244`, `finanzas/FlujoCaja.tsx:578`, `productos/MenuTab.tsx:941` | **15.000** |

**Son dos pantallas de caja contando la misma plata con reglas contrarias.** El cajero que tipea
`15.000` en *Retiros sin clasificar* reparte **$15**; en *Cierre de Caja* reparte **$15.000**.
Peor todavía: `normalizarDecimal` convierte cualquier punto en coma **mientras se escribe**, o sea
que fuerza activamente la lectura decimal.

**Y hay un segundo problema al reeditar.** `CierreCaja.tsx:517-533` recarga el formulario con
`String(c.monto_contado)`, y esas columnas son `numeric` en la base, que PostgREST devuelve como
texto `"152350.50"`. Al reparsear con punto = miles queda **15.235.050**. Lo mismo en
`MenuTab.tsx:932-944` con el precio de la carta.

> `MontoInput` no tiene ese problema porque mantiene el texto que se ve separado del número:
> **la versión buena ya existe y las otras seis no la usan.**

### 🔴 5. Tres definiciones distintas de "margen bueno"

| Dónde | Umbral |
|---|---|
| `productos/PlanAccionTab.tsx:116` | `cfg.margen_min` — **el mínimo por categoría, de la base** |
| `productos/MenuTab.tsx:973-978` | rojo < **0,50**, ámbar < **0,65**, verde arriba |
| `ventas/FudoLiveTab.tsx:576-580` | rojo < **40**, ámbar < **60**, verde arriba (escala 0-100) |

**Un plato al 62 % sale verde en Ventas → En vivo Fudo y ámbar en Productos → Menú, al mismo
tiempo y con el mismo dato.** Y si la categoría pide 70 % en la configuración, Plan de Acción lo
lista como "margen bajo, subir precio" mientras las otras dos lo pintan de colores tranquilos.

⚠️ **Cambiar el mínimo de una categoría desde Configuración no mueve ni un color en dos de las tres
pantallas.** La configuración parece que manda, y en dos de tres lugares no manda nada.

### 6. La cadena precio → neto → margen está escrita 5 veces y no da lo mismo

`MenuTab.tsx:244`, `MenuTab.tsx:271`, `MenuTab.tsx:520`, `useMenuEngineering.ts:374`,
`useCostoPorFudo.ts:108`. La fórmula base es igual, pero difieren en tres cosas:

1. **El costo.** `useMenuEngineering` y `useCostoPorFudo` suman `costo_empaque`; **`MenuTab` no.**
2. **La escala.** Dos devuelven fracción (0,62), `useCostoPorFudo:114` devuelve **62**.
3. **El precio de partida.** `MenuTab` usa el precio de lista; `useMenuEngineering` usa el precio
   promedio real de las ventas de Fudo.

⚠️ La diferencia de escala es una trampa activa: **quien unifique copiando una sobre la otra se
lleva un error de 100×, y TypeScript no lo va a notar porque las dos son `number`.**

### 7. Otros duplicados confirmados (resumen)

| Qué | Cuántas copias | Consecuencia |
|---|---:|---|
| **Formateadores de moneda** paralelos a `formatARS`, todos sin centavos | 7 | El ticket impreso (`caja/Impresion.tsx:225-228`) muestra "Neto gravado" e "IVA 21 %" sin decimales: **la suma impresa puede no dar el total impreso.** |
| **`formatARS` local que tapa al compartido** (`cocina/IngredientesGrilla.tsx:16`) | 1 | Mismo nombre, corta a 0 decimales. Los ingredientes chicos aparecen en **$0** en la grilla y con centavos en el panel de costeo: la columna no suma el total. |
| **Formateadores de cantidad** con distintos decimales | 7 | Para 36,6666 kg salen "36,67", "36,667" y "36,7" según la pantalla. Es por qué **un conteo físico parece no cerrar cuando cierra.** |
| **"Lunes de la semana"** reimplementado | 5 (dos byte por byte) | Toda la planificación de Cocina se apoya en esto. Cambiar la convención en un lado **parte la semana en dos** y el plan aparece vacío sin que nada falle. |
| **Sumar/restar días a un `YYYY-MM-DD`** | 9, en 4 estrategias | Hoy coinciden **por casualidad del huso argentino**, no por diseño. Solo 2 de las 9 son realmente inmunes. |
| **El período `YYYY-MM`** y su aritmética | 12 archivos | Dos usan UTC (`FlujoCaja.tsx:258`, `NuevoGastoForm.tsx:916`): el último día del mes después de las 21:00, **el Flujo de Caja abre en el mes siguiente** y el comprobante se guarda en la carpeta del mes que viene, donde nadie lo va a buscar. |
| **Parsers de plata de archivos importados** | 3 (dos idénticos) | `parseExtractos.ts:43` limpia en orden invertido y su filtro **ya no incluye la coma**. Son la puerta de entrada de la plata que alimenta la conciliación y el EdR. |
| **Conversión de unidades en el motor de costeo** | 2, en el mismo archivo | `costeoEngine.ts:324-329` escribe a mano la conversión que `lib/unidades.ts:146` ya hace, con el `30` de las onzas hardcodeado. Cambiar `ML_POR_OZ` arregla las bebidas del almacén y **no toca las que salen de una subreceta**. |
| **`ahoraAR()` del ticket** | 5 | Si se arregla `CajaPage` y no `MesasMostradorPage`, el mismo local emite tickets con dos fechas según se cobre por mostrador o por mesa. |

### 8. La regla de escritura del proyecto se cumple en el 16 % de los casos

El `CLAUDE.md` es explícito: *"Toda escritura a la base tiene que contar las filas que tocó"*,
porque **un UPDATE que la RLS bloquea devuelve 0 filas y ningún error**. Lo medí:

| Operación | Total | Verifican | No verifican | Cobertura |
|---|---:|---:|---:|---:|
| `.update()` | 110 | 18 | 92 | 16 % |
| `.delete()` | 56 | 9 | 47 | 16 % |
| `.upsert()` | 21 | 2 | 19 | 9 % |
| **TOTAL** | **187** | **29** | **158** | **16 %** |

> El 16 % es un **techo generoso**: conté como "verifica" cualquier `.select()` o `count` cerca de
> la escritura, y algunos son para otra cosa. La cobertura real es menor.

**Dónde faltan:** `compras` 28 · `rrhh` 26 · `finanzas` 24 · `cocina` 23 · `gastos` 23 ·
`productos` 19.

⚠️ **El dato más elocuente: `caja` tiene 1 sola escritura sin verificar.** Es el módulo donde el
problema se peleó a mano, migración 189 mediante. **La regla se aplica donde se sufrió, y en
ningún otro lado** — que es exactamente lo que pasa cuando no hay una capa de datos que la
imponga (ver god-file nº 2).

---

## Preguntas para el dueño del código

Esto es lo que **no se puede decidir leyendo el código**. Están ordenadas por lo que más plata o
riesgo mueven.

### Sobre las fechas y la plata

**1. Cuando cargás un pago a la madrugada, ¿de qué día es?**
Hay dos respuestas escritas en el código y las dos están bien argumentadas: para la cocina, lo que
pasa a las 2 AM es del día anterior (el turno noche todavía no terminó); para finanzas, un pago
cargado a las 2 AM es de hoy. **El problema es que hoy conviven y se cruzan**, y entre las 00:00 y
las 04:59 un gasto recién pagado queda marcado como pendiente. Necesito que definas cuál manda
**para la plata**, y ahí lo dejo escrito en un solo lugar.

**2. ¿Un gasto cargado a las 22:00 del día 31 es de ese mes o del siguiente?**
Hoy, en cuatro pantallas de Gastos, **es del mes siguiente**, porque usan la hora de Londres. Nadie
lo decidió: se arrastró. Antes de arreglarlo quiero confirmar que la respuesta obvia (es del 31)
es la correcta también para vos, porque toca el Flujo de Caja y la conciliación.

**3. Cuando el cajero tipea `15.000` en la tablet, ¿son quince mil pesos o quince?**
En *Retiros sin clasificar* el sistema entiende **quince**. En *Cierre de Caja* entiende **quince
mil**. Las dos pantallas las usa la misma persona el mismo día. Decime cuál es la forma en que tu
gente tipea de verdad y unifico todo a esa.

**4. ¿Cuál es el margen mínimo aceptable, y quién lo decide?**
Hay tres respuestas distintas al mismo tiempo: la configuración por categoría (que vos podés
cambiar), un 50 %/65 % fijo en Menú, y un 40 %/60 % fijo en Ventas. **Si cambiás el mínimo de una
categoría, dos de las tres pantallas te ignoran.** ¿La configuración tiene que mandar en todas?

**5. ¿El margen tiene que descontar el empaque, sí o no?**
Ingeniería de Menú y En Vivo Fudo lo descuentan; la pantalla de Menú **no**. Por eso el mismo plato
muestra márgenes distintos según dónde lo mires, y la diferencia no es de redondeo.

### Sobre cosas que están construidas y no se usan

**6. ¿Se tiene que poder anular una mesa?**
La base lo soporta, el código para hacerlo existe y funciona, **pero no hay ningún botón**. Parece
un cabo suelto de la migración 193 que quedó a mitad de camino. ¿Lo terminamos o lo sacamos?

**7. ¿Los precios por canal (salón / mostrador / delivery) siguen en pie?**
Están modelados y hay un hook escrito para leerlos, pero **no lo llama nadie**: lo único que se usa
de ese archivo es el nombre de los canales. ¿Es un plan pausado o quedó descartado?

**8. La conciliación por número de operación corre dos veces, ¿lo dejamos así?**
Al importar un extracto se ejecuta primero la función del servidor (más rápida) y después la del
navegador. El comentario del propio código dice *"redundante en parte; pendiente unificar"*. La del
navegador todavía hace algo que la otra no hace, así que **no se puede borrar sin más**.

### Sobre cómo seguimos

**9. ¿Costeo es de Cocina o es un módulo aparte?**
Es la dependencia más fuerte del proyecto: Productos entra 15 veces a Cocina, siempre a buscar lo
mismo (recetas, ingredientes, configuración de costeo). **No son dos módulos que se hablan mucho:
son un módulo partido al medio.** Juntarlos es el cambio de estructura que más ordena de una vez.

**10. Proveedores y medios de pago, ¿son de Gastos?**
Hoy viven adentro de Gastos y Compras, Finanzas y RRHH tienen que entrar ahí a buscarlos: **17 de
las dependencias entre módulos son por eso**. Y ya empezó a romperse: la pantalla de Aguinaldos se
armó su propia lista de medios de pago con 4 de los 7 valores.

**11. ¿Cuál va a ser el próximo módulo que toquemos a fondo?**
Lo pregunto porque conviene aprovechar ese trabajo para partir el archivo grande que tenga al lado,
en vez de hacer una reorganización general que toque todo. `ProduccionQRPage.tsx` tiene 6.108
líneas y `ComprasPage.tsx` 4.905.

**12. La regla de contar las filas después de escribir se cumple en 1 de cada 6 casos. ¿Cerramos el
agujero de raíz o vamos pantalla por pantalla?**
Hay 158 escrituras sin verificar. Ir una por una es largo y se vuelve a despintar. La alternativa
es poner una sola pieza intermedia por la que pasen todas y que avise sola — es más trabajo al
principio y después no hay que acordarse nunca más. **Es una decisión de tiempo, y es tuya.**

**13. ¿Querés que Vedia y Saavedra puedan tener reglas distintas de verdad?**
Lo pregunto porque varias de las diferencias que encontré **podrían ser intencionales** y yo no
puedo saberlo leyendo. Si la respuesta es sí, hay que hacerlo explícito; si es no, son todos bugs.

---

## Lo que esta auditoría NO miró

Para que quede registrado y se pueda completar en otra pasada:

1. **Duplicación de reglas fiscales (IVA, CUIT, comprobantes).** Es el hueco más grande. En
   particular quedó sin verificar **si alguna regla de IVA está escrita en el frontend y otra vez
   en SQL**, que sería lo más grave. Vi que `MenuTab`, `useCostoPorFudo` y `useMenuEngineering`
   repiten `configGen?.iva_pct ?? 0.21` cada uno por su lado, pero no lo seguí hasta el fondo.
2. **Las 207 migraciones y las 22 edge functions**, salvo de refilón. 25.586 líneas sin auditar.
3. **Duplicación de componentes visuales** (modales de confirmación, tablas con el mismo
   esqueleto). Estaba en la búsqueda que se cortó.
4. **Las policies de RLS.** Nada de esto mira la seguridad; para eso está el subagente
   `rls-auditor` y `scripts/mapa-erp/`.
5. **Rendimiento**: consultas repetidas, `queryKey` compartidas, renders de más.
6. **`agente-impresion/`** (720 líneas) y **`scripts/`** (1.336): quedaron fuera del grafo.
