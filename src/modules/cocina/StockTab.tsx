import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { KPICard } from '@/components/ui/KPICard'
import { cn } from '@/lib/utils'

interface Producto {
  id: string; nombre: string; codigo: string; tipo: string; unidad: string
  minimo_produccion: number | null; local: string; activo: boolean
}
interface LotePasta {
  producto_id: string; porciones: number; local: string; ubicacion: 'freezer_produccion' | 'camara_congelado'
}
interface Traspaso {
  producto_id: string; porciones: number; local: string
}
interface Merma {
  producto_id: string; porciones: number; local: string
}

type FiltroLocal = 'todos' | 'vedia' | 'saavedra'

interface StockRow {
  producto: Producto
  local: string
  producido: number
  fresco: number
  traspasado: number
  merma: number
  stock: number
}

export function StockTab() {
  const [filtroLocal, setFiltroLocal] = useState<FiltroLocal>('todos')
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'bajo' | 'sin_stock' | 'con_fresco'>('todos')

  const { data: productos } = useQuery({
    queryKey: ['cocina-productos'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cocina_productos').select('*').eq('activo', true).order('nombre')
      if (error) throw error
      return data as Producto[]
    },
  })

  const { data: lotesPasta } = useQuery({
    queryKey: ['cocina-stock-lotes'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cocina_lotes_pasta').select('producto_id, porciones, local, ubicacion')
      if (error) throw error
      return data as LotePasta[]
    },
  })

  const { data: traspasos } = useQuery({
    queryKey: ['cocina-stock-traspasos'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cocina_traspasos').select('producto_id, porciones, local')
      if (error) throw error
      return data as Traspaso[]
    },
  })

  const { data: mermas } = useQuery({
    queryKey: ['cocina-stock-merma'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cocina_merma').select('producto_id, porciones, local')
      if (error) throw error
      return data as Merma[]
    },
  })

  const isLoading = !productos || !lotesPasta || !traspasos || !mermas

  // Calcular stock por producto × local
  const stockRows = useMemo(() => {
    if (!productos || !lotesPasta || !traspasos || !mermas) return []

    const rows: StockRow[] = []
    const locales: string[] = filtroLocal === 'todos' ? ['vedia', 'saavedra'] : [filtroLocal]

    for (const prod of productos) {
      for (const loc of locales) {
        if (prod.local !== loc) continue

        // Producido en cámara = stock disponible. Fresco = pendiente de porcionar (no cuenta como stock).
        const producido = lotesPasta
          .filter((l) => l.producto_id === prod.id && l.local === loc && l.ubicacion === 'camara_congelado')
          .reduce((s, l) => s + l.porciones, 0)
        const fresco = lotesPasta
          .filter((l) => l.producto_id === prod.id && l.local === loc && l.ubicacion === 'freezer_produccion')
          .reduce((s, l) => s + l.porciones, 0)
        const traspasado = traspasos
          .filter((t) => t.producto_id === prod.id && t.local === loc)
          .reduce((s, t) => s + t.porciones, 0)
        const mermaTotal = mermas
          .filter((m) => m.producto_id === prod.id && m.local === loc)
          .reduce((s, m) => s + m.porciones, 0)

        const stock = producido - traspasado - mermaTotal

        // Solo mostrar si hay actividad o stock
        if (producido > 0 || fresco > 0 || traspasado > 0 || mermaTotal > 0) {
          rows.push({ producto: prod, local: loc, producido, fresco, traspasado, merma: mermaTotal, stock })
        }
      }
    }

    return rows.sort((a, b) => a.stock - b.stock) // los de menor stock primero
  }, [productos, lotesPasta, traspasos, mermas, filtroLocal])

  const kpis = useMemo(() => {
    const totalProductos = stockRows.length
    const bajoMinimo = stockRows.filter((r) =>
      r.producto.minimo_produccion && r.stock < r.producto.minimo_produccion && r.stock > 0
    ).length
    const sinStock = stockRows.filter((r) => r.stock <= 0).length
    const totalPorciones = stockRows.reduce((s, r) => s + Math.max(0, r.stock), 0)
    const totalFrescos = stockRows.reduce((s, r) => s + r.fresco, 0)
    const conFresco = stockRows.filter((r) => r.fresco > 0).length
    return { totalProductos, bajoMinimo, sinStock, totalPorciones, totalFrescos, conFresco }
  }, [stockRows])

  // Filtro de estado aplicado solo a la tabla (los KPIs muestran totales)
  const stockRowsFiltrados = useMemo(() => {
    if (filtroEstado === 'todos') return stockRows
    if (filtroEstado === 'bajo') {
      return stockRows.filter((r) => r.producto.minimo_produccion && r.stock < r.producto.minimo_produccion && r.stock > 0)
    }
    if (filtroEstado === 'sin_stock') return stockRows.filter((r) => r.stock <= 0)
    if (filtroEstado === 'con_fresco') return stockRows.filter((r) => r.fresco > 0)
    return stockRows
  }, [stockRows, filtroEstado])

  return (
    <div className="space-y-4">
      {/* KPIs — clickeables para filtrar la tabla */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KPICard
          label="Productos en stock"
          value={String(kpis.totalProductos)}
          color="blue"
          loading={isLoading}
          onClick={() => { setFiltroEstado('todos'); setFiltroLocal('todos') }}
        />
        <KPICard
          label="Bajo mínimo"
          value={String(kpis.bajoMinimo)}
          color="yellow"
          loading={isLoading}
          active={filtroEstado === 'bajo'}
          onClick={() => setFiltroEstado(filtroEstado === 'bajo' ? 'todos' : 'bajo')}
        />
        <KPICard
          label="Sin stock"
          value={String(kpis.sinStock)}
          color="red"
          loading={isLoading}
          active={filtroEstado === 'sin_stock'}
          onClick={() => setFiltroEstado(filtroEstado === 'sin_stock' ? 'todos' : 'sin_stock')}
        />
        <KPICard label="En cámara" value={String(kpis.totalPorciones)} color="green" loading={isLoading} />
        <KPICard
          label="Frescos (sala)"
          value={String(kpis.totalFrescos)}
          color={kpis.totalFrescos > 0 ? 'blue' : 'neutral'}
          loading={isLoading}
          active={filtroEstado === 'con_fresco'}
          onClick={kpis.conFresco > 0 ? () => setFiltroEstado(filtroEstado === 'con_fresco' ? 'todos' : 'con_fresco') : undefined}
        />
      </div>

      {/* Toolbar */}
      <div className="bg-white rounded-lg border border-surface-border p-3 flex flex-wrap gap-2 items-center">
        <select value={filtroLocal} onChange={(e) => setFiltroLocal(e.target.value as FiltroLocal)} className="border border-gray-300 rounded px-2 py-1.5 text-sm">
          <option value="todos">Todos los locales</option>
          <option value="vedia">Vedia</option>
          <option value="saavedra">Saavedra</option>
        </select>
        <span className="text-xs text-gray-400 ml-auto">Stock disponible = en cámara − traspasos − merma · Los frescos no cuentan hasta ser porcionados</span>
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-lg border border-surface-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border bg-gray-50 text-left text-xs text-gray-500 uppercase">
              <th className="px-4 py-2">Producto</th>
              <th className="px-4 py-2">Código</th>
              <th className="px-4 py-2">Local</th>
              <th className="px-4 py-2 text-right">En cámara</th>
              <th className="px-4 py-2 text-right">Frescos</th>
              <th className="px-4 py-2 text-right">Traspasado</th>
              <th className="px-4 py-2 text-right">Merma</th>
              <th className="px-4 py-2 text-right">Stock actual</th>
              <th className="px-4 py-2">Mín.</th>
              <th className="px-4 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {stockRowsFiltrados.map((r, i) => {
              const min = r.producto.minimo_produccion ?? 0
              const estado = r.stock <= 0 ? 'sin-stock' : r.stock < min ? 'bajo' : 'ok'
              return (
                <tr key={`${r.producto.id}-${r.local}-${i}`} className={cn(
                  'border-b border-surface-border',
                  estado === 'sin-stock' && 'bg-red-50',
                  estado === 'bajo' && 'bg-yellow-50',
                )}>
                  <td className="px-4 py-2 font-medium">{r.producto.nombre}</td>
                  <td className="px-4 py-2 font-mono text-xs">{r.producto.codigo}</td>
                  <td className="px-4 py-2 capitalize">{r.local}</td>
                  <td className="px-4 py-2 text-right">{r.producido}</td>
                  <td className="px-4 py-2 text-right">
                    {r.fresco > 0 ? <span className="text-blue-600 font-medium">{r.fresco}</span> : '—'}
                  </td>
                  <td className="px-4 py-2 text-right">{r.traspasado}</td>
                  <td className="px-4 py-2 text-right">{r.merma}</td>
                  <td className="px-4 py-2 text-right font-semibold">{r.stock}</td>
                  <td className="px-4 py-2">{min || '—'}</td>
                  <td className="px-4 py-2">
                    {estado === 'ok' && <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">OK</span>}
                    {estado === 'bajo' && <span className="px-2 py-0.5 rounded-full text-xs bg-yellow-100 text-yellow-700">Bajo mínimo</span>}
                    {estado === 'sin-stock' && <span className="px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-700">Sin stock</span>}
                  </td>
                </tr>
              )
            })}
            {stockRowsFiltrados.length === 0 && (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400">
                {isLoading
                  ? 'Cargando...'
                  : filtroEstado !== 'todos'
                    ? 'No hay productos con ese estado en el filtro actual'
                    : 'No hay datos de stock aún'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
