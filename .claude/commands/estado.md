---
description: Dónde está parado el ERP hoy — código, base, cabos sueltos y qué conviene hacer.
allowed-tools: Bash, PowerShell, Read, Glob, Grep, mcp__supabase__list_migrations, mcp__supabase__get_advisors
---

Lucas quiere saber dónde está parado el proyecto antes de arrancar. No le pidas
argumentos, este comando no toma ninguno. Juntá los datos en paralelo y contestá corto.

Este comando NO repite lo que ya está escrito en la memoria. Lee la memoria y la base
en vivo, y apunta a los archivos. Si te encontrás copiando párrafos de una memoria,
pará: poné el link y seguí.

# 1. Código

En paralelo:

- `git fetch origin` y después comparar: `git rev-list --left-right --count main...origin/main`.
  Izquierda = commits tuyos sin subir. Derecha = commits de producción que no tenés.
- `git status --short` — qué quedó sin commitear.
- `git log -3 --format='%h %s'` — en qué se venía trabajando.

Si `git fetch` falla por red, decilo y seguí con el resto. No inventes el estado remoto.

# 2. Base

En paralelo:

- `mcp__supabase__list_migrations` — cuál es la última aplicada.
- Listar `supabase/migrations/*.sql` y comparar los números contra la anterior.
  Toda migración escrita con número mayor a la última aplicada está **colgada**.
- `mcp__supabase__get_advisors` type `security` — contar solo ERROR y WARN, ignorar INFO.

# 3. Colgados

- Leer el inventario de cabos sueltos en la carpeta de memoria del proyecto
  (`inventario-cabos-sueltos-*.md`). Si hay varios, el más reciente.
- Buscar en `MEMORY.md` las líneas que contengan `PENDIENTE`, `BLOQUEA`, `⛔` o `⏳`.
- No listes los 27. Elegí los que importan hoy según el punto 1 y 2.

# Reporte

Contestá con esta forma exacta, en español y en criollo:

```
# Estado del ERP — <fecha de hoy>

## Código
- Local vs producción: <al día | N commits atrás | N sin subir>
- Sin commitear: <nada | lista corta>
- Veníamos con: <el último commit en una línea>

## Base
- Última migración aplicada: <NNN_nombre>
- Migraciones colgadas: <ninguna | NNN, NNN>
- Seguridad: <sin hallazgos | X errores, Y advertencias>

## Colgado de antes
- <hasta 4 items, el que más duele primero, con link al archivo de memoria>

## Lo que haría hoy
<UNA sola cosa, con el motivo en una línea. Si hay algo que bloquea todo lo demás,
esa es la respuesta.>
```

# Reglas

- Cada bloque, cinco líneas como máximo. Si algo está sano, una línea alcanza:
  "Al día", "Sin migraciones colgadas".
- La recomendación es **una sola cosa**, no una lista para que elija él. Con el motivo.
  Si de verdad hay un empate, decí las dos y cuál elegirías vos.
- Si la copia local está atrás de producción, eso va primero y la recomendación es
  actualizar antes de tocar nada (ver `working-copy-detras-de-prod`).
- Si hay migraciones colgadas, eso pesa más que cualquier cabo suelto viejo.
- Nada de relato ni de "como podemos ver". Datos y una decisión.
- Si un dato no se pudo obtener, escribí "no pude averiguarlo" y por qué. Nunca lo
  completes de memoria ni de una sesión anterior.
