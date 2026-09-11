import { describe, it, expect } from 'vitest';
import { fraccionDeSubreceta } from './unidades';

// La cuenta "qué parte de una subreceta usa este renglón" está escrita DOS
// veces: acá y en `_cocina_fraccion_subreceta` en la base (migración 174).
// Hubo una tercera copia en la Calculadora de Cocina que no convertía las
// unidades y pedía mil veces de más. Estos tests son para que no vuelva.

describe('fraccionDeSubreceta', () => {
  describe('así se rompía antes: gramos contra un rinde en kilos', () => {
    it('500 g de una subreceta que rinde 20 kg son el 2,5% del lote, no 25 lotes', () => {
      expect(fraccionDeSubreceta(500, 'g', 20, null)).toBeCloseTo(0.025, 10);
    });

    it('el bug viejo daba 25 — o sea mil veces más', () => {
      const comoSeHaciaAntes = (cant: number, rinde: number) => cant / rinde;
      expect(comoSeHaciaAntes(500, 20)).toBe(25);
      expect(fraccionDeSubreceta(500, 'g', 20, null)! * 1000).toBeCloseTo(25, 10);
    });
  });

  describe('peso y volumen van contra el rinde en kilos', () => {
    it('kg es directo', () => {
      expect(fraccionDeSubreceta(5, 'kg', 20, null)).toBeCloseTo(0.25, 10);
    });

    it('un litro pesa un kilo', () => {
      expect(fraccionDeSubreceta(2, 'lt', 10, null)).toBeCloseTo(0.2, 10);
    });

    it('mililitros con densidad 1', () => {
      expect(fraccionDeSubreceta(250, 'ml', 5, null)).toBeCloseTo(0.05, 10);
    });

    it('una onza son 30 ml', () => {
      expect(fraccionDeSubreceta(10, 'oz', 3, null)).toBeCloseTo(0.1, 10);
    });
  });

  describe('las unidades sueltas van contra el rinde en PORCIONES', () => {
    it('2 unidades de algo que rinde 150 porciones', () => {
      expect(fraccionDeSubreceta(2, 'unid.', null, 150)).toBeCloseTo(2 / 150, 10);
    });

    it('no usa el rinde en kilos aunque esté cargado', () => {
      expect(fraccionDeSubreceta(2, 'unid.', 99, 150)).toBeCloseTo(2 / 150, 10);
    });
  });

  describe('null = "no se puede expandir", y eso NO es un error', () => {
    it('peso sin rinde en kilos', () => {
      expect(fraccionDeSubreceta(500, 'g', null, 150)).toBeNull();
    });

    it('unidades sin rinde en porciones', () => {
      expect(fraccionDeSubreceta(2, 'unid.', 20, null)).toBeNull();
    });

    it('un rinde en cero no se usa como divisor', () => {
      expect(fraccionDeSubreceta(500, 'g', 0, null)).toBeNull();
      expect(fraccionDeSubreceta(2, 'unid.', null, 0)).toBeNull();
    });

    it('cantidad cero o negativa', () => {
      expect(fraccionDeSubreceta(0, 'kg', 20, null)).toBeNull();
      expect(fraccionDeSubreceta(-3, 'kg', 20, null)).toBeNull();
    });

    it('una unidad que no sabemos convertir', () => {
      expect(fraccionDeSubreceta(1, 'cucharada', 20, 150)).toBeNull();
    });
  });

  it('el caso que cruzaba locales ya no depende de esto, pero la cuenta sigue igual', () => {
    // "Subreceta Crema de Hongos 6,8 kg" contra un rinde de 8 kg.
    expect(fraccionDeSubreceta(6.8, 'kg', 8, null)).toBeCloseTo(0.85, 10);
  });
});
