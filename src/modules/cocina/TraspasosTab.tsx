import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { KPICard } from '@/components/ui/KPICard'

interface Producto {
  id: string; nombre: string; codigo: string
}
interface Traspaso {
  id: string; producto_id: string; fecha: string; hora: string | null
  porciones: number; responsable: string | null; local: string; notas: string | null
  created_at: string
  producto?: { nombre: string } | null
}
interface MermaRow {
  id: string; producto_id: string; fecha: string; porciones: number
  motivo: string | null; responsable: string | null; local: string; notas: string | null
  created_at: string
  producto?: { nombre: string } | null
}

type FiltroLocal = 'todos' | 'vedia' | 'saavedra'

function hoy() {
  return new Date().toISOString().slice(0, 10)
}

export function TraspasosTab() {
  const qc = useQueryClient()
  const [fecha, setFecha] = useState(hoy())
  const [filtroLocal, setFiltroLocal] = useState<FiltroLocal>('todos')
  const [modalTraspaso, setModalTraspaso] = useState(false)
  const [modalMerma, setModalMerma] = useState(false)
  const [seccionMerma, setSeccionMerma] = useState(false)

  const { data: productos } = useQuery({
    queryKey: ['cocina-productos'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cocina_productos').select('id, nombre, codigo').eq('activo', true).order('nombre')
      if (error) throw error
      return data as Producto[]
    },
  })

  const { data: traspasos, isLoading: cargandoT } = useQuery({
    queryKey: ['cocina-traspasos', fecha],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_traspasos')
        .select('*, producto:cocina_productos(nombre)')
        .eq('fecha', fecha)
        .order('hora', { ascending: true, nullsFirst: false })
      if (error) throw error
      return data as Traspaso[]
    },
  })

  const { data: mermas, isLoading: cargandoM } = useQuery({
    queryKey: ['cocina-merma', fecha],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_merma')
        .select('*, producto:cocina_productos(nombre)')
        .eq('fecha', fecha)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as MermaRow[]
    },
  })

  const traspasosFiltrados = useMemo(() => {
    if (filtroLocal === 'todos') return traspasos ?? []
    return (traspasos ?? []).filter((t) => t.local === filtroLocal)
  }, [traspasos, filtroLocal])

  const mermasFiltradas = useMemo(() => {
    if (filtroLocal === 'todos') return mermas ?? []
    return (mermas ?? []).filter((m) => m.local === filtroLocal)
  }, [mermas, filtroLocal])

  const kpis = useMemo(() => ({
    traspasos: traspasosFiltrados.length,
    porcionesTraspasadas: traspasosFiltrados.reduce((s, t) => s + t.porciones, 0),
    mermas: mermasFiltradas.length,
    porcionesMerma: mermasFiltradas.reduce((s, m) => s + m.porciones, 0),
  }), [traspasosFiltrados, mermasFiltradas])

  const cambiarFecha = (delta: number) => {
    const d = new Date(fecha + 'T12:00:00')
    d.setDate(d.getDate() + delta)
    setFecha(d.toISOString().slice(0, 10))
  }

  const eliminarTraspaso = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('cocina_traspasos').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cocina-traspasos', fecha] })
      qc.invalidateQueries({ queryKey: ['cocina-stock'] })
      qc.invalidateQueries({ queryKey: ['cocina-stock-traspasos'] })
    },
  })

  const eliminarMerma = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('cocina_merma').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cocina-merma', fecha] })
      qc.invalidateQueries({ queryKey: ['cocina-stock'] })
      qc.invalidateQueries({ queryKey: ['cocina-stock-merma'] })
    },
  })

  const fechaLabel = new Date(fecha + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="bg-white rounded-lg border border-surface-border p-3 flex flex-wrap gap-2 items-center">
        <button onClick={() => cambiarFecha(-1)} className="px-2 py-1 text-lg hover:bg-gray-100 rounded">‹</button>
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-sm" />
        <button onClick={() => cambiarFecha(1)} className="px-2 py-1 text-lg hover:bg-gray-100 rounded">›</button>
        <span className="text-sm text-gray-500 capitalize">{fechaLabel}</span>
        {fecha !== hoy() && (
          <button onClick={() => setFecha(hoy())} className="text-xs text-rodziny-700 hover:underline">Hoy</button>
        )}
        <select value={filtroLocal} onChange={(e) => setFiltroLocal(e.target.value as FiltroLocal)} className="border border-gray-300 rounded px-2 py-1.5 text-sm ml-auto">
          <option value="todos">Todos los locales</option>
          <option value="vedia">Vedia</option>
          <option value="saavedra">Saavedra</option>
        </select>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard label="Traspasos hoy" value={String(kpis.traspasos)} color="blue" loading={cargandoT} />
        <KPICard label="Porciones traspasadas" value={String(kpis.porcionesTraspasadas)} color="green" loading={cargandoT} />
        <KPICard label="Mermas hoy" value={String(kpis.mermas)} color="red" loading={cargandoM} />
        <KPICard label="Porciones merma" value={String(kpis.porcionesMerma)} color="red" loading={cargandoM} />
      </div>

      {/* ── Traspasos ──────────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-gray-800">Traspasos depósito → mostrador</h3>
          <button onClick={() => setModalTraspaso(true)} className="bg-rodziny-700 hover:bg-rodziny-800 text-white text-sm rounded px-3 py-1.5">
            + Nuevo traspaso
          </button>
        </div>

        <div className="bg-white rounded-lg border border-surface-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border bg-gray-50 text-left text-xs text-gray-500 uppercase">
                <th className="px-4 py-2">Hora</th>
                <th className="px-4 py-2">Producto</th>
                <th className="px-4 py-2">Porciones</th>
                <th className="px-4 py-2">Local</th>
                <th className="px-4 py-2">Responsable</th>
                <th className="px-4 py-2">Notas</th>
                <th className="px-4 py-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {traspasosFiltrados.map((t) => (
                <tr key={t.id} className="border-b border-surface-border hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-xs">{t.hora?.slice(0, 5) || '—'}</td>
                  <td className="px-4 py-2 font-medium">{t.producto?.nombre ?? '—'}</td>
                  <td className="px-4 py-2 font-semibold">{t.porciones}</td>
                  <td className="px-4 py-2 capitalize">{t.local}</td>
                  <td className="px-4 py-2">{t.responsable || '—'}</td>
                  <td className="px-4 py-2 text-gray-500 max-w-xs truncate">{t.notas || '—'}</td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => { if (window.confirm('¿Eliminar este traspaso?')) eliminarTraspaso.mutate(t.id) }}
                      className="text-red-500 hover:text-red-700 text-xs"
                    >Eliminar</button>
                  </td>
                </tr>
              ))}
              {traspasosFiltrados.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">{cargandoT ? 'Cargando...' : 'No hay traspasos hoy'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Merma (colapsable) ─────────────────────────────────────────────────── */}
      <div>
        <button
          onClick={() => setSeccionMerma(!seccionMerma)}
          className="flex items-center gap-2 text-base font-semibold text-gray-800 mb-3"
        >
          <span className="text-xs">{seccionMerma ? '▼' : '▶'}</span>
          Merma / Descarte
          {kpis.mermas > 0 && <span className="text-xs bg-red-100 text-red-700 rounded-full px-2 py-0.5">{kpis.mermas}</span>}
        </button>

        {seccionMerma && (
          <div>
            <div className="flex justify-end mb-2">
              <button onClick={() => setModalMerma(true)} className="bg-red-600 hover:bg-red-700 text-white text-sm rounded px-3 py-1.5">
                + Registrar merma
              </button>
            </div>
            <div className="bg-white rounded-lg border border-surface-border overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-border bg-gray-50 text-left text-xs text-gray-500 uppercase">
                    <th className="px-4 py-2">Producto</th>
                    <th className="px-4 py-2">Porciones</th>
                    <th className="px-4 py-2">Motivo</th>
                    <th className="px-4 py-2">Local</th>
                    <th className="px-4 py-2">Responsable</th>
                    <th className="px-4 py-2">Notas</th>
                    <th className="px-4 py-2">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {mermasFiltradas.map((m) => (
                    <tr key={m.id} className="border-b border-surface-border hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium">{m.producto?.nombre ?? '—'}</td>
                      <td className="px-4 py-2 font-semibold text-red-600">{m.porciones}</td>
                      <td className="px-4 py-2 capitalize">{m.motivo || '—'}</td>
                      <td className="px-4 py-2 capitalize">{m.local}</td>
                      <td className="px-4 py-2">{m.responsable || '—'}</td>
                      <td className="px-4 py-2 text-gray-500 max-w-xs truncate">{m.notas || '—'}</td>
                      <td className="px-4 py-2">
                        <button
                          onClick={() => { if (window.confirm('¿Eliminar esta merma?')) eliminarMerma.mutate(m.id) }}
                          className="text-red-500 hover:text-red-700 text-xs"
                        >Eliminar</button>
                      </td>
                    </tr>
                  ))}
                  {mermasFiltradas.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">{cargandoM ? 'Cargando...' : 'No hay merma registrada hoy'}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Modales */}
      {modalTraspaso && (
        <ModalTraspaso
          fecha={fecha}
          productos={productos ?? []}
          onClose={() => setModalTraspaso(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['cocina-traspasos', fecha] })
            qc.invalidateQueries({ queryKey: ['cocina-stock'] })
            qc.invalidateQueries({ queryKey: ['cocina-stock-traspasos'] })
            setModalTraspaso(false)
          }}
        />
      )}
      {modalMerma && (
        <ModalMerma
          fecha={fecha}
          productos={productos ?? []}
          onClose={() => setModalMerma(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['cocina-merma', fecha] })
            qc.invalidateQueries({ queryKey: ['cocina-stock'] })
            qc.invalidateQueries({ queryKey: ['cocina-stock-merma'] })
            setModalMerma(false)
          }}
        />
      )}
    </div>
  )
}

// ── Modal: Nuevo traspaso ─────────────────────────────────────────────────────

function ModalTraspaso({ fecha, productos, onClose, onSaved }: {
  fecha: string; productos: Producto[]; onClose: () => void; onSaved: () => void
}) {
  const [productoId, setProductoId] = useState(productos[0]?.id ?? '')
  const [porciones, setPorciones] = useState('')
  const [hora, setHora] = useState(new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }))
  const [responsable, setResponsable] = useState('')
  const [local, setLocal] = useState<'vedia' | 'saavedra'>('vedia')
  const [notas, setNotas] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const guardar = async () => {
    if (!productoId || !porciones) { setError('Producto y porciones son obligatorios'); return }
    setGuardando(true)
    setError('')
    const { error: err } = await supabase.from('cocina_traspasos').insert({
      producto_id: productoId,
      fecha,
      hora: hora || null,
      porciones: Number(porciones),
      responsable: responsable.trim() || null,
      local,
      notas: notas.trim() || null,
    })
    if (err) { setError(err.message); setGuardando(false); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-gray-800 mb-4">Nuevo traspaso</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Producto</label>
            <select value={productoId} onChange={(e) => setProductoId(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
              {productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Porciones</label>
              <input type="number" value={porciones} onChange={(e) => setPorciones(e.target.value)} className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm" placeholder="50" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Hora</label>
              <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Responsable</label>
              <input value={responsable} onChange={(e) => setResponsable(e.target.value)} className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Local</label>
              <select value={local} onChange={(e) => setLocal(e.target.value as 'vedia' | 'saavedra')} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
                <option value="vedia">Vedia</option>
                <option value="saavedra">Saavedra</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Notas</label>
            <input value={notas} onChange={(e) => setNotas(e.target.value)} className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm" />
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

// ── Modal: Registrar merma ────────────────────────────────────────────────────

function ModalMerma({ fecha, productos, onClose, onSaved }: {
  fecha: string; productos: Producto[]; onClose: () => void; onSaved: () => void
}) {
  const [productoId, setProductoId] = useState(productos[0]?.id ?? '')
  const [porciones, setPorciones] = useState('')
  const [motivo, setMotivo] = useState<'rotura' | 'vencido' | 'otro'>('rotura')
  const [responsable, setResponsable] = useState('')
  const [local, setLocal] = useState<'vedia' | 'saavedra'>('vedia')
  const [notas, setNotas] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const guardar = async () => {
    if (!productoId || !porciones) { setError('Producto y porciones son obligatorios'); return }
    setGuardando(true)
    setError('')
    const { error: err } = await supabase.from('cocina_merma').insert({
      producto_id: productoId,
      fecha,
      porciones: Number(porciones),
      motivo,
      responsable: responsable.trim() || null,
      local,
      notas: notas.trim() || null,
    })
    if (err) { setError(err.message); setGuardando(false); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-gray-800 mb-4">Registrar merma</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Producto</label>
            <select value={productoId} onChange={(e) => setProductoId(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
              {productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Porciones</label>
              <input type="number" value={porciones} onChange={(e) => setPorciones(e.target.value)} className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Motivo</label>
              <select value={motivo} onChange={(e) => setMotivo(e.target.value as 'rotura' | 'vencido' | 'otro')} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
                <option value="rotura">Rotura</option>
                <option value="vencido">Vencido</option>
                <option value="otro">Otro</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Responsable</label>
              <input value={responsable} onChange={(e) => setResponsable(e.target.value)} className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Local</label>
              <select value={local} onChange={(e) => setLocal(e.target.value as 'vedia' | 'saavedra')} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
                <option value="vedia">Vedia</option>
                <option value="saavedra">Saavedra</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Notas</label>
            <input value={notas} onChange={(e) => setNotas(e.target.value)} className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm" />
          </div>
        </div>
        {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-1.5 text-sm text-gray-600 hover:text-gray-800">Cancelar</button>
          <button onClick={guardar} disabled={guardando} className="bg-red-600 hover:bg-red-700 text-white text-sm rounded px-4 py-1.5 disabled:opacity-50">
            {guardando ? 'Guardando...' : 'Registrar merma'}
          </button>
        </div>
      </div>
    </div>
  )
}
