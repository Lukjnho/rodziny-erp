import { useState, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { PageContainer } from '@/components/layout/PageContainer';
import { formatARS } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { LocalSelector } from '@/components/ui/LocalSelector';

// ── constantes ────────────────────────────────────────────────────────────────
const MESES_LABEL = [
  'Ene',
  'Feb',
  'Mar',
  'Abr',
  'May',
  'Jun',
  'Jul',
  'Ago',
  'Sep',
  'Oct',
  'Nov',
  'Dic',
];

type TipoFila = 'seccion' | 'auto' | 'manual' | 'calculada' | 'kpi' | 'espacio';
type Formato = 'moneda' | 'porcentaje' | 'cantidad' | 'rotacion';

interface FilaEdR {
  key: string;
  label: string;
  tipo: TipoFila;
  depth: number;
  formato?: Formato;
  benchmark?: string;
}

const FILAS: FilaEdR[] = [
  { key: '_ing', label: 'INGRESOS', tipo: 'seccion', depth: 0 },
  {
    key: 'ing_bruto',
    label: 'Ingresos Brutos (con IVA)',
    tipo: 'auto',
    depth: 1,
    formato: 'moneda',
  },
  {
    key: 'iva_debito',
    label: '(-) IVA Débito (21/121)',
    tipo: 'auto',
    depth: 1,
    formato: 'moneda',
  },
  {
    key: 'dif_arqueo',
    label: '(+/-) Diferencias de arqueo',
    tipo: 'auto',
    depth: 1,
    formato: 'moneda',
  },
  { key: '__ing_netos', label: 'INGRESOS NETOS', tipo: 'calculada', depth: 0, formato: 'moneda' },
  {
    key: '__ticket_prom',
    label: 'Ticket Promedio',
    tipo: 'calculada',
    depth: 1,
    formato: 'moneda',
  },
  // Fila resumen plegable: suma cortesías + otros descuentos. Actúa como toggle
  // (▸/▾) para no ocupar dos filas fijas con datos meramente informativos.
  {
    key: '__descuentos_toggle',
    label: 'Cortesías y descuentos',
    tipo: 'calculada',
    depth: 1,
    formato: 'moneda',
  },
  { key: '__cortesias_info', label: 'Cortesías', tipo: 'calculada', depth: 2, formato: 'moneda' },
  {
    key: '__otros_desc',
    label: 'Otros descuentos',
    tipo: 'calculada',
    depth: 2,
    formato: 'moneda',
  },
  { key: '_esp1', label: '', tipo: 'espacio', depth: 0 },

  { key: '_cmv', label: 'CMV', tipo: 'seccion', depth: 0 },
  { key: 'cmv_alimentos', label: 'Costo de alimentos', tipo: 'auto', depth: 1, formato: 'moneda' },
  { key: 'cmv_bebidas', label: 'Costo de bebidas', tipo: 'auto', depth: 1, formato: 'moneda' },
  {
    key: 'cmv_indirectos',
    label: 'Costos indirectos de operación',
    tipo: 'auto',
    depth: 1,
    formato: 'moneda',
  },
  { key: '__cmv_total', label: 'TOTAL COMPRAS', tipo: 'calculada', depth: 0, formato: 'moneda' },
  // ── Inventario valorizado (cierres aprobados) ──
  // Si no hay cierre del mes y del anterior, Δ queda en 0 y CMV REAL = TOTAL COMPRAS
  // (comportamiento previo, sin romper).
  {
    key: 'stock_final_alimentos',
    label: 'Stock final alimentos',
    tipo: 'auto',
    depth: 1,
    formato: 'moneda',
  },
  {
    key: 'stock_final_bebidas',
    label: 'Stock final bebidas',
    tipo: 'auto',
    depth: 1,
    formato: 'moneda',
  },
  {
    key: 'stock_final_indirectos',
    label: 'Stock final indirectos',
    tipo: 'auto',
    depth: 1,
    formato: 'moneda',
  },
  {
    key: '__cmv_real',
    label: 'TOTAL CMV REAL',
    tipo: 'calculada',
    depth: 0,
    formato: 'moneda',
  },
  // Rotación de inventario (CMV real / stock promedio). Va justo debajo del CMV
  // real. Solo se calcula en meses con cierre de inventario aprobado del mes y
  // del anterior; sin los dos extremos muestra '—'. El total se desglosa por
  // categoría para ver qué rubro es el que no rota.
  {
    key: '_kpi_rotacion',
    label: '↸ Rotación de inventario',
    tipo: 'kpi',
    depth: 1,
    formato: 'rotacion',
  },
  { key: '_kpi_rotacion_alim', label: '↸ Alimentos', tipo: 'kpi', depth: 2, formato: 'rotacion' },
  { key: '_kpi_rotacion_beb', label: '↸ Bebidas', tipo: 'kpi', depth: 2, formato: 'rotacion' },
  { key: '_kpi_rotacion_ind', label: '↸ Indirectos', tipo: 'kpi', depth: 2, formato: 'rotacion' },
  { key: '__margen_bruto', label: 'MARGEN BRUTO', tipo: 'calculada', depth: 0, formato: 'moneda' },
  {
    key: '_kpi_food',
    label: '↸ Food Cost %',
    tipo: 'kpi',
    depth: 1,
    formato: 'porcentaje',
    benchmark: '25-32%',
  },
  { key: '_esp2', label: '', tipo: 'espacio', depth: 0 },

  { key: '_personal', label: 'PERSONAL', tipo: 'seccion', depth: 0 },
  { key: 'pers_sueldos', label: 'Sueldos', tipo: 'auto', depth: 1, formato: 'moneda' },
  { key: 'pers_cargas', label: 'Cargas Sociales', tipo: 'auto', depth: 1, formato: 'moneda' },
  { key: '__pers_total', label: 'TOTAL PERSONAL', tipo: 'calculada', depth: 0, formato: 'moneda' },
  {
    key: '_kpi_labor',
    label: '↸ Labor Cost %',
    tipo: 'kpi',
    depth: 1,
    formato: 'porcentaje',
    benchmark: '30-38%',
  },
  { key: '__prime_cost', label: 'PRIME COST', tipo: 'calculada', depth: 0, formato: 'moneda' },
  {
    key: '_kpi_prime',
    label: '↸ Prime Cost %',
    tipo: 'kpi',
    depth: 1,
    formato: 'porcentaje',
    benchmark: '55-65%',
  },
  { key: '_esp3', label: '', tipo: 'espacio', depth: 0 },

  { key: '_gastos', label: 'GASTOS OPERATIVOS', tipo: 'seccion', depth: 0 },
  { key: 'gastos_op', label: 'Gastos operativos', tipo: 'auto', depth: 1, formato: 'moneda' },
  { key: 'impuestos_op', label: 'Impuestos y Tasas', tipo: 'auto', depth: 1, formato: 'moneda' },
  {
    key: '_kpi_gastosop',
    label: '↸ Gastos Op. %',
    tipo: 'kpi',
    depth: 1,
    formato: 'porcentaje',
    benchmark: '10-18%',
  },
  { key: '_esp4', label: '', tipo: 'espacio', depth: 0 },

  { key: '__ebitda', label: 'EBITDA', tipo: 'calculada', depth: 0, formato: 'moneda' },
  {
    key: '_kpi_ebitda',
    label: '↸ EBITDA %',
    tipo: 'kpi',
    depth: 1,
    formato: 'porcentaje',
    benchmark: '> 12%',
  },
  { key: 'amortizaciones', label: '(-) Amortizaciones', tipo: 'auto', depth: 1, formato: 'moneda' },
  { key: '__ebit', label: 'EBIT', tipo: 'calculada', depth: 0, formato: 'moneda' },
  { key: '_esp6', label: '', tipo: 'espacio', depth: 0 },

  { key: '_fin', label: 'RESULTADO FINANCIERO', tipo: 'seccion', depth: 0 },
  { key: 'fin_intereses', label: 'Intereses', tipo: 'auto', depth: 1, formato: 'moneda' },
  { key: 'fin_arca', label: 'Regularización ARCA', tipo: 'auto', depth: 1, formato: 'moneda' },
  { key: 'fin_prestamo', label: 'Préstamo', tipo: 'manual', depth: 1, formato: 'moneda' },
  { key: '__fin_total', label: 'TOTAL FINANCIERO', tipo: 'calculada', depth: 0, formato: 'moneda' },
  { key: '_esp7', label: '', tipo: 'espacio', depth: 0 },

  {
    key: '__rdo_antes',
    label: 'RDO. ANTES GANANCIAS',
    tipo: 'calculada',
    depth: 0,
    formato: 'moneda',
  },
  {
    key: 'anticipo_gcias',
    label: '(-) Anticipo Ganancias',
    tipo: 'manual',
    depth: 1,
    formato: 'moneda',
  },
  { key: '__rdo_neto', label: 'RESULTADO NETO', tipo: 'calculada', depth: 0, formato: 'moneda' },
  {
    key: '_kpi_margen',
    label: '↸ Margen Neto %',
    tipo: 'kpi',
    depth: 1,
    formato: 'porcentaje',
    benchmark: '> 5%',
  },
];

// ── cálculos ──────────────────────────────────────────────────────────────────
interface AutoMes {
  ingBruto: number;
  ivaDebito: number;
  ticketCount: number;
  cmvAlimentos: number;
  cmvBebidas: number;
  cmvIndirectos: number;
  gastosOp: number;
  gastosRrhh: number;
  impuestosOp: number;
  inversiones: number;
  intereses: number;
  sueldos: number;
  cargasSociales: number;
  amortizaciones: number;
  difArqueo: number;
  arca: number;
  // Cierres de inventario aprobados — fin de mes actual y mes anterior.
  // Si no hay cierres, todos en 0 → Δ = 0 → CMV REAL = TOTAL COMPRAS.
  stockFinalAlimentos: number;
  stockFinalBebidas: number;
  stockFinalIndirectos: number;
  stockInicialAlimentos: number;
  stockInicialBebidas: number;
  stockInicialIndirectos: number;
  hayCierreMes: boolean;
  hayCierreAnterior: boolean;
}

function computarMes(manual: Map<string, number>, auto: AutoMes): Map<string, number> {
  const m = (k: string) => manual.get(k) ?? 0;
  const { ingBruto, ivaDebito, ticketCount } = auto;
  // IVA débito: ya viene resuelto POR LOCAL en la query de tickets (real por
  // ticket del XLS fiscal si existe; si no, el total mensual estimado 21/121
  // guardado en edr_partidas). Ver el queryFn de ticketsRaw. Al resolverlo antes
  // de consolidar, el "Empresa" suma bien el efectivo de ambos locales.

  // CMV: auto desde gastos Fudo, override manual si el usuario cargó algo
  const cmvAlimentos = manual.has('cmv_alimentos') ? m('cmv_alimentos') : auto.cmvAlimentos;
  const cmvBebidas = manual.has('cmv_bebidas') ? m('cmv_bebidas') : auto.cmvBebidas;
  const cmvIndirectos = manual.has('cmv_indirectos') ? m('cmv_indirectos') : auto.cmvIndirectos;
  const gastosOp = manual.has('gastos_op') ? m('gastos_op') : auto.gastosOp;
  const impuestosOp = manual.has('impuestos_op') ? m('impuestos_op') : auto.impuestosOp;
  const finIntereses = manual.has('fin_intereses') ? m('fin_intereses') : auto.intereses;
  // ARCA: solo desde gastos cargados con subcat "Regularización de impuestos".
  const finArca = auto.arca;

  // Personal: auto desde gastos Fudo, override manual
  const persSueldos = manual.has('pers_sueldos') ? m('pers_sueldos') : auto.sueldos;
  const persCargas = manual.has('pers_cargas') ? m('pers_cargas') : auto.cargasSociales;

  // Diferencias de arqueo: auto desde cierres de caja, override manual
  const difArqueo = manual.has('dif_arqueo') ? m('dif_arqueo') : auto.difArqueo;

  // EdR económico: ingresos netos = bruto facturado - IVA débito + diferencias
  // de arqueo. El IVA es deuda fiscal, no ingreso del giro — se compensa con
  // crédito fiscal en la DDJJ y se paga aparte (impacta solo en flujo).
  const ingNeto = ingBruto - ivaDebito + difArqueo;
  const cmvTotal = cmvAlimentos + cmvBebidas + cmvIndirectos; // total compras
  // CMV REAL = compras − Δ inventario, donde Δ = stock_final - stock_inicial.
  // Si stock subió: consumiste menos de lo que compraste → CMV real < compras.
  // Si stock bajó: consumiste más → CMV real > compras.
  // Cuando no hay cierres aprobados, todos los stocks valen 0 y CMV real = compras.
  const stockFinalTotal =
    auto.stockFinalAlimentos + auto.stockFinalBebidas + auto.stockFinalIndirectos;
  const stockInicialTotal =
    auto.stockInicialAlimentos + auto.stockInicialBebidas + auto.stockInicialIndirectos;
  const deltaInventario = stockFinalTotal - stockInicialTotal;
  // Solo aplicamos el ajuste si hay cierre del mes actual Y del anterior.
  // Sin uno de los dos extremos, no podemos calcular Δ confiable → fallback a compras.
  const aplicarDelta = auto.hayCierreMes && auto.hayCierreAnterior;
  const cmvReal = aplicarDelta ? cmvTotal - deltaInventario : cmvTotal;
  const margenBruto = ingNeto - cmvReal;
  const persTotal = persSueldos + persCargas;
  const primeCost = cmvTotal + persTotal;
  const amortizaciones = manual.has('amortizaciones') ? m('amortizaciones') : auto.amortizaciones;
  const ebitda = margenBruto - persTotal - gastosOp - impuestosOp;
  const ebit = ebitda - amortizaciones;
  const finTotal = -(finIntereses + finArca + m('fin_prestamo'));
  const rdoAntes = ebit + finTotal;
  const rdoNeto = rdoAntes - m('anticipo_gcias');

  const result = new Map<string, number>(manual);
  result.set('ing_bruto', ingBruto);
  // Guardamos IVA en negativo para que la fila se pinte en rojo y sume bien al ACUM.
  result.set('iva_debito', -ivaDebito);
  result.set('dif_arqueo', difArqueo);
  result.set('__ing_netos', ingNeto);
  result.set('__ticket_prom', ticketCount > 0 ? ingBruto / ticketCount : 0);
  // Cortesías y otros descuentos (informativos — se guardan en edr_partidas al importar)
  result.set('__cortesias_info', m('cortesias_monto'));
  result.set('__otros_desc', m('otros_descuentos'));
  // Resumen plegable = suma de ambos informativos (no alimenta ningún total del P&L).
  result.set('__descuentos_toggle', m('cortesias_monto') + m('otros_descuentos'));
  result.set('cmv_alimentos', cmvAlimentos);
  result.set('cmv_bebidas', cmvBebidas);
  result.set('cmv_indirectos', cmvIndirectos);
  result.set('__cmv_total', cmvTotal);
  result.set('stock_final_alimentos', auto.stockFinalAlimentos);
  result.set('stock_final_bebidas', auto.stockFinalBebidas);
  result.set('stock_final_indirectos', auto.stockFinalIndirectos);
  result.set('__cmv_real', cmvReal);
  // Flag: 1 = el CMV real es estimado (= compras) porque falta el cierre de
  // inventario del mes y/o del anterior, así que no se aplicó el Δ inventario.
  result.set('__cmv_estimado', aplicarDelta ? 0 : 1);
  result.set('__margen_bruto', margenBruto);
  // Food Cost % usa CMV REAL para reflejar el consumo real, no las compras.
  result.set('_kpi_food', ingNeto > 0 ? cmvReal / ingNeto : 0);
  // Rotación = CMV real / stock promedio. Solo calculable si hay cierre del
  // mes y del anterior. Más alto = stock rota más rápido = menos plata atada.
  const stockPromedio = (stockFinalTotal + stockInicialTotal) / 2;
  result.set(
    '_kpi_rotacion',
    aplicarDelta && stockPromedio > 0 ? cmvReal / stockPromedio : 0,
  );
  // Rotación por categoría = CMV real de la categoría / stock promedio de la
  // categoría. Mismo criterio (solo con los dos cierres). CMV real categoría =
  // compras de la categoría − Δ stock de la categoría. Permite ver qué rubro
  // es el que no rota (ej: bebidas paradas).
  const rotacionCat = (cmvCat: number, sFin: number, sIni: number): number => {
    if (!aplicarDelta) return 0;
    const prom = (sFin + sIni) / 2;
    if (prom <= 0) return 0;
    return (cmvCat - (sFin - sIni)) / prom;
  };
  result.set(
    '_kpi_rotacion_alim',
    rotacionCat(cmvAlimentos, auto.stockFinalAlimentos, auto.stockInicialAlimentos),
  );
  result.set(
    '_kpi_rotacion_beb',
    rotacionCat(cmvBebidas, auto.stockFinalBebidas, auto.stockInicialBebidas),
  );
  result.set(
    '_kpi_rotacion_ind',
    rotacionCat(cmvIndirectos, auto.stockFinalIndirectos, auto.stockInicialIndirectos),
  );
  result.set('pers_sueldos', persSueldos);
  result.set('pers_cargas', persCargas);
  result.set('__pers_total', persTotal);
  result.set('_kpi_labor', ingNeto > 0 ? persTotal / ingNeto : 0);
  result.set('__prime_cost', primeCost);
  result.set('_kpi_prime', ingNeto > 0 ? primeCost / ingNeto : 0);
  result.set('gastos_op', gastosOp);
  result.set('impuestos_op', impuestosOp);
  result.set('fin_intereses', finIntereses);
  result.set('fin_arca', finArca);
  result.set('_kpi_gastosop', ingNeto > 0 ? gastosOp / ingNeto : 0);
  result.set('__ebitda', ebitda);
  result.set('_kpi_ebitda', ingNeto > 0 ? ebitda / ingNeto : 0);
  result.set('amortizaciones', amortizaciones);
  result.set('__ebit', ebit);
  result.set('__fin_total', finTotal);
  result.set('__rdo_antes', rdoAntes);
  result.set('__rdo_neto', rdoNeto);
  result.set('_kpi_margen', ingNeto > 0 ? rdoNeto / ingNeto : 0);
  return result;
}

function semaforo(key: string, v: number): 'verde' | 'amarillo' | 'rojo' | null {
  switch (key) {
    case '_kpi_food':
      return v >= 0.25 && v <= 0.32 ? 'verde' : v < 0.25 ? 'amarillo' : 'rojo';
    case '_kpi_labor':
      return v <= 0.3 ? 'amarillo' : v <= 0.38 ? 'verde' : 'rojo';
    case '_kpi_prime':
      return v <= 0.55 ? 'amarillo' : v <= 0.65 ? 'verde' : 'rojo';
    case '_kpi_gastosop':
      return v <= 0.1 ? 'amarillo' : v <= 0.18 ? 'verde' : 'rojo';
    case '_kpi_ebitda':
      return v >= 0.12 ? 'verde' : v >= 0.05 ? 'amarillo' : 'rojo';
    case '_kpi_margen':
      return v >= 0.05 ? 'verde' : v >= 0 ? 'amarillo' : 'rojo';
    default:
      return null;
  }
}

function formatValor(v: number, formato?: Formato): string {
  if (formato === 'porcentaje') return v !== 0 ? `${(v * 100).toFixed(1)}%` : '—';
  if (formato === 'cantidad')
    return v !== 0 ? v.toLocaleString('es-AR', { maximumFractionDigits: 0 }) : '—';
  if (formato === 'rotacion') return v > 0 ? `${v.toFixed(1)}x` : '—';
  return v !== 0 ? formatARS(v) : '—';
}

// Sentido de la fila para colorear el Δ% mes anterior:
//   +1 → subir el valor numérico es bueno (ingresos, márgenes; también IVA y financiero
//        que se almacenan en negativo: subir = menos negativo = mejor)
//   -1 → subir el valor numérico es malo (costos, impuestos, anticipos)
//    0 → neutro (informativos, ticket promedio): muestra el delta en gris
const SENTIDO_FILA: Record<string, 1 | -1 | 0> = {
  ing_bruto: 1, iva_debito: 1, __ing_netos: 1,
  // dif_arqueo: deliberadamente sin sentido — son montos chicos puntuales
  // (faltantes/sobrantes de caja), comparar mes a mes no aporta señal.
  __ticket_prom: 0, __descuentos_toggle: 0, __cortesias_info: 0, __otros_desc: 0,
  cmv_alimentos: -1, cmv_bebidas: -1, cmv_indirectos: -1, __cmv_total: -1,
  // Stock final: subir es bueno para el dueño (más activo) pero los Δ% mes a mes
  // tienen poca señal — se quedan neutros para no ruido.
  stock_final_alimentos: 0, stock_final_bebidas: 0, stock_final_indirectos: 0,
  // CMV REAL: subir es malo (consumiste más).
  __cmv_real: -1,
  __margen_bruto: 1,
  pers_sueldos: -1, pers_cargas: -1, __pers_total: -1, __prime_cost: -1,
  gastos_op: -1, impuestos_op: -1,
  __ebitda: 1, amortizaciones: -1, __ebit: 1,
  fin_intereses: 1, fin_arca: -1, fin_prestamo: -1, __fin_total: 1,
  __rdo_antes: 1, anticipo_gcias: -1, __rdo_neto: 1,
};

// ── componente ────────────────────────────────────────────────────────────────
export function EstadoResultados({ embedded = false }: { embedded?: boolean } = {}) {
  const [año, setAño] = useState(() => String(new Date().getFullYear()));
  const [localEdr, setLocalEdr] = useState<'vedia' | 'saavedra' | 'consolidado'>('vedia');
  const locales: ('vedia' | 'saavedra')[] =
    localEdr === 'consolidado' ? ['vedia', 'saavedra'] : [localEdr];
  const esConsolidado = localEdr === 'consolidado';
  const [editando, setEditando] = useState<{ periodo: string; key: string } | null>(null);
  const [valorEdit, setValorEdit] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const [sincronizando, setSincronizando] = useState(false);
  const [resumenSync, setResumenSync] = useState<string | null>(null);
  // Rotación por categoría: colapsada por defecto. La fila total funciona como
  // toggle (▸/▾) para no recargar visualmente el EdR.
  const [rotacionExpandida, setRotacionExpandida] = useState(false);
  // Cortesías + Otros descuentos: informativos, colapsados por defecto. La fila
  // resumen "Cortesías y descuentos" funciona como toggle (▸/▾).
  const [descuentosExpandido, setDescuentosExpandido] = useState(false);

  // Última sync OK por local (para mostrar "hace X min" en el header).
  const { data: ultimaSync } = useQuery({
    queryKey: ['fudo_sync_runs_ultima'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fudo_sync_runs')
        .select('local, finished_at, tickets_importados')
        .eq('status', 'ok')
        .not('finished_at', 'is', null)
        .order('finished_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      const byLocal = new Map<string, { finished_at: string; tickets: number }>();
      for (const r of data ?? []) {
        if (!byLocal.has(r.local))
          byLocal.set(r.local, {
            finished_at: r.finished_at as string,
            tickets: r.tickets_importados as number,
          });
      }
      return byLocal;
    },
    refetchInterval: 60_000, // refresca el "hace X min" cada minuto
  });

  // Sync de ambos locales en paralelo. Un solo botón en el header.
  // Por default sincroniza solo el mes actual + el anterior para evitar
  // timeouts en Vedia (año entero supera 150s en edge function).
  async function sincronizarFudoAmbos() {
    setSincronizando(true);
    setResumenSync(null);
    try {
      // Mes actual y el anterior (formato YYYY-MM)
      const hoy = new Date();
      const mesActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
      const dAnt = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
      const mesAnterior = `${dAnt.getFullYear()}-${String(dAnt.getMonth() + 1).padStart(2, '0')}`;
      const mesesSync = [mesAnterior, mesActual];

      const results = await Promise.all(
        (['vedia', 'saavedra'] as const).map(async (loc) => {
          const { data: resp, error: err } = await supabase.functions.invoke(
            'fudo-importar-ventas',
            { body: { local: loc, anio: año, meses: mesesSync } },
          );
          if (err) return { loc, ok: false, error: err.message };
          if (!resp?.ok) return { loc, ok: false, error: resp?.error ?? 'Error desconocido' };
          return {
            loc,
            ok: true,
            tickets: resp.data.ticketsImportados as number,
            dividendos: resp.data.dividendosImportados as number,
            errores: (resp.data.errores ?? []) as string[],
          };
        }),
      );

      const partes = results.map((r) => {
        if (!r.ok) return `${r.loc}: ❌ ${r.error}`;
        const errSuf = r.errores && r.errores.length ? ` · ${r.errores.length} errores` : '';
        const divSuf = r.dividendos ? ` · ${r.dividendos} pagos Lucas` : '';
        return `${r.loc}: ${r.tickets} tickets${divSuf}${errSuf}`;
      });
      const algunoFalló = results.some((r) => !r.ok);
      setResumenSync((algunoFalló ? '⚠ ' : '✓ ') + partes.join(' | '));

      qc.invalidateQueries({ queryKey: ['edr_tickets'] });
      qc.invalidateQueries({ queryKey: ['edr_gastos_resumen'] });
      qc.invalidateQueries({ queryKey: ['edr_partidas'] });
      qc.invalidateQueries({ queryKey: ['fudo_sync_runs_ultima'] });
    } catch (e) {
      setResumenSync(`Error: ${(e as Error).message}`);
    } finally {
      setSincronizando(false);
    }
  }

  // Δ% vs mes anterior (con datos). Devuelve null si no se puede calcular.
  // Ignora cambios menores al 0.5% para no ensuciar la tabla con ruido.
  function calcularDelta(filaKey: string, mes: string): number | null {
    const idx = meses.indexOf(mes);
    if (idx <= 0) return null;
    // Buscar el mes anterior CON datos. Saltea meses vacíos para que enero→marzo
    // no muestre delta con respecto a febrero=0.
    let prev: string | null = null;
    for (let i = idx - 1; i >= 0; i--) {
      if (mesesConDatos.has(meses[i])) {
        prev = meses[i];
        break;
      }
    }
    if (!prev) return null;
    const valActual = valoresPorMes.get(mes)?.get(filaKey) ?? 0;
    const valPrev = valoresPorMes.get(prev)?.get(filaKey) ?? 0;
    if (valPrev === 0 || valActual === 0) return null;
    const pct = ((valActual - valPrev) / Math.abs(valPrev)) * 100;
    if (Math.abs(pct) < 0.5) return null;
    return pct;
  }

  // Texto "hace X min" / "hace X h" / "hace X días". Más viejo que 7d → fecha.
  function tiempoRelativo(iso: string | undefined): string {
    if (!iso) return 'sin sync';
    const diff = Date.now() - new Date(iso).getTime();
    const min = Math.floor(diff / 60_000);
    if (min < 1) return 'recién';
    if (min < 60) return `hace ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `hace ${h} h`;
    const d = Math.floor(h / 24);
    if (d < 7) return `hace ${d} d`;
    return new Date(iso).toLocaleDateString('es-AR');
  }

  // ── helpers para queries multi-local ────────────────────────────────────────
  type TicketRow = { periodo: string; ing_bruto: number; iva_debito: number; ticket_count: number };
  type GastoResRow = {
    periodo: string;
    cmv_alimentos: number;
    cmv_bebidas: number;
    cmv_indirectos: number;
    gastos_op: number;
    gastos_rrhh: number;
    impuestos_op: number;
    inversiones: number;
    intereses: number;
    sueldos: number;
    cargas_sociales: number;
    arca: number;
  };
  type AmortRow = { periodo: string; total_amort: number };
  type PartidaRow = { periodo: string; concepto: string; monto: number };

  function mergeByPeriodo<T extends { periodo: string }>(arrays: T[][], numKeys: (keyof T)[]): T[] {
    const map = new Map<string, T>();
    for (const arr of arrays) {
      for (const row of arr) {
        const existing = map.get(row.periodo);
        if (existing) {
          const e = existing as unknown as Record<string, number>;
          const r = row as unknown as Record<string, number>;
          for (const k of numKeys) e[k as string] = (e[k as string] ?? 0) + (r[k as string] ?? 0);
        } else {
          map.set(row.periodo, { ...row });
        }
      }
    }
    return [...map.values()].sort((a, b) => a.periodo.localeCompare(b.periodo));
  }

  // ── queries ────────────────────────────────────────────────────────────────
  const { data: ticketsRaw } = useQuery({
    queryKey: ['edr_tickets', año, localEdr],
    queryFn: async () => {
      const results = await Promise.all(
        locales.map(async (loc) => {
          const { data, error } = await supabase.rpc('edr_resumen_ventas', {
            p_local: loc,
            p_anio: año,
          });
          if (error) {
            console.error('[edr_resumen_ventas]', error);
            return [];
          }
          // IVA débito estimado (total mensual 21/121) guardado por local en
          // edr_partidas. Se resuelve el efectivo POR LOCAL acá, ANTES de
          // consolidar: el real por ticket manda; si es 0, se usa el estimado del
          // local. Clave para el consolidado — así se suma el efectivo de cada
          // local. (Antes el estimado se resolvía después del merge y un local
          // pisaba al otro, mostrando el IVA de uno solo en "Empresa".)
          const { data: ivaEst } = await supabase
            .from('edr_partidas')
            .select('periodo, monto')
            .eq('local', loc)
            .eq('concepto', 'iva_debito')
            .gte('periodo', `${año}-01`)
            .lte('periodo', `${año}-12`);
          const ivaEstMap = new Map(
            (ivaEst ?? []).map((r) => [r.periodo as string, Number(r.monto)]),
          );
          return ((data ?? []) as TicketRow[]).map((row) => ({
            ...row,
            iva_debito:
              Number(row.iva_debito) > 0 ? Number(row.iva_debito) : ivaEstMap.get(row.periodo) ?? 0,
          }));
        }),
      );
      return esConsolidado
        ? mergeByPeriodo(results, ['ing_bruto', 'iva_debito', 'ticket_count'])
        : results[0];
    },
  });

  const { data: gastosResumen } = useQuery({
    queryKey: ['edr_gastos_resumen', año, localEdr],
    queryFn: async () => {
      const results = await Promise.all(
        locales.map(async (loc) => {
          const { data, error } = await supabase.rpc('edr_resumen_gastos', {
            p_local: loc,
            p_anio: año,
          });
          if (error) {
            console.error('[edr_resumen_gastos]', error);
            return [];
          }
          return (data ?? []) as GastoResRow[];
        }),
      );
      return esConsolidado
        ? mergeByPeriodo(results, [
            'cmv_alimentos',
            'cmv_bebidas',
            'cmv_indirectos',
            'gastos_op',
            'gastos_rrhh',
            'impuestos_op',
            'inversiones',
            'intereses',
            'sueldos',
            'cargas_sociales',
            'arca',
          ])
        : results[0];
    },
  });

  const { data: amortRaw } = useQuery({
    queryKey: ['edr_amortizaciones', año, localEdr],
    queryFn: async () => {
      const results = await Promise.all(
        locales.map(async (loc) => {
          const { data, error } = await supabase.rpc('amort_resumen_anual', {
            p_local: loc,
            p_anio: año,
          });
          if (error) {
            console.error('[amort_resumen_anual]', error);
            return [];
          }
          return (data ?? []) as AmortRow[];
        }),
      );
      return esConsolidado ? mergeByPeriodo(results, ['total_amort']) : results[0];
    },
  });

  // Cierres de inventario aprobados — para Δ Inventario y CMV REAL.
  // Trae también el último mes del año anterior para que enero pueda calcular Δ.
  const { data: cierresInventarioRaw } = useQuery({
    queryKey: ['edr_stock_inventario', año, localEdr],
    queryFn: async () => {
      const desde = `${Number(año) - 1}-12`;
      const hasta = `${año}-12`;
      const results = await Promise.all(
        locales.map(async (loc) => {
          const { data, error } = await supabase
            .from('edr_cierres_inventario')
            .select('periodo, monto_alimentos, monto_bebidas, monto_indirectos')
            .eq('local', loc)
            .eq('estado', 'aprobado')
            .gte('periodo', desde)
            .lte('periodo', hasta);
          if (error) {
            console.error('[edr_cierres_inventario]', error);
            return [];
          }
          return (data ?? []) as Array<{
            periodo: string;
            monto_alimentos: number;
            monto_bebidas: number;
            monto_indirectos: number;
          }>;
        }),
      );
      return esConsolidado
        ? mergeByPeriodo(results, ['monto_alimentos', 'monto_bebidas', 'monto_indirectos'])
        : results[0];
    },
  });

  const { data: arqueosRaw } = useQuery({
    queryKey: ['edr_arqueos', año, localEdr],
    queryFn: async () => {
      const results = await Promise.all(
        locales.map(async (loc) => {
          const { data } = await supabase
            .from('cierres_caja')
            .select('fecha, diferencia')
            .eq('local', loc)
            .gte('fecha', `${año}-01-01`)
            .lte('fecha', `${año}-12-31`);
          // Agrupar por periodo (YYYY-MM)
          const porMes = new Map<string, number>();
          for (const r of data ?? []) {
            const p = (r.fecha as string).substring(0, 7);
            porMes.set(p, (porMes.get(p) ?? 0) + Number(r.diferencia ?? 0));
          }
          return [...porMes.entries()].map(([periodo, dif_total]) => ({ periodo, dif_total }));
        }),
      );
      return esConsolidado ? mergeByPeriodo(results, ['dif_total']) : results[0];
    },
  });

  // Sueldos pagados desde RRHH (pagos_sueldos)
  const { data: sueldosPagadosRaw } = useQuery({
    queryKey: ['edr_sueldos_pagados', año, localEdr],
    queryFn: async () => {
      const results = await Promise.all(
        locales.map(async (loc) => {
          // EdR devengado: agrupar por `periodo` (mes/quincena trabajada),
          // no por `fecha_pago`. La Q2 que se paga a principios del mes
          // siguiente pertenece al costo del mes en que se trabajó.
          const { data } = await supabase
            .from('pagos_sueldos')
            .select('periodo, monto, local')
            .gte('periodo', `${año}-01`)
            .lte('periodo', `${año}-12-Q9`)
            .eq('local', loc);
          const porMes = new Map<string, number>();
          for (const r of data ?? []) {
            const p = (r.periodo as string).substring(0, 7);
            porMes.set(p, (porMes.get(p) ?? 0) + Number(r.monto));
          }
          return [...porMes.entries()].map(([periodo, sueldos_total]) => ({
            periodo,
            sueldos_total,
          }));
        }),
      );
      return esConsolidado ? mergeByPeriodo(results, ['sueldos_total']) : results[0];
    },
  });

  // Cargos MP sobre pagos egresos (impuesto al débito, comisiones por enviar plata).
  // Vienen en movimientos_bancarios con tipo='cargo_mp' y gasto_id null. Como tipicamente
  // no tienen local imputado (es un costo del medio de pago, no del local), en consolidado
  // se traen todos; en vista por local solo los que tengan local matcheante.
  const { data: cargosMPRaw } = useQuery({
    queryKey: ['edr_cargos_mp', año, localEdr],
    queryFn: async () => {
      let q = supabase
        .from('movimientos_bancarios')
        .select('fecha, debito, local')
        .eq('cuenta', 'mercadopago')
        .eq('tipo', 'cargo_mp')
        .is('gasto_id', null)
        .gte('fecha', `${año}-01-01`)
        .lte('fecha', `${año}-12-31`);
      if (!esConsolidado) q = q.eq('local', localEdr);
      const { data } = await q;
      const porMes = new Map<string, number>();
      for (const r of data ?? []) {
        const p = (r.fecha as string).substring(0, 7);
        porMes.set(p, (porMes.get(p) ?? 0) + Number(r.debito));
      }
      return [...porMes.entries()].map(([periodo, total]) => ({ periodo, total }));
    },
  });

  const { data: partidasRaw } = useQuery({
    queryKey: ['edr_partidas', año, localEdr],
    queryFn: async () => {
      const results = await Promise.all(
        locales.map(async (loc) => {
          const { data } = await supabase
            .from('edr_partidas')
            .select('periodo, concepto, monto')
            .eq('local', loc)
            .gte('periodo', `${año}-01`)
            .lte('periodo', `${año}-12`);
          return (data ?? []) as PartidaRow[];
        }),
      );
      return results.flat();
    },
  });

  // ── derivar datos por mes ─────────────────────────────────────────────────
  const EMPTY_AUTO: AutoMes = {
    ingBruto: 0,
    ivaDebito: 0,
    ticketCount: 0,
    cmvAlimentos: 0,
    cmvBebidas: 0,
    cmvIndirectos: 0,
    gastosOp: 0,
    gastosRrhh: 0,
    impuestosOp: 0,
    inversiones: 0,
    intereses: 0,
    sueldos: 0,
    cargasSociales: 0,
    amortizaciones: 0,
    difArqueo: 0,
    arca: 0,
    stockFinalAlimentos: 0,
    stockFinalBebidas: 0,
    stockFinalIndirectos: 0,
    stockInicialAlimentos: 0,
    stockInicialBebidas: 0,
    stockInicialIndirectos: 0,
    hayCierreMes: false,
    hayCierreAnterior: false,
  };

  const autoMap = useMemo(() => {
    // Gastos agrupados por periodo
    const gastosMap = new Map<
      string,
      typeof gastosResumen extends (infer T)[] | null | undefined ? T : never
    >();
    for (const g of gastosResumen ?? []) {
      gastosMap.set(g.periodo, g);
    }

    const map = new Map<string, AutoMes>();
    // Poblar desde tickets
    for (const t of ticketsRaw ?? []) {
      const g = gastosMap.get(t.periodo);
      map.set(t.periodo, {
        ...EMPTY_AUTO,
        ingBruto: Number(t.ing_bruto),
        ivaDebito: Number(t.iva_debito ?? 0),
        ticketCount: Number(t.ticket_count),
        cmvAlimentos: Number(g?.cmv_alimentos ?? 0),
        cmvBebidas: Number(g?.cmv_bebidas ?? 0),
        cmvIndirectos: Number(g?.cmv_indirectos ?? 0),
        gastosOp: Number(g?.gastos_op ?? 0),
        gastosRrhh: Number(g?.gastos_rrhh ?? 0),
        impuestosOp: Number(g?.impuestos_op ?? 0),
        inversiones: Number(g?.inversiones ?? 0),
        intereses: Number(g?.intereses ?? 0),
        sueldos: Number(g?.sueldos ?? 0),
        cargasSociales: Number(g?.cargas_sociales ?? 0),
        arca: Number(g?.arca ?? 0),
      });
    }
    // Periodos solo con gastos (sin tickets)
    for (const g of gastosResumen ?? []) {
      if (!map.has(g.periodo)) {
        map.set(g.periodo, {
          ...EMPTY_AUTO,
          cmvAlimentos: Number(g.cmv_alimentos),
          cmvBebidas: Number(g.cmv_bebidas),
          cmvIndirectos: Number(g.cmv_indirectos),
          gastosOp: Number(g.gastos_op),
          gastosRrhh: Number(g.gastos_rrhh),
          impuestosOp: Number(g.impuestos_op),
          inversiones: Number(g.inversiones),
          intereses: Number(g.intereses),
          sueldos: Number(g.sueldos),
          cargasSociales: Number(g.cargas_sociales),
          arca: Number(g.arca ?? 0),
        });
      }
    }
    // Amortizaciones auto desde tabla amortizaciones
    for (const a of amortRaw ?? []) {
      const existing = map.get(a.periodo);
      if (existing) {
        existing.amortizaciones = Number(a.total_amort);
      } else {
        map.set(a.periodo, { ...EMPTY_AUTO, amortizaciones: Number(a.total_amort) });
      }
    }
    // Diferencias de arqueo desde cierres de caja
    for (const a of arqueosRaw ?? []) {
      const existing = map.get(a.periodo);
      if (existing) {
        existing.difArqueo = Number(a.dif_total);
      } else {
        map.set(a.periodo, { ...EMPTY_AUTO, difArqueo: Number(a.dif_total) });
      }
    }
    // Sueldos pagados desde RRHH (pagos_sueldos) — REEMPLAZA lo que vino del RPC
    // (single source of truth: si tildaste el pago en RRHH, ese es el monto del EdR).
    // Si un mes no tiene registros en pagos_sueldos, queda el fallback de la subcat
    // "sueldos" de la tabla gastos (compat con carga histórica vía Excel).
    for (const s of sueldosPagadosRaw ?? []) {
      const existing = map.get(s.periodo);
      if (existing) {
        existing.sueldos = Number(s.sueldos_total);
      } else {
        map.set(s.periodo, { ...EMPTY_AUTO, sueldos: Number(s.sueldos_total) });
      }
    }
    // Cargos MP (impuesto al débito sobre pagos egresos) → suma a intereses
    // (resultado financiero). Antes quedaban afuera del EdR.
    for (const c of cargosMPRaw ?? []) {
      const existing = map.get(c.periodo);
      if (existing) {
        existing.intereses = Number(existing.intereses) + Number(c.total);
      } else {
        map.set(c.periodo, { ...EMPTY_AUTO, intereses: Number(c.total) });
      }
    }
    // Cierres de inventario aprobados → stock final del mes y stock inicial del siguiente.
    // Indexamos por periodo para look-up rápido al setear el mes que viene.
    const cierresPorPeriodo = new Map<
      string,
      { alimentos: number; bebidas: number; indirectos: number }
    >();
    for (const c of cierresInventarioRaw ?? []) {
      cierresPorPeriodo.set(c.periodo, {
        alimentos: Number(c.monto_alimentos),
        bebidas: Number(c.monto_bebidas),
        indirectos: Number(c.monto_indirectos),
      });
    }
    // Aplicar a cada mes del año del EdR.
    for (let i = 1; i <= 12; i++) {
      const periodo = `${año}-${String(i).padStart(2, '0')}`;
      // Periodo anterior (puede ser dic del año anterior si i=1).
      let prevPeriodo: string;
      if (i === 1) prevPeriodo = `${Number(año) - 1}-12`;
      else prevPeriodo = `${año}-${String(i - 1).padStart(2, '0')}`;

      const cierreMes = cierresPorPeriodo.get(periodo);
      const cierrePrev = cierresPorPeriodo.get(prevPeriodo);
      if (!cierreMes && !cierrePrev) continue; // nada que setear

      const existing = map.get(periodo) ?? { ...EMPTY_AUTO };
      if (cierreMes) {
        existing.stockFinalAlimentos = cierreMes.alimentos;
        existing.stockFinalBebidas = cierreMes.bebidas;
        existing.stockFinalIndirectos = cierreMes.indirectos;
        existing.hayCierreMes = true;
      }
      if (cierrePrev) {
        existing.stockInicialAlimentos = cierrePrev.alimentos;
        existing.stockInicialBebidas = cierrePrev.bebidas;
        existing.stockInicialIndirectos = cierrePrev.indirectos;
        existing.hayCierreAnterior = true;
      }
      map.set(periodo, existing);
    }
    return map;
  }, [
    ticketsRaw,
    gastosResumen,
    amortRaw,
    arqueosRaw,
    sueldosPagadosRaw,
    cargosMPRaw,
    cierresInventarioRaw,
    año,
  ]);

  const manualMap = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const p of partidasRaw ?? []) {
      if (!map.has(p.periodo)) map.set(p.periodo, new Map());
      map.get(p.periodo)!.set(p.concepto, Number(p.monto));
    }
    return map;
  }, [partidasRaw]);

  // Meses a mostrar (los 12 del año para que siempre se pueda editar)
  const meses = useMemo(
    () => Array.from({ length: 12 }, (_, i) => `${año}-${String(i + 1).padStart(2, '0')}`),
    [año],
  );

  // Calcular valores completos por mes
  const valoresPorMes = useMemo(() => {
    const result = new Map<string, Map<string, number>>();
    for (const mes of meses) {
      const auto = autoMap.get(mes) ?? EMPTY_AUTO;
      const manual = manualMap.get(mes) ?? new Map();
      result.set(mes, computarMes(manual, auto));
    }
    return result;
  }, [meses, autoMap, manualMap]);

  // ACUM: suma mes a mes (los %, se recalculan al final)
  const valoresAcum = useMemo(() => {
    const acum = new Map<string, number>();
    for (const [, mv] of valoresPorMes) {
      for (const [k, v] of mv) {
        if (!k.startsWith('_kpi_')) acum.set(k, (acum.get(k) ?? 0) + v);
      }
    }
    // recalcular KPIs del acumulado
    const ingNeto = acum.get('__ing_netos') ?? 0;
    if (ingNeto > 0) {
      acum.set('_kpi_food', (acum.get('__cmv_real') ?? 0) / ingNeto);
      acum.set('_kpi_labor', (acum.get('__pers_total') ?? 0) / ingNeto);
      acum.set('_kpi_prime', (acum.get('__prime_cost') ?? 0) / ingNeto);
      acum.set('_kpi_gastosop', (acum.get('gastos_op') ?? 0) / ingNeto);
      acum.set('_kpi_ebitda', (acum.get('__ebitda') ?? 0) / ingNeto);
      acum.set('_kpi_margen', (acum.get('__rdo_neto') ?? 0) / ingNeto);
    }
    return acum;
  }, [valoresPorMes]);

  // Meses con algún dato (para pintar diferente)
  const mesesConDatos = useMemo(() => {
    const con = new Set<string>();
    for (const mes of meses) {
      const auto = autoMap.get(mes);
      const manual = manualMap.get(mes);
      if ((auto?.ingBruto ?? 0) > 0 || (manual && manual.size > 0)) con.add(mes);
    }
    return con;
  }, [meses, autoMap, manualMap]);

  // Meses con actividad cuyo CMV quedó estimado (falta cierre de inventario del
  // mes y/o del anterior → no se aplicó el Δ inventario). Se avisa arriba de la
  // tabla para que el CMV real no se lea como definitivo sin serlo.
  const mesesCmvEstimado = useMemo(() => {
    const arr: string[] = [];
    for (const mes of meses) {
      const mv = valoresPorMes.get(mes);
      if (!mv) continue;
      if (
        mesesConDatos.has(mes) &&
        (mv.get('__cmv_total') ?? 0) > 0 &&
        mv.get('__cmv_estimado') === 1
      ) {
        arr.push(MESES_LABEL[parseInt(mes.substring(5, 7)) - 1]);
      }
    }
    return arr;
  }, [meses, valoresPorMes, mesesConDatos]);

  // ── edición inline ─────────────────────────────────────────────────────────
  function startEdit(periodo: string, key: string, valorActual: number) {
    setEditando({ periodo, key });
    setValorEdit(valorActual !== 0 ? String(Math.abs(valorActual)).replace('.', ',') : '');
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  async function guardar() {
    if (!editando) return;
    const raw = valorEdit.trim().replace(/\./g, '').replace(',', '.');
    const monto = parseFloat(raw) || 0;
    await supabase
      .from('edr_partidas')
      .upsert(
        { local: localEdr, periodo: editando.periodo, concepto: editando.key, monto },
        { onConflict: 'local,periodo,concepto' },
      );
    qc.invalidateQueries({ queryKey: ['edr_partidas', año, localEdr] });
    setEditando(null);
  }

  function cancelar() {
    setEditando(null);
  }

  // ── render ─────────────────────────────────────────────────────────────────
  const inner = (
    <>
      {/* Filtros */}
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <LocalSelector
          value={localEdr}
          onChange={(v) => setLocalEdr(v as 'vedia' | 'saavedra' | 'consolidado')}
          options={['vedia', 'saavedra', 'consolidado']}
        />
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-500">Año</label>
          <input
            type="number"
            min="2020"
            max="2099"
            value={año}
            onChange={(e) => setAño(e.target.value)}
            className="w-24 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-rodziny-500"
          />
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="text-right text-[11px] leading-tight text-gray-500">
            <div>
              Vedia:{' '}
              <span className="font-medium text-gray-700">
                {tiempoRelativo(ultimaSync?.get('vedia')?.finished_at)}
              </span>
            </div>
            <div>
              Saavedra:{' '}
              <span className="font-medium text-gray-700">
                {tiempoRelativo(ultimaSync?.get('saavedra')?.finished_at)}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={sincronizarFudoAmbos}
            disabled={sincronizando}
            className={cn(
              'rounded-md border px-4 py-2 text-xs font-semibold transition-colors',
              sincronizando
                ? 'border-rodziny-300 bg-rodziny-50 text-rodziny-700'
                : 'border-rodziny-600 bg-rodziny-600 text-white hover:bg-rodziny-700',
            )}
          >
            {sincronizando ? '↻ Sincronizando...' : `↻ Sincronizar Fudo ${año}`}
          </button>
        </div>
      </div>
      {resumenSync && (
        <p
          className={cn(
            'mb-3 rounded-md px-3 py-2 text-xs',
            resumenSync.startsWith('Error')
              ? 'border border-red-200 bg-red-50 text-red-700'
              : 'border border-emerald-200 bg-emerald-50 text-emerald-700',
          )}
        >
          {resumenSync}
        </p>
      )}
      <p className="mb-4 text-xs text-gray-400">
        Clic en celda azul para editar · Enter para guardar · Esc para cancelar
      </p>

      {mesesCmvEstimado.length > 0 && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          ⚠ <strong>CMV estimado</strong> en {mesesCmvEstimado.join(', ')}:{' '}
          {localEdr === 'consolidado' ? 'el consolidado necesita' : 'este local necesita'} el cierre
          de inventario aprobado del mes <em>y</em> del anterior para calcular el consumo real. Sin
          eso, el CMV se muestra igual a las compras (sin Δ inventario) y el margen puede estar
          distorsionado.
        </div>
      )}

      {/* Tabla EdR */}
      <div className="overflow-hidden rounded-lg border border-surface-border bg-white">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="sticky left-0 z-10 min-w-[240px] bg-gray-50 px-4 py-3 text-left text-xs font-semibold text-gray-600">
                  CONCEPTO
                </th>
                {meses.map((mes) => (
                  <th
                    key={mes}
                    className={cn(
                      'min-w-[110px] px-3 py-3 text-right text-xs font-semibold',
                      mesesConDatos.has(mes) ? 'text-gray-700' : 'text-gray-300',
                    )}
                  >
                    {MESES_LABEL[parseInt(mes.substring(5, 7)) - 1]}
                  </th>
                ))}
                <th className="min-w-[120px] border-l border-gray-200 px-3 py-3 text-right text-xs font-semibold text-rodziny-700">
                  ACUM
                </th>
                <th className="min-w-[80px] px-3 py-3 text-center text-xs font-semibold text-gray-400">
                  Ref.
                </th>
              </tr>
            </thead>
            <tbody>
              {FILAS.map((fila) => {
                if (fila.tipo === 'espacio')
                  return (
                    <tr key={fila.key}>
                      <td colSpan={14} className="h-2" />
                    </tr>
                  );

                // Sub-filas de rotación por categoría: ocultas salvo que se expanda
                // la fila total de rotación (que actúa como toggle).
                if (fila.key.startsWith('_kpi_rotacion_') && !rotacionExpandida) return null;

                // Detalle de cortesías/descuentos: oculto salvo que se expanda la
                // fila resumen "Cortesías y descuentos" (que actúa como toggle).
                if (
                  (fila.key === '__cortesias_info' || fila.key === '__otros_desc') &&
                  !descuentosExpandido
                )
                  return null;

                const esSeccion = fila.tipo === 'seccion';
                const esTotal = fila.tipo === 'calculada' && fila.depth === 0;
                const esKpi = fila.tipo === 'kpi';
                const esManual = fila.tipo === 'manual';

                return (
                  <tr
                    key={fila.key}
                    className={cn(
                      'border-b border-gray-50',
                      esSeccion && 'bg-gray-900',
                      esTotal && 'bg-gray-50 font-semibold',
                      esKpi && 'bg-transparent',
                      !esSeccion && !esTotal && 'hover:bg-gray-50',
                    )}
                  >
                    {/* Label */}
                    <td
                      className={cn(
                        'sticky left-0 z-10 px-4 py-2',
                        esSeccion
                          ? 'bg-gray-900 text-xs font-bold uppercase tracking-wider text-white'
                          : 'bg-white',
                        esTotal && '!bg-gray-50',
                        esKpi && 'text-xs italic text-gray-500',
                        fila.depth === 1 && !esKpi && 'pl-8 text-gray-700',
                        fila.depth === 2 && 'pl-12 text-gray-600',
                        fila.depth === 0 && !esSeccion && !esTotal && 'font-medium text-gray-800',
                      )}
                      style={esSeccion ? {} : { backgroundColor: esTotal ? '#f9fafb' : 'white' }}
                    >
                      {esSeccion ? (
                        fila.label
                      ) : fila.key === '_kpi_rotacion' ? (
                        <button
                          type="button"
                          onClick={() => setRotacionExpandida((v) => !v)}
                          className="flex items-center gap-1 text-gray-400 transition-colors hover:text-gray-600"
                          title="Ver/ocultar rotación por categoría (alimentos, bebidas, indirectos)"
                        >
                          <span className="text-[9px] leading-none">
                            {rotacionExpandida ? '▾' : '▸'}
                          </span>
                          {fila.label}
                        </button>
                      ) : fila.key === '__descuentos_toggle' ? (
                        <button
                          type="button"
                          onClick={() => setDescuentosExpandido((v) => !v)}
                          className="flex items-center gap-1 text-xs italic text-gray-400 transition-colors hover:text-gray-600"
                          title="Ver/ocultar cortesías y otros descuentos (informativo)"
                        >
                          <span className="text-[9px] not-italic leading-none">
                            {descuentosExpandido ? '▾' : '▸'}
                          </span>
                          {fila.label}
                          <span className="ml-1 not-italic text-gray-300">(informativo)</span>
                        </button>
                      ) : (
                        <span
                          className={cn(
                            esKpi && 'text-gray-400',
                            (fila.key === '__cortesias_info' || fila.key === '__otros_desc') &&
                              'text-xs italic text-gray-400',
                          )}
                        >
                          {fila.label}
                          {fila.key === '__cortesias_info' || fila.key === '__otros_desc' ? (
                            <span className="ml-1 text-gray-300">(informativo)</span>
                          ) : null}
                        </span>
                      )}
                    </td>

                    {/* Celdas por mes */}
                    {meses.map((mes) => {
                      if (esSeccion) return <td key={mes} className="bg-gray-900" />;

                      const valores = valoresPorMes.get(mes) ?? new Map();
                      const valor = valores.get(fila.key) ?? 0;
                      const estaEditando = editando?.periodo === mes && editando?.key === fila.key;
                      const color = esKpi ? semaforo(fila.key, valor) : null;
                      const sinDatos = !mesesConDatos.has(mes);

                      // Δ% vs mes anterior con datos. Solo en filas con sentido definido
                      // (no en manuales, KPIs o informativos sin clasificar).
                      const sentido = SENTIDO_FILA[fila.key];
                      const mostrarDelta =
                        !esKpi && !esManual && sentido !== undefined && !sinDatos && valor !== 0;
                      const deltaPct = mostrarDelta ? calcularDelta(fila.key, mes) : null;
                      const deltaColor = (() => {
                        if (deltaPct === null || sentido === undefined) return '';
                        if (sentido === 0) return 'text-gray-400';
                        const subio = deltaPct > 0;
                        const esBueno = (sentido === 1 && subio) || (sentido === -1 && !subio);
                        return esBueno ? 'text-emerald-600' : 'text-red-500';
                      })();

                      return (
                        <td
                          key={mes}
                          className={cn(
                            'px-3 py-2 text-right',
                            esManual &&
                              !sinDatos &&
                              'cursor-pointer hover:bg-blue-50 hover:text-blue-700',
                            esManual &&
                              sinDatos &&
                              'cursor-pointer opacity-40 hover:bg-blue-50 hover:opacity-100',
                            esTotal && 'font-semibold',
                            esKpi && color === 'verde' && 'font-medium text-green-700',
                            esKpi && color === 'amarillo' && 'font-medium text-yellow-600',
                            esKpi && color === 'rojo' && 'font-medium text-red-600',
                            !esKpi && valor < 0 && 'text-red-600',
                            !esKpi &&
                              valor > 0 &&
                              !esManual &&
                              !esTotal &&
                              fila.depth === 0 &&
                              'text-gray-900',
                            !esKpi && esManual && valor !== 0 && 'text-blue-700',
                          )}
                          onClick={() =>
                            esManual && !esConsolidado && startEdit(mes, fila.key, valor)
                          }
                        >
                          {estaEditando ? (
                            <input
                              ref={inputRef}
                              value={valorEdit}
                              onChange={(e) => setValorEdit(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') guardar();
                                if (e.key === 'Escape') cancelar();
                              }}
                              onBlur={guardar}
                              className="w-full rounded border border-blue-400 bg-blue-50 px-1 py-0.5 text-right text-sm outline-none"
                              placeholder="0"
                            />
                          ) : (
                            <span className={esKpi ? 'text-xs' : 'text-sm'}>
                              {valor !== 0 ? (
                                formatValor(valor, fila.formato)
                              ) : esManual ? (
                                <span className="text-gray-200">—</span>
                              ) : (
                                '—'
                              )}
                            </span>
                          )}
                          {deltaPct !== null && !estaEditando && (
                            <div className={cn('mt-0.5 text-[10px] leading-none', deltaColor)}>
                              {deltaPct > 0 ? '↑' : '↓'} {Math.abs(deltaPct).toFixed(1)}%
                            </div>
                          )}
                        </td>
                      );
                    })}

                    {/* ACUM */}
                    {esSeccion ? (
                      <td className="border-l border-gray-700 bg-gray-900" />
                    ) : (
                      <td
                        className={cn(
                          'border-l border-gray-100 px-3 py-2 text-right',
                          esTotal && 'bg-rodziny-50 font-semibold',
                          esKpi && 'bg-green-50',
                        )}
                      >
                        {(() => {
                          const v = valoresAcum.get(fila.key) ?? 0;
                          const color = esKpi ? semaforo(fila.key, v) : null;
                          return (
                            <span
                              className={cn(
                                'font-medium',
                                esKpi ? 'text-xs' : 'text-sm',
                                esKpi && color === 'verde' && 'text-green-700',
                                esKpi && color === 'amarillo' && 'text-yellow-600',
                                esKpi && color === 'rojo' && 'text-red-600',
                                !esKpi && v < 0 && 'text-red-600',
                                esTotal && 'text-rodziny-800',
                              )}
                            >
                              {v !== 0 ? formatValor(v, fila.formato) : '—'}
                            </span>
                          );
                        })()}
                      </td>
                    )}

                    {/* Benchmark */}
                    <td className="px-3 py-2 text-center text-xs text-gray-300">
                      {fila.benchmark ?? ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-3 text-xs text-gray-400">
        Ingresos Brutos e IVA Débito se calculan automáticamente desde los tickets importados de
        Fudo (21% sobre facturadas). Gastos se agregan netos de IVA cuando el comprobante lo
        discrimina (factura A); si no, se toma el total como neto. El bloque "Memo fiscal" al pie
        es solo informativo para ver la posición frente a ARCA y no afecta el Resultado Neto.
        Cortesías y descuentos son informativos (ya incluidos en la venta bruta por Fudo). El
        resto de las celdas (azules) son editables — hacé clic para ingresar el valor.
      </p>
    </>
  );

  if (embedded) return inner;
  return (
    <PageContainer title="Estado de Resultados" subtitle="Mensual por local — edición inline">
      {inner}
    </PageContainer>
  );
}
