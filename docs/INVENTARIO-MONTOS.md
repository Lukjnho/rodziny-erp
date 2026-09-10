# Inventario de campos de dinero — lista cerrada

**Fecha:** 10-sep-2026 · **Rama:** `fix/entrada-montos`

> Esta es la lista **definitiva** de todos los campos del ERP donde una persona
> escribe un importe en pesos. Reemplaza al relevamiento manual anterior, que
> tenía 42 y se le habían escapado 7.
>
> **Cómo se armó:** siete agentes barrieron el repo por módulo y otros siete
> verificaron cada tanda buscando lo que se les hubiera escapado. Se revisaron
> las **444** apariciones de `<input>`, `<textarea>` y `<MontoInput>` de `src/`.
> Un revisor final contó el resultado por tres caminos distintos.

## El número: **49 campos**

| Grupo | Qué le pasa | Cuántos | Estado |
|---|---|---:|---|
| **A** | Usa `MontoInput` | 22 | ✅ hecho (tanda 1) |
| **B** | Regla correcta, parser copiado a mano | **0** | ✅ el grupo dejó de existir |
| **C** | El punto se lee como coma decimal | 11 | ⛔ pendiente |
| **D** | `type="number"`, decide el navegador | 14 | ⛔ pendiente |
| **E** | Solo dígitos, sin centavos | 2 | ⛔ pendiente |

> **Que el grupo B esté en cero no es un error, es el resultado de la tanda 1.**
> Y tiene una consecuencia: hoy **todo lo que no es A está mal o depende del
> navegador**. No queda ningún escalón tibio para dejar para el final.

## 🔴 Grupo C — el punto se lee como coma decimal (11)

Los montos se guardan **mil veces más chicos**. Todos tienen hoy el aviso provisorio en pantalla.

| Archivo:línea | Qué es en pantalla | Recarga de la base |
|---|---|:--:|
| `src/modules/caja/RetirosSinClasificar.tsx:286` | Cambio (vuelve al cajón) | sí |
| `src/modules/caja/RetirosSinClasificar.tsx:302` | Pagos y adelantos (no vuelve) | sí |
| `src/modules/finanzas/components/FlujoCaja.tsx:1505` | "Falta el saldo de MercadoPago (la API no lo expone). Copialo de la app y pegalo acá" — con el cartel "Escribí… | — |
| `src/modules/gastos/NuevoGastoForm.tsx:2435` | Columna "Subtotal" de la tabla de items (vista escritorio, bloque `hidden md:block`), dentro de "Detallar prod… | sí |
| `src/modules/gastos/NuevoGastoForm.tsx:2571` | "Subtotal $" — la misma tabla de items pero en la tarjeta de celular (bloque `md:hidden`, dentro de items.map(… | sí |
| `src/modules/gastos/NuevoGastoModal.tsx:1225` | Casillero del subtotal de cada renglón de "Detallar productos" en el modal clásico, con placeholder "Total $".… | sí |
| `src/modules/rrhh/sueldos/PanelAdelantos.tsx:149` | Monto (es placeholder, no hay label; panel "Adelantos", arriba dice "Total de la quincena" en $) | — |
| `src/modules/rrhh/sueldos/PanelBonos.tsx:95` | Monto (placeholder; panel "Bonos / Horas extra", arriba dice "Total a sumar" en $) | — |
| `src/modules/rrhh/sueldos/PanelDescuentos.tsx:91` | Monto (placeholder; panel "Descuentos eventuales", arriba dice "Total a descontar" en $) | — |
| `src/modules/rrhh/sueldos/PanelSanciones.tsx:87` | Monto (placeholder; panel "Sanciones", arriba dice "Total a descontar" en $) | — |
| `src/modules/rrhh/sueldos/SeccionImpuestos.tsx:153` | Monto a pagar (ARCA) — label real en :151, dentro del bloque plegable "Impuestos y documentos del mes" (solo s… | sí |

## 🔴 Grupo E — solo dígitos (2)

No acepta centavos **y** multiplica por 10 al recargar.

| Archivo:línea | Qué es en pantalla | Recarga de la base |
|---|---|:--:|
| `src/modules/rrhh/SueldosTab.tsx:1703` | Monto en efectivo — label en :1698, modal "Pago mixto", con un "$" literal a la izquierda (:1702) | sí |
| `src/modules/rrhh/SueldosTab.tsx:1719` | Monto por transferencia — label en :1714, mismo modal "Pago mixto", con "$" a la izquierda (:1718) | sí |

## 🟠 Grupo D — `type="number"` (14)

Lo interpreta el navegador, no nuestro código.

| Archivo:línea | Qué es en pantalla | Recarga de la base |
|---|---|:--:|
| `src/modules/caja/CajaPage.tsx:478` | Fondo inicial (la plata con la que arrancás) | — |
| `src/modules/caja/CajaPage.tsx:1552` | Monto — dejalo vacío para cobrar todo lo que falta | — |
| `src/modules/caja/CajaPage.tsx:1756` | Para cambio (bajo el título "¿Sacaste plata del cajón durante el turno?") | — |
| `src/modules/caja/CajaPage.tsx:1767` | Para pagar algo (bajo "¿Sacaste plata del cajón durante el turno?") | — |
| `src/modules/caja/CajaPage.tsx:1810` | ¿Cuánto tenés de cada medio? — un renglón por medio de pago (Efectivo, QR, débito…), con el nombre del medio d… | — |
| `src/modules/compras/ComprasPage.tsx:4386` 🆕 **⚠️ +C** | Costo unitario ($) | sí |
| `src/modules/finanzas/components/ProyeccionFlujo.tsx:365` 🆕 | Caja operativa hoy (MP + efectivo + bancos) | sí |
| `src/modules/finanzas/components/ProyeccionFlujo.tsx:368` 🆕 | Reserva hoy (comitente) | sí |
| `src/modules/finanzas/components/ProyeccionFlujo.tsx:472` | Monto (form "📌 Inversiones y eventos puntuales", placeholder "Monto") | — |
| `src/modules/productos/components/ConfiguracionTab.tsx:240` 🆕 **⚠️ +C** | Redondeo $ — encabezado de columna en la linea 183, seccion 'Margen minimo por categoria'. Una fila por catego… | sí |
| `src/modules/productos/components/InsumosTab.tsx:188` 🆕 **⚠️ +C** | Costo unitario — encabezado de columna en la linea 157. No hay un campo siempre visible: se edita haciendo cli… | sí |
| `src/modules/rrhh/AguinaldoTab.tsx:724` | Monto real pagado — label en :721-723, modal de aguinaldo; el bloque entero (:718 `{pagado && (`) solo aparece… | sí |
| `src/modules/rrhh/RRHHPage.tsx:1205` | Sueldo base (sin presentismo) — label en :1204, modal "Nuevo empleado" / "Editar empleado" | sí |
| `src/modules/salon/MesasMostradorPage.tsx:245` | Con qué paga — un renglón por medio de pago, el input va al lado del select del medio | — |

## ✅ Grupo A — ya usan `MontoInput` (22)

Nada que hacer. Solo verificar que sigan así.

| Archivo:línea | Qué es en pantalla | Recarga de la base |
|---|---|:--:|
| `src/modules/finanzas/components/ChecklistPagos.tsx:1631` | columna "Monto" de cada renglón de pago fijo | sí |
| `src/modules/finanzas/components/ChecklistPagos.tsx:1881` | Monto (modal "Agregar pago fijo") | — |
| `src/modules/finanzas/components/CierreCaja.tsx:952` | Efectivo (Fudo) | sí |
| `src/modules/finanzas/components/CierreCaja.tsx:963` | Código QR (Fudo) | sí |
| `src/modules/finanzas/components/CierreCaja.tsx:972` | Débito (Fudo) | sí |
| `src/modules/finanzas/components/CierreCaja.tsx:981` | Crédito (Fudo) | sí |
| `src/modules/finanzas/components/CierreCaja.tsx:992` | Transferencia (Fudo) | sí |
| `src/modules/finanzas/components/CierreCaja.tsx:1003` | MP Lucas (Fudo) | sí |
| `src/modules/finanzas/components/CierreCaja.tsx:1014` | Cambio apertura | sí |
| `src/modules/finanzas/components/CierreCaja.tsx:1058` | Contado real * | sí |
| `src/modules/finanzas/components/CierreCaja.tsx:1110` | Retiro — cambio | sí |
| `src/modules/finanzas/components/CierreCaja.tsx:1125` | Retiro — pagos | sí |
| `src/modules/finanzas/components/CierreCaja.tsx:1522` | Monto retirado (editable) — modal "Recibido en caja fuerte" | sí |
| `src/modules/finanzas/components/FlujoCaja.tsx:2013` | Monto * (form "Registrar retiro" de socios / dividendos) | — |
| `src/modules/gastos/NuevoGastoForm.tsx:2763` | "Importe total *", con un $ fijo a la izquierda y placeholder 285.453,50. Es el monto de la factura entera. | — |
| `src/modules/gastos/NuevoGastoForm.tsx:3191` | "Monto" de cada cuota dentro de PlanPagosEditor — subcomponente definido al final del archivo (línea 3110). So… | — |
| `src/modules/gastos/NuevoGastoModal.tsx:1110` | "Neto" — primer casillero de la sección "Importes" del modal clásico de carga/edición de gasto. | sí |
| `src/modules/gastos/NuevoGastoModal.tsx:1141` | "IIBB" — cuarto casillero de la sección "Importes". OJO: es el monto de Ingresos Brutos en pesos, no la alícuo… | sí |
| `src/modules/gastos/NuevoGastoModal.tsx:1149` | "Total *" — último casillero de la sección "Importes", con borde violeta y negrita. Es el importe que manda. | sí |
| `src/modules/gastos/PagarGastoModal.tsx:555` | "Importe a pagar *", con un $ fijo a la izquierda. Es cuánto se paga de este gasto ahora. | sí |
| `src/modules/gastos/PagarGastoModal.tsx:565` | "Descuento (opcional)", también con $ a la izquierda. OJO: es un monto en pesos, no un porcentaje. | — |
| `src/modules/productos/components/MenuTab.tsx:952` | Precio — encabezado de la columna en la linea 636, que solo se dibuja en la vista 'Precios' (en la vista 'Desg… | sí |

---

## Los cinco campos que el relevamiento manual no tenía 🆕

| Campo | Por qué se había escapado |
|---|---|
| `compras/ComprasPage.tsx:4386` — Costo unitario | Se llama `costo`, palabra que el vocabulario de plata excluía **por un error mío**: creí que en Cocina significaba kilos y significa plata igual que acá (ver `docs/TRASPASO-MONTOS.md`, sección 2 bis) |
| `productos/InsumosTab.tsx:188` — Costo unitario | Ídem, y además solo aparece al hacer clic sobre el importe de la fila |
| `productos/ConfiguracionTab.tsx:240` — Redondeo $ | Columna de una tabla de configuración, sin etiqueta propia |
| `finanzas/ProyeccionFlujo.tsx:365` — Caja operativa hoy | Saldo inicial de la proyección |
| `finanzas/ProyeccionFlujo.tsx:368` — Reserva hoy | Ídem |

*(El sexto, `sueldos/SeccionImpuestos.tsx:153`, ya se había encontrado antes con la regla de ESLint.)*

## ⚠️ Tres cosas que hay que saber antes de migrar

### 1. Tres campos del grupo D esconden un parser del grupo C

`compras/ComprasPage.tsx:4386` · `productos/InsumosTab.tsx:188` · `productos/ConfiguracionTab.tsx:240`

El tag dice `type="number"`, pero **el parser que guarda es del grupo C**: hace
`.replace(',', '.')` sin borrar los puntos. Están marcados **⚠️ +C** en la tabla.

> 💣 **Cambiar solo el tag deja el parser roto adentro.** Hay que cambiar los dos.
>
> Y el de Compras tiene una segunda falla peor: con `type="number"`, si lo tipeado
> no es un número válido el navegador devuelve vacío, el `|| 0` lo convierte en cero
> y **el costo del insumo se guarda en CERO sin un solo cartel**.

### 2. El grupo E rompe antes de lo que creíamos

No hace falta reabrir un pago viejo. **La sugerencia 50/50 del modal ya arrastra los
centavos** (`SueldosTab.tsx:1223-1224` y `1261-1262`): `mitad` se redondea a múltiplos
de 100, así que **todos los centavos del total se los come `otra`**.

Pasa en dos tiempos, y conviene no confundirlos:

1. **Al abrir, sin tocar nada.** `String(otra)` se mete crudo en el campo, que en todo
   el resto de su vida muestra solo dígitos: aparece `175000.5` en vez de `$175.000,50`.
   Y como la resta es de punto flotante, a veces sale `50000.299999999997`.
   Guardar así pierde los centavos (`parseInt` corta en el punto) — molesto, no grave.
2. **Al escribir un solo dígito**, `replace(/\D/g, '')` borra el punto y **el monto salta
   ×10 o ×100**: `175000.5` + un `0` queda `17500050`. Y el otro campo, que se recalcula
   como *total − este*, se va a cero.

Está en `docs/CHECKLIST-MONTOS.md`, prueba 9.

### 3. Un campo de plata quedó afuera a propósito

`gastos/NuevoGastoModal.tsx:1132` — el **"IVA $"**. Es un `MontoInput` de plata real,
pero es de **solo lectura** (muestra un total calculado). Queda fuera de la lista de
trabajo porque no hay nada que migrar. **Se anota para que el próximo barrido no lo
"descubra" y reabra la lista.**

## Lo que este inventario NO cubre

- **La regla de ESLint cubre alrededor de la mitad de los 49.** Su vocabulario excluye
  `valor`, `cantidad` y `total` a propósito, y eso está medido: agregarlas suma 1, 6 y
  13 avisos y **ninguno es plata**. `costo` estaba excluido por la misma razón y la
  razón era falsa — **ya se corrigió**: suma un aviso real y cero ruido. Ver
  `docs/TRASPASO-MONTOS.md`, sección 2 bis.
- **Cocina se barrió por vocabulario, no renglón por renglón.** No apareció nada de
  plata (son todos kilos), pero si algún día entra un precio a Cocina, ese es el barrio
  donde se va a esconder: la regla del punto ahí es la contraria y nadie lo va a mirar
  dos veces.
- **Un teclado numérico propio** (botones que escriben en el estado sin `<input>`) no lo
  agarraría este método. Hoy no existe —`contentEditable` no aparece ni una vez en
  `src/`—, pero si la Caja estrena uno, la lista deja de estar cerrada.
- **Plata que se tipea fuera del ERP**: Supabase Studio a mano, los `.sql` de migración,
  el agente de impresión. Está fuera de alcance por definición.
- **Nada se probó en pantalla.** Los grupos y los parsers están confirmados leyendo el
  código. Que un `type="number"` se comporte distinto en la tablet del salón sigue
  siendo una deducción, no una medición: eso lo cubre `docs/CHECKLIST-MONTOS.md`.
