# Informe de la memoria — para decidir qué se fusiona y qué se tira

**Fecha:** 10-sep-2026 · **Carpeta:** `~/.claude/projects/c--dev-rodziny-erp/memory/`
(que en realidad es `G:\Mi unidad\claude-memoria-rodziny`, sincronizada entre las dos compus)

> ⚠️ **Nada de esto está hecho.** Este documento **mide y describe**. No borré, no
> fusioné y no moví ni un archivo. Las decisiones son tuyas: marcá lo que querés en
> cada tabla y yo lo ejecuto después.

---

## 1. El número, y por qué molesta ahora

| | |
|---|---:|
| **`MEMORY.md` hoy** | **22.854 bytes** |
| Techo con el que venimos trabajando | ~24.400 bytes |
| Ocupado | **≈ 94 %** |
| Renglones del índice | 133 |
| Enlaces del índice | 310 |
| Archivos de memoria en la carpeta | **333** |
| **Sin indexar** | **23** |
| Enlaces rotos | **0** ✅ |

**Qué pasa si se pasa del techo.** `MEMORY.md` es el único archivo de memoria que se
carga entero al empezar cada sesión. Si no entra, se corta — y **lo que se corta es el
final del archivo**, no lo menos importante. Hoy el final son *Gastos / finanzas*, *RRHH*
y *Otros módulos*. O sea: el primer módulo que se queda sin índice sería el de la plata.

**Cuánto hay que bajar.** Para volver a un 80 % cómodo hay que sacar **unos 3.400 bytes**
del índice. No es mucho: con las dos primeras decisiones de este informe ya alcanza.

> 💡 **Dos cosas que se confunden y no son lo mismo:**
> - **El índice** (`MEMORY.md`) es lo que está apretado. Cada enlace ahí cuesta ~55-70 bytes.
> - **Las notas** (los 333 `.md`) no ocupan lugar en la sesión: se leen solo cuando hacen
>   falta. Una nota grande no molesta. **Molesta un renglón de índice largo.**
>
> Por eso fusionar 7 notas en 1 ahorra mucho más de lo que parece: no ahorra por el
> contenido, ahorra porque saca 6 enlaces del índice.

---

## 2. Cómo se reparte el índice hoy

| Sección | Bytes | % | Renglones | Enlaces |
|---|---:|---:|---:|---:|
| Gastos / finanzas / conciliación | 4.483 | 20,1 % | 24 | 74 |
| Usuario / trabajo | 4.098 | 18,3 % | 23 | 40 |
| Cocina — producción / pizarrón | 2.795 | 12,5 % | 14 | 45 |
| Referencias técnicas | 1.941 | 8,7 % | 11 | 32 |
| POS propio (reemplazar Fudo) | 1.912 | 8,6 % | 15 | 21 |
| Cocina: poda + stock — EN CURSO | 1.638 | 7,3 % | 12 | 20 |
| Otros módulos / negocio | 1.620 | 7,2 % | 10 | 23 |
| Productos / costeo | 1.420 | 6,4 % | 7 | 24 |
| RRHH / personal | 1.171 | 5,2 % | 7 | 18 |
| Web pública / landing / marca | 672 | 3,0 % | 5 | 5 |
| Setup / infraestructura | 522 | 2,3 % | 4 | 7 |
| Proyectos aparte | 85 | 0,4 % | 1 | 2 |

Dos secciones se llevan **el 38 %**. Y no es porque tengan más temas: es porque tienen
muchos enlaces chiquitos sobre el mismo asunto.

---

## 3. Los renglones más caros del índice

Los 10 más largos suman **2.982 bytes** — el 13 % del archivo en el 7,5 % de los renglones.

| Bytes | Enlaces | De qué habla el renglón |
|---:|---:|---|
| **433** | 7 | **Pagos fijos** |
| 301 | 3 | Bloque 1 decidido (9-sep): la porción, Bolognesa/Mezzelune, qué lleva stock |
| 298 | 5 | **Pizarrón** |
| 297 | 4 | Costeo: matching de subrecetas, colisiones, código UNIQUE |
| 292 | 5 | **Subrecetas** |
| 285 | 5 | Adelantos + **OCR** |
| 251 | 2 | Las 54 preguntas + el mapa de cruces |
| 246 | 4 | Alertas de finanzas |
| 240 | 5 | **Fudo API** |
| 239 | 4 | Mercado Pago + medios de pago |

---

## 4. Candidatas a FUSIONARSE — porque tratan del mismo tema

Marcá una opción en cada grupo. **Fusionar** = una sola nota con todo adentro y un solo
enlace en el índice. **Dejar** = queda como está.

### 🔴 Grupo 1 — Pagos fijos · 7 notas · 17.000 b · **ahorra ~355 b de índice**

| Nota | Bytes |
|---|---:|
| `project_pagos_fijos_periodo_vs_vencimiento.md` | 1.906 |
| `project_pagos_fijos_local_y_edr_sas.md` | 1.974 |
| `pagos-fijos-sin-categoria-pendientes.md` | 1.503 |
| `feedback_pagos_fijos_no_cta_cte.md` | 1.261 |
| `calendario-pagos-fijos-alcance.md` | 5.541 |
| `checklist-pagos-fijos-bugs-fixes.md` | 2.475 |
| `pagos-fijos-escrituras-silenciosas.md` (3-sep) | 2.340 |

**Es el renglón más caro del índice y es todo el mismo tema.** Mi sugerencia: fusionar
las 6 primeras en una sola (`pagos-fijos.md`) y **dejar aparte** la de escrituras
silenciosas, que es una regla de seguridad viva y no un detalle de pagos fijos.

- [ ] Fusionar las 7 en una
- [ ] Fusionar 6 y dejar `pagos-fijos-escrituras-silenciosas.md` aparte *(sugerida)*
- [ ] Dejar como está

### 🟠 Grupo 2 — Cocina Saavedra, junio 2026 · 5 notas · 37.205 b · **ahorra ~165 b**

| Nota | Bytes |
|---|---:|
| `project_cocina_saavedra_cierres.md` | **22.236** ← la nota más grande de toda la memoria |
| `project_saavedra_cocina_control_y_roles.md` | 5.086 |
| `project_cocina_hardening_2026_06.md` | 4.370 |
| `project_cocina_saavedra_qr_2026_06.md` | 3.826 |
| `project_cierre_qr_fecha_y_rls.md` | 1.687 |

Cuatro notas del mismo mes sobre la misma puesta en marcha. **Antes de fusionar hay que
leer la de 22 KB**: puede tener adentro cosas que ya no son ciertas.

- [ ] Fusionar las 5 en `cocina-saavedra-puesta-en-marcha.md`
- [ ] Fusionar 4 y dejar `project_cierre_qr_fecha_y_rls.md` (tiene el `CORTE_JORNADA_H=5`)
- [ ] Dejar como está

### 🟠 Grupo 3 — Pizarrón · 9 notas · 26.377 b · **ahorra ~240 b**

`feedback_pizarron_unica_fuente_verdad` · `project_etapas_pizarron_por_tipo` ·
`project_pizarron_pasta_simple_cumplido` · `project_pizarron_postre_consolidado` ·
`project_camara_baseline_porcionado` · `proyeccion-semanal-se-guarda-en-el-pizarron` ·
`project_pizarron_tablet_deposito` · **+2 sin indexar**:
`project_pizarron_compacto_modal` y `project_pizarron_reset_on_lote_delete`

Dos de las nueve dicen "cumplido" y "consolidado" en el propio nombre.

- [ ] Fusionar todas en `pizarron.md`
- [ ] Fusionar solo las que dicen cumplido/consolidado/modal/reset (4) y dejar el resto
- [ ] Dejar como está

### 🟡 Grupo 4 — Subrecetas · 6 notas · 16.673 b · **ahorra ~200 b**

`project_subrecetas_cocina` · `project_qr_expande_subrecetas` ·
`cocina-dos-motores-de-subrecetas` · `feedback_costeo_matching_subrecetas` ·
`feedback_costeo_colision_receta_vs_subreceta` · `project_subrecetas_rename_mapping`
*(sin indexar)*

💣 Ojo: `cocina-dos-motores-de-subrecetas` y `feedback_costeo_matching_subrecetas`
son **trampas activas** (el matching es por nombre COMPLETO). Fusionar está bien, pero
esas dos advertencias tienen que sobrevivir enteras.

- [ ] Fusionar las 6
- [ ] Fusionar solo `project_subrecetas_rename_mapping` (mapeo de mayo, ya hecho) adentro de otra
- [ ] Dejar como está

### 🟡 Grupo 5 — OCR · 6 notas · 15.170 b · **ahorra ~130 b**

`project_helper_ocr_comprobante` · `project_helper_ocr_factura` ·
`feedback_ocr_parse_prosa_extra` · `gastos-ocr-nunca-autocrea-proveedor` ·
`ocr-sin-creditos-anthropic` · `proveedores-cuit-guiones-vs-ocr`

- [ ] Fusionar las 6 en `ocr.md`
- [ ] Fusionar las 3 de comportamiento y dejar aparte la de créditos (es operativa)
- [ ] Dejar como está

### 🟡 Grupo 6 — Proveedores · 7 notas · 19.774 b · **ahorra ~180 b**

`project_conciliacion_proveedores` · `feedback_display_canonico_proveedor` ·
`feedback_rpc_buscar_proveedor_bug_aliases` · `proveedores-linaje-unificacion` ·
`proveedores-cuit-obligatorio-ocr` · `proveedores-cuit-guiones-vs-ocr` ·
`victorello-es-don-vitto`

- [ ] Fusionar las 7
- [ ] Fusionar las 4 de aliases/linaje y dejar las 2 de CUIT + Victorello
- [ ] Dejar como está

### 🟢 Grupo 7 — José · 4 notas · 8.586 b · **ahorra ~110 b**

`project_perfil_jose_lider_cocina` · `project_kpis_jose_calibrados` ·
`project_segundo_a_cargo_cocina` · `feedback_dos_joses_en_vedia`

💣 La última es la que avisa que **hay dos Josés y tres Lucas**. Esa no se puede perder
en una fusión: es la que evita confundir personas.

- [ ] Fusionar las 4
- [ ] Fusionar las 3 primeras y dejar `feedback_dos_joses_en_vedia` aparte *(sugerida)*
- [ ] Dejar como está

**Si fusionás los 7 grupos: ~1.380 bytes menos de índice, y 44 notas pasan a ser 7.**

---

## 5. Apuntan a cosas ya resueltas o cerradas

Acá la decisión es distinta: **tirar** (borrar la nota) o **bajar de rango** (dejar la
nota pero sacarla del índice, para que ocupe cero y siga estando si alguna vez hace falta).

| Nota | Bytes | Por qué es candidata |
|---|---:|---|
| `empleados-sueldos-expuestos-anon.md` | 4.858 | El propio índice dice **CERRADO** |
| `reference_code_review_graph.md` | 4.731 | **JUBILADO** el 10-sep, lo absorbió graphify |
| `project_mig_072_pendiente.md` | 3.414 | Se llama "pendiente" y **ya está aplicada** |
| `project_migracion_sheets_a_erp.md` | 1.288 | Sheets **en desuso** |
| `reference_sheets_rodziny.md` | 2.134 | Los IDs de unas planillas que ya no se usan |
| `feedback_precommit_hook_git_add_all.md` | 2.260 | **RESUELTO** — pero ojo, arrastra una advertencia viva (el index es compartido entre sesiones) |

> ⚠️ **Cuidado con dos de estas.** `empleados-sueldos-expuestos-anon` y
> `feedback_precommit_hook_git_add_all` dicen "cerrado/resuelto" pero **contienen la
> regla que evita que vuelva a pasar**. Si se tiran, se tira también la razón por la que
> hoy está bien. Mi sugerencia para esas dos es **bajarlas de rango**, no borrarlas.

- [ ] Tirar las 6
- [ ] Tirar 4 y bajar de rango `empleados-sueldos-expuestos-anon` + `feedback_precommit_hook_git_add_all` *(sugerida)*
- [ ] Bajar de rango las 6
- [ ] Dejar como está

### Bienal 2026 — un evento que ya pasó · 9 notas · 27.280 b · **ahorra ~200 b**

`project_bienal_2026` · `project_bienal_pastas_costeo_precios` ·
`bienal-precios-estrategia` · `project_bienal_saavedra_stand` ·
`plan-pagos-bienal-julio-2026` · `cierre-caja-local-bienal` · `fichaje-bienal-qr-evento` ·
`horas-eventos-externos-bienal` · `pos80-bienal-impresora-fudo`

💣 **Tres de estas nueve NO son del evento**: `cierre-caja-local-bienal`,
`horas-eventos-externos-bienal` y `pos80-bienal-impresora-fudo` describen cosas que
**siguen funcionando hoy** (un local en el cierre de caja, las horas de eventos externos,
y una impresora). Sacarlas por decir "bienal" en el nombre sería un error.

- [ ] Fusionar las 6 del evento en `bienal-2026.md` y dejar las 3 que siguen vivas
- [ ] Tirar las 6 del evento
- [ ] Dejar como está

---

## 6. Las 23 notas sin indexar

**Ninguna está rota** — el índice no tiene enlaces muertos. Estas 23 son al revés:
archivos que existen y que el índice no menciona. Hoy son invisibles.

### Las 3 que no son notas de memoria

| Archivo | Bytes | Qué es | Sugerencia |
|---|---:|---|---|
| `README.md` | 643 | El instructivo de la propia carpeta: cómo sincronizar entre las dos compus | **Dejar sin indexar**, está bien así |
| `PRODUCT.md` | 7.492 | Ficha de producto de la **landing** que dejó la herramienta de diseño (Impeccable). Habla del HTML de la maqueta | Mover a la carpeta de la landing o tirar |
| `cabos-sueltos-erp.md` | **20.564** | El informe largo de cabos sueltos en castellano llano (panadería que no descuenta, sueldos que reescriben, 12 recetas de Saavedra costeadas con masa de Vedia…) | **Mover a `docs/` del repo.** Es un informe, no una nota de memoria — y se pisa con `inventario-cabos-sueltos-2026-09.md` (5.489 b, ése sí indexado) |

### Las 20 notas de proyecto — casi todas de mayo/junio y ya hechas

| Nota | Bytes | En una línea |
|---|---:|---|
| `project_commit_pendiente_productos.md` | 1.639 | "HECHO 18-may": módulo Productos + migs 055-064 ya en producción |
| `project_unificacion_costeo.md` | 3.076 | "COMPLETO 3-jun": todo producto se costea en la grilla de recetas; la bebida es receta de 1 insumo |
| `project_vinculacion_fudo_inline.md` | 2.195 | "Implementado 30-may": selector Fudo inline + fix del filtro de Menu Engineering |
| `project_pizarron_compacto_modal.md` | 2.281 | "En prod desde 37d43d0": tarjeta compacta + alerta a 2 días + modal de timeline |
| `project_pizarron_reset_on_lote_delete.md` | 2.696 | Mig 070: al borrar un lote, el ítem del pizarrón vuelve a pendiente |
| `project_cierre_no_marca_pizarron.md` | 2.436 | Mig 078: el cierre físico de mostrador NO marca el pizarrón (columna `origen`) |
| `project_lotes_excluido_analisis.md` | 2.306 | Commit 9ea8cd3: soft-delete de lotes basura + alerta dura de unidad en el QR (3× confirma, 30× bloquea) |
| `project_qr_checklist_obligatorio.md` | 2.135 | Commit ab8edf8: el QR obliga tilde por ingrediente + responsable desde `es_produccion` |
| `fudo-token-cache-pendiente-activar.md` | 2.173 | "ACTIVADO 27-jul": caché de token de Fudo, mig 134 aplicada. **El nombre dice "pendiente" y no lo está** |
| `project_fudo_sync_acotado_meses.md` | 2.214 | La importación de ventas trae solo los últimos 2 meses para no pasarse de los 150 s en Vedia |
| `project_variaciones_costo_inline.md` | 1.936 | Las variaciones de costo se aprueban inline en Nuevo gasto; la cola `productos_costo_pendientes` está borrada |
| `project_subrecetas_rename_mapping.md` | 3.901 | Mapeo viejo→nuevo de las 25 recetas con "Subreceta" en el nombre (22-may) |
| `project_menu_engineering_pendientes.md` | 2.633 | Estado de Menu Engineering al 30-may: qué quedó cerrado y qué falta |
| `project_cierre_de_mes_liviano.md` | 2.475 | Modelo elegido el 9-may: validar que todo esté cargado, sin bloquear ediciones ni guardar foto |
| `project_cierre_mayo_2026_conciliacion.md` | 3.541 | Mecánica y trampas de la conciliación de egresos de MP en el cierre de mayo |
| `project_tarjeta_icbc_y_cierre_mayo.md` | 1.770 | Modelo decidido para la tarjeta ICBC (opción A) + qué faltaba para cerrar mayo |
| `project_refactor_compras_caja.md` | 6.788 | Plan de 6 PRs para unificar la carga de gastos y sacar la duplicación con movimientos bancarios. **¿Se hizo?** |
| `project_auditoria_erp_tab_por_tab.md` | 2.605 | La auditoría tab por tab que arrancaste en mayo 2026 |
| `project_ciclo_completo_otra_sesion.md` | 2.126 | Rediseño del ciclo de producción que se trabajaba en otra sesión: el QR de fin de turno sería la verdad del stock |
| `traspaso-7sep-2026-tarde.md` | 3.816 | Traspaso al cambiar de compu la tarde del 7-sep: qué quedó pusheado y qué no |

**Cómo las leo yo, en tres montones:**

1. **Ya pasaron y no dejaron regla** (9): `commit_pendiente_productos`,
   `unificacion_costeo`, `vinculacion_fudo_inline`, `pizarron_compacto_modal`,
   `subrecetas_rename_mapping`, `menu_engineering_pendientes`,
   `cierre_mayo_2026_conciliacion`, `tarjeta_icbc_y_cierre_mayo`,
   `traspaso-7sep-2026-tarde`. Son fotos de un momento. **Candidatas a tirar.**

2. **Ya pasaron pero dejaron una regla que sigue viva** (7):
   `cierre_no_marca_pizarron` (mig 078), `pizarron_reset_on_lote_delete` (mig 070),
   `lotes_excluido_analisis` (la alerta 3×/30×), `qr_checklist_obligatorio`,
   `fudo_sync_acotado_meses` (el límite de 2 meses), `variaciones_costo_inline`,
   `fudo-token-cache-pendiente-activar`. **Candidatas a fusionarse** dentro de la nota
   del módulo que corresponda, no a tirarse sueltas.

3. **Preguntas abiertas** (4): `refactor_compras_caja` (¿se hicieron los 6 PRs?),
   `auditoria_erp_tab_por_tab` (¿sigue?), `ciclo_completo_otra_sesion` (¿quedó en algo?),
   `cierre_de_mes_liviano` (¿es el modelo que se usa hoy?). **Estas cuatro no las puedo
   decidir yo**: hace falta que digas si siguen vivas.

- [ ] Montón 1: tirar las 9
- [ ] Montón 2: fusionar las 7 en las notas de módulo
- [ ] Montón 3: te digo una por una cuáles siguen vivas
- [ ] `cabos-sueltos-erp.md` → mover a `docs/`
- [ ] `PRODUCT.md` → tirar

---

## 7. Qué pasa después de que decidas

1. Marcás las casillas de arriba (o me contestás por número de grupo).
2. **Antes de tocar nada hago una copia** de la carpeta entera. Ya me pasó una vez que un
   script de compactar me comió texto de dos renglones del índice; desde entonces, copia
   primero.
3. Ejecuto: fusiono, tiro, bajo de rango.
4. Verifico dos cosas con un contador, no a ojo: **que no quede ningún enlace roto** y
   que el índice haya bajado de verdad.
5. Te paso el número final.

### Lo que NO voy a hacer sin que lo digas

- Tirar cualquier nota que tenga un 💣 en el índice.
- Fusionar dos notas que se contradigan entre sí (ahí primero hay que decidir cuál vale).
- Tocar las notas de decisiones tuyas (`decision-*.md`): esas son actas, no apuntes.

---

## 8. Una cosa que conviene arreglar aunque no ahorre bytes

**Hay dos formas de nombrar las notas conviviendo**: las viejas usan `project_x_y` con
guión bajo y las nuevas usan `tema-con-guiones`. Las dos valen, pero el 7-sep eso ya
provocó **153 enlaces rotos** de golpe (se enlazaba en una convención y el archivo estaba
en la otra). Hoy están en cero.

Es el mismo problema que el de los montos y el de la palabra `costo`: **una cosa con dos
nombres, y nada que diga cuál**. Si en algún momento se hace una pasada de limpieza,
unificar la convención es más valioso que ahorrar bytes.
