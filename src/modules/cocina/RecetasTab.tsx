import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { KPICard } from '@/components/ui/KPICard'

interface Receta {
  id: string
  nombre: string
  tipo: 'relleno' | 'masa' | 'salsa' | 'otro'
  rendimiento_kg: number | null
  rendimiento_porciones: number | null
  instrucciones: string | null
  activo: boolean
  created_at: string
}

const TIPOS = ['relleno', 'masa', 'salsa', 'otro'] as const
const TIPO_LABEL: Record<string, string> = {
  relleno: 'Relleno', masa: 'Masa', salsa: 'Salsa', otro: 'Otro',
}

export function RecetasTab() {
  const qc = useQueryClient()
  const [busqueda, setBusqueda] = useState('')
  const [filtroTipo, setFiltroTipo] = useState<string>('todos')
  const [modalAbierto, setModalAbierto] = useState(false)
  const [editando, setEditando] = useState<Receta | null>(null)

  const { data: recetas, isLoading } = useQuery({
    queryKey: ['cocina-recetas'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_recetas')
        .select('*')
        .order('nombre')
      if (error) throw error
      return data as Receta[]
    },
  })

  const filtrados = useMemo(() => {
    let lista = recetas ?? []
    if (filtroTipo !== 'todos') lista = lista.filter((r) => r.tipo === filtroTipo)
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase()
      lista = lista.filter((r) => r.nombre.toLowerCase().includes(q))
    }
    return lista
  }, [recetas, filtroTipo, busqueda])

  const kpis = useMemo(() => {
    const all = recetas ?? []
    return {
      total: all.length,
      rellenos: all.filter((r) => r.tipo === 'relleno').length,
      masas: all.filter((r) => r.tipo === 'masa').length,
      salsas: all.filter((r) => r.tipo === 'salsa').length,
    }
  }, [recetas])

  const eliminar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('cocina_recetas').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cocina-recetas'] }),
  })

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard label="Total recetas" value={String(kpis.total)} color="blue" loading={isLoading} />
        <KPICard label="Rellenos" value={String(kpis.rellenos)} color="green" loading={isLoading} />
        <KPICard label="Masas" value={String(kpis.masas)} color="neutral" loading={isLoading} />
        <KPICard label="Salsas" value={String(kpis.salsas)} color="neutral" loading={isLoading} />
      </div>

      {/* Toolbar */}
      <div className="bg-white rounded-lg border border-surface-border p-3 flex flex-wrap gap-2 items-center">
        <input
          placeholder="Buscar receta..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm w-56"
        />
        <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-sm">
          <option value="todos">Todos los tipos</option>
          {TIPOS.map((t) => <option key={t} value={t}>{TIPO_LABEL[t]}</option>)}
        </select>
        <button
          onClick={() => { setEditando(null); setModalAbierto(true) }}
          className="ml-auto bg-rodziny-700 hover:bg-rodziny-800 text-white text-sm rounded px-3 py-1.5"
        >+ Nueva receta</button>
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-lg border border-surface-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border bg-gray-50 text-left text-xs text-gray-500 uppercase">
              <th className="px-4 py-2">Nombre</th>
              <th className="px-4 py-2">Tipo</th>
              <th className="px-4 py-2">Rinde (kg)</th>
              <th className="px-4 py-2">Rinde (porciones)</th>
              <th className="px-4 py-2">Instrucciones</th>
              <th className="px-4 py-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((r) => (
              <tr key={r.id} className="border-b border-surface-border hover:bg-gray-50">
                <td className="px-4 py-2 font-medium">{r.nombre}</td>
                <td className="px-4 py-2">
                  <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700">{TIPO_LABEL[r.tipo]}</span>
                </td>
                <td className="px-4 py-2">{r.rendimiento_kg != null ? `${r.rendimiento_kg} kg` : '—'}</td>
                <td className="px-4 py-2">{r.rendimiento_porciones ?? '—'}</td>
                <td className="px-4 py-2 text-gray-500 max-w-xs truncate">{r.instrucciones || '—'}</td>
                <td className="px-4 py-2">
                  <div className="flex gap-1">
                    <button
                      onClick={() => { setEditando(r); setModalAbierto(true) }}
                      className="text-blue-600 hover:text-blue-800 text-xs"
                    >Editar</button>
                    <button
                      onClick={() => { if (window.confirm(`¿Eliminar "${r.nombre}"?`)) eliminar.mutate(r.id) }}
                      className="text-red-500 hover:text-red-700 text-xs"
                    >Eliminar</button>
                  </div>
                </td>
              </tr>
            ))}
            {filtrados.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">{isLoading ? 'Cargando...' : 'No hay recetas'}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {modalAbierto && (
        <ModalReceta
          receta={editando}
          onClose={() => setModalAbierto(false)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['cocina-recetas'] }); setModalAbierto(false) }}
        />
      )}
    </div>
  )
}

function ModalReceta({ receta, onClose, onSaved }: { receta: Receta | null; onClose: () => void; onSaved: () => void }) {
  const [nombre, setNombre] = useState(receta?.nombre ?? '')
  const [tipo, setTipo] = useState(receta?.tipo ?? 'relleno')
  const [rendKg, setRendKg] = useState(receta?.rendimiento_kg ?? '')
  const [rendPorciones, setRendPorciones] = useState(receta?.rendimiento_porciones ?? '')
  const [instrucciones, setInstrucciones] = useState(receta?.instrucciones ?? '')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const guardar = async () => {
    if (!nombre.trim()) { setError('El nombre es obligatorio'); return }
    setGuardando(true)
    setError('')
    const row = {
      nombre: nombre.trim(),
      tipo,
      rendimiento_kg: rendKg !== '' ? Number(rendKg) : null,
      rendimiento_porciones: rendPorciones !== '' ? Number(rendPorciones) : null,
      instrucciones: instrucciones.trim() || null,
      updated_at: new Date().toISOString(),
    }
    const { error: err } = receta
      ? await supabase.from('cocina_recetas').update(row).eq('id', receta.id)
      : await supabase.from('cocina_recetas').insert({ ...row, activo: true })
    if (err) { setError(err.message); setGuardando(false); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-gray-800 mb-4">{receta ? 'Editar receta' : 'Nueva receta'}</h3>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Nombre</label>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm" placeholder="Relleno Jamón y Queso" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Tipo</label>
            <select value={tipo} onChange={(e) => setTipo(e.target.value as Receta['tipo'])} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
              {TIPOS.map((t) => <option key={t} value={t}>{TIPO_LABEL[t]}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Rendimiento (kg)</label>
              <input type="number" step="0.1" value={rendKg} onChange={(e) => setRendKg(e.target.value)} className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm" placeholder="2.5" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Rendimiento (porciones)</label>
              <input type="number" value={rendPorciones} onChange={(e) => setRendPorciones(e.target.value)} className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm" placeholder="100" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Instrucciones</label>
            <textarea value={instrucciones} onChange={(e) => setInstrucciones(e.target.value)} rows={4} className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm" placeholder="Pasos de la receta..." />
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
