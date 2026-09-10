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

> ⚠️ **Las pruebas 3, 4 y 8 GUARDAN datos de verdad.** Están armadas para dejar
> todo como estaba, pero anotá en un papel el número que había **antes** de
> tocar cada cosa. Si algo sale mal, ese papel es la forma de volver atrás.
>
> La prueba 8 además crea un producto inventado que **hay que borrar al final**.

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
- [ ] RRHH → Sueldos → **Impuestos** (el monto a pagar de ARCA)

> ⚠️ **En estos campos la advertencia es en serio:** si escribís `150.000` se
> guarda **150**. Hasta la tanda 2, escribilos sin puntos.
>
> 🔴 **Y hay cinco campos más que tienen el problema y NO tienen el aviso.**
> Son los que aparecieron después del relevamiento y están en la prueba 8.
> Hasta que se migren, esos cinco también van sin puntos.

---

## PRUEBA 8 — Los cinco campos que aparecieron después

> **Ojo: el objetivo de esta prueba es distinto al de las anteriores.**
> Estos cinco campos **no se migraron** — se descubrieron después, cuando la
> primera tanda ya estaba hecha. Acá no estás probando que anden bien. Estás
> **confirmando cómo se portan hoy**, por dos motivos: para que la tanda 2 tenga
> con qué comparar, y porque todo lo que sabemos de ellos es **una deducción
> leída en el código, no algo que alguien haya visto en pantalla**.
>
> 🔴 **Ninguno de estos cinco tiene el aviso amarillo** de la prueba 7. Hasta que
> se migren, van sin puntos igual que los otros.

### 8.a — Compras → 📦 Stock → Costo unitario ⭐ *el más grave de todos*

Éste es el que puede guardar **CERO sin avisar**, y un cero no llama la atención:
en una grilla parece "todavía no lo cargué". Y el costo del insumo entra en el
costeo de todas las recetas que lo usan.

**Hacelo con un producto inventado, nunca con uno de verdad:**

1. [ ] Compras → **📦 Stock** → crear un producto nuevo.
2. [ ] Nombre: `ZZZ PRUEBA MONTOS - BORRAR`. Categoría y unidad, cualquiera.
3. [ ] En **Costo unitario ($)** escribí `1.234,56`.
4. [ ] Mirá el campo **antes de guardar**: ¿te dejó escribir eso, o quedó vacío?
5. [ ] Guardá igual.
6. [ ] Buscá el producto en la lista y mirá la columna de costo.

**Qué esperamos que pase (o sea: el bug):** el costo quedó en **$0**, y en ningún
momento apareció un cartel diciendo que algo estaba mal.

- [ ] Anotá qué pasó de verdad: quedó en `______`.
- [ ] Editá el mismo producto y ahora escribí `1.234` (sin coma).
      **Qué esperamos:** queda `$1,23`, no `$1.234`.
- [ ] Anotá qué pasó de verdad: quedó en `______`.
- [ ] 🗑️ **Borrá el producto de prueba.**

> 🟢 **Si el costo se guardó bien en los dos casos, avisá.** Sería una buena
> noticia: significaría que el navegador de la tablet se porta distinto a lo que
> dedujimos leyendo el código, y cambia el plan de la tanda 2.

### 8.b — Productos → Insumos → el costo de la fila

Este campo **no se ve** hasta que hacés clic encima del número.

1. [ ] Productos → **Insumos**.
2. [ ] **Anotá en el papel** el costo de un insumo cualquiera.
3. [ ] Hacé clic sobre ese costo → se convierte en un campo editable.
4. [ ] **No escribas nada.** Hacé clic afuera.
5. [ ] ¿El costo quedó igual al del papel?
6. [ ] Ahora sí: clic, escribí `1.234`, clic afuera. **Qué esperamos:** queda
       `$1,23`. Anotá qué pasó: `______`.
7. [ ] **Devolvé el costo al valor del papel.**

> A diferencia del de Compras, éste **no** puede guardar cero: si lo tipeado no
> es un número, no guarda nada. Lo que sí puede es guardarlo mil veces más chico.

### 8.c — Productos → Configuración → columna "Redondeo $"

1. [ ] Productos → **Configuración**.
2. [ ] **Anotá** el redondeo de una categoría.
3. [ ] Escribí `1.000` en ese campo. **Qué esperamos:** queda `1`.
4. [ ] Anotá qué pasó: `______`.
5. [ ] **Devolvelo al valor del papel.**

> Parece chiquito y no lo es: si el redondeo queda en 0, quien lo lee cae a $100
> por su cuenta. Un redondeo mal cargado mueve **todos** los precios sugeridos de
> esa categoría.

### 8.d y 8.e — Finanzas → Proyección → "⚙️ Saldos y supuestos"

Hay que **desplegar** ese panel: viene cerrado.

1. [ ] Finanzas → **Proyección** → clic en **⚙️ Saldos y supuestos**.
2. [ ] **Anotá** los dos valores: *Caja operativa hoy* y *Reserva hoy*.
3. [ ] En **Caja operativa hoy** escribí `5.000.000`. Anotá qué queda: `______`.
4. [ ] Lo mismo en **Reserva hoy**. Anotá qué queda: `______`.
5. [ ] **Devolvé los dos a los valores del papel.**

> Estos dos son el punto de partida de toda la proyección. Si arrancan mil veces
> más chicos, la proyección entera queda mal — y no hay ningún número
> "obviamente raro" que lo delate, porque todo se achica junto.

---

## PRUEBA 9 — El modal 50/50 de sueldos, con solo abrirlo ⭐

> **Esta prueba no requiere escribir nada.** El campo ya muestra mal apenas se
> abre el modal. Es la misma familia que la prueba 3 (el precio de la carta), y
> es el motivo por el que el **grupo E subió de prioridad** por encima del D.

**Dónde:** RRHH → **Sueldos** → en la fila de un empleado, elegir como medio de
pago **Mixto** (efectivo + transferencia). Eso abre un modal con dos campos:
*Monto en efectivo* y *Monto por transferencia*, ya sugeridos mitad y mitad.

**Preparación — esto es lo que hace que aparezca:**

- [ ] Elegí un empleado cuyo **total a pagar NO sea un número redondo**: que
      tenga centavos. Los que cobran presentismo (+10 %) son los candidatos, y
      también cualquiera con días prorrateados.
- [ ] **Anotá el total en el papel.**

**La prueba:**

1. [ ] Poné el medio de pago en **Mixto**.
2. [ ] Cuando se abre el modal, **no toques nada. No escribas nada.**
3. [ ] Mirá los dos montos sugeridos.

**Qué tiene que pasar:** los dos son números limpios, con separador de miles, y
suman exactamente el total del papel.

> 🔴 **Lo que esperamos que pase hoy:** el campo de **transferencia** muestra un
> número con un **punto suelto** en un campo donde todo lo demás son solo
> dígitos — por ejemplo `175000.5` en vez de `$175.000,50`. Y a veces peor:
> `50000.299999999997`, con una cola larguísima de decimales.
>
> Por qué: la mitad se redondea a múltiplos de 100 y **los centavos se los come
> entero el otro lado**. Ese número se mete en el campo tal cual, sin formatear.

4. [ ] Anotá los dos números que aparecieron: `______` y `______`.

**La segunda mitad de la prueba — acá es donde se multiplica:**

5. [ ] Hacé clic en el campo de **transferencia** y escribí **un solo dígito**
       al final.

> 🔴 **Qué esperamos:** el campo borra el punto y el monto salta a **diez o cien
> veces más grande**. `175000.5` + un `0` se convierte en `17500050`. Y el campo
> de efectivo, que se recalcula solo como *total − transferencia*, se va a
> **cero**.

6. [ ] Anotá qué pasó: transferencia `______`, efectivo `______`.
7. [ ] ⚠️ **Cerrá el modal sin confirmar.** Si lo confirmás, registrás un pago
       diez veces más grande.

> 🟢 **Si los dos números salieron limpios, avisá igual.** Puede ser que el
> empleado que elegiste tenga el total redondo. Probá con otro que tenga
> centavos antes de dar la prueba por pasada.

---

## Si algo falla

1. **No lo guardes de vuelta.** Si un número apareció mal, guardarlo lo deja mal
   en serio.
2. **Anotá:** en qué pantalla, qué escribiste, qué esperabas y qué apareció.
3. **Sacale una foto** a la pantalla.
4. Avisá antes de seguir con el resto de la lista.

## Si pasó todo

- [ ] Las **pruebas 1 a 7** en verde. Ésas son las que deciden si se mergea.
- [ ] Las **pruebas 8 y 9** hechas y anotadas. Éstas **no bloquean el merge**:
      son campos que todavía no se migraron, y lo que sacamos de ellas son los
      números "de antes" para comparar después de la tanda 2.
- [ ] El producto `ZZZ PRUEBA MONTOS - BORRAR` está borrado.
- [ ] Todos los valores que se tocaron volvieron a lo que decía el papel.

Ahí sí se puede mergear `fix/entrada-montos`.

> Recordá: **la tanda 2 sigue frenada** hasta que se revisen las consultas de
> `docs/diagnostico-montos.sql`. Mergear esta rama no desbloquea eso.
