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
  local: 'vedia' | 'saavedra'
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

type FiltroLocal = 'todos' | 'vedia' | 'saavedra'

export function ProductosTab() {
  const qc = useQueryClient()
  const [busqueda, setBusqueda] = useState('')
  const [filtroTipo, setFiltroTipo] = useState<string>('todos')
  const [filtroLocal, setFiltroLocal] = useState<FiltroLocal>('todos')
  const [filtroActivo, setFiltroActivo] = useState<'todos' | 'activos' | 'inactivos'>('todos')
  const [filtroReceta, setFiltroReceta] = useState<'todos' | 'con_receta' | 'sin_receta'>('todos')
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
    if (filtroLocal === 'vedia') lista = lista.filter((p) => p.local === 'vedia')
    else if (filtroLocal === 'saavedra') lista = lista.filter((p) => p.local === 'saavedra')
    if (filtroActivo === 'activos') lista = lista.filter((p) => p.activo)
    else if (filtroActivo === 'inactivos') lista = lista.filter((p) => !p.activo)
    if (filtroReceta === 'con_receta') lista = lista.filter((p) => !!p.receta_id)
    else if (filtroReceta === 'sin_receta') lista = lista.filter((p) => !p.receta_id)
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase()
      lista = lista.filter((p) => p.nombre.toLowerCase().includes(q) || p.codigo.toLowerCase().includes(q))
    }
    return lista
  }, [productos, filtroTipo, filtroLocal, filtroActivo, filtroReceta, busqueda])

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
    return {
      total: all.length,
      activos: all.filter((p) => p.activo).length,
      conReceta: all.filter((p) => !!p.receta_id).length,
      pastas: all.filter((p) => p.tipo === 'pasta').length,
    }
  }, [productos])

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
      {/* KPIs — clickeables para filtrar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard
          label="Total productos"
          value={String(kpis.total)}
          color="blue"
          loading={isLoading}
          onClick={() => {
            setFiltroTipo('todos')
            setFiltroLocal('todos')
            setFiltroActivo('todos')
            setFiltroReceta('todos')
            setBusqueda('')
          }}
        />
        <KPICard
          label="Activos"
          value={String(kpis.activos)}
          color="green"
          loading={isLoading}
          active={filtroActivo === 'activos'}
          onClick={() => setFiltroActivo(filtroActivo === 'activos' ? 'todos' : 'activos')}
        />
        <KPICard
          label="Con receta"
          value={String(kpis.conReceta)}
          color="neutral"
          loading={isLoading}
          active={filtroReceta === 'con_receta'}
          onClick={() => setFiltroReceta(filtroReceta === 'con_receta' ? 'todos' : 'con_receta')}
        />
        <KPICard
          label="Pastas"
          value={String(kpis.pastas)}
          color="neutral"
          loading={isLoading}
          active={filtroTipo === 'pasta'}
          onClick={() => setFiltroTipo(filtroTipo === 'pasta' ? 'todos' : 'pasta')}
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
              <th className="px-4 py-2">Activo</th>
              <th className="px-4 py-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((p) => {
              const rec = recetas?.find((r) => r.id === p.receta_id) ?? null
              const info = costoProducto.get(p.id)
              const costo = info?.costo ?? null
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
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">{isLoading ? 'Cargando...' : 'No hay productos'}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {modalAbierto && (
        <ModalProducto
          producto={editando}
          recetas={recetas ?? []}
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
  onClose,
  onSaved,
}: {
  producto: Producto | null
  recetas: RecetaOpcion[]
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
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const { costos } = useCostosRecetas()

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
              </select>
            </div>
          </div>

          <div className="border-t border-gray-200 pt-3 mt-3 space-y-2">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Receta vinculada</label>
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
            {costoPreview && (
              <div className="bg-gray-50 rounded px-3 py-1.5 text-xs flex justify-between">
                <span className="text-gray-500">Costo calculado:</span>
                <span className="tabular-nums font-medium text-gray-800">
                  {formatARS(costoPreview.costo)} / {costoPreview.base}
                </span>
              </div>
            )}
            <p className="text-[10px] text-gray-400 italic">
              Para cargar precio de venta y margen, ir a <strong>Finanzas → Costeo</strong>.
            </p>
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
