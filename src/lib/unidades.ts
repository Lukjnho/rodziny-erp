// El vocabulario de unidades del ERP. UNA sola definición.
//
// POR QUÉ EXISTE ESTE ARCHIVO
// El almacén ya hablaba un solo idioma: `productos` y `movimientos_stock` guardan
// exactamente tres valores ("unid.", "kg", "L") sin una sola variante, porque el
// formulario de Compras los fija. La cocina, en cambio, tenía lista propia y
// guardaba "unid" y "lt" para las MISMAS unidades. Eso no rompía nada mientras
// cada módulo se mirara el ombligo, pero deja el stock a merced de un punto:
// cualquier comparación por texto entre una receta y el almacén falla en silencio.
//
// Y había DOS normalizadores casi iguales — `normalizarUnidad` en el motor de
// costeo y `mapearUnidad` en el modelo de recetas — que no coincidían. El segundo
// no conocía `oz` ni los envases y, lo peor, DEVOLVÍA 'g' PARA TODO LO QUE NO
// RECONOCÍA: un insumo comprado en "botella" se convertía en gramos al usarlo en
// una receta. Hoy no explota sólo porque ningún producto usa esas unidades, pero
// el formulario de Compras las ofrece.
//
// Regla: toda unidad se escribe con los valores de acá, y toda comparación entre
// unidades pasa por `normalizarUnidad`. Nunca comparar `a.unidad === b.unidad`.

/**
 * Las unidades en las que el ALMACÉN guarda stock. Son los valores canónicos:
 * `productos.unidad` y `movimientos_stock.unidad` sólo contienen estos.
 */
export const UNIDADES_STOCK = ['unid.', 'kg', 'L'] as const;

/**
 * Envases discretos que Compras ofrece además de los canónicos. Para el stock
 * cuentan como unidades; para usarlos en ml/oz hace falta `productos.contenido_ml`.
 */
export const ENVASES = ['paquete', 'caja', 'bolsa', 'botella', 'lata'] as const;

/** Todo lo que puede tener un producto de almacén. Alimenta el selector de Compras. */
export const UNIDADES_CATALOGO = [...UNIDADES_STOCK, ...ENVASES] as const;

/**
 * Lo que se puede tipear en un renglón de receta. Incluye gramos, mililitros y
 * onzas a propósito: nadie escribe "0,003 kg de nuez moscada", escribe "3 g".
 * La conversión se hace al calcular, no al guardar — así el que carga sigue
 * escribiendo como piensa y abajo hay un solo idioma.
 */
export const UNIDADES_RECETA = ['kg', 'g', 'L', 'ml', 'unid.', 'oz'] as const;

/** Cómo se muestra cada unidad de catálogo en un desplegable. */
export const ETIQUETA_UNIDAD: Record<string, string> = {
  'unid.': 'unidad',
  kg: 'kg',
  L: 'litro',
  paquete: 'paquete',
  caja: 'caja',
  bolsa: 'bolsa',
  botella: 'botella',
  lata: 'lata',
};

/**
 * Clave interna de comparación. NO es lo que se guarda — lo que se guarda son los
 * valores de `UNIDADES_CATALOGO` / `UNIDADES_RECETA`. Esto es sólo para comparar
 * y convertir.
 */
export type UnidadCanonica = 'kg' | 'g' | 'lt' | 'ml' | 'oz' | 'unid';

/**
 * Lleva cualquier forma de escribir una unidad a su clave canónica.
 * Devuelve el texto original en minúsculas si no la reconoce — a propósito: así
 * el que llama puede detectarlo y avisar, en vez de comerse una conversión falsa.
 */
export function normalizarUnidad(u: string): string {
  const x = (u ?? '').toLowerCase().trim();
  if (x === 'kg' || x === 'kgs') return 'kg';
  if (x === 'g' || x === 'gr' || x === 'grs' || x === 'gramos' || x === 'gramo') return 'g';
  if (x === 'lt' || x === 'l' || x === 'lts' || x === 'litros' || x === 'litro') return 'lt';
  if (x === 'ml' || x === 'mililitros') return 'ml';
  if (x === 'oz' || x === 'onza' || x === 'onzas') return 'oz';
  if (
    x === 'unid.' ||
    x === 'unid' ||
    x === 'u' ||
    x === 'unidades' ||
    x === 'unidad' ||
    // Envases discretos: el ERP los ofrece en Compras como "unidad" funcional.
    // Para usarlos en ml/oz se usa contenido_ml.
    x === 'botella' ||
    x === 'botellas' ||
    x === 'lata' ||
    x === 'latas' ||
    x === 'paquete' ||
    x === 'paquetes' ||
    x === 'caja' ||
    x === 'cajas' ||
    x === 'bolsa' ||
    x === 'bolsas'
  )
    return 'unid';
  return x;
}

/** ¿Dos unidades son la misma cosa escrita distinto? */
export function mismaUnidad(a: string, b: string): boolean {
  return normalizarUnidad(a) === normalizarUnidad(b);
}

/**
 * Devuelve el valor con el que hay que GUARDAR una unidad en un renglón de receta,
 * partiendo de cualquier forma de escribirla. Usado al traer un insumo del almacén
 * a una receta: el insumo dice "L", el renglón guarda "L", no "lt".
 * Si no la reconoce devuelve null — el que llama decide qué hacer, que es mejor
 * que el viejo `mapearUnidad`, que en ese caso devolvía 'g' y convertía una
 * botella en gramos sin avisar.
 */
export function unidadParaReceta(u: string): (typeof UNIDADES_RECETA)[number] | null {
  switch (normalizarUnidad(u)) {
    case 'kg':
      return 'kg';
    case 'g':
      return 'g';
    case 'lt':
      return 'L';
    case 'ml':
      return 'ml';
    case 'oz':
      return 'oz';
    case 'unid':
      return 'unid.';
    default:
      return null;
  }
}

/**
 * 1 oz redondeada a 30 ml para simplificar el costeo de barra (estándar interno
 * Rodziny). Si alguna vez queremos el valor exacto (29,5735) se cambia acá.
 */
export const ML_POR_OZ = 30;

/**
 * Lleva una cantidad a la unidad base de su grupo, para poder compararla o
 * convertirla. Peso → gramos, volumen → mililitros, unidades → unidades.
 * `grupo: null` significa que la unidad no se reconoce y NO se puede convertir.
 *
 * Ojo: peso y volumen son grupos distintos a propósito. Pasar de litros a kilos
 * requiere densidad, y eso el sistema no lo sabe. El único puente permitido es
 * volumen ↔ unidad, y sólo cuando el producto tiene `contenido_ml` cargado
 * (una botella de 750 trae 750 ml).
 */
export function aBase(
  cantidad: number,
  unidad: string,
): { cantidad: number; grupo: 'peso' | 'vol' | 'unid' | null } {
  const u = normalizarUnidad(unidad);
  if (u === 'kg') return { cantidad: cantidad * 1000, grupo: 'peso' };
  if (u === 'g') return { cantidad, grupo: 'peso' };
  if (u === 'lt') return { cantidad: cantidad * 1000, grupo: 'vol' };
  if (u === 'ml') return { cantidad, grupo: 'vol' };
  if (u === 'oz') return { cantidad: cantidad * ML_POR_OZ, grupo: 'vol' };
  if (u === 'unid') return { cantidad, grupo: 'unid' };
  return { cantidad, grupo: null };
}

/** ¿La unidad mide peso o volumen (o sea, admite decimales con sentido)? */
export function esContinua(unidad: string): boolean {
  const g = aBase(1, unidad).grupo;
  return g === 'peso' || g === 'vol';
}
