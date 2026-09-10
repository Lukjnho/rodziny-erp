// La única puerta para escribir plata en el ERP.
//
// ⚠️ REGLA (definida por Lucas, 10-sep-2026): al tipear un monto, el PUNTO es
// SEPARADOR DE MILES. En Argentina se escribe 15.000 para quince mil pesos.
// La coma es el decimal. Esto vale SOLO para dinero: las cantidades de cocina
// (kg, porciones) usan la regla contraria y viven en `lib/numero.ts`.
//
// 💣 Hay DOS caminos y NUNCA se pueden mezclar:
//
//   base --> input   →  montoADisplay()    (el valor YA es un número)
//   tipeo --> número →  montoDesdeTipeo()  (el valor es lo que tecleó una persona)
//
// Mezclarlos es el bug que multiplicaba por 10 los precios de la carta y los
// campos de Fudo del cierre de caja: un 152350.5 que viene de la base pasaba
// por el parser de tipeo, que le borraba el punto, y quedaba 1.523.505.
// Un valor que viene de la base NO se reparsea. Se formatea.

/**
 * Camino BASE → INPUT. Convierte un número que ya existe (viene de la base, de
 * un cálculo, de una importación) en el texto que se muestra en el campo.
 *
 * Acepta string porque Supabase devuelve las columnas `numeric` como texto en
 * tiempo de ejecución aunque el tipo de TypeScript diga `number`. Si le pasáramos
 * ese string a `toLocaleString` sin convertir, devolvería el crudo "152350.5"
 * en vez de "152.350,5".
 */
export function montoADisplay(n: number | string | null | undefined): string {
  if (n == null || n === '') return '';
  const num = typeof n === 'number' ? n : Number(n);
  if (!isFinite(num)) return '';
  return num.toLocaleString('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

/**
 * Camino BASE → NÚMERO. Toma lo que devolvió Supabase para una columna de plata
 * y lo deja como número, o `null` si el campo está vacío.
 *
 * Existe porque una columna `numeric` llega como texto ("152350.50") y ese
 * texto tiene el punto como DECIMAL — al revés que el que teclea una persona.
 * Es el único lugar del ERP donde un punto que viene de la base se interpreta,
 * y por eso está separado de `montoDesdeTipeo`: confundirlos es el bug.
 *
 * Ojo: conserva el 0. Un cierre de caja con 0 contado no es lo mismo que uno
 * sin cargar, así que solo `null`/`undefined`/'' dan `null`.
 */
export function montoDesdeBase(v: number | string | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return isFinite(n) ? n : null;
}

/**
 * Camino TIPEO → NÚMERO. Interpreta lo que tecleó una persona.
 * El punto se descarta (es separador de miles) y la coma es el decimal.
 *
 * Devuelve `null` si el campo está vacío o no se puede leer, para que quien
 * llame distinga "no cargó nada" de "cargó cero" — que en un arqueo de caja
 * no son lo mismo.
 */
export function montoDesdeTipeo(s: string): number | null {
  if (!s.trim()) return null;
  const norm = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(norm);
  return isFinite(n) ? n : null;
}

/**
 * Igual que `montoDesdeTipeo` pero devuelve 0 en vez de null.
 * Para los lugares que suman campos y donde "vacío" y "cero" valen lo mismo.
 */
export function montoDesdeTipeoODefault(s: string, porDefecto = 0): number {
  return montoDesdeTipeo(s) ?? porDefecto;
}

/**
 * Formateo en vivo, mientras la persona escribe: va agrupando los miles y
 * corta en dos decimales. Es lo que hace que el campo muestre "152.350,5"
 * y no "1523505" mientras se teclea.
 *
 * No es ninguno de los dos caminos: es la presentación intermedia. Su salida
 * siempre es legible por `montoDesdeTipeo`.
 */
export function montoMientrasEscribe(s: string): string {
  const limpio = s.replace(/[^\d,]/g, '');
  const partes = limpio.split(',');
  const enteroSinFormat = partes[0] ?? '';
  const enteroNum = enteroSinFormat ? parseInt(enteroSinFormat, 10) : 0;
  const enteroFmt = isNaN(enteroNum)
    ? ''
    : enteroNum.toLocaleString('es-AR', { useGrouping: true });
  if (partes.length === 1) {
    return enteroSinFormat ? enteroFmt : '';
  }
  const dec = partes[1].slice(0, 2);
  return `${enteroFmt},${dec}`;
}
