---
description: Crea un archivo de migración SQL nuevo en supabase/migrations/ con el próximo número correlativo y plantilla base. Argumento: nombre descriptivo en snake_case.
argument-hint: <nombre_descriptivo_snake_case>
allowed-tools: Bash(ls:*), Read, Write, Glob
---

El usuario quiere generar una migración SQL nueva. Argumento: $ARGUMENTS (nombre descriptivo, ej: `cocina_pure_papa_semolin_huevo`).

Si $ARGUMENTS está vacío o tiene espacios sin convertir a snake_case, pedí el nombre antes de continuar.

# Pasos

1. **Listar migraciones existentes** en `c:/Users/Lukjnho/OneDrive/Escritorio/rodziny-erp/supabase/migrations/` con `Glob` (`supabase/migrations/*.sql`). Buscá el número más alto y sumale 1. Pad a 3 dígitos (`031`, `032`, ...).

2. **Mirá la última migración** con `Read` para tomar el estilo de header y comentarios.

3. **Crear archivo** `supabase/migrations/<NNN>_<nombre>.sql` con esta plantilla base (adaptala al cambio que el usuario describió antes; si no describió nada, dejala como skeleton comentado para que la complete):

   ```sql
   -- <NNN>_<nombre>.sql
   -- <descripción breve en español: qué cambia y por qué>

   -- Ejemplo: agregar columna idempotente
   -- alter table <tabla>
   --   add column if not exists <col> <tipo>
   --     check (<col> is null or <col> >= 0);
   --
   -- comment on column <tabla>.<col> is '<descripción>';

   -- Ejemplo: tabla nueva con RLS
   -- create table if not exists <tabla> (
   --   id uuid primary key default gen_random_uuid(),
   --   local text not null check (local in ('vedia','saavedra')),
   --   created_at timestamptz not null default now()
   -- );
   --
   -- alter table <tabla> enable row level security;
   --
   -- drop policy if exists "<tabla> select" on <tabla>;
   -- create policy "<tabla> select" on <tabla>
   --   for select using (tiene_permiso('<modulo>'));
   ```

4. **Reporte final**: archivo creado (path), próximos pasos sugeridos:
   - Si querés que la aplique directo: invocá al subagente `supabase-migrator`.
   - Si querés revisar primero: editá el archivo y después aplicalo manualmente o con el agent.

# Reglas

- **No apliques** la migración acá — solo creás el archivo. Para aplicar, está el agente `supabase-migrator`.
- Si el nombre incluye algo que parece destructivo (`drop_`, `delete_`, `truncate_`), pedí confirmación de que es intencional antes de crearlo.
- Si ya existe un archivo con el mismo número (race), usá el siguiente y avisá.
