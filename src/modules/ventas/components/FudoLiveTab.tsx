import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { LocalSelector } from '@/components/ui/LocalSelector'
import { KPICard } from '@/components/ui/KPICard'
import { formatARS, cn } from '@/lib/utils'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts'

const COLORES = ['#4f8828', '#65a832', '#82c44e', '#a3d96e', '#c5ef97', '#2D5016', '#1b3b0d', '#f59e0b']
const DIAS_LABEL: Record<number, string> = { 0: 'Dom', 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie', 6: 'Sáb' }

function pct(v: number, total: number) {
  return total > 0 ? ((v / total) * 100).toFixed(1) + '%' : '0%'
}

interface ProductoRanking {
  productId: string
  nombre: string
  categoria: string
  categoriaId: string
  precio: number
  costo: number | null
  cantidad: number
  facturacion: number
  tickets: number
}

interface CategoriaResumen {
  nombre: string
  cantidad: number
  facturacion: number
  productos: number
}

interface FudoProductosData {
  local: string
  fechaDesde: string
  fechaHasta: string
  dias: number
  totalVentas: number
  cantidadTickets: number
  ticketPromedio: number
  totalItems: number
  productosUnicos: number
  itemsPorTicket: number
  ventasDiarias: number
  ticketsDiarios: number
  ranking: ProductoRanking[]
  porCategoria: CategoriaResumen[]
  porHora: Record<number, { tickets: number; total: number }>
  porDiaSemana: Record<number, { tickets: number; total: number }>
}

type Seccion = 'ranking' | 'categorias' | 'horario'
type OrdenRanking = 'facturacion' | 'cantidad' | 'margen'

export function FudoLiveTab() {
  const [local, setLocal] = useState<'vedia' | 'saavedra'>('vedia')
  const hoy = new Date().toISOString().split('T')[0]
  const hace7 = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]
  const [fechaDesde, setFechaDesde] = useState(hace7)
  const [fechaHasta, setFechaHasta] = useState(hoy)
  const [seccion, setSeccion] = useState<Seccion>('ranking')
  const [ordenRanking, setOrdenRanking] = useState<OrdenRanking>('facturacion')
  const [catFiltro, setCatFiltro] = useState<string>('todas')
  const [limite, setLimite] = useState(20)

  const { data, isLoading, error } = useQuery({
    queryKey: ['fudo-productos', local, fechaDesde, fechaHasta],
    queryFn: async () => {
      const { data: resp, error: err } = await supabase.functions.invoke('fudo-productos', {
        body: { local, fechaDesde, fechaHasta },
      })
      if (err) throw new Error(`Edge Function: ${err.message}`)
      if (!resp?.ok) throw new Error(resp?.error ?? 'Error desconocido')
      return resp.data as FudoProductosData
    },
    staleTime: 5 * 60 * 1000, // cache 5 min
  })

  // Categorías únicas para filtro
  const categorias = useMemo(() => {
    if (!data) return []
    return [...new Set(data.ranking.map((p) => p.categoria))].sort()
  }, [data])

  // Ranking filtrado y ordenado
  const rankingFiltrado = useMemo(() => {
    if (!data) return []
    let items = data.ranking
    if (catFiltro !== 'todas') items = items.filter((p) => p.categoria === catFiltro)
    if (ordenRanking === 'cantidad') items = [...items].sort((a, b) => b.cantidad - a.cantidad)
    else if (ordenRanking === 'margen') {
      items = [...items]
        .filter((p) => p.costo !== null && p.costo > 0)
        .sort((a, b) => {
          const mA = a.precio > 0 && a.costo ? ((a.precio - a.costo) / a.precio) * 100 : 0
          const mB = b.precio > 0 && b.costo ? ((b.precio - b.costo) / b.precio) * 100 : 0
          return mB - mA
        })
    }
    // facturacion ya viene ordenado por default
    return items.slice(0, limite)
  }, [data, catFiltro, ordenRanking, limite])

  // Datos por hora
  const horaData = useMemo(() => {
    if (!data?.porHora) return []
    return Array.from({ length: 24 }, (_, i) => ({
      hora: `${String(i).padStart(2, '0')}hs`,
      tickets: data.porHora[i]?.tickets ?? 0,
      total: data.porHora[i]?.total ?? 0,
    })).filter((h) => h.tickets > 0)
  }, [data])

  // Datos por día de semana
  const diaData = useMemo(() => {
    if (!data?.porDiaSemana) return []
    return [1, 2, 3, 4, 5, 6, 0].map((d) => ({
      dia: DIAS_LABEL[d],
      tickets: data.porDiaSemana[d]?.tickets ?? 0,
      total: data.porDiaSemana[d]?.total ?? 0,
    }))
  }, [data])

  // Pie data categorías
  const catPieData = useMemo(() => {
    if (!data) return []
    return data.porCategoria.map((c) => ({ name: c.nombre, value: c.facturacion }))
  }, [data])

  const totalCatFact = data?.porCategoria.reduce((s, c) => s + c.facturacion, 0) ?? 0

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="bg-white rounded-lg border border-surface-border p-3 flex flex-wrap items-center gap-3">
        <LocalSelector value={local} onChange={(v) => setLocal(v as 'vedia' | 'saavedra')} />
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Desde</label>
          <input type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Hasta</label>
          <input type="date" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm" />
        </div>
        {/* Presets rápidos */}
        <div className="flex gap-1 ml-2">
          {[
            { label: 'Hoy', d: hoy, h: hoy },
            { label: '7 días', d: hace7, h: hoy },
            { label: '30 días', d: new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0], h: hoy },
          ].map((p) => (
            <button key={p.label} onClick={() => { setFechaDesde(p.d); setFechaHasta(p.h) }}
              className={cn(
                'px-2 py-1 text-xs rounded',
                fechaDesde === p.d && fechaHasta === p.h
                  ? 'bg-rodziny-800 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              )}>
              {p.label}
            </button>
          ))}
        </div>
        {isLoading && <span className="text-xs text-gray-400 animate-pulse ml-auto">Consultando Fudo...</span>}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-sm text-red-700">{(error as Error).message}</p>
        </div>
      )}

      {data && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <KPICard label="Tickets" value={data.cantidadTickets.toLocaleString('es-AR')} color="blue" />
            <KPICard label="Venta total" value={formatARS(data.totalVentas)} color="green" />
            <KPICard label="Ticket promedio" value={formatARS(data.ticketPromedio)} color="yellow" />
            <KPICard label="Productos vendidos" value={data.totalItems.toLocaleString('es-AR')} color="neutral" />
            <KPICard label="Items / ticket" value={String(data.itemsPorTicket)} color="neutral" />
            <KPICard label="Productos únicos" value={String(data.productosUnicos)} color="neutral" />
          </div>

          {data.dias > 1 && (
            <div className="grid grid-cols-2 md:grid-cols-2 gap-3">
              <KPICard label="Venta diaria promedio" value={formatARS(data.ventasDiarias)} color="green" />
              <KPICard label="Tickets diarios promedio" value={String(data.ticketsDiarios)} color="blue" />
            </div>
          )}

          {/* Sub-tabs */}
          <div className="flex gap-1 border-b border-gray-200">
            {([
              ['ranking', 'Ranking de productos'],
              ['categorias', 'Categorías'],
              ['horario', 'Por hora / día'],
            ] as [Seccion, string][]).map(([s, label]) => (
              <button key={s} onClick={() => setSeccion(s)}
                className={cn(
                  'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
                  seccion === s ? 'border-rodziny-600 text-rodziny-800' : 'border-transparent text-gray-500 hover:text-gray-700'
                )}>
                {label}
              </button>
            ))}
          </div>

          {/* ── RANKING ── */}
          {seccion === 'ranking' && (
            <div className="space-y-3">
              {/* Controles */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex rounded-md border border-gray-300 overflow-hidden">
                  {([
                    ['facturacion', 'Facturación'],
                    ['cantidad', 'Unidades'],
                    ['margen', 'Margen'],
                  ] as [OrdenRanking, string][]).map(([o, label]) => (
                    <button key={o} onClick={() => setOrdenRanking(o)}
                      className={cn(
                        'px-3 py-1.5 text-xs font-medium transition-colors',
                        ordenRanking === o ? 'bg-rodziny-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                      )}>
                      {label}
                    </button>
                  ))}
                </div>

                <select value={catFiltro} onChange={(e) => setCatFiltro(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1.5 text-xs">
                  <option value="todas">Todas las categorías</option>
                  {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>

                <select value={limite} onChange={(e) => setLimite(Number(e.target.value))}
                  className="border border-gray-300 rounded px-2 py-1.5 text-xs">
                  <option value={10}>Top 10</option>
                  <option value={20}>Top 20</option>
                  <option value={50}>Top 50</option>
                  <option value={999}>Todos</option>
                </select>
              </div>

              {/* Tabla ranking */}
              <div className="bg-white rounded-lg border border-surface-border overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr className="text-[10px] uppercase text-gray-500">
                        <th className="px-3 py-2.5 text-left w-8">#</th>
                        <th className="px-3 py-2.5 text-left">Producto</th>
                        <th className="px-3 py-2.5 text-left">Categoría</th>
                        <th className="px-3 py-2.5 text-right">Uds</th>
                        <th className="px-3 py-2.5 text-right">Facturación</th>
                        <th className="px-3 py-2.5 text-right">% ventas</th>
                        <th className="px-3 py-2.5 text-right">Precio</th>
                        <th className="px-3 py-2.5 text-right">Costo</th>
                        <th className="px-3 py-2.5 text-right">Margen</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {rankingFiltrado.map((p, i) => {
                        const margen = p.costo && p.precio > 0 ? ((p.precio - p.costo) / p.precio) * 100 : null
                        return (
                          <tr key={p.productId} className="hover:bg-gray-50">
                            <td className="px-3 py-2 text-gray-400 text-xs">{i + 1}</td>
                            <td className="px-3 py-2 font-medium text-gray-900 max-w-[200px] truncate">{p.nombre}</td>
                            <td className="px-3 py-2 text-xs text-gray-500">{p.categoria}</td>
                            <td className="px-3 py-2 text-right tabular-nums font-medium">{p.cantidad.toLocaleString('es-AR')}</td>
                            <td className="px-3 py-2 text-right tabular-nums font-medium text-green-700">{formatARS(p.facturacion)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-xs text-gray-500">{pct(p.facturacion, data.totalVentas)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-xs">{formatARS(p.precio)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-xs text-gray-400">
                              {p.costo ? formatARS(p.costo) : '—'}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {margen !== null ? (
                                <span className={cn(
                                  'text-xs font-medium',
                                  margen >= 60 ? 'text-green-700' : margen >= 40 ? 'text-amber-700' : 'text-red-700'
                                )}>
                                  {margen.toFixed(1)}%
                                </span>
                              ) : (
                                <span className="text-xs text-gray-300">—</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {rankingFiltrado.length === 0 && (
                  <div className="p-8 text-center text-sm text-gray-400">
                    {ordenRanking === 'margen' ? 'No hay productos con costo cargado en Fudo' : 'Sin datos para el período seleccionado'}
                  </div>
                )}
              </div>

              {/* Gráfico top 10 barras */}
              {rankingFiltrado.length > 0 && (
                <div className="bg-white rounded-lg border border-surface-border p-5">
                  <h3 className="text-sm font-semibold text-gray-700 mb-4">
                    Top {Math.min(10, rankingFiltrado.length)} por {ordenRanking === 'cantidad' ? 'unidades' : 'facturación'}
                  </h3>
                  <ResponsiveContainer width="100%" height={Math.min(10, rankingFiltrado.length) * 36 + 40}>
                    <BarChart
                      data={rankingFiltrado.slice(0, 10).map((p) => ({
                        nombre: p.nombre.length > 25 ? p.nombre.substring(0, 22) + '...' : p.nombre,
                        valor: ordenRanking === 'cantidad' ? p.cantidad : p.facturacion,
                      }))}
                      layout="vertical"
                      margin={{ left: 10, right: 20 }}
                    >
                      <XAxis type="number" tick={{ fontSize: 11 }}
                        tickFormatter={(v) => ordenRanking === 'cantidad' ? String(v) : `$${(v / 1000).toFixed(0)}k`} />
                      <YAxis type="category" dataKey="nombre" width={160} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v) => ordenRanking === 'cantidad'
                        ? [Number(v).toLocaleString('es-AR'), 'Unidades']
                        : [formatARS(Number(v)), 'Facturación']} />
                      <Bar dataKey="valor" fill="#4f8828" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

          {/* ── CATEGORÍAS ── */}
          {seccion === 'categorias' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Pie chart */}
              <div className="bg-white rounded-lg border border-surface-border p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-4">Mix de ventas por categoría</h3>
                {catPieData.length > 0 && (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie data={catPieData} cx="50%" cy="50%" outerRadius={100} dataKey="value"
                        label={({ name, value }) => `${name as string} ${pct(Number(value), totalCatFact)}`}
                        labelLine={false}>
                        {catPieData.map((_, i) => <Cell key={i} fill={COLORES[i % COLORES.length]} />)}
                      </Pie>
                      <Legend />
                      <Tooltip formatter={(v) => formatARS(Number(v))} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Tabla categorías */}
              <div className="bg-white rounded-lg border border-surface-border overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-700">Detalle por categoría</h3>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Categoría</th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">Productos</th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">Uds</th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">Facturación</th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">%</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {data.porCategoria.map((c, i) => (
                      <tr key={c.nombre} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: COLORES[i % COLORES.length] }} />
                          <span className="font-medium text-gray-700">{c.nombre}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-600">{c.productos}</td>
                        <td className="px-4 py-2.5 text-right text-gray-600">{c.cantidad.toLocaleString('es-AR')}</td>
                        <td className="px-4 py-2.5 text-right font-medium text-gray-800">{formatARS(c.facturacion)}</td>
                        <td className="px-4 py-2.5 text-right font-medium text-rodziny-700">{pct(c.facturacion, totalCatFact)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── POR HORA / DÍA ── */}
          {seccion === 'horario' && (
            <div className="space-y-6">
              {/* Por hora */}
              <div className="bg-white rounded-lg border border-surface-border p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-4">Tickets por hora del día</h3>
                {horaData.length > 0 && (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={horaData}>
                      <XAxis dataKey="hora" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v) => [Number(v).toLocaleString('es-AR'), 'Tickets']} />
                      <Bar dataKey="tickets" fill="#4f8828" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Por día de semana */}
              {data.dias > 1 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="bg-white rounded-lg border border-surface-border p-5">
                    <h3 className="text-sm font-semibold text-gray-700 mb-4">Tickets por día de semana</h3>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={diaData}>
                        <XAxis dataKey="dia" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(v) => [Number(v).toLocaleString('es-AR'), 'Tickets']} />
                        <Bar dataKey="tickets" fill="#4f8828" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="bg-white rounded-lg border border-surface-border p-5">
                    <h3 className="text-sm font-semibold text-gray-700 mb-4">Facturación por día de semana</h3>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={diaData}>
                        <XAxis dataKey="dia" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                        <Tooltip formatter={(v) => [formatARS(Number(v)), 'Facturación']} />
                        <Bar dataKey="total" fill="#82c44e" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Tabla resumen por hora */}
              <div className="bg-white rounded-lg border border-surface-border overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-700">Detalle por hora</h3>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Hora</th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">Tickets</th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">Facturación</th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">Ticket prom.</th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">% del total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {horaData.map((h) => (
                      <tr key={h.hora} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 font-medium text-gray-700">{h.hora}</td>
                        <td className="px-4 py-2.5 text-right text-gray-600">{h.tickets.toLocaleString('es-AR')}</td>
                        <td className="px-4 py-2.5 text-right font-medium text-gray-800">{formatARS(h.total)}</td>
                        <td className="px-4 py-2.5 text-right text-gray-600">{h.tickets > 0 ? formatARS(h.total / h.tickets) : '—'}</td>
                        <td className="px-4 py-2.5 text-right text-rodziny-700 font-medium">{pct(h.total, data.totalVentas)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {!data && !isLoading && !error && (
        <div className="bg-white rounded-lg border border-surface-border p-12 text-center">
          <p className="text-gray-400 text-sm">Seleccioná un rango de fechas y hacé click para consultar Fudo</p>
        </div>
      )}
    </div>
  )
}
