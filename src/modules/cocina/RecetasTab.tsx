import { useState, useMemo, useRef, useEffect, Fragment } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { KPICard } from '@/components/ui/KPICard'
import { cn, formatARS } from '@/lib/utils'
import { useCostosRecetas, type CostoReceta } from './hooks/useCostosRecetas'

interface Ingrediente {
  id: string
  receta_id: string
  nombre: string
  cantidad: number
  unidad: string
  observaciones: string | null
  orden: number
  producto_id: string | null
}

interface Receta {
  id: string
  nombre: string
  tipo: 'relleno' | 'masa' | 'salsa' | 'subreceta' | 'otro'
  rendimiento_kg: number | null
  rendimiento_porciones: number | null
  instrucciones: string | null
  activo: boolean
  margen_seguridad_pct: number | null
  created_at: string
}

const TIPOS = ['relleno', 'masa', 'salsa', 'subreceta', 'otro'] as const
const TIPO_LABEL: Record<string, string> = {
  relleno: 'Relleno', masa: 'Masa', salsa: 'Salsa', subreceta: 'Subreceta', otro: 'Otro',
}
const TIPO_COLOR: Record<string, string> = {
  relleno: 'bg-green-100 text-green-700',
  masa: 'bg-blue-100 text-blue-700',
  salsa: 'bg-orange-100 text-orange-700',
  subreceta: 'bg-purple-100 text-purple-700',
  otro: 'bg-gray-100 text-gray-700',
}

const UNIDADES = ['g', 'kg', 'ml', 'lt', 'unid', 'cdta', 'cda'] as const

export function RecetasTab() {
  const qc = useQueryClient()
  const [busqueda, setBusqueda] = useState('')
  const [filtroTipo, setFiltroTipo] = useState<string>('todos')
  const [modalAbierto, setModalAbierto] = useState(false)
  const [editando, setEditando] = useState<Receta | null>(null)
  const [fichaAbierta, setFichaAbierta] = useState<string | null>(null) // receta_id expandida

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

  const { costos } = useCostosRecetas()

  // Ingredientes de todas las recetas (para mostrar en fichas expandidas)
  const { data: todosIngredientes } = useQuery({
    queryKey: ['cocina-receta-ingredientes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_receta_ingredientes')
        .select('*')
        .order('orden')
      if (error) throw error
      return data as Ingrediente[]
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

  const ingredientesPorReceta = useMemo(() => {
    const mapa = new Map<string, Ingrediente[]>()
    for (const ing of todosIngredientes ?? []) {
      if (!mapa.has(ing.receta_id)) mapa.set(ing.receta_id, [])
      mapa.get(ing.receta_id)!.push(ing)
    }
    return mapa
  }, [todosIngredientes])

  const kpis = useMemo(() => {
    const all = recetas ?? []
    let conCosto = 0
    let sinCosto = 0
    for (const r of all) {
      const c = costos.get(r.id)
      if (c && c.costoBase > 0) conCosto++
      else if ((ingredientesPorReceta.get(r.id)?.length ?? 0) > 0) sinCosto++
    }
    return {
      total: all.length,
      rellenos: all.filter((r) => r.tipo === 'relleno').length,
      masas: all.filter((r) => r.tipo === 'masa').length,
      salsas: all.filter((r) => r.tipo === 'salsa').length,
      subrecetas: all.filter((r) => r.tipo === 'subreceta').length,
      conCosto,
      sinCosto,
    }
  }, [recetas, costos, ingredientesPorReceta])

  const eliminar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('cocina_recetas').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cocina-recetas'] })
      qc.invalidateQueries({ queryKey: ['cocina-receta-ingredientes'] })
      qc.invalidateQueries({ queryKey: ['cocina-recetas-costeo'] })
      qc.invalidateQueries({ queryKey: ['cocina-receta-ingredientes-costeo'] })
    },
  })

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <KPICard label="Total recetas" value={String(kpis.total)} color="blue" loading={isLoading} />
        <KPICard label="Subrecetas" value={String(kpis.subrecetas)} color="neutral" loading={isLoading} />
        <KPICard label="Rellenos" value={String(kpis.rellenos)} color="green" loading={isLoading} />
        <KPICard label="Masas" value={String(kpis.masas)} color="neutral" loading={isLoading} />
        <KPICard label="Con costeo" value={String(kpis.conCosto)} color="green" loading={isLoading} />
        <KPICard label="Sin match" value={String(kpis.sinCosto)} color={kpis.sinCosto > 0 ? 'yellow' : 'neutral'} loading={isLoading} />
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
              <th className="px-4 py-2 w-8"></th>
              <th className="px-4 py-2">Nombre</th>
              <th className="px-4 py-2">Tipo</th>
              <th className="px-4 py-2 text-center">Ingredientes</th>
              <th className="px-4 py-2">Rinde (kg)</th>
              <th className="px-4 py-2">Rinde (porciones)</th>
              <th className="px-4 py-2 text-right">Costo total</th>
              <th className="px-4 py-2 text-right">$/kg</th>
              <th className="px-4 py-2 text-right">$/porción</th>
              <th className="px-4 py-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((r) => {
              const ings = ingredientesPorReceta.get(r.id) ?? []
              const abierta = fichaAbierta === r.id
              const costo = costos.get(r.id)
              const tieneAdv = costo?.advertencias && costo.advertencias.length > 0
              return (
                <Fragment key={r.id}>
                  <tr className={cn('border-b border-surface-border hover:bg-gray-50', abierta && 'bg-blue-50/30')}>
                    <td className="px-4 py-2">
                      <button
                        onClick={() => setFichaAbierta(abierta ? null : r.id)}
                        className={cn(
                          'w-5 h-5 flex items-center justify-center rounded text-xs transition-colors',
                          abierta ? 'bg-rodziny-100 text-rodziny-700' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100',
                        )}
                        title="Ver ficha técnica"
                      >
                        {abierta ? '▾' : '▸'}
                      </button>
                    </td>
                    <td className="px-4 py-2 font-medium text-gray-900">
                      <div className="flex items-center gap-1.5">
                        <span>{r.nombre}</span>
                        {tieneAdv && (
                          <span title={costo!.advertencias.join('\n')} className="text-amber-500 text-xs">⚠</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', TIPO_COLOR[r.tipo])}>
                        {TIPO_LABEL[r.tipo]}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-center">
                      {ings.length > 0 ? (
                        <span className="text-xs font-medium text-gray-600">{ings.length}</span>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2">{r.rendimiento_kg != null ? `${r.rendimiento_kg} kg` : '—'}</td>
                    <td className="px-4 py-2">{r.rendimiento_porciones ?? '—'}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium text-gray-800">
                      {costo && costo.costoConMargen > 0 ? formatARS(costo.costoConMargen) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                      {costo?.costoPorKg != null ? formatARS(costo.costoPorKg) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                      {costo?.costoPorPorcion != null ? formatARS(costo.costoPorPorcion) : <span className="text-gray-300">—</span>}
                    </td>
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
                  {abierta && (
                    <tr className="bg-blue-50/20">
                      <td colSpan={10} className="px-4 py-0">
                        <FichaTecnica receta={r} ingredientes={ings} costo={costo} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
            {filtrados.length === 0 && (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400">{isLoading ? 'Cargando...' : 'No hay recetas'}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {modalAbierto && (
        <ModalReceta
          receta={editando}
          ingredientes={editando ? (ingredientesPorReceta.get(editando.id) ?? []) : []}
          todasLasRecetas={recetas ?? []}
          onClose={() => setModalAbierto(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['cocina-recetas'] })
            qc.invalidateQueries({ queryKey: ['cocina-receta-ingredientes'] })
            setModalAbierto(false)
          }}
        />
      )}
    </div>
  )
}

// ─── Ficha Técnica (expandible) ─────────────────────────────────────────────
function FichaTecnica({ receta, ingredientes, costo }: { receta: Receta; ingredientes: Ingrediente[]; costo: CostoReceta | undefined }) {
  const pasos = (receta.instrucciones ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

  const detallePorIng = new Map(costo?.detalles.map((d) => [d.id, d]) ?? [])

  return (
    <div className="py-4 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Ingredientes con costos */}
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Ingredientes y costeo</h4>
          {ingredientes.length === 0 ? (
            <p className="text-xs text-gray-400 italic">Sin ingredientes cargados</p>
          ) : (
            <div className="bg-white rounded border border-gray-200 overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-gray-50">
                  <tr className="text-gray-500">
                    <th className="text-left px-3 py-1.5 font-medium">Ingrediente</th>
                    <th className="text-right px-3 py-1.5 font-medium">Cantidad</th>
                    <th className="text-left px-3 py-1.5 font-medium">Un.</th>
                    <th className="text-right px-3 py-1.5 font-medium">Costo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {ingredientes.map((ing) => {
                    const det = detallePorIng.get(ing.id)
                    return (
                      <tr key={ing.id}>
                        <td className="px-3 py-1.5 text-gray-800">
                          <div className="flex items-center gap-1.5">
                            {det?.esSubreceta && (
                              <span className="text-[9px] bg-purple-100 text-purple-700 px-1 py-0.5 rounded font-medium">Sub</span>
                            )}
                            <span className="font-medium">{ing.nombre}</span>
                          </div>
                          {det?.error && <div className="text-[10px] text-amber-600 mt-0.5">⚠ {det.error}</div>}
                          {!det?.error && det?.productoNombre && det.productoNombre.toLowerCase() !== ing.nombre.toLowerCase() && (
                            <div className="text-[10px] text-gray-400 mt-0.5">→ {det.productoNombre}</div>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">
                          {formatCantidad(ing.cantidad)}
                        </td>
                        <td className="px-3 py-1.5 text-gray-500">{ing.unidad}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-medium text-gray-800">
                          {det?.costoTotal != null ? formatARS(det.costoTotal) : <span className="text-gray-300">—</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                {costo && (
                  <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                    <tr>
                      <td colSpan={3} className="px-3 py-1.5 font-semibold text-gray-700">Costo base</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-gray-800">{formatARS(costo.costoBase)}</td>
                    </tr>
                    {costo.margenPct > 0 && (
                      <>
                        <tr>
                          <td colSpan={3} className="px-3 py-1 text-gray-500">Margen de seguridad ({(costo.margenPct * 100).toFixed(1)}%)</td>
                          <td className="px-3 py-1 text-right tabular-nums text-gray-600">
                            +{formatARS(costo.costoConMargen - costo.costoBase)}
                          </td>
                        </tr>
                        <tr>
                          <td colSpan={3} className="px-3 py-1.5 font-bold text-rodziny-700">Total con margen</td>
                          <td className="px-3 py-1.5 text-right tabular-nums font-bold text-rodziny-700">{formatARS(costo.costoConMargen)}</td>
                        </tr>
                      </>
                    )}
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>

        {/* Procedimiento + Rendimiento + Costo unitario */}
        <div className="space-y-4">
          {/* Rendimiento y costo unitario */}
          <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Rendimiento</h4>
            <div className="flex flex-wrap gap-3">
              {receta.rendimiento_kg != null && (
                <div className="bg-white rounded border border-gray-200 px-3 py-2 text-center">
                  <div className="text-lg font-bold text-gray-800">{receta.rendimiento_kg} kg</div>
                  <div className="text-[10px] text-gray-400 uppercase">Peso total</div>
                  {costo?.costoPorKg != null && (
                    <div className="text-[11px] text-rodziny-700 font-semibold mt-1">{formatARS(costo.costoPorKg)}/kg</div>
                  )}
                </div>
              )}
              {receta.rendimiento_porciones != null && (
                <div className="bg-white rounded border border-gray-200 px-3 py-2 text-center">
                  <div className="text-lg font-bold text-gray-800">{receta.rendimiento_porciones}</div>
                  <div className="text-[10px] text-gray-400 uppercase">Porciones</div>
                  {costo?.costoPorPorcion != null && (
                    <div className="text-[11px] text-rodziny-700 font-semibold mt-1">{formatARS(costo.costoPorPorcion)}/u</div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Procedimiento */}
          {pasos.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Procedimiento</h4>
              <ol className="space-y-1.5">
                {pasos.map((paso, i) => (
                  <li key={i} className="flex gap-2 text-xs">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-rodziny-100 text-rodziny-700 flex items-center justify-center text-[10px] font-bold mt-0.5">
                      {i + 1}
                    </span>
                    <span className="text-gray-700 leading-relaxed">{paso}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Modal crear/editar receta con ingredientes ─────────────────────────────
interface ProductoCompras {
  id: string
  nombre: string
  marca: string | null
  unidad: string
  categoria: string | null
}

interface IngredienteForm {
  tempId: string
  dbId: string | null // null = nuevo
  nombre: string
  cantidad: string
  unidad: string
  observaciones: string
  producto_id: string | null
}

function ModalReceta({
  receta,
  ingredientes: ingredientesExistentes,
  todasLasRecetas,
  onClose,
  onSaved,
}: {
  receta: Receta | null
  ingredientes: Ingrediente[]
  todasLasRecetas: Receta[]
  onClose: () => void
  onSaved: () => void
}) {
  const [nombre, setNombre] = useState(receta?.nombre ?? '')
  const [tipo, setTipo] = useState(receta?.tipo ?? 'relleno')
  const [rendKg, setRendKg] = useState(receta?.rendimiento_kg ?? '')
  const [rendPorciones, setRendPorciones] = useState(receta?.rendimiento_porciones ?? '')
  const [instrucciones, setInstrucciones] = useState(receta?.instrucciones ?? '')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'general' | 'ingredientes' | 'procedimiento'>('general')

  // Productos de compras (para autocomplete)
  const { data: productosCompras } = useQuery({
    queryKey: ['productos-compras-recetas'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('productos')
        .select('id, nombre, marca, unidad, categoria')
        .eq('activo', true)
        .order('nombre')
      if (error) throw error
      return data as ProductoCompras[]
    },
  })

  // Ingredientes editables
  const [ings, setIngs] = useState<IngredienteForm[]>(() =>
    ingredientesExistentes.map((ing) => ({
      tempId: ing.id,
      dbId: ing.id,
      nombre: ing.nombre,
      cantidad: String(ing.cantidad),
      unidad: ing.unidad,
      observaciones: ing.observaciones ?? '',
      producto_id: ing.producto_id,
    }))
  )

  function agregarIngrediente() {
    setIngs([...ings, {
      tempId: crypto.randomUUID(),
      dbId: null,
      nombre: '',
      cantidad: '',
      unidad: 'g',
      observaciones: '',
      producto_id: null,
    }])
  }

  function actualizarIng(tempId: string, campo: keyof IngredienteForm, valor: string) {
    setIngs(ings.map((i) => i.tempId === tempId ? { ...i, [campo]: valor } : i))
  }

  function seleccionarProducto(tempId: string, producto: ProductoCompras) {
    setIngs(ings.map((i) => i.tempId === tempId ? {
      ...i,
      nombre: producto.nombre,
      producto_id: producto.id,
      unidad: mapearUnidad(producto.unidad),
    } : i))
  }

  function eliminarIng(tempId: string) {
    setIngs(ings.filter((i) => i.tempId !== tempId))
  }

  function moverIng(tempId: string, dir: -1 | 1) {
    const idx = ings.findIndex((i) => i.tempId === tempId)
    if (idx < 0) return
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= ings.length) return
    const copia = [...ings]
    ;[copia[idx], copia[newIdx]] = [copia[newIdx], copia[idx]]
    setIngs(copia)
  }

  const guardar = async () => {
    if (!nombre.trim()) { setError('El nombre es obligatorio'); return }
    setGuardando(true)
    setError('')

    try {
      // 1. Guardar receta (margen_seguridad_pct se edita desde Finanzas > Costeo)
      const row = {
        nombre: nombre.trim(),
        tipo,
        rendimiento_kg: rendKg !== '' ? Number(rendKg) : null,
        rendimiento_porciones: rendPorciones !== '' ? Number(rendPorciones) : null,
        instrucciones: instrucciones.trim() || null,
        updated_at: new Date().toISOString(),
      }

      let recetaId = receta?.id
      if (receta) {
        const { error: err } = await supabase.from('cocina_recetas').update(row).eq('id', receta.id)
        if (err) throw err
      } else {
        const { data, error: err } = await supabase
          .from('cocina_recetas')
          .insert({ ...row, activo: true })
          .select('id')
          .single()
        if (err) throw err
        recetaId = data.id
      }

      // 2. Sync ingredientes
      // Borrar los que ya no están
      const idsActuales = ings.filter((i) => i.dbId).map((i) => i.dbId!)
      const idsOriginales = ingredientesExistentes.map((i) => i.id)
      const idsABorrar = idsOriginales.filter((id) => !idsActuales.includes(id))

      if (idsABorrar.length > 0) {
        const { error: delErr } = await supabase
          .from('cocina_receta_ingredientes')
          .delete()
          .in('id', idsABorrar)
        if (delErr) throw delErr
      }

      // Upsert ingredientes (update existentes + insert nuevos)
      for (let i = 0; i < ings.length; i++) {
        const ing = ings[i]
        if (!ing.nombre.trim() || !ing.cantidad) continue

        const payload = {
          receta_id: recetaId!,
          nombre: ing.nombre.trim(),
          cantidad: Number(ing.cantidad),
          unidad: ing.unidad,
          observaciones: ing.observaciones.trim() || null,
          orden: i,
          producto_id: ing.producto_id || null,
        }

        if (ing.dbId) {
          const { error: updErr } = await supabase
            .from('cocina_receta_ingredientes')
            .update(payload)
            .eq('id', ing.dbId)
          if (updErr) throw updErr
        } else {
          const { error: insErr } = await supabase
            .from('cocina_receta_ingredientes')
            .insert(payload)
          if (insErr) throw insErr
        }
      }

      onSaved()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : (err as { message?: string })?.message ?? 'Error desconocido'
      setError(msg)
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-5 pb-3 border-b border-gray-200">
          <h3 className="text-lg font-bold text-gray-800">{receta ? 'Editar receta' : 'Nueva receta'}</h3>
          {/* Tabs del modal */}
          <div className="flex gap-1 mt-3">
            {(['general', 'ingredientes', 'procedimiento'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  'px-3 py-1.5 text-xs rounded-t font-medium transition-colors',
                  tab === t
                    ? 'bg-rodziny-50 text-rodziny-700 border border-b-0 border-rodziny-200'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50',
                )}
              >
                {t === 'general' ? 'General' : t === 'ingredientes' ? `Ingredientes (${ings.length})` : 'Procedimiento'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* Tab General */}
          {tab === 'general' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Nombre *</label>
                <input
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                  placeholder="Relleno Jamón, Queso y Cebolla"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Tipo</label>
                <select
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value as Receta['tipo'])}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                >
                  {TIPOS.map((t) => <option key={t} value={t}>{TIPO_LABEL[t]}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Rendimiento (kg)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={rendKg}
                    onChange={(e) => setRendKg(e.target.value)}
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                    placeholder="5.5"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Rendimiento (porciones)</label>
                  <input
                    type="number"
                    value={rendPorciones}
                    onChange={(e) => setRendPorciones(e.target.value)}
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                    placeholder="45"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Tab Ingredientes */}
          {tab === 'ingredientes' && (
            <div className="space-y-3">
              {ings.length === 0 && (
                <p className="text-xs text-gray-400 italic text-center py-4">
                  No hay ingredientes todavía. Agregá el primero.
                </p>
              )}
              {ings.map((ing, idx) => (
                <div
                  key={ing.tempId}
                  className="bg-gray-50 rounded-lg p-2.5 border border-gray-200 space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-400 font-mono w-4 text-right flex-shrink-0">
                      {idx + 1}
                    </span>
                    <div className="flex-1">
                      <AutocompleteIngrediente
                        valor={ing.nombre}
                        productos={productosCompras ?? []}
                        recetas={todasLasRecetas}
                        recetaActualId={receta?.id ?? null}
                        onChange={(v) => actualizarIng(ing.tempId, 'nombre', v)}
                        onSelect={(p) => seleccionarProducto(ing.tempId, p)}
                      />
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => moverIng(ing.tempId, -1)}
                        disabled={idx === 0}
                        className="text-gray-400 hover:text-gray-600 disabled:opacity-20 text-[10px] px-1"
                        title="Subir"
                      >▲</button>
                      <button
                        onClick={() => moverIng(ing.tempId, 1)}
                        disabled={idx === ings.length - 1}
                        className="text-gray-400 hover:text-gray-600 disabled:opacity-20 text-[10px] px-1"
                        title="Bajar"
                      >▼</button>
                      <button
                        onClick={() => eliminarIng(ing.tempId)}
                        className="text-red-400 hover:text-red-600 text-xs ml-1"
                        title="Eliminar ingrediente"
                      >✕</button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-6">
                    <input
                      type="number"
                      step="0.1"
                      value={ing.cantidad}
                      onChange={(e) => actualizarIng(ing.tempId, 'cantidad', e.target.value)}
                      placeholder="Cantidad"
                      className="w-24 border border-gray-300 rounded px-2 py-1 text-sm text-right"
                    />
                    <select
                      value={ing.unidad}
                      onChange={(e) => actualizarIng(ing.tempId, 'unidad', e.target.value)}
                      className="w-16 border border-gray-300 rounded px-1 py-1 text-sm"
                    >
                      {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                    <input
                      value={ing.observaciones}
                      onChange={(e) => actualizarIng(ing.tempId, 'observaciones', e.target.value)}
                      placeholder="Observaciones..."
                      className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm text-gray-500"
                    />
                  </div>
                </div>
              ))}
              <button
                onClick={agregarIngrediente}
                className="w-full border-2 border-dashed border-gray-300 rounded-lg py-2 text-sm text-gray-500 hover:text-rodziny-700 hover:border-rodziny-300 transition-colors"
              >
                + Agregar ingrediente
              </button>
            </div>
          )}

          {/* Tab Procedimiento */}
          {tab === 'procedimiento' && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Escribí cada paso en una línea separada. Se van a numerar automáticamente.
              </label>
              <textarea
                value={instrucciones}
                onChange={(e) => setInstrucciones(e.target.value)}
                rows={12}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm leading-relaxed"
                placeholder={"Cortar cebolla en pluma\nPoner a calentar manteca y aceite\nAgregar la cebolla y cocinar 40 min a fuego bajo\n..."}
              />
              {instrucciones.trim() && (
                <div className="mt-3 bg-gray-50 rounded-lg border border-gray-200 p-3">
                  <p className="text-[10px] text-gray-400 uppercase font-medium mb-2">Vista previa</p>
                  <ol className="space-y-1">
                    {instrucciones.split('\n').filter((s) => s.trim()).map((paso, i) => (
                      <li key={i} className="flex gap-2 text-xs">
                        <span className="flex-shrink-0 w-4 h-4 rounded-full bg-rodziny-100 text-rodziny-700 flex items-center justify-center text-[9px] font-bold mt-0.5">
                          {i + 1}
                        </span>
                        <span className="text-gray-700">{paso.trim()}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}
        </div>

        {error && <p className="text-red-500 text-xs px-6 pb-2">{error}</p>}

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-200">
          <button onClick={onClose} className="px-4 py-1.5 text-sm text-gray-600 hover:text-gray-800">Cancelar</button>
          <button
            onClick={guardar}
            disabled={guardando}
            className="bg-rodziny-700 hover:bg-rodziny-800 text-white text-sm rounded px-4 py-1.5 disabled:opacity-50"
          >
            {guardando ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Autocomplete de ingredientes (busca en productos de Compras + recetas) ─
interface OpcionAutocomplete {
  id: string
  nombre: string
  unidad: string
  tipo: 'producto' | 'receta'
  detalle: string // categoría o tipo de receta
}

function AutocompleteIngrediente({
  valor,
  productos,
  recetas,
  recetaActualId,
  onChange,
  onSelect,
}: {
  valor: string
  productos: ProductoCompras[]
  recetas: Receta[]
  recetaActualId: string | null
  onChange: (v: string) => void
  onSelect: (p: ProductoCompras) => void
}) {
  const [abierto, setAbierto] = useState(false)
  const [focused, setFocused] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Combinar productos + recetas en una sola lista
  const opciones = useMemo(() => {
    const lista: OpcionAutocomplete[] = []

    // Recetas primero (excluyendo la receta actual para evitar referencia circular)
    for (const r of recetas) {
      if (r.id === recetaActualId) continue
      lista.push({
        id: r.id,
        nombre: r.nombre,
        unidad: r.rendimiento_kg != null ? 'kg' : 'unid',
        tipo: 'receta',
        detalle: TIPO_LABEL[r.tipo] ?? r.tipo,
      })
    }

    // Productos de compras (deduplicar por nombre+marca)
    const vistos = new Set<string>()
    for (const p of productos) {
      const clave = `${p.nombre.toLowerCase()}|${(p.marca ?? '').toLowerCase()}`
      if (vistos.has(clave)) continue
      vistos.add(clave)
      lista.push({
        id: p.id,
        nombre: p.marca ? `${p.nombre} ${p.marca}` : p.nombre,
        unidad: p.unidad,
        tipo: 'producto',
        detalle: p.categoria ?? '',
      })
    }

    return lista
  }, [productos, recetas, recetaActualId])

  const filtrados = useMemo(() => {
    if (!valor.trim()) {
      // Sin búsqueda: mostrar recetas primero, luego productos
      const recs = opciones.filter((o) => o.tipo === 'receta').slice(0, 5)
      const prods = opciones.filter((o) => o.tipo === 'producto').slice(0, 10)
      return [...recs, ...prods]
    }
    const q = valor.toLowerCase()
    return opciones.filter((o) => o.nombre.toLowerCase().includes(q)).slice(0, 12)
  }, [valor, opciones])

  // Cerrar al hacer click afuera
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setAbierto(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <input
        value={valor}
        onChange={(e) => {
          onChange(e.target.value)
          setAbierto(true)
        }}
        onFocus={() => { setFocused(true); setAbierto(true) }}
        onBlur={() => setFocused(false)}
        placeholder="Buscar ingrediente o subreceta..."
        className={cn(
          'w-full border rounded px-2 py-1 text-sm',
          focused ? 'border-rodziny-400 ring-1 ring-rodziny-200' : 'border-gray-300',
        )}
      />
      {abierto && filtrados.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
          {filtrados.map((o, i) => {
            // Separador visual entre recetas y productos
            const prevTipo = i > 0 ? filtrados[i - 1].tipo : null
            const mostrarSeparador = prevTipo && prevTipo !== o.tipo
            return (
              <Fragment key={`${o.tipo}-${o.id}`}>
                {mostrarSeparador && <div className="border-t border-gray-100 mx-2" />}
                <button
                  type="button"
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-rodziny-50 flex items-center justify-between gap-2"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    onSelect({ id: o.id, nombre: o.nombre, marca: null, unidad: o.unidad, categoria: o.detalle })
                    setAbierto(false)
                  }}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {o.tipo === 'receta' && (
                      <span className="text-[9px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-medium flex-shrink-0">
                        Receta
                      </span>
                    )}
                    <span className="truncate text-gray-800">{o.nombre}</span>
                  </div>
                  <span className="text-[10px] text-gray-400 flex-shrink-0">
                    {o.unidad}{o.detalle ? ` · ${o.detalle}` : ''}
                  </span>
                </button>
              </Fragment>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────
// Mapear unidades de Compras → unidades de receta
function mapearUnidad(unidadCompras: string): string {
  const u = unidadCompras.toLowerCase().trim()
  if (u === 'kg' || u === 'kgs') return 'kg'
  if (u === 'g' || u === 'gr' || u === 'grs' || u === 'gramos') return 'g'
  if (u === 'lt' || u === 'l' || u === 'lts' || u === 'litros' || u === 'litro') return 'lt'
  if (u === 'ml' || u === 'mililitros') return 'ml'
  if (u === 'unid.' || u === 'unid' || u === 'u' || u === 'unidades' || u === 'unidad') return 'unid'
  return 'g' // default
}

function formatCantidad(n: number): string {
  if (Number.isInteger(n)) return String(n)
  return n.toLocaleString('es-AR', { maximumFractionDigits: 2 })
}
