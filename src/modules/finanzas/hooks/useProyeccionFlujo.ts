import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { remuneracionConPresentismo, parseYmd } from '@/modules/rrhh/utils';

// ── Proyección de flujo de caja ────────────────────────────────────────────────
// Proyecta 12 meses rodantes con DOS saldos en paralelo:
//   - Caja operativa (MP): la opera el negocio.
//   - Reserva (comitente): respaldo, solo se toca con items contra 'reserva'.
//
// Todos los KPIs son DINÁMICOS: se recalculan desde el ERP cada vez que se abre.
//   - Ingreso → promedio móvil de ventas reales por local (RPC edr_resumen_ventas).
//   - CMV %   → Σ compras mercadería ÷ Σ ventas reales (RPC edr_resumen_gastos),
//               igual que el EdR. Override manual opcional en proyeccion_config.
//   - Sueldos → suma viva de empleados.sueldo_neto (recurrente todos los meses).
//   - Pagos fijos → pagos_fijos por período; meses sin cargar se estiman.
//   - Aguinaldo → calculado como en RRHH (mitad del sueldo, prorrateado), en jun/dic.
// Lo único manual: los 2 saldos ancla (no hay feed de MP/IOL) y los items puntuales.

const LOCALES = ['vedia', 'saavedra'] as const;
const HORIZONTE_MESES = 12;

export interface ProyeccionConfig {
  id: number;
  saldo_operativa_inicial: number;
  saldo_reserva_inicial: number;
  fecha_saldo: string;
  cmv_pct_override: number | null;
  meses_promedio: number;
}

export interface ProyeccionItem {
  id: string;
  periodo: string;
  concepto: string;
  tipo: 'ingreso' | 'egreso' | 'transferencia';
  cuenta: 'operativa' | 'reserva';
  monto: number;
  nota: string | null;
}

export interface ProyeccionMes {
  periodo: string; // 'YYYY-MM'
  ingreso: number; // ingreso operativo proyectado (base + items ingreso operativa)
  cmv: number;
  pagosFijos: number;
  pagosFijosEstimado: boolean; // true = no había mes cargado, se usó promedio
  echeqs: number; // echeqs/cheques programados que debitan ese mes (pagos_gastos.programado)
  sueldos: number;
  aguinaldo: number;
  itemsOperativa: number; // neto manual sobre operativa (egresos restan)
  itemsReserva: number; // neto manual sobre reserva
  netoOperativo: number;
  netoReserva: number;
  saldoOperativa: number;
  saldoReserva: number;
}

export interface ProyeccionResult {
  meses: ProyeccionMes[];
  cmvPct: number;
  cmvPctAuto: boolean;
  ingresoPromMensual: number;
  sueldosMensuales: number;
  config: ProyeccionConfig | null;
  items: ProyeccionItem[];
  isLoading: boolean;
}

// Lista de los próximos N meses desde el mes actual, en formato 'YYYY-MM'.
function mesesHorizonte(): string[] {
  const hoy = new Date();
  const out: string[] = [];
  for (let i = 0; i < HORIZONTE_MESES; i++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() + i, 1);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    out.push(`${d.getFullYear()}-${mm}`);
  }
  return out;
}

interface VentaRow {
  periodo: string;
  ing_bruto: number;
}
interface GastoRow {
  periodo: string;
  cmv_alimentos: number;
  cmv_bebidas: number;
  cmv_indirectos: number;
}

export function useProyeccionFlujo(): ProyeccionResult {
  const añoActual = String(new Date().getFullYear());

  // Ventas reales por local (para promedio de ingreso + denominador del CMV%).
  const { data: ventas, isLoading: loadVentas } = useQuery({
    queryKey: ['proy_ventas', añoActual],
    queryFn: async () => {
      const porLocal: Record<string, VentaRow[]> = {};
      await Promise.all(
        LOCALES.map(async (loc) => {
          const { data, error } = await supabase.rpc('edr_resumen_ventas', {
            p_local: loc,
            p_anio: añoActual,
          });
          if (error) {
            console.error('[proy edr_resumen_ventas]', loc, error);
            porLocal[loc] = [];
            return;
          }
          porLocal[loc] = (data ?? []) as VentaRow[];
        }),
      );
      return porLocal;
    },
  });

  // Compras de mercadería reales por local (numerador del CMV%).
  const { data: gastos, isLoading: loadGastos } = useQuery({
    queryKey: ['proy_gastos', añoActual],
    queryFn: async () => {
      const porLocal: Record<string, GastoRow[]> = {};
      await Promise.all(
        LOCALES.map(async (loc) => {
          const { data, error } = await supabase.rpc('edr_resumen_gastos', {
            p_local: loc,
            p_anio: añoActual,
          });
          if (error) {
            console.error('[proy edr_resumen_gastos]', loc, error);
            porLocal[loc] = [];
            return;
          }
          porLocal[loc] = (data ?? []) as GastoRow[];
        }),
      );
      return porLocal;
    },
  });

  // Pagos fijos por período (ya cargados mes a mes en el ERP).
  const { data: pagosFijos, isLoading: loadPF } = useQuery({
    queryKey: ['proy_pagos_fijos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pagos_fijos')
        .select('periodo, monto')
        .not('monto', 'is', null);
      if (error) throw error;
      const map = new Map<string, number>();
      for (const r of data ?? []) {
        const p = (r as { periodo: string }).periodo;
        const m = Number((r as { monto: number }).monto) || 0;
        map.set(p, (map.get(p) ?? 0) + m);
      }
      return map;
    },
  });

  // Echeqs / cheques programados (pagos_gastos.programado=true): plata comprometida
  // a futuro que todavía no debitó. Se agrupan por el mes de su fecha de débito para
  // restarlos del saldo proyectado del mes que corresponde.
  const { data: echeqsProg, isLoading: loadEch } = useQuery({
    queryKey: ['proy_echeqs_programados'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pagos_gastos')
        .select('fecha_pago, monto')
        .eq('programado', true);
      if (error) throw error;
      const map = new Map<string, number>();
      for (const r of data ?? []) {
        const fp = (r as { fecha_pago: string | null }).fecha_pago;
        if (!fp) continue;
        const p = fp.slice(0, 7);
        map.set(p, (map.get(p) ?? 0) + (Number((r as { monto: number }).monto) || 0));
      }
      return map;
    },
  });

  // Empleados activos: sueldos recurrentes + base para el aguinaldo.
  const { data: empleados, isLoading: loadEmp } = useQuery({
    queryKey: ['proy_empleados'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('empleados')
        .select('sueldo_neto, fecha_ingreso')
        .eq('activo', true);
      if (error) throw error;
      return (data ?? []) as { sueldo_neto: number; fecha_ingreso: string | null }[];
    },
  });

  const { data: config, isLoading: loadCfg } = useQuery({
    queryKey: ['proy_config'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('proyeccion_config')
        .select('*')
        .eq('id', 1)
        .single();
      if (error) throw error;
      return data as ProyeccionConfig;
    },
  });

  const { data: items, isLoading: loadItems } = useQuery({
    queryKey: ['proy_items'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('proyeccion_flujo_items')
        .select('*')
        .order('periodo', { ascending: true });
      if (error) throw error;
      return (data ?? []) as ProyeccionItem[];
    },
  });

  // Historia mensual de ventas (backfill de Fudo + lo que se vaya cargando).
  // Es la base para calcular la estacionalidad. Las ventas vivas del ERP
  // (ventas_tickets vía edr_resumen_ventas) pisan al histórico en los meses que
  // ya están en el ERP, así la curva se reajusta sola al cerrar meses nuevos.
  const { data: historico, isLoading: loadHist } = useQuery({
    queryKey: ['proy_historico'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ventas_mensuales_historico')
        .select('local, periodo, total_bruto');
      if (error) {
        console.error('[proy historico]', error);
        return [];
      }
      return (data ?? []) as { local: string; periodo: string; total_bruto: number }[];
    },
  });

  const isLoading =
    loadVentas || loadGastos || loadPF || loadEmp || loadCfg || loadItems || loadHist || loadEch;

  // ── Cálculo ──────────────────────────────────────────────────────────────────
  const mesesProm = config?.meses_promedio ?? 3;

  // Serie mensual por local = histórico (Fudo) + ventas vivas del ERP.
  // Las ventas del ERP pisan al histórico en los meses que ya tiene cargados.
  const serie: Record<string, Map<string, number>> = {};
  for (const loc of LOCALES) serie[loc] = new Map();
  for (const r of historico ?? []) {
    if (serie[r.local]) serie[r.local].set(r.periodo, Number(r.total_bruto));
  }
  for (const loc of LOCALES) {
    for (const v of ventas?.[loc] ?? []) {
      if (Number(v.ing_bruto) > 0) serie[loc].set(v.periodo, Number(v.ing_bruto));
    }
  }

  // Índice estacional por local (promedio del año = 1). Se calcula relativo a la
  // media de CADA año y se promedia entre años, así el nivel/inflación se cancela
  // y solo queda la FORMA. Meses faltantes se interpolan con los vecinos.
  function indicesEstacionales(s: Map<string, number>): number[] {
    const porAnio: Record<number, { mes: number; val: number }[]> = {};
    for (const [periodo, val] of s) {
      if (val <= 0) continue;
      const y = Number(periodo.slice(0, 4));
      const mes = Number(periodo.slice(5, 7));
      (porAnio[y] ??= []).push({ mes, val });
    }
    const ratios: number[][] = Array.from({ length: 13 }, () => []);
    for (const y of Object.keys(porAnio)) {
      const arr = porAnio[Number(y)];
      const media = arr.reduce((a, r) => a + r.val, 0) / arr.length;
      if (media <= 0) continue;
      for (const r of arr) ratios[r.mes].push(r.val / media);
    }
    const idx: (number | null)[] = Array(13).fill(null);
    for (let m = 1; m <= 12; m++) {
      if (ratios[m].length)
        idx[m] = ratios[m].reduce((a, b) => a + b, 0) / ratios[m].length;
    }
    // Interpolar meses sin dato con el vecino más cercano a cada lado (circular).
    for (let m = 1; m <= 12; m++) {
      if (idx[m] != null) continue;
      let prev: number | null = null;
      let next: number | null = null;
      for (let d = 1; d <= 11; d++) {
        const pm = ((m - 1 - d + 12) % 12) + 1;
        if (idx[pm] != null) { prev = idx[pm]; break; }
      }
      for (let d = 1; d <= 11; d++) {
        const nm = ((m - 1 + d) % 12) + 1;
        if (idx[nm] != null) { next = idx[nm]; break; }
      }
      idx[m] = prev != null && next != null ? (prev + next) / 2 : prev ?? next ?? 1;
    }
    // Normalizar a media 1 sobre los 12 meses.
    const vals = idx.slice(1) as number[];
    const media = vals.reduce((a, b) => a + b, 0) / 12;
    return [0, ...vals.map((v) => (media > 0 ? v / media : 1))];
  }

  // Nivel base = promedio de los últimos N meses reales, DESESTACIONALIZADO
  // (cada mes dividido por su factor). Capta el nivel actual del negocio (sube
  // o baja solo si cambia el consumo) sin contaminarse con la estacionalidad.
  function nivelBase(s: Map<string, number>, idx: number[]): number {
    const periodos = [...s.keys()].filter((p) => (s.get(p) ?? 0) > 0).sort();
    const ult = periodos.slice(-mesesProm);
    if (!ult.length) return 0;
    let acc = 0;
    for (const p of ult) {
      const m = Number(p.slice(5, 7));
      acc += (s.get(p) ?? 0) / (idx[m] || 1);
    }
    return acc / ult.length;
  }

  const estacional: Record<string, { idx: number[]; nivel: number }> = {};
  for (const loc of LOCALES) {
    const idx = indicesEstacionales(serie[loc]);
    estacional[loc] = { idx, nivel: nivelBase(serie[loc], idx) };
  }

  // Ingreso proyectado de un mes = Σ por local de nivel base × factor estacional.
  function ingresoBaseDelMes(periodo: string): number {
    const m = Number(periodo.slice(5, 7));
    let total = 0;
    for (const loc of LOCALES) total += estacional[loc].nivel * (estacional[loc].idx[m] || 1);
    return total;
  }

  // Promedio mensual proyectado (KPI): como cada índice promedia 1 y el horizonte
  // cubre los 12 meses calendario una vez, equivale a Σ de los niveles base.
  const ingresoPromMensual = LOCALES.reduce((s, loc) => s + estacional[loc].nivel, 0);

  // CMV% = Σ compras mercadería ÷ Σ ventas, igual que el EdR. Se calcula POR LOCAL
  // sobre los meses donde ESE local tiene ventas cargadas, y recién después se
  // mezcla. Así evitamos contar las compras de un local en meses sin sus ventas
  // (ej: Vedia tiene compras ene-mar pero sus ventas arrancan en abril → contar
  // ese CMV contra ventas que no existen infla el ratio).
  const cmvPctAuto = config?.cmv_pct_override == null;
  let cmvPct = config?.cmv_pct_override ?? 0;
  if (cmvPctAuto) {
    let sumIngUsado = 0;
    let sumCmvUsado = 0;
    for (const loc of LOCALES) {
      const ventasLoc = new Map(
        (ventas?.[loc] ?? [])
          .filter((v) => Number(v.ing_bruto) > 0)
          .map((v) => [v.periodo, Number(v.ing_bruto)] as const),
      );
      const cmvLoc = new Map(
        (gastos?.[loc] ?? []).map(
          (g) =>
            [
              g.periodo,
              Number(g.cmv_alimentos) + Number(g.cmv_bebidas) + Number(g.cmv_indirectos),
            ] as const,
        ),
      );
      const periodosLoc = [...ventasLoc.keys()].sort().slice(-mesesProm);
      for (const p of periodosLoc) {
        sumIngUsado += ventasLoc.get(p) ?? 0;
        sumCmvUsado += cmvLoc.get(p) ?? 0;
      }
    }
    cmvPct = sumIngUsado > 0 ? sumCmvUsado / sumIngUsado : 0;
  }

  // Sueldos recurrentes = suma del neto en mano (base + presentismo) de los activos.
  // sueldo_neto guarda el base SIN presentismo; el egreso real asume presentismo ganado.
  const sueldosMensuales = (empleados ?? []).reduce(
    (s, e) => s + remuneracionConPresentismo(Number(e.sueldo_neto || 0)),
    0,
  );

  // Promedio de pagos fijos de los últimos `mesesProm` meses cargados → estimación
  // de meses futuros que todavía no tienen pagos fijos cargados (ej. 2027).
  // Usa el mismo `mesesProm` configurable que ingresos y CMV, para que toda la
  // proyección promedie sobre la misma ventana. Divide por la cantidad real de
  // meses tomados (nunca por cero).
  const pfPeriodosCargados = [...(pagosFijos?.keys() ?? [])].sort();
  const pfUsados = pfPeriodosCargados.slice(-mesesProm);
  const pfPromedio =
    pfUsados.length > 0
      ? pfUsados.reduce((s, p) => s + (pagosFijos?.get(p) ?? 0), 0) / pfUsados.length
      : 0;

  // Aguinaldo de un mes: solo junio (1er semestre) y diciembre (2do).
  // Mismo criterio que RRHH: SAC = sueldo × 0.5 × días/180 (prorrateo por antigüedad).
  function aguinaldoDelMes(periodo: string): number {
    const [yStr, mStr] = periodo.split('-');
    const mes = Number(mStr);
    if (mes !== 6 && mes !== 12) return 0;
    const año = Number(yStr);
    const inicioSem = mes === 6 ? new Date(año, 0, 1) : new Date(año, 6, 1);
    const finSem = mes === 6 ? new Date(año, 5, 30) : new Date(año, 11, 31);
    return (empleados ?? []).reduce((s, e) => {
      const sueldo = remuneracionConPresentismo(Number(e.sueldo_neto || 0));
      if (sueldo <= 0) return s;
      // parseYmd (hora local) para no correr 1 día por UTC, igual que AguinaldoTab.
      const ingreso = e.fecha_ingreso ? parseYmd(e.fecha_ingreso) : inicioSem;
      const desde = ingreso > inicioSem ? ingreso : inicioSem;
      if (desde > finSem) return s; // ingresó después del semestre → no devenga
      const dias = Math.round((finSem.getTime() - desde.getTime()) / 86_400_000) + 1;
      const factor = Math.min(dias, 180) / 180;
      return s + sueldo * 0.5 * factor;
    }, 0);
  }

  // Items manuales agrupados por período.
  function itemsDelMes(periodo: string) {
    const delMes = (items ?? []).filter((i) => i.periodo === periodo);
    let operativa = 0;
    let reserva = 0;
    let ingresoOperativa = 0;
    for (const it of delMes) {
      const m = Number(it.monto) || 0;
      if (it.tipo === 'ingreso') {
        if (it.cuenta === 'operativa') {
          operativa += m;
          ingresoOperativa += m;
        } else reserva += m;
      } else if (it.tipo === 'egreso') {
        if (it.cuenta === 'operativa') operativa -= m;
        else reserva -= m;
      } else {
        // transferencia: 'cuenta' = destino al que ENTRA; sale de la otra.
        if (it.cuenta === 'operativa') {
          operativa += m;
          reserva -= m;
        } else {
          reserva += m;
          operativa -= m;
        }
      }
    }
    return { operativa, reserva, ingresoOperativa };
  }

  const meses: ProyeccionMes[] = [];
  let saldoOperativa = Number(config?.saldo_operativa_inicial ?? 0);
  let saldoReserva = Number(config?.saldo_reserva_inicial ?? 0);

  for (const periodo of mesesHorizonte()) {
    const it = itemsDelMes(periodo);
    const ingresoBase = ingresoBaseDelMes(periodo); // ya estacionalizado
    const ingreso = ingresoBase + it.ingresoOperativa;
    const cmv = ingresoBase * cmvPct; // CMV escala con el ingreso del mes
    const pfCargado = pagosFijos?.get(periodo);
    const pagosFijosMes = pfCargado ?? pfPromedio;
    const pagosFijosEstimado = pfCargado == null;
    const echeqs = echeqsProg?.get(periodo) ?? 0;
    const sueldos = sueldosMensuales;
    const aguinaldo = aguinaldoDelMes(periodo);

    // Neto operativo = ventas del mes − costos + neto de items manuales de operativa.
    // Usamos ingresoBase (no `ingreso`) porque it.operativa ya incluye los
    // ingresos manuales; así no se cuentan dos veces.
    const netoOperativo =
      ingresoBase - cmv - pagosFijosMes - echeqs - sueldos - aguinaldo + it.operativa;
    const netoReserva = it.reserva;

    saldoOperativa += netoOperativo;
    saldoReserva += netoReserva;

    meses.push({
      periodo,
      ingreso,
      cmv,
      pagosFijos: pagosFijosMes,
      pagosFijosEstimado,
      echeqs,
      sueldos,
      aguinaldo,
      itemsOperativa: it.operativa,
      itemsReserva: it.reserva,
      netoOperativo,
      netoReserva,
      saldoOperativa,
      saldoReserva,
    });
  }

  return {
    meses,
    cmvPct,
    cmvPctAuto,
    ingresoPromMensual,
    sueldosMensuales,
    config: config ?? null,
    items: items ?? [],
    isLoading,
  };
}
