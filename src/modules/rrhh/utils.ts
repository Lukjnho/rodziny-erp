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

// Tope por encima del cual una "tardanza" deja de ser real y es un desfase de
// turno: pasa cuando el empleado ficha un 2º turno que no está en el cronograma
// del día (ej: entrada 20:00 comparada contra las 11:00 = +540 min). Esos valores
// gigantes NO cuentan como tardanza.
export const TARDANZA_MAX_MIN = 180;

// ¿Esta diferencia de entrada es una tardanza REAL? (más de la tolerancia pero
// dentro de lo plausible; descarta los desfases de turno por cronograma incompleto)
export function esTardanzaReal(minutosDiferencia: number | null): boolean {
  return (
    minutosDiferencia !== null &&
    minutosDiferencia > TOLERANCIA_MIN &&
    minutosDiferencia <= TARDANZA_MAX_MIN
  );
}

// ── Presentismo ─────────────────────────────────────────────────────────────
// Modelo: el presentismo es un BENEFICIO del 10% que se SUMA al sueldo base
// cuando el empleado lo gana. empleados.sueldo_neto guarda el base SIN presentismo.
export const PRESENTISMO_PCT = 0.1;

// Monto del presentismo sobre un sueldo base (redondeado a pesos enteros, sin centavos)
export function montoPresentismo(base: number): number {
  return Math.round(base * PRESENTISMO_PCT);
}

// Remuneración esperada CON presentismo (base + 10%). Usar cuando se necesita el
// "en mano real" asumiendo que el empleado gana el presentismo: aguinaldo,
// costeo de mano de obra, proyección de caja, etc.
export function remuneracionConPresentismo(base: number): number {
  return base + montoPresentismo(base);
}

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
  return Math.trunc((ahora.getTime() - prog.getTime()) / 60000);
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
    // Truncamos (no redondeamos). Fichar 10:30 tarde debe registrar 10 min, no 11:
    // el umbral del CCT para perder presentismo es "> 10 min" y un empleado que
    // llega 10:30 no debería caer por el redondeo al minuto siguiente.
    let diff = Math.trunc((ahora.getTime() - prog.getTime()) / 60000);
    // Normalizar cruce de medianoche: si |diff|>12h asumir que hay un salto de día
    if (diff > 720) diff -= 1440;
    if (diff < -720) diff += 1440;
    if (mejor === null || Math.abs(diff) < Math.abs(mejor)) mejor = diff;
  }
  return mejor;
}

// ── Decisión de fichaje (entrada vs salida) ─────────────────────────────────
// Ventana máxima que puede durar un turno abierto (un par entrada→salida). Más
// allá de esto, una entrada sin salida se considera "olvido de salida", no un
// turno todavía abierto. Un turno legítimo no supera las ~16 h.
export const VENTANA_TURNO_ABIERTO_H = 16;

// Anti doble-tap: dos marcas del mismo empleado separadas por menos que esto son
// un toque repetido (o un reintento por red lenta), no un fichaje real.
export const ANTIREBOTE_SEG = 90;

// Fichada mínima necesaria para decidir el próximo tipo.
export interface FichadaMin {
  tipo: 'entrada' | 'salida';
  timestamp: string; // ISO
  fecha: string; // YYYY-MM-DD
}

// Datos de cronograma de un día (turnos o par legacy hora_entrada/hora_salida).
export interface CronoDia {
  turnos: TurnoCrono[] | null;
  hora_entrada: string | null;
  hora_salida: string | null;
}

interface LimiteTurno {
  kind: 'entrada' | 'salida';
  at: Date; // momento programado de ese límite
  fecha: string; // día base del turno (donde se imputa la marca)
  hhmm: string; // hora programada "HH:MM"
}

// Expande los turnos de un día a sus límites (entradas y salidas) como Date.
// Si la salida es <= entrada, cruza medianoche → cae al día siguiente.
function limitesDeDia(fechaBase: string, crono: CronoDia | null): LimiteTurno[] {
  if (!crono) return [];
  const src: TurnoCrono[] =
    crono.turnos && crono.turnos.length > 0
      ? crono.turnos
      : crono.hora_entrada && crono.hora_salida
        ? [{ entrada: crono.hora_entrada, salida: crono.hora_salida }]
        : [];
  const base = parseYmd(fechaBase);
  const out: LimiteTurno[] = [];
  for (const t of src) {
    const [eh, em] = t.entrada.split(':').map(Number);
    const [sh, sm] = t.salida.split(':').map(Number);
    const eAt = new Date(base);
    eAt.setHours(eh, em, 0, 0);
    const sAt = new Date(base);
    sAt.setHours(sh, sm, 0, 0);
    if (sAt.getTime() <= eAt.getTime()) sAt.setDate(sAt.getDate() + 1);
    out.push({ kind: 'entrada', at: eAt, fecha: fechaBase, hhmm: t.entrada });
    out.push({ kind: 'salida', at: sAt, fecha: fechaBase, hhmm: t.salida });
  }
  return out;
}

export interface DecisionFichada {
  tipo: 'entrada' | 'salida';
  fecha: string; // día al que se imputa la marca
  horarioTramo: string | null; // "HH:MM" programado del tramo, para el mensaje de confirmación
  advertencia: string | null; // aviso no bloqueante (ej. olvido de salida)
}

// Decide si el próximo fichaje es entrada o salida usando la ÚLTIMA marca del
// empleado y su cronograma (turnos de hoy + los de ayer que cruzan medianoche).
//
// Regla central (robusta ante marcas faltantes/sobrantes, a diferencia de contar
// paridad): tras una entrada abierta reciente, lo próximo SIEMPRE es salida; si
// no hay entrada abierta, lo próximo es entrada. El cronograma resuelve el caso
// del turno partido con una marca olvidada y aporta el horario de referencia.
export function decidirProximaFichada(params: {
  ahora: Date;
  fechaHoy: string;
  fechaAyer: string;
  cronoHoy: CronoDia | null;
  cronoAyer: CronoDia | null;
  ultimaFichada: FichadaMin | null;
}): DecisionFichada {
  const { ahora, fechaHoy, fechaAyer, cronoHoy, cronoAyer, ultimaFichada } = params;

  const msDesdeUltima = ultimaFichada
    ? ahora.getTime() - new Date(ultimaFichada.timestamp).getTime()
    : Infinity;
  const entradaAbierta =
    ultimaFichada?.tipo === 'entrada' && msDesdeUltima < VENTANA_TURNO_ABIERTO_H * 3_600_000;

  // Límite de horario más cercano al momento del fichaje (ayer para turnos que
  // cruzan medianoche + hoy).
  const limites = [...limitesDeDia(fechaAyer, cronoAyer), ...limitesDeDia(fechaHoy, cronoHoy)];
  let cercano: LimiteTurno | null = null;
  for (const l of limites) {
    if (
      !cercano ||
      Math.abs(l.at.getTime() - ahora.getTime()) < Math.abs(cercano.at.getTime() - ahora.getTime())
    ) {
      cercano = l;
    }
  }

  if (entradaAbierta) {
    // Excepción: el empleado olvidó marcar la salida y ya arranca un turno nuevo.
    // No alcanza con que el límite más cercano sea una entrada posterior a la
    // marca abierta: quien ficha unos minutos ANTES de su horario deja la entrada
    // programada "en el futuro" respecto de su marca, y eso NO es un turno nuevo
    // (es la misma entrada, temprana). La señal real de olvido es que exista una
    // SALIDA programada entre la entrada abierta y esa nueva entrada: significa que
    // el tramo anterior ya debía haber cerrado.
    const entradaTs = new Date(ultimaFichada!.timestamp).getTime();
    const haySalidaIntermedia =
      cercano?.kind === 'entrada' &&
      limites.some(
        (l) =>
          l.kind === 'salida' &&
          l.at.getTime() > entradaTs &&
          l.at.getTime() <= cercano!.at.getTime(),
      );
    const arrancaTurnoNuevo =
      cercano?.kind === 'entrada' && cercano.at.getTime() > entradaTs && haySalidaIntermedia;
    if (arrancaTurnoNuevo) {
      return {
        tipo: 'entrada',
        fecha: cercano!.fecha,
        horarioTramo: cercano!.hhmm,
        advertencia: 'Quedó una entrada anterior sin marcar la salida. Avisá a tu encargado.',
      };
    }
    // Cerramos el turno abierto: salida imputada al día de esa entrada.
    return {
      tipo: 'salida',
      fecha: ultimaFichada!.fecha,
      horarioTramo: cercano?.kind === 'salida' ? cercano.hhmm : null,
      advertencia: null,
    };
  }

  // Sin turno abierto → lo próximo es entrada.
  return {
    tipo: 'entrada',
    fecha: cercano?.kind === 'entrada' ? cercano.fecha : fechaHoy,
    horarioTramo: cercano?.kind === 'entrada' ? cercano.hhmm : null,
    advertencia: null,
  };
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
