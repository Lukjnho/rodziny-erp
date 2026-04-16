import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { LocalSelector } from '@/components/ui/LocalSelector'
import { formatARS, formatFecha, cn } from '@/lib/utils'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

// ── tipos ────────────────────────────────────────────────────────────────────

interface MovBancario {
  id: string; cuenta: string; fecha: string; descripcion: string
  debito: number; credito: number; saldo: number | null
  categoria: string | null; local: string; referencia: string
  es_transferencia_interna: boolean
}

interface CierreVerificado {
  id: string; local: string; fecha: string; turno: string; caja: string | null
  monto_contado: number; monto_esperado: number | null; diferencia: number | null
  retiro: number; fondo_apertura: number; fondo_siguiente: number
  verificado: boolean; verificado_por: string | null
}

interface GastoPagado {
  id: string; local: string; fecha: string; proveedor: string | null
  categoria: string | null; subcategoria: string | null
  importe_total: number; medio_pago: string | null
  categoria_id: string | null
}

interface PagoRealizado {
  id: string
  gasto_id: string
  fecha_pago: string
  monto: number
  medio_pago: string
  // datos del gasto asociado
  gasto: {
    local: string
    proveedor: string | null
    categoria: string | null
    subcategoria: string | null
    categoria_id: string | null
  } | null
}

interface CategoriaGasto {
  id: string; nombre: string; parent_id: string | null; tipo_edr: string
}

interface Dividendo {
  id: string; socio: string; fecha: string; monto: number
  medio_pago: string; concepto: string | null; local: string | null; periodo: string
}

interface PagoMP {
  id: number; fecha: string; monto: number; monto_neto: number
  comision_mp: number; impuestos: number; medio_pago: string
  local: string; periodo: string
}

const MEDIO_PAGO_MP_LABEL: Record<string, string> = {
  account_money: 'QR / Saldo MP',
  debit_card: 'Tarjeta débito',
  credit_card: 'Tarjeta crédito',
  bank_transfer: 'Transferencia bancaria',
  prepaid_card: 'Tarjeta prepaga',
}

// ── constantes ───────────────────────────────────────────────────────────────

const SOCIOS = ['lucas', 'karina', 'francisco'] as const
const SOCIO_LABEL: Record<string, string> = { lucas: 'Lucas', karina: 'Karina', francisco: 'Francisco' }

const MEDIOS_PAGO_DIV = [
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'transferencia_mp', label: 'Transferencia (MP)' },
  { value: 'cheque_galicia', label: 'Cheque (Galicia)' },
  { value: 'tarjeta_icbc', label: 'Tarjeta (ICBC)' },
]

const GRUPO_EGRESO_LABEL: Record<string, string> = {
  cmv: 'Costos de mercadería (CMV)',
  gastos_op: 'Gastos operativos',
  rrhh: 'RRHH (sueldos y cargas)',
  impuestos: 'Impuestos y Tasas',
  inversiones: 'Inversiones',
  intereses: 'Intereses / Comisiones financieras',
  dividendos: 'Dividendos (retiros de socios)',
  otros: 'Otros egresos',
}

// Sub-labels para débitos bancarios
const GRUPO_DEBITO_LABEL: Record<string, string> = {
  mercadopago: 'MercadoPago (comisiones y retenciones)',
  galicia: 'Galicia (cheques, débitos automáticos, impuestos)',
  icbc: 'ICBC (Visa, impuestos, comisiones)',
}

function tipoEdrAGrupo(tipo: string | null): string {
  if (!tipo) return 'otros'
  if (tipo.startsWith('cmv_')) return 'cmv'
  if (tipo === 'gastos_op') return 'gastos_op'
  if (tipo === 'sueldos' || tipo === 'cargas_sociales' || tipo === 'gastos_rrhh') return 'rrhh'
  if (tipo === 'impuestos_op') return 'impuestos'
  if (tipo === 'inversiones') return 'inversiones'
  if (tipo === 'intereses') return 'intereses'
  return 'otros'
}

// Patrones para movimientos de capital (cuenta comitente)
const PATRONES_CAPITAL = [
  /invertironline/i,
  /invertir\s*online/i,
  /cuenta\s*comitente/i,
  /bull\s*market/i,
  /iol\s*inversiones/i,
]

function esMovCapital(m: MovBancario): boolean {
  return PATRONES_CAPITAL.some((p) => p.test(m.descripcion ?? ''))
}

// ── componente principal ─────────────────────────────────────────────────────

export function FlujoCaja() {
  const qc = useQueryClient()
  const [local, setLocal] = useState<'ambos' | 'vedia' | 'saavedra'>('ambos')
  const [periodo, setPeriodo] = useState(() => new Date().toISOString().substring(0, 7))
  const [ingresosOpen, setIngresosOpen] = useState(true)
  const [egresosOpen, setEgresosOpen] = useState(true)
  const [dividendosOpen, setDividendosOpen] = useState(false)
  const [noOperativoOpen, setNoOperativoOpen] = useState(false)
  const [showDivForm, setShowDivForm] = useState(false)

  // Sync MP state
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<{ ok: boolean; sincronizados?: number; error?: string } | null>(null)

  // Form dividendo
  const [divSocio, setDivSocio] = useState<string>('lucas')
  const [divFecha, setDivFecha] = useState(() => new Date().toISOString().split('T')[0])
  const [divMonto, setDivMonto] = useState('')
  const [divMedio, setDivMedio] = useState('efectivo')
  const [divConcepto, setDivConcepto] = useState('')
  const [divLocal, setDivLocal] = useState<string>('')

  // ── queries ──────────────────────────────────────────────────────────────────

  const { data: movimientos } = useQuery({
    queryKey: ['fc_movimientos', periodo],
    queryFn: async () => {
      const { data } = await supabase
        .from('movimientos_bancarios').select('*')
        .eq('periodo', periodo)
        .order('fecha', { ascending: true })
      return (data ?? []) as MovBancario[]
    },
  })

  const { data: cierres } = useQuery({
    queryKey: ['fc_cierres', periodo],
    queryFn: async () => {
      const [y, m] = periodo.split('-').map(Number)
      const lastDay = new Date(y, m, 0).getDate()
      const { data } = await supabase
        .from('cierres_caja').select('*')
        .gte('fecha', `${periodo}-01`)
        .lte('fecha', `${periodo}-${lastDay}`)
        .order('fecha', { ascending: true })
      return (data ?? []) as CierreVerificado[]
    },
  })

  // Pagos reales: fecha de pago es cuando salió la plata (no la fecha del comprobante)
  const { data: pagosRealizados } = useQuery({
    queryKey: ['fc_pagos', periodo],
    queryFn: async () => {
      const [y, m] = periodo.split('-').map(Number)
      const lastDay = new Date(y, m, 0).getDate()
      const { data } = await supabase
        .from('pagos_gastos')
        .select('id, gasto_id, fecha_pago, monto, medio_pago, gasto:gastos(local, proveedor, categoria, subcategoria, categoria_id)')
        .gte('fecha_pago', `${periodo}-01`)
        .lte('fecha_pago', `${periodo}-${lastDay}`)
      return (data ?? []) as unknown as PagoRealizado[]
    },
  })

  const { data: categorias } = useQuery({
    queryKey: ['categorias_gasto_fc'],
    queryFn: async () => {
      const { data } = await supabase.from('categorias_gasto').select('id, nombre, parent_id, tipo_edr')
      return (data ?? []) as CategoriaGasto[]
    },
  })

  const { data: dividendos } = useQuery({
    queryKey: ['fc_dividendos', periodo],
    queryFn: async () => {
      const { data } = await supabase
        .from('dividendos').select('*')
        .eq('periodo', periodo)
        .order('fecha', { ascending: false })
      return (data ?? []) as Dividendo[]
    },
  })

  // Pagos MP (API sync)
  const { data: pagosMP } = useQuery({
    queryKey: ['fc_pagos_mp', periodo],
    queryFn: async () => {
      const { data } = await supabase
        .from('pagos_mp')
        .select('id, fecha, monto, monto_neto, comision_mp, impuestos, medio_pago, local, periodo')
        .eq('periodo', periodo)
        .eq('estado', 'approved')
      return (data ?? []) as PagoMP[]
    },
  })

  // ── sync MP ────────────────────────────────────────────────────────────────
  const sincronizarMP = async () => {
    setSyncing(true)
    setSyncResult(null)
    try {
      const { data, error } = await supabase.functions.invoke('sync-mercadopago', {
        body: { periodo },
      })
      if (error) throw error
      setSyncResult(data)
      qc.invalidateQueries({ queryKey: ['fc_pagos_mp'] })
    } catch (e) {
      setSyncResult({ ok: false, error: (e as Error).message })
    } finally {
      setSyncing(false)
    }
  }

  // ── mutation: dividendo ────────────────────────────────────────────────────

  const guardarDiv = useMutation({
    mutationFn: async () => {
      const monto = parseFloat(divMonto.replace(/\./g, '').replace(',', '.'))
      if (!monto || monto <= 0) throw new Error('Monto inválido')
      const { error } = await supabase.from('dividendos').insert({
        socio: divSocio, fecha: divFecha, monto, medio_pago: divMedio,
        concepto: divConcepto || null, local: divLocal || null,
        periodo, creado_por: 'Admin',
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fc_dividendos'] })
      setShowDivForm(false)
      setDivMonto(''); setDivConcepto('')
    },
  })

  const eliminarDiv = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from('dividendos').delete().eq('id', id)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fc_dividendos'] }),
  })

  // ── filtros ────────────────────────────────────────────────────────────────

  const filtrarPorLocal = <T extends { local?: string | null }>(items: T[]) => {
    if (local === 'ambos') return items
    return items.filter((i) => i.local === local || i.local === 'general')
  }

  const cierresFiltrados = useMemo(() => filtrarPorLocal(cierres ?? []), [cierres, local])
  const pagosFiltrados = useMemo(() => {
    const pagos = pagosRealizados ?? []
    if (local === 'ambos') return pagos
    return pagos.filter((p) => {
      const loc = p.gasto?.local
      return loc === local || !loc
    })
  }, [pagosRealizados, local])
  const divsFiltrados = useMemo(() => {
    if (local === 'ambos') return dividendos ?? []
    return (dividendos ?? []).filter((d) => d.local === local || !d.local)
  }, [dividendos, local])

  const pagosMPFiltrados = useMemo(() => {
    const pagos = pagosMP ?? []
    if (local === 'ambos') return pagos
    return pagos.filter((p) => p.local === local || p.local === 'ambos')
  }, [pagosMP, local])

  // Mapa de categoría ID → tipo_edr
  const catMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of categorias ?? []) m.set(c.id, c.tipo_edr)
    return m
  }, [categorias])

  // ── clasificación de movimientos bancarios ─────────────────────────────────
  // Regla de negocio:
  // - Ingresos reales = créditos MP (ventas) + efectivo verificado (cierres)
  // - Créditos Galicia/ICBC que son transferencias internas → no operativo
  // - Créditos Galicia/ICBC que son capital (InvertirOnline) → no operativo
  // - Créditos Galicia/ICBC operativos (dev. impuestos, cheques rechazados) → ingreso operativo menor

  const PATRONES_TRANSF_INTERNA = [
    /credito inmediato/i,                // ICBC: transferencia desde MP
    /transf\.?\s*ctas?\s*propias?/i,     // Galicia: entre cuentas propias
    /transferencia\s*de\s*cuenta\s*propia/i,
    /credito\s*transferencia\s*coelsa/i, // Galicia: transferencia recibida vía COELSA (desde MP)
  ]

  function esTransfInterna(m: MovBancario): boolean {
    return PATRONES_TRANSF_INTERNA.some((p) => p.test(m.descripcion ?? ''))
  }

  const movimientosClasificados = useMemo(() => {
    const movs = movimientos ?? []

    // Liquidaciones MP: créditos de MP en extracto = MP depositando en banco (no operativo)
    const liquidacionesMP = movs.filter((m) => m.cuenta === 'mercadopago' && Number(m.credito) > 0)

    // Egresos bancarios: débitos de Galicia e ICBC (los débitos MP ahora vienen de pagos_mp API)
    const debitosGalicia = movs.filter((m) => m.cuenta === 'galicia' && Number(m.debito) > 0)
    const debitosICBC = movs.filter((m) => m.cuenta === 'icbc' && Number(m.debito) > 0)

    // Créditos Galicia/ICBC: clasificar cada uno
    const creditosGalICBC = movs.filter((m) => (m.cuenta === 'galicia' || m.cuenta === 'icbc') && Number(m.credito) > 0)

    const capital: MovBancario[] = []
    const transferenciasInternas: MovBancario[] = []
    const creditosOperativos: MovBancario[] = [] // dev. impuestos, cheques rechazados, etc.

    for (const m of creditosGalICBC) {
      if (esMovCapital(m)) {
        capital.push(m)
      } else if (esTransfInterna(m)) {
        transferenciasInternas.push(m)
      } else {
        creditosOperativos.push(m) // es un ingreso operativo menor (dev. impuesto, etc.)
      }
    }

    return {
      liquidacionesMP, creditosOperativos,
      debitosGalicia, debitosICBC,
      transferenciasInternas, capital,
    }
  }, [movimientos])

  // ── INGRESOS ─────────────────────────────────────────────────────────────────

  const ingresos = useMemo(() => {
    const cierresVerif = cierresFiltrados.filter((c) => c.verificado)
    const efectivoVerificado = cierresVerif.reduce((s, c) => s + (c.retiro > 0 ? c.retiro : c.monto_contado), 0)
    const cierresPendientes = cierresFiltrados.filter((c) => !c.verificado).length

    // Ventas MP desde la API (bruto por medio de pago)
    const ventasMPBruto = pagosMPFiltrados.reduce((s, p) => s + Number(p.monto), 0)
    const ventasMPPorMedio = new Map<string, number>()
    for (const p of pagosMPFiltrados) {
      ventasMPPorMedio.set(p.medio_pago, (ventasMPPorMedio.get(p.medio_pago) ?? 0) + Number(p.monto))
    }

    const otrosIngresos = movimientosClasificados.creditosOperativos.reduce((s, m) => s + Number(m.credito), 0)
    const total = efectivoVerificado + ventasMPBruto + otrosIngresos

    return { efectivoVerificado, cierresPendientes, ventasMPBruto, ventasMPPorMedio, otrosIngresos, total }
  }, [cierresFiltrados, movimientosClasificados, pagosMPFiltrados])

  // ── EGRESOS ──────────────────────────────────────────────────────────────────

  const egresos = useMemo(() => {
    // 1) Pagos realizados agrupados por tipo EdR del gasto asociado
    const grupos = new Map<string, { total: number; items: { nombre: string; monto: number }[] }>()
    for (const p of pagosFiltrados) {
      const g = p.gasto
      const tipoEdr = g?.categoria_id ? (catMap.get(g.categoria_id) ?? null) : null
      const grupo = tipoEdrAGrupo(tipoEdr)
      if (!grupos.has(grupo)) grupos.set(grupo, { total: 0, items: [] })
      const entry = grupos.get(grupo)!
      entry.total += Number(p.monto)
      const label = g?.categoria || g?.subcategoria || g?.proveedor || 'Sin categoría'
      const existing = entry.items.find((i) => i.nombre === label)
      if (existing) existing.monto += Number(p.monto)
      else entry.items.push({ nombre: label, monto: Number(p.monto) })
    }

    // 2) Costos financieros (comisiones MP desde API + débitos Galicia/ICBC desde extractos)
    const { debitosGalicia, debitosICBC } = movimientosClasificados
    const bancarios: { nombre: string; monto: number; items: { nombre: string; monto: number }[] }[] = []

    // Comisiones e impuestos MP desde pagos_mp (API)
    const comisionesMP = pagosMPFiltrados.reduce((s, p) => s + Number(p.comision_mp), 0)
    const impuestosMP = pagosMPFiltrados.reduce((s, p) => s + Number(p.impuestos), 0)
    const totalCostosMP = comisionesMP + impuestosMP
    if (totalCostosMP > 0) {
      const mpItems: { nombre: string; monto: number }[] = []
      if (comisionesMP > 0) mpItems.push({ nombre: 'Comisiones MercadoPago', monto: comisionesMP })
      if (impuestosMP > 0) mpItems.push({ nombre: 'Retenciones impositivas MP', monto: impuestosMP })
      bancarios.push({
        nombre: GRUPO_DEBITO_LABEL.mercadopago,
        monto: totalCostosMP,
        items: mpItems,
      })
    }

    if (debitosGalicia.length > 0) {
      const totalGal = debitosGalicia.reduce((s, m) => s + Number(m.debito), 0)
      // Agrupar por descripción
      const galItems = new Map<string, number>()
      for (const m of debitosGalicia) {
        const key = m.descripcion ?? 'Otros'
        galItems.set(key, (galItems.get(key) ?? 0) + Number(m.debito))
      }
      bancarios.push({
        nombre: GRUPO_DEBITO_LABEL.galicia,
        monto: totalGal,
        items: [...galItems.entries()].map(([nombre, monto]) => ({ nombre, monto })).sort((a, b) => b.monto - a.monto),
      })
    }

    if (debitosICBC.length > 0) {
      const totalICBC = debitosICBC.reduce((s, m) => s + Number(m.debito), 0)
      const icbcItems = new Map<string, number>()
      for (const m of debitosICBC) {
        const key = m.descripcion ?? 'Otros'
        icbcItems.set(key, (icbcItems.get(key) ?? 0) + Number(m.debito))
      }
      bancarios.push({
        nombre: GRUPO_DEBITO_LABEL.icbc,
        monto: totalICBC,
        items: [...icbcItems.entries()].map(([nombre, monto]) => ({ nombre, monto })).sort((a, b) => b.monto - a.monto),
      })
    }

    const totalDebitosBanc = bancarios.reduce((s, b) => s + b.monto, 0)

    // 3) Dividendos
    const totalDivs = divsFiltrados.reduce((s, d) => s + Number(d.monto), 0)
    if (totalDivs > 0) {
      const divItems = SOCIOS.map((s) => ({
        nombre: SOCIO_LABEL[s],
        monto: divsFiltrados.filter((d) => d.socio === s).reduce((sum, d) => sum + Number(d.monto), 0),
      })).filter((i) => i.monto > 0)
      grupos.set('dividendos', { total: totalDivs, items: divItems })
    }

    const totalPagos = pagosFiltrados.reduce((s, p) => s + Number(p.monto), 0)
    const total = totalPagos + totalDebitosBanc + totalDivs

    return { grupos, bancarios, totalPagos, totalDebitosBanc, totalDivs, total }
  }, [pagosFiltrados, movimientosClasificados, pagosMPFiltrados, divsFiltrados, catMap])

  // ── NO OPERATIVO ───────────────────────────────────────────────────────────

  const noOperativo = useMemo(() => {
    const { transferenciasInternas, capital, liquidacionesMP } = movimientosClasificados
    const totalTransf = transferenciasInternas.reduce((s, m) => s + Number(m.credito), 0)
    const totalLiquidacionesMP = liquidacionesMP.reduce((s, m) => s + Number(m.credito), 0)
    const capitalIn = capital.filter((m) => Number(m.credito) > 0).reduce((s, m) => s + Number(m.credito), 0)
    const capitalOut = capital.filter((m) => Number(m.debito) > 0).reduce((s, m) => s + Number(m.debito), 0)
    return { transferenciasInternas, capital, liquidacionesMP, totalTransf, totalLiquidacionesMP, capitalIn, capitalOut }
  }, [movimientosClasificados])

  // ── KPIs de liquidez ───────────────────────────────────────────────────────

  const kpis = useMemo(() => {
    const saldoNeto = ingresos.total - egresos.total
    const margenCaja = ingresos.total > 0 ? ((saldoNeto / ingresos.total) * 100) : 0
    const ratioCobertura = egresos.total > 0 ? ingresos.total / egresos.total : 0
    const [y, m] = periodo.split('-').map(Number)
    const diasMes = new Date(y, m, 0).getDate()
    const burnRate = egresos.total / diasMes
    const diasCaja = burnRate > 0 ? saldoNeto / burnRate : 0
    const divsPctIngreso = ingresos.total > 0 ? (egresos.totalDivs / ingresos.total) * 100 : 0
    const cmvPctVentas = ingresos.total > 0
      ? ((egresos.grupos.get('cmv')?.total ?? 0) / ingresos.total) * 100 : 0

    const difArqueo = cierresFiltrados.reduce((s, c) => s + (c.diferencia ?? 0), 0)
    const totalEsperado = cierresFiltrados.filter((c) => c.monto_esperado != null).reduce((s, c) => s + (c.monto_esperado ?? 0), 0)
    const difArqueoPct = totalEsperado > 0 ? Math.abs(difArqueo / totalEsperado) * 100 : 0

    return { saldoNeto, margenCaja, ratioCobertura, burnRate, diasCaja, divsPctIngreso, cmvPctVentas, difArqueo, difArqueoPct }
  }, [ingresos, egresos, periodo, cierresFiltrados])

  // ── gráfico ────────────────────────────────────────────────────────────────

  const chartData = useMemo(() => {
    const byDay = new Map<string, { ingresos: number; egresos: number }>()

    // Ingresos: cierres verificados + MP API (bruto) + otros bancarios
    for (const c of cierresFiltrados.filter((c) => c.verificado)) {
      const d = byDay.get(c.fecha) ?? { ingresos: 0, egresos: 0 }
      d.ingresos += (c.retiro > 0 ? c.retiro : c.monto_contado)
      byDay.set(c.fecha, d)
    }
    for (const p of pagosMPFiltrados) {
      const fecha = p.fecha.substring(0, 10)
      const d = byDay.get(fecha) ?? { ingresos: 0, egresos: 0 }
      d.ingresos += Number(p.monto)
      d.egresos += Number(p.comision_mp) + Number(p.impuestos)
      byDay.set(fecha, d)
    }
    for (const m of movimientosClasificados.creditosOperativos) {
      const d = byDay.get(m.fecha) ?? { ingresos: 0, egresos: 0 }
      d.ingresos += Number(m.credito)
      byDay.set(m.fecha, d)
    }

    // Egresos: pagos realizados + débitos bancarios (Galicia/ICBC) + dividendos
    for (const p of pagosFiltrados) {
      const d = byDay.get(p.fecha_pago) ?? { ingresos: 0, egresos: 0 }
      d.egresos += Number(p.monto)
      byDay.set(p.fecha_pago, d)
    }
    for (const m of [...movimientosClasificados.debitosGalicia, ...movimientosClasificados.debitosICBC]) {
      const d = byDay.get(m.fecha) ?? { ingresos: 0, egresos: 0 }
      d.egresos += Number(m.debito)
      byDay.set(m.fecha, d)
    }
    for (const dv of divsFiltrados) {
      const d = byDay.get(dv.fecha) ?? { ingresos: 0, egresos: 0 }
      d.egresos += Number(dv.monto)
      byDay.set(dv.fecha, d)
    }

    let acum = 0
    return [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([fecha, vals]) => {
        acum += vals.ingresos - vals.egresos
        return { fecha: fecha.substring(8), saldo: acum }
      })
  }, [cierresFiltrados, movimientosClasificados, pagosMPFiltrados, pagosFiltrados, divsFiltrados])

  // ── semáforo ───────────────────────────────────────────────────────────────

  function semaforoColor(valor: number, verde: [number, number], ambar: [number, number]): 'green' | 'yellow' | 'red' {
    if (valor >= verde[0] && valor <= verde[1]) return 'green'
    if (valor >= ambar[0] && valor <= ambar[1]) return 'yellow'
    return 'red'
  }

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Filtros */}
      <div className="flex items-center gap-4 flex-wrap">
        <LocalSelector value={local} onChange={(v) => setLocal(v as 'ambos' | 'vedia' | 'saavedra')} options={['vedia', 'saavedra', 'ambos']} />
        <div>
          <label className="text-xs font-medium text-gray-500 mr-2">Período</label>
          <input type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-rodziny-500" />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={sincronizarMP}
            disabled={syncing}
            className={cn(
              'px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5',
              syncing ? 'bg-gray-100 text-gray-400 cursor-wait' : 'bg-blue-600 hover:bg-blue-700 text-white'
            )}
          >
            {syncing ? (
              <><span className="animate-spin inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full" /> Sincronizando...</>
            ) : (
              <><span>🔄</span> Sync MercadoPago</>
            )}
          </button>
          {pagosMPFiltrados.length > 0 && (
            <span className="text-[10px] text-blue-600 font-medium bg-blue-50 px-2 py-0.5 rounded">
              {pagosMPFiltrados.length} pagos MP
            </span>
          )}
        </div>
      </div>

      {/* Sync result toast */}
      {syncResult && (
        <div className={cn('text-xs px-3 py-2 rounded-md', syncResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700')}>
          {syncResult.ok
            ? `Sincronización exitosa: ${syncResult.sincronizados} pagos de ${periodo}`
            : `Error: ${syncResult.error}`}
          <button onClick={() => setSyncResult(null)} className="ml-2 text-gray-400 hover:text-gray-600">✕</button>
        </div>
      )}

      {/* KPIs de liquidez y solvencia */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPILiquidez label="Saldo neto del período" value={formatARS(kpis.saldoNeto)}
          desc="Ingresos - Egresos totales del mes" color={kpis.saldoNeto >= 0 ? 'green' : 'red'} />
        <KPILiquidez label="Margen de caja" value={`${kpis.margenCaja.toFixed(1)}%`}
          desc="% de ingresos que queda después de egresos" color={semaforoColor(kpis.margenCaja, [15, 999], [5, 15])} />
        <KPILiquidez label="Ratio de cobertura" value={kpis.ratioCobertura.toFixed(2)}
          desc="Cuántos $ de ingreso por cada $ de egreso" color={semaforoColor(kpis.ratioCobertura, [1.2, 999], [1.0, 1.2])} />
        <KPILiquidez label="Burn rate diario" value={formatARS(kpis.burnRate)}
          desc="Egresos totales / días del mes" color="neutral" />
        <KPILiquidez label="Días de caja" value={kpis.diasCaja > 0 ? `${kpis.diasCaja.toFixed(0)} días` : '—'}
          desc="Cuántos días se cubre con el saldo actual" color={semaforoColor(kpis.diasCaja, [30, 999], [15, 30])} />
        <KPILiquidez label="Dividendos / Ingreso" value={`${kpis.divsPctIngreso.toFixed(1)}%`}
          desc="% de ingresos que se retiran como dividendos" color={semaforoColor(100 - kpis.divsPctIngreso, [85, 100], [75, 85])} />
        <KPILiquidez label="CMV / Ventas" value={`${kpis.cmvPctVentas.toFixed(1)}%`}
          desc="% de ingresos destinado a materia prima" color={semaforoColor(100 - kpis.cmvPctVentas, [60, 100], [55, 60])} />
        <KPILiquidez label="Diferencia de arqueo" value={formatARS(kpis.difArqueo)}
          desc={`${kpis.difArqueoPct.toFixed(2)}% desvío vs esperado`}
          color={semaforoColor(100 - kpis.difArqueoPct, [99, 100], [98, 99])} />
      </div>

      {/* Gráfico evolución diaria */}
      {chartData.length > 0 && (
        <div className="bg-white rounded-lg border border-surface-border p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Evolución diaria del saldo operativo — {periodo}</h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="saldoGradFC" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#65a832" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#65a832" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="fecha" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000000).toFixed(1)}M`} />
              <Tooltip formatter={(v) => [formatARS(Number(v)), 'Saldo acumulado']} labelFormatter={(l) => `Día ${l}`} />
              <Area type="monotone" dataKey="saldo" stroke="#4f8828" fill="url(#saldoGradFC)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ═══ INGRESOS ═══ */}
      <SeccionExpandible titulo="INGRESOS" total={ingresos.total} open={ingresosOpen}
        onToggle={() => setIngresosOpen(!ingresosOpen)} color="green">
        <div className="divide-y divide-gray-100">
          <LineaDetalle label="Efectivo (cierres verificados)" monto={ingresos.efectivoVerificado}
            nota={ingresos.cierresPendientes > 0 ? `⚠️ ${ingresos.cierresPendientes} pendiente${ingresos.cierresPendientes > 1 ? 's' : ''} de verificar` : undefined} />
          <GrupoEgreso
            label={`Ventas digitales — MercadoPago (${pagosMPFiltrados.length} pagos)`}
            total={ingresos.ventasMPBruto}
            items={[...ingresos.ventasMPPorMedio.entries()]
              .map(([medio, monto]) => ({ nombre: MEDIO_PAGO_MP_LABEL[medio] || medio, monto }))
              .sort((a, b) => b.monto - a.monto)}
          />
          <LineaDetalle label="Otros ingresos bancarios (dev. impuestos, cheques rechazados)" monto={ingresos.otrosIngresos} />
        </div>
      </SeccionExpandible>

      {/* ═══ EGRESOS ═══ */}
      <SeccionExpandible titulo="EGRESOS" total={-egresos.total} open={egresosOpen}
        onToggle={() => setEgresosOpen(!egresosOpen)} color="red">
        <div className="divide-y divide-gray-100">
          {/* Gastos pagados por categoría EdR */}
          {['cmv', 'gastos_op', 'rrhh', 'impuestos', 'inversiones', 'intereses', 'dividendos', 'otros'].map((grupo) => {
            const data = egresos.grupos.get(grupo)
            if (!data || data.total === 0) return null
            return <GrupoEgreso key={grupo} label={GRUPO_EGRESO_LABEL[grupo]} total={data.total} items={data.items} />
          })}
          {/* Débitos bancarios por cuenta */}
          {egresos.bancarios.map((banco) => (
            <GrupoEgreso key={banco.nombre} label={banco.nombre} total={banco.monto} items={banco.items} />
          ))}
        </div>
      </SeccionExpandible>

      {/* ═══ NO OPERATIVO ═══ */}
      {(noOperativo.transferenciasInternas.length > 0 || noOperativo.capital.length > 0 || noOperativo.liquidacionesMP.length > 0) && (
        <SeccionExpandible titulo="MOVIMIENTOS NO OPERATIVOS" total={0} open={noOperativoOpen}
          onToggle={() => setNoOperativoOpen(!noOperativoOpen)} color="blue">
          <div className="p-4 space-y-4">
            <p className="text-[10px] text-gray-500">
              Movimientos entre cuentas propias y cuenta comitente. No son ingresos ni egresos del negocio — no afectan los KPIs.
            </p>

            {/* Liquidaciones MP (depósitos de MP al banco) */}
            {noOperativo.liquidacionesMP.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-gray-700 mb-2">Liquidaciones MercadoPago (depósitos al banco)</h4>
                <p className="text-[10px] text-gray-400 mb-2">MP transfiere los fondos cobrados a la cuenta bancaria. No son ventas nuevas — las ventas ya se contaron arriba desde la API de MP.</p>
                <div className="bg-gray-50 rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <tbody>
                      {noOperativo.liquidacionesMP.map((m) => (
                        <tr key={m.id} className="border-t border-gray-100">
                          <td className="px-3 py-1.5 text-gray-500">{formatFecha(m.fecha)}</td>
                          <td className="px-3 py-1.5 text-gray-500 truncate max-w-[250px]">{m.descripcion}</td>
                          <td className="px-3 py-1.5 text-right font-medium text-gray-700 tabular-nums">{formatARS(Number(m.credito))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-gray-400 mt-1 text-right">
                  Total liquidado: {formatARS(noOperativo.totalLiquidacionesMP)}
                </p>
              </div>
            )}

            {/* Transferencias internas */}
            {noOperativo.transferenciasInternas.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-gray-700 mb-2">Transferencias internas (MP → Galicia / ICBC)</h4>
                <div className="bg-gray-50 rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <tbody>
                      {noOperativo.transferenciasInternas.map((m) => (
                        <tr key={m.id} className="border-t border-gray-100">
                          <td className="px-3 py-1.5 text-gray-500">{formatFecha(m.fecha)}</td>
                          <td className="px-3 py-1.5 text-gray-600">{m.cuenta === 'galicia' ? 'Galicia' : 'ICBC'}</td>
                          <td className="px-3 py-1.5 text-gray-500 truncate max-w-[200px]">{m.descripcion}</td>
                          <td className="px-3 py-1.5 text-right font-medium text-gray-700 tabular-nums">{formatARS(Number(m.credito))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-gray-400 mt-1 text-right">
                  Total: {formatARS(noOperativo.totalTransf)}
                </p>
              </div>
            )}

            {/* Capital (InvertirOnline) */}
            {noOperativo.capital.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-gray-700 mb-2">Cuenta comitente (InvertirOnline)</h4>
                <div className="grid grid-cols-2 gap-3 mb-2">
                  <div className="bg-green-50 rounded-lg p-2.5 text-center">
                    <p className="text-[10px] text-gray-500">Ingreso de capital</p>
                    <p className="text-base font-bold text-green-700">{formatARS(noOperativo.capitalIn)}</p>
                  </div>
                  <div className="bg-red-50 rounded-lg p-2.5 text-center">
                    <p className="text-[10px] text-gray-500">Salida a inversión</p>
                    <p className="text-base font-bold text-red-700">{formatARS(noOperativo.capitalOut)}</p>
                  </div>
                </div>
                <div className="bg-gray-50 rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <tbody>
                      {noOperativo.capital.map((m) => {
                        const esIngreso = Number(m.credito) > 0
                        return (
                          <tr key={m.id} className="border-t border-gray-100">
                            <td className="px-3 py-1.5 text-gray-500">{formatFecha(m.fecha)}</td>
                            <td className="px-3 py-1.5 text-gray-500 truncate max-w-[200px]">{m.descripcion}</td>
                            <td className={cn('px-3 py-1.5 text-right font-medium tabular-nums', esIngreso ? 'text-green-700' : 'text-red-700')}>
                              {esIngreso ? '+' : '-'}{formatARS(esIngreso ? Number(m.credito) : Number(m.debito))}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </SeccionExpandible>
      )}

      {/* ═══ DIVIDENDOS ═══ */}
      <SeccionExpandible titulo="DIVIDENDOS — Registro de retiros" total={-egresos.totalDivs}
        open={dividendosOpen} onToggle={() => setDividendosOpen(!dividendosOpen)} color="blue">
        <div className="p-4">
          <div className="grid grid-cols-3 gap-3 mb-4">
            {SOCIOS.map((s) => {
              const total = divsFiltrados.filter((d) => d.socio === s).reduce((sum, d) => sum + Number(d.monto), 0)
              return (
                <div key={s} className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-500 mb-1">{SOCIO_LABEL[s]}</p>
                  <p className="text-lg font-bold text-gray-900">{formatARS(total)}</p>
                </div>
              )
            })}
          </div>

          {!showDivForm && (
            <button onClick={() => setShowDivForm(true)}
              className="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-rodziny-400 hover:text-rodziny-700 transition-colors">
              + Registrar retiro
            </button>
          )}

          {showDivForm && (
            <div className="bg-blue-50 rounded-lg p-4 mt-3 border border-blue-200">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Socio</label>
                  <select value={divSocio} onChange={(e) => setDivSocio(e.target.value)}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white">
                    {SOCIOS.map((s) => <option key={s} value={s}>{SOCIO_LABEL[s]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Fecha</label>
                  <input type="date" value={divFecha} onChange={(e) => setDivFecha(e.target.value)}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Monto *</label>
                  <input type="text" value={divMonto} onChange={(e) => setDivMonto(e.target.value)}
                    placeholder="500000" className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Medio de pago</label>
                  <select value={divMedio} onChange={(e) => setDivMedio(e.target.value)}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white">
                    {MEDIOS_PAGO_DIV.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">De qué caja sale</label>
                  <select value={divLocal} onChange={(e) => setDivLocal(e.target.value)}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white">
                    <option value="">General</option>
                    <option value="vedia">Vedia</option>
                    <option value="saavedra">Saavedra</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Concepto</label>
                  <input type="text" value={divConcepto} onChange={(e) => setDivConcepto(e.target.value)}
                    placeholder="Retiro mensual" className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-3">
                <button onClick={() => setShowDivForm(false)} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Cancelar</button>
                <button onClick={() => guardarDiv.mutate()} disabled={guardarDiv.isPending || !divMonto}
                  className="px-4 py-1.5 bg-rodziny-700 hover:bg-rodziny-800 text-white text-sm rounded font-medium disabled:bg-gray-300">
                  {guardarDiv.isPending ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
              {guardarDiv.isError && <p className="text-xs text-red-600 mt-2">{(guardarDiv.error as Error).message}</p>}
            </div>
          )}

          {divsFiltrados.length > 0 && (
            <table className="w-full text-xs mt-4">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500">Fecha</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500">Socio</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500">Medio</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500">Concepto</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-500">Monto</th>
                  <th className="px-2 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {divsFiltrados.map((d) => (
                  <tr key={d.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-600">{formatFecha(d.fecha)}</td>
                    <td className="px-3 py-2 font-medium text-gray-900">{SOCIO_LABEL[d.socio] ?? d.socio}</td>
                    <td className="px-3 py-2 text-gray-600">{MEDIOS_PAGO_DIV.find((m) => m.value === d.medio_pago)?.label ?? d.medio_pago}</td>
                    <td className="px-3 py-2 text-gray-500">{d.concepto || '—'}</td>
                    <td className="px-3 py-2 text-right font-semibold text-red-700">{formatARS(Number(d.monto))}</td>
                    <td className="px-2 py-2 text-center">
                      <button
                        onClick={() => { if (confirm(`¿Eliminar retiro de ${SOCIO_LABEL[d.socio]} por ${formatARS(Number(d.monto))}?`)) eliminarDiv.mutate(d.id) }}
                        className="text-gray-300 hover:text-red-500 text-xs">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </SeccionExpandible>
    </div>
  )
}

// ── sub-componentes ──────────────────────────────────────────────────────────

function KPILiquidez({ label, value, desc, color }: { label: string; value: string; desc: string; color: 'green' | 'yellow' | 'red' | 'neutral' }) {
  const borderColors = { green: 'border-l-green-500', yellow: 'border-l-amber-500', red: 'border-l-red-500', neutral: 'border-l-gray-300' }
  return (
    <div className={cn('bg-white rounded-lg p-4 border border-surface-border border-l-[3px]', borderColors[color])}>
      <p className="text-[10px] uppercase tracking-wide text-gray-500 font-medium">{label}</p>
      <p className="text-lg font-bold text-gray-900 mt-0.5">{value}</p>
      <p className="text-[10px] text-gray-400 mt-1 leading-tight">{desc}</p>
    </div>
  )
}

function SeccionExpandible({ titulo, total, open, onToggle, color, children }: {
  titulo: string; total: number; open: boolean; onToggle: () => void
  color: 'green' | 'red' | 'blue'; children: React.ReactNode
}) {
  const headerColors = {
    green: 'bg-green-900 text-green-50',
    red: 'bg-red-900 text-red-50',
    blue: 'bg-blue-900 text-blue-50',
  }
  return (
    <div className="bg-white rounded-lg border border-surface-border overflow-hidden">
      <button onClick={onToggle} className={cn('w-full px-5 py-3 flex items-center justify-between', headerColors[color])}>
        <div className="flex items-center gap-2">
          <span className="text-sm">{open ? '▼' : '▶'}</span>
          <span className="font-bold text-sm tracking-wide">{titulo}</span>
        </div>
        <span className="font-bold text-base tabular-nums">{total === 0 ? '—' : formatARS(Math.abs(total))}</span>
      </button>
      {open && children}
    </div>
  )
}

function LineaDetalle({ label, monto, nota }: { label: string; monto: number; nota?: string }) {
  if (monto === 0) return null
  return (
    <div className="px-5 py-2.5 flex items-center justify-between">
      <div>
        <span className="text-sm text-gray-700">{label}</span>
        {nota && <span className="ml-2 text-[10px] text-amber-600">{nota}</span>}
      </div>
      <span className="text-sm font-semibold text-gray-900 tabular-nums">{formatARS(monto)}</span>
    </div>
  )
}

function GrupoEgreso({ label, total, items }: { label: string; total: number; items: { nombre: string; monto: number }[] }) {
  const [open, setOpen] = useState(false)
  const sorted = [...items].sort((a, b) => b.monto - a.monto)

  return (
    <div>
      <button onClick={() => setOpen(!open)}
        className="w-full px-5 py-2.5 flex items-center justify-between hover:bg-gray-50 transition-colors">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-gray-400">{open ? '▼' : '▶'}</span>
          <span className="text-sm text-gray-700">{label}</span>
        </div>
        <span className="text-sm font-semibold text-red-700 tabular-nums">-{formatARS(total)}</span>
      </button>
      {open && (
        <div className="bg-gray-50 border-t border-gray-100">
          {sorted.map((item, i) => (
            <div key={i} className="px-5 pl-10 py-1.5 flex items-center justify-between text-xs">
              <span className="text-gray-500">
                <span className="text-gray-300 mr-1.5">└</span>{item.nombre}
              </span>
              <span className="text-gray-700 tabular-nums">{formatARS(item.monto)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
