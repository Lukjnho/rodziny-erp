// ¿Esto se fabrica o se compra hecho?
//
// 💣 Este test existe porque de los 24 platos que figuran bajo su margen mínimo,
// 19 son vinos y tragos: su problema es el precio de carta, no el costeo. Si la
// regla se rompe, vuelven a mezclarse y la lista de rojos deja de servir.
import { describe, it, expect } from 'vitest';
import {
  modoDeProduccion,
  esRenglonDeSubreceta,
  compararModos,
  ORDEN_MODOS,
  MODOS_PRODUCCION,
  MODO_PRODUCCION_LABEL,
  MODO_PRODUCCION_AYUDA,
} from './modelo';

const ing = (...nombres: string[]) => nombres.map((nombre) => ({ nombre }));

describe('modoDeProduccion', () => {
  it('la botella que se compra y se vende es REVENTA', () => {
    // "Abducido Malbec" (Vedia): un solo insumo, que es el vino mismo.
    expect(modoDeProduccion(ing('Abducido Malbec'))).toBe('reventa');
    expect(modoDeProduccion(ing('La Iride Chardonnay (DEPOSITO)'))).toBe('reventa');
  });

  it('el trago que se mezcla en el momento es BARRA', () => {
    // "Aperol Con Tonica" (Vedia): tres insumos, ninguna subreceta.
    expect(
      modoDeProduccion(
        ing('Bolsa de Hielo 10kg Polo Sur', 'Aperol Botella 750cc (DEPOSITO)', 'Paso de los Toros Tonica 1500cc'),
      ),
    ).toBe('barra');
  });

  it('cualquier cosa con una subreceta es PRODUCCIÓN PROPIA', () => {
    // "Tortelli de Espinaca y Quesos" (Saavedra).
    expect(
      modoDeProduccion(
        ing('Subreceta Masa Huevo Pastas', 'Subreceta Relleno de Espinaca y 2 Quesos', 'Subreceta Servicio Salón'),
      ),
    ).toBe('propia');
  });

  it('alcanza UNA subreceta entre insumos sueltos', () => {
    // "Cafe Flat White": leche + expreso. El expreso es subreceta ⇒ se prepara.
    expect(modoDeProduccion(ing('Leche Sachet', 'Subreceta Expreso Café'))).toBe('propia');
  });

  it('una subreceta sola no es reventa aunque sea un solo renglón', () => {
    // La regla de la subreceta gana antes de contar renglones.
    expect(modoDeProduccion(ing('Subreceta Carrot cake'))).toBe('propia');
  });

  it('una receta a medio cargar cae en PROPIA, que es donde hay que mirarla', () => {
    expect(modoDeProduccion([])).toBe('propia');
  });

  it('💣 "Subrecetas del Sur" es un insumo, no una subreceta', () => {
    // El prefijo exige el espacio: sin él, un insumo cuyo nombre empieza igual
    // pasaría por subreceta y el plato entero se clasificaría mal.
    expect(esRenglonDeSubreceta({ nombre: 'Subrecetas del Sur' })).toBe(false);
    expect(esRenglonDeSubreceta({ nombre: 'Subreceta Masa' })).toBe(true);
    expect(esRenglonDeSubreceta({ nombre: 'SUBRECETA masa' })).toBe(true);
    expect(esRenglonDeSubreceta({ nombre: 'Masa (subreceta)' })).toBe(false);
    expect(modoDeProduccion(ing('Subrecetas del Sur'))).toBe('reventa');
  });

  it('se lee primero lo que se fabrica', () => {
    expect(ORDEN_MODOS[0]).toBe('propia');
    expect([...MODOS_PRODUCCION].sort(compararModos)).toEqual(['propia', 'barra', 'reventa']);
  });

  it('los tres cajones tienen nombre y ayuda', () => {
    for (const m of MODOS_PRODUCCION) {
      expect(MODO_PRODUCCION_LABEL[m]).toBeTruthy();
      expect(MODO_PRODUCCION_AYUDA[m]).toBeTruthy();
    }
  });
});
