import { describe, expect, it } from 'vitest';
import {
  montoADisplay,
  montoDesdeBase,
  montoDesdeTipeo,
  montoDesdeTipeoODefault,
  montoMientrasEscribe,
} from './monto';

describe('montoDesdeTipeo — el punto es separador de miles', () => {
  it('lee 15.000 como quince mil', () => {
    expect(montoDesdeTipeo('15.000')).toBe(15000);
  });

  it('lee 15000 como quince mil', () => {
    expect(montoDesdeTipeo('15000')).toBe(15000);
  });

  it('lee 152.350,50 con centavos', () => {
    expect(montoDesdeTipeo('152.350,50')).toBe(152350.5);
  });

  it('lee 152350,50 sin separador de miles', () => {
    expect(montoDesdeTipeo('152350,50')).toBe(152350.5);
  });

  it('distingue vacío de cero', () => {
    expect(montoDesdeTipeo('')).toBeNull();
    expect(montoDesdeTipeo('   ')).toBeNull();
    expect(montoDesdeTipeo('0')).toBe(0);
  });

  it('devuelve null si no se puede leer', () => {
    expect(montoDesdeTipeo('abc')).toBeNull();
  });

  it('montoDesdeTipeoODefault cambia el null por cero', () => {
    expect(montoDesdeTipeoODefault('')).toBe(0);
    expect(montoDesdeTipeoODefault('15.000')).toBe(15000);
  });
});

describe('montoDesdeBase — lo que devuelve Supabase', () => {
  it('acepta el numeric que llega como texto, con el punto DECIMAL', () => {
    // 💣 Acá el punto significa lo contrario que al tipear. Por eso son dos
    // funciones distintas: si esto pasara por montoDesdeTipeo daría 15235050.
    expect(montoDesdeBase('152350.50')).toBe(152350.5);
  });

  it('acepta números', () => {
    expect(montoDesdeBase(152350.5)).toBe(152350.5);
  });

  it('conserva el cero y distingue el vacío', () => {
    expect(montoDesdeBase(0)).toBe(0);
    expect(montoDesdeBase(null)).toBeNull();
    expect(montoDesdeBase(undefined)).toBeNull();
    expect(montoDesdeBase('')).toBeNull();
  });
});

describe('montoADisplay — de número a lo que se ve', () => {
  it('agrupa los miles con punto', () => {
    expect(montoADisplay(15000)).toBe('15.000');
  });

  it('usa la coma para los centavos', () => {
    expect(montoADisplay(152350.5)).toBe('152.350,5');
  });

  it('sobrevive al numeric que Supabase manda como texto', () => {
    expect(montoADisplay('152350.50')).toBe('152.350,5');
  });

  it('el vacío se ve vacío', () => {
    expect(montoADisplay(null)).toBe('');
    expect(montoADisplay(undefined)).toBe('');
  });
});

describe('montoMientrasEscribe — lo que se ve al teclear', () => {
  it('va agrupando los miles', () => {
    expect(montoMientrasEscribe('15000')).toBe('15.000');
  });

  it('lo que muestra siempre se puede volver a leer', () => {
    const enPantalla = montoMientrasEscribe('152350,50');
    expect(enPantalla).toBe('152.350,50');
    expect(montoDesdeTipeo(enPantalla)).toBe(152350.5);
  });

  it('corta en dos decimales', () => {
    expect(montoMientrasEscribe('10,999')).toBe('10,99');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// El ciclo completo. Es el test que importa: es exactamente el recorrido que
// hacía un cierre de caja al reabrirlo, y el que multiplicaba por 10.
// ─────────────────────────────────────────────────────────────────────────────

/** base → pantalla → (la persona no toca nada) → número que se vuelve a guardar */
function vueltaCompleta(desdeLaBase: number | string): number | null {
  const num = montoDesdeBase(desdeLaBase);
  const enPantalla = montoADisplay(num);
  return montoDesdeTipeo(enPantalla);
}

describe('el ciclo completo: base → pantalla → guardado', () => {
  const CASOS: Array<[string, number | string, number | null]> = [
    ['redondo', 15000, 15000],
    ['con centavos', 152350.5, 152350.5],
    ['numeric de Supabase como texto', '152350.50', 152350.5],
    ['cero', 0, 0],
    ['un peso', 1, 1],
    ['centavos solos', 0.5, 0.5],
    ['millones con centavos', 1885406.89, 1885406.89],
  ];

  for (const [nombre, entrada, esperado] of CASOS) {
    it(`no cambia el número: ${nombre}`, () => {
      expect(vueltaCompleta(entrada)).toBe(esperado);
    });
  }

  it('los 6 campos de Fudo del cierre de caja, todos con centavos', () => {
    // Los valores que trae un cierre real: Fudo casi siempre devuelve centavos.
    const cierre = {
      fudo_efectivo: '48250.75',
      fudo_qr: '15300.40',
      fudo_debito: '9875.20',
      fudo_credito: '23410.99',
      fudo_transferencia: '5000.05',
      fudo_mp_lucas: '12750.60',
    };
    const esperado = [48250.75, 15300.4, 9875.2, 23410.99, 5000.05, 12750.6];

    const obtenido = Object.values(cierre).map(vueltaCompleta);
    expect(obtenido).toEqual(esperado);

    // Y el total tiene que seguir cerrando.
    const total = obtenido.reduce((s: number, n) => s + (n ?? 0), 0);
    expect(total).toBeCloseTo(114587.99, 2);
  });

  it('el precio de la carta con centavos no se multiplica por 10', () => {
    // Este es el caso de MenuTab: entrar al campo y salir sin escribir nada.
    const precioGuardado = 2350.5;
    expect(vueltaCompleta(precioGuardado)).toBe(2350.5);
    expect(vueltaCompleta(precioGuardado)).not.toBe(23505);
  });

  it('así se rompía antes: el parser de tipeo aplicado a un valor de la base', () => {
    // Se deja escrito para que quede claro qué hacía el bug y que no vuelva.
    const comoSeHaciaAntes = (v: number) => montoDesdeTipeo(String(v));
    expect(comoSeHaciaAntes(2350.5)).toBe(23505); // ← 10 veces más
    expect(comoSeHaciaAntes(152350.5)).toBe(1523505); // ← 10 veces más
    // El camino correcto no tiene ese problema:
    expect(vueltaCompleta(2350.5)).toBe(2350.5);
    expect(vueltaCompleta(152350.5)).toBe(152350.5);
  });
});
