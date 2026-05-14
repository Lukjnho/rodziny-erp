/** Formatea un número como moneda ARS: $1.234.567 (o $1.234.567,50 si tiene centavos).
 *  Si se pasa `decimals` explícito, respeta ese valor; si no, muestra 2 decimales
 *  solo cuando el número tiene centavos reales (no redondea silenciosamente). */
export function formatARS(value: number, decimals?: number): string {
  const d = decimals ?? (Math.round(value * 100) % 100 === 0 ? 0 : 2);
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(value);
}

/** Formatea una cantidad (kg/unid/lt) en formato es-AR: coma decimal, punto miles.
 *  Acepta number o string (del DB viene como string en numeric). Devuelve '—' si vacío. */
export function fmtCantidad(n: number | string | null | undefined, decimals = 2): string {
  if (n == null || n === '') return '—';
  const num = typeof n === 'number' ? n : parseFloat(String(n));
  if (isNaN(num)) return '—';
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num);
}

/** Formatea una fecha DD/MM/YYYY.
 *
 * IMPORTANTE: `new Date("2026-05-12")` interpreta el string como UTC midnight,
 * y en Argentina (UTC-3) se renderiza como 11/05 → bug clásico de timezone.
 * Cuando el input es un string YYYY-MM-DD (sin hora), parseamos manualmente
 * los componentes para evitar el desplazamiento. Si tiene hora completa (ISO
 * timestamptz) usamos `new Date` normal porque ya trae la zona.
 */
export function formatFecha(date: string | Date): string {
  if (typeof date === 'string') {
    const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      // Local — sin pasar por Date para no perder el día por timezone
      return `${parseInt(m[3], 10)}/${parseInt(m[2], 10)}/${m[1]}`;
    }
    return new Date(date).toLocaleDateString('es-AR');
  }
  return date.toLocaleDateString('es-AR');
}

/** Número de serie Excel → fecha JS */
export function excelSerialToDate(serial: number): Date {
  const utc_days = Math.floor(serial - 25569);
  const utc_value = utc_days * 86400;
  return new Date(utc_value * 1000);
}

/** Clases condicionales */
export function cn(...classes: (string | undefined | false | null)[]): string {
  return classes.filter(Boolean).join(' ');
}
