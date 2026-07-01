# Borrador — Esquema de remuneración variable para la cúpula

> **Estado:** BORRADOR PARA ANÁLISIS. No implementado en el ERP. Números de sueldo ilustrativos (placeholders) hasta cargar los reales.
> **Objetivo:** pasar a Tomás, Tamara, Maxi y Martín de sueldo 100% fijo a **fijo + variable por objetivos que muevan la rentabilidad**, con mix balanceado (~20-25% del ingreso al variable a mediano plazo).

---

## 1. El principio (por qué así y no de otra forma)

En Argentina **no se puede bajar ni "volver variable hacia abajo" el sueldo fijo** (es rebaja salarial, ilegal). Por eso:

- El **fijo queda como piso protegido.** No se toca.
- Se construye una **capa variable POR ARRIBA**, atada a objetivos.
- Los **aumentos futuros** se rutean mayoritariamente a la capa variable: el fijo mantiene poder adquisitivo, el crecimiento del ingreso se gana con resultados.

Resultado a mediano plazo: el variable llega a pesar ~20-25% del ingreso total **sin que nadie haya perdido nada**.

---

## 2. Arquitectura

| Pieza | Definición |
|---|---|
| **Bono objetivo** | A 100% de cumplimiento = **30% del sueldo base** (≈23% del ingreso total). |
| **Rango de pago** | 0% (no se cumple nada) → 30% (meta) → tope **45% del base** (sobre-cumplimiento). |
| **Frecuencia** | **Trimestral** (suficiente para mover la aguja, no tan corto que sea ruido). |
| **Scorecard** | **60% objetivos individuales + 40% objetivo común** (EBIT/colchón consolidado). |
| **Gatillo (gate)** | Si el EBIT del trimestre no supera el piso, el 40% común paga **cero** automáticamente. Protege la caja. |

---

## 3. KPIs por persona

### Tomás — dueño del **margen** (costeo, precios, menú, estrategias de venta)
| KPI | Qué mide | Peso (del 60% individual) |
|---|---|---|
| Margen bruto % ponderado del menú | que el mix rinda más | 25% |
| Mix hacia "estrellas" / perros eliminados | menu engineering | 20% |
| Cero productos a pérdida + precios al día | revisión mensual de carta (caso Fernet) | 15% |

**Guardrail:** atar a que el **margen bruto en $ totales** suba, no solo el %, para que no espante volumen con precios.

### Tamara — dueña de la **integridad operativa** (asistencias, arqueos, conteo, cierre de turno, stock)
| KPI | Qué mide | Peso |
|---|---|---|
| Desvío de stock / merma (físico vs sistema) | < X% | 25% |
| Faltantes de caja / exactitud de arqueos | ≈ cero | 20% |
| Ausentismo + cierres de turno correctos | cumplimiento | 15% |

**⚠️ Conflicto de interés a resolver:** Tamara *cuenta* el stock y a la vez se la *mide* por que cuadre → tentación de maquillar. Solución: **auditorías sorpresa independientes** (Lucas o Maxi) y medirla por **reducción del desvío inexplicado**, no por "desvío cero".

### Maxi — dueño del **valor externo y compliance** (negociación, municipal, legal/contable, alianzas, comunicación)
| KPI | Qué mide | Peso |
|---|---|---|
| Ahorro/valor en negociaciones | $ documentado antes/después (proveedores, alquiler, servicios, convenios) | 25% |
| Compliance: cero multas/intereses nuevos | que **nunca más** se genere una moratoria | 20% |
| Rotación / retención del equipo | reemplazar gente cuesta | 15% |

**Guardrail:** el ahorro lo valida Lucas (no números teóricos inflados).

### Martín — dueño de **compras e IVA crédito** (compras, depósito, facturas, gastos, stock mínimo)
| KPI | Qué mide | Peso |
|---|---|---|
| **% de compras con factura A** | recupero de IVA (~$12M/mes potencial) | 25% |
| Días de inventario / stock vs mínimo | bajar capital inmovilizado **sin quiebres** | 20% |
| Precio de canasta de insumos clave | mantener/bajar vs inflación | 15% |

**Guardrail doble:** factura A atado al precio de canasta (que no compre más caro); días de inventario atado a cero faltantes críticos (que no genere quiebres).

### El 40% común (los cuatro)
Mismo número para todos: **EBIT / colchón consolidado del trimestre**. Evita que cada uno optimice su silo a costa del resto.

---

## 4. Modelo numérico (ejemplo con sueldos ILUSTRATIVOS)

> ⚠️ Reemplazar por los sueldos reales. Estos son placeholders para ver la mecánica.

### Bases mensuales supuestas
| Persona | Base mensual | Base trimestral | Bono objetivo (30%) |
|---|---:|---:|---:|
| Tomás | $2.200.000 | $6.600.000 | $1.980.000 |
| Tamara | $1.900.000 | $5.700.000 | $1.710.000 |
| Maxi | $2.200.000 | $6.600.000 | $1.980.000 |
| Martín | $1.700.000 | $5.100.000 | $1.530.000 |
| **Total** | **$8.000.000** | **$24.000.000** | **$7.200.000** |

**Costo del bono a meta (con cargas ~25%):** ~$9.000.000 / trimestre.

### ¿Se autofinancia? — SÍ, con sobra
El costo del bono a meta (~$9M/trimestre) se cubre con **una sola** de las palancas:

- **IVA crédito (Martín):** potencial ~$12M/mes = ~$36M/trimestre. Capturando solo el **25%** = $9M → ya paga TODO el bono de los cuatro.
- Todo lo demás (merma, margen, negociaciones, inventario) es **excedente que se queda la empresa.**

Conclusión: el esquema no sale de la caja actual; sale de la rentabilidad que el propio esquema genera.

### Tres escenarios de pago (ejemplo, trimestre)
| Escenario | Cumplimiento scorecard | Bono pagado | Costo c/cargas | Excedente generado (estimado) | Neto para la empresa |
|---|---:|---:|---:|---:|---:|
| Flojo (no pasa el gate) | 40% común = 0; individual parcial | ~$2,9M | ~$3,6M | ~$0 | negativo → **no debería activarse** |
| Meta (100%) | 100% | $7,2M | ~$9,0M | ~$25M+ | **+$16M** |
| Excelente (tope 45%) | sobre-cumple | ~$10,8M | ~$13,5M | ~$40M+ | **+$26M** |

*(El "excedente generado" depende de baseline real de EBIT e IVA; se calibra con datos.)*

---

## 5. Parámetros a definir con datos reales (lo que falta cargar)

1. **Sueldos base reales** de los cuatro.
2. **Baseline de cada KPI** (3 meses): margen actual, merma actual, % factura A actual, días de inventario actuales, EBIT trimestral histórico → de ahí salen las metas y el gate.
3. **El piso del gate** (EBIT mínimo del trimestre para que pague el 40% común).
4. **¿El gate también frena el 60% individual?** Decisión de Lucas: más duro (todo atado al EBIT) vs. más justo (el individual paga aunque el trimestre venga flojo, porque cada uno cumplió lo suyo). Recomendado: que el individual pague siempre que haya cumplimiento real, y el común sea el que absorbe el riesgo macro.

---

## 6. Encuadre legal/impositivo (consultar con contador/abogado laboral)

- El bono por objetivos, si es habitual, **es remunerativo**: paga cargas, suma SAC y a la base de indemnización. **Ya está costeado con cargas** en este modelo.
- Instrumentarlo como **premio por cumplimiento de objetivos, trimestral, no garantizado y documentado.** Que sea genuinamente variable evita que se "consolide" como sueldo.
- El KPI de compliance de Maxi protege directamente contra repetir el agujero (moratoria) que hoy se está pagando.

---

## 7. Roadmap de mediano plazo (timing con la moratoria)

| Etapa | Cuándo | Qué se hace |
|---|---|---|
| **Fase 0 — Baseline** | Hoy → ~1 trimestre | Medir KPIs sin pagar bono. Limpiar data de RRHH y costos en el ERP. Comunicar el esquema al equipo. |
| **Fase 1 — Activación** | Fin de año (se libera la moratoria ~$10M/mes) | Activar el bono con plata real. Hay aire de caja para fondear el pool. |
| **Fase 2 — Consolidación** | 2027 | Los aumentos van mayoritariamente al variable. El peso de RRHH (35% de ventas) empieza a moverse *con* la rentabilidad, no en contra. |

---

## 8. Riesgos y cómo se mitigan

| Riesgo | Mitigación |
|---|---|
| Data poco confiable → bono disputado | Fase 0 de baseline + auditorías independientes. **Prerrequisito innegociable.** |
| Gaming de KPIs | Cada KPI tiene su guardrail (ver sección 3). |
| El bono se vuelve "fijo encubierto" | No garantizado, trimestral, documentado como premio por objetivos. |
| Conflicto de interés (Tamara controla y se mide) | Auditoría sorpresa + medir desvío inexplicado. |
| Caja en trimestre flojo | El gate apaga el 40% común automáticamente. |
