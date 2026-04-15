import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { LocalSelector } from '@/components/ui/LocalSelector'
import { PageContainer } from '@/components/layout/PageContainer'
import { KPICard } from '@/components/ui/KPICard'
import { formatARS } from '@/lib/utils'
import { cn } from '@/lib/utils'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, ComposedChart, Line,
} from 'recharts'

// ── helpers ──────────────────────────────────────────────────────────────────
const COLORES = ['#4f8828', '#65a832', '#82c44e', '#a3d96e', '#c5ef97', '#e7f9d0', '#2D5016', '#1b3b0d']
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const HORAS = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0'))
const DIAS_LABEL: Record<string, string> = { '0': 'Dom', '1': 'Lun', '2': 'Mar', '3': 'Mié', '4': 'Jue', '5': 'Vie', '6': 'Sáb' }

function pct(v: number, total: number) {
  return total > 0 ? ((v / total) * 100).toFixed(1) + '%' : '0%'
}

// ── tipos ─────────────────────────────────────────────────────────────────────
interface Ticket { fecha: string; hora: string | null; total_bruto: number; iva: number | null; es_fiscal: boolean | null; estado: string | null; medio_pago: string | null }
interface Item    { nombre: string; categoria: string | null; cantidad: number; total: number; periodo: string }
interface Pago    { medio_pago: string; monto: number }

type Tab   = 'resumen' | 'productos' | 'horario' | 'medios'
type Vista = 'mensual' | 'anual'

// ── componente ────────────────────────────────────────────────────────────────
export function VentasPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [local,  setLocal]  = useState<'ambos' | 'vedia' | 'saavedra'>('vedia')
  const [tab,    setTab]    = useState<Tab>('resumen')
  const [vista,  setVista]  = useState<Vista>('mensual')
  const [periodo, setPeriodo] = useState(() => new Date().toISOString().substring(0, 7))
  const [año,    setAño]    = useState(() => String(new Date().getFullYear()))
  const [catFiltro, setCatFiltro] = useState<string>('todas')

  // ── filtros de query ──────────────────────────────────────────────────────
  const esAnual = vista === 'anual'

  // Rango de fechas y periodos según vista
  const fechaDesde = esAnual ? `${año}-01-01` : `${periodo}-01`
  const fechaHasta = esAnual
    ? `${año}-12-31`
    : (() => {
        const [y, m] = periodo.split('-').map(Number)
        const ultimo = new Date(y, m, 0).getDate() // día 0 del mes siguiente = último del actual
        return `${periodo}-${String(ultimo).padStart(2, '0')}`
      })()
  const periodoDesde = esAnual ? `${año}-01` : periodo
  const periodoHasta = esAnual ? `${año}-12` : periodo

  // ── queries ──────────────────────────────────────────────────────────────
  const { data: tickets, isLoading: loadingTickets, error: errTickets } = useQuery({
    queryKey: ['ventas_tickets', vista, esAnual ? año : periodo, local],
    queryFn: async () => {
      // Paginar para superar el límite de 1000 filas del servidor
      const PAGE = 1000
      const allRows: Ticket[] = []
      let from = 0
      while (true) {
        let q = supabase
          .from('ventas_tickets')
          .select('fecha, hora, total_bruto, iva, es_fiscal, estado, medio_pago')
          .gte('fecha', fechaDesde)
          .lte('fecha', fechaHasta)
          .neq('estado', 'Cancelada')
          .neq('estado', 'Eliminada')
          .range(from, from + PAGE - 1)
        if (local !== 'ambos') q = q.eq('local', local)
        const { data, error } = await q
        if (error) { console.error('[ventas_tickets]', error); break }
        if (!data || data.length === 0) break
        allRows.push(...(data as Ticket[]))
        if (data.length < PAGE) break
        from += PAGE
      }
      return allRows
    },
  })

  const { data: items, isLoading: loadingItems, error: errItems } = useQuery({
    queryKey: ['ventas_items', vista, esAnual ? año : periodo, local],
    queryFn: async () => {
      const PAGE = 1000
      const allRows: Item[] = []
      let from = 0
      while (true) {
        let q = supabase
          .from('ventas_items')
          .select('nombre, categoria, cantidad, total, periodo')
          .gte('periodo', periodoDesde)
          .lte('periodo', periodoHasta)
          .range(from, from + PAGE - 1)
        if (local !== 'ambos') q = q.eq('local', local)
        const { data, error } = await q
        if (error) { console.error('[ventas_items]', error); break }
        if (!data || data.length === 0) break
        allRows.push(...(data as Item[]))
        if (data.length < PAGE) break
        from += PAGE
      }
      return allRows
    },
  })

  // ── KPI: mes anterior (solo en vista mensual, para delta %) ───────────────
  const periodoAnterior = useMemo(() => {
    if (esAnual) return null
    const [y, m] = periodo.split('-').map(Number)
    const dt = new Date(y, m - 2, 1)
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
  }, [esAnual, periodo])

  const { data: ticketsPrev } = useQuery({
    queryKey: ['ventas_tickets_prev', periodoAnterior, local],
    enabled: !!periodoAnterior,
    queryFn: async () => {
      if (!periodoAnterior) return [] as Ticket[]
      const [y, m] = periodoAnterior.split('-').map(Number)
      const ultimo = new Date(y, m, 0).getDate()
      const desde = `${periodoAnterior}-01`
      const hasta = `${periodoAnterior}-${String(ultimo).padStart(2, '0')}`
      const PAGE = 1000
      const allRows: Ticket[] = []
      let from = 0
      while (true) {
        let q = supabase
          .from('ventas_tickets')
          .select('fecha, hora, total_bruto, iva, es_fiscal, estado, medio_pago')
          .gte('fecha', desde)
          .lte('fecha', hasta)
          .neq('estado', 'Cancelada')
          .neq('estado', 'Eliminada')
          .range(from, from + PAGE - 1)
        if (local !== 'ambos') q = q.eq('local', local)
        const { data } = await q
        if (!data || data.length === 0) break
        allRows.push(...(data as Ticket[]))
        if (data.length < PAGE) break
        from += PAGE
      }
      return allRows
    },
  })

  const { data: pagos, isLoading: loadingPagos, error: errPagos } = useQuery({
    queryKey: ['ventas_pagos', vista, esAnual ? año : periodo, local],
    queryFn: async () => {
      const PAGE = 1000
      const allRows: Pago[] = []
      let from = 0
      while (true) {
        let q = supabase
          .from('ventas_pagos')
          .select('medio_pago, monto')
          .gte('periodo', periodoDesde)
          .lte('periodo', periodoHasta)
          .range(from, from + PAGE - 1)
        if (local !== 'ambos') q = q.eq('local', local)
        const { data, error } = await q
        if (error) { console.error('[ventas_pagos]', error); break }
        if (!data || data.length === 0) break
        allRows.push(...(data as Pago[]))
        if (data.length < PAGE) break
        from += PAGE
      }
      return allRows
    },
  })

  const loading = loadingTickets || loadingItems || loadingPagos
  const queryError = (errTickets || errItems || errPagos) as Error | null

  // ── KPIs — lógica idéntica al script de Sheets ────────────────────────────
  // Excluir dividendos (medio_pago = "mercadopago lucas") igual que el script
  const ticketsFiltrados = tickets?.filter(
    (t) => (t.medio_pago ?? '').toLowerCase() !== 'mercadopago lucas'
  ) ?? []
  const ticketsCobrados  = ticketsFiltrados.filter((t) => Number(t.total_bruto) > 0)

  const totalTickets   = ticketsFiltrados.length
  const totalVentas    = ticketsFiltrados.reduce((s, t) => s + Number(t.total_bruto), 0)
  // IVA real desde la hoja Ventas Fiscales (columna iva guardada por ticket)
  const totalIVA       = Math.round(ticketsFiltrados.reduce((s, t) => s + Number(t.iva ?? 0), 0) * 100) / 100
  const totalNeto      = Math.round((totalVentas - totalIVA) * 100) / 100
  const ticketPromedio = ticketsCobrados.length > 0 ? Math.round(totalVentas / ticketsCobrados.length) : 0

  // ── Deltas vs mes anterior (solo en mensual) ──────────────────────────────
  const prevFiltrados = (ticketsPrev ?? []).filter(
    (t) => (t.medio_pago ?? '').toLowerCase() !== 'mercadopago lucas'
  )
  const prevCobrados = prevFiltrados.filter((t) => Number(t.total_bruto) > 0)
  const prevTickets  = prevFiltrados.length
  const prevVentas   = prevFiltrados.reduce((s, t) => s + Number(t.total_bruto), 0)
  const prevIVA      = prevFiltrados.reduce((s, t) => s + Number(t.iva ?? 0), 0)
  const prevNeto     = prevVentas - prevIVA
  const prevTicketProm = prevCobrados.length > 0 ? prevVentas / prevCobrados.length : 0

  function delta(actual: number, anterior: number): number | undefined {
    if (esAnual) return undefined
    if (!periodoAnterior || anterior <= 0) return undefined
    return ((actual - anterior) / anterior) * 100
  }
  const deltaTickets = delta(totalTickets, prevTickets)
  const deltaVentas  = delta(totalVentas, prevVentas)
  const deltaNeto    = delta(totalNeto, prevNeto)
  const deltaTicket  = delta(ticketPromedio, prevTicketProm)

  // ── Evolución mensual (solo vista anual) ──────────────────────────────────
  const evolucionMensual = (() => {
    if (!tickets?.length) return []
    const map = new Map<string, { tickets: number; total: number }>()
    for (let m = 1; m <= 12; m++) {
      const k = `${año}-${String(m).padStart(2, '0')}`
      map.set(k, { tickets: 0, total: 0 })
    }
    for (const t of tickets) {
      const k = String(t.fecha).substring(0, 7)
      const cur = map.get(k)
      if (!cur) continue
      map.set(k, { tickets: cur.tickets + 1, total: cur.total + Number(t.total_bruto) })
    }
    return Array.from(map.entries()).map(([k, v]) => ({
      mes: MESES[parseInt(k.substring(5, 7)) - 1],
      tickets: v.tickets,
      total: v.total,
      ticketProm: v.tickets > 0 ? v.total / v.tickets : 0,
    }))
  })()

  // ── Por hora ──────────────────────────────────────────────────────────────
  const horaMap = new Map<string, { tickets: number; total: number }>()
  for (const t of tickets ?? []) {
    const h = t.hora ? String(t.hora).substring(0, 2) : 'N/A'
    const cur = horaMap.get(h) ?? { tickets: 0, total: 0 }
    horaMap.set(h, { tickets: cur.tickets + 1, total: cur.total + Number(t.total_bruto) })
  }
  const horaData = HORAS
    .map((h) => ({ hora: h + 'hs', tickets: horaMap.get(h)?.tickets ?? 0, total: horaMap.get(h)?.total ?? 0 }))
    .filter((h) => h.tickets > 0)

  // ── Por día de semana ─────────────────────────────────────────────────────
  const diaMap = new Map<number, { tickets: number; total: number }>()
  for (const t of tickets ?? []) {
    if (!t.fecha) continue
    const d = new Date(t.fecha + 'T12:00:00').getDay()
    const cur = diaMap.get(d) ?? { tickets: 0, total: 0 }
    diaMap.set(d, { tickets: cur.tickets + 1, total: cur.total + Number(t.total_bruto) })
  }
  const diaData = [1, 2, 3, 4, 5, 6, 0].map((d) => ({
    dia: DIAS_LABEL[d.toString()],
    tickets: diaMap.get(d)?.tickets ?? 0,
    total: diaMap.get(d)?.total ?? 0,
  }))

  // ── Productos ─────────────────────────────────────────────────────────────
  // Excluir categorías informativas (no son productos reales)
  const CATS_EXCLUIDAS = ['información para hacer tu pedido', 'informacion para hacer tu pedido']
  const itemsSinInfo = (items ?? []).filter((i) => !CATS_EXCLUIDAS.includes((i.categoria ?? '').toLowerCase().trim()))

  // Categorías únicas para el filtro
  const categoriasUnicas = [...new Set(itemsSinInfo.map((i) => i.categoria ?? 'Sin categoría'))].sort()

  const itemsFiltrados = catFiltro === 'todas'
    ? itemsSinInfo
    : itemsSinInfo.filter((i) => (i.categoria ?? 'Sin categoría') === catFiltro)

  const prodMap = new Map<string, { categoria: string; cantidad: number; total: number }>()
  for (const i of itemsFiltrados) {
    const k = i.nombre
    const cur = prodMap.get(k) ?? { categoria: i.categoria ?? 'Sin categoría', cantidad: 0, total: 0 }
    prodMap.set(k, { categoria: cur.categoria, cantidad: cur.cantidad + i.cantidad, total: cur.total + i.total })
  }
  const topPorCantidad = [...prodMap.entries()].sort((a, b) => b[1].cantidad - a[1].cantidad).slice(0, 15).map(([nombre, d]) => ({ nombre, ...d }))
  const topPorMonto    = [...prodMap.entries()].sort((a, b) => b[1].total    - a[1].total   ).slice(0, 15).map(([nombre, d]) => ({ nombre, ...d }))

  // ── Categorías ─────────────────────────────────────────────────────────────
  const catMap = new Map<string, { cantidad: number; total: number }>()
  for (const i of items ?? []) {
    const k = i.categoria ?? 'Sin categoría'
    const cur = catMap.get(k) ?? { cantidad: 0, total: 0 }
    catMap.set(k, { cantidad: cur.cantidad + i.cantidad, total: cur.total + i.total })
  }
  const totalCat = [...catMap.values()].reduce((s, v) => s + v.total, 0)
  const catData = [...catMap.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([name, d]) => ({ name, ...d, pct: pct(d.total, totalCat) }))

  // ── Medios de pago ────────────────────────────────────────────────────────
  const mediosMap = new Map<string, number>()
  for (const p of pagos ?? []) {
    const k = p.medio_pago || 'Sin datos'
    mediosMap.set(k, (mediosMap.get(k) ?? 0) + Number(p.monto))
  }
  const totalMedios = [...mediosMap.values()].reduce((s, v) => s + v, 0)
  const mediosData = [...mediosMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value, pctLabel: pct(value, totalMedios) }))

  // ── render ────────────────────────────────────────────────────────────────
  const inner = (
    <>

      {/* Local selector */}
      <div className="flex items-center gap-4 mb-4">
        <LocalSelector value={local} onChange={(v) => setLocal(v as 'ambos' | 'vedia' | 'saavedra')} options={['vedia', 'saavedra', 'ambos']} />
      </div>

      {/* Controles superiores */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-200">
          {([
            ['resumen',   '📊 Resumen'],
            ['productos', '🍝 Productos'],
            ['horario',   '📅 Días'],
            ['medios',    '💳 Medios de pago'],
          ] as [Tab, string][]).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
                tab === t ? 'border-rodziny-600 text-rodziny-800' : 'border-transparent text-gray-500 hover:text-gray-700'
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Vista + selector período */}
        <div className="flex items-center gap-3">
          {/* Toggle mensual/anual */}
          <div className="flex rounded-md border border-gray-300 overflow-hidden">
            {(['mensual', 'anual'] as Vista[]).map((v) => (
              <button
                key={v}
                onClick={() => setVista(v)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium transition-colors capitalize',
                  vista === v ? 'bg-rodziny-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                )}
              >
                {v}
              </button>
            ))}
          </div>

          {/* Selector */}
          {esAnual ? (
            <input
              type="number"
              min="2020"
              max="2099"
              value={año}
              onChange={(e) => setAño(e.target.value)}
              className="w-24 border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-rodziny-500"
            />
          ) : (
            <input
              type="month"
              value={periodo}
              onChange={(e) => setPeriodo(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-rodziny-500"
            />
          )}
        </div>
      </div>

      {queryError && (
        <div className="mb-4 p-3 rounded-md bg-red-50 text-red-700 text-sm">
          ❌ Error de base de datos: {queryError.message}
        </div>
      )}

      {/* ── TAB: RESUMEN ─────────────────────────────────────────────────── */}
      {tab === 'resumen' && (
        <div className="space-y-6">
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KPICard label="Tickets"            value={totalTickets.toLocaleString('es-AR')} change={deltaTickets} color="blue"    loading={loading} />
            <KPICard label="Venta bruta"        value={formatARS(totalVentas)}               change={deltaVentas}  color="green"   loading={loading} />
            <KPICard label="Venta neta (s/IVA)" value={formatARS(totalNeto)}                 change={deltaNeto}    color="neutral" loading={loading} />
            <KPICard label="Ticket promedio"    value={formatARS(ticketPromedio)}            change={deltaTicket}  color="yellow"  loading={loading} />
          </div>

          {/* Evolución mensual (solo vista anual) */}
          {esAnual && (
            <div className="bg-white rounded-lg border border-surface-border p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Evolución mensual {año}</h3>
              {loading ? (
                <div className="text-sm text-gray-400">Cargando...</div>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart data={evolucionMensual}>
                    <XAxis dataKey="mes" tick={{ fontSize: 12 }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000000).toFixed(1)}M`} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(value, name) =>
                        name === 'total'     ? [formatARS(Number(value)), 'Facturación'] :
                        name === 'tickets'   ? [Number(value).toLocaleString('es-AR'), 'Tickets'] :
                        [formatARS(Number(value)), 'Ticket prom.']
                      }
                    />
                    <Legend />
                    <Bar    yAxisId="left"  dataKey="total"   fill="#4f8828" radius={[3, 3, 0, 0]} name="total" />
                    <Line  yAxisId="right" dataKey="tickets" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} name="tickets" type="monotone" />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
          )}

          {/* Día de semana (vista mensual) */}
          {!esAnual && (
            <div className="bg-white rounded-lg border border-surface-border p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Tickets por día de semana</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={diaData}>
                  <XAxis dataKey="dia" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => [Number(v).toLocaleString('es-AR'), 'Tickets']} />
                  <Bar dataKey="tickets" fill="#4f8828" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Categorías */}
          <div className="bg-white rounded-lg border border-surface-border p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">
              Ventas por categoría {esAnual ? `— ${año}` : ''}
            </h3>
            {loading ? (
              <div className="text-sm text-gray-400">Cargando...</div>
            ) : catData.length === 0 ? (
              <div className="text-sm text-gray-400">Sin datos. Importá el archivo de ventas Fudo.</div>
            ) : (
              <div className="space-y-2">
                {catData.map((c, i) => (
                  <div key={c.name} className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: COLORES[i % COLORES.length] }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className="truncate text-gray-700 font-medium">{c.name}</span>
                        <span className="text-gray-500 ml-2 flex-shrink-0">{formatARS(c.total)} · {c.pct}</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: c.pct, background: COLORES[i % COLORES.length] }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Tabla resumen mensual (solo vista anual) */}
          {esAnual && evolucionMensual.some((m) => m.tickets > 0) && (
            <div className="bg-white rounded-lg border border-surface-border overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-700">Resumen por mes — {año}</h3>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {['Mes', 'Tickets', 'Facturación', 'Ticket prom.', '% del año'].map((h) => (
                      <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {evolucionMensual.filter((m) => m.tickets > 0).map((m) => (
                    <tr key={m.mes} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 font-medium text-gray-700">{m.mes}</td>
                      <td className="px-4 py-2.5 text-gray-600">{m.tickets.toLocaleString('es-AR')}</td>
                      <td className="px-4 py-2.5 font-medium text-gray-800">{formatARS(m.total)}</td>
                      <td className="px-4 py-2.5 text-gray-600">{formatARS(m.ticketProm)}</td>
                      <td className="px-4 py-2.5 text-rodziny-700 font-medium">{pct(m.total, totalVentas)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50">
                    <td className="px-4 py-2.5 font-semibold text-gray-700">Total {año}</td>
                    <td className="px-4 py-2.5 font-semibold text-gray-700">{totalTickets.toLocaleString('es-AR')}</td>
                    <td className="px-4 py-2.5 font-semibold text-gray-700">{formatARS(totalVentas)}</td>
                    <td className="px-4 py-2.5 font-semibold text-gray-700">{formatARS(ticketPromedio)}</td>
                    <td className="px-4 py-2.5 text-gray-500">100%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── TAB: PRODUCTOS ───────────────────────────────────────────────── */}
      {tab === 'productos' && (
        <div className="space-y-4">
          {/* Filtro por categoría */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-gray-500 font-medium">Categoría:</span>
            <div className="flex gap-1.5 flex-wrap">
              <button
                onClick={() => setCatFiltro('todas')}
                className={cn(
                  'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                  catFiltro === 'todas' ? 'bg-rodziny-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                )}
              >
                Todas
              </button>
              {categoriasUnicas.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCatFiltro(cat)}
                  className={cn(
                    'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                    catFiltro === cat ? 'bg-rodziny-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  )}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Totales de categoría seleccionada */}
          {catFiltro !== 'todas' && (
            <div className="flex gap-4">
              <div className="bg-white rounded-lg border border-surface-border px-4 py-3">
                <p className="text-xs text-gray-500">Productos</p>
                <p className="text-lg font-semibold text-gray-800">{prodMap.size}</p>
              </div>
              <div className="bg-white rounded-lg border border-surface-border px-4 py-3">
                <p className="text-xs text-gray-500">Unidades vendidas</p>
                <p className="text-lg font-semibold text-gray-800">
                  {[...prodMap.values()].reduce((s, v) => s + v.cantidad, 0).toLocaleString('es-AR')}
                </p>
              </div>
              <div className="bg-white rounded-lg border border-surface-border px-4 py-3">
                <p className="text-xs text-gray-500">Facturación</p>
                <p className="text-lg font-semibold text-gray-800">
                  {formatARS([...prodMap.values()].reduce((s, v) => s + v.total, 0))}
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Top por cantidad */}
          <div className="bg-white rounded-lg border border-surface-border overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-700">
                Top {Math.min(15, prodMap.size)} por unidades vendidas
                {catFiltro !== 'todas' && <span className="text-rodziny-700 ml-1">· {catFiltro}</span>}
              </h3>
            </div>
            {loading ? (
              <div className="p-8 text-center text-gray-400 text-sm">Cargando...</div>
            ) : topPorCantidad.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">Sin datos. Importá el archivo de ventas Fudo.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 w-8">#</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Producto</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">Uds</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {topPorCantidad.map((p, i) => (
                    <tr key={p.nombre} className="hover:bg-gray-50">
                      <td className="px-4 py-2 text-gray-400 text-xs">{i + 1}</td>
                      <td className="px-4 py-2">
                        <div className="font-medium text-gray-800 truncate max-w-[180px]">{p.nombre}</div>
                        {p.categoria && <div className="text-xs text-gray-400">{p.categoria}</div>}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-700 font-medium">{p.cantidad.toLocaleString('es-AR')}</td>
                      <td className="px-4 py-2 text-right text-gray-500 text-xs">{formatARS(p.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Top por monto */}
          <div className="bg-white rounded-lg border border-surface-border overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-700">
                Top {Math.min(15, prodMap.size)} por facturación
                {catFiltro !== 'todas' && <span className="text-rodziny-700 ml-1">· {catFiltro}</span>}
              </h3>
            </div>
            {loading ? (
              <div className="p-8 text-center text-gray-400 text-sm">Cargando...</div>
            ) : topPorMonto.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">Sin datos. Importá el archivo de ventas Fudo.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 w-8">#</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Producto</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">Total</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">Uds</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {topPorMonto.map((p, i) => (
                    <tr key={p.nombre} className="hover:bg-gray-50">
                      <td className="px-4 py-2 text-gray-400 text-xs">{i + 1}</td>
                      <td className="px-4 py-2">
                        <div className="font-medium text-gray-800 truncate max-w-[180px]">{p.nombre}</div>
                        {p.categoria && <div className="text-xs text-gray-400">{p.categoria}</div>}
                      </td>
                      <td className="px-4 py-2 text-right font-medium text-gray-800">{formatARS(p.total)}</td>
                      <td className="px-4 py-2 text-right text-gray-500 text-xs">{p.cantidad.toLocaleString('es-AR')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
        </div>
      )}

      {/* ── TAB: DÍAS ───────────────────────────────────────────────────── */}
      {tab === 'horario' && (
        <div className="space-y-6">
          {/* Gráfico tickets por día */}
          <div className="bg-white rounded-lg border border-surface-border p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Tickets por día de la semana</h3>
            {loading ? (
              <div className="text-sm text-gray-400">Cargando...</div>
            ) : diaData.every((d) => d.tickets === 0) ? (
              <div className="text-sm text-gray-400 text-center py-8">Sin datos para el período seleccionado.</div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={diaData}>
                  <XAxis dataKey="dia" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => [Number(v).toLocaleString('es-AR'), 'Tickets']} />
                  <Bar dataKey="tickets" fill="#4f8828" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Gráfico facturación por día */}
          <div className="bg-white rounded-lg border border-surface-border p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Facturación por día de la semana</h3>
            {!loading && diaData.some((d) => d.total > 0) && (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={diaData}>
                  <XAxis dataKey="dia" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000000).toFixed(1)}M`} />
                  <Tooltip formatter={(v) => [formatARS(Number(v)), 'Facturación']} />
                  <Bar dataKey="total" fill="#82c44e" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Tabla ranking por día */}
          <div className="bg-white rounded-lg border border-surface-border overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-700">Ranking por día</h3>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {['Día', 'Tickets', 'Facturación', 'Ticket prom.', '% del total'].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {[...diaData].sort((a, b) => b.total - a.total).map((d) => (
                  <tr key={d.dia} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium text-gray-700">{d.dia}</td>
                    <td className="px-4 py-2.5 text-gray-700">{d.tickets.toLocaleString('es-AR')}</td>
                    <td className="px-4 py-2.5 font-medium text-gray-800">{formatARS(d.total)}</td>
                    <td className="px-4 py-2.5 text-gray-600">{d.tickets > 0 ? formatARS(d.total / d.tickets) : '-'}</td>
                    <td className="px-4 py-2.5 text-rodziny-700 font-medium">{pct(d.total, totalVentas)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB: MEDIOS DE PAGO ──────────────────────────────────────────── */}
      {tab === 'medios' && (
        <div className="space-y-6">
          {loading ? (
            <div className="text-sm text-gray-400">Cargando...</div>
          ) : mediosData.length === 0 ? (
            <div className="text-sm text-gray-400 text-center py-12">Sin datos. Importá el archivo de ventas Fudo.</div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white rounded-lg border border-surface-border p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-4">Distribución de medios de pago</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={mediosData}
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      dataKey="value"
                      label={({ name, value }) => `${name as string} ${pct(Number(value), totalMedios)}`}
                      labelLine={false}
                    >
                      {mediosData.map((_, i) => <Cell key={i} fill={COLORES[i % COLORES.length]} />)}
                    </Pie>
                    <Legend />
                    <Tooltip formatter={(v) => formatARS(Number(v))} />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-white rounded-lg border border-surface-border overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-700">Detalle por medio</h3>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Medio</th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">Total</th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">%</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {mediosData.map((m, i) => (
                      <tr key={m.name} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: COLORES[i % COLORES.length] }} />
                          <span className="font-medium text-gray-700">{m.name}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-700">{formatARS(m.value)}</td>
                        <td className="px-4 py-2.5 text-right font-medium text-rodziny-700">{m.pctLabel}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50">
                      <td className="px-4 py-2.5 font-semibold text-gray-700">Total</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-gray-700">{formatARS(totalMedios)}</td>
                      <td className="px-4 py-2.5 text-right text-gray-500">100%</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )

  if (embedded) return inner
  return (
    <PageContainer title="Ventas" subtitle="Análisis de ventas por período">
      {inner}
    </PageContainer>
  )
}
