// Helpers compartidos del módulo RRHH
// Usado por: CronogramaTab, FicharPage, AsistenciaTab

export type Quincena = 'q1' | 'q2'

export const DIAS_SEMANA = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
export const DIAS_SEMANA_LARGO = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
export const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

// Tolerancia en minutos para considerar puntual una entrada/salida
export const TOLERANCIA_MIN = 10

// ── Fecha en formato YYYY-MM-DD (timezone-safe) ─────────────────────────────
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── Parsear YYYY-MM-DD a Date local (sin shift de UTC) ──────────────────────
export function parseYmd(fecha: string): Date {
  const [y, m, d] = fecha.split('-').map(Number)
  return new Date(y, m - 1, d)
}

// ── Último día del mes (1-31) ───────────────────────────────────────────────
export function ultimoDiaDelMes(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

// ── Días de una quincena (array de YYYY-MM-DD) ──────────────────────────────
export function diasDeQuincena(year: number, month: number, q: Quincena): string[] {
  const inicio = q === 'q1' ? 1 : 15
  const fin = q === 'q1' ? 14 : ultimoDiaDelMes(year, month)
  const out: string[] = []
  for (let d = inicio; d <= fin; d++) out.push(ymd(new Date(year, month, d)))
  return out
}

// ── Sumar/restar días a una fecha YYYY-MM-DD ────────────────────────────────
export function sumarDias(fecha: string, dias: number): string {
  const dt = parseYmd(fecha)
  dt.setDate(dt.getDate() + dias)
  return ymd(dt)
}

// ── Diferencia en horas entre dos HH:MM (cruza medianoche si negativo) ──────
export function diffHoras(entrada: string | null, salida: string | null): number {
  if (!entrada || !salida) return 0
  const [eh, em] = entrada.split(':').map(Number)
  const [sh, sm] = salida.split(':').map(Number)
  let mins = (sh * 60 + sm) - (eh * 60 + em)
  if (mins < 0) mins += 24 * 60
  return mins / 60
}

// ── Diferencia en minutos entre un Date y una hora programada HH:MM ─────────
export function diffMinutosVsHorario(ahora: Date, horaProgramada: string | null): number | null {
  if (!horaProgramada) return null
  const [h, m] = horaProgramada.split(':').map(Number)
  const prog = new Date(ahora)
  prog.setHours(h, m, 0, 0)
  return Math.round((ahora.getTime() - prog.getTime()) / 60000)
}

// ── Formato HH:MM desde un Date ─────────────────────────────────────────────
export function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ── Etiqueta corta de una fecha YYYY-MM-DD ej "Lun 10/04" ───────────────────
export function etiquetaDia(fecha: string): string {
  const d = parseYmd(fecha)
  return `${DIAS_SEMANA[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

// ── Quincena actual según el día (1-14 = q1, 15+ = q2) ──────────────────────
export function quincenaDeFecha(fecha: string): Quincena {
  const d = parseYmd(fecha)
  return d.getDate() <= 14 ? 'q1' : 'q2'
}
