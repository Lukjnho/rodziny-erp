---
description: Salud de la base Supabase del ERP — tablas, advisors de seguridad y errores recientes en logs.
allowed-tools: mcp__supabase__list_tables, mcp__supabase__get_advisors, mcp__supabase__get_logs, mcp__supabase__list_migrations
---

El usuario quiere un diagnóstico rápido del estado de la base. Corré las llamadas MCP en paralelo y armá un reporte ejecutivo.

# Llamadas (en paralelo)

1. `mcp__supabase__list_tables` schemas: `["public"]` — para contar tablas.
2. `mcp__supabase__get_advisors` type: `"security"` — vulnerabilidades activas.
3. `mcp__supabase__get_advisors` type: `"performance"` — sugerencias de índices, etc.
4. `mcp__supabase__get_logs` service: `"api"` — errores recientes en API.
5. `mcp__supabase__list_migrations` — última migración aplicada.

# Reporte (en español, ejecutivo)

```
# Supabase status — <fecha actual>

## Resumen
- Tablas (public): N
- Última migración: NNN_<nombre>
- Security advisors: X errores / Y warnings
- Performance advisors: X sugerencias
- Errores API recientes: N (últimos 60 min)

## Security
- (lista solo de severidad ERROR y WARN; ignorá INFO si son ruidosos)

## Performance
- (top 3 sugerencias por impacto)

## Logs API
- (top 3 endpoints con más errores y patrón del error)

## Recomendación
- (1-2 líneas: ¿hay que actuar ahora? ¿qué prioridad?)
```

# Reglas

- Si todo está sano, decilo claro: "Sin hallazgos críticos."
- No expongas secrets ni tokens si aparecen en logs.
- Si get_logs devuelve "no logs in last hour", reportalo como tal — no inventes errores.
- No hace falta pedir argumentos al usuario; este comando no toma ninguno.
