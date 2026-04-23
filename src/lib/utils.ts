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

/** Formatea una fecha DD/MM/YYYY */
export function formatFecha(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('es-AR');
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
