import { useState, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { PageContainer } from '@/components/layout/PageContainer'
import { formatARS } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { LocalSelector } from '@/components/ui/LocalSelector'

// ── constantes ────────────────────────────────────────────────────────────────
const MESES_LABEL = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

type TipoFila = 'seccion' | 'auto' | 'manual' | 'calculada' | 'kpi' | 'espacio'
type Formato   = 'moneda' | 'porcentaje' | 'cantidad'

interface FilaEdR {
  key:        string
  label:      string
  tipo:       TipoFila
  depth:      number
  formato?:   Formato
  benchmark?: string
}

const FILAS: FilaEdR[] = [
  { key: '_ing',            label: 'INGRESOS',                          tipo: 'seccion',   depth: 0 },
  { key: 'ing_bruto',       label: 'Ingresos Brutos (con IVA)',         tipo: 'auto',      depth: 1, formato: 'moneda' },
  { key: 'dif_arqueo',      label: '(+/-) Diferencias de arqueo',      tipo: 'auto',      depth: 1, formato: 'moneda' },
  { key: 'iva_debito',      label: '(-) IVA Débito Fiscal',            tipo: 'auto',      depth: 1, formato: 'moneda' },
  { key: '__ing_netos',     label: 'INGRESOS NETOS',                    tipo: 'calculada', depth: 0, formato: 'moneda' },
  { key: '__ticket_prom',   label: 'Ticket Promedio',                   tipo: 'calculada', depth: 1, formato: 'moneda' },
  { key: '__cortesias_info',label: 'Cortesías',                         tipo: 'calculada', depth: 1, formato: 'moneda' },
  { key: '__otros_desc',    label: 'Otros descuentos',                  tipo: 'calculada', depth: 1, formato: 'moneda' },
  { key: '_esp1',           label: '',                                   tipo: 'espacio',   depth: 0 },

  { key: '_cmv',            label: 'CMV',                               tipo: 'seccion',   depth: 0 },
  { key: 'cmv_alimentos',   label: 'Costo de alimentos',               tipo: 'auto',      depth: 1, formato: 'moneda' },
  { key: 'cmv_bebidas',     label: 'Costo de bebidas',                 tipo: 'auto',      depth: 1, formato: 'moneda' },
  { key: 'cmv_indirectos',  label: 'Costos indirectos de operación',   tipo: 'auto',      depth: 1, formato: 'moneda' },
  { key: '__cmv_total',     label: 'TOTAL CMV',                        tipo: 'calculada', depth: 0, formato: 'moneda' },
  { key: '__margen_bruto',  label: 'MARGEN BRUTO',                     tipo: 'calculada', depth: 0, formato: 'moneda' },
  { key: '_kpi_food',       label: '↸ Food Cost %',                    tipo: 'kpi',       depth: 1, formato: 'porcentaje', benchmark: '25-32%' },
  { key: '_esp2',           label: '',                                   tipo: 'espacio',   depth: 0 },

  { key: '_personal',       label: 'PERSONAL',                          tipo: 'seccion',   depth: 0 },
  { key: 'pers_sueldos',    label: 'Sueldos',                           tipo: 'auto',      depth: 1, formato: 'moneda' },
  { key: 'pers_cargas',     label: 'Cargas Sociales',                  tipo: 'auto',      depth: 1, formato: 'moneda' },
  { key: '__pers_total',    label: 'TOTAL PERSONAL',                    tipo: 'calculada', depth: 0, formato: 'moneda' },
  { key: '_kpi_labor',      label: '↸ Labor Cost %',                   tipo: 'kpi',       depth: 1, formato: 'porcentaje', benchmark: '30-38%' },
  { key: '__prime_cost',    label: 'PRIME COST',                        tipo: 'calculada', depth: 0, formato: 'moneda' },
  { key: '_kpi_prime',      label: '↸ Prime Cost %',                   tipo: 'kpi',       depth: 1, formato: 'porcentaje', benchmark: '55-65%' },
  { key: '_esp3',           label: '',                                   tipo: 'espacio',   depth: 0 },

  { key: 'gastos_op',       label: 'GASTOS OPERATIVOS',                tipo: 'auto',      depth: 0, formato: 'moneda' },
  { key: '_kpi_gastosop',   label: '↸ Gastos Op. %',                   tipo: 'kpi',       depth: 1, formato: 'porcentaje', benchmark: '10-18%' },
  { key: 'impuestos_op',    label: 'Impuestos y Tasas',                tipo: 'auto',      depth: 1, formato: 'moneda' },
  { key: '_esp4',           label: '',                                   tipo: 'espacio',   depth: 0 },

  { key: '_iva',            label: 'POSICIÓN IVA',                      tipo: 'seccion',   depth: 0 },
  { key: '__iva_debito_d',  label: 'IVA Débito (ventas)',              tipo: 'calculada', depth: 1, formato: 'moneda' },
  { key: 'iva_credito',     label: 'IVA Crédito (compras c/factura)',  tipo: 'manual',    depth: 1, formato: 'moneda' },
  { key: '__iva_saldo',     label: 'Saldo fiscal del mes',             tipo: 'calculada', depth: 1, formato: 'moneda' },
  { key: '_esp5',           label: '',                                   tipo: 'espacio',   depth: 0 },

  { key: '__ebitda',        label: 'EBITDA',                            tipo: 'calculada', depth: 0, formato: 'moneda' },
  { key: '_kpi_ebitda',     label: '↸ EBITDA %',                       tipo: 'kpi',       depth: 1, formato: 'porcentaje', benchmark: '> 12%' },
  { key: 'amortizaciones',  label: '(-) Amortizaciones',               tipo: 'auto',      depth: 1, formato: 'moneda' },
  { key: '__ebit',          label: 'EBIT',                              tipo: 'calculada', depth: 0, formato: 'moneda' },
  { key: '_esp6',           label: '',                                   tipo: 'espacio',   depth: 0 },

  { key: '_fin',            label: 'RESULTADO FINANCIERO',              tipo: 'seccion',   depth: 0 },
  { key: 'fin_intereses',   label: 'Intereses',                        tipo: 'auto',      depth: 1, formato: 'moneda' },
  { key: 'fin_arca',        label: 'Regularización ARCA',              tipo: 'manual',    depth: 1, formato: 'moneda' },
  { key: 'fin_prestamo',    label: 'Préstamo',                         tipo: 'manual',    depth: 1, formato: 'moneda' },
  { key: '__fin_total',     label: 'TOTAL FINANCIERO',                 tipo: 'calculada', depth: 0, formato: 'moneda' },
  { key: '_esp7',           label: '',                                   tipo: 'espacio',   depth: 0 },

  { key: '__rdo_antes',     label: 'RDO. ANTES GANANCIAS',             tipo: 'calculada', depth: 0, formato: 'moneda' },
  { key: 'anticipo_gcias',  label: '(-) Anticipo Ganancias',          tipo: 'manual',    depth: 1, formato: 'moneda' },
  { key: '__rdo_neto',      label: 'RESULTADO NETO',                   tipo: 'calculada', depth: 0, formato: 'moneda' },
  { key: '_kpi_margen',     label: '↸ Margen Neto %',                  tipo: 'kpi',       depth: 1, formato: 'porcentaje', benchmark: '> 5%' },
]

// ── cálculos ──────────────────────────────────────────────────────────────────
interface AutoMes {
  ingBruto: number; ivaDebito: number; ivaCredito: number; ticketCount: number
  cmvAlimentos: number; cmvBebidas: number; cmvIndirectos: number
  gastosOp: number; gastosRrhh: number; impuestosOp: number; inversiones: number; intereses: number
  sueldos: number; cargasSociales: number; amortizaciones: number; difArqueo: number
}

function computarMes(manual: Map<string, number>, auto: AutoMes): Map<string, number> {
  const m = (k: string) => manual.get(k) ?? 0
  const { ingBruto, ivaDebito, ticketCount } = auto

  // CMV: auto desde gastos Fudo, override manual si el usuario cargó algo
  const cmvAlimentos  = manual.has('cmv_alimentos')  ? m('cmv_alimentos')  : auto.cmvAlimentos
  const cmvBebidas    = manual.has('cmv_bebidas')    ? m('cmv_bebidas')    : auto.cmvBebidas
  const cmvIndirectos = manual.has('cmv_indirectos') ? m('cmv_indirectos') : auto.cmvIndirectos
  const gastosOp      = manual.has('gastos_op')      ? m('gastos_op')      : auto.gastosOp
  const impuestosOp   = manual.has('impuestos_op')   ? m('impuestos_op')   : auto.impuestosOp
  const finIntereses  = manual.has('fin_intereses')  ? m('fin_intereses')  : auto.intereses

  // Personal: auto desde gastos Fudo, override manual
  const persSueldos = manual.has('pers_sueldos') ? m('pers_sueldos') : auto.sueldos
  const persCargas  = manual.has('pers_cargas')  ? m('pers_cargas')  : auto.cargasSociales

  // Diferencias de arqueo: auto desde cierres de caja, override manual
  const difArqueo = manual.has('dif_arqueo') ? m('dif_arqueo') : auto.difArqueo

  // IVA real desde Ventas Fiscales (sumado por ticket al importar)
  const ingNeto    = ingBruto + difArqueo - ivaDebito
  const cmvTotal   = cmvAlimentos + cmvBebidas + cmvIndirectos
  const margenBruto = ingNeto - cmvTotal
  const persTotal  = persSueldos + persCargas
  const primeCost  = cmvTotal + persTotal
  const amortizaciones = manual.has('amortizaciones') ? m('amortizaciones') : auto.amortizaciones
  const ebitda     = margenBruto - persTotal - gastosOp - impuestosOp
  const ebit       = ebitda - amortizaciones
  const finTotal   = -(finIntereses + m('fin_arca') + m('fin_prestamo'))
  const rdoAntes   = ebit + finTotal
  const rdoNeto    = rdoAntes - m('anticipo_gcias')

  const result = new Map<string, number>(manual)
  result.set('ing_bruto',       ingBruto)
  result.set('dif_arqueo',      difArqueo)
  result.set('iva_debito',      ivaDebito)
  result.set('__ing_netos',     ingNeto)
  result.set('__ticket_prom',   ticketCount > 0 ? ingBruto / ticketCount : 0)
  // Cortesías y otros descuentos (informativos — se guardan en edr_partidas al importar)
  result.set('__cortesias_info', m('cortesias_monto'))
  result.set('__otros_desc',     m('otros_descuentos'))
  result.set('cmv_alimentos',   cmvAlimentos)
  result.set('cmv_bebidas',     cmvBebidas)
  result.set('cmv_indirectos',  cmvIndirectos)
  result.set('__cmv_total',     cmvTotal)
  result.set('__margen_bruto',  margenBruto)
  result.set('_kpi_food',       ingNeto > 0 ? cmvTotal / ingNeto : 0)
  result.set('pers_sueldos',   persSueldos)
  result.set('pers_cargas',    persCargas)
  result.set('__pers_total',    persTotal)
  result.set('_kpi_labor',      ingNeto > 0 ? persTotal / ingNeto : 0)
  result.set('__prime_cost',    primeCost)
  result.set('_kpi_prime',      ingNeto > 0 ? primeCost / ingNeto : 0)
  result.set('gastos_op',       gastosOp)
  result.set('impuestos_op',   impuestosOp)
  result.set('fin_intereses',  finIntereses)
  result.set('_kpi_gastosop',  ingNeto > 0 ? gastosOp / ingNeto : 0)
  // iva_credito: manual si el usuario lo cargó, sino auto desde gastos
  const ivaCredito = manual.has('iva_credito') ? m('iva_credito') : auto.ivaCredito
  result.set('iva_credito',     ivaCredito)
  result.set('__iva_debito_d',  ivaDebito)
  result.set('__iva_saldo',     ivaCredito - ivaDebito)
  result.set('__ebitda',        ebitda)
  result.set('_kpi_ebitda',     ingNeto > 0 ? ebitda / ingNeto : 0)
  result.set('amortizaciones',  amortizaciones)
  result.set('__ebit',          ebit)
  result.set('__fin_total',     finTotal)
  result.set('__rdo_antes',     rdoAntes)
  result.set('__rdo_neto',      rdoNeto)
  result.set('_kpi_margen',     ingNeto > 0 ? rdoNeto / ingNeto : 0)
  return result
}

function semaforo(key: string, v: number): 'verde' | 'amarillo' | 'rojo' | null {
  switch (key) {
    case '_kpi_food':     return v >= 0.25 && v <= 0.32 ? 'verde' : v < 0.25 ? 'amarillo' : 'rojo'
    case '_kpi_labor':    return v <= 0.30 ? 'amarillo' : v <= 0.38 ? 'verde' : 'rojo'
    case '_kpi_prime':    return v <= 0.55 ? 'amarillo' : v <= 0.65 ? 'verde' : 'rojo'
    case '_kpi_gastosop': return v <= 0.10 ? 'amarillo' : v <= 0.18 ? 'verde' : 'rojo'
    case '_kpi_ebitda':   return v >= 0.12 ? 'verde' : v >= 0.05 ? 'amarillo' : 'rojo'
    case '_kpi_margen':   return v >= 0.05 ? 'verde' : v >= 0 ? 'amarillo' : 'rojo'
    default: return null
  }
}

function formatValor(v: number, formato?: Formato): string {
  if (formato === 'porcentaje') return v !== 0 ? `${(v * 100).toFixed(1)}%` : '—'
  if (formato === 'cantidad')   return v !== 0 ? v.toLocaleString('es-AR', { maximumFractionDigits: 0 }) : '—'
  return v !== 0 ? formatARS(v) : '—'
}

// ── componente ────────────────────────────────────────────────────────────────
export function EstadoResultados({ embedded = false }: { embedded?: boolean } = {}) {
  const [año,       setAño]       = useState(() => String(new Date().getFullYear()))
  const [localEdr,  setLocalEdr]  = useState<'vedia' | 'saavedra' | 'consolidado'>('vedia')
  const locales: ('vedia' | 'saavedra')[] = localEdr === 'consolidado' ? ['vedia', 'saavedra'] : [localEdr]
  const esConsolidado = localEdr === 'consolidado'
  const [editando,  setEditando]  = useState<{ periodo: string; key: string } | null>(null)
  const [valorEdit, setValorEdit] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()

  // ── helpers para queries multi-local ────────────────────────────────────────
  type TicketRow = { periodo: string; ing_bruto: number; iva_debito: number; ticket_count: number }
  type GastoIvaRow = { periodo: string; iva: number }
  type GastoResRow = { periodo: string; cmv_alimentos: number; cmv_bebidas: number; cmv_indirectos: number; gastos_op: number; gastos_rrhh: number; impuestos_op: number; inversiones: number; intereses: number; sueldos: number; cargas_sociales: number }
  type AmortRow = { periodo: string; total_amort: number }
  type PartidaRow = { periodo: string; concepto: string; monto: number }

  function mergeByPeriodo<T extends { periodo: string }>(arrays: T[][], numKeys: (keyof T)[]): T[] {
    const map = new Map<string, T>()
    for (const arr of arrays) {
      for (const row of arr) {
        const existing = map.get(row.periodo)
        if (existing) {
          const e = existing as unknown as Record<string, number>
          const r = row as unknown as Record<string, number>
          for (const k of numKeys) e[k as string] = (e[k as string] ?? 0) + (r[k as string] ?? 0)
        } else {
          map.set(row.periodo, { ...row })
        }
      }
    }
    return [...map.values()].sort((a, b) => a.periodo.localeCompare(b.periodo))
  }

  // ── queries ────────────────────────────────────────────────────────────────
  const { data: ticketsRaw } = useQuery({
    queryKey: ['edr_tickets', año, localEdr],
    queryFn: async () => {
      const results = await Promise.all(locales.map(async (loc) => {
        const { data, error } = await supabase.rpc('edr_resumen_ventas', { p_local: loc, p_anio: año })
        if (error) { console.error('[edr_resumen_ventas]', error); return [] }
        return (data ?? []) as TicketRow[]
      }))
      return esConsolidado ? mergeByPeriodo(results, ['ing_bruto', 'iva_debito', 'ticket_count']) : results[0]
    },
  })

  const { data: gastosIvaRaw } = useQuery({
    queryKey: ['edr_gastos_iva', año, localEdr],
    queryFn: async () => {
      const results = await Promise.all(locales.map(async (loc) => {
        const { data } = await supabase
          .from('gastos')
          .select('periodo, iva')
          .eq('local', loc)
          .gte('periodo', `${año}-01`)
          .lte('periodo', `${año}-12`)
          .neq('cancelado', true)
        return (data ?? []) as GastoIvaRow[]
      }))
      return results.flat()
    },
  })

  const { data: gastosResumen } = useQuery({
    queryKey: ['edr_gastos_resumen', año, localEdr],
    queryFn: async () => {
      const results = await Promise.all(locales.map(async (loc) => {
        const { data, error } = await supabase.rpc('edr_resumen_gastos', { p_local: loc, p_anio: año })
        if (error) { console.error('[edr_resumen_gastos]', error); return [] }
        return (data ?? []) as GastoResRow[]
      }))
      return esConsolidado
        ? mergeByPeriodo(results, ['cmv_alimentos', 'cmv_bebidas', 'cmv_indirectos', 'gastos_op', 'gastos_rrhh', 'impuestos_op', 'inversiones', 'intereses', 'sueldos', 'cargas_sociales'])
        : results[0]
    },
  })

  const { data: amortRaw } = useQuery({
    queryKey: ['edr_amortizaciones', año, localEdr],
    queryFn: async () => {
      const results = await Promise.all(locales.map(async (loc) => {
        const { data, error } = await supabase.rpc('amort_resumen_anual', { p_local: loc, p_anio: año })
        if (error) { console.error('[amort_resumen_anual]', error); return [] }
        return (data ?? []) as AmortRow[]
      }))
      return esConsolidado ? mergeByPeriodo(results, ['total_amort']) : results[0]
    },
  })

  const { data: arqueosRaw } = useQuery({
    queryKey: ['edr_arqueos', año, localEdr],
    queryFn: async () => {
      const results = await Promise.all(locales.map(async (loc) => {
        const { data } = await supabase
          .from('cierres_caja')
          .select('fecha, diferencia')
          .eq('local', loc)
          .gte('fecha', `${año}-01-01`)
          .lte('fecha', `${año}-12-31`)
        // Agrupar por periodo (YYYY-MM)
        const porMes = new Map<string, number>()
        for (const r of data ?? []) {
          const p = (r.fecha as string).substring(0, 7)
          porMes.set(p, (porMes.get(p) ?? 0) + Number(r.diferencia ?? 0))
        }
        return [...porMes.entries()].map(([periodo, dif_total]) => ({ periodo, dif_total }))
      }))
      return esConsolidado ? mergeByPeriodo(results, ['dif_total']) : results[0]
    },
  })

  const { data: partidasRaw } = useQuery({
    queryKey: ['edr_partidas', año, localEdr],
    queryFn: async () => {
      const results = await Promise.all(locales.map(async (loc) => {
        const { data } = await supabase
          .from('edr_partidas')
          .select('periodo, concepto, monto')
          .eq('local', loc)
          .gte('periodo', `${año}-01`)
          .lte('periodo', `${año}-12`)
        return (data ?? []) as PartidaRow[]
      }))
      return results.flat()
    },
  })

  // ── derivar datos por mes ─────────────────────────────────────────────────
  const EMPTY_AUTO: AutoMes = {
    ingBruto: 0, ivaDebito: 0, ivaCredito: 0, ticketCount: 0,
    cmvAlimentos: 0, cmvBebidas: 0, cmvIndirectos: 0,
    gastosOp: 0, gastosRrhh: 0, impuestosOp: 0, inversiones: 0, intereses: 0,
    sueldos: 0, cargasSociales: 0, amortizaciones: 0, difArqueo: 0,
  }

  const autoMap = useMemo(() => {
    // Acumular IVA crédito por periodo (desde gastos)
    const ivaCreditoMap = new Map<string, number>()
    for (const g of gastosIvaRaw ?? []) {
      ivaCreditoMap.set(g.periodo, (ivaCreditoMap.get(g.periodo) ?? 0) + Number(g.iva))
    }

    // Gastos agrupados por periodo
    const gastosMap = new Map<string, typeof gastosResumen extends (infer T)[] | null | undefined ? T : never>()
    for (const g of gastosResumen ?? []) {
      gastosMap.set(g.periodo, g)
    }

    const map = new Map<string, AutoMes>()
    // Poblar desde tickets
    for (const t of ticketsRaw ?? []) {
      const g = gastosMap.get(t.periodo)
      map.set(t.periodo, {
        ingBruto:      Number(t.ing_bruto),
        ivaDebito:     Number(t.iva_debito),
        ivaCredito:    ivaCreditoMap.get(t.periodo) ?? 0,
        ticketCount:   Number(t.ticket_count),
        cmvAlimentos:  Number(g?.cmv_alimentos ?? 0),
        cmvBebidas:    Number(g?.cmv_bebidas ?? 0),
        cmvIndirectos: Number(g?.cmv_indirectos ?? 0),
        gastosOp:      Number(g?.gastos_op ?? 0),
        gastosRrhh:    Number(g?.gastos_rrhh ?? 0),
        impuestosOp:   Number(g?.impuestos_op ?? 0),
        inversiones:   Number(g?.inversiones ?? 0),
        intereses:     Number(g?.intereses ?? 0),
        sueldos:       Number(g?.sueldos ?? 0),
        cargasSociales: Number(g?.cargas_sociales ?? 0),
        amortizaciones: 0,
        difArqueo: 0,
      })
    }
    // Periodos solo con gastos (sin tickets)
    for (const g of gastosResumen ?? []) {
      if (!map.has(g.periodo)) {
        map.set(g.periodo, {
          ...EMPTY_AUTO,
          ivaCredito:    ivaCreditoMap.get(g.periodo) ?? 0,
          cmvAlimentos:  Number(g.cmv_alimentos),
          cmvBebidas:    Number(g.cmv_bebidas),
          cmvIndirectos: Number(g.cmv_indirectos),
          gastosOp:      Number(g.gastos_op),
          gastosRrhh:    Number(g.gastos_rrhh),
          impuestosOp:   Number(g.impuestos_op),
          inversiones:   Number(g.inversiones),
          intereses:     Number(g.intereses),
          sueldos:       Number(g.sueldos),
          cargasSociales: Number(g.cargas_sociales),
        })
      }
    }
    // Periodos solo con IVA crédito
    for (const [periodo, iva] of ivaCreditoMap) {
      if (!map.has(periodo)) map.set(periodo, { ...EMPTY_AUTO, ivaCredito: iva })
    }
    // Amortizaciones auto desde tabla amortizaciones
    for (const a of amortRaw ?? []) {
      const existing = map.get(a.periodo)
      if (existing) {
        existing.amortizaciones = Number(a.total_amort)
      } else {
        map.set(a.periodo, { ...EMPTY_AUTO, amortizaciones: Number(a.total_amort) })
      }
    }
    // Diferencias de arqueo desde cierres de caja
    for (const a of arqueosRaw ?? []) {
      const existing = map.get(a.periodo)
      if (existing) {
        existing.difArqueo = Number(a.dif_total)
      } else {
        map.set(a.periodo, { ...EMPTY_AUTO, difArqueo: Number(a.dif_total) })
      }
    }
    return map
  }, [ticketsRaw, gastosIvaRaw, gastosResumen, amortRaw, arqueosRaw])

  const manualMap = useMemo(() => {
    const map = new Map<string, Map<string, number>>()
    for (const p of partidasRaw ?? []) {
      if (!map.has(p.periodo)) map.set(p.periodo, new Map())
      map.get(p.periodo)!.set(p.concepto, Number(p.monto))
    }
    return map
  }, [partidasRaw])

  // Meses a mostrar (los 12 del año para que siempre se pueda editar)
  const meses = useMemo(
    () => Array.from({ length: 12 }, (_, i) => `${año}-${String(i + 1).padStart(2, '0')}`),
    [año]
  )

  // Calcular valores completos por mes
  const valoresPorMes = useMemo(() => {
    const result = new Map<string, Map<string, number>>()
    for (const mes of meses) {
      const auto   = autoMap.get(mes) ?? EMPTY_AUTO
      const manual = manualMap.get(mes) ?? new Map()
      result.set(mes, computarMes(manual, auto))
    }
    return result
  }, [meses, autoMap, manualMap])

  // ACUM: suma mes a mes (los %, se recalculan al final)
  const valoresAcum = useMemo(() => {
    const acum = new Map<string, number>()
    for (const [, mv] of valoresPorMes) {
      for (const [k, v] of mv) {
        if (!k.startsWith('_kpi_')) acum.set(k, (acum.get(k) ?? 0) + v)
      }
    }
    // recalcular KPIs del acumulado
    const ingNeto = acum.get('__ing_netos') ?? 0
    if (ingNeto > 0) {
      acum.set('_kpi_food',     (acum.get('__cmv_total')  ?? 0) / ingNeto)
      acum.set('_kpi_labor',    (acum.get('__pers_total') ?? 0) / ingNeto)
      acum.set('_kpi_prime',    (acum.get('__prime_cost') ?? 0) / ingNeto)
      acum.set('_kpi_gastosop', (acum.get('gastos_op')    ?? 0) / ingNeto)
      acum.set('_kpi_ebitda',   (acum.get('__ebitda')     ?? 0) / ingNeto)
      acum.set('_kpi_margen',   (acum.get('__rdo_neto')   ?? 0) / ingNeto)
    }
    return acum
  }, [valoresPorMes])

  // Meses con algún dato (para pintar diferente)
  const mesesConDatos = useMemo(() => {
    const con = new Set<string>()
    for (const mes of meses) {
      const auto = autoMap.get(mes)
      const manual = manualMap.get(mes)
      if ((auto?.ingBruto ?? 0) > 0 || (manual && manual.size > 0)) con.add(mes)
    }
    return con
  }, [meses, autoMap, manualMap])

  // ── edición inline ─────────────────────────────────────────────────────────
  function startEdit(periodo: string, key: string, valorActual: number) {
    setEditando({ periodo, key })
    setValorEdit(valorActual !== 0 ? String(Math.abs(valorActual)).replace('.', ',') : '')
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  async function guardar() {
    if (!editando) return
    const raw = valorEdit.trim().replace(/\./g, '').replace(',', '.')
    const monto = parseFloat(raw) || 0
    await supabase.from('edr_partidas').upsert(
      { local: localEdr, periodo: editando.periodo, concepto: editando.key, monto },
      { onConflict: 'local,periodo,concepto' }
    )
    qc.invalidateQueries({ queryKey: ['edr_partidas', año, localEdr] })
    setEditando(null)
  }

  function cancelar() { setEditando(null) }

  // ── render ─────────────────────────────────────────────────────────────────
  const inner = (
    <>
      {/* Filtros */}
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        <LocalSelector
          value={localEdr}
          onChange={(v) => setLocalEdr(v as 'vedia' | 'saavedra' | 'consolidado')}
          options={['vedia', 'saavedra', 'consolidado']}
        />
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-500">Año</label>
          <input
            type="number" min="2020" max="2099"
            value={año} onChange={(e) => setAño(e.target.value)}
            className="w-24 border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-rodziny-500"
          />
        </div>
        <span className="text-xs text-gray-400 ml-auto">Clic en celda azul para editar · Enter para guardar · Esc para cancelar</span>
      </div>

      {/* Tabla EdR */}
      <div className="bg-white rounded-lg border border-surface-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="sticky left-0 bg-gray-50 px-4 py-3 text-left text-xs font-semibold text-gray-600 min-w-[240px] z-10">CONCEPTO</th>
                {meses.map((mes) => (
                  <th key={mes} className={cn(
                    'px-3 py-3 text-right text-xs font-semibold min-w-[110px]',
                    mesesConDatos.has(mes) ? 'text-gray-700' : 'text-gray-300'
                  )}>
                    {MESES_LABEL[parseInt(mes.substring(5, 7)) - 1]}
                  </th>
                ))}
                <th className="px-3 py-3 text-right text-xs font-semibold text-rodziny-700 min-w-[120px] border-l border-gray-200">ACUM</th>
                <th className="px-3 py-3 text-center text-xs font-semibold text-gray-400 min-w-[80px]">Ref.</th>
              </tr>
            </thead>
            <tbody>
              {FILAS.map((fila) => {
                if (fila.tipo === 'espacio') return (
                  <tr key={fila.key}><td colSpan={14} className="h-2" /></tr>
                )

                const esSeccion   = fila.tipo === 'seccion'
                const esTotal     = fila.tipo === 'calculada' && fila.depth === 0
                const esKpi       = fila.tipo === 'kpi'
                const esManual    = fila.tipo === 'manual'

                return (
                  <tr
                    key={fila.key}
                    className={cn(
                      'border-b border-gray-50',
                      esSeccion && 'bg-gray-900',
                      esTotal   && 'bg-gray-50 font-semibold',
                      esKpi     && 'bg-transparent',
                      !esSeccion && !esTotal && 'hover:bg-gray-50'
                    )}
                  >
                    {/* Label */}
                    <td className={cn(
                      'sticky left-0 px-4 py-2 z-10',
                      esSeccion ? 'bg-gray-900 text-white font-bold text-xs uppercase tracking-wider' : 'bg-white',
                      esTotal   && '!bg-gray-50',
                      esKpi     && 'text-gray-500 italic text-xs',
                      fila.depth === 1 && !esKpi && 'pl-8 text-gray-700',
                      fila.depth === 2 && 'pl-12 text-gray-600',
                      fila.depth === 0 && !esSeccion && !esTotal && 'font-medium text-gray-800',
                    )}
                      style={esSeccion ? {} : { backgroundColor: esTotal ? '#f9fafb' : 'white' }}
                    >
                      {esSeccion ? fila.label : (
                        <span className={cn(esKpi && 'text-gray-400',
                          (fila.key === '__cortesias_info' || fila.key === '__otros_desc') && 'text-gray-400 italic text-xs'
                        )}>
                          {fila.label}
                          {fila.key === '__cortesias_info' || fila.key === '__otros_desc' ? (
                            <span className="text-gray-300 ml-1">(informativo)</span>
                          ) : null}
                        </span>
                      )}
                    </td>

                    {/* Celdas por mes */}
                    {meses.map((mes) => {
                      if (esSeccion) return <td key={mes} className="bg-gray-900" />

                      const valores = valoresPorMes.get(mes) ?? new Map()
                      const valor   = valores.get(fila.key) ?? 0
                      const estaEditando = editando?.periodo === mes && editando?.key === fila.key
                      const color   = esKpi ? semaforo(fila.key, valor) : null
                      const sinDatos = !mesesConDatos.has(mes)

                      return (
                        <td
                          key={mes}
                          className={cn(
                            'px-3 py-2 text-right',
                            esManual && !sinDatos && 'cursor-pointer hover:bg-blue-50 hover:text-blue-700',
                            esManual && sinDatos  && 'cursor-pointer hover:bg-blue-50 opacity-40 hover:opacity-100',
                            esTotal   && 'font-semibold',
                            esKpi && color === 'verde'    && 'text-green-700 font-medium',
                            esKpi && color === 'amarillo' && 'text-yellow-600 font-medium',
                            esKpi && color === 'rojo'     && 'text-red-600 font-medium',
                            !esKpi && valor < 0 && 'text-red-600',
                            !esKpi && valor > 0 && !esManual && !esTotal && fila.depth === 0 && 'text-gray-900',
                            !esKpi && esManual && valor !== 0 && 'text-blue-700',
                          )}
                          onClick={() => esManual && !esConsolidado && startEdit(mes, fila.key, valor)}
                        >
                          {estaEditando ? (
                            <input
                              ref={inputRef}
                              value={valorEdit}
                              onChange={(e) => setValorEdit(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') guardar()
                                if (e.key === 'Escape') cancelar()
                              }}
                              onBlur={guardar}
                              className="w-full text-right bg-blue-50 border border-blue-400 rounded px-1 py-0.5 text-sm outline-none"
                              placeholder="0"
                            />
                          ) : (
                            <span className="text-xs">
                              {valor !== 0 ? formatValor(valor, fila.formato) : (esManual ? <span className="text-gray-200">—</span> : '—')}
                            </span>
                          )}
                        </td>
                      )
                    })}

                    {/* ACUM */}
                    {esSeccion ? (
                      <td className="bg-gray-900 border-l border-gray-700" />
                    ) : (
                      <td className={cn(
                        'px-3 py-2 text-right border-l border-gray-100',
                        esTotal && 'font-semibold bg-rodziny-50',
                        esKpi && 'bg-green-50',
                      )}>
                        {(() => {
                          const v = valoresAcum.get(fila.key) ?? 0
                          const color = esKpi ? semaforo(fila.key, v) : null
                          return (
                            <span className={cn(
                              'text-xs font-medium',
                              esKpi && color === 'verde'    && 'text-green-700',
                              esKpi && color === 'amarillo' && 'text-yellow-600',
                              esKpi && color === 'rojo'     && 'text-red-600',
                              !esKpi && v < 0 && 'text-red-600',
                              esTotal && 'text-rodziny-800',
                            )}>
                              {v !== 0 ? formatValor(v, fila.formato) : '—'}
                            </span>
                          )
                        })()}
                      </td>
                    )}

                    {/* Benchmark */}
                    <td className="px-3 py-2 text-center text-xs text-gray-300">
                      {fila.benchmark ?? ''}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-3 text-xs text-gray-400">
        Ingresos Brutos e IVA Débito se calculan automáticamente desde los tickets importados de Fudo.
        Cortesías y descuentos son informativos (ya incluidos en la venta bruta por Fudo).
        El resto de las celdas (azules) son editables — hacé clic para ingresar el valor.
      </p>
    </>
  )

  if (embedded) return inner
  return (
    <PageContainer title="Estado de Resultados" subtitle="Mensual por local — edición inline">
      {inner}
    </PageContainer>
  )
}
