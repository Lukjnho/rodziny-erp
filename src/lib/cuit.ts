// Validación y formato de CUIT/CUIL argentino.
//
// El CUIT/CUIL son 11 dígitos: XX-XXXXXXXX-D, donde D es un dígito verificador
// calculado por módulo 11 sobre los 10 primeros. Validar el dígito acá corta de
// raíz los CUIT mal tipeados (y los que el OCR lee con un número cambiado) antes
// de que creen un proveedor trucho o un duplicado.

const PESOS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

/** Deja solo los dígitos: "30-71695754-9" → "30716957549". */
export function normalizarCuit(valor: string | null | undefined): string {
  return (valor ?? '').replace(/\D/g, '');
}

/** true si es un CUIT/CUIL de 11 dígitos con dígito verificador correcto. */
export function esCuitValido(valor: string | null | undefined): boolean {
  const c = normalizarCuit(valor);
  if (c.length !== 11) return false;
  // Prefijos válidos de CUIT/CUIL (personas físicas 20/23/24/27, jurídicas 30/33/34,
  // más 25/26 y algunos especiales). Filtra basura tipo "99..." sin ser tan estricto
  // que rechace un CUIT real raro.
  const prefijo = c.slice(0, 2);
  if (!['20', '23', '24', '25', '26', '27', '30', '33', '34'].includes(prefijo)) {
    return false;
  }
  const digitos = c.split('').map(Number);
  const suma = PESOS.reduce((acc, peso, i) => acc + peso * digitos[i], 0);
  let verificador = 11 - (suma % 11);
  if (verificador === 11) verificador = 0;
  if (verificador === 10) verificador = 9; // regla AFIP para el caso borde
  return verificador === digitos[10];
}

/** "30716957549" → "30-71695754-9". Devuelve el original si no tiene 11 dígitos. */
export function formatearCuit(valor: string | null | undefined): string {
  const c = normalizarCuit(valor);
  if (c.length !== 11) return valor ?? '';
  return `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}`;
}
