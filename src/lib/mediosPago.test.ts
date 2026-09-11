// Medios de pago — que la clasificación no vuelva a depender del texto.
//
// Por qué existe este archivo: la pregunta "¿esto es una transferencia?" estaba
// escrita como `medio_pago === 'transferencia'` en cuatro pantallas. Medido
// contra la base el 11-sep-2026, en `dividendos` esa comparación es FALSA en
// las 318 filas —incluidas las 12 que sí son transferencias— porque el texto
// guardado es 'transferencia_mp', no 'transferencia'. Nada fallaba: el cartel
// de "ojo, esto no es una transferencia" simplemente salía en todas.

import { describe, it, expect } from 'vitest';
import {
  esEfectivo,
  esTransferencia,
  medioRequiereComprobante,
  MEDIO_PAGO_LABEL,
  type MedioPago,
} from './mediosPago';

// Las filas del catálogo, tal como vienen de `SELECT_MEDIO`.
const EFECTIVO = { codigo: 'efectivo', es_efectivo: true };
const TRANSFERENCIA = { codigo: 'transferencia', es_efectivo: false };
const CHEQUE = { codigo: 'cheque', es_efectivo: false };
const MP_LUCAS = { codigo: 'mp_lucas', es_efectivo: false };

describe('clasificar por el catálogo y no por el texto', () => {
  it('los tres bancos son la MISMA transferencia', () => {
    // transferencia_mp, transferencia_galicia y transferencia_icbc son tres
    // alias de una sola fila del catálogo. Ésta es la falla que se arregló.
    expect(esTransferencia(TRANSFERENCIA)).toBe(true);
    expect(esEfectivo(TRANSFERENCIA)).toBe(false);
  });

  it('el efectivo sale de la columna, no de la palabra', () => {
    expect(esEfectivo(EFECTIVO)).toBe(true);
    expect(esTransferencia(EFECTIVO)).toBe(false);
  });

  it('el cheque y el MP de Lucas no son ni efectivo ni transferencia', () => {
    for (const m of [CHEQUE, MP_LUCAS]) {
      expect(esEfectivo(m)).toBe(false);
      expect(esTransferencia(m)).toBe(false);
    }
  });

  it('sin catálogo no inventa: contesta que no', () => {
    for (const vacio of [null, undefined, []] as const) {
      expect(esEfectivo(vacio)).toBe(false);
      expect(esTransferencia(vacio)).toBe(false);
    }
  });

  it('💣 aguanta que PostgREST devuelva el embebido como ARREGLO', () => {
    // Cuando la relación no se puede probar a-uno (una vista, por ejemplo),
    // llega `[{...}]` en vez de `{...}`. Sin normalizar, todo daría "no es
    // efectivo" sin un solo error: la falla silenciosa clásica de este repo.
    expect(esEfectivo([EFECTIVO])).toBe(true);
    expect(esTransferencia([TRANSFERENCIA])).toBe(true);
  });
});

describe('qué exige comprobante', () => {
  it('todo lo bancarizado sí, el efectivo no', () => {
    const esperado: Record<MedioPago, boolean> = {
      efectivo: false,
      transferencia_mp: true,
      transferencia_galicia: true,
      transferencia_icbc: true,
      cheque_galicia: true,
      tarjeta_icbc: true,
      otro: true,
    };
    for (const [medio, debe] of Object.entries(esperado)) {
      expect(medioRequiereComprobante(medio), medio).toBe(debe);
    }
  });

  it('la cuenta corriente todavía no es un pago bancario', () => {
    expect(medioRequiereComprobante('cta cte')).toBe(false);
    expect(medioRequiereComprobante('cuenta corriente')).toBe(false);
  });

  it('sin medio cargado no exige nada', () => {
    expect(medioRequiereComprobante(null)).toBe(false);
    expect(medioRequiereComprobante('')).toBe(false);
  });
});

describe('un solo nombre por medio', () => {
  it('los siete valores del tipo tienen etiqueta, y ninguna se repite', () => {
    // Si mañana se agrega un medio a `MedioPago` sin etiqueta, TypeScript ya
    // protesta. Esto cubre el otro lado: que nadie ponga el mismo nombre dos
    // veces, que es lo que pasaba cuando cada pantalla tenía su lista
    // ("Transferencia MP" y "Transferencia (MercadoPago)" a la vez).
    const nombres = Object.values(MEDIO_PAGO_LABEL);
    expect(nombres).toHaveLength(7);
    expect(new Set(nombres).size).toBe(7);
  });
});
