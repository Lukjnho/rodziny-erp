---
description: Agrega un nuevo flujo al QR de producción de Cocina (botón en grid + form modal + insert a tabla).
argument-hint: <nombre_del_flujo>
allowed-tools: Read, Edit, Write, Glob, Grep
---

El usuario quiere sumar un flujo nuevo al QR de producción (página pública sin auth donde los operarios cargan lotes). Argumento: $ARGUMENTS (nombre del flujo, ej: `Marinado`, `Cocción`).

Si $ARGUMENTS está vacío, pedí el nombre antes de seguir.

# Contexto

- Archivo principal: `src/modules/cocina/ProduccionQRPage.tsx`. Es grande (>2000 líneas), no lo cargues entero — usá Read con offsets o Grep dirigido.
- Flujos existentes para tomar de referencia: Relleno, Masa, Pasta, Salsa, Postre, Prueba, Pastelería, Panadería.
- Tablas asociadas en Supabase: `cocina_lotes_<flujo>` (ej: `cocina_lotes_relleno`).
- Cada flujo típicamente tiene: una receta seleccionable de `cocina_recetas` filtradas por categoría/local, un peso o cantidad, observaciones libres.

# Pasos

1. **Confirmá con el usuario** los detalles antes de generar nada:
   - Categoría de receta que filtra el flujo (campo `categoria` en `cocina_recetas`).
   - Local: solo Vedia, solo Saavedra, o ambos.
   - Campos del form: ¿peso en kg? ¿unidades? ¿observaciones? ¿algún ratio derivado?
   - Si necesita tabla nueva o reutiliza una existente.

2. **Si necesita tabla nueva**, delegá al agente `supabase-migrator` con la spec de la tabla. Espera que termine antes de seguir.

3. **Editar `ProduccionQRPage.tsx`**:
   - Buscá con Grep el patrón de un flujo similar (ej: `'Relleno'` o `'modalRelleno'`) y replicá:
     - Estado del modal (`useState`).
     - Botón en el grid principal con icono lucide y color consistente.
     - Modal con form (validaciones + estado del form).
     - useQuery de recetas filtrado por categoría.
     - useMutation con `onSuccess`: cerrar modal PRIMERO, después invalidar queries (regla del proyecto, evita race condition).
     - Manejo de errores con toast/mensaje.

4. **Si la admin (`ProduccionTab.tsx`) muestra los lotes**, agregá el tipo nuevo al merge de `lotesUnificados` y al `TIPO_LOTE_LABEL` / `TIPO_LOTE_COLOR`.

5. **Build de verificación**: avisá al usuario que corra `/deploy` o `npm run build` para validar tipos.

# Reglas

- **No dupliques código**: si hay un componente de form similar, factorizá en `components/` antes de copiar el bloque entero.
- **El insert al QR público** funciona porque las RLS de `cocina_lotes_*` permiten `auth.uid() is null`. Si la tabla nueva no tiene esa policy, el flujo va a fallar — verificá.
- **Cerrar modal antes de invalidar queries** en `onSuccess` (regla establecida en el proyecto).
- Si el flujo arrastra ratios o cálculos derivados (como semolín/huevo en ñoquis), pedí los números explícitos al usuario — no inventes proporciones.
