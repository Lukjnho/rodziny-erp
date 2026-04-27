---
description: Build local + commit + push del repo rodziny-erp. Aborta si tsc -b o vite build fallan.
argument-hint: [mensaje de commit opcional]
allowed-tools: Bash(npm run build), Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*), Bash(git rev-parse:*)
---

El usuario quiere desplegar los cambios locales del ERP. Argumento opcional: $ARGUMENTS (si está, usalo como mensaje de commit; si no, redactalo vos).

Pasos en este orden estricto. Si algún paso falla, ABORTÁ y reportá el error sin continuar.

1. **Verificar estado**. Corré en paralelo: `git status`, `git diff --stat`, `git log -5 --oneline`. Si no hay cambios, avisá y terminá.

2. **Build completo**. `npm run build` en el repo. Vercel usa `tsc -b && vite build`, así que `tsc --noEmit` solo NO alcanza. Si falla:
   - Mostrá los primeros errores de tipo/build (no toda la salida).
   - Sugerí qué archivo mirar.
   - NO commitees nada. Terminá ahí.

3. **Commit**. Si el build pasa:
   - Si $ARGUMENTS está vacío, redactá un mensaje de commit en español siguiendo conventional commits: `feat(modulo): ...` o `fix(modulo): ...` o `refactor(modulo): ...`. Mirá `git log -10 --oneline` para tomar el estilo.
   - El commit debe terminar con la línea (separada por una línea en blanco):
     ```
     Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
     ```
   - Stageá solo los archivos relevantes (no `git add -A` si hay cosas raras como `tmp_*` o archivos sin rastrear que no son del cambio).
   - Usá heredoc para el mensaje multilinea.

4. **Push**. `git push`. Si la rama no tiene upstream, usá `git push -u origin <branch>`.

5. **Reporte final**. En 2-3 líneas:
   - Hash corto del commit.
   - Mensaje del commit.
   - Vercel va a construir automático en https://rodziny-erp.vercel.app — recordáselo a Lucas si la build local tardó (señal de que la de Vercel también va a tardar).

# Reglas

- **NUNCA** uses `--no-verify` ni saltees hooks.
- **NUNCA** uses `git push --force` sin confirmación explícita del usuario.
- Si hay archivos sospechosos sin trackear (`.env`, credenciales, dumps grandes), pará y avisá antes de stagear nada.
- Si la rama es `main` o `master` y hay muchos cambios, pedí confirmación antes del push.
