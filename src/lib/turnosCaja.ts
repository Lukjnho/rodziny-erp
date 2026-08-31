/**
 * Cajas y turnos por local — fuente ÚNICA.
 *
 * Lo usan las dos puntas del mismo circuito:
 *  · el POS (módulo Caja), donde el cajero abre y cierra su turno;
 *  · Cierre de Caja (Finanzas), donde administración controla ese mismo turno.
 *
 * Estaba definido solo adentro de CierreCaja.tsx. Se extrajo acá para que el POS
 * no armara su propia lista y terminaran existiendo dos verdades distintas.
 */

export interface Turno {
  key: string;
  label: string;
  horaDesde: string;
  horaHasta: string;
}

/**
 * "POS Pruebas" es una caja aparte a propósito: los cierres se identifican por
 * (local, fecha, turno, caja), así que probando ahí NUNCA se pisa un cierre real
 * cargado por administración. Sacarla cuando el POS deje de ser una prueba.
 */
export const CAJA_PRUEBAS = 'POS Pruebas';

export const CAJAS: Record<string, string[]> = {
  vedia: ['Principal Pastas 1', 'Barra Bebidas', CAJA_PRUEBAS],
  saavedra: ['Caja Principal', CAJA_PRUEBAS],
  // Bienal 2026: 2 stands facturados por cajas separadas del Fudo de Saavedra.
  // Cada stand tiene su propia caja para que los cierres no se pisen entre sí.
  bienal: ['Stand Vedia', 'Stand Saavedra'],
};

export const TURNOS: Record<string, Turno[]> = {
  vedia: [
    { key: 'mediodia', label: 'Mediodía (11 a 16h)', horaDesde: '11:00', horaHasta: '16:00' },
    { key: 'noche', label: 'Noche (20 a 01h)', horaDesde: '20:00', horaHasta: '01:00' },
  ],
  saavedra: [
    { key: 'manana', label: 'Mañana (7:30 a 15:30h)', horaDesde: '07:00', horaHasta: '15:30' },
    { key: 'tarde', label: 'Tarde-Noche (17 a 00:30h)', horaDesde: '16:30', horaHasta: '00:30' },
  ],
  // Bienal: un solo cierre por stand por día (evento).
  bienal: [{ key: 'jornada', label: 'Jornada (todo el día)', horaDesde: '10:00', horaHasta: '23:59' }],
};

/**
 * Qué turno le corresponde a una hora. Si ninguno la contiene (ej. las 17h en
 * Vedia, entre el mediodía y la noche) devuelve el más cercano por arriba, y si
 * ya pasaron todos, el último. Nunca devuelve vacío: el cajero siempre puede
 * cambiarlo a mano, esto es solo la sugerencia inicial.
 */
export function turnoSugerido(local: string, horaHHMM: string): string {
  const turnos = TURNOS[local] ?? [];
  if (turnos.length === 0) return '';
  const min = (h: string) => {
    const [hh, mm] = h.split(':').map(Number);
    return hh * 60 + mm;
  };
  const ahora = min(horaHHMM);
  for (const t of turnos) {
    const desde = min(t.horaDesde);
    const hasta = min(t.horaHasta);
    // turno que cruza la medianoche (ej. 20:00 a 01:00)
    const dentro = hasta < desde ? ahora >= desde || ahora <= hasta : ahora >= desde && ahora <= hasta;
    if (dentro) return t.key;
  }
  const siguiente = turnos.find((t) => min(t.horaDesde) > ahora);
  return (siguiente ?? turnos[turnos.length - 1]).key;
}
