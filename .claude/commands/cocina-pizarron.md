---
description: Muestra el plan de cocina de una fecha (planificado vs registrado) por local. Default: hoy.
argument-hint: [YYYY-MM-DD] [vedia|saavedra]
allowed-tools: mcp__supabase__execute_sql, Bash(date:*)
---

El usuario quiere ver el estado del pizarrón de Cocina para una fecha. Argumentos: $ARGUMENTS (puede traer fecha y/o local).

# Parseo de argumentos

- Si hay una fecha en formato `YYYY-MM-DD`, usala. Si no, usá la fecha de hoy (Argentina, UTC-3).
- Si menciona `vedia` o `saavedra`, filtrá por ese local. Si no, mostrá ambos.
- Ejemplos válidos: `` (hoy, ambos), `2026-04-26`, `vedia`, `2026-04-26 saavedra`.

# Consultas (en paralelo si es viable)

1. **Plan**: items planificados en `cocina_pizarron_items` para la fecha y local.
   ```sql
   select
     pi.id,
     pi.local,
     r.nombre as receta,
     pi.cantidad_objetivo,
     pi.unidad,
     pi.estado,
     pi.notas
   from cocina_pizarron_items pi
   left join cocina_recetas r on r.id = pi.receta_id
   where pi.fecha_objetivo = '<fecha>'
     <and pi.local = '<local>' si aplica>
   order by pi.local, r.nombre;
   ```

2. **Registrado** (lotes producidos efectivamente esa fecha):
   ```sql
   -- Pasta
   select 'pasta' as tipo, p.local, r.nombre as receta,
          coalesce(p.unidades_producidas, 0) as unidades, p.created_at
   from cocina_lotes_pasta p
   left join cocina_recetas r on r.id = p.receta_id
   where p.fecha = '<fecha>' <and p.local = ...>
   union all
   -- Relleno
   select 'relleno', l.local, r.nombre, l.peso_total_kg::numeric, l.created_at
   from cocina_lotes_relleno l
   left join cocina_recetas r on r.id = l.receta_id
   where l.fecha = '<fecha>' <and l.local = ...>
   union all
   -- Masa
   select 'masa', l.local, r.nombre, l.peso_total_kg::numeric, l.created_at
   from cocina_lotes_masa l
   left join cocina_recetas r on r.id = l.receta_id
   where l.fecha = '<fecha>' <and l.local = ...>
   union all
   -- Producción adicional (salsas, postres, etc)
   select 'extra', l.local, r.nombre, l.cantidad::numeric, l.created_at
   from cocina_lotes_produccion l
   left join cocina_recetas r on r.id = l.receta_id
   where l.fecha = '<fecha>' <and l.local = ...>
   order by 2, 3;
   ```
   (Si alguna de estas tablas no existe en el proyecto actual, omitilá silenciosamente; no inventes esquemas.)

# Output

Una tabla por local, así:

```
# Pizarrón Cocina — <fecha> — <Local>

## Planificado
| Receta | Objetivo | Unidad | Estado | Notas |

## Registrado hoy
| Tipo | Receta | Cantidad | Hora |

## Cumplimiento
- Recetas planificadas: N
- Cumplidas (registradas ≥ objetivo): N
- En progreso (registradas > 0 < objetivo): N
- Sin registro: N (listalas explícitas si son pocas)

## Producido sin plan
- (lotes registrados de recetas que no estaban en el plan, si las hay)
```

Si la fecha es futura: solo planificado, sin sección de registrado.
Si la fecha no tiene plan ni registro: decilo claro, no fuerces tabla vacía.
