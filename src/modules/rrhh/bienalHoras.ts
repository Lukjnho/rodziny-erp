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
import { VENTANA_TURNO_ABIERTO_H, sinDoblesToques, tramosDelDia } from './utils';

// Un par entrada→salida más largo que esto es una salida que nunca se fichó
// (el cierre quedó al día siguiente). No suma horas.
//
// 🔑 Ya NO es un 16 escrito acá: es el mismo de `utils`, que usan las tres
// pantallas. Antes había tres constantes con el mismo valor y tres nombres
// distintos, y coincidían de casualidad.
export const MAX_HORAS_TRAMO = VENTANA_TURNO_ABIERTO_H;
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
  // 🔑 El apareo, el anti doble-tap y el tope de 16 h ya NO se deciden acá:
  // los pone `tramosDelDia` (utils.ts), que es el mismo que usan Horas y
  // Asistencia. Lo único propio de la Bienal es de qué STAND salió cada marca
  // y las alertas de turno largo / corto / cruzado.
  //
  // `sinDoblesToques` se llama también acá para poder recuperar el `local` de
  // cada marca: es la misma limpieza que hace `tramosDelDia` adentro, así que
  // las marcas que quedan son exactamente las mismas.
  const limpias = sinDoblesToques(marcas);
  const porTimestamp = new Map(limpias.map((f) => [f.timestamp, f]));

  return tramosDelDia(limpias).map((t): Turno => {
    // El `!` es seguro y no es pereza: los timestamps de los tramos salen de
    // `limpias`, que es el mismo array con el que se armó este mapa.
    const entrada = porTimestamp.get(t.entrada)!;
    const salida = t.salida ? porTimestamp.get(t.salida)! : null;

    // Una salida huérfana se devuelve con su hora en `entrada` (así venía),
    // porque es la única marca que hay.
    if (t.motivo === 'salida_huerfana') {
      return {
        empleadoId,
        fecha,
        entrada: t.entrada,
        salida: null,
        standEntrada: entrada.local,
        standSalida: entrada.local,
        horas: 0,
        computa: false,
        alertas: ['salida_huerfana'],
      };
    }

    if (!t.computa) {
      // Cubre los dos casos que no suman: la entrada sin salida y el tramo de
      // más de 16 h, que es una salida que nunca se fichó. Para la planilla
      // son lo mismo: falta el cierre.
      return {
        empleadoId,
        fecha,
        entrada: t.entrada,
        salida: null,
        standEntrada: entrada.local,
        standSalida: null,
        horas: 0,
        computa: false,
        alertas: ['sin_salida'],
      };
    }

    const alertas: Alerta[] = [];
    if (t.horas > REVISAR_LARGO_H) alertas.push('largo');
    else if (t.horas < REVISAR_CORTO_H) alertas.push('corto');
    if (salida && entrada.local !== salida.local) alertas.push('cruce');

    return {
      empleadoId,
      fecha,
      entrada: t.entrada,
      salida: t.salida,
      standEntrada: entrada.local,
      // Si el tramo computa, tiene salida sí o sí: `tramosDelDia` sólo marca
      // `computa: true` cuando apareó una entrada con su salida.
      standSalida: salida!.local,
      horas: t.horas,
      computa: true,
      alertas,
    };
  });
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
