import { useState, useMemo, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabaseAnon as supabase } from '@/lib/supabaseAnon'
import { cn } from '@/lib/utils'
import { IngredientesGrilla, type IngredienteReal } from './components/IngredientesGrilla'

// ── Tipos ──────────────────────────────────────────────────────────────────────

interface Producto {
  id: string; nombre: string; codigo: string; tipo: string; local: string
}
interface Receta {
  id: string; nombre: string; tipo: string; rendimiento_kg: number | null; local: string | null
}
interface LoteRelleno {
  id: string; receta_id: string; peso_total_kg: number; local: string
  receta?: { nombre: string } | null
}
interface LoteMasa {
  id: string; receta_id: string | null; kg_producidos: number
  kg_sobrante: number | null; destino_sobrante: string | null
  receta?: { nombre: string } | null
}
interface LotePastaFresco {
  id: string; producto_id: string; codigo_lote: string
  porciones: number; cantidad_cajones: number | null; fecha: string
  producto?: { nombre: string } | null
}

type Vista =
  | 'inicio'
  | 'relleno'
  | 'pasta'
  | 'porcionar-pasta'
  | 'masa'
  | 'cerrar-masa'
  | 'salsa'
  | 'postre'
  | 'pasteleria'
  | 'panaderia'
  | 'prueba'
  | 'exito'

type CategoriaGenerica = 'salsa' | 'postre' | 'pasteleria' | 'panaderia' | 'prueba'

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
      const { data, error } = await supabase.from('cocina_productos').select('id, nombre, codigo, tipo, local').eq('activo', true).order('nombre')
      if (error) throw error
      return data as Producto[]
    },
  })

  const { data: recetas } = useQuery({
    queryKey: ['cocina-recetas-qr'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cocina_recetas').select('id, nombre, tipo, rendimiento_kg, local').eq('activo', true).order('nombre')
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
      return data as unknown as LoteRelleno[]
    },
  })

  // Lotes de masa del día
  const { data: lotesMasaHoy } = useQuery({
    queryKey: ['cocina-lotes-masa-qr', hoy(), local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_masa')
        .select('id, receta_id, kg_producidos, kg_sobrante, destino_sobrante, receta:cocina_recetas(nombre)')
        .eq('fecha', hoy())
        .eq('local', local)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as LoteMasa[]
    },
  })

  const masasAbiertas = useMemo(() => (lotesMasaHoy ?? []).filter((m) => m.kg_sobrante === null).length, [lotesMasaHoy])

  // Lotes de pasta "frescos" pendientes de porcionar (cualquier fecha, no solo hoy —
  // el armado suele ser el día anterior)
  const { data: lotesFrescos } = useQuery({
    queryKey: ['cocina-lotes-pasta-frescos-qr', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_pasta')
        .select('id, producto_id, codigo_lote, porciones, cantidad_cajones, fecha, producto:cocina_productos(nombre)')
        .eq('local', local)
        .eq('ubicacion', 'freezer_produccion')
        .order('fecha', { ascending: true })
      if (error) throw error
      return data as unknown as LotePastaFresco[]
    },
  })

  const frescosPendientes = lotesFrescos?.length ?? 0

  // Filtro estricto por local: solo muestra lo asignado explícitamente a este local
  const matchLocal = (l: string | null) => l === local
  const recetasRelleno = useMemo(() => (recetas ?? []).filter((r) => r.tipo === 'relleno' && matchLocal(r.local)), [recetas, local])
  const recetasMasa = useMemo(() => (recetas ?? []).filter((r) => r.tipo === 'masa' && matchLocal(r.local)), [recetas, local])
  const recetasSalsa = useMemo(() => (recetas ?? []).filter((r) => r.tipo === 'salsa' && matchLocal(r.local)), [recetas, local])
  const recetasPostre = useMemo(() => (recetas ?? []).filter((r) => r.tipo === 'postre' && matchLocal(r.local)), [recetas, local])
  const recetasPasteleria = useMemo(() => (recetas ?? []).filter((r) => r.tipo === 'pasteleria' && matchLocal(r.local)), [recetas, local])
  const recetasPanaderia = useMemo(() => (recetas ?? []).filter((r) => r.tipo === 'panaderia' && matchLocal(r.local)), [recetas, local])
  const recetasLocal = useMemo(() => (recetas ?? []).filter((r) => matchLocal(r.local)), [recetas, local])
  const productosPasta = useMemo(() => (productos ?? []).filter((p) => p.tipo === 'pasta' && matchLocal(p.local)), [productos, local])

  function onGuardado(msg: string) {
    setMensajeExito(msg)
    setVista('exito')
    // Refrescar lotes para que aparezcan al cargar pasta
    qc.invalidateQueries({ queryKey: ['cocina-lotes-relleno-qr'] })
    qc.invalidateQueries({ queryKey: ['cocina-lotes-masa-qr'] })
    qc.invalidateQueries({ queryKey: ['cocina-lotes-produccion-qr'] })
    qc.invalidateQueries({ queryKey: ['cocina-lotes-pasta-frescos-qr'] })
  }

  return (
    <Pantalla local={local}>
      {vista === 'inicio' && (
        <Inicio
          local={local}
          onIr={(v) => setVista(v)}
          lotesHoy={lotesRellenoHoy?.length ?? 0}
          masasAbiertas={masasAbiertas}
          frescosPendientes={frescosPendientes}
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
          lotesRelleno={lotesRellenoHoy ?? []}
          lotesMasa={(lotesMasaHoy ?? []).filter((m) => m.kg_sobrante === null)}
          onGuardado={(msg) => onGuardado(msg)}
          onVolver={() => setVista('inicio')}
        />
      )}

      {vista === 'porcionar-pasta' && (
        <FormPorcionar
          local={local}
          lotesFrescos={lotesFrescos ?? []}
          onGuardado={(msg) => onGuardado(msg)}
          onVolver={() => setVista('inicio')}
        />
      )}

      {vista === 'masa' && (
        <FormMasa
          local={local}
          recetas={recetasMasa}
          onGuardado={(msg) => onGuardado(msg)}
          onVolver={() => setVista('inicio')}
        />
      )}

      {vista === 'cerrar-masa' && (
        <FormCerrarMasa
          lotesAbiertos={(lotesMasaHoy ?? []).filter((m) => m.kg_sobrante === null)}
          onGuardado={(msg) => onGuardado(msg)}
          onVolver={() => setVista('inicio')}
        />
      )}

      {vista === 'salsa' && (
        <FormGenerico
          local={local}
          categoria="salsa"
          recetas={recetasSalsa}
          onGuardado={onGuardado}
          onVolver={() => setVista('inicio')}
        />
      )}

      {vista === 'postre' && (
        <FormGenerico
          local={local}
          categoria="postre"
          recetas={recetasPostre}
          onGuardado={onGuardado}
          onVolver={() => setVista('inicio')}
        />
      )}

      {vista === 'pasteleria' && (
        <FormGenerico
          local={local}
          categoria="pasteleria"
          recetas={recetasPasteleria}
          onGuardado={onGuardado}
          onVolver={() => setVista('inicio')}
        />
      )}

      {vista === 'panaderia' && (
        <FormGenerico
          local={local}
          categoria="panaderia"
          recetas={recetasPanaderia}
          onGuardado={onGuardado}
          onVolver={() => setVista('inicio')}
        />
      )}

      {vista === 'prueba' && (
        <FormGenerico
          local={local}
          categoria="prueba"
          recetas={recetasLocal}
          permitirLibre
          permitirLitros
          onGuardado={onGuardado}
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

function Inicio({ local, onIr, lotesHoy, masasAbiertas, frescosPendientes }: {
  local: 'vedia' | 'saavedra'
  onIr: (v: Vista) => void
  lotesHoy: number
  masasAbiertas: number
  frescosPendientes: number
}) {
  const ahora = new Date()
  const fechaLabel = ahora.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })

  const botones: { vista: Vista; label: string; color: string }[] = [
    { vista: 'relleno', label: 'Cargar Relleno', color: 'bg-green-600 hover:bg-green-700' },
    { vista: 'masa', label: 'Cargar Masa', color: 'bg-amber-500 hover:bg-amber-600' },
    { vista: 'pasta', label: 'Armar Pasta (cajones)', color: 'bg-rodziny-700 hover:bg-rodziny-800' },
    { vista: 'salsa', label: 'Cargar Salsa', color: 'bg-orange-500 hover:bg-orange-600' },
  ]
  if (local === 'vedia') {
    botones.push({ vista: 'postre', label: 'Cargar Postre', color: 'bg-pink-500 hover:bg-pink-600' })
    botones.push({ vista: 'prueba', label: 'Cargar Prueba', color: 'bg-purple-500 hover:bg-purple-600' })
  } else {
    botones.push({ vista: 'pasteleria', label: 'Cargar Pastelería Terminada', color: 'bg-pink-500 hover:bg-pink-600' })
    botones.push({ vista: 'panaderia', label: 'Cargar Panadería Terminada', color: 'bg-yellow-600 hover:bg-yellow-700' })
  }

  return (
    <div className="space-y-3 mt-2">
      <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
        <p className="text-xs text-gray-500 capitalize">{fechaLabel}</p>
        <p className="text-sm text-gray-600 mt-1">
          {lotesHoy > 0
            ? `${lotesHoy} lote${lotesHoy > 1 ? 's' : ''} de relleno registrado${lotesHoy > 1 ? 's' : ''} hoy`
            : 'Sin registros de relleno hoy'}
        </p>
        {masasAbiertas > 0 && (
          <p className="text-sm text-amber-600 mt-1">
            {masasAbiertas} masa{masasAbiertas > 1 ? 's' : ''} abierta{masasAbiertas > 1 ? 's' : ''}
          </p>
        )}
        {frescosPendientes > 0 && (
          <p className="text-sm text-blue-600 mt-1">
            {frescosPendientes} cajón{frescosPendientes > 1 ? 'es' : ''} pendiente{frescosPendientes > 1 ? 's' : ''} de porcionar
          </p>
        )}
      </div>

      {botones.map((b) => (
        <button
          key={b.vista}
          onClick={() => onIr(b.vista)}
          className={cn('w-full text-white py-4 rounded-lg font-semibold text-base shadow active:scale-[0.98] transition-transform', b.color)}
        >
          {b.label}
        </button>
      ))}

      {frescosPendientes > 0 && (
        <button
          onClick={() => onIr('porcionar-pasta')}
          className="w-full border-2 border-blue-500 text-blue-700 py-4 rounded-lg font-semibold text-base active:scale-[0.98] transition-transform"
        >
          Porcionar Pasta ({frescosPendientes})
        </button>
      )}

      {masasAbiertas > 0 && (
        <button
          onClick={() => onIr('cerrar-masa')}
          className="w-full border-2 border-amber-500 text-amber-700 py-4 rounded-lg font-semibold text-base active:scale-[0.98] transition-transform"
        >
          Cerrar Masa
        </button>
      )}

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
  const [ingredientesReales, setIngredientesReales] = useState<IngredienteReal[]>([])
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const recetaSel = recetas.find((r) => r.id === recetaId)
  const onGrillaChange = useCallback((ings: IngredienteReal[]) => setIngredientesReales(ings), [])

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
      ingredientes_reales: ingredientesReales.length > 0 ? ingredientesReales : null,
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

        <IngredientesGrilla recetaId={recetaId || null} onChange={onGrillaChange} />

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
        {guardando ? 'Guardando...' : 'Sumar relleno al depósito'}
      </button>
    </div>
  )
}

// ── Formulario Pasta ───────────────────────────────────────────────────────────

function FormPasta({ local, productos, lotesRelleno, lotesMasa, onGuardado, onVolver }: {
  local: string; productos: Producto[]; lotesRelleno: LoteRelleno[]
  lotesMasa: LoteMasa[]
  onGuardado: (msg: string) => void; onVolver: () => void
}) {
  const [productoId, setProductoId] = useState(productos[0]?.id ?? '')
  const [loteRellenoId, setLoteRellenoId] = useState('')
  const [loteMasaId, setLoteMasaId] = useState('')
  const [masaKg, setMasaKg] = useState('')
  const [rellenoKg, setRellenoKg] = useState('')
  const [porciones, setPorciones] = useState('')
  const [cantidadCajones, setCantidadCajones] = useState('')
  const [responsable, setResponsable] = useState('')
  const [notas, setNotas] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const prodSel = productos.find((p) => p.id === productoId)
  const codigoLote = prodSel ? `${prodSel.codigo}-${formatDDMM(hoy())}` : ''

  async function guardar() {
    if (!productoId) { setError('Seleccioná un producto'); return }
    if (!porciones || Number(porciones) <= 0) { setError('Indicá las porciones estimadas'); return }
    setGuardando(true)
    setError('')

    const { error: err } = await supabase.from('cocina_lotes_pasta').insert({
      producto_id: productoId,
      lote_relleno_id: loteRellenoId || null,
      lote_masa_id: loteMasaId || null,
      fecha: hoy(),
      codigo_lote: codigoLote,
      receta_masa_id: lotesMasa.find((m) => m.id === loteMasaId)?.receta_id ?? null,
      masa_kg: masaKg ? Number(masaKg) : null,
      relleno_kg: rellenoKg ? Number(rellenoKg) : null,
      porciones: Number(porciones),
      cantidad_cajones: cantidadCajones ? Number(cantidadCajones) : null,
      ubicacion: 'freezer_produccion',
      responsable: responsable.trim() || null,
      local,
      notas: notas.trim() || null,
    })

    if (err) { setError(err.message); setGuardando(false); return }
    onGuardado(`${prodSel?.nombre ?? 'Pasta'} armada — ${porciones} porciones en ${cantidadCajones || '?'} cajones (${codigoLote})`)
  }

  return (
    <div className="space-y-3 mt-2">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Armar Pasta</h2>
        <button onClick={onVolver} className="text-xs text-gray-500 underline">Volver</button>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded px-3 py-2 text-xs text-blue-800">
        Las pastas armadas quedan en cajones en el freezer de producción. Al día siguiente las
        porcionás en bolsitas de 200g y pasan a la cámara de congelado.
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
          <label className="block text-xs font-medium text-gray-700 mb-1">Masa usada</label>
          <select
            value={loteMasaId}
            onChange={(e) => setLoteMasaId(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2.5 text-sm"
          >
            <option value="">Sin lote de masa</option>
            {lotesMasa.map((m) => (
              <option key={m.id} value={m.id}>
                {m.receta?.nombre ?? 'Masa'} — {m.kg_producidos} kg
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-2">
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
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Cajones armados</label>
            <input
              type="number"
              inputMode="numeric"
              value={cantidadCajones}
              onChange={(e) => setCantidadCajones(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2.5 text-sm"
              placeholder="3"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Porciones estimadas</label>
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
        {guardando ? 'Guardando...' : 'Registrar armado en freezer'}
      </button>
    </div>
  )
}

// ── Formulario Porcionar ───────────────────────────────────────────────────────

function FormPorcionar({ local, lotesFrescos, onGuardado, onVolver }: {
  local: string; lotesFrescos: LotePastaFresco[]
  onGuardado: (msg: string) => void; onVolver: () => void
}) {
  const [loteId, setLoteId] = useState(lotesFrescos[0]?.id ?? '')
  const [porcionesReales, setPorcionesReales] = useState('')
  const [responsable, setResponsable] = useState('')
  const [notas, setNotas] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const loteSel = lotesFrescos.find((l) => l.id === loteId)
  const estimadas = loteSel?.porciones ?? 0
  const reales = Number(porcionesReales) || 0
  const diferencia = reales - estimadas

  async function guardar() {
    if (!loteId || !loteSel) { setError('Elegí un lote'); return }
    if (!porcionesReales || reales <= 0) { setError('Indicá las porciones reales obtenidas'); return }
    setGuardando(true)
    setError('')

    // Actualizar el lote: pasa a cámara congelado, con porciones reales y responsable de porcionado.
    // Si hubo merma (reales < estimadas), la diferencia queda registrada en merma_porcionado.
    const merma = diferencia < 0 ? Math.abs(diferencia) : 0
    const payload: Record<string, unknown> = {
      ubicacion: 'camara_congelado',
      porciones: reales,
      fecha_porcionado: hoy(),
      responsable_porcionado: responsable.trim() || null,
      merma_porcionado: merma,
    }
    // Si el porcionador agregó una nota, se anexa sin pisar la del armado
    if (notas.trim()) {
      payload.notas = `[Porcionado] ${notas.trim()}`
    }
    const { error: err } = await supabase
      .from('cocina_lotes_pasta')
      .update(payload)
      .eq('id', loteId)

    if (err) { setError(err.message); setGuardando(false); return }

    const nombre = loteSel.producto?.nombre ?? 'Pasta'
    const detalle = merma > 0
      ? `${reales} porciones (merma ${merma})`
      : diferencia > 0
        ? `${reales} porciones (+${diferencia} vs estimado)`
        : `${reales} porciones`
    onGuardado(`${nombre} porcionada — ${detalle}`)
  }

  if (lotesFrescos.length === 0) {
    return (
      <div className="space-y-3 mt-2">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Porcionar Pasta</h2>
          <button onClick={onVolver} className="text-xs text-gray-500 underline">Volver</button>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-6 text-center text-sm text-gray-500">
          No hay cajones pendientes de porcionar en {local}.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3 mt-2">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Porcionar Pasta</h2>
        <button onClick={onVolver} className="text-xs text-gray-500 underline">Volver</button>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded px-3 py-2 text-xs text-blue-800">
        Porcioná las pastas en bolsitas de 200g y pasan a la cámara de congelado.
        Si hay diferencia con lo estimado queda registrado como merma automática.
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Lote a porcionar</label>
          <select
            value={loteId}
            onChange={(e) => setLoteId(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2.5 text-sm"
          >
            {lotesFrescos.map((l) => (
              <option key={l.id} value={l.id}>
                {l.codigo_lote} · {l.producto?.nombre ?? 'Pasta'} · {l.porciones} porc. estimadas
              </option>
            ))}
          </select>
        </div>

        {loteSel && (
          <div className="bg-gray-50 border border-gray-200 rounded px-3 py-2 text-xs text-gray-600 space-y-0.5">
            <div>Armado: {loteSel.fecha}</div>
            {loteSel.cantidad_cajones && <div>Cajones: {loteSel.cantidad_cajones}</div>}
            <div>Estimado: <span className="font-semibold">{estimadas}</span> porciones</div>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Porciones reales (bolsitas 200g)</label>
          <input
            type="number"
            inputMode="numeric"
            value={porcionesReales}
            onChange={(e) => setPorcionesReales(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2.5 text-sm"
            placeholder={String(estimadas)}
          />
          {reales > 0 && diferencia !== 0 && (
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
            placeholder="Ej: hubo rotura de bolsas"
          />
        </div>
      </div>

      {error && <div className="text-xs text-red-600 bg-red-50 rounded p-2">{error}</div>}

      <button
        onClick={guardar}
        disabled={guardando}
        className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3.5 rounded-lg font-semibold text-sm disabled:opacity-50 shadow active:scale-[0.98] transition-transform"
      >
        {guardando ? 'Guardando...' : 'Mover a cámara de congelado'}
      </button>
    </div>
  )
}

// ── Formulario Masa ───────────────────────────────────────────────────────────

function FormMasa({ local, recetas, onGuardado, onVolver }: {
  local: string; recetas: Receta[]
  onGuardado: (msg: string) => void; onVolver: () => void
}) {
  const [recetaId, setRecetaId] = useState(recetas[0]?.id ?? '')
  const [kgProducidos, setKgProducidos] = useState('')
  const [responsable, setResponsable] = useState('')
  const [notas, setNotas] = useState('')
  const [ingredientesReales, setIngredientesReales] = useState<IngredienteReal[]>([])
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const recetaSel = recetas.find((r) => r.id === recetaId)
  const onGrillaChange = useCallback((ings: IngredienteReal[]) => setIngredientesReales(ings), [])

  async function guardar() {
    if (!recetaId) { setError('Seleccioná una receta'); return }
    if (!kgProducidos || Number(kgProducidos) <= 0) { setError('Indicá los kg producidos'); return }
    setGuardando(true)
    setError('')

    const { error: err } = await supabase.from('cocina_lotes_masa').insert({
      receta_id: recetaId,
      fecha: hoy(),
      kg_producidos: Number(kgProducidos),
      responsable: responsable.trim() || null,
      local,
      notas: notas.trim() || null,
      ingredientes_reales: ingredientesReales.length > 0 ? ingredientesReales : null,
    })

    if (err) { setError(err.message); setGuardando(false); return }
    onGuardado(`Masa "${recetaSel?.nombre ?? ''}" — ${kgProducidos} kg`)
  }

  return (
    <div className="space-y-3 mt-2">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Cargar Masa</h2>
        <button onClick={onVolver} className="text-xs text-gray-500 underline">Volver</button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Receta de masa</label>
          <select
            value={recetaId}
            onChange={(e) => setRecetaId(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2.5 text-sm"
          >
            {recetas.length === 0 && <option value="">No hay recetas de masa cargadas</option>}
            {recetas.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nombre}{r.rendimiento_kg ? ` (${r.rendimiento_kg} kg/receta)` : ''}
              </option>
            ))}
          </select>
        </div>

        <IngredientesGrilla recetaId={recetaId || null} onChange={onGrillaChange} />

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Kg producidos</label>
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            value={kgProducidos}
            onChange={(e) => setKgProducidos(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2.5 text-sm"
            placeholder="10.0"
          />
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
            placeholder="Ej: masa más hidratada"
          />
        </div>
      </div>

      {error && <div className="text-xs text-red-600 bg-red-50 rounded p-2">{error}</div>}

      <button
        onClick={guardar}
        disabled={guardando}
        className="w-full bg-amber-500 hover:bg-amber-600 text-white py-3.5 rounded-lg font-semibold text-sm disabled:opacity-50 shadow active:scale-[0.98] transition-transform"
      >
        {guardando ? 'Guardando...' : 'Sumar masa al depósito'}
      </button>
    </div>
  )
}

// ── Formulario Cerrar Masa ────────────────────────────────────────────────────

function FormCerrarMasa({ lotesAbiertos, onGuardado, onVolver }: {
  lotesAbiertos: LoteMasa[]
  onGuardado: (msg: string) => void; onVolver: () => void
}) {
  const [selectedId, setSelectedId] = useState(lotesAbiertos[0]?.id ?? '')
  const [kgSobrante, setKgSobrante] = useState('')
  const [destinoSobrante, setDestinoSobrante] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const masaSel = lotesAbiertos.find((m) => m.id === selectedId)

  async function guardar() {
    if (!selectedId) { setError('Seleccioná una masa'); return }
    if (kgSobrante === '' || Number(kgSobrante) < 0) { setError('Indicá el kg sobrante (0 si no queda)'); return }
    if (Number(kgSobrante) > 0 && !destinoSobrante) { setError('Indicá el destino del sobrante'); return }
    setGuardando(true)
    setError('')

    const sobrante = Number(kgSobrante)
    const { error: err } = await supabase
      .from('cocina_lotes_masa')
      .update({
        kg_sobrante: sobrante,
        destino_sobrante: sobrante > 0 ? destinoSobrante : null,
      })
      .eq('id', selectedId)

    if (err) { setError(err.message); setGuardando(false); return }
    onGuardado(`Masa "${masaSel?.receta?.nombre ?? ''}" cerrada — ${kgSobrante} kg sobrante`)
  }

  if (lotesAbiertos.length === 0) {
    return (
      <div className="space-y-3 mt-2">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Cerrar Masa</h2>
          <button onClick={onVolver} className="text-xs text-gray-500 underline">Volver</button>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
          <p className="text-sm text-gray-600">No hay masas abiertas para cerrar.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3 mt-2">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Cerrar Masa</h2>
        <button onClick={onVolver} className="text-xs text-gray-500 underline">Volver</button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
        {lotesAbiertos.length > 1 ? (
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Masa a cerrar</label>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2.5 text-sm"
            >
              {lotesAbiertos.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.receta?.nombre ?? 'Masa'} — {m.kg_producidos} kg
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="bg-amber-50 border border-amber-200 rounded px-3 py-2 text-center">
            <span className="text-[10px] text-amber-600 block">Masa a cerrar</span>
            <span className="font-semibold text-amber-900 text-sm">
              {masaSel?.receta?.nombre ?? 'Masa'} — {masaSel?.kg_producidos} kg
            </span>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Kg sobrante</label>
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            min={0}
            value={kgSobrante}
            onChange={(e) => setKgSobrante(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2.5 text-sm"
            placeholder="0"
          />
        </div>

        {Number(kgSobrante) > 0 && (
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Destino del sobrante</label>
            <select
              value={destinoSobrante}
              onChange={(e) => setDestinoSobrante(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2.5 text-sm"
            >
              <option value="">Seleccionar...</option>
              <option value="fideos">Fideos (reutilizar)</option>
              <option value="merma">Merma (descartar)</option>
              <option value="proxima_masa">Próxima masa</option>
            </select>
          </div>
        )}
      </div>

      {error && <div className="text-xs text-red-600 bg-red-50 rounded p-2">{error}</div>}

      <button
        onClick={guardar}
        disabled={guardando}
        className="w-full bg-amber-500 hover:bg-amber-600 text-white py-3.5 rounded-lg font-semibold text-sm disabled:opacity-50 shadow active:scale-[0.98] transition-transform"
      >
        {guardando ? 'Guardando...' : 'Cerrar masa'}
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

// ── FormGenerico (salsa/postre/pasteleria/panaderia/prueba) ────────────────────

const CATEGORIA_LABEL: Record<CategoriaGenerica, string> = {
  salsa: 'Salsa',
  postre: 'Postre',
  pasteleria: 'Pastelería',
  panaderia: 'Panadería',
  prueba: 'Prueba',
}

function unidadesDisponibles(categoria: CategoriaGenerica, permitirLitros?: boolean): { value: 'kg' | 'unid' | 'lt'; label: string }[] {
  const base: { value: 'kg' | 'unid' | 'lt'; label: string }[] = [
    { value: 'kg', label: 'kg' },
    { value: 'unid', label: 'unid' },
  ]
  if (permitirLitros || categoria === 'salsa' || categoria === 'prueba') {
    base.push({ value: 'lt', label: 'lt' })
  }
  return base
}

function FormGenerico({ local, categoria, recetas, permitirLibre, permitirLitros, onGuardado, onVolver }: {
  local: string
  categoria: CategoriaGenerica
  recetas: Receta[]
  permitirLibre?: boolean
  permitirLitros?: boolean
  onGuardado: (msg: string) => void
  onVolver: () => void
}) {
  const [recetaId, setRecetaId] = useState('')
  const [nombreLibre, setNombreLibre] = useState('')
  const [cantidad, setCantidad] = useState('')
  const [unidad, setUnidad] = useState<'kg' | 'unid' | 'lt'>(
    categoria === 'salsa' ? 'kg' :
    categoria === 'postre' || categoria === 'pasteleria' || categoria === 'panaderia' ? 'unid' :
    'kg'
  )
  const [merma, setMerma] = useState('')
  const [mermaMotivo, setMermaMotivo] = useState('')
  const [responsable, setResponsable] = useState('')
  const [notas, setNotas] = useState('')
  const [ingredientesReales, setIngredientesReales] = useState<IngredienteReal[]>([])
  const [enStock, setEnStock] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const onGrillaChange = useCallback((ings: IngredienteReal[]) => setIngredientesReales(ings), [])

  const recetaSel = recetas.find((r) => r.id === recetaId)
  const unidades = unidadesDisponibles(categoria, permitirLitros)
  const titulo = `Cargar ${CATEGORIA_LABEL[categoria]}`

  async function guardar() {
    if (!recetaId && !(permitirLibre && nombreLibre.trim())) { setError('Seleccioná una receta o escribí el nombre'); return }
    if (!cantidad || Number(cantidad) <= 0) { setError('Indicá la cantidad producida'); return }
    setGuardando(true)
    setError('')

    const { error: err } = await supabase.from('cocina_lotes_produccion').insert({
      fecha: hoy(),
      local,
      categoria,
      receta_id: recetaId || null,
      nombre_libre: permitirLibre && !recetaId ? nombreLibre.trim() : null,
      cantidad_producida: Number(cantidad),
      unidad,
      merma_cantidad: merma ? Number(merma) : null,
      merma_motivo: mermaMotivo.trim() || null,
      responsable: responsable.trim() || null,
      notas: notas.trim() || null,
      ingredientes_reales: ingredientesReales.length > 0 ? ingredientesReales : null,
      en_stock: enStock,
    })

    if (err) { setError(err.message); setGuardando(false); return }
    const nombre = recetaSel?.nombre ?? nombreLibre.trim() ?? CATEGORIA_LABEL[categoria]
    onGuardado(`${CATEGORIA_LABEL[categoria]} "${nombre}" — ${cantidad} ${unidad}`)
  }

  return (
    <div className="space-y-3 mt-2">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">{titulo}</h2>
        <button onClick={onVolver} className="text-xs text-gray-500 underline">Volver</button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
        {recetas.length === 0 && !permitirLibre && (
          <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-800">
            <p className="font-semibold mb-1">No hay recetas disponibles para {CATEGORIA_LABEL[categoria]} en este local.</p>
            <p>Pedile al admin que asigne recetas con tipo adecuado y local = <span className="font-mono">{local}</span>.</p>
          </div>
        )}
        {recetas.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Receta</label>
            <select
              value={recetaId}
              onChange={(e) => setRecetaId(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2.5 text-sm"
            >
              <option value="">— Elegir receta —</option>
              {recetas.map((r) => (
                <option key={r.id} value={r.id}>{r.nombre}</option>
              ))}
            </select>
          </div>
        )}

        {permitirLibre && (
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              {recetaId ? 'O escribí un nombre libre (opcional)' : 'Nombre de la prueba'}
            </label>
            <input
              value={nombreLibre}
              onChange={(e) => setNombreLibre(e.target.value)}
              placeholder="Ej: ravioles de calabaza"
              className="w-full border border-gray-300 rounded px-3 py-2.5 text-sm"
              disabled={!!recetaId}
            />
          </div>
        )}

        <IngredientesGrilla recetaId={recetaId || null} onChange={onGrillaChange} />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Cantidad</label>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              min={0}
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Unidad</label>
            <select
              value={unidad}
              onChange={(e) => setUnidad(e.target.value as 'kg' | 'unid' | 'lt')}
              className="w-full border border-gray-300 rounded px-3 py-2.5 text-sm"
            >
              {unidades.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Merma (opcional)</label>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              min={0}
              value={merma}
              onChange={(e) => setMerma(e.target.value)}
              placeholder={`0 ${unidad}`}
              className="w-full border border-gray-300 rounded px-3 py-2.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Motivo de merma</label>
            <input
              value={mermaMotivo}
              onChange={(e) => setMermaMotivo(e.target.value)}
              placeholder="Ej: se cortó"
              className="w-full border border-gray-300 rounded px-3 py-2.5 text-sm"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Responsable</label>
          <input
            value={responsable}
            onChange={(e) => setResponsable(e.target.value)}
            placeholder="Nombre de quien produjo"
            className="w-full border border-gray-300 rounded px-3 py-2.5 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Notas (opcional)</label>
          <textarea
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            rows={2}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
          />
        </div>

        <label className="flex items-center gap-2 cursor-pointer select-none bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
          <input
            type="checkbox"
            checked={enStock}
            onChange={(e) => setEnStock(e.target.checked)}
            className="w-4 h-4 accent-rodziny-700"
          />
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-800">Cargar a stock</p>
            <p className="text-[10px] text-gray-500">
              {enStock ? 'Este lote queda disponible para venta/servicio' : 'Solo se registra como producción, no cuenta para stock'}
            </p>
          </div>
        </label>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <button
          onClick={guardar}
          disabled={guardando}
          className="w-full bg-rodziny-700 hover:bg-rodziny-800 disabled:opacity-50 text-white py-3 rounded-lg font-semibold text-sm"
        >
          {guardando ? 'Guardando...' : 'Guardar'}
        </button>
      </div>
    </div>
  )
}
