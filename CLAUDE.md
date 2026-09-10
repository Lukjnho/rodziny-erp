# Instrucciones del proyecto — rodziny-erp

## El mapa del código (code-review-graph)

Hay un mapa del código en `.code-review-graph/` (fuera de git): 429 archivos,
~1.900 piezas y ~24.800 conexiones. Se consulta con las tools `mcp__code-review-graph__*`.

### Regla 1 — Usalo si está, no insistas si no está

Si las tools del grafo **están disponibles**, preferilas antes que Grep/Glob/Read
para explorar: son más rápidas y gastan muchos menos tokens.

Si **no están** (otra máquina, servidor caído, mapa corrupto), usá Grep/Glob/Read
normalmente y seguí. **No reintentes ni te quedes trabado**: el mapa es una comodidad,
no un requisito. El aviso al arrancar la sesión dice si está o no.

### Regla 2 — El mapa es para el CÓDIGO. Para la BASE, nunca

El mapa lee los 205 archivos `.sql` de `supabase/migrations/`, o sea que conoce
el esquema **tal como fue escrito**, no lo que está realmente aplicado en Supabase.
Esa diferencia existe y ya mordió (la migración 072 está escrita y nunca se aplicó).

Para cualquier cosa de la base — tablas reales, RLS, permisos, políticas, datos —
la verdad son **las tools de Supabase MCP** y el subagente `rls-auditor`. Nunca el mapa.

### Regla 3 — El mapa ENCUENTRA, no DECIDE

Sirve para saber dónde mirar y quién llama a qué. No sirve para afirmar cómo se
comporta algo. Si el cambio es riesgoso, **abrí el archivo y leelo** antes de concluir.

Las reglas de negocio (precios, márgenes, EdR, qué suma y qué pisa) **jamás** salen
del mapa: salen de la memoria del proyecto y de Lucas.

### Regla 4 — Puede estar viejo. Chequealo

El mapa **no** se actualiza después de cada edición (cuesta 1,5 seg por vez y no
se justifica). Se refresca en dos momentos: al arrancar la sesión y antes de cada commit.

El aviso de arranque muestra en qué commit fue construido. **Si no coincide con el
estado actual, o si editaste archivos en esta sesión, refrescalo antes de confiar en él**:

    code-review-graph update --repo "C:/dev/rodziny-erp"

Un mapa viejo contesta con la misma seguridad que uno al día. Ese es su peor defecto.

### Tools

| Tool | Para qué |
| ---- | -------- |
| `semantic_search_nodes_tool` | Buscar una función/clase por nombre o palabra clave |
| `query_graph_tool` | Quién llama a qué (callers_of, callees_of, imports_of, tests_for) |
| `get_impact_radius_tool` | Qué se rompe si toco esto |
| `get_affected_flows_tool` | Qué recorridos del sistema quedan afectados |
| `detect_changes_tool` | Revisar cambios con puntaje de riesgo |
| `get_review_context_tool` | Traer solo los pedazos de código necesarios para revisar |
| `get_architecture_overview_tool` / `list_communities_tool` | Estructura general, barrios del código |
| `refactor_tool` / `find_large_functions_tool` | Planear renombres, encontrar código muerto |

Comandos manuales (desde la raíz del repo): `status`, `update`, `build`,
`visualize`, `detect-changes`.

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

**Ojo con los nombres**: todas terminan en `_tool` y llevan el prefijo
`mcp__code-review-graph__`. Hay 30 en total; las de arriba son las que más se usan.
Otras útiles: `get_hub_nodes_tool` (las piezas que más se tocan), `get_bridge_nodes_tool`
(las que conectan dos barrios — romperlas duele), `get_knowledge_gaps_tool`.
