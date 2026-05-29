// Helpers de parseo/normalización numérica para inputs es-AR.
// Extraído de cocina/ProduccionQRPage para compartir con compras/Recepcion y
// futuros formularios donde el operario carga cantidades con coma decimal.

// Parsea valor "8,9" o "8.9" como 8.9. Soporta es-AR donde algunos Android
// muestran solo ",". Devuelve 0 si el input está vacío o no es numérico.
export function parseDecimal(v: string | number | null | undefined): number {
  if (v == null || v === '') return 0;
  const n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

// Normaliza un input: cualquier "." pasa a "," al instante, deja UNA sola coma
// decimal y descarta caracteres no numéricos. El operario ve siempre formato
// es-AR ("8,9") aunque haya tipeado "8.9" con teclado internacional — elimina
// la ambigüedad punto-decimal / punto-de-miles que provoca cargas absurdas
// (ej. "25.000" interpretado como 25000 en lugar de 25).
export function normalizarDecimal(v: string): string {
  let s = v.replace(/\./g, ',').replace(/[^0-9,]/g, '');
  const i = s.indexOf(',');
  if (i !== -1) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/,/g, '');
  return s;
}

// Formatea un número con separador es-AR ("1.500,5") hasta 3 decimales.
const NUM_FMT = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});
export function formatNum(n: number): string {
  return NUM_FMT.format(n);
}
