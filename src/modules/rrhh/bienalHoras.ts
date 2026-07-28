// ════════════════════════════════════════════════════════════════════════════
// CÁLCULO DE HORAS DE EVENTOS EXTERNOS (Bienal)
// ────────────────────────────────────────────────────────────────────────────
// Lógica pura, sin React ni Supabase: la consume BienalTab y se puede ejecutar
// suelta para verificar los números contra la base.
//
// Criterio (el mismo del tab Horas, para que sean comparables): pares
// entrada→salida cronológicos dentro de la jornada, con anti doble-tap. Un par
// de más de MAX_HORAS_TRAMO se considera salida no fichada y NO suma.
// ════════════════════════════════════════════════════════════════════════════
import { ANTIREBOTE_SEG } from './utils';

// Un par entrada→salida más largo que esto es una salida que nunca se fichó
// (el cierre quedó al día siguiente). No suma horas. Igual que HorasTab.
export const MAX_HORAS_TRAMO = 16;
// Umbrales de revisión: no cambian el total, solo levantan la bandera.
export const REVISAR_LARGO_H = 12; // turno sospechosamente largo
export const REVISAR_CORTO_H = 0.5; // fichada de prueba / error

export interface FichadaEvento {
  id: string;
  empleado_id: string;
  fecha: string;
  tipo: 'entrada' | 'salida';
  timestamp: string;
  local: 'vedia' | 'saavedra';
}

export type Alerta = 'sin_salida' | 'salida_huerfana' | 'largo' | 'corto' | 'cruce';

export const LABEL_ALERTA: Record<Alerta, string> = {
  sin_salida: 'Sin salida',
  salida_huerfana: 'Salida sin entrada',
  largo: `Turno > ${REVISAR_LARGO_H}h`,
  corto: 'Turno < 30min',
  cruce: 'Cambia de stand',
};

export const AYUDA_ALERTA: Record<Alerta, string> = {
  sin_salida:
    'Entrada sin salida: el turno quedó abierto. NO suma horas — hay que definir a mano cuándo cerró.',
  salida_huerfana: 'Salida sin entrada previa en la jornada. No suma horas.',
  largo: `Más de ${REVISAR_LARGO_H}h seguidas: casi siempre es la salida del turno noche marcada recién a la mañana siguiente. SUMA horas — revisar antes de pagar.`,
  corto: 'Menos de 30 minutos: probable fichada de prueba o error. Suma, pero es despreciable.',
  cruce:
    'Entró por el QR de un stand y salió por el del otro. Las horas se imputan al stand de entrada.',
};

export interface Turno {
  empleadoId: string;
  fecha: string;
  entrada: string; // timestamp ISO
  salida: string | null;
  standEntrada: 'vedia' | 'saavedra';
  standSalida: 'vedia' | 'saavedra' | null;
  horas: number; // 0 si no computa
  computa: boolean;
  alertas: Alerta[];
}

// Recibe las fichadas de UNA jornada de UN empleado, ya del mismo evento.
export function armarTurnos(
  empleadoId: string,
  fecha: string,
  marcas: FichadaEvento[],
): Turno[] {
  const ordenadas = [...marcas].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  // Anti doble-tap: dos marcas del mismo tipo dentro de la ventana de rebote son
  // el mismo toque repetido (pasó bastante con el QR en el predio).
  const limpias: FichadaEvento[] = [];
  for (const f of ordenadas) {
    const prev = limpias[limpias.length - 1];
    if (
      prev &&
      prev.tipo === f.tipo &&
      new Date(f.timestamp).getTime() - new Date(prev.timestamp).getTime() < ANTIREBOTE_SEG * 1000
    ) {
      continue;
    }
    limpias.push(f);
  }

  const turnos: Turno[] = [];
  let i = 0;
  while (i < limpias.length) {
    const f = limpias[i];

    if (f.tipo === 'salida') {
      turnos.push({
        empleadoId,
        fecha,
        entrada: f.timestamp,
        salida: null,
        standEntrada: f.local,
        standSalida: f.local,
        horas: 0,
        computa: false,
        alertas: ['salida_huerfana'],
      });
      i++;
      continue;
    }

    const next = limpias[i + 1];
    if (!next || next.tipo !== 'salida') {
      turnos.push({
        empleadoId,
        fecha,
        entrada: f.timestamp,
        salida: null,
        standEntrada: f.local,
        standSalida: null,
        horas: 0,
        computa: false,
        alertas: ['sin_salida'],
      });
      i++;
      continue;
    }

    const brutas = Math.max(
      0,
      (new Date(next.timestamp).getTime() - new Date(f.timestamp).getTime()) / 3600000,
    );
    const alertas: Alerta[] = [];
    const computa = brutas <= MAX_HORAS_TRAMO;
    if (!computa) alertas.push('sin_salida');
    else if (brutas > REVISAR_LARGO_H) alertas.push('largo');
    else if (brutas < REVISAR_CORTO_H) alertas.push('corto');
    if (f.local !== next.local) alertas.push('cruce');

    turnos.push({
      empleadoId,
      fecha,
      entrada: f.timestamp,
      salida: next.timestamp,
      standEntrada: f.local,
      standSalida: next.local,
      horas: computa ? brutas : 0,
      computa,
      alertas,
    });
    i += 2;
  }
  return turnos;
}

// Agrupa las fichadas crudas del evento por (empleado, jornada) y devuelve todos
// los turnos de cada empleado, ordenados cronológicamente.
export function turnosPorEmpleado(fichadas: FichadaEvento[]): Map<string, Turno[]> {
  const grupos = new Map<string, FichadaEvento[]>();
  for (const f of fichadas) {
    const k = `${f.empleado_id}|${f.fecha}`;
    const arr = grupos.get(k) ?? [];
    arr.push(f);
    grupos.set(k, arr);
  }
  const out = new Map<string, Turno[]>();
  for (const [k, marcas] of grupos) {
    const [empId, fecha] = k.split('|');
    const arr = out.get(empId) ?? [];
    arr.push(...armarTurnos(empId, fecha, marcas));
    out.set(empId, arr);
  }
  for (const arr of out.values()) arr.sort((a, b) => a.entrada.localeCompare(b.entrada));
  return out;
}
