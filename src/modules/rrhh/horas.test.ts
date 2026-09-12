// Las horas trabajadas de un día. UNA sola cuenta.
//
// 💥 Este test existe porque la cuenta estaba escrita TRES veces y las tres no
// daban lo mismo: HorasTab tenía el tope de 16 h, AsistenciaTab no, y sólo la
// Bienal descartaba los dobles toques. La misma persona tenía dos totales
// distintos en dos pantallas del mismo ERP.
//
// Medido antes de converger, sobre 8.547 fichadas en 3.493 día-persona:
// 45 días con un tramo de más de 16 h y 27 dobles toques en 23 días.
//
// 🔑 Cada `it` de acá abajo es UNA de las cuatro reglas. Si alguien las vuelve
// a escribir en otro lado y cambia una, este test no se entera — pero si
// cambia la de acá, se pone rojo. Por eso lo que importa es que las pantallas
// LLAMEN a esta función y no tengan su propia copia.
import { describe, it, expect } from 'vitest';
import { tramosDelDia, horasDelDia, sinDoblesToques, ANTIREBOTE_SEG, VENTANA_TURNO_ABIERTO_H } from './utils';

const DIA = '2026-09-01';
const m = (hhmm: string, tipo: 'entrada' | 'salida') => ({
  tipo,
  timestamp: `${DIA}T${hhmm}:00.000Z`,
});

describe('las horas de un día se cuentan una sola vez', () => {
  it('un turno normal: 09:00 a 17:00 son 8 horas', () => {
    expect(horasDelDia([m('09:00', 'entrada'), m('17:00', 'salida')])).toBeCloseTo(8, 6);
  });

  it('regla 2 · turno partido E,E,S,S: cada entrada con la salida que le SIGUE', () => {
    // 💣 Apareando por índice (entrada[0] con salida[0]) esto daba 9 h y un
    // tramo negativo. Cronológicamente son 1 h + 1 h.
    const horas = horasDelDia([
      m('09:00', 'entrada'),
      m('10:00', 'salida'),
      m('17:00', 'entrada'),
      m('18:00', 'salida'),
    ]);
    expect(horas).toBeCloseTo(2, 6);
  });

  it('regla 3 · una entrada sin salida es un turno abierto y NO suma', () => {
    const tramos = tramosDelDia([m('09:00', 'entrada')]);
    expect(tramos).toHaveLength(1);
    expect(tramos[0].computa).toBe(false);
    expect(tramos[0].motivo).toBe('sin_salida');
    expect(horasDelDia([m('09:00', 'entrada')])).toBe(0);
  });

  it('💣 regla 4 · un tramo de más de 16 h es una salida que no se fichó: NO suma', () => {
    // Entró a las 09:00 y la "salida" quedó a las 08:00 del día siguiente.
    // Eso no es un turno de 23 horas: es un olvido.
    const marcas = [
      { tipo: 'entrada' as const, timestamp: `${DIA}T09:00:00.000Z` },
      { tipo: 'salida' as const, timestamp: '2026-09-02T08:00:00.000Z' },
    ];
    const tramos = tramosDelDia(marcas);
    expect(tramos[0].horas).toBe(0);
    expect(tramos[0].computa).toBe(false);
    expect(horasDelDia(marcas)).toBe(0);
  });

  it('y 16 horas justas SÍ suman: el corte es "más de", no "desde"', () => {
    const marcas = [
      { tipo: 'entrada' as const, timestamp: `${DIA}T00:00:00.000Z` },
      { tipo: 'salida' as const, timestamp: `${DIA}T16:00:00.000Z` },
    ];
    expect(horasDelDia(marcas)).toBeCloseTo(VENTANA_TURNO_ABIERTO_H, 6);
  });

  it('💣 regla 1 · dos toques del mismo tipo muy seguidos son UNO', () => {
    // El dedo que toca dos veces, o el reintento por red lenta.
    // ⚠️ El segundo toque se calcula, no se escribe a mano: ANTIREBOTE_SEG son
    // 90 segundos y "09:00:89" no es una hora válida. El testigo se rompió
    // justo por eso la primera vez.
    const casiJuntas = new Date(
      new Date(`${DIA}T09:00:00.000Z`).getTime() + (ANTIREBOTE_SEG - 1) * 1000,
    ).toISOString();
    const marcas = [
      m('09:00', 'entrada'),
      { tipo: 'entrada' as const, timestamp: casiJuntas },
      m('17:00', 'salida'),
    ];
    expect(sinDoblesToques(marcas)).toHaveLength(2);
    // Sin la regla 1, la segunda entrada quedaba sin salida y el turno entero
    // se perdía. Con ella, son 8 horas.
    expect(horasDelDia(marcas)).toBeCloseTo(8, 6);
  });

  it('y dos entradas separadas de verdad NO se colapsan', () => {
    const marcas = [m('09:00', 'entrada'), m('12:00', 'entrada'), m('17:00', 'salida')];
    expect(sinDoblesToques(marcas)).toHaveLength(3);
  });

  it('una salida sin su entrada delante se marca huérfana y no suma', () => {
    const tramos = tramosDelDia([m('17:00', 'salida')]);
    expect(tramos[0].motivo).toBe('salida_huerfana');
    expect(tramos[0].horas).toBe(0);
  });

  it('las marcas llegan desordenadas y se ordenan solas', () => {
    const horas = horasDelDia([m('17:00', 'salida'), m('09:00', 'entrada')]);
    expect(horas).toBeCloseTo(8, 6);
  });

  it('sin fichadas, cero: no null ni NaN', () => {
    expect(horasDelDia([])).toBe(0);
    expect(tramosDelDia([])).toEqual([]);
  });
});
