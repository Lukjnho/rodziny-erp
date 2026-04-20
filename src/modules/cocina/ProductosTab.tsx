import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { KPICard } from '@/components/ui/KPICard'
import { cn, formatARS } from '@/lib/utils'
import { useCostosRecetas } from './hooks/useCostosRecetas'

interface Producto {
  id: string
  nombre: string
  codigo: string
  tipo: 'pasta' | 'salsa' | 'postre' | 'relleno' | 'masa' | 'panificado'
  unidad: string
  minimo_produccion: number | null
  local: 'vedia' | 'saavedra' | 'ambos'
  activo: boolean
  receta_id: string | null
  precio_venta: number | null
  created_at: string
}

interface RecetaOpcion {
  id: string
  nombre: string
  rendimiento_kg: number | null
  rendimiento_porciones: number | null
}

const TIPOS = ['pasta', 'salsa', 'postre', 'relleno', 'masa', 'panificado'] as const
const TIPO_LABEL: Record<string, string> = {
  pasta: 'Pasta', salsa: 'Salsa', postre: 'Postre', relleno: 'Relleno', masa: 'Masa', panificado: 'Panificado',
}

type FiltroLocal = 'todos' | 'vedia' | 'saavedra' | 'ambos'

export function ProductosTab() {
  const qc = useQueryClient()
  const [busqueda, setBusqueda] = useState('')
  const [filtroTipo, setFiltroTipo] = useState<string>('todos')
  const [filtroLocal, setFiltroLocal] = useState<FiltroLocal>('todos')
  const [modalAbierto, setModalAbierto] = useState(false)
  const [editando, setEditando] = useState<Producto | null>(null)

  const { data: productos, isLoading } = useQuery({
    queryKey: ['cocina-productos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_productos')
        .select('*')
        .order('nombre')
      if (error) throw error
      return data as Producto[]
    },
  })

  const { data: recetas } = useQuery({
    queryKey: ['cocina-recetas-opciones'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_recetas')
        .select('id, nombre, rendimiento_kg, rendimiento_porciones')
        .eq('activo', true)
        .order('nombre')
      if (error) throw error
      return data as RecetaOpcion[]
    },
  })

  const { costos } = useCostosRecetas()

  const filtrados = useMemo(() => {
    let lista = productos ?? []
    if (filtroTipo !== 'todos') lista = lista.filter((p) => p.tipo === filtroTipo)
    if (filtroLocal === 'vedia') lista = lista.filter((p) => p.local === 'vedia' || p.local === 'ambos')
    else if (filtroLocal === 'saavedra') lista = lista.filter((p) => p.local === 'saavedra' || p.local === 'ambos')
    else if (filtroLocal === 'ambos') lista = lista.filter((p) => p.local === 'ambos')
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase()
      lista = lista.filter((p) => p.nombre.toLowerCase().includes(q) || p.codigo.toLowerCase().includes(q))
    }
    return lista
  }, [productos, filtroTipo, filtroLocal, busqueda])

  const costoProducto = useMemo(() => {
    const map = new Map<string, { costo: number | null; costoBase: string | null }>()
    for (const p of productos ?? []) {
      if (!p.receta_id) {
        map.set(p.id, { costo: null, costoBase: null })
        continue
      }
      const c = costos.get(p.receta_id)
      if (!c) {
        map.set(p.id, { costo: null, costoBase: null })
        continue
      }
      const u = (p.unidad ?? '').toLowerCase()
      const esPeso = u === 'kg' || u === 'litros' || u === 'lt'
      if (esPeso && c.costoPorKg != null) {
        map.set(p.id, { costo: c.costoPorKg, costoBase: 'kg' })
      } else if (!esPeso && c.costoPorPorcion != null) {
        map.set(p.id, { costo: c.costoPorPorcion, costoBase: 'porción' })
      } else {
        map.set(p.id, { costo: null, costoBase: null })
      }
    }
    return map
  }, [productos, costos])

  const kpis = useMemo(() => {
    const all = productos ?? []
    let conReceta = 0
    let margenSum = 0
    let margenN = 0
    for (const p of all) {
      if (p.receta_id) conReceta++
      const info = costoProducto.get(p.id)
      if (p.precio_venta && info?.costo && p.precio_venta > 0) {
        margenSum += (p.precio_venta - info.costo) / p.precio_venta
        margenN++
      }
    }
    return {
      total: all.length,
      activos: all.filter((p) => p.activo).length,
      conReceta,
      margenProm: margenN > 0 ? (margenSum / margenN) * 100 : null,
    }
  }, [productos, costoProducto])

  const toggleActivo = useMutation({
    mutationFn: async ({ id, activo }: { id: string; activo: boolean }) => {
      const { error } = await supabase.from('cocina_productos').update({ activo }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cocina-productos'] }),
  })

  const eliminar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('cocina_productos').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cocina-productos'] }),
  })

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard label="Total productos" value={String(kpis.total)} color="blue" loading={isLoading} />
        <KPICard label="Activos" value={String(kpis.activos)} color="green" loading={isLoading} />
        <KPICard label="Con receta" value={String(kpis.conReceta)} color="neutral" loading={isLoading} />
        <KPICard
          label="Margen promedio"
          value={kpis.margenProm != null ? `${kpis.margenProm.toFixed(1)}%` : '—'}
          color={kpis.margenProm != null && kpis.margenProm > 60 ? 'green' : kpis.margenProm != null && kpis.margenProm > 40 ? 'yellow' : 'neutral'}
          loading={isLoading}
        />
      </div>

      {/* Toolbar */}
      <div className="bg-white rounded-lg border border-surface-border p-3 flex flex-wrap gap-2 items-center">
        <input
          placeholder="Buscar por nombre o código..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm w-56"
        />
        <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-sm">
          <option value="todos">Todos los tipos</option>
          {TIPOS.map((t) => <option key={t} value={t}>{TIPO_LABEL[t]}</option>)}
        </select>
        <select value={filtroLocal} onChange={(e) => setFiltroLocal(e.target.value as FiltroLocal)} className="border border-gray-300 rounded px-2 py-1.5 text-sm">
          <option value="todos">Todos los locales</option>
          <option value="vedia">Vedia</option>
          <option value="saavedra">Saavedra</option>
          <option value="ambos">Ambos</option>
        </select>
        <button
          onClick={() => { setEditando(null); setModalAbierto(true) }}
          className="ml-auto bg-rodziny-700 hover:bg-rodziny-800 text-white text-sm rounded px-3 py-1.5"
        >+ Nuevo producto</button>
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-lg border border-surface-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border bg-gray-50 text-left text-xs text-gray-500 uppercase">
              <th className="px-4 py-2">Nombre</th>
              <th className="px-4 py-2">Tipo</th>
              <th className="px-4 py-2">Unidad</th>
              <th className="px-4 py-2">Local</th>
              <th className="px-4 py-2">Receta</th>
              <th className="px-4 py-2 text-right">Costo</th>
              <th className="px-4 py-2 text-right">Precio venta</th>
              <th className="px-4 py-2 text-right">Margen</th>
              <th className="px-4 py-2">Activo</th>
              <th className="px-4 py-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((p) => {
              const rec = recetas?.find((r) => r.id === p.receta_id) ?? null
              const info = costoProducto.get(p.id)
              const costo = info?.costo ?? null
              const margenAbs = p.precio_venta && costo ? p.precio_venta - costo : null
              const margenPct = p.precio_venta && costo && p.precio_venta > 0 ? ((p.precio_venta - costo) / p.precio_venta) * 100 : null
              return (
                <tr key={p.id} className="border-b border-surface-border hover:bg-gray-50">
                  <td className="px-4 py-2">
                    <div className="font-medium">{p.nombre}</div>
                    <div className="text-[10px] text-gray-400 font-mono">{p.codigo}</div>
                  </td>
                  <td className="px-4 py-2">
                    <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700">{TIPO_LABEL[p.tipo]}</span>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500">{p.unidad}</td>
                  <td className="px-4 py-2 capitalize text-xs text-gray-500">{p.local}</td>
                  <td className="px-4 py-2 text-xs">
                    {rec ? (
                      <span className="text-gray-700">{rec.nombre}</span>
                    ) : (
                      <span className="text-gray-300 italic">sin vincular</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {costo != null ? (
                      <div>
                        <div className="font-medium text-gray-800">{formatARS(costo)}</div>
                        <div className="text-[10px] text-gray-400">/{info?.costoBase}</div>
                      </div>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {p.precio_venta != null ? formatARS(p.precio_venta) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {margenPct != null ? (
                      <div>
                        <div className={cn('font-semibold', margenPct > 60 ? 'text-green-600' : margenPct > 40 ? 'text-amber-600' : 'text-red-600')}>
                          {margenPct.toFixed(1)}%
                        </div>
                        {margenAbs != null && <div className="text-[10px] text-gray-400">{formatARS(margenAbs)}</div>}
                      </div>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => toggleActivo.mutate({ id: p.id, activo: !p.activo })}
                      className={cn('w-8 h-5 rounded-full relative transition-colors', p.activo ? 'bg-green-500' : 'bg-gray-300')}
                    >
                      <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform', p.activo ? 'left-3.5' : 'left-0.5')} />
                    </button>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex gap-1">
                      <button
                        onClick={() => { setEditando(p); setModalAbierto(true) }}
                        className="text-blue-600 hover:text-blue-800 text-xs"
                      >Editar</button>
                      <button
                        onClick={() => { if (window.confirm(`¿Eliminar "${p.nombre}"?`)) eliminar.mutate(p.id) }}
                        className="text-red-500 hover:text-red-700 text-xs"
                      >Eliminar</button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {filtrados.length === 0 && (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400">{isLoading ? 'Cargando...' : 'No hay productos'}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {modalAbierto && (
        <ModalProducto
          producto={editando}
          recetas={recetas ?? []}
          costoProducto={costoProducto}
          onClose={() => setModalAbierto(false)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['cocina-productos'] }); setModalAbierto(false) }}
        />
      )}
    </div>
  )
}

function ModalProducto({
  producto,
  recetas,
  costoProducto,
  onClose,
  onSaved,
}: {
  producto: Producto | null
  recetas: RecetaOpcion[]
  costoProducto: Map<string, { costo: number | null; costoBase: string | null }>
  onClose: () => void
  onSaved: () => void
}) {
  const [nombre, setNombre] = useState(producto?.nombre ?? '')
  const [codigo, setCodigo] = useState(producto?.codigo ?? '')
  const [tipo, setTipo] = useState(producto?.tipo ?? 'pasta')
  const [unidad, setUnidad] = useState(producto?.unidad ?? 'porciones')
  const [minimo, setMinimo] = useState(producto?.minimo_produccion ?? 100)
  const [local, setLocal] = useState(producto?.local ?? 'vedia')
  const [recetaId, setRecetaId] = useState<string>(producto?.receta_id ?? '')
  const [precioVenta, setPrecioVenta] = useState<string>(producto?.precio_venta != null ? String(producto.precio_venta) : '')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const { costos } = useCostosRecetas()

  // costo vivo según receta y unidad seleccionadas
  const costoPreview = useMemo(() => {
    if (!recetaId) return null
    const c = costos.get(recetaId)
    if (!c) return null
    const u = unidad.toLowerCase()
    const esPeso = u === 'kg' || u === 'litros' || u === 'lt'
    if (esPeso && c.costoPorKg != null) return { costo: c.costoPorKg, base: 'kg' }
    if (!esPeso && c.costoPorPorcion != null) return { costo: c.costoPorPorcion, base: 'porción' }
    return null
  }, [recetaId, unidad, costos])

  const precioNum = parseFloat(precioVenta.replace(',', '.'))
  const margenPct = costoPreview && precioNum > 0 ? ((precioNum - costoPreview.costo) / precioNum) * 100 : null
  const _ = costoProducto // evitar warning de parámetro unused
  void _

  const guardar = async () => {
    if (!nombre.trim() || !codigo.trim()) { setError('Nombre y código son obligatorios'); return }
    setGuardando(true)
    setError('')
    const row = {
      nombre: nombre.trim(),
      codigo: codigo.trim().toLowerCase(),
      tipo,
      unidad,
      minimo_produccion: minimo,
      local,
      receta_id: recetaId || null,
      precio_venta: precioVenta !== '' ? parseFloat(precioVenta.replace(',', '.')) : null,
    }
    const { error: err } = producto
      ? await supabase.from('cocina_productos').update(row).eq('id', producto.id)
      : await supabase.from('cocina_productos').insert(row)
    if (err) { setError(err.message); setGuardando(false); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-gray-800 mb-4">{producto ? 'Editar producto' : 'Nuevo producto'}</h3>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Nombre</label>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm" placeholder="Sorrentino Jamón y Queso" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Código (para lotes)</label>
              <input value={codigo} onChange={(e) => setCodigo(e.target.value)} className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm font-mono" placeholder="sor" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Tipo</label>
              <select value={tipo} onChange={(e) => setTipo(e.target.value as Producto['tipo'])} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
                {TIPOS.map((t) => <option key={t} value={t}>{TIPO_LABEL[t]}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Unidad</label>
              <select value={unidad} onChange={(e) => setUnidad(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
                <option value="porciones">Porciones</option>
                <option value="unidades">Unidades</option>
                <option value="kg">Kg</option>
                <option value="litros">Litros</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Mín. producción</label>
              <input type="number" value={minimo} onChange={(e) => setMinimo(Number(e.target.value))} className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Local</label>
              <select value={local} onChange={(e) => setLocal(e.target.value as Producto['local'])} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
                <option value="vedia">Vedia</option>
                <option value="saavedra">Saavedra</option>
                <option value="ambos">Ambos</option>
              </select>
            </div>
          </div>

          {/* Vinculación con receta + precio venta */}
          <div className="border-t border-gray-200 pt-3 mt-3 space-y-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Receta vinculada (para calcular costo)</label>
              <select
                value={recetaId}
                onChange={(e) => setRecetaId(e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
              >
                <option value="">— Sin receta —</option>
                {recetas.map((r) => (
                  <option key={r.id} value={r.id}>{r.nombre}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Precio de venta (por {unidad})</label>
                <input
                  type="number"
                  step="0.01"
                  value={precioVenta}
                  onChange={(e) => setPrecioVenta(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                  placeholder="0"
                />
              </div>
              <div className="bg-gray-50 rounded px-3 py-1.5 text-xs space-y-0.5">
                <div className="flex justify-between">
                  <span className="text-gray-500">Costo:</span>
                  <span className="tabular-nums font-medium text-gray-800">
                    {costoPreview ? formatARS(costoPreview.costo) : '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Margen:</span>
                  <span className={cn(
                    'tabular-nums font-semibold',
                    margenPct == null ? 'text-gray-300' :
                    margenPct > 60 ? 'text-green-600' :
                    margenPct > 40 ? 'text-amber-600' : 'text-red-600'
                  )}>
                    {margenPct != null ? `${margenPct.toFixed(1)}%` : '—'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {error && <p className="text-red-500 text-xs mt-2">{error}</p>}

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-1.5 text-sm text-gray-600 hover:text-gray-800">Cancelar</button>
          <button onClick={guardar} disabled={guardando} className="bg-rodziny-700 hover:bg-rodziny-800 text-white text-sm rounded px-4 py-1.5 disabled:opacity-50">
            {guardando ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
