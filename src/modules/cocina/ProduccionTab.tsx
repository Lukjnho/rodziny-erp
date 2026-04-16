import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { KPICard } from '@/components/ui/KPICard'

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface Producto {
  id: string; nombre: string; codigo: string; tipo: string
}
interface Receta {
  id: string; nombre: string; tipo: string; rendimiento_kg: number | null
}
interface LoteRelleno {
  id: string; receta_id: string; fecha: string; cantidad_recetas: number
  peso_total_kg: number; responsable: string | null; local: string; notas: string | null
  created_at: string
  receta?: { nombre: string } | null
}
interface LotePasta {
  id: string; producto_id: string; lote_relleno_id: string | null; fecha: string
  codigo_lote: string; receta_masa_id: string | null; masa_kg: number | null
  relleno_kg: number | null; porciones: number; responsable: string | null
  local: string; notas: string | null; created_at: string
  producto?: { nombre: string; codigo: string } | null
  lote_relleno?: { receta?: { nombre: string } | null; peso_total_kg: number } | null
  receta_masa?: { nombre: string } | null
}

type FiltroLocal = 'todos' | 'vedia' | 'saavedra'

function hoy() {
  return new Date().toISOString().slice(0, 10)
}

function formatDDMM(fecha: string) {
  const [, m, d] = fecha.split('-')
  return `${d}${m}`
}

// ── Componente principal ──────────────────────────────────────────────────────

export function ProduccionTab() {
  const qc = useQueryClient()
  const [fecha, setFecha] = useState(hoy())
  const [filtroLocal, setFiltroLocal] = useState<FiltroLocal>('todos')

  // Modales
  const [modalRelleno, setModalRelleno] = useState(false)
  const [modalPasta, setModalPasta] = useState(false)

  // Catálogos
  const { data: productos } = useQuery({
    queryKey: ['cocina-productos'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cocina_productos').select('id, nombre, codigo, tipo').eq('activo', true).order('nombre')
      if (error) throw error
      return data as Producto[]
    },
  })

  const { data: recetas } = useQuery({
    queryKey: ['cocina-recetas'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cocina_recetas').select('id, nombre, tipo, rendimiento_kg').eq('activo', true).order('nombre')
      if (error) throw error
      return data as Receta[]
    },
  })

  // Lotes del día
  const { data: lotesRelleno, isLoading: cargandoR } = useQuery({
    queryKey: ['cocina-lotes-relleno', fecha],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_relleno')
        .select('*, receta:cocina_recetas(nombre)')
        .eq('fecha', fecha)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as LoteRelleno[]
    },
  })

  const { data: lotesPasta, isLoading: cargandoP } = useQuery({
    queryKey: ['cocina-lotes-pasta', fecha],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_pasta')
        .select('*, producto:cocina_productos(nombre, codigo), lote_relleno:cocina_lotes_relleno(peso_total_kg, receta:cocina_recetas(nombre)), receta_masa:cocina_recetas(nombre)')
        .eq('fecha', fecha)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as LotePasta[]
    },
  })

  // Filtrar por local
  const rellenosFiltrados = useMemo(() => {
    if (filtroLocal === 'todos') return lotesRelleno ?? []
    return (lotesRelleno ?? []).filter((l) => l.local === filtroLocal)
  }, [lotesRelleno, filtroLocal])

  const pastasFiltradas = useMemo(() => {
    if (filtroLocal === 'todos') return lotesPasta ?? []
    return (lotesPasta ?? []).filter((l) => l.local === filtroLocal)
  }, [lotesPasta, filtroLocal])

  // KPIs
  const kpiRelleno = useMemo(() => ({
    lotes: rellenosFiltrados.length,
    kgTotal: rellenosFiltrados.reduce((s, l) => s + l.peso_total_kg, 0),
  }), [rellenosFiltrados])

  const kpiPasta = useMemo(() => ({
    lotes: pastasFiltradas.length,
    porcionesTotal: pastasFiltradas.reduce((s, l) => s + l.porciones, 0),
    tiposDistintos: new Set(pastasFiltradas.map((l) => l.producto_id)).size,
  }), [pastasFiltradas])

  // Navegación de fecha
  const cambiarFecha = (delta: number) => {
    const d = new Date(fecha + 'T12:00:00')
    d.setDate(d.getDate() + delta)
    setFecha(d.toISOString().slice(0, 10))
  }

  // Eliminar
  const eliminarRelleno = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('cocina_lotes_relleno').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cocina-lotes-relleno', fecha] }),
  })

  const eliminarPasta = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('cocina_lotes_pasta').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cocina-lotes-pasta', fecha] })
      qc.invalidateQueries({ queryKey: ['cocina-stock'] })
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

      {/* ── Sección: Rellenos del día ────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-gray-800">Rellenos del día</h3>
          <button onClick={() => setModalRelleno(true)} className="bg-rodziny-700 hover:bg-rodziny-800 text-white text-sm rounded px-3 py-1.5">
            + Registrar relleno
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
          <KPICard label="Lotes de relleno" value={String(kpiRelleno.lotes)} color="green" loading={cargandoR} />
          <KPICard label="Total kg" value={`${kpiRelleno.kgTotal.toFixed(1)} kg`} color="blue" loading={cargandoR} />
        </div>

        <div className="bg-white rounded-lg border border-surface-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border bg-gray-50 text-left text-xs text-gray-500 uppercase">
                <th className="px-4 py-2">Receta</th>
                <th className="px-4 py-2">Recetas</th>
                <th className="px-4 py-2">Peso total</th>
                <th className="px-4 py-2">Local</th>
                <th className="px-4 py-2">Responsable</th>
                <th className="px-4 py-2">Notas</th>
                <th className="px-4 py-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rellenosFiltrados.map((l) => (
                <tr key={l.id} className="border-b border-surface-border hover:bg-gray-50">
                  <td className="px-4 py-2 font-medium">{l.receta?.nombre ?? '—'}</td>
                  <td className="px-4 py-2">{l.cantidad_recetas}</td>
                  <td className="px-4 py-2">{l.peso_total_kg} kg</td>
                  <td className="px-4 py-2 capitalize">{l.local}</td>
                  <td className="px-4 py-2">{l.responsable || '—'}</td>
                  <td className="px-4 py-2 text-gray-500 max-w-xs truncate">{l.notas || '—'}</td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => { if (window.confirm('¿Eliminar este lote de relleno?')) eliminarRelleno.mutate(l.id) }}
                      className="text-red-500 hover:text-red-700 text-xs"
                    >Eliminar</button>
                  </td>
                </tr>
              ))}
              {rellenosFiltrados.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">{cargandoR ? 'Cargando...' : 'No hay rellenos registrados hoy'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Sección: Pastas del día ──────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-gray-800">Pastas del día</h3>
          <button onClick={() => setModalPasta(true)} className="bg-rodziny-700 hover:bg-rodziny-800 text-white text-sm rounded px-3 py-1.5">
            + Registrar pasta
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
          <KPICard label="Lotes de pasta" value={String(kpiPasta.lotes)} color="green" loading={cargandoP} />
          <KPICard label="Total porciones" value={String(kpiPasta.porcionesTotal)} color="blue" loading={cargandoP} />
          <KPICard label="Tipos distintos" value={String(kpiPasta.tiposDistintos)} color="neutral" loading={cargandoP} />
        </div>

        <div className="bg-white rounded-lg border border-surface-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border bg-gray-50 text-left text-xs text-gray-500 uppercase">
                <th className="px-4 py-2">Código lote</th>
                <th className="px-4 py-2">Producto</th>
                <th className="px-4 py-2">Relleno</th>
                <th className="px-4 py-2">Masa</th>
                <th className="px-4 py-2">Porciones</th>
                <th className="px-4 py-2">Local</th>
                <th className="px-4 py-2">Responsable</th>
                <th className="px-4 py-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {pastasFiltradas.map((l) => (
                <tr key={l.id} className="border-b border-surface-border hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-xs font-medium">{l.codigo_lote}</td>
                  <td className="px-4 py-2 font-medium">{l.producto?.nombre ?? '—'}</td>
                  <td className="px-4 py-2 text-gray-600">
                    {l.lote_relleno?.receta?.nombre
                      ? `${l.lote_relleno.receta.nombre} (${l.relleno_kg ?? '?'} kg)`
                      : 'Sin relleno'}
                  </td>
                  <td className="px-4 py-2 text-gray-600">
                    {l.receta_masa?.nombre
                      ? `${l.receta_masa.nombre} (${l.masa_kg ?? '?'} kg)`
                      : '—'}
                  </td>
                  <td className="px-4 py-2 font-semibold">{l.porciones}</td>
                  <td className="px-4 py-2 capitalize">{l.local}</td>
                  <td className="px-4 py-2">{l.responsable || '—'}</td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => { if (window.confirm('¿Eliminar este lote de pasta?')) eliminarPasta.mutate(l.id) }}
                      className="text-red-500 hover:text-red-700 text-xs"
                    >Eliminar</button>
                  </td>
                </tr>
              ))}
              {pastasFiltradas.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-gray-400">{cargandoP ? 'Cargando...' : 'No hay pastas registradas hoy'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modales */}
      {modalRelleno && (
        <ModalRelleno
          fecha={fecha}
          recetas={(recetas ?? []).filter((r) => r.tipo === 'relleno')}
          onClose={() => setModalRelleno(false)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['cocina-lotes-relleno', fecha] }); setModalRelleno(false) }}
        />
      )}
      {modalPasta && (
        <ModalPasta
          fecha={fecha}
          productos={(productos ?? []).filter((p) => p.tipo === 'pasta')}
          recetasMasa={(recetas ?? []).filter((r) => r.tipo === 'masa')}
          lotesRellenoDia={lotesRelleno ?? []}
          onClose={() => setModalPasta(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['cocina-lotes-pasta', fecha] })
            qc.invalidateQueries({ queryKey: ['cocina-stock'] })
            setModalPasta(false)
          }}
        />
      )}
    </div>
  )
}

// ── Modal: Registrar relleno ──────────────────────────────────────────────────

function ModalRelleno({ fecha, recetas, onClose, onSaved }: {
  fecha: string; recetas: Receta[]; onClose: () => void; onSaved: () => void
}) {
  const [recetaId, setRecetaId] = useState(recetas[0]?.id ?? '')
  const [cantRecetas, setCantRecetas] = useState(1)
  const [pesoKg, setPesoKg] = useState('')
  const [responsable, setResponsable] = useState('')
  const [local, setLocal] = useState<'vedia' | 'saavedra'>('vedia')
  const [notas, setNotas] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const guardar = async () => {
    if (!recetaId || !pesoKg) { setError('Receta y peso son obligatorios'); return }
    setGuardando(true)
    setError('')
    const { error: err } = await supabase.from('cocina_lotes_relleno').insert({
      receta_id: recetaId,
      fecha,
      cantidad_recetas: cantRecetas,
      peso_total_kg: Number(pesoKg),
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
        <h3 className="text-lg font-bold text-gray-800 mb-4">Registrar relleno</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Receta de relleno</label>
            <select value={recetaId} onChange={(e) => setRecetaId(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
              {recetas.length === 0 && <option value="">No hay recetas de relleno cargadas</option>}
              {recetas.map((r) => <option key={r.id} value={r.id}>{r.nombre}{r.rendimiento_kg ? ` (${r.rendimiento_kg} kg/receta)` : ''}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Cantidad de recetas</label>
              <input type="number" min={1} value={cantRecetas} onChange={(e) => setCantRecetas(Number(e.target.value))} className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Peso total (kg)</label>
              <input type="number" step="0.1" value={pesoKg} onChange={(e) => setPesoKg(e.target.value)} className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm" placeholder="5.0" />
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

// ── Modal: Registrar pasta ────────────────────────────────────────────────────

function ModalPasta({ fecha, productos, recetasMasa, lotesRellenoDia, onClose, onSaved }: {
  fecha: string; productos: Producto[]; recetasMasa: Receta[]; lotesRellenoDia: LoteRelleno[]
  onClose: () => void; onSaved: () => void
}) {
  const [productoId, setProductoId] = useState(productos[0]?.id ?? '')
  const [loteRellenoId, setLoteRellenoId] = useState('')
  const [recetaMasaId, setRecetaMasaId] = useState('')
  const [masaKg, setMasaKg] = useState('')
  const [rellenoKg, setRellenoKg] = useState('')
  const [porciones, setPorciones] = useState('')
  const [responsable, setResponsable] = useState('')
  const [local, setLocal] = useState<'vedia' | 'saavedra'>('vedia')
  const [notas, setNotas] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const productoSeleccionado = productos.find((p) => p.id === productoId)
  const codigoLote = productoSeleccionado ? `${productoSeleccionado.codigo}-${formatDDMM(fecha)}` : ''

  const guardar = async () => {
    if (!productoId || !porciones) { setError('Producto y porciones son obligatorios'); return }
    setGuardando(true)
    setError('')
    const { error: err } = await supabase.from('cocina_lotes_pasta').insert({
      producto_id: productoId,
      lote_relleno_id: loteRellenoId || null,
      fecha,
      codigo_lote: codigoLote,
      receta_masa_id: recetaMasaId || null,
      masa_kg: masaKg ? Number(masaKg) : null,
      relleno_kg: rellenoKg ? Number(rellenoKg) : null,
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
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-gray-800 mb-4">Registrar pasta</h3>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Producto</label>
              <select value={productoId} onChange={(e) => setProductoId(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
                {productos.length === 0 && <option value="">No hay productos tipo pasta</option>}
                {productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Código de lote</label>
              <input value={codigoLote} readOnly className="w-full border border-gray-200 rounded px-3 py-1.5 text-sm bg-gray-50 font-mono" />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Relleno usado (del día)</label>
            <select value={loteRellenoId} onChange={(e) => setLoteRellenoId(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
              <option value="">Sin relleno</option>
              {lotesRellenoDia.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.receta?.nombre ?? 'Relleno'} — {l.peso_total_kg} kg ({l.local})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Receta de masa</label>
            <select value={recetaMasaId} onChange={(e) => setRecetaMasaId(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
              <option value="">Sin especificar</option>
              {recetasMasa.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Masa (kg)</label>
              <input type="number" step="0.1" value={masaKg} onChange={(e) => setMasaKg(e.target.value)} className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Relleno (kg)</label>
              <input type="number" step="0.1" value={rellenoKg} onChange={(e) => setRellenoKg(e.target.value)} className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Porciones</label>
              <input type="number" value={porciones} onChange={(e) => setPorciones(e.target.value)} className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm" placeholder="100" />
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
