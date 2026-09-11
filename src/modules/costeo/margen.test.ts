import { describe, it, expect } from 'vitest';
import {
  COLCHON_POR_DEFECTO,
  IVA_POR_DEFECTO,
  condicionesDeCobro,
  desgloseDeCobro,
  loQueRecibimos,
  margenSobreRecibido,
  precioParaMargen,
  semaforoDeMargen,
} from './margen';

// Las condiciones que usan hoy las tres pantallas: IVA 21 % y la comisión
// bancaria más alta configurada (criterio conservador, pedido de Lucas).
const LISTA = { ivaPct: 0.21, comisionPct: 0.05 };

describe('loQueRecibimos', () => {
  it('saca el IVA y despues la comision, en ese orden', () => {
    // 12.100 con IVA → 10.000 neto → menos 5 % → 9.500
    expect(loQueRecibimos(12100, LISTA)).toBeCloseTo(9500, 6);
  });

  it('el descuento se aplica ANTES del IVA, sobre el precio de lista', () => {
    // 25 % de descuento sobre 12.100 = 9.075 → /1,21 = 7.500 → −5 % = 7.125
    expect(loQueRecibimos(12100, { ...LISTA, descuentoPct: 0.25 })).toBeCloseTo(7125, 6);
  });

  it('sin precio no inventa un cero', () => {
    expect(loQueRecibimos(null, LISTA)).toBeNull();
    expect(loQueRecibimos(0, LISTA)).toBeNull();
  });
});

describe('margenSobreRecibido', () => {
  it('devuelve FRACCION, nunca 0-100', () => {
    // recibido 9.500, costo 3.800 → (9500−3800)/9500 = 0,6
    const m = margenSobreRecibido(12100, 3800, LISTA);
    expect(m).toBeCloseTo(0.6, 10);
    expect(m).toBeLessThan(1); // 💣 si esto diera 60, volvimos a tener dos escalas
  });

  it('sin costo es "no se sabe", no es cero', () => {
    expect(margenSobreRecibido(12100, null, LISTA)).toBeNull();
  });

  it('un costo mayor que lo recibido da margen negativo, no null', () => {
    expect(margenSobreRecibido(12100, 19000, LISTA)).toBeCloseTo(-1, 10);
  });

  it('💣 da lo mismo que la cuenta vieja de MenuTab, paso por paso', () => {
    // La copia que vivia en MenuTab.tsx:245, reproducida a mano.
    const viejo = (precioBruto: number, costo: number, desc: number, com: number) => {
      const precioCobrado = precioBruto * (1 - desc);
      const neto = precioCobrado / (1 + 0.21);
      const recibido = neto - neto * com;
      return (recibido - costo) / recibido;
    };
    for (const [p, c, d, com] of [
      [12100, 3800, 0, 0.05],
      [9300, 4100, 0.25, 0],
      [7000, 2500, 0.15, 0.05],
    ] as const) {
      expect(margenSobreRecibido(p, c, { ivaPct: 0.21, comisionPct: com, descuentoPct: d })).toBeCloseTo(
        viejo(p, c, d, com),
        12,
      );
    }
  });

  it('💣 y lo mismo que la cuenta vieja de useCostoPorFudo, dividida por 100', () => {
    const viejoPorCien = (precioBruto: number, costo: number) => {
      const neto = precioBruto / 1.21;
      const recibido = neto - neto * 0.05;
      return ((recibido - costo) / recibido) * 100;
    };
    const nuevo = margenSobreRecibido(12100, 3800, LISTA)!;
    expect(nuevo * 100).toBeCloseTo(viejoPorCien(12100, 3800), 10);
  });
});

describe('desgloseDeCobro', () => {
  it('los escalones cierran y el ultimo es exactamente loQueRecibimos', () => {
    const d = desgloseDeCobro(12100, { ...LISTA, descuentoPct: 0.25 });
    expect(d.precioLista - d.descuento).toBeCloseTo(d.precioCobrado, 10);
    expect(d.precioCobrado - d.iva).toBeCloseTo(d.neto, 10);
    expect(d.neto - d.comision).toBeCloseTo(d.recibido, 10);
    expect(d.recibido).toBeCloseTo(loQueRecibimos(12100, { ...LISTA, descuentoPct: 0.25 })!, 10);
  });

  it('💣 el desglose del tooltip y el margen del badge no se pueden separar', () => {
    // Eran dos cadenas escritas a mano en el mismo archivo. Si una cambiaba y
    // la otra no, el globito decía un número y el badge otro.
    const d = desgloseDeCobro(9300, LISTA);
    const porDesglose = (d.recibido - 4100) / d.recibido;
    expect(margenSobreRecibido(9300, 4100, LISTA)).toBeCloseTo(porDesglose, 12);
  });
});

describe('precioParaMargen', () => {
  it('es el camino de vuelta exacto', () => {
    const precio = precioParaMargen(3800, 0.6, LISTA)!;
    expect(margenSobreRecibido(precio, 3800, LISTA)).toBeCloseTo(0.6, 10);
  });

  it('tambien vuelve bien cuando hay descuento', () => {
    const cond = { ...LISTA, descuentoPct: 0.25 };
    const precio = precioParaMargen(4100, 0.55, cond)!;
    expect(margenSobreRecibido(precio, 4100, cond)).toBeCloseTo(0.55, 10);
  });

  it('no hay precio posible con margen del 100 %', () => {
    expect(precioParaMargen(3800, 1, LISTA)).toBeNull();
  });

  it('sin costo no hay precio objetivo', () => {
    expect(precioParaMargen(null, 0.5, LISTA)).toBeNull();
  });
});

describe('semaforoDeMargen', () => {
  it('el minimo sale de la categoria, no de un numero fijo', () => {
    // El mismo 61 % de margen: en una pasta (mínimo 0,55) es amarillo, porque
    // el verde le empieza en 0,70; en un vino (0,45) ya es verde, porque le
    // empieza en 0,60. Antes los dos se medían contra 0,50 y 0,65 y el vino
    // salía amarillo estando holgado.
    expect(semaforoDeMargen(0.61, 0.55)).toBe('amarillo');
    expect(semaforoDeMargen(0.61, 0.45)).toBe('verde');
  });

  it('debajo del minimo es rojo', () => {
    expect(semaforoDeMargen(0.54, 0.55)).toBe('rojo');
    expect(semaforoDeMargen(0.0, 0.45)).toBe('rojo');
  });

  it('justo en el minimo ya no es rojo', () => {
    expect(semaforoDeMargen(0.55, 0.55)).toBe('amarillo');
  });

  it('reproduce el badge viejo para la categoria default', () => {
    // El badge tenia 0,50 y 0,65 clavados. 0,50 es el margen_min de 'default'
    // y 0,65 = 0,50 + los 15 puntos de colchon. Para esa categoria, el
    // semaforo nuevo tiene que pintar exactamente igual que el viejo.
    const viejo = (p: number) => (p < 0.5 ? 'rojo' : p < 0.65 ? 'amarillo' : 'verde');
    for (const p of [0, 0.3, 0.49, 0.5, 0.6, 0.649, 0.65, 0.8]) {
      expect(semaforoDeMargen(p, 0.5)).toBe(viejo(p));
    }
  });

  it('el colchon es el que estaba: 15 puntos', () => {
    expect(COLCHON_POR_DEFECTO).toBeCloseTo(0.15, 10);
  });
});

describe('el colchon por categoria (mig 206)', () => {
  it('con colchon 0,20 el verde arranca mas arriba', () => {
    // Piso 0,55 y colchon 0,20 → verde recien en 0,75.
    expect(semaforoDeMargen(0.7, 0.55, 0.2)).toBe('amarillo');
    expect(semaforoDeMargen(0.75, 0.55, 0.2)).toBe('verde');
  });

  it('con colchon 0 no hay amarillo: o llega o no llega', () => {
    expect(semaforoDeMargen(0.549, 0.55, 0)).toBe('rojo');
    expect(semaforoDeMargen(0.55, 0.55, 0)).toBe('verde');
  });

  it('sin pasar colchon usa el de respaldo, que es el de siempre', () => {
    expect(semaforoDeMargen(0.6, 0.5)).toBe(semaforoDeMargen(0.6, 0.5, COLCHON_POR_DEFECTO));
  });
});

describe('condicionesDeCobro', () => {
  const COMIS = [{ pct: 0 }, { pct: 0.015 }, { pct: 0.03 }, { pct: 0.02 }];

  it('toma la comision MAS ALTA, no el promedio', () => {
    // Criterio conservador de Lucas: si el plato cierra con la peor, cierra.
    expect(condicionesDeCobro({ ivaPct: 0.21, comisiones: COMIS }).comisionPct).toBeCloseTo(0.03, 10);
  });

  it('sin IVA cargado usa el de respaldo', () => {
    expect(condicionesDeCobro({ comisiones: COMIS }).ivaPct).toBeCloseTo(IVA_POR_DEFECTO, 10);
    expect(condicionesDeCobro({ ivaPct: null, comisiones: COMIS }).ivaPct).toBeCloseTo(0.21, 10);
  });

  it('un IVA en CERO cargado a proposito no se pisa con el respaldo', () => {
    // 💣 `?? ` y no `||`: con `||` un IVA 0 cargado a mano volveria a 0,21.
    expect(condicionesDeCobro({ ivaPct: 0, comisiones: COMIS }).ivaPct).toBe(0);
  });

  it('sin comisiones cargadas da 0, no NaN ni -Infinity', () => {
    expect(condicionesDeCobro({ ivaPct: 0.21 }).comisionPct).toBe(0);
    expect(condicionesDeCobro({ ivaPct: 0.21, comisiones: [] }).comisionPct).toBe(0);
  });

  it('una comision que viene como texto se lee igual', () => {
    // Postgres devuelve numeric como string.
    expect(condicionesDeCobro({ ivaPct: 0.21, comisiones: [{ pct: '0.03' }] }).comisionPct).toBeCloseTo(0.03, 10);
  });

  it('💣 da lo mismo que las tres copias viejas', () => {
    // Las dos lineas tal cual estaban escritas en MenuTab, useCostoPorFudo y
    // useMenuEngineering, con la config sin cargar (que es cuando pegaba el
    // `?? 0.21`).
    const sinCargar: number | undefined = [undefined][0];
    const viejo = {
      ivaPct: sinCargar ?? 0.21,
      comisionPct: Math.max(0, ...COMIS.map((c) => Number(c.pct))),
    };
    const nuevo = condicionesDeCobro({ ivaPct: sinCargar, comisiones: COMIS });
    expect(nuevo.ivaPct).toBeCloseTo(viejo.ivaPct, 12);
    expect(nuevo.comisionPct).toBeCloseTo(viejo.comisionPct, 12);
  });
});
