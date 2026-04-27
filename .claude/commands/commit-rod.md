---
description: Crea un commit en español con scope correcto siguiendo conventional commits del proyecto. NO pushea.
argument-hint: [hint opcional sobre el cambio]
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git diff --staged:*), Bash(git log:*), Bash(git add:*), Bash(git commit:*)
---

El usuario quiere committear los cambios actuales con el estilo del proyecto. Argumento opcional: $ARGUMENTS (pista sobre el cambio si la querés tomar de hint).

# Pasos

1. **Diagnóstico en paralelo**:
   - `git status` (sin `-uall`).
   - `git diff` (cambios no staged).
   - `git diff --staged` (lo que ya está staged).
   - `git log -10 --oneline` (estilo previo).

2. **Si no hay nada que committear**, avisá y terminá.

3. **Detectar scope** mirando los paths de los archivos modificados:
   - `src/modules/cocina/*` → `feat(cocina):` / `fix(cocina):` / `refactor(cocina):` etc.
   - `src/modules/almacen/*` → `(almacen)`
   - `src/modules/rrhh/*` → `(rrhh)`
   - `supabase/migrations/*` → `(db)`
   - Múltiples módulos / cambios cross-cutting → sin scope o `(core)`.

4. **Determinar tipo**:
   - `feat`: funcionalidad nueva.
   - `fix`: bug fix.
   - `refactor`: cambio interno sin cambio de comportamiento.
   - `chore`: build, deps, configs.
   - `docs`: solo docs/CLAUDE.md.
   - `style`: formato, espacios.

5. **Redactar mensaje**:
   - Primera línea: `<tipo>(<scope>): <descripción imperativa en español>`. Máx ~70 chars.
   - Cuerpo (opcional, separado por línea en blanco): bullets de los cambios principales si son varios.
   - Footer (obligatorio):
     ```
     Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
     ```

6. **Stagear y committear**. Si hay archivos no relacionados sin trackear, NO los incluyas — preguntá. Pasá el mensaje con heredoc:
   ```
   git commit -m "$(cat <<'EOF'
   <tipo>(<scope>): <descripción>

   - cambio 1
   - cambio 2

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

7. **Verificar** con `git status` y reportar el hash corto + mensaje.

# Reglas

- **No pushees**. Este comando solo committea. Para push usar `/deploy`.
- **No skipees hooks** (`--no-verify`). Si un hook falla, mostrá el error y pará — investigamos primero.
- **No `git add -A`** si hay archivos sospechosos (`tmp_*`, `.env`, dumps). Stageá lo relacionado al cambio.
- Si hay cambios en `supabase/migrations/` sin aplicar, avisá antes de committear que falta correrlos.
