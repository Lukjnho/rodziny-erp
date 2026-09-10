# Checklist antes de mergear — entrada de montos

**Rama:** `fix/entrada-montos` · **Preparada el 10-sep-2026**

> **Para qué es esto.** El build y los tests dicen que el código compila y que
> las cuentas dan bien **en la computadora**. No dicen que se pueda usar en la
> tablet del salón. Esta lista es para probarlo con la mano.
>
> **No hace falta saber programar.** Cada paso dice qué abrir, qué escribir y
> qué tiene que pasar. Si algo no coincide, **parás y avisás** — no lo arregles
> ni lo guardes "a ver si anda".

---

## Antes de empezar

- [ ] Estar en la rama `fix/entrada-montos`, **no** en la de producción.
- [ ] Tener a mano **una calculadora** y, si se puede, **una tablet además de la
      computadora**. Varias pantallas se usan en tablet y ahí se comportan
      distinto.
- [ ] Elegir un momento **fuera del servicio**. Varias pruebas tocan cierres de
      caja y precios de la carta reales.

> ⚠️ **Las pruebas 3 y 4 GUARDAN datos de verdad.** Están armadas para dejar
> todo como estaba, pero anotá en un papel el número que había **antes** de
> tocar cada cosa. Si algo sale mal, ese papel es la forma de volver atrás.

---

## Lo que hay que probar, en cuatro ideas

Escribir un monto tiene cuatro momentos, y cada prueba mira uno:

1. **Tipear** un número nuevo → ¿lo entiende bien?
2. **Volver a abrir** algo ya guardado → ¿lo muestra igual que como se guardó?
3. **Guardar sin tocar nada** → ¿lo deja igual? *(acá estaba el bug del 10x)*
4. **El cero y el vacío** → ¿los distingue?

---

## PRUEBA 1 — Tipear con puntos (2 minutos)

**Dónde:** Finanzas → Cierres de caja → botón **Nuevo cierre**.

| Escribí esto en "Contado real" | Tiene que mostrar | Y significa |
|---|---|---|
| `150000` | `150.000` | ciento cincuenta mil |
| `150.000` | `150.000` | ciento cincuenta mil |
| `150000,50` | `150.000,50` | ciento cincuenta mil con cincuenta centavos |

- [ ] Los tres dan el mismo resultado que la columna del medio.
- [ ] Los puntos aparecen **solos** mientras escribís (no los ponés vos).
- [ ] Al hacer clic afuera del campo, el número **no cambia**.

> 🔴 **Si escribiendo `150.000` te queda `150`, pará todo.** Eso es el bug
> viejo y significa que el campo no se migró.

**Cerrá el formulario sin guardar.**

---

## PRUEBA 2 — Un cierre de caja viejo, con centavos ⭐ *la más importante*

Ésta es la que prueba el bug que más plata movía.

**Preparación:** en Finanzas → Cierres de caja, buscá en la lista **un cierre ya
guardado que tenga centavos** en alguno de los campos de Fudo (efectivo, QR,
débito, crédito, transferencia o MP Lucas). Los de Fudo casi siempre tienen.

- [ ] **Anotá en un papel** los seis números de Fudo de ese cierre, con centavos.

**La prueba:**

1. [ ] Apretá **Editar** en ese cierre.
2. [ ] Mirá los seis campos de Fudo. **Tienen que decir exactamente lo que
       anotaste.** Con los mismos centavos.
3. [ ] **No toques nada.** Apretá **Guardar cierre**.
4. [ ] Volvé a abrir el mismo cierre.

**Qué tiene que pasar:** los seis números siguen **idénticos** a los del papel.

> 🔴 **Antes de este arreglo, en este paso los números se multiplicaban por 10.**
> Un `48.250,75` volvía como `482.507,50`. Si eso pasa, la migración falló:
> **avisá y no vuelvas a guardar ese cierre.**

- [ ] Probá lo mismo apretando Editar y **Cancelar** (sin guardar): tampoco tiene
      que cambiar nada.

---

## PRUEBA 3 — El precio de la carta con centavos ⭐

**Dónde:** Productos → pestaña **Menú**.

**Preparación:** buscá un plato cuyo precio tenga centavos. Si ninguno tiene,
elegí uno cualquiera, ponele `2350,50`, guardá y usá ese.

- [ ] **Anotá el precio en el papel.**

**La prueba — leela entera antes de hacerla:**

1. [ ] Hacé **un clic** en el precio de ese plato.
2. [ ] **No escribas nada.**
3. [ ] Hacé clic **afuera**, en cualquier parte de la pantalla.
4. [ ] Recargá la página (F5).

**Qué tiene que pasar:** el precio sigue siendo el mismo del papel.

> 🔴 **Éste era el peor de todos.** Antes del arreglo, ese solo clic-y-clic-afuera
> guardaba el precio **diez veces más grande**, sin escribir nada y sin avisar.
> Un plato de `$2.350,50` pasaba a `$23.505`.

**Y probá el teclado:**

- [ ] Clic en un precio, escribí otro número, apretá **Enter** → se guarda.
- [ ] Clic en un precio, escribí cualquier cosa, apretá **Escape** → **vuelve al
      precio anterior y NO guarda**.

---

## PRUEBA 4 — El arqueo en cero

Un cierre donde no quedó nada de efectivo es un cierre válido y **se tiene que
poder guardar**.

**Dónde:** Finanzas → Cierres de caja → Nuevo cierre.

1. [ ] Llená los datos mínimos (fecha, turno, caja).
2. [ ] En **Contado real** escribí `0`.
3. [ ] Mirá el botón **Guardar cierre**.

**Qué tiene que pasar:** el botón está **habilitado** (se puede apretar).

- [ ] Ahora **borrá** el contenido del campo (que quede vacío).
- [ ] El botón tiene que quedar **deshabilitado** (gris, no se puede apretar).

> Cero y vacío son cosas distintas: "conté y no había nada" no es lo mismo que
> "todavía no conté". **No hace falta guardar el cierre**, cerrá el formulario.

---

## PRUEBA 5 — Gastos: importe y pago

**Dónde:** Gastos → **Nuevo gasto**.

- [ ] En **Importe total** escribí `285.453,50` → tiene que quedar
      `285.453,50`.
- [ ] Si el gasto tiene ítems, revisá que el subtotal de cada ítem sume bien
      contra el total.
- [ ] Cerrá sin guardar.

**Dónde:** Gastos → pestaña Pagos → **Pagar** en cualquier gasto pendiente.

- [ ] El campo **Importe a pagar** viene con el saldo pendiente ya cargado.
      **Tiene que coincidir** con el saldo que muestra la fila.
- [ ] Probá el botón **Mitad**: pone la mitad exacta.
- [ ] Escribí un **Descuento** de `1.500` → se lee mil quinientos, no uno con
      cinco.
- [ ] Cerrá sin guardar.

---

## PRUEBA 6 — En la tablet, no solo en la computadora

Repetí **la Prueba 1** en la tablet que se usa en el local.

- [ ] Al tocar un campo de monto, el teclado que aparece **tiene números**.
- [ ] Escribiendo `150000` se ve `150.000`.
- [ ] El campo entra en la pantalla y se puede leer sin agrandar.

> Esto se prueba aparte porque el teclado de Android y el de la computadora no
> se portan igual. Ya nos pasó con las cargas de cocina.

---

## PRUEBA 7 — Los avisos provisorios están donde tienen que estar

Mientras la segunda tanda no esté hecha, algunos campos **todavía tienen el
problema** y llevan un aviso en amarillo que dice
*"Escribí el monto sin puntos. Ejemplo: 150000"*.

Confirmá que el aviso se ve en:

- [ ] RRHH → Sueldos → **Adelantos**
- [ ] RRHH → Sueldos → **Bonos**
- [ ] RRHH → Sueldos → **Descuentos**
- [ ] RRHH → Sueldos → **Sanciones**
- [ ] Finanzas → Flujo de caja → el recuadro amarillo del **saldo de Mercado Pago**
- [ ] Caja → **Retiros sin clasificar**
- [ ] Gastos → Nuevo gasto → arriba de la tabla de **ítems**

> ⚠️ **En estos campos la advertencia es en serio:** si escribís `150.000` se
> guarda **150**. Hasta la tanda 2, escribilos sin puntos.
>
> 🔴 **Falta uno.** RRHH → Sueldos → **Impuestos (monto a pagar de ARCA)** tiene
> el mismo problema y **todavía no tiene el aviso** — se encontró después.
> Hasta que se arregle, ese campo también va sin puntos.

---

## Si algo falla

1. **No lo guardes de vuelta.** Si un número apareció mal, guardarlo lo deja mal
   en serio.
2. **Anotá:** en qué pantalla, qué escribiste, qué esperabas y qué apareció.
3. **Sacale una foto** a la pantalla.
4. Avisá antes de seguir con el resto de la lista.

## Si pasó todo

- [ ] Las 7 pruebas en verde.
- [ ] Ninguna quedó con datos raros guardados.

Ahí sí se puede mergear `fix/entrada-montos`.

> Recordá: **la tanda 2 sigue frenada** hasta que se revisen las consultas de
> `docs/diagnostico-montos.sql`. Mergear esta rama no desbloquea eso.
