import { describe, it, expect } from 'vitest';
import { ticketPromedio } from './ticketPromedio';

const t = (id: string, total: number | null) => ({ id, total_bruto: total });

describe('ticketPromedio', () => {
  it('deja afuera la mesa que se abrió y se cerró sin nada', () => {
    const r = ticketPromedio(
      [t('a', 10000), t('b', 20000), t('vacia', 0)],
      new Set(['a', 'b']),
    );
    expect(r.promedio).toBe(15000);
    expect(r.contados).toBe(2);
    expect(r.excluidos).toBe(1);
  });

  it('la cortesía SÍ cuenta: está en cero pero tuvo comida', () => {
    // Es el caso de los 93 tickets de agosto con $1.654.500 en renglones y $0 de
    // total. Hubo mesa, hubo costo: baja el promedio y tiene que bajarlo.
    const r = ticketPromedio(
      [t('a', 30000), t('cortesia', 0)],
      new Set(['a', 'cortesia']),
    );
    expect(r.promedio).toBe(15000);
    expect(r.excluidos).toBe(0);
  });

  it('un ticket sin renglones pero CON monto se cuenta igual', () => {
    const r = ticketPromedio([t('a', 10000), t('raro', 30000)], new Set(['a']));
    expect(r.promedio).toBe(20000);
    expect(r.excluidos).toBe(0);
  });

  it('💣 si no hay ni un renglón atado, no excluye a nadie (histórico < jul-2026)', () => {
    // Antes de julio-2026 ventas_items.ticket_id está vacío en el 100% de las
    // filas. Sin esta guarda, el promedio de esos meses se calcularía sobre CERO
    // tickets y el módulo Ventas mostraría $0 en todo el histórico.
    const r = ticketPromedio([t('a', 10000), t('b', 0), t('c', 20000)], new Set());
    expect(r.contados).toBe(3);
    expect(r.excluidos).toBe(0);
    expect(r.promedio).toBe(10000);
  });

  it('sin tickets da cero y no divide por cero', () => {
    expect(ticketPromedio([], new Set()).promedio).toBe(0);
  });

  it('un total nulo vale cero, no rompe la cuenta', () => {
    const r = ticketPromedio([t('a', 10000), t('b', null)], new Set(['a', 'b']));
    expect(r.promedio).toBe(5000);
    expect(r.contados).toBe(2);
  });

  it('el caso real de agosto-2026: 97 vacíos sobre 5.788 mueven 3,5%', () => {
    // 5.598 tickets con plata + 93 cortesías en cero + 97 vacíos.
    const tickets = [
      ...Array.from({ length: 5598 }, (_, i) => t(`v${i}`, 21144)),
      ...Array.from({ length: 93 }, (_, i) => t(`c${i}`, 0)),
      ...Array.from({ length: 97 }, (_, i) => t(`x${i}`, 0)),
    ];
    const conRenglones = new Set([
      ...Array.from({ length: 5598 }, (_, i) => `v${i}`),
      ...Array.from({ length: 93 }, (_, i) => `c${i}`),
    ]);
    const conVacios = ticketPromedio(tickets, new Set(tickets.map((x) => x.id)));
    const sinVacios = ticketPromedio(tickets, conRenglones);
    expect(sinVacios.excluidos).toBe(97);
    expect(sinVacios.promedio).toBeGreaterThan(conVacios.promedio);
    // ~1,7% sobre este recorte (el 3,5% medido incluye además el efecto de los
    // tickets en cero de las cortesías, que acá siguen contando).
    expect((sinVacios.promedio - conVacios.promedio) / conVacios.promedio).toBeCloseTo(
      0.0170,
      3,
    );
  });
});
