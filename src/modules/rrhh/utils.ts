// Helpers compartidos del módulo RRHH
// Usado por: CronogramaTab, FicharPage, AsistenciaTab

export type Quincena = 'q1' | 'q2';

export const DIAS_SEMANA = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
export const DIAS_SEMANA_LARGO = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
];
export const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

// Tolerancia en minutos para considerar puntual una entrada/salida
export const TOLERANCIA_MIN = 10;

// ── Fecha en formato YYYY-MM-DD (timezone-safe) ─────────────────────────────
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Parsear YYYY-MM-DD a Date local (sin shift de UTC) ──────────────────────
export function parseYmd(fecha: string): Date {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// ── Último día del mes (1-31) ───────────────────────────────────────────────
export function ultimoDiaDelMes(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

// ── Días de una quincena (array de YYYY-MM-DD) ──────────────────────────────
export function diasDeQuincena(year: number, month: number, q: Quincena): string[] {
  const inicio = q === 'q1' ? 1 : 15;
  const fin = q === 'q1' ? 14 : ultimoDiaDelMes(year, month);
  const out: string[] = [];
  for (let d = inicio; d <= fin; d++) out.push(ymd(new Date(year, month, d)));
  return out;
}

// ── Sumar/restar días a una fecha YYYY-MM-DD ────────────────────────────────
export function sumarDias(fecha: string, dias: number): string {
  const dt = parseYmd(fecha);
  dt.setDate(dt.getDate() + dias);
  return ymd(dt);
}

// ── Diferencia en horas entre dos HH:MM (cruza medianoche si negativo) ──────
export function diffHoras(entrada: string | null, salida: string | null): number {
  if (!entrada || !salida) return 0;
  const [eh, em] = entrada.split(':').map(Number);
  const [sh, sm] = salida.split(':').map(Number);
  let mins = sh * 60 + sm - (eh * 60 + em);
  if (mins < 0) mins += 24 * 60;
  return mins / 60;
}

// ── Turno de cronograma: puede haber varios en un día (jornada partida) ─────
export interface TurnoCrono {
  entrada: string;
  salida: string;
}

// Suma las horas reales trabajadas en un array de turnos. Si el array está
// vacío o nulo, cae al par legacy hora_entrada/hora_salida (compat).
export function sumHorasTurnos(
  turnos: TurnoCrono[] | null | undefined,
  legacyEntrada?: string | null,
  legacySalida?: string | null,
): number {
  if (turnos && turnos.length > 0) {
    return turnos.reduce((s, t) => s + diffHoras(t.entrada, t.salida), 0);
  }
  return diffHoras(legacyEntrada ?? null, legacySalida ?? null);
}

// ── Diferencia en minutos entre un Date y una hora programada HH:MM ─────────
export function diffMinutosVsHorario(ahora: Date, horaProgramada: string | null): number | null {
  if (!horaProgramada) return null;
  const [h, m] = horaProgramada.split(':').map(Number);
  const prog = new Date(ahora);
  prog.setHours(h, m, 0, 0);
  return Math.round((ahora.getTime() - prog.getTime()) / 60000);
}

// Dado un momento y una lista de turnos del día (posiblemente partida),
// elige la hora programada más cercana al fichaje y devuelve la diferencia
// en minutos, normalizada para cruces de medianoche.
// Ej: turnos=[{11:00-15:00},{20:00-00:30}], ahora=20:03 entrada → +3.
//     Si no hay turnos, cae al par legacy hora_entrada/hora_salida.
export function diffMinutosVsTurnos(
  ahora: Date,
  turnos: TurnoCrono[] | null | undefined,
  tipo: 'entrada' | 'salida',
  legacyEntrada?: string | null,
  legacySalida?: string | null,
): number | null {
  const opciones: string[] = [];
  if (turnos && turnos.length > 0) {
    for (const t of turnos) opciones.push(tipo === 'entrada' ? t.entrada : t.salida);
  } else {
    const h = tipo === 'entrada' ? legacyEntrada : legacySalida;
    if (h) opciones.push(h);
  }
  if (opciones.length === 0) return null;

  let mejor: number | null = null;
  for (const hp of opciones) {
    const [h, m] = hp.split(':').map(Number);
    const prog = new Date(ahora);
    prog.setHours(h, m, 0, 0);
    let diff = Math.round((ahora.getTime() - prog.getTime()) / 60000);
    // Normalizar cruce de medianoche: si |diff|>12h asumir que hay un salto de día
    if (diff > 720) diff -= 1440;
    if (diff < -720) diff += 1440;
    if (mejor === null || Math.abs(diff) < Math.abs(mejor)) mejor = diff;
  }
  return mejor;
}

// Formatea los turnos del día para mostrarlos al usuario.
// Ej: [{11:00-15:00},{20:00-00:30}] → "11:00–15:00 · 20:00–00:30"
export function formatTurnos(
  turnos: TurnoCrono[] | null | undefined,
  legacyEntrada?: string | null,
  legacySalida?: string | null,
): string {
  if (turnos && turnos.length > 0) return turnos.map((t) => `${t.entrada}–${t.salida}`).join(' · ');
  if (legacyEntrada && legacySalida) return `${legacyEntrada}–${legacySalida}`;
  return '';
}

// ── Formato HH:MM desde un Date ─────────────────────────────────────────────
export function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ── Etiqueta corta de una fecha YYYY-MM-DD ej "Lun 10/04" ───────────────────
export function etiquetaDia(fecha: string): string {
  const d = parseYmd(fecha);
  return `${DIAS_SEMANA[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ── Quincena actual según el día (1-14 = q1, 15+ = q2) ──────────────────────
export function quincenaDeFecha(fecha: string): Quincena {
  const d = parseYmd(fecha);
  return d.getDate() <= 14 ? 'q1' : 'q2';
}

// ── Normalizar texto para búsqueda: minúsculas y sin tildes ────────────────
// Uso: normalizarTexto('Martín Peña') === 'martin pena'
export function normalizarTexto(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}
