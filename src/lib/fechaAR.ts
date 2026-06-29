// Día operativo en horario de Argentina (UTC-3, sin horario de verano).
//
// `toISOString()` devuelve UTC, así que `new Date().toISOString().slice(0,10)`
// adelanta el día para cualquier carga hecha entre las 21:00 y las 23:59 AR
// (cuando en UTC ya es el día siguiente). Eso hacía que un lote cargado de
// noche se guardara con la fecha de mañana y "saltara" al día/semana siguiente.
//
// Además, la madrugada (00:00–04:59 AR) cuenta como el día operativo ANTERIOR:
// el turno noche de cocina cierra pasada la medianoche y todo eso se imputa al
// día que se trabajó. Es la misma convención del cierre de /mostrador
// (MostradorPage.tsx) y de useCierresFaltantes — mantener el valor en sync.
export const CORTE_JORNADA_H = 5;

export function hoyAR(): string {
  const offsetMs = (3 + CORTE_JORNADA_H) * 60 * 60 * 1000;
  return new Date(Date.now() - offsetMs).toISOString().slice(0, 10);
}
