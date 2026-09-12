// Costear una FORMA DE VENTA.
//
// 💣 Por qué estos tests existen: el testigo de `npm run formas` prueba que
// ningún costo se movió, pero con la tabla vacía no ejecuta una sola línea de
// `costearForma`. Sin esto, el paso 3 de la Etapa 2 empezaría a cargar datos
// sobre código que nunca corrió.
//
// 🔑 Y el último test es el más importante de los cinco: prueba que una forma
// engancha su receta POR ID, no por nombre. Ésa es la clase de error que el
// modelo viene a eliminar — hoy hay pares de recetas que se llaman igual salvo
// por una mayúscula y el motor se queda con la primera que encuentra.
import { describe, it, expect } from 'vitest';
import { buildCosteoContext, costearForma, costearFormasDeReceta } from './costeoEngine';
import type {
  RecetaRow,
  IngredienteRow,
  ProductoRow,
  FormaVentaRow,
  FormaIngredienteRow,
  FormaSurtidoRow,
} from './costeoEngine';

const COLCHON = 0.1;

const prod = (id: string, nombre: string, costo: number, unidad = 'unid.'): ProductoRow => ({
  id,
  nombre,
  unidad,
  costo_unitario: costo,
  merma_pct: 0,
  contenido_ml: null,
});

// Una bolsa a $100 y una etiqueta a $40: lo propio de cada forma.
const PRODUCTOS: ProductoRow[] = [
  prod('p-harina', 'Harina', 1000, 'kg'),
  prod('p-bolsa', 'Bolsa', 100),
  prod('p-etiqueta', 'Etiqueta', 40),
  prod('p-rel-rav', 'Relleno de ravioli', 500),
  prod('p-rel-sor', 'Relleno de sorrentino', 700),
];

// La torta rinde 10 porciones y cuesta $2.000 la tanda → $200 la porción.
// Los dos raviolis rinden 1 porción cada uno y cuestan $500 y $700.
const RECETAS: RecetaRow[] = [
  { id: 'r-torta', nombre: 'Torta', tipo: 'subreceta', rendimiento_kg: null, rendimiento_porciones: 10, local: 'saavedra' },
  { id: 'r-ravioli', nombre: 'Ravioli', tipo: 'receta', rendimiento_kg: null, rendimiento_porciones: 1, local: 'saavedra' },
  { id: 'r-sorrentino', nombre: 'Sorrentino', tipo: 'receta', rendimiento_kg: null, rendimiento_porciones: 1, local: 'saavedra' },
  { id: 'r-pack', nombre: 'Pack de 2', tipo: 'receta', rendimiento_kg: null, rendimiento_porciones: 1, local: 'saavedra' },
];

const ing = (
  id: string,
  receta_id: string,
  nombre: string,
  cantidad: number,
  producto_id: string | null,
): IngredienteRow => ({ id, receta_id, nombre, cantidad, unidad: 'unid.', orden: 1, producto_id });

const INGS: IngredienteRow[] = [
  { id: 'i-torta', receta_id: 'r-torta', nombre: 'Harina', cantidad: 2, unidad: 'kg', orden: 1, producto_id: 'p-harina' },
  ing('i-rav', 'r-ravioli', 'Relleno de ravioli', 1, 'p-rel-rav'),
  ing('i-sor', 'r-sorrentino', 'Relleno de sorrentino', 1, 'p-rel-sor'),
];

const forma = (
  id: string,
  receta_id: string,
  codigo: string,
  multiplicador: number,
  extra: Partial<FormaVentaRow> = {},
): FormaVentaRow => ({
  id,
  receta_id,
  codigo,
  nombre: codigo,
  multiplicador,
  unidad: 'unid.',
  precio: null,
  activo: true,
  vendible: true,
  ...extra,
});

const armar = (
  formas: FormaVentaRow[],
  formasIngredientes: FormaIngredienteRow[] = [],
  formasSurtido: FormaSurtidoRow[] = [],
  recetas: RecetaRow[] = RECETAS,
  ings: IngredienteRow[] = INGS,
) => buildCosteoContext(recetas, ings, PRODUCTOS, COLCHON, { formas, formasIngredientes, formasSurtido });

describe('costear una forma de venta', () => {
  it('la porción toma una fracción de la base: 0,1 de una torta de $2.000 son $200', () => {
    const ctx = armar([forma('f-porcion', 'r-torta', 'porcion', 1)]);
    const r = costearForma('f-porcion', ctx, new Map(), new Set());
    // La torta rinde 10 porciones: 1 "unid." es una porción, o sea $200.
    expect(r.costo.costoBase).toBeCloseTo(200, 6);
    expect(r.costo.costoConMargen).toBeCloseTo(220, 6);
    expect(r.costo.advertencias).toEqual([]);
  });

  it('lo PROPIO de la forma se suma aparte y no toca la receta', () => {
    const ctx = armar(
      [forma('f-porcion', 'r-torta', 'porcion', 1)],
      [
        { id: 'fi-1', forma_id: 'f-porcion', nombre: 'Bolsa', cantidad: 1, unidad: 'unid.', orden: 1, producto_id: 'p-bolsa' },
        { id: 'fi-2', forma_id: 'f-porcion', nombre: 'Etiqueta', cantidad: 1, unidad: 'unid.', orden: 2, producto_id: 'p-etiqueta' },
      ],
    );
    const r = costearForma('f-porcion', ctx, new Map(), new Set());
    // 200 de torta + 100 de bolsa + 40 de etiqueta.
    expect(r.costo.costoBase).toBeCloseTo(340, 6);
    expect(r.costo.detalles).toHaveLength(3);
  });

  it('💣 el multiplicador multiplica: 3 porciones cuestan el triple que una', () => {
    const una = costearForma('f-a', armar([forma('f-a', 'r-torta', 'porcion', 1)]), new Map(), new Set());
    const tres = costearForma('f-b', armar([forma('f-b', 'r-torta', 'porcion', 3)]), new Map(), new Set());
    expect(tres.costo.costoBase).toBeCloseTo(una.costo.costoBase * 3, 6);
  });

  it('el surtido mete OTRAS recetas en la misma caja, cada una por su cantidad', () => {
    // El Pack de 2 no tiene receta propia que aporte costo: su base es una
    // receta sin ingredientes, y todo el contenido viene del surtido.
    const recetas: RecetaRow[] = [
      ...RECETAS,
      { id: 'r-vacia', nombre: 'Pack vacio', tipo: 'receta', rendimiento_kg: null, rendimiento_porciones: 1, local: 'saavedra' },
    ];
    const ctx = armar(
      [forma('f-pack', 'r-vacia', 'congelado', 1)],
      [{ id: 'fi-k', forma_id: 'f-pack', nombre: 'Bolsa', cantidad: 1, unidad: 'unid.', orden: 1, producto_id: 'p-bolsa' }],
      [
        { forma_id: 'f-pack', receta_id: 'r-ravioli', cantidad: 1, unidad: 'unid.' },
        { forma_id: 'f-pack', receta_id: 'r-sorrentino', cantidad: 2, unidad: 'unid.' },
      ],
      recetas,
    );
    const r = costearForma('f-pack', ctx, new Map(), new Set());
    // 1 ravioli ($500) + 2 sorrentinos ($1.400) + la bolsa ($100). Surtido,
    // no cuatro iguales: ése es el caso que obligó a que el surtido sea tabla.
    expect(r.costo.costoBase).toBeCloseTo(2000, 6);
  });

  it('🔑 engancha por ID: dos recetas que se llaman igual ya no se pisan', () => {
    // Éste es el punto del modelo. Las dos se llaman "Torta" en el mismo local
    // y el motor, buscando por nombre, se queda con la primera que encuentra.
    // La forma apunta a la SEGUNDA por id y tiene que costear la segunda.
    const recetas: RecetaRow[] = [
      { id: 'r-torta-vieja', nombre: 'Torta', tipo: 'subreceta', rendimiento_kg: null, rendimiento_porciones: 10, local: 'saavedra' },
      { id: 'r-torta-buena', nombre: 'torta', tipo: 'subreceta', rendimiento_kg: null, rendimiento_porciones: 10, local: 'saavedra' },
    ];
    const ings: IngredienteRow[] = [
      { id: 'x1', receta_id: 'r-torta-vieja', nombre: 'Harina', cantidad: 2, unidad: 'kg', orden: 1, producto_id: 'p-harina' },
      { id: 'x2', receta_id: 'r-torta-buena', nombre: 'Harina', cantidad: 5, unidad: 'kg', orden: 1, producto_id: 'p-harina' },
    ];
    const ctx = armar([forma('f-buena', 'r-torta-buena', 'porcion', 1)], [], [], recetas, ings);
    const r = costearForma('f-buena', ctx, new Map(), new Set());
    // La buena cuesta 5 kg × $1.000 ÷ 10 porciones = $500. La vieja daría $200.
    expect(r.costo.costoBase).toBeCloseTo(500, 6);
  });

  it('costearFormasDeReceta devuelve sólo las activas', () => {
    const ctx = armar([
      forma('f-1', 'r-torta', 'porcion', 1),
      forma('f-2', 'r-torta', 'almacen', 10, { activo: false }),
    ]);
    const rs = costearFormasDeReceta('r-torta', ctx, new Map());
    expect(rs.map((r) => r.codigo)).toEqual(['porcion']);
  });

  it('sin formas cargadas no devuelve nada y no rompe', () => {
    const ctx = buildCosteoContext(RECETAS, INGS, PRODUCTOS, COLCHON);
    expect(costearFormasDeReceta('r-torta', ctx, new Map())).toEqual([]);
    expect(ctx.formaById.size).toBe(0);
  });
});
