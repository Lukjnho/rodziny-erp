import { useState, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabaseAnon as supabase } from '@/lib/supabaseAnon'
import { cn } from '@/lib/utils'

// ── Tipos ──────────────────────────────────────────────────────────────────────

interface Producto {
  id: string; nombre: string; codigo: string; tipo: string
}
interface Receta {
  id: string; nombre: string; tipo: string; rendimiento_kg: number | null
}
interface LoteRelleno {
  id: string; receta_id: string; peso_total_kg: number; local: string
  receta?: { nombre: string } | null
}

type Vista = 'inicio' | 'relleno' | 'pasta' | 'exito'

// ── Helpers ────────────────────────────────────────────────────────────────────

function hoy() {
  return new Date().toISOString().slice(0, 10)
}

function formatDDMM(fecha: string) {
  const [, m, d] = fecha.split('-')
  return `${d}${m}`
}

// ── Layout base ────────────────────────────────────────────────────────────────

function Pantalla({ local, children }: { local: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-rodziny-800 text-white px-4 py-3 flex items-center gap-2">
        <div className="w-7 h-7 rounded flex items-center justify-center text-xs font-bold bg-rodziny-600">R</div>
        <div className="flex-1">
          <span className="font-semibold text-sm">Rodziny · Producción</span>
          <span className="text-[10px] text-rodziny-200 ml-2 capitalize">{local}</span>
        </div>
      </header>
      <main className="flex-1 p-4 max-w-md w-full mx-auto">{children}</main>
    </div>
  )
}

// ── Componente principal ───────────────────────────────────────────────────────

export function ProduccionQRPage() {
  const [params] = useSearchParams()
  const local = (params.get('local') === 'saavedra' ? 'saavedra' : 'vedia') as 'vedia' | 'saavedra'

  const qc = useQueryClient()
  const [vista, setVista] = useState<Vista>('inicio')
  const [mensajeExito, setMensajeExito] = useState('')

  // Catálogos
  const { data: productos } = useQuery({
    queryKey: ['cocina-productos-qr'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cocina_productos').select('id, nombre, codigo, tipo').eq('activo', true).order('nombre')
      if (error) throw error
      return data as Producto[]
    },
  })

  const { data: recetas } = useQuery({
    queryKey: ['cocina-recetas-qr'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cocina_recetas').select('id, nombre, tipo, rendimiento_kg').eq('activo', true).order('nombre')
      if (error) throw error
      return data as Receta[]
    },
  })

  // Lotes de relleno del día (para asociar en pasta)
  const { data: lotesRellenoHoy } = useQuery({
    queryKey: ['cocina-lotes-relleno-qr', hoy(), local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_relleno')
        .select('id, receta_id, peso_total_kg, local, receta:cocina_recetas(nombre)')
        .eq('fecha', hoy())
        .eq('local', local)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as LoteRelleno[]
    },
  })

  const recetasRelleno = useMemo(() => (recetas ?? []).filter((r) => r.tipo === 'relleno'), [recetas])
  const recetasMasa = useMemo(() => (recetas ?? []).filter((r) => r.tipo === 'masa'), [recetas])
  const productosPasta = useMemo(() => (productos ?? []).filter((p) => p.tipo === 'pasta'), [productos])

  function onGuardado(msg: string) {
    setMensajeExito(msg)
    setVista('exito')
    // Refrescar lotes para que aparezcan al cargar pasta
    qc.invalidateQueries({ queryKey: ['cocina-lotes-relleno-qr'] })
  }

  return (
    <Pantalla local={local}>
      {vista === 'inicio' && (
        <Inicio
          onRelleno={() => setVista('relleno')}
          onPasta={() => setVista('pasta')}
          lotesHoy={lotesRellenoHoy?.length ?? 0}
        />
      )}

      {vista === 'relleno' && (
        <FormRelleno
          local={local}
          recetas={recetasRelleno}
          onGuardado={(msg) => onGuardado(msg)}
          onVolver={() => setVista('inicio')}
        />
      )}

      {vista === 'pasta' && (
        <FormPasta
          local={local}
          productos={productosPasta}
          recetasMasa={recetasMasa}
          lotesRelleno={lotesRellenoHoy ?? []}
          onGuardado={(msg) => onGuardado(msg)}
          onVolver={() => setVista('inicio')}
        />
      )}

      {vista === 'exito' && (
        <Exito
          mensaje={mensajeExito}
          onOtro={() => setVista('inicio')}
        />
      )}
    </Pantalla>
  )
}

// ── Inicio ─────────────────────────────────────────────────────────────────────

function Inicio({ onRelleno, onPasta, lotesHoy }: {
  onRelleno: () => void; onPasta: () => void; lotesHoy: number
}) {
  const ahora = new Date()
  const fechaLabel = ahora.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="space-y-4 mt-2">
      <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
        <p className="text-xs text-gray-500 capitalize">{fechaLabel}</p>
        <p className="text-sm text-gray-600 mt-1">
          {lotesHoy > 0
            ? `${lotesHoy} lote${lotesHoy > 1 ? 's' : ''} de relleno registrado${lotesHoy > 1 ? 's' : ''} hoy`
            : 'Sin registros de relleno hoy'}
        </p>
      </div>

      <button
        onClick={onRelleno}
        className="w-full bg-green-600 hover:bg-green-700 text-white py-5 rounded-lg font-semibold text-base shadow active:scale-[0.98] transition-transform"
      >
        Cargar Relleno
      </button>

      <button
        onClick={onPasta}
        className="w-full bg-rodziny-700 hover:bg-rodziny-800 text-white py-5 rounded-lg font-semibold text-base shadow active:scale-[0.98] transition-transform"
      >
        Cargar Pasta
      </button>

      <p className="text-[10px] text-gray-400 text-center mt-6">
        Rodziny ERP · Carga de producción
      </p>
    </div>
  )
}

// ── Formulario Relleno ─────────────────────────────────────────────────────────

function FormRelleno({ local, recetas, onGuardado, onVolver }: {
  local: string; recetas: Receta[]
  onGuardado: (msg: string) => void; onVolver: () => void
}) {
  const [recetaId, setRecetaId] = useState(recetas[0]?.id ?? '')
  const [cantRecetas, setCantRecetas] = useState('1')
  const [pesoKg, setPesoKg] = useState('')
  const [responsable, setResponsable] = useState('')
  const [notas, setNotas] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const recetaSel = recetas.find((r) => r.id === recetaId)

  async function guardar() {
    if (!recetaId) { setError('Seleccioná una receta'); return }
    if (!pesoKg || Number(pesoKg) <= 0) { setError('Indicá el peso total'); return }
    setGuardando(true)
    setError('')

    const { error: err } = await supabase.from('cocina_lotes_relleno').insert({
      receta_id: recetaId,
      fecha: hoy(),
      cantidad_recetas: Number(cantRecetas) || 1,
      peso_total_kg: Number(pesoKg),
      responsable: responsable.trim() || null,
      local,
      notas: notas.trim() || null,
    })

    if (err) { setError(err.message); setGuardando(false); return }
    onGuardado(`Relleno "${recetaSel?.nombre ?? ''}" — ${pesoKg} kg`)
  }

  return (
    <div className="space-y-3 mt-2">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Cargar Relleno</h2>
        <button onClick={onVolver} className="text-xs text-gray-500 underline">Volver</button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Receta de relleno</label>
          <select
            value={recetaId}
            onChange={(e) => setRecetaId(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2.5 text-sm"
          >
            {recetas.length === 0 && <option value="">No hay recetas cargadas</option>}
            {recetas.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nombre}{r.rendimiento_kg ? ` (${r.rendimiento_kg} kg/receta)` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Cant. recetas</label>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={cantRecetas}
              onChange={(e) => setCantRecetas(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Peso total (kg)</label>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              value={pesoKg}
              onChange={(e) => setPesoKg(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2.5 text-sm"
              placeholder="5.0"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Responsable</label>
          <input
            value={responsable}
            onChange={(e) => setResponsable(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2.5 text-sm"
            placeholder="Nombre"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Notas (opcional)</label>
          <input
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2.5 text-sm"
            placeholder="Ej: relleno más espeso"
          />
        </div>
      </div>

      {error && <div className="text-xs text-red-600 bg-red-50 rounded p-2">{error}</div>}

      <button
        onClick={guardar}
        disabled={guardando}
        className="w-full bg-green-600 hover:bg-green-700 text-white py-3.5 rounded-lg font-semibold text-sm disabled:opacity-50 shadow active:scale-[0.98] transition-transform"
      >
        {guardando ? 'Guardando...' : 'Registrar relleno'}
      </button>
    </div>
  )
}

// ── Formulario Pasta ───────────────────────────────────────────────────────────

function FormPasta({ local, productos, recetasMasa, lotesRelleno, onGuardado, onVolver }: {
  local: string; productos: Producto[]; recetasMasa: Receta[]; lotesRelleno: LoteRelleno[]
  onGuardado: (msg: string) => void; onVolver: () => void
}) {
  const [productoId, setProductoId] = useState(productos[0]?.id ?? '')
  const [loteRellenoId, setLoteRellenoId] = useState('')
  const [recetaMasaId, setRecetaMasaId] = useState('')
  const [masaKg, setMasaKg] = useState('')
  const [rellenoKg, setRellenoKg] = useState('')
  const [porciones, setPorciones] = useState('')
  const [responsable, setResponsable] = useState('')
  const [notas, setNotas] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const prodSel = productos.find((p) => p.id === productoId)
  const codigoLote = prodSel ? `${prodSel.codigo}-${formatDDMM(hoy())}` : ''

  async function guardar() {
    if (!productoId) { setError('Seleccioná un producto'); return }
    if (!porciones || Number(porciones) <= 0) { setError('Indicá las porciones'); return }
    setGuardando(true)
    setError('')

    const { error: err } = await supabase.from('cocina_lotes_pasta').insert({
      producto_id: productoId,
      lote_relleno_id: loteRellenoId || null,
      fecha: hoy(),
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
    onGuardado(`${prodSel?.nombre ?? 'Pasta'} — ${porciones} porciones (${codigoLote})`)
  }

  return (
    <div className="space-y-3 mt-2">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Cargar Pasta</h2>
        <button onClick={onVolver} className="text-xs text-gray-500 underline">Volver</button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Producto</label>
          <select
            value={productoId}
            onChange={(e) => setProductoId(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2.5 text-sm"
          >
            {productos.length === 0 && <option value="">No hay productos tipo pasta</option>}
            {productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div>

        {codigoLote && (
          <div className="bg-gray-50 border border-gray-200 rounded px-3 py-2 text-center">
            <span className="text-[10px] text-gray-500 block">Código de lote</span>
            <span className="font-mono font-bold text-gray-900">{codigoLote}</span>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Relleno usado</label>
          <select
            value={loteRellenoId}
            onChange={(e) => setLoteRellenoId(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2.5 text-sm"
          >
            <option value="">Sin relleno</option>
            {lotesRelleno.map((l) => (
              <option key={l.id} value={l.id}>
                {l.receta?.nombre ?? 'Relleno'} — {l.peso_total_kg} kg
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Receta de masa</label>
          <select
            value={recetaMasaId}
            onChange={(e) => setRecetaMasaId(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2.5 text-sm"
          >
            <option value="">Sin especificar</option>
            {recetasMasa.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Masa (kg)</label>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              value={masaKg}
              onChange={(e) => setMasaKg(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Relleno (kg)</label>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              value={rellenoKg}
              onChange={(e) => setRellenoKg(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Porciones</label>
            <input
              type="number"
              inputMode="numeric"
              value={porciones}
              onChange={(e) => setPorciones(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2.5 text-sm"
              placeholder="100"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Responsable</label>
          <input
            value={responsable}
            onChange={(e) => setResponsable(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2.5 text-sm"
            placeholder="Nombre"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Notas (opcional)</label>
          <input
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2.5 text-sm"
          />
        </div>
      </div>

      {error && <div className="text-xs text-red-600 bg-red-50 rounded p-2">{error}</div>}

      <button
        onClick={guardar}
        disabled={guardando}
        className="w-full bg-rodziny-700 hover:bg-rodziny-800 text-white py-3.5 rounded-lg font-semibold text-sm disabled:opacity-50 shadow active:scale-[0.98] transition-transform"
      >
        {guardando ? 'Guardando...' : 'Registrar pasta'}
      </button>
    </div>
  )
}

// ── Pantalla de éxito ──────────────────────────────────────────────────────────

function Exito({ mensaje, onOtro }: { mensaje: string; onOtro: () => void }) {
  return (
    <div className="mt-8 text-center">
      <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
        <span className="text-3xl text-green-600">✓</span>
      </div>
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Registrado</h2>
      <p className="text-sm text-gray-600 mb-6">{mensaje}</p>
      <button
        onClick={onOtro}
        className="w-full bg-rodziny-700 hover:bg-rodziny-800 text-white py-4 rounded-lg font-semibold text-base shadow active:scale-[0.98] transition-transform"
      >
        Cargar otro
      </button>
      <p className="text-[10px] text-gray-400 mt-4">{new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</p>
    </div>
  )
}
