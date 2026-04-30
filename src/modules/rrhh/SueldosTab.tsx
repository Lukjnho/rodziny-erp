import { useState, useMemo, useEffect, useRef, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cn, formatARS } from '@/lib/utils';
import type { Empleado } from './RRHHPage';
import { MESES, diasDeQuincena, ultimoDiaDelMes, normalizarTexto, type Quincena } from './utils';
import type {
  Liquidacion,
  Adelanto,
  Sancion,
  Descuento,
  Bono,
  MedioPagoSueldo,
} from './sueldos/tipos';
import { periodoQuincena, periodoMes } from './sueldos/tipos';
import { PanelAdelantos } from './sueldos/PanelAdelantos';
import { PanelSanciones } from './sueldos/PanelSanciones';
import { PanelDescuentos } from './sueldos/PanelDescuentos';
import { PanelBonos } from './sueldos/PanelBonos';
import { PanelErroresCaja, type CierreCajaError } from './sueldos/PanelErroresCaja';
import { SeccionImpuestos } from './sueldos/SeccionImpuestos';

type FiltroLocal = 'todos' | 'vedia' | 'saavedra' | 'ambos';
type PanelEstado = {
  tipo: 'adelantos' | 'sanciones' | 'descuentos' | 'bonos' | 'errores_caja';
  empleadoId: string;
} | null;

// Mapeo nombre Fudo (closedBy) → { nombre, apellido } del empleado en RRHH.
// Cuando hay apellidos duplicados (ej: 2 Lis) se matchea por nombre + apellido.
// Incluye cajeros de Vedia y Saavedra (nombres tal como aparecen en Fudo closedBy)
const FUDO_CAJERO_EMPLEADO: Record<string, { nombre: string; apellido: string }> = {
  // ── Vedia ──
  marcos: { nombre: 'marcos', apellido: 'paredes' },
  brian: { nombre: 'brian', apellido: 'martinez' },
  'maxi vera': { nombre: 'maximiliano', apellido: 'vera' },
  martin: { nombre: 'martin', apellido: 'baez' },
  tomas: { nombre: 'tomas', apellido: 'lis' },
  'lucas lis': { nombre: 'lucas', apellido: 'lis' },
  tamara: { nombre: 'tamara', apellido: 'arzamendia' },
  // ── Saavedra ──
  karen: { nombre: 'karen', apellido: 'valenzuela' },
  ian: { nombre: 'ian', apellido: 'polaski' },
  lily: { nombre: 'liliana', apellido: 'gomez' },
  leandro: { nombre: 'leandro', apellido: 'acevedo' },
  'leandro acevedo': { nombre: 'leandro', apellido: 'acevedo' },
  selene: { nombre: 'selene', apellido: 'jara' },
  nahiara: { nombre: 'nahiara', apellido: 'robledo' },
  emanuel: { nombre: 'emanuel', apellido: 'aguilar' },
  gerardo: { nombre: 'gerardo', apellido: 'herrera' },
  'lucas mariano lis': { nombre: 'lucas', apellido: 'lis' },
  'tomás lis': { nombre: 'tomas', apellido: 'lis' },
};

interface Cronograma {
  id: string;
  empleado_id: string;
  fecha: string;
  hora_entrada: string | null;
  hora_salida: string | null;
  es_franco: boolean;
  publicado: boolean;
}

interface Fichada {
  id: string;
  empleado_id: string;
  fecha: string;
  tipo: 'entrada' | 'salida';
  minutos_diferencia: number | null;
}

// ── Presentismo CCT ─────────────────────────────────────────────────────────
// Regla: 0 ausencias Y (0 tardanzas O exactamente 1 tardanza ≤10min)
function calcularPresentismoAuto(
  empleado: Empleado,
  rangoFechas: string[],
  fichadas: Fichada[],
  cronograma: Cronograma[],
  hoyYmd: string,
): boolean {
  let ausencias = 0;
  let tardanzasTotales = 0;
  let tardanzasGraves = 0;

  for (const fecha of rangoFechas) {
    if (fecha > hoyYmd) continue; // ignorar días futuros
    const crono = cronograma.find((c) => c.empleado_id === empleado.id && c.fecha === fecha);
    if (!crono || !crono.publicado || crono.es_franco) continue;

    const fs = fichadas.filter((f) => f.empleado_id === empleado.id && f.fecha === fecha);
    if (fs.length === 0) {
      ausencias++;
      continue;
    }

    const entrada = fs.find((f) => f.tipo === 'entrada');
    if (entrada && entrada.minutos_diferencia !== null && entrada.minutos_diferencia > 0) {
      tardanzasTotales++;
      if (entrada.minutos_diferencia > 10) tardanzasGraves++;
    }
  }

  if (ausencias > 0) return false;
  if (tardanzasTotales === 0) return true;
  if (tardanzasTotales === 1 && tardanzasGraves === 0) return true;
  return false;
}

// ════════════════════════════════════════════════════════════════════════════
export function SueldosTab() {
  const qc = useQueryClient();
  const hoy = new Date();
  const [year, setYear] = useState(hoy.getFullYear());
  const [month, setMonth] = useState(hoy.getMonth());
  const [quincena, setQuincena] = useState<Quincena>(hoy.getDate() <= 14 ? 'q1' : 'q2');
  const [filtroLocal, setFiltroLocal] = useState<FiltroLocal>('todos');
  const [busqueda, setBusqueda] = useState('');
  const [panel, setPanel] = useState<PanelEstado>(null);
  const [expandido, setExpandido] = useState<string | null>(null); // empleado_id expandido

  // Modal de pago mixto (efectivo + transferencia)
  const [mixtoModal, setMixtoModal] = useState<{
    empleadoId: string;
    empleadoNombre: string;
    local: string;
    total: number;
    montoEf: string; // input string (formato "250000")
    montoTr: string;
  } | null>(null);

  const periodoActual = useMemo(
    () => periodoQuincena(year, month, quincena),
    [year, month, quincena],
  );
  const periodoQ1 = useMemo(() => periodoQuincena(year, month, 'q1'), [year, month]);
  const periodoQ2 = useMemo(() => periodoQuincena(year, month, 'q2'), [year, month]);
  const pMes = useMemo(() => periodoMes(year, month), [year, month]);

  // Rango del mes completo (para fetch de fichadas/cronograma)
  const ultimoDia = ultimoDiaDelMes(year, month);
  const fechaDesdeMes = `${pMes}-01`;
  const fechaHastaMes = `${pMes}-${String(ultimoDia).padStart(2, '0')}`;

  const diasQuincenaActual = useMemo(
    () => diasDeQuincena(year, month, quincena),
    [year, month, quincena],
  );
  const diasMes = useMemo(
    () => [...diasDeQuincena(year, month, 'q1'), ...diasDeQuincena(year, month, 'q2')],
    [year, month],
  );

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data: empleados } = useQuery({
    queryKey: ['empleados'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('empleados')
        .select('*')
        .eq('activo', true)
        .neq('estado_laboral', 'baja')
        .order('apellido');
      if (error) throw error;
      return data as Empleado[];
    },
  });

  const { data: fichadas } = useQuery({
    queryKey: ['fichadas', fechaDesdeMes, fechaHastaMes],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fichadas')
        .select('id, empleado_id, fecha, tipo, minutos_diferencia')
        .gte('fecha', fechaDesdeMes)
        .lte('fecha', fechaHastaMes);
      if (error) throw error;
      return data as Fichada[];
    },
  });

  const { data: cronograma } = useQuery({
    queryKey: ['cronograma', fechaDesdeMes, fechaHastaMes],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cronograma')
        .select('*')
        .gte('fecha', fechaDesdeMes)
        .lte('fecha', fechaHastaMes);
      if (error) throw error;
      return data as Cronograma[];
    },
  });

  const { data: liquidaciones } = useQuery({
    queryKey: ['liquidaciones', periodoQ1, periodoQ2],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('liquidaciones_quincenales')
        .select('*')
        .in('periodo', [periodoQ1, periodoQ2]);
      if (error) throw error;
      return data as Liquidacion[];
    },
  });

  // Filas reales en pagos_sueldos del periodo. Cuando una liquidación es mixta,
  // hay 2 filas (una por medio): el split queda definido acá.
  const { data: pagosSueldosPeriodo } = useQuery({
    queryKey: ['pagos_sueldos_periodo', periodoQ1, periodoQ2],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pagos_sueldos')
        .select('id, empleado_id, periodo, monto, medio_pago')
        .in('periodo', [periodoQ1, periodoQ2]);
      if (error) throw error;
      return (data ?? []) as {
        id: string;
        empleado_id: string;
        periodo: string;
        monto: number;
        medio_pago: 'efectivo' | 'transferencia';
      }[];
    },
  });

  const { data: adelantos } = useQuery({
    queryKey: ['adelantos', periodoQ1, periodoQ2],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('adelantos')
        .select('*')
        .in('periodo', [periodoQ1, periodoQ2]);
      if (error) throw error;
      return data as Adelanto[];
    },
  });

  const { data: sanciones } = useQuery({
    queryKey: ['sanciones', periodoQ1, periodoQ2],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sanciones')
        .select('*')
        .in('periodo', [periodoQ1, periodoQ2]);
      if (error) throw error;
      return data as Sancion[];
    },
  });

  const { data: descuentos } = useQuery({
    queryKey: ['descuentos', periodoQ1, periodoQ2],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('descuentos')
        .select('*')
        .in('periodo', [periodoQ1, periodoQ2]);
      if (error) throw error;
      return data as Descuento[];
    },
  });

  const { data: bonos } = useQuery({
    queryKey: ['bonos', periodoQ1, periodoQ2],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bonos')
        .select('*')
        .in('periodo', [periodoQ1, periodoQ2]);
      if (error) throw error;
      return data as Bono[];
    },
  });

  // Cierres de caja con diferencia (para trackear errores por cajero)
  const { data: cierresCaja } = useQuery({
    queryKey: ['cierres_caja_errores', fechaDesdeMes, fechaHastaMes],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cierres_caja')
        .select(
          'id, fecha, turno, caja, diferencia, monto_contado, monto_esperado, cajero_nombre, nota',
        )
        .gte('fecha', fechaDesdeMes)
        .lte('fecha', fechaHastaMes)
        .not('diferencia', 'eq', 0)
        .not('cajero_nombre', 'is', null);
      if (error) throw error;
      return data as CierreCajaError[];
    },
  });

  // ── Mutaciones ────────────────────────────────────────────────────────────
  const upsertLiquidacion = useMutation({
    mutationFn: async (payload: {
      empleado_id: string;
      periodo: string;
      patch: Partial<Liquidacion>;
    }) => {
      const { error } = await supabase
        .from('liquidaciones_quincenales')
        .upsert(
          { empleado_id: payload.empleado_id, periodo: payload.periodo, ...payload.patch },
          { onConflict: 'empleado_id,periodo' },
        );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['liquidaciones'] }),
    onError: (e: Error) => window.alert(`Error: ${e.message}`),
  });

  // Mutación de pago: actualiza liquidación + reescribe filas de pagos_sueldos.
  // Estrategia delete+insert (la unique (empleado, periodo) ya no existe en pagos_sueldos
  // para permitir 2 filas en pagos mixtos: una efectivo + una transferencia).
  const cambiarPago = useMutation({
    mutationFn: async (payload: {
      empleado_id: string;
      periodo: string;
      medio: MedioPagoSueldo | null;
      monto: number; // total de la liquidación (para 'efectivo' / 'transferencia')
      montoEfectivo?: number; // solo si medio = 'mixto'
      montoTransferencia?: number; // solo si medio = 'mixto'
      local: string;
      empleado_nombre: string;
    }) => {
      // 1) Actualizar liquidación
      const { error: errLiq } = await supabase.from('liquidaciones_quincenales').upsert(
        {
          empleado_id: payload.empleado_id,
          periodo: payload.periodo,
          pagado: payload.medio !== null,
          medio_pago: payload.medio,
          fecha_pago: payload.medio !== null ? hoyYmd : null,
        },
        { onConflict: 'empleado_id,periodo' },
      );
      if (errLiq) throw errLiq;

      // 2) Borrar filas previas de pagos_sueldos para este (empleado, periodo)
      const { error: errDel } = await supabase
        .from('pagos_sueldos')
        .delete()
        .eq('empleado_id', payload.empleado_id)
        .eq('periodo', payload.periodo);
      if (errDel) throw errDel;

      if (payload.medio === null) return; // desmarcar pago: solo borra

      const baseRow = {
        empleado_id: payload.empleado_id,
        periodo: payload.periodo,
        fecha_pago: hoyYmd,
        local: payload.local,
        empleado_nombre: payload.empleado_nombre,
        updated_at: new Date().toISOString(),
      };

      let rows: Array<typeof baseRow & { monto: number; medio_pago: 'efectivo' | 'transferencia' }>;
      if (payload.medio === 'mixto') {
        const ef = payload.montoEfectivo ?? 0;
        const tr = payload.montoTransferencia ?? 0;
        if (ef <= 0 && tr <= 0) throw new Error('Mixto requiere al menos un monto > 0');
        rows = [];
        if (ef > 0) rows.push({ ...baseRow, monto: ef, medio_pago: 'efectivo' });
        if (tr > 0) rows.push({ ...baseRow, monto: tr, medio_pago: 'transferencia' });
      } else {
        rows = [{ ...baseRow, monto: payload.monto, medio_pago: payload.medio }];
      }

      const { error: errIns } = await supabase.from('pagos_sueldos').insert(rows);
      if (errIns) throw errIns;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['liquidaciones'] });
      qc.invalidateQueries({ queryKey: ['pagos_sueldos_periodo'] });
      qc.invalidateQueries({ queryKey: ['fc_pagos_sueldos'] });
    },
    onError: (e: Error) => window.alert(`Error al registrar pago: ${e.message}`),
  });

  const updateModalidad = useMutation({
    mutationFn: async (payload: { id: string; modalidad: 'quincenal' | 'mensual' }) => {
      const { data, error } = await supabase
        .from('empleados')
        .update({ modalidad_cobro: payload.modalidad })
        .eq('id', payload.id)
        .select('id, modalidad_cobro');
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error(
          'El update no afectó ninguna fila. Posible causa: RLS bloquea UPDATE en empleados, o la columna modalidad_cobro no existe todavía.',
        );
      }
      if (data[0].modalidad_cobro !== payload.modalidad) {
        throw new Error(
          `El DB devolvió modalidad=${data[0].modalidad_cobro}, esperaba ${payload.modalidad}`,
        );
      }
    },
    onMutate: async (payload) => {
      await qc.cancelQueries({ queryKey: ['empleados'] });
      const previo = qc.getQueryData<Empleado[]>(['empleados']);
      if (previo) {
        qc.setQueryData<Empleado[]>(
          ['empleados'],
          previo.map((e) =>
            e.id === payload.id ? { ...e, modalidad_cobro: payload.modalidad } : e,
          ),
        );
      }
      return { previo };
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.previo) qc.setQueryData(['empleados'], ctx.previo);
      window.alert(`Error al cambiar modalidad: ${e.message}`);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['empleados'] }),
  });

  // ── Empleados filtrados ──────────────────────────────────────────────────
  const empleadosFiltrados = useMemo(() => {
    if (!empleados) return [];
    return empleados.filter((e) => {
      if (filtroLocal === 'vedia' && e.local !== 'vedia' && e.local !== 'ambos') return false;
      if (filtroLocal === 'saavedra' && e.local !== 'saavedra' && e.local !== 'ambos') return false;
      if (filtroLocal === 'ambos' && e.local !== 'ambos') return false;
      if (busqueda.trim()) {
        const q = normalizarTexto(busqueda);
        const txt = normalizarTexto(`${e.nombre} ${e.apellido} ${e.dni ?? ''}`);
        if (!txt.includes(q)) return false;
      }
      return true;
    });
  }, [empleados, filtroLocal, busqueda]);

  // ── Filas calculadas ─────────────────────────────────────────────────────
  // Stats de asistencia por empleado (para resumen inline)
  type AsistenciaStats = {
    diasLaborales: number;
    completos: number;
    ausencias: number;
    tardanzas: number;
    tardanzasGraves: number; // >10 min
    francos: number;
    detalleTardanzas: { fecha: string; minutos: number }[];
    detalleFaltas: string[]; // fechas de ausencia
  };

  type Fila = {
    empleado: Empleado;
    modalidad: 'quincenal' | 'mensual';
    esMensualEnQ1: boolean; // mensual viendo Q1 → row atenuada, no cobra
    base: number;
    liquidacion: Liquidacion | undefined;
    presentismoAuto: boolean;
    cobraPresentismo: boolean;
    presentismoOverride: boolean;
    deduccionPresentismo: number;
    adelantosEmp: Adelanto[];
    sancionesEmp: Sancion[];
    descuentosEmp: Descuento[];
    bonosEmp: Bono[];
    erroresCajaEmp: CierreCajaError[];
    adelantosMonto: number;
    sancionesMonto: number;
    descuentosMonto: number;
    bonosMonto: number;
    total: number;
    pagado: boolean;
    medioPago: MedioPagoSueldo | null;
    // Montos efectivamente registrados en pagos_sueldos para el periodo actual.
    // Si la liquidación es 'mixto' aparecen los 2; si es pura aparece uno solo; si está sin pagar son 0.
    montoEfectivoPagado: number;
    montoTransferenciaPagado: number;
    asistencia: AsistenciaStats;
  };

  const hoyYmd = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;

  const filas: Fila[] = useMemo(() => {
    if (!empleadosFiltrados.length || !fichadas || !cronograma) return [];

    return empleadosFiltrados.map((emp) => {
      const modalidad = (emp.modalidad_cobro ?? 'quincenal') as 'quincenal' | 'mensual';
      const esMensualEnQ1 = modalidad === 'mensual' && quincena === 'q1';
      const esMensualEnQ2 = modalidad === 'mensual' && quincena === 'q2';

      // Base
      let base = 0;
      if (modalidad === 'quincenal') base = Number(emp.sueldo_neto) / 2;
      else if (esMensualEnQ2) base = Number(emp.sueldo_neto);
      else base = 0;

      // Presentismo: rango según modalidad
      const rangoPres =
        modalidad === 'quincenal'
          ? diasQuincenaActual
          : esMensualEnQ2
            ? diasMes
            : diasQuincenaActual; // Q1 mensual: no aplica pero calculamos igual para mostrar
      const presentismoAuto = calcularPresentismoAuto(emp, rangoPres, fichadas, cronograma, hoyYmd);

      // Liquidación: siempre en la quincena actual
      const liquidacion = liquidaciones?.find(
        (l) => l.empleado_id === emp.id && l.periodo === periodoActual,
      );
      const cobraPresentismo =
        liquidacion && liquidacion.cobra_presentismo !== null
          ? liquidacion.cobra_presentismo
          : presentismoAuto;
      const presentismoOverride =
        !!liquidacion && liquidacion.cobra_presentismo !== presentismoAuto;

      const deduccionPresentismo = !cobraPresentismo && base > 0 ? (base * 10) / 110 : 0;

      // Adelantos y sanciones
      // - quincenal: solo los del periodo actual
      // - mensual Q1: los del Q1 (se muestran pero no descuentan porque base=0)
      // - mensual Q2: los de todo el mes (Q1 + Q2)
      const periodosRelevantes = esMensualEnQ2 ? [periodoQ1, periodoQ2] : [periodoActual];
      const adelantosEmp =
        adelantos?.filter(
          (a) => a.empleado_id === emp.id && periodosRelevantes.includes(a.periodo),
        ) ?? [];
      const sancionesEmp =
        sanciones?.filter(
          (s) => s.empleado_id === emp.id && periodosRelevantes.includes(s.periodo),
        ) ?? [];
      const descuentosEmp =
        descuentos?.filter(
          (d) => d.empleado_id === emp.id && periodosRelevantes.includes(d.periodo),
        ) ?? [];
      const bonosEmp =
        bonos?.filter(
          (b) => b.empleado_id === emp.id && periodosRelevantes.includes(b.periodo),
        ) ?? [];
      const adelantosMonto = adelantosEmp.reduce((s, a) => s + Number(a.monto), 0);
      const sancionesMonto = sancionesEmp.reduce((s, a) => s + Number(a.monto), 0);
      const descuentosMonto = descuentosEmp.reduce((s, d) => s + Number(d.monto), 0);
      const bonosMonto = bonosEmp.reduce((s, b) => s + Number(b.monto), 0);

      // Errores de caja: vincular por cajero_nombre → empleado (nombre + apellido)
      const erroresCajaEmp = (cierresCaja ?? []).filter((c) => {
        if (!c.cajero_nombre) return false;
        const match = FUDO_CAJERO_EMPLEADO[c.cajero_nombre.toLowerCase()];
        if (!match) return false;
        return (
          emp.apellido.toLowerCase() === match.apellido &&
          emp.nombre.toLowerCase().startsWith(match.nombre)
        );
      });

      // Mensual en Q1: no cobra ni descuenta nada en esta quincena. Los adelantos/sanciones
      // del Q1 se muestran informativamente y se descontarán del total en Q2.
      // Redondeo a múltiplo de 100 más cercano para que termine en 00 (más práctico para pagar en cash).
      const totalCrudo =
        base -
        deduccionPresentismo -
        adelantosMonto -
        sancionesMonto -
        descuentosMonto +
        bonosMonto;
      const total = esMensualEnQ1 ? 0 : Math.round(totalCrudo / 100) * 100;

      // ── Calcular stats de asistencia ──
      const rangoPresentismo =
        modalidad === 'quincenal'
          ? diasQuincenaActual
          : esMensualEnQ2
            ? diasMes
            : diasQuincenaActual;
      let statsAusencias = 0;
      let statsTardanzas = 0;
      let statsTardanzasGraves = 0;
      let statsCompletos = 0;
      let statsFrancos = 0;
      let statsLaborales = 0;
      const detalleTardanzas: { fecha: string; minutos: number }[] = [];
      const detalleFaltas: string[] = [];

      for (const fecha of rangoPresentismo) {
        if (fecha > hoyYmd) continue;
        const crono = cronograma.find((c) => c.empleado_id === emp.id && c.fecha === fecha);
        if (!crono || !crono.publicado) continue;
        if (crono.es_franco) {
          statsFrancos++;
          continue;
        }
        statsLaborales++;

        const fs = fichadas.filter((f) => f.empleado_id === emp.id && f.fecha === fecha);
        if (fs.length === 0) {
          statsAusencias++;
          detalleFaltas.push(fecha);
          continue;
        }

        const entrada = fs.find((f) => f.tipo === 'entrada');
        if (entrada && entrada.minutos_diferencia !== null && entrada.minutos_diferencia > 0) {
          statsTardanzas++;
          if (entrada.minutos_diferencia > 10) statsTardanzasGraves++;
          detalleTardanzas.push({ fecha, minutos: entrada.minutos_diferencia });
        }

        // Si tiene entrada y salida → completo
        const tieneSalida = fs.some((f) => f.tipo === 'salida');
        if (entrada && tieneSalida) statsCompletos++;
      }

      const asistencia: AsistenciaStats = {
        diasLaborales: statsLaborales,
        completos: statsCompletos,
        ausencias: statsAusencias,
        tardanzas: statsTardanzas,
        tardanzasGraves: statsTardanzasGraves,
        francos: statsFrancos,
        detalleTardanzas,
        detalleFaltas,
      };

      // Split real desde pagos_sueldos del periodoActual
      const pagosEmp = (pagosSueldosPeriodo ?? []).filter(
        (p) => p.empleado_id === emp.id && p.periodo === periodoActual,
      );
      const montoEfectivoPagado = pagosEmp
        .filter((p) => p.medio_pago === 'efectivo')
        .reduce((s, p) => s + Number(p.monto), 0);
      const montoTransferenciaPagado = pagosEmp
        .filter((p) => p.medio_pago === 'transferencia')
        .reduce((s, p) => s + Number(p.monto), 0);

      return {
        empleado: emp,
        modalidad,
        esMensualEnQ1,
        base,
        liquidacion,
        presentismoAuto,
        cobraPresentismo,
        presentismoOverride,
        deduccionPresentismo,
        adelantosEmp,
        sancionesEmp,
        descuentosEmp,
        bonosEmp,
        erroresCajaEmp,
        adelantosMonto,
        sancionesMonto,
        descuentosMonto,
        bonosMonto,
        total,
        pagado: !!liquidacion?.pagado,
        medioPago: (liquidacion?.medio_pago ?? null) as MedioPagoSueldo | null,
        montoEfectivoPagado,
        montoTransferenciaPagado,
        asistencia,
      };
    });
  }, [
    empleadosFiltrados,
    fichadas,
    cronograma,
    liquidaciones,
    pagosSueldosPeriodo,
    adelantos,
    sanciones,
    descuentos,
    bonos,
    cierresCaja,
    quincena,
    periodoActual,
    periodoQ1,
    periodoQ2,
    diasQuincenaActual,
    diasMes,
    hoyYmd,
  ]);

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const filasAPagar = filas.filter((f) => !f.esMensualEnQ1);
    const totalAPagar = filasAPagar.reduce((s, f) => s + f.total, 0);
    const totalAdelantos = filas.reduce((s, f) => s + f.adelantosMonto, 0);
    const totalSanciones = filas.reduce((s, f) => s + f.sancionesMonto, 0);
    const totalDescuentos = filas.reduce((s, f) => s + f.descuentosMonto, 0);
    const totalBonos = filas.reduce((s, f) => s + f.bonosMonto, 0);
    const pagados = filasAPagar.filter((f) => f.pagado).length;
    const totalEmpleados = filasAPagar.length;
    // Sumar desde montos reales en pagos_sueldos para respetar splits mixtos
    const pagadoEfectivo = filasAPagar.reduce((s, f) => s + f.montoEfectivoPagado, 0);
    const pagadoTransferencia = filasAPagar.reduce((s, f) => s + f.montoTransferenciaPagado, 0);
    return {
      totalAPagar,
      totalAdelantos,
      totalSanciones,
      totalDescuentos,
      totalBonos,
      pagados,
      totalEmpleados,
      pagadoEfectivo,
      pagadoTransferencia,
    };
  }, [filas]);

  // ── Sync pagos_sueldos cuando cambia el monto de un empleado ya pagado ──
  // (ej: se togglea presentismo, se agrega adelanto, etc. después de marcar pagado)
  // Solo aplica a pagos puros (efectivo/transferencia). Para 'mixto' la división
  // entre medios es manual, así que NO se auto-sincroniza: si el total cambia,
  // Lucas reabre el modal Mixto para reajustar el split.
  const syncRef = useRef(false);
  useEffect(() => {
    if (!filas.length || syncRef.current) return;
    const pagadosConCambio = filas.filter(
      (f) =>
        f.pagado &&
        (f.medioPago === 'efectivo' || f.medioPago === 'transferencia') &&
        f.total > 0 &&
        !f.esMensualEnQ1,
    );
    if (!pagadosConCambio.length) return;

    // Solo re-escribir si el monto registrado difiere del total actual (evita writes innecesarios).
    const aSync = pagadosConCambio.filter((f) => {
      const registrado = f.montoEfectivoPagado + f.montoTransferenciaPagado;
      return Math.abs(registrado - f.total) > 0;
    });
    if (!aSync.length) return;

    // Debounce: solo sincronizar una vez por ciclo de render
    syncRef.current = true;
    const timeout = setTimeout(async () => {
      for (const fila of aSync) {
        // delete + insert (la unique ya no existe, así que upsert onConflict no aplica)
        await supabase
          .from('pagos_sueldos')
          .delete()
          .eq('empleado_id', fila.empleado.id)
          .eq('periodo', periodoActual);
        await supabase.from('pagos_sueldos').insert({
          empleado_id: fila.empleado.id,
          periodo: periodoActual,
          fecha_pago: fila.liquidacion?.fecha_pago ?? hoyYmd,
          monto: fila.total,
          medio_pago: fila.medioPago as 'efectivo' | 'transferencia',
          local: fila.empleado.local,
          empleado_nombre: `${fila.empleado.apellido}, ${fila.empleado.nombre}`,
          updated_at: new Date().toISOString(),
        });
      }
      qc.invalidateQueries({ queryKey: ['pagos_sueldos_periodo'] });
      qc.invalidateQueries({ queryKey: ['fc_pagos_sueldos'] });
      syncRef.current = false;
    }, 2000); // esperar 2s para no bombardear en cada re-render
    return () => {
      clearTimeout(timeout);
      syncRef.current = false;
    };
  }, [filas, periodoActual, hoyYmd, qc]);

  // ── Navegación ───────────────────────────────────────────────────────────
  function navegarQuincena(delta: number) {
    if (delta > 0) {
      if (quincena === 'q1') setQuincena('q2');
      else {
        setQuincena('q1');
        if (month === 11) {
          setMonth(0);
          setYear(year + 1);
        } else setMonth(month + 1);
      }
    } else {
      if (quincena === 'q2') setQuincena('q1');
      else {
        setQuincena('q2');
        if (month === 0) {
          setMonth(11);
          setYear(year - 1);
        } else setMonth(month - 1);
      }
    }
  }

  // ── Panel abierto: data ──────────────────────────────────────────────────
  const panelData = useMemo(() => {
    if (!panel) return null;
    const fila = filas.find((f) => f.empleado.id === panel.empleadoId);
    if (!fila) return null;
    // Para mensuales en Q2 el panel muestra todo el mes → usa periodoMes como label,
    // pero al cargar un adelanto lo asigna al periodo ACTUAL (quincena visible).
    return { fila, periodo: periodoActual };
  }, [panel, filas, periodoActual]);

  return (
    <div className="space-y-4">
      {/* ── Toolbar ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-3">
        <div className="flex items-center gap-1">
          <button
            onClick={() => navegarQuincena(-1)}
            className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100"
          >
            ‹
          </button>
          <span className="min-w-[180px] text-center text-sm font-medium text-gray-900">
            {MESES[month]} {year} · {quincena === 'q1' ? 'Q1 (1-14)' : `Q2 (15-${ultimoDia})`}
          </span>
          <button
            onClick={() => navegarQuincena(1)}
            className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100"
          >
            ›
          </button>
        </div>

        <select
          value={filtroLocal}
          onChange={(e) => setFiltroLocal(e.target.value as FiltroLocal)}
          className="rounded border border-gray-300 px-2 py-1 text-xs"
        >
          <option value="todos">Todos los locales</option>
          <option value="vedia">Vedia</option>
          <option value="saavedra">Saavedra</option>
          <option value="ambos">Ambos locales</option>
        </select>

        <input
          type="text"
          placeholder="Buscar empleado..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="min-w-[180px] flex-1 rounded border border-gray-300 px-2 py-1 text-xs"
        />
      </div>

      {/* ── KPIs ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <KpiMini label="Total a pagar" value={formatARS(kpis.totalAPagar)} color="green" />
        <KpiMini
          label="Pagados"
          value={`${kpis.pagados} / ${kpis.totalEmpleados}`}
          color={kpis.pagados === kpis.totalEmpleados ? 'green' : 'amber'}
        />
        <KpiMini label="Efectivo" value={formatARS(kpis.pagadoEfectivo)} color="green" />
        <KpiMini label="Transferencia" value={formatARS(kpis.pagadoTransferencia)} color="blue" />
        <KpiMini label="Bonos" value={formatARS(kpis.totalBonos)} color="green" />
        <KpiMini label="Adelantos" value={formatARS(kpis.totalAdelantos)} color="gray" />
        <KpiMini label="Sanciones" value={formatARS(kpis.totalSanciones)} color="red" />
        <KpiMini label="Descuentos" value={formatARS(kpis.totalDescuentos)} color="amber" />
      </div>

      {/* ── Tabla de liquidación ──────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr className="text-[10px] uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2 text-left font-semibold">Empleado</th>
                <th className="px-2 py-2 text-left font-semibold">Local</th>
                <th className="px-2 py-2 text-right font-semibold">Base</th>
                <th className="px-2 py-2 text-center font-semibold">Presentismo</th>
                <th className="px-2 py-2 text-right font-semibold">Adelantos</th>
                <th className="px-2 py-2 text-right font-semibold">Sanciones</th>
                <th
                  className="px-2 py-2 text-center font-semibold"
                  title="Errores de caja (faltantes/sobrantes) del mes"
                >
                  Caja
                </th>
                <th
                  className="px-2 py-2 text-right font-semibold"
                  title="Días sin goce, licencias no remuneradas, etc."
                >
                  Descuentos
                </th>
                <th
                  className="px-2 py-2 text-right font-semibold"
                  title="Horas extra, bonos extraordinarios, premios, reintegros"
                >
                  Bonos
                </th>
                <th className="px-2 py-2 text-right font-semibold">Total</th>
                <th className="px-2 py-2 text-center font-semibold">Pago</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filas.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-xs text-gray-400">
                    {empleados ? 'Sin empleados para mostrar' : 'Cargando...'}
                  </td>
                </tr>
              )}
              {filas.map((fila) => (
                <Fragment key={fila.empleado.id}>
                  <FilaEmpleado
                    fila={fila}
                    expandido={expandido === fila.empleado.id}
                    onToggleExpand={() =>
                      setExpandido(expandido === fila.empleado.id ? null : fila.empleado.id)
                    }
                    onTogglePresentismo={(nuevo) =>
                      upsertLiquidacion.mutate({
                        empleado_id: fila.empleado.id,
                        periodo: periodoActual,
                        patch: { cobra_presentismo: nuevo },
                      })
                    }
                    onCambiarPago={(medio) => {
                      if (medio === 'mixto') {
                        // Abrir modal con sugerencia 50/50 (redondeado a múltiplos de 100)
                        const mitad = Math.round(fila.total / 2 / 100) * 100;
                        const otra = fila.total - mitad;
                        setMixtoModal({
                          empleadoId: fila.empleado.id,
                          empleadoNombre: `${fila.empleado.apellido}, ${fila.empleado.nombre}`,
                          local: fila.empleado.local,
                          total: fila.total,
                          montoEf:
                            fila.montoEfectivoPagado > 0
                              ? String(fila.montoEfectivoPagado)
                              : String(mitad),
                          montoTr:
                            fila.montoTransferenciaPagado > 0
                              ? String(fila.montoTransferenciaPagado)
                              : String(otra),
                        });
                        return;
                      }
                      cambiarPago.mutate({
                        empleado_id: fila.empleado.id,
                        periodo: periodoActual,
                        medio,
                        monto: fila.total,
                        local: fila.empleado.local,
                        empleado_nombre: `${fila.empleado.apellido}, ${fila.empleado.nombre}`,
                      });
                    }}
                    onAbrirMixto={() => {
                      const mitad = Math.round(fila.total / 2 / 100) * 100;
                      const otra = fila.total - mitad;
                      setMixtoModal({
                        empleadoId: fila.empleado.id,
                        empleadoNombre: `${fila.empleado.apellido}, ${fila.empleado.nombre}`,
                        local: fila.empleado.local,
                        total: fila.total,
                        montoEf:
                          fila.montoEfectivoPagado > 0
                            ? String(fila.montoEfectivoPagado)
                            : String(mitad),
                        montoTr:
                          fila.montoTransferenciaPagado > 0
                            ? String(fila.montoTransferenciaPagado)
                            : String(otra),
                      });
                    }}
                    onCambiarModalidad={(nuevo) =>
                      updateModalidad.mutate({ id: fila.empleado.id, modalidad: nuevo })
                    }
                    onAbrirAdelantos={() =>
                      setPanel({ tipo: 'adelantos', empleadoId: fila.empleado.id })
                    }
                    onAbrirSanciones={() =>
                      setPanel({ tipo: 'sanciones', empleadoId: fila.empleado.id })
                    }
                    onAbrirDescuentos={() =>
                      setPanel({ tipo: 'descuentos', empleadoId: fila.empleado.id })
                    }
                    onAbrirBonos={() =>
                      setPanel({ tipo: 'bonos', empleadoId: fila.empleado.id })
                    }
                    onAbrirErroresCaja={() =>
                      setPanel({ tipo: 'errores_caja', empleadoId: fila.empleado.id })
                    }
                  />
                  {expandido === fila.empleado.id && (
                    <FilaAsistencia asistencia={fila.asistencia} />
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Sección impuestos ─────────────────────────────────────────────── */}
      <SeccionImpuestos periodoMes={pMes} />

      {/* ── Paneles laterales ─────────────────────────────────────────────── */}
      {panel && panelData && panel.tipo === 'adelantos' && (
        <PanelAdelantos
          empleado={panelData.fila.empleado}
          periodo={panelData.periodo}
          adelantos={panelData.fila.adelantosEmp}
          onClose={() => setPanel(null)}
        />
      )}
      {panel && panelData && panel.tipo === 'sanciones' && (
        <PanelSanciones
          empleado={panelData.fila.empleado}
          periodo={panelData.periodo}
          sanciones={panelData.fila.sancionesEmp}
          onClose={() => setPanel(null)}
        />
      )}
      {panel && panelData && panel.tipo === 'descuentos' && (
        <PanelDescuentos
          empleado={panelData.fila.empleado}
          periodo={panelData.periodo}
          descuentos={panelData.fila.descuentosEmp}
          onClose={() => setPanel(null)}
        />
      )}
      {panel && panelData && panel.tipo === 'bonos' && (
        <PanelBonos
          empleado={panelData.fila.empleado}
          periodo={panelData.periodo}
          bonos={panelData.fila.bonosEmp}
          onClose={() => setPanel(null)}
        />
      )}
      {panel && panelData && panel.tipo === 'errores_caja' && (
        <PanelErroresCaja
          empleado={panelData.fila.empleado}
          periodo={panelData.periodo}
          errores={panelData.fila.erroresCajaEmp}
          onClose={() => setPanel(null)}
        />
      )}

      {/* ── Modal de pago mixto (efectivo + transferencia) ───────────────── */}
      {mixtoModal && (
        <ModalPagoMixto
          state={mixtoModal}
          guardando={cambiarPago.isPending}
          onChange={(patch) => setMixtoModal((s) => (s ? { ...s, ...patch } : s))}
          onCancel={() => setMixtoModal(null)}
          onConfirmar={async () => {
            const ef = parseInt(mixtoModal.montoEf, 10) || 0;
            const tr = parseInt(mixtoModal.montoTr, 10) || 0;
            const suma = ef + tr;
            // Tolerancia ±1 peso por redondeos
            if (Math.abs(suma - mixtoModal.total) > 1) {
              window.alert(
                `Los montos no suman el total.\nEfectivo: ${formatARS(ef)}\nTransferencia: ${formatARS(tr)}\nSuma: ${formatARS(suma)}\nTotal esperado: ${formatARS(mixtoModal.total)}`,
              );
              return;
            }
            if (ef < 0 || tr < 0) {
              window.alert('Los montos no pueden ser negativos.');
              return;
            }
            if (ef === 0 && tr === 0) {
              window.alert('Al menos uno de los dos montos debe ser mayor a 0.');
              return;
            }
            await cambiarPago.mutateAsync({
              empleado_id: mixtoModal.empleadoId,
              periodo: periodoActual,
              medio: 'mixto',
              monto: mixtoModal.total,
              montoEfectivo: ef,
              montoTransferencia: tr,
              local: mixtoModal.local,
              empleado_nombre: mixtoModal.empleadoNombre,
            });
            setMixtoModal(null);
          }}
        />
      )}
    </div>
  );
}

// ─── Modal de pago mixto ────────────────────────────────────────────────────
function ModalPagoMixto({
  state,
  guardando,
  onChange,
  onCancel,
  onConfirmar,
}: {
  state: {
    empleadoNombre: string;
    total: number;
    montoEf: string;
    montoTr: string;
  };
  guardando: boolean;
  onChange: (patch: Partial<{ montoEf: string; montoTr: string }>) => void;
  onCancel: () => void;
  onConfirmar: () => void;
}) {
  const ef = parseInt(state.montoEf, 10) || 0;
  const tr = parseInt(state.montoTr, 10) || 0;
  const suma = ef + tr;
  const diferencia = suma - state.total;
  const okSuma = Math.abs(diferencia) <= 1;

  // Auto-completar el otro lado: si el user escribe efectivo, transferencia = total - efectivo
  function setEfectivo(v: string) {
    const limpio = v.replace(/\D/g, '');
    const n = parseInt(limpio, 10) || 0;
    onChange({ montoEf: limpio, montoTr: String(Math.max(0, state.total - n)) });
  }
  function setTransferencia(v: string) {
    const limpio = v.replace(/\D/g, '');
    const n = parseInt(limpio, 10) || 0;
    onChange({ montoTr: limpio, montoEf: String(Math.max(0, state.total - n)) });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4">
          <h3 className="text-base font-semibold text-gray-900">Pago mixto</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            {state.empleadoNombre} · Total a pagar:{' '}
            <span className="font-medium text-gray-900">{formatARS(state.total)}</span>
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              Monto en efectivo
            </label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">$</span>
              <input
                type="text"
                inputMode="numeric"
                value={state.montoEf}
                onChange={(e) => setEfectivo(e.target.value)}
                className="flex-1 rounded border border-green-300 bg-green-50 px-2 py-1.5 text-right text-sm tabular-nums text-green-800 focus:border-green-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              Monto por transferencia
            </label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">$</span>
              <input
                type="text"
                inputMode="numeric"
                value={state.montoTr}
                onChange={(e) => setTransferencia(e.target.value)}
                className="flex-1 rounded border border-blue-300 bg-blue-50 px-2 py-1.5 text-right text-sm tabular-nums text-blue-800 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          <div
            className={cn(
              'rounded border p-2 text-xs',
              okSuma
                ? 'border-green-200 bg-green-50 text-green-700'
                : 'border-red-200 bg-red-50 text-red-700',
            )}
          >
            <div className="flex justify-between">
              <span>Suma:</span>
              <span className="font-medium tabular-nums">{formatARS(suma)}</span>
            </div>
            <div className="flex justify-between">
              <span>Diferencia:</span>
              <span className="font-medium tabular-nums">
                {diferencia === 0
                  ? '— OK'
                  : `${diferencia > 0 ? '+' : ''}${formatARS(diferencia)}`}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={guardando}
            className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirmar}
            disabled={!okSuma || guardando || (ef === 0 && tr === 0)}
            className="rounded bg-rodziny-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rodziny-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {guardando ? 'Guardando...' : 'Confirmar pago'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Fila empleado ──────────────────────────────────────────────────────────
function FilaEmpleado({
  fila,
  expandido,
  onToggleExpand,
  onTogglePresentismo,
  onCambiarPago,
  onAbrirMixto,
  onCambiarModalidad,
  onAbrirAdelantos,
  onAbrirSanciones,
  onAbrirDescuentos,
  onAbrirBonos,
  onAbrirErroresCaja,
}: {
  fila: {
    empleado: Empleado;
    modalidad: 'quincenal' | 'mensual';
    esMensualEnQ1: boolean;
    base: number;
    presentismoAuto: boolean;
    cobraPresentismo: boolean;
    presentismoOverride: boolean;
    deduccionPresentismo: number;
    adelantosMonto: number;
    sancionesMonto: number;
    descuentosMonto: number;
    bonosMonto: number;
    erroresCajaEmp: CierreCajaError[];
    total: number;
    pagado: boolean;
    medioPago: MedioPagoSueldo | null;
    montoEfectivoPagado: number;
    montoTransferenciaPagado: number;
    asistencia: {
      diasLaborales: number;
      completos: number;
      ausencias: number;
      tardanzas: number;
      tardanzasGraves: number;
      francos: number;
    };
  };
  expandido: boolean;
  onToggleExpand: () => void;
  onTogglePresentismo: (v: boolean) => void;
  onCambiarPago: (v: MedioPagoSueldo | null) => void;
  onAbrirMixto: () => void;
  onCambiarModalidad: (v: 'quincenal' | 'mensual') => void;
  onAbrirAdelantos: () => void;
  onAbrirSanciones: () => void;
  onAbrirDescuentos: () => void;
  onAbrirBonos: () => void;
  onAbrirErroresCaja: () => void;
}) {
  const {
    empleado,
    modalidad,
    esMensualEnQ1,
    base,
    cobraPresentismo,
    presentismoOverride,
    deduccionPresentismo,
    adelantosMonto,
    sancionesMonto,
    descuentosMonto,
    bonosMonto,
    erroresCajaEmp,
    total,
    medioPago,
    montoEfectivoPagado,
    montoTransferenciaPagado,
    asistencia,
  } = fila;
  const tieneProblemas = asistencia.ausencias > 0 || asistencia.tardanzasGraves > 0;

  return (
    <tr
      className={cn(
        'hover:bg-gray-50',
        esMensualEnQ1 && 'bg-gray-50/60 text-gray-500',
        expandido && 'bg-blue-50/30',
      )}
    >
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <button
                onClick={onToggleExpand}
                className={cn(
                  'flex h-4 w-4 items-center justify-center rounded text-[10px] transition-colors',
                  expandido
                    ? 'bg-rodziny-100 text-rodziny-700'
                    : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600',
                )}
                title="Ver resumen de asistencia"
              >
                {expandido ? '▾' : '▸'}
              </button>
              <span className="truncate font-medium text-gray-900">
                {empleado.apellido}, {empleado.nombre}
              </span>
              {tieneProblemas && !esMensualEnQ1 && (
                <span className="flex items-center gap-0.5">
                  {asistencia.ausencias > 0 && (
                    <span
                      className="rounded-full bg-red-100 px-1 py-0.5 text-[9px] font-medium text-red-700"
                      title={`${asistencia.ausencias} falta(s)`}
                    >
                      {asistencia.ausencias}F
                    </span>
                  )}
                  {asistencia.tardanzasGraves > 0 && (
                    <span
                      className="rounded-full bg-amber-100 px-1 py-0.5 text-[9px] font-medium text-amber-700"
                      title={`${asistencia.tardanzasGraves} tardanza(s) grave(s)`}
                    >
                      {asistencia.tardanzasGraves}T
                    </span>
                  )}
                </span>
              )}
            </div>
            <div className="ml-5 mt-0.5 flex items-center gap-2 text-[10px] text-gray-500">
              <span>{empleado.puesto}</span>
              <select
                value={modalidad}
                onChange={(e) => onCambiarModalidad(e.target.value as 'quincenal' | 'mensual')}
                className="cursor-pointer rounded border border-gray-300 bg-white px-1 py-0.5 text-[10px] text-rodziny-700 hover:border-rodziny-500"
                title="Modalidad de cobro"
              >
                <option value="quincenal">Quincenal</option>
                <option value="mensual">Mensual</option>
              </select>
              {esMensualEnQ1 && (
                <span className="rounded-full bg-gray-200 px-1.5 py-0.5 text-[9px] text-gray-600">
                  Cobra en Q2
                </span>
              )}
            </div>
          </div>
        </div>
      </td>
      <td className="px-2 py-2 text-xs capitalize text-gray-600">{empleado.local}</td>
      <td className="px-2 py-2 text-right tabular-nums text-gray-900">
        {esMensualEnQ1 ? '—' : formatARS(base)}
      </td>
      <td className="px-2 py-2 text-center">
        {esMensualEnQ1 ? (
          <span className="text-xs text-gray-300">—</span>
        ) : (
          <label
            className="inline-flex cursor-pointer items-center gap-1"
            title={presentismoOverride ? 'Modificado manualmente' : 'Automático según asistencia'}
          >
            <input
              type="checkbox"
              checked={cobraPresentismo}
              onChange={(e) => onTogglePresentismo(e.target.checked)}
              className="h-4 w-4"
            />
            {presentismoOverride && <span className="text-[10px] text-rodziny-700">🖊</span>}
            {!cobraPresentismo && (
              <span className="text-[10px] text-red-600">-{formatARS(deduccionPresentismo)}</span>
            )}
          </label>
        )}
      </td>
      <td className="px-2 py-2 text-right">
        <button
          onClick={onAbrirAdelantos}
          className={cn(
            'text-xs tabular-nums hover:underline',
            adelantosMonto > 0 ? 'font-medium text-amber-700' : 'text-gray-400',
          )}
        >
          {adelantosMonto > 0 ? formatARS(adelantosMonto) : '+ agregar'}
        </button>
      </td>
      <td className="px-2 py-2 text-right">
        <button
          onClick={onAbrirSanciones}
          className={cn(
            'text-xs tabular-nums hover:underline',
            sancionesMonto > 0 ? 'font-medium text-red-700' : 'text-gray-400',
          )}
        >
          {sancionesMonto > 0 ? formatARS(sancionesMonto) : '+ agregar'}
        </button>
      </td>
      <td className="px-2 py-2 text-center">
        {erroresCajaEmp.length > 0 ? (
          <button
            onClick={onAbrirErroresCaja}
            className="text-xs hover:underline"
            title={`${erroresCajaEmp.length} cierre(s) con diferencia`}
          >
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium',
                erroresCajaEmp.some((e) => e.diferencia < 0)
                  ? 'bg-red-50 text-red-700'
                  : 'bg-blue-50 text-blue-700',
              )}
            >
              {erroresCajaEmp.length} error{erroresCajaEmp.length > 1 ? 'es' : ''}
            </span>
          </button>
        ) : (
          <span className="text-[10px] text-gray-300">—</span>
        )}
      </td>
      <td className="px-2 py-2 text-right">
        <button
          onClick={onAbrirDescuentos}
          className={cn(
            'text-xs tabular-nums hover:underline',
            descuentosMonto > 0 ? 'font-medium text-orange-700' : 'text-gray-400',
          )}
          title="Días sin goce, licencias no remuneradas, etc."
        >
          {descuentosMonto > 0 ? formatARS(descuentosMonto) : '+ agregar'}
        </button>
      </td>
      <td className="px-2 py-2 text-right">
        <button
          onClick={onAbrirBonos}
          className={cn(
            'text-xs tabular-nums hover:underline',
            bonosMonto > 0 ? 'font-medium text-emerald-700' : 'text-gray-400',
          )}
          title="Horas extra, bonos, premios, reintegros"
        >
          {bonosMonto > 0 ? `+${formatARS(bonosMonto)}` : '+ agregar'}
        </button>
      </td>
      <td className="px-2 py-2 text-right font-semibold tabular-nums text-gray-900">
        {esMensualEnQ1 ? <span className="font-normal text-gray-400">—</span> : formatARS(total)}
      </td>
      <td className="px-2 py-2 text-center">
        {esMensualEnQ1 ? (
          <span className="text-xs text-gray-300">—</span>
        ) : (
          <div className="flex flex-col items-center gap-0.5">
            <select
              value={medioPago ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                onCambiarPago(v === '' ? null : (v as MedioPagoSueldo));
              }}
              className={cn(
                'cursor-pointer rounded border px-1.5 py-0.5 text-[11px]',
                medioPago === 'efectivo' &&
                  'border-green-300 bg-green-50 font-medium text-green-800',
                medioPago === 'transferencia' &&
                  'border-blue-300 bg-blue-50 font-medium text-blue-800',
                medioPago === 'mixto' &&
                  'border-purple-300 bg-purple-50 font-medium text-purple-800',
                !medioPago && 'border-gray-300 bg-white text-gray-500',
              )}
              title={medioPago ? `Pagado por ${medioPago}` : 'Sin pagar'}
            >
              <option value="">— sin pagar</option>
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="mixto">Mixto (ef + tr)</option>
            </select>
            {medioPago === 'mixto' && (
              <button
                onClick={onAbrirMixto}
                className="text-[9px] text-purple-700 underline-offset-2 hover:underline"
                title="Editar split"
              >
                <span className="text-green-700">{formatARS(montoEfectivoPagado)}</span>
                <span className="text-gray-400"> + </span>
                <span className="text-blue-700">{formatARS(montoTransferenciaPagado)}</span>
              </button>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

// ─── Fila expandible de asistencia ──────────────────────────────────────────
function FilaAsistencia({
  asistencia,
}: {
  asistencia: {
    diasLaborales: number;
    completos: number;
    ausencias: number;
    tardanzas: number;
    tardanzasGraves: number;
    francos: number;
    detalleTardanzas: { fecha: string; minutos: number }[];
    detalleFaltas: string[];
  };
}) {
  const pctAsistencia =
    asistencia.diasLaborales > 0
      ? Math.round((asistencia.completos / asistencia.diasLaborales) * 100)
      : 100;

  return (
    <tr className="bg-blue-50/40">
      <td colSpan={11} className="px-4 py-2.5">
        <div className="flex flex-wrap items-start gap-4 text-xs">
          {/* Resumen general */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <div
                className={cn(
                  'h-2 w-2 rounded-full',
                  pctAsistencia >= 90
                    ? 'bg-green-500'
                    : pctAsistencia >= 70
                      ? 'bg-amber-500'
                      : 'bg-red-500',
                )}
              />
              <span className="font-medium text-gray-700">Asistencia: {pctAsistencia}%</span>
            </div>
            <span className="text-gray-400">|</span>
            <span className="text-gray-600">{asistencia.diasLaborales} días laborales</span>
            <span className="text-gray-400">|</span>
            <span className="font-medium text-green-700">{asistencia.completos} completos</span>
            {asistencia.francos > 0 && (
              <>
                <span className="text-gray-400">|</span>
                <span className="text-gray-500">{asistencia.francos} francos</span>
              </>
            )}
          </div>

          {/* Faltas */}
          {asistencia.ausencias > 0 && (
            <div className="flex items-center gap-1.5 rounded border border-red-200 bg-red-50 px-2 py-1">
              <span className="font-medium text-red-700">
                {asistencia.ausencias} falta{asistencia.ausencias > 1 ? 's' : ''}
              </span>
              <span className="text-red-500">—</span>
              <span className="text-red-600">
                {asistencia.detalleFaltas
                  .map((f) => {
                    const d = new Date(f + 'T12:00:00');
                    return `${d.getDate()}/${d.getMonth() + 1}`;
                  })
                  .join(', ')}
              </span>
            </div>
          )}

          {/* Tardanzas */}
          {asistencia.tardanzas > 0 && (
            <div className="flex items-center gap-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1">
              <span className="font-medium text-amber-700">
                {asistencia.tardanzas} tardanza{asistencia.tardanzas > 1 ? 's' : ''}
                {asistencia.tardanzasGraves > 0 &&
                  ` (${asistencia.tardanzasGraves} grave${asistencia.tardanzasGraves > 1 ? 's' : ''})`}
              </span>
              <span className="text-amber-500">—</span>
              <span className="text-amber-600">
                {asistencia.detalleTardanzas
                  .map((t) => {
                    const d = new Date(t.fecha + 'T12:00:00');
                    return `${d.getDate()}/${d.getMonth() + 1} (+${t.minutos}min)`;
                  })
                  .join(', ')}
              </span>
            </div>
          )}

          {/* Sin problemas */}
          {asistencia.ausencias === 0 && asistencia.tardanzas === 0 && (
            <div className="flex items-center gap-1.5 rounded border border-green-200 bg-green-50 px-2 py-1">
              <span className="font-medium text-green-700">Sin faltas ni tardanzas</span>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── KPI mini (mismo estilo que AsistenciaTab) ──────────────────────────────
function KpiMini({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: 'gray' | 'green' | 'red' | 'amber' | 'blue';
}) {
  const colorClass = {
    gray: 'text-gray-900',
    green: 'text-green-700',
    red: 'text-red-700',
    amber: 'text-amber-700',
    blue: 'text-blue-700',
  }[color];
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className={cn('mt-1 text-2xl font-bold', colorClass)}>{value}</p>
    </div>
  );
}
