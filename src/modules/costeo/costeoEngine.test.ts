// El colchón se aplica UNA sola vez.
//
// 💣 Este test existe porque el colchón se componía por nivel: una receta que
// usaba una subreceta tomaba el costo de la subreceta CON colchón, lo sumaba al
// suyo, y volvía a multiplicar el total. Con tres niveles quedaba ×1,464 en
// lugar de ×1,10.
//
// No falla ruidosamente: los números siguen siendo plausibles, solo que más
// altos. Por eso hace falta un test y no alcanza con leer el código.
import { describe, it, expect } from 'vitest';
import { buildCosteoContext, costearReceta } from './costeoEngine';
import type { RecetaRow, IngredienteRow, ProductoRow } from './costeoEngine';

const COLCHON = 0.1;

const HARINA: ProductoRow = {
  id: 'p-harina',
  nombre: 'Harina',
  unidad: 'kg',
  costo_unitario: 1000,
  merma_pct: 0,
  contenido_ml: null,
};

// Cadena de tres niveles: Plato → Base Media → Base Honda → Harina.
const RECETAS: RecetaRow[] = [
  { id: 'r-honda', nombre: 'Base Honda', tipo: 'subreceta', rendimiento_kg: 1, rendimiento_porciones: null, local: 'vedia' },
  { id: 'r-media', nombre: 'Base Media', tipo: 'subreceta', rendimiento_kg: 1, rendimiento_porciones: null, local: 'vedia' },
  { id: 'r-plato', nombre: 'Plato', tipo: 'receta', rendimiento_kg: null, rendimiento_porciones: 1, local: 'vedia' },
  { id: 'r-simple', nombre: 'Plato Simple', tipo: 'receta', rendimiento_kg: null, rendimiento_porciones: 1, local: 'vedia' },
  // Una base que rinde PORCIONES, para el camino 'unid.'
  { id: 'r-porciones', nombre: 'Base Por Porciones', tipo: 'subreceta', rendimiento_kg: null, rendimiento_porciones: 10, local: 'vedia' },
  { id: 'r-plato-unid', nombre: 'Plato Unid', tipo: 'receta', rendimiento_kg: null, rendimiento_porciones: 1, local: 'vedia' },
];

const ing = (id: string, receta_id: string, nombre: string, cantidad: number, unidad: string, producto_id: string | null): IngredienteRow =>
  ({ id, receta_id, nombre, cantidad, unidad, orden: 1, producto_id });

const INGS: IngredienteRow[] = [
  ing('i1', 'r-honda', 'Harina', 1, 'kg', 'p-harina'),
  ing('i2', 'r-media', 'Subreceta Base Honda', 1, 'kg', null),
  ing('i3', 'r-plato', 'Subreceta Base Media', 1, 'kg', null),
  ing('i4', 'r-simple', 'Harina', 1, 'kg', 'p-harina'),
  ing('i5', 'r-porciones', 'Harina', 1, 'kg', 'p-harina'),
  ing('i6', 'r-plato-unid', 'Subreceta Base Por Porciones', 2, 'unid.', null),
];

const costear = (id: string, colchon = COLCHON) =>
  costearReceta(id, buildCosteoContext(RECETAS, INGS, [HARINA], colchon), new Map(), new Set());

describe('el colchón se aplica una sola vez', () => {
  it('una receta SIN subrecetas lleva el colchón una vez (no cambió nada)', () => {
    const r = costear('r-simple');
    expect(r.advertencias).toEqual([]);
    expect(r.costoBase).toBe(1000);
    expect(r.costoConMargen).toBeCloseTo(1100, 6);
  });

  it('💣 con TRES niveles sigue siendo ×1,10 y no ×1,331', () => {
    const r = costear('r-plato');
    expect(r.advertencias).toEqual([]);

    // Lo que importa: el costo de los insumos del fondo llega limpio.
    expect(r.costoBase).toBeCloseTo(1000, 6);
    expect(r.costoConMargen).toBeCloseTo(1100, 6);

    // Y explícitamente: NO el número viejo. 1000 × 1,1³ = 1331.
    expect(r.costoConMargen).not.toBeCloseTo(1331, 0);
  });

  it('cada eslabón entrega su costo SIN colchón al de arriba', () => {
    const honda = costear('r-honda');
    expect(honda.costoBasePorKg).toBeCloseTo(1000, 6);
    expect(honda.costoPorKg).toBeCloseTo(1100, 6); // lo que ve la pantalla: con colchón

    const media = costear('r-media');
    // Si tomara el costoPorKg de Base Honda, acá habría 1100.
    expect(media.costoBase).toBeCloseTo(1000, 6);
    expect(media.costoBasePorKg).toBeCloseTo(1000, 6);
    expect(media.costoPorKg).toBeCloseTo(1100, 6);
  });

  it('el camino por PORCIONES (unid.) tampoco compone', () => {
    const base = costear('r-porciones');
    expect(base.costoBasePorPorcion).toBeCloseTo(100, 6);  // 1000 / 10
    expect(base.costoPorPorcion).toBeCloseTo(110, 6);

    const plato = costear('r-plato-unid');
    expect(plato.advertencias).toEqual([]);
    expect(plato.costoBase).toBeCloseTo(200, 6);          // 2 porciones × 100
    expect(plato.costoConMargen).toBeCloseTo(220, 6);     // y no 2 × 110 × 1,1 = 242
    expect(plato.costoConMargen).not.toBeCloseTo(242, 0);
  });

  it('el detalle suma exactamente el costo base', () => {
    const r = costear('r-plato');
    const suma = r.detalles.reduce((a, d) => a + (d.costoTotal ?? 0), 0);
    expect(suma).toBeCloseTo(r.costoBase, 6);
  });

  it('con colchón 0 el costo con margen es igual al base, a cualquier profundidad', () => {
    for (const id of ['r-simple', 'r-media', 'r-plato', 'r-plato-unid']) {
      const r = costear(id, 0);
      expect(r.costoConMargen).toBeCloseTo(r.costoBase, 6);
      expect(r.costoPorPorcion ?? r.costoPorKg).toBeCloseTo(
        (r.costoBasePorPorcion ?? r.costoBasePorKg)!,
        6,
      );
    }
  });

  it('el colchón escala lineal con la profundidad, no exponencial', () => {
    // Con un colchón grande la diferencia entre las dos reglas se ve sola.
    const r = costear('r-plato', 0.5);
    expect(r.costoConMargen).toBeCloseTo(1500, 6);   // 1000 × 1,5
    expect(r.costoConMargen).not.toBeCloseTo(3375, 0); // 1000 × 1,5³
  });
});
