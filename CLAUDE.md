# Instrucciones del proyecto — rodziny-erp

## El mapa del proyecto (graphify)

Hay un mapa en `graphify-out/` (fuera de git). Se arma con la skill **`/graphify`** y
al 10-sep-2026 tiene **3.347 piezas y 4.997 conexiones** sobre 475 archivos.

A diferencia del mapa viejo, este **también lee los documentos y las imágenes**, no solo
el código, y deja un **wiki navegable en `graphify-out/wiki/index.md`**.

    /graphify .            # rehacer todo
    /graphify . --update   # solo lo que cambió (documentos e imágenes incluidos)
    graphify query "..."   # preguntarle al mapa en vez de leer archivos
    graphify path "A" "B"  # cómo se conecta A con B
    graphify explain "X"   # qué es X, en castellano

### Regla 1 — Preguntale al mapa antes de abrir archivos

`graphify query` cuesta **38 veces menos tokens** que leer los archivos crudos (medido
sobre este repo, no es una promesa del fabricante). Para explorar, primero el mapa.

Si el mapa **no está** (otra máquina, carpeta borrada), usá Grep/Glob/Read y seguí.
**No te quedes trabado**: el mapa es una comodidad, no un requisito.

### Regla 2 — El mapa conoce la base COMO FUE ESCRITA, no como está aplicada

Lee los 207 `.sql` de `supabase/migrations/`, así que conoce el esquema **escrito**.
La diferencia con lo aplicado existe y ya mordió: **la migración 072 está escrita y nunca
se aplicó**.

Para tablas reales, RLS, permisos, policies y datos, la verdad son **las tools de Supabase
MCP** y el subagente `rls-auditor`. Nunca el mapa.

> 🔑 Hay un camino para cerrar esto: `graphify --postgres DSN` se conecta a Postgres en
> transacción `SERIALIZABLE READ ONLY` y reconstruye el esquema **aplicado**. Requiere
> `uv tool install "graphifyy[sql,postgres]"` y un usuario de solo lectura.
> **Ojo: NO lee las policies de RLS** ⇒ no reemplaza a `scripts/mapa-erp/`, que es el que
> mide las tablas que guardan el `local` y cuya regla no lo mira. Se complementan.

### Regla 3 — El mapa ENCUENTRA, no DECIDE

Sirve para saber dónde mirar y quién llama a qué. No sirve para afirmar cómo se comporta
algo. Si el cambio es riesgoso, **abrí el archivo y leelo** antes de concluir.

Las reglas de negocio (precios, márgenes, EdR, qué suma y qué pisa) **jamás** salen del
mapa: salen de la memoria del proyecto y de Lucas.

### Regla 4 — El código se actualiza solo. Los documentos NO

Un hook de `post-commit` rehace la parte de **código** después de cada commit, sin que
nadie se acuerde de nada.

**Pero los documentos, las imágenes y los `.md` no entran en ese refresco.** Si tocaste un
`.md`, un ícono o un README, corré `/graphify . --update` a mano o el mapa va a contestar
sobre la versión vieja **con la misma seguridad que si estuviera al día**. Ese sigue siendo
su peor defecto.

### Regla 5 — Antes de crear o mover algo, preguntá DÓNDE va

Módulo nuevo, arreglo, o mudanza de una función: **primero el mapa, después el editor.**

    graphify query "donde vive el costeo de recetas"      # en qué barrio cae
    graphify path "CajaPage" "ventas_items"               # por dónde pasa hoy
    graphify explain "invalidarStockCocina"               # qué toca si lo muevo

El mapa agrupa el proyecto en barrios con nombre (Cocina, Conciliación bancaria, Fichaje,
Facturación ARCA…). **Lo nuevo va en el barrio que ya existe**, no en uno propio. Si no
aparece ningún barrio que lo contenga, eso es la señal de que falta hablarlo con Lucas,
no de que haya que inventar una carpeta.

### 💣 Trampas del mapa

- **El extra `[sql]` es obligatorio.** Sin él los 207 archivos de la base **aportan cero**
  y lo avisa en un renglón perdido entre el ruido. Instalación correcta:
  `uv tool install "graphifyy[sql]"`.
- **El caché guarda los resultados vacíos.** Si faltaba un lector y lo instalás después,
  hay que borrar `graphify-out/cache/` y rehacer, o el agujero queda pegado.
- **519 conexiones cuelgan en el aire** (10-sep-2026): apuntan a tablas nombradas en SQL
  que ningún archivo define. No es corrupción. Ese número tiene que **bajar, no subir**.

---

## Los otros dos mapas

- **`scripts/mapa-erp/`** — el único que mide el **orden de la base**: cuántas tablas
  guardan el `local` y la regla no lo mira. Graphify **no** hace esto. Se regenera aparte.
- **`.code-review-graph/`** — **JUBILADO el 10-sep-2026**, absorbido por graphify.
  Si ves las tools `mcp__code-review-graph__*`, ignoralas.

---

## Reglas del proyecto (independientes del mapa)

### Toda escritura a la base tiene que contar las filas que tocó

Un `UPDATE` o `DELETE` que la RLS bloquea devuelve **0 filas y NINGÚN error**.
Compila, corre, no falla, y no hace nada. Ya pasó tres veces (candado de local,
sueldos que pisaban el comprobante, aviso entre ventanas de Caja).

Toda escritura debe verificar cuántas filas afectó y avisar si fueron 0.
No alcanza con que no tire error.

### Validar el build antes de pushear

    npm run build    # tsc -b && vite build

`tsc -b` ya avisa si rompiste algo del lado de TypeScript. Es la red de seguridad
más barata que hay y es gratis.
