import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { KPICard } from '@/components/ui/KPICard'
import { StockProduccionSection } from './components/StockProduccionSection'
import { cn } from '@/lib/utils'

// Badge que muestra si un lote tiene ingredientes reales guardados y un popover con el detalle
function IngredientesRealesBadge({ ingredientes }: { ingredientes: IngredienteRealRow[] | null }) {
  const [abierto, setAbierto] = useState(false)
  if (!ingredientes || ingredientes.length === 0) {
    return <span className="text-[10px] text-gray-300">—</span>
  }
  const ajustados = ingredientes.filter((i) => Math.abs(i.cantidad_real - i.cantidad_receta) > 0.001)
  return (
    <div className="relative inline-block">
      <button
        onClick={() => setAbierto((v) => !v)}
        className={'text-[10px] px-2 py-0.5 rounded-full ' + (ajustados.length > 0
          ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
          : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}
      >
        {ajustados.length > 0 ? `${ajustados.length} ajustado${ajustados.length > 1 ? 's' : ''}` : `${ingredientes.length} ok`}
      </button>
      {abierto && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setAbierto(false)} />
          <div className="absolute z-50 top-full left-0 mt-1 w-80 bg-white border border-gray-200 rounded-lg shadow-lg p-2 text-xs">
            <div className="flex items-center justify-between mb-1.5 px-1">
              <span className="font-semibold text-gray-700">Ingredientes reales</span>
              <button onClick={() => setAbierto(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="max-h-64 overflow-y-auto">
              {ingredientes.map((i, idx) => {
                const diff = i.cantidad_real - i.cantidad_receta
                const pct = i.cantidad_receta > 0 ? (diff / i.cantidad_receta) * 100 : 0
                const ajustado = Math.abs(diff) > 0.001
                return (
                  <div key={idx} className={'flex items-center justify-between px-1 py-0.5 ' + (ajustado ? 'text-amber-700' : 'text-gray-600')}>
                    <span className="truncate flex-1">{i.nombre}</span>
                    <span className="tabular-nums ml-2">
                      {i.cantidad_real} {i.unidad}
                      {ajustado && (
                        <span className="text-[10px] text-gray-400 ml-1">
                          ({i.cantidad_receta} · {pct >= 0 ? '+' : ''}{Math.round(pct)}%)
                        </span>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface Producto {
  id: string; nombre: string; codigo: string; tipo: string; local: string
}
interface Receta {
  id: string; nombre: string; tipo: string
  rendimiento_kg: number | null
  rendimiento_unidad: 'kg' | 'l' | 'unidad' | null
  local: string | null
}
interface IngredienteRealRow {
  ing_id: string
  nombre: string
  cantidad_receta: number
  cantidad_real: number
  unidad: string
  producto_id: string | null
}

interface LoteRelleno {
  id: string; receta_id: string; fecha: string; cantidad_recetas: number
  peso_total_kg: number; responsable: string | null; local: string; notas: string | null
  created_at: string
  ingredientes_reales: IngredienteRealRow[] | null
  receta?: { nombre: string } | null
  consumido_kg?: number
  disponible_kg?: number
}
interface LotePasta {
  id: string; producto_id: string; lote_relleno_id: string | null; lote_masa_id: string | null; fecha: string
  codigo_lote: string; receta_masa_id: string | null; masa_kg: number | null
  relleno_kg: number | null; porciones: number | null; responsable: string | null
  local: string; notas: string | null; created_at: string
  ubicacion: 'freezer_produccion' | 'camara_congelado'
  cantidad_cajones: number | null
  fecha_porcionado: string | null
  responsable_porcionado: string | null
  merma_porcionado: number
  producto?: { nombre: string; codigo: string } | null
  lote_relleno?: { receta?: { nombre: string } | null; peso_total_kg: number } | null
  receta_masa?: { nombre: string } | null
}

interface LoteMasa {
  id: string; receta_id: string | null; fecha: string; kg_producidos: number
  kg_sobrante: number | null; destino_sobrante: string | null
  responsable: string | null; local: string; notas: string | null; created_at: string
  ingredientes_reales: IngredienteRealRow[] | null
  receta?: { nombre: string } | null
  consumido_kg?: number
  disponible_kg?: number
}

interface LoteProduccion {
  id: string; fecha: string; local: string
  categoria: 'salsa' | 'postre' | 'pasteleria' | 'panaderia' | 'prueba'
  receta_id: string | null; nombre_libre: string | null
  cantidad_producida: number; unidad: 'kg' | 'unid' | 'lt'
  merma_cantidad: number | null; merma_motivo: string | null
  responsable: string | null; notas: string | null; created_at: string
  ingredientes_reales: IngredienteRealRow[] | null
  receta?: { nombre: string } | null
}

const CATEGORIA_LABEL_PROD: Record<string, string> = {
  salsa: 'Salsa', postre: 'Postre', pasteleria: 'Pastelería', panaderia: 'Panadería', prueba: 'Prueba',
}
const CATEGORIA_COLOR_PROD: Record<string, string> = {
  salsa: 'bg-orange-100 text-orange-700',
  postre: 'bg-pink-100 text-pink-700',
  pasteleria: 'bg-pink-100 text-pink-700',
  panaderia: 'bg-yellow-100 text-yellow-700',
  prueba: 'bg-purple-100 text-purple-700',
}

type FiltroLocal = 'todos' | 'vedia' | 'saavedra'

function matchLocal(itemLocal: string | null, filtro: string): boolean {
  if (filtro === 'todos' || !itemLocal) return true
  return itemLocal === filtro
}

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
  const [filtroPastaEstado, setFiltroPastaEstado] = useState<'todos' | 'fresco' | 'camara'>('todos')
  const [filtroCategoriaProd, setFiltroCategoriaProd] = useState<'todos' | 'salsa' | 'postre' | 'pasteleria' | 'panaderia' | 'prueba'>('todos')

  // Modales
  const [modalRelleno, setModalRelleno] = useState(false)
  const [modalMasa, setModalMasa] = useState(false)
  const [modalCerrarMasa, setModalCerrarMasa] = useState<LoteMasa | null>(null)
  const [modalPasta, setModalPasta] = useState(false)
  const [modalPorcionar, setModalPorcionar] = useState<LotePasta | null>(null)

  // Catálogos
  const { data: productos } = useQuery({
    queryKey: ['cocina-productos'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cocina_productos').select('id, nombre, codigo, tipo, local').eq('activo', true).order('nombre')
      if (error) throw error
      return data as Producto[]
    },
  })

  const { data: recetas } = useQuery({
    queryKey: ['cocina-recetas'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cocina_recetas').select('id, nombre, tipo, rendimiento_kg, rendimiento_unidad, local').eq('activo', true).order('nombre')
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

  const { data: lotesMasa, isLoading: cargandoM } = useQuery({
    queryKey: ['cocina-lotes-masa', fecha],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_masa')
        .select('*, receta:cocina_recetas(nombre)')
        .eq('fecha', fecha)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as LoteMasa[]
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

  // Lotes frescos pendientes de porcionar (cualquier fecha) — para acción desde el admin
  const { data: lotesFrescosPendientes } = useQuery({
    queryKey: ['cocina-lotes-pasta-frescos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_pasta')
        .select('*, producto:cocina_productos(nombre, codigo)')
        .eq('ubicacion', 'freezer_produccion')
        .order('fecha', { ascending: true })
      if (error) throw error
      return data as LotePasta[]
    },
  })

  const { data: lotesProduccion, isLoading: cargandoProd } = useQuery({
    queryKey: ['cocina-lotes-produccion', fecha],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_produccion')
        .select('*, receta:cocina_recetas(nombre)')
        .eq('fecha', fecha)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as LoteProduccion[]
    },
  })

  // Cálculo de consumo: sumar cuánto se usó de cada lote de relleno/masa
  // tomando las pastas armadas del día (único día que tenemos cargado acá).
  const consumoPorRellenoAdm = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of lotesPasta ?? []) {
      if (p.lote_relleno_id && p.relleno_kg) {
        m.set(p.lote_relleno_id, (m.get(p.lote_relleno_id) ?? 0) + p.relleno_kg)
      }
    }
    return m
  }, [lotesPasta])

  const consumoPorMasaAdm = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of lotesPasta ?? []) {
      if (p.lote_masa_id && p.masa_kg) {
        m.set(p.lote_masa_id, (m.get(p.lote_masa_id) ?? 0) + p.masa_kg)
      }
    }
    return m
  }, [lotesPasta])

  const lotesRellenoDisponibles = useMemo<LoteRelleno[]>(() => {
    return (lotesRelleno ?? [])
      .map((l) => {
        const consumido = consumoPorRellenoAdm.get(l.id) ?? 0
        return { ...l, consumido_kg: consumido, disponible_kg: +(l.peso_total_kg - consumido).toFixed(3) }
      })
      .filter((l) => (l.disponible_kg ?? 0) > 0.01)
  }, [lotesRelleno, consumoPorRellenoAdm])

  const lotesMasaDisponibles = useMemo<LoteMasa[]>(() => {
    return (lotesMasa ?? [])
      .map((l) => {
        const consumido = consumoPorMasaAdm.get(l.id) ?? 0
        return { ...l, consumido_kg: consumido, disponible_kg: +(l.kg_producidos - consumido).toFixed(3) }
      })
      .filter((l) => (l.disponible_kg ?? 0) > 0.01)
  }, [lotesMasa, consumoPorMasaAdm])

  // Filtrar por local
  const rellenosFiltrados = useMemo(() => {
    if (filtroLocal === 'todos') return lotesRelleno ?? []
    return (lotesRelleno ?? []).filter((l) => l.local === filtroLocal)
  }, [lotesRelleno, filtroLocal])

  const masasFiltradas = useMemo(() => {
    if (filtroLocal === 'todos') return lotesMasa ?? []
    return (lotesMasa ?? []).filter((l) => l.local === filtroLocal)
  }, [lotesMasa, filtroLocal])

  const pastasFiltradas = useMemo(() => {
    let lista = lotesPasta ?? []
    if (filtroLocal !== 'todos') lista = lista.filter((l) => l.local === filtroLocal)
    if (filtroPastaEstado === 'fresco') lista = lista.filter((l) => l.ubicacion === 'freezer_produccion')
    else if (filtroPastaEstado === 'camara') lista = lista.filter((l) => l.ubicacion === 'camara_congelado')
    return lista
  }, [lotesPasta, filtroLocal, filtroPastaEstado])

  const produccionesFiltradas = useMemo(() => {
    let lista = lotesProduccion ?? []
    if (filtroLocal !== 'todos') lista = lista.filter((l) => l.local === filtroLocal)
    if (filtroCategoriaProd !== 'todos') lista = lista.filter((l) => l.categoria === filtroCategoriaProd)
    return lista
  }, [lotesProduccion, filtroLocal, filtroCategoriaProd])

  // KPIs
  const kpiRelleno = useMemo(() => ({
    lotes: rellenosFiltrados.length,
    kgTotal: rellenosFiltrados.reduce((s, l) => s + l.peso_total_kg, 0),
  }), [rellenosFiltrados])

  const kpiMasa = useMemo(() => ({
    lotes: masasFiltradas.length,
    kgTotal: masasFiltradas.reduce((s, l) => s + l.kg_producidos, 0),
  }), [masasFiltradas])

  const kpiPasta = useMemo(() => ({
    lotes: pastasFiltradas.length,
    porcionesTotal: pastasFiltradas.reduce((s, l) => s + (l.porciones ?? 0), 0),
    tiposDistintos: new Set(pastasFiltradas.map((l) => l.producto_id)).size,
  }), [pastasFiltradas])

  // Frescos pendientes (todos los días, filtrado por local) — se muestra como alerta
  const frescosFiltrados = useMemo(() => {
    if (filtroLocal === 'todos') return lotesFrescosPendientes ?? []
    return (lotesFrescosPendientes ?? []).filter((l) => l.local === filtroLocal)
  }, [lotesFrescosPendientes, filtroLocal])

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

  const eliminarMasa = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('cocina_lotes_masa').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cocina-lotes-masa', fecha] }),
  })

  const eliminarPasta = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('cocina_lotes_pasta').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cocina-lotes-pasta', fecha] })
      qc.invalidateQueries({ queryKey: ['cocina-lotes-pasta-frescos'] })
      qc.invalidateQueries({ queryKey: ['cocina-stock'] })
    },
  })

  const eliminarProduccion = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('cocina_lotes_produccion').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cocina-lotes-produccion', fecha] }),
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
                <th className="px-4 py-2">Ingredientes</th>
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
                  <td className="px-4 py-2"><IngredientesRealesBadge ingredientes={l.ingredientes_reales} /></td>
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
                <tr><td colSpan={8} className="px-4 py-6 text-center text-gray-400">{cargandoR ? 'Cargando...' : 'No hay rellenos registrados hoy'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Sección: Masas del día ───────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-gray-800">Masas del día</h3>
          <button onClick={() => setModalMasa(true)} className="bg-rodziny-700 hover:bg-rodziny-800 text-white text-sm rounded px-3 py-1.5">
            + Registrar masa
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
          <KPICard label="Lotes de masa" value={String(kpiMasa.lotes)} color="green" loading={cargandoM} />
          <KPICard label="Total kg" value={`${kpiMasa.kgTotal.toFixed(1)} kg`} color="blue" loading={cargandoM} />
        </div>

        <div className="bg-white rounded-lg border border-surface-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border bg-gray-50 text-left text-xs text-gray-500 uppercase">
                <th className="px-4 py-2">Receta</th>
                <th className="px-4 py-2">Kg producidos</th>
                <th className="px-4 py-2">Kg sobrante</th>
                <th className="px-4 py-2">Destino</th>
                <th className="px-4 py-2">Ingredientes</th>
                <th className="px-4 py-2">Local</th>
                <th className="px-4 py-2">Responsable</th>
                <th className="px-4 py-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {masasFiltradas.map((l) => (
                <tr key={l.id} className="border-b border-surface-border hover:bg-gray-50">
                  <td className="px-4 py-2 font-medium">{l.receta?.nombre ?? '—'}</td>
                  <td className="px-4 py-2">{l.kg_producidos} kg</td>
                  <td className="px-4 py-2">
                    {l.kg_sobrante == null
                      ? <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-700">Abierto</span>
                      : `${l.kg_sobrante} kg`}
                  </td>
                  <td className="px-4 py-2">
                    {l.destino_sobrante == null
                      ? '—'
                      : l.destino_sobrante === 'fideos'
                        ? <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-700">Fideos (reutilizar)</span>
                        : l.destino_sobrante === 'merma'
                          ? <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-red-100 text-red-700">Merma (descartar)</span>
                          : <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-700">Próxima masa</span>}
                  </td>
                  <td className="px-4 py-2"><IngredientesRealesBadge ingredientes={l.ingredientes_reales} /></td>
                  <td className="px-4 py-2 capitalize">{l.local}</td>
                  <td className="px-4 py-2">{l.responsable || '—'}</td>
                  <td className="px-4 py-2 flex gap-2">
                    {l.kg_sobrante == null && (
                      <button
                        onClick={() => setModalCerrarMasa(l)}
                        className="text-blue-600 hover:text-blue-800 text-xs"
                      >Cerrar</button>
                    )}
                    <button
                      onClick={() => { if (window.confirm('¿Eliminar este lote de masa?')) eliminarMasa.mutate(l.id) }}
                      className="text-red-500 hover:text-red-700 text-xs"
                    >Eliminar</button>
                  </td>
                </tr>
              ))}
              {masasFiltradas.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-gray-400">{cargandoM ? 'Cargando...' : 'No hay masas registradas hoy'}</td></tr>
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

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <KPICard label="Lotes de pasta" value={String(kpiPasta.lotes)} color="green" loading={cargandoP} />
          <KPICard label="Total porciones" value={String(kpiPasta.porcionesTotal)} color="blue" loading={cargandoP} />
          <KPICard label="Tipos distintos" value={String(kpiPasta.tiposDistintos)} color="neutral" loading={cargandoP} />
          <KPICard
            label="Frescos por porcionar"
            value={String(frescosFiltrados.length)}
            color={frescosFiltrados.length > 0 ? 'yellow' : 'neutral'}
            loading={cargandoP}
            active={filtroPastaEstado === 'fresco'}
            onClick={() => setFiltroPastaEstado(filtroPastaEstado === 'fresco' ? 'todos' : 'fresco')}
          />
        </div>

        {frescosFiltrados.length > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3">
            <p className="text-sm font-medium text-blue-900 mb-2">
              {frescosFiltrados.length} cajón{frescosFiltrados.length > 1 ? 'es' : ''} pendiente{frescosFiltrados.length > 1 ? 's' : ''} de porcionar (otras fechas)
            </p>
            <div className="space-y-1">
              {frescosFiltrados.map((l) => (
                <div key={l.id} className="flex items-center justify-between text-xs bg-white rounded px-2 py-1.5 border border-blue-100">
                  <span>
                    <span className="font-mono">{l.codigo_lote}</span> · {l.producto?.nombre ?? 'Pasta'} · {l.fecha}
                    {l.cantidad_cajones && <> · {l.cantidad_cajones} cajones</>}
                    {l.porciones != null && <> · {l.porciones} porc. est.</>}
                  </span>
                  <button
                    onClick={() => setModalPorcionar(l)}
                    className="bg-blue-600 hover:bg-blue-700 text-white rounded px-2 py-0.5 text-[11px]"
                  >Porcionar</button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg border border-surface-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border bg-gray-50 text-left text-xs text-gray-500 uppercase">
                <th className="px-4 py-2">Código lote</th>
                <th className="px-4 py-2">Producto</th>
                <th className="px-4 py-2">Estado</th>
                <th className="px-4 py-2">Relleno</th>
                <th className="px-4 py-2">Masa</th>
                <th className="px-4 py-2">Porciones</th>
                <th className="px-4 py-2">Local</th>
                <th className="px-4 py-2">Responsable</th>
                <th className="px-4 py-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {pastasFiltradas.map((l) => {
                const esFresco = l.ubicacion === 'freezer_produccion'
                return (
                  <tr key={l.id} className={cn('border-b border-surface-border hover:bg-gray-50', esFresco && 'bg-blue-50/40')}>
                    <td className="px-4 py-2 font-mono text-xs font-medium">{l.codigo_lote}</td>
                    <td className="px-4 py-2 font-medium">{l.producto?.nombre ?? '—'}</td>
                    <td className="px-4 py-2">
                      {esFresco ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] bg-blue-100 text-blue-700 font-medium">
                          Fresco {l.cantidad_cajones ? `· ${l.cantidad_cajones} caj.` : ''}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-100 text-emerald-700 font-medium">
                          En cámara
                        </span>
                      )}
                    </td>
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
                    <td className="px-4 py-2 font-semibold">
                      {l.porciones ?? '—'}
                      {l.merma_porcionado > 0 && (
                        <span className="text-[10px] text-red-500 ml-1">(-{l.merma_porcionado})</span>
                      )}
                    </td>
                    <td className="px-4 py-2 capitalize">{l.local}</td>
                    <td className="px-4 py-2">{l.responsable || '—'}</td>
                    <td className="px-4 py-2 space-x-2">
                      {esFresco && (
                        <button
                          onClick={() => setModalPorcionar(l)}
                          className="text-blue-600 hover:text-blue-800 text-xs"
                        >Porcionar</button>
                      )}
                      <button
                        onClick={() => { if (window.confirm('¿Eliminar este lote de pasta?')) eliminarPasta.mutate(l.id) }}
                        className="text-red-500 hover:text-red-700 text-xs"
                      >Eliminar</button>
                    </td>
                  </tr>
                )
              })}
              {pastasFiltradas.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-6 text-center text-gray-400">{cargandoP ? 'Cargando...' : 'No hay pastas registradas hoy'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Sección: Stock de producción (salsas/postres en stock con FIFO + Fudo) ─── */}
      <StockProduccionSection filtroLocal={filtroLocal} />

      {/* ── Sección: Producción adicional (salsa/postre/pastelería/panadería/prueba) ─── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-gray-800">Producción adicional del día</h3>
          <span className="text-xs text-gray-500">Cargada desde el QR por el equipo</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
          {(['salsa', 'postre', 'pasteleria', 'panaderia', 'prueba'] as const).map((cat) => {
            // Contar sobre el total del día (ignorando el filtro de categoría) para que el KPI no se "vacíe" al filtrar
            const baseTotal = (lotesProduccion ?? []).filter((p) => filtroLocal === 'todos' || p.local === filtroLocal)
            const count = baseTotal.filter((p) => p.categoria === cat).length
            return (
              <KPICard
                key={cat}
                label={CATEGORIA_LABEL_PROD[cat]}
                value={String(count)}
                color="neutral"
                loading={cargandoProd}
                active={filtroCategoriaProd === cat}
                onClick={() => setFiltroCategoriaProd(filtroCategoriaProd === cat ? 'todos' : cat)}
              />
            )
          })}
        </div>

        <div className="bg-white rounded-lg border border-surface-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border bg-gray-50 text-left text-xs text-gray-500 uppercase">
                <th className="px-4 py-2">Categoría</th>
                <th className="px-4 py-2">Receta / Nombre</th>
                <th className="px-4 py-2">Cantidad</th>
                <th className="px-4 py-2">Merma</th>
                <th className="px-4 py-2">Ingredientes</th>
                <th className="px-4 py-2">Local</th>
                <th className="px-4 py-2">Responsable</th>
                <th className="px-4 py-2">Notas</th>
                <th className="px-4 py-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {produccionesFiltradas.map((l) => (
                <tr key={l.id} className="border-b border-surface-border hover:bg-gray-50">
                  <td className="px-4 py-2">
                    <span className={'px-2 py-0.5 rounded-full text-xs font-medium ' + (CATEGORIA_COLOR_PROD[l.categoria] ?? 'bg-gray-100 text-gray-700')}>
                      {CATEGORIA_LABEL_PROD[l.categoria] ?? l.categoria}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-medium">{l.receta?.nombre ?? l.nombre_libre ?? '—'}</td>
                  <td className="px-4 py-2 tabular-nums">{l.cantidad_producida} {l.unidad}</td>
                  <td className="px-4 py-2 text-gray-600">
                    {l.merma_cantidad ? `${l.merma_cantidad} ${l.unidad}${l.merma_motivo ? ` · ${l.merma_motivo}` : ''}` : '—'}
                  </td>
                  <td className="px-4 py-2"><IngredientesRealesBadge ingredientes={l.ingredientes_reales} /></td>
                  <td className="px-4 py-2 capitalize">{l.local}</td>
                  <td className="px-4 py-2">{l.responsable || '—'}</td>
                  <td className="px-4 py-2 text-gray-500 max-w-xs truncate">{l.notas || '—'}</td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => { if (window.confirm('¿Eliminar este lote?')) eliminarProduccion.mutate(l.id) }}
                      className="text-red-500 hover:text-red-700 text-xs"
                    >Eliminar</button>
                  </td>
                </tr>
              ))}
              {produccionesFiltradas.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-6 text-center text-gray-400">{cargandoProd ? 'Cargando...' : 'Sin producción adicional registrada hoy'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modales */}
      {modalRelleno && (
        <ModalRelleno
          fecha={fecha}
          recetas={(recetas ?? []).filter((r) => r.tipo === 'relleno' && matchLocal(r.local, filtroLocal))}
          onClose={() => setModalRelleno(false)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['cocina-lotes-relleno', fecha] }); setModalRelleno(false) }}
        />
      )}
      {modalMasa && (
        <ModalMasa
          fecha={fecha}
          recetas={(recetas ?? []).filter((r) => r.tipo === 'masa' && matchLocal(r.local, filtroLocal))}
          onClose={() => setModalMasa(false)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['cocina-lotes-masa', fecha] }); setModalMasa(false) }}
        />
      )}
      {modalCerrarMasa && (
        <ModalCerrarMasa
          lote={modalCerrarMasa}
          onClose={() => setModalCerrarMasa(null)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['cocina-lotes-masa', fecha] }); setModalCerrarMasa(null) }}
        />
      )}
      {modalPasta && (
        <ModalPasta
          fecha={fecha}
          productos={(productos ?? []).filter((p) => p.tipo === 'pasta' && matchLocal(p.local, filtroLocal))}
          recetasMasa={(recetas ?? []).filter((r) => r.tipo === 'masa' && matchLocal(r.local, filtroLocal))}
          lotesRellenoDia={lotesRellenoDisponibles}
          lotesMasaDia={lotesMasaDisponibles}
          onClose={() => setModalPasta(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['cocina-lotes-pasta', fecha] })
            qc.invalidateQueries({ queryKey: ['cocina-lotes-pasta-frescos'] })
            qc.invalidateQueries({ queryKey: ['cocina-stock'] })
            setModalPasta(false)
          }}
        />
      )}
      {modalPorcionar && (
        <ModalPorcionar
          lote={modalPorcionar}
          onClose={() => setModalPorcionar(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['cocina-lotes-pasta', fecha] })
            qc.invalidateQueries({ queryKey: ['cocina-lotes-pasta-frescos'] })
            qc.invalidateQueries({ queryKey: ['cocina-stock'] })
            setModalPorcionar(null)
          }}
        />
      )}
    </div>
  )
}

// ── Modal: Porcionar pasta fresca ──────────────────────────────────────────────

function ModalPorcionar({ lote, onClose, onSaved }: {
  lote: LotePasta; onClose: () => void; onSaved: () => void
}) {
  const [porcionesReales, setPorcionesReales] = useState('')
  const [responsable, setResponsable] = useState('')
  const [notas, setNotas] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const estimadas: number | null = lote.porciones
  const reales = Number(porcionesReales) || 0
  const diferencia = estimadas != null ? reales - estimadas : null

  async function guardar() {
    if (!porcionesReales || reales <= 0) { setError('Indicá las porciones reales'); return }
    setGuardando(true)
    setError('')
    const merma = diferencia != null && diferencia < 0 ? Math.abs(diferencia) : 0
    const payload: Record<string, unknown> = {
      ubicacion: 'camara_congelado',
      porciones: reales,
      fecha_porcionado: hoy(),
      responsable_porcionado: responsable.trim() || null,
      merma_porcionado: merma,
    }
    if (notas.trim()) payload.notas = `[Porcionado] ${notas.trim()}`
    const { error: err } = await supabase.from('cocina_lotes_pasta').update(payload).eq('id', lote.id)
    if (err) { setError(err.message); setGuardando(false); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">Porcionar lote</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <div className="bg-gray-50 border border-gray-200 rounded px-3 py-2 text-xs space-y-0.5">
          <div><span className="text-gray-500">Lote:</span> <span className="font-mono font-semibold">{lote.codigo_lote}</span></div>
          <div><span className="text-gray-500">Producto:</span> {lote.producto?.nombre ?? '—'}</div>
          <div><span className="text-gray-500">Armado:</span> {lote.fecha}{lote.cantidad_cajones ? ` · ${lote.cantidad_cajones} cajones` : ''}</div>
          {estimadas != null && (
            <div><span className="text-gray-500">Estimado:</span> <span className="font-semibold">{estimadas}</span> porciones</div>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Porciones totales (bolsitas 200g)</label>
          <input
            type="number"
            inputMode="numeric"
            value={porcionesReales}
            onChange={(e) => setPorcionesReales(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
            placeholder={estimadas != null ? String(estimadas) : 'Ej: 120'}
          />
          {reales > 0 && diferencia != null && diferencia !== 0 && (
            <p className={cn('text-[11px] mt-1', diferencia < 0 ? 'text-red-600' : 'text-emerald-600')}>
              {diferencia < 0
                ? `${Math.abs(diferencia)} porciones de merma`
                : `+${diferencia} porciones vs estimado`}
            </p>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Responsable</label>
          <input
            value={responsable}
            onChange={(e) => setResponsable(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
            placeholder="Nombre"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Notas (opcional)</label>
          <input
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
          />
        </div>

        {error && <div className="text-xs text-red-600 bg-red-50 rounded p-2">{error}</div>}

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Cancelar</button>
          <button
            onClick={guardar}
            disabled={guardando}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm rounded px-4 py-1.5 disabled:opacity-50"
          >
            {guardando ? 'Guardando...' : 'Mover a cámara'}
          </button>
        </div>
      </div>
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
              {recetas.map((r) => {
                const u = (r.rendimiento_unidad ?? 'kg') === 'l' ? 'L' : (r.rendimiento_unidad ?? 'kg') === 'unidad' ? 'unid.' : 'kg'
                return <option key={r.id} value={r.id}>{r.nombre}{r.rendimiento_kg ? ` (${r.rendimiento_kg} ${u}/receta)` : ''}</option>
              })}
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

function ModalPasta({ fecha, productos, recetasMasa, lotesRellenoDia, lotesMasaDia, onClose, onSaved }: {
  fecha: string; productos: Producto[]; recetasMasa: Receta[]; lotesRellenoDia: LoteRelleno[]; lotesMasaDia: LoteMasa[]
  onClose: () => void; onSaved: () => void
}) {
  const [productoId, setProductoId] = useState(productos[0]?.id ?? '')
  const [loteRellenoId, setLoteRellenoId] = useState('')
  const [loteMasaId, setLoteMasaId] = useState('')
  const [recetaMasaId, setRecetaMasaId] = useState('')
  const [masaKg, setMasaKg] = useState('')
  const [rellenoKg, setRellenoKg] = useState('')
  const [porciones, setPorciones] = useState('')
  const [cantidadCajones, setCantidadCajones] = useState('')
  const [yaEnCamara, setYaEnCamara] = useState(false)
  const [responsable, setResponsable] = useState('')
  const [local, setLocal] = useState<'vedia' | 'saavedra'>('vedia')
  const [notas, setNotas] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const productoSeleccionado = productos.find((p) => p.id === productoId)
  const codigoLote = productoSeleccionado ? `${productoSeleccionado.codigo}-${formatDDMM(fecha)}` : ''

  const guardar = async () => {
    if (!productoId) { setError('Producto obligatorio'); return }
    // Porciones son obligatorias solo si se carga directo a cámara (stock real).
    // Si va al freezer de producción, se cargan al porcionar.
    if (yaEnCamara && !porciones) { setError('Indicá las porciones al cargar directo en cámara'); return }
    setGuardando(true)
    setError('')
    const { error: err } = await supabase.from('cocina_lotes_pasta').insert({
      producto_id: productoId,
      lote_relleno_id: loteRellenoId || null,
      lote_masa_id: loteMasaId || null,
      fecha,
      codigo_lote: codigoLote,
      receta_masa_id: recetaMasaId || null,
      masa_kg: masaKg ? Number(masaKg) : null,
      relleno_kg: rellenoKg ? Number(rellenoKg) : null,
      porciones: porciones ? Number(porciones) : null,
      cantidad_cajones: cantidadCajones ? Number(cantidadCajones) : null,
      ubicacion: yaEnCamara ? 'camara_congelado' : 'freezer_produccion',
      fecha_porcionado: yaEnCamara ? fecha : null,
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
            <select
              value={loteRellenoId}
              onChange={(e) => {
                const id = e.target.value
                setLoteRellenoId(id)
                const l = lotesRellenoDia.find((x) => x.id === id)
                if (l && l.disponible_kg != null) setRellenoKg(String(l.disponible_kg))
                else if (!id) setRellenoKg('')
              }}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            >
              <option value="">Sin relleno</option>
              {lotesRellenoDia.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.receta?.nombre ?? 'Relleno'} — {l.disponible_kg ?? l.peso_total_kg} kg disponibles ({l.local})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Masa usada (del día)</label>
            <select
              value={loteMasaId}
              onChange={(e) => {
                const id = e.target.value
                setLoteMasaId(id)
                const m = lotesMasaDia.find((x) => x.id === id)
                if (m && m.disponible_kg != null) setMasaKg(String(m.disponible_kg))
                else if (!id) setMasaKg('')
              }}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            >
              <option value="">Sin masa del día</option>
              {lotesMasaDia.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.receta?.nombre ?? 'Masa'} — {l.disponible_kg ?? l.kg_producidos} kg disponibles ({l.local})
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

          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Masa (kg)</label>
              <input type="number" step="0.1" value={masaKg} onChange={(e) => setMasaKg(e.target.value)} className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Relleno (kg)</label>
              <input type="number" step="0.1" value={rellenoKg} onChange={(e) => setRellenoKg(e.target.value)} className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Cajones</label>
              <input type="number" value={cantidadCajones} onChange={(e) => setCantidadCajones(e.target.value)} className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm" placeholder="3" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Porciones {yaEnCamara ? '' : '(al porcionar)'}
              </label>
              <input
                type="number"
                value={porciones}
                onChange={(e) => setPorciones(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                placeholder={yaEnCamara ? '100' : 'Opcional'}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-gray-600">
            <input type="checkbox" checked={yaEnCamara} onChange={(e) => setYaEnCamara(e.target.checked)} />
            Ya está porcionado en cámara (saltear paso de porcionado)
          </label>

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

// ── Modal: Registrar masa ────────────────────────────────────────────────────

function ModalMasa({ fecha, recetas, onClose, onSaved }: {
  fecha: string; recetas: Receta[]; onClose: () => void; onSaved: () => void
}) {
  const [recetaId, setRecetaId] = useState(recetas[0]?.id ?? '')
  const [kgProducidos, setKgProducidos] = useState('')
  const [responsable, setResponsable] = useState('')
  const [local, setLocal] = useState<'vedia' | 'saavedra'>('vedia')
  const [notas, setNotas] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const guardar = async () => {
    if (!recetaId || !kgProducidos) { setError('Receta y kg producidos son obligatorios'); return }
    setGuardando(true)
    setError('')
    const { error: err } = await supabase.from('cocina_lotes_masa').insert({
      receta_id: recetaId,
      fecha,
      kg_producidos: Number(kgProducidos),
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
        <h3 className="text-lg font-bold text-gray-800 mb-4">Registrar masa</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Receta de masa</label>
            <select value={recetaId} onChange={(e) => setRecetaId(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
              {recetas.length === 0 && <option value="">No hay recetas de masa cargadas</option>}
              {recetas.map((r) => {
                const u = (r.rendimiento_unidad ?? 'kg') === 'l' ? 'L' : (r.rendimiento_unidad ?? 'kg') === 'unidad' ? 'unid.' : 'kg'
                return <option key={r.id} value={r.id}>{r.nombre}{r.rendimiento_kg ? ` (${r.rendimiento_kg} ${u}/receta)` : ''}</option>
              })}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Kg producidos</label>
            <input type="number" step="0.1" value={kgProducidos} onChange={(e) => setKgProducidos(e.target.value)} className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm" placeholder="10.0" />
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

// ── Modal: Cerrar masa (registrar sobrante) ──────────────────────────────────

function ModalCerrarMasa({ lote, onClose, onSaved }: {
  lote: LoteMasa; onClose: () => void; onSaved: () => void
}) {
  const [kgSobrante, setKgSobrante] = useState('')
  const [destino, setDestino] = useState<'fideos' | 'merma' | 'proxima_masa'>('fideos')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const guardar = async () => {
    if (kgSobrante === '') { setError('Kg sobrante es obligatorio (puede ser 0)'); return }
    setGuardando(true)
    setError('')
    const { error: err } = await supabase.from('cocina_lotes_masa').update({
      kg_sobrante: Number(kgSobrante),
      destino_sobrante: Number(kgSobrante) === 0 ? null : destino,
    }).eq('id', lote.id)
    if (err) { setError(err.message); setGuardando(false); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-gray-800 mb-4">Cerrar lote de masa</h3>
        <div className="text-sm text-gray-600 mb-4">
          <span className="font-medium">{lote.receta?.nombre ?? 'Masa'}</span> — {lote.kg_producidos} kg producidos
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Kg sobrante</label>
            <input type="number" step="0.1" min="0" value={kgSobrante} onChange={(e) => setKgSobrante(e.target.value)} className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm" placeholder="0.0" />
          </div>
          {kgSobrante !== '' && Number(kgSobrante) > 0 && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Destino del sobrante</label>
              <select value={destino} onChange={(e) => setDestino(e.target.value as 'fideos' | 'merma' | 'proxima_masa')} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
                <option value="fideos">Fideos (reutilizar)</option>
                <option value="merma">Merma (descartar)</option>
                <option value="proxima_masa">Próxima masa</option>
              </select>
            </div>
          )}
        </div>
        {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-1.5 text-sm text-gray-600 hover:text-gray-800">Cancelar</button>
          <button onClick={guardar} disabled={guardando} className="bg-rodziny-700 hover:bg-rodziny-800 text-white text-sm rounded px-4 py-1.5 disabled:opacity-50">
            {guardando ? 'Guardando...' : 'Cerrar lote'}
          </button>
        </div>
      </div>
    </div>
  )
}
