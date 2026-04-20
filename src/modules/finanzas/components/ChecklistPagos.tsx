import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatARS, cn } from '@/lib/utils'

// ── tipos ────────────────────────────────────────────────────────────────────
interface Concepto {
  id: string
  nombre: string
  categoria: string
  monto_default: number | null
  dia_vencimiento: number | null
  orden: number
  activo: boolean
  notas: string | null
}

interface ChecklistItem {
  id: string
  concepto_id: string
  periodo: string
  monto: number | null
  fecha_vencimiento: string | null
  pagado: boolean
  fecha_pago: string | null
  notas: string | null
}

// ── constantes ───────────────────────────────────────────────────────────────
const CATEGORIAS_ORDEN = [
  'Gastos Fijos',
  'Impuestos y Tasas',
  'Gastos administrativos',
  'Gastos de RRHH',
  'Regularizacion de impuestos',
  'Cheques',
]

const CAT_ICONS: Record<string, string> = {
  'Gastos Fijos': '🏠',
  'Impuestos y Tasas': '🏛',
  'Gastos administrativos': '💼',
  'Gastos de RRHH': '👥',
  'Regularizacion de impuestos': '📋',
  'Cheques': '📝',
}

function periodoAnterior(p: string): string {
  const [y, m] = p.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function periodoSiguiente(p: string): string {
  const [y, m] = p.split('-').map(Number)
  const d = new Date(y, m, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function labelMes(p: string): string {
  const [y, m] = p.split('-').map(Number)
  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
  return `${meses[m - 1]} ${y}`
}

function hoy(): string {
  return new Date().toISOString().split('T')[0]
}

// ── componente ───────────────────────────────────────────────────────────────
export function ChecklistPagos() {
  const qc = useQueryClient()
  const [periodo, setPeriodo] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [showConfig, setShowConfig] = useState(false)
  const [seccionesAbiertas, setSeccionesAbiertas] = useState<Set<string>>(new Set(CATEGORIAS_ORDEN))

  // ── queries ──────────────────────────────────────────────────────────────
  const { data: conceptos } = useQuery({
    queryKey: ['conceptos_gasto_fijo'],
    queryFn: async () => {
      const { data } = await supabase
        .from('conceptos_gasto_fijo')
        .select('*')
        .order('categoria')
        .order('orden')
      return (data ?? []) as Concepto[]
    },
  })

  const { data: checklist, isLoading } = useQuery({
    queryKey: ['checklist_pagos', periodo],
    queryFn: async () => {
      const { data } = await supabase
        .from('checklist_pagos_mensuales')
        .select('*')
        .eq('periodo', periodo)
      return (data ?? []) as ChecklistItem[]
    },
  })

  // ── mutaciones ───────────────────────────────────────────────────────────
  const upsertItem = useMutation({
    mutationFn: async (item: Partial<ChecklistItem> & { concepto_id: string; periodo: string }) => {
      const { error } = await supabase
        .from('checklist_pagos_mensuales')
        .upsert(item, { onConflict: 'concepto_id,periodo' })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['checklist_pagos', periodo] }),
  })

  const generarMes = useMutation({
    mutationFn: async () => {
      const activos = (conceptos ?? []).filter((c) => c.activo)
      if (!activos.length) return

      // Buscar mes anterior
      const pAnterior = periodoAnterior(periodo)
      const { data: anterior } = await supabase
        .from('checklist_pagos_mensuales')
        .select('*')
        .eq('periodo', pAnterior)
      const antMap = new Map((anterior ?? []).map((a: ChecklistItem) => [a.concepto_id, a]))

      const [y, m] = periodo.split('-').map(Number)
      const rows = activos.map((c) => {
        const ant = antMap.get(c.id)
        const monto = ant ? ant.monto : c.monto_default
        const dia = ant && ant.fecha_vencimiento
          ? new Date(ant.fecha_vencimiento + 'T12:00:00').getDate()
          : c.dia_vencimiento
        const ultimoDia = new Date(y, m, 0).getDate()
        const diaReal = dia ? Math.min(dia, ultimoDia) : null
        const fechaVto = diaReal ? `${periodo}-${String(diaReal).padStart(2, '0')}` : null

        return {
          concepto_id: c.id,
          periodo,
          monto,
          fecha_vencimiento: fechaVto,
          pagado: false,
          fecha_pago: null,
          notas: null,
        }
      })

      const { error } = await supabase
        .from('checklist_pagos_mensuales')
        .upsert(rows, { onConflict: 'concepto_id,periodo' })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['checklist_pagos', periodo] }),
  })

  // ── datos derivados ──────────────────────────────────────────────────────
  const checkMap = useMemo(() => {
    const m = new Map<string, ChecklistItem>()
    for (const item of checklist ?? []) m.set(item.concepto_id, item)
    return m
  }, [checklist])

  const porCategoria = useMemo(() => {
    const activos = (conceptos ?? []).filter((c) => c.activo)
    const grupos = new Map<string, { concepto: Concepto; item: ChecklistItem | null }[]>()
    for (const cat of CATEGORIAS_ORDEN) grupos.set(cat, [])
    for (const c of activos) {
      const grupo = grupos.get(c.categoria) ?? []
      grupo.push({ concepto: c, item: checkMap.get(c.id) ?? null })
      if (!grupos.has(c.categoria)) grupos.set(c.categoria, grupo)
    }
    return grupos
  }, [conceptos, checkMap])

  const resumen = useMemo(() => {
    let totalEstimado = 0, totalPagado = 0, itemsPagados = 0, itemsTotal = 0
    for (const [, filas] of porCategoria) {
      for (const { item } of filas) {
        if (!item) continue
        itemsTotal++
        const m = item.monto ?? 0
        totalEstimado += m
        if (item.pagado) { totalPagado += m; itemsPagados++ }
      }
    }
    return { totalEstimado, totalPagado, pendiente: totalEstimado - totalPagado, itemsPagados, itemsTotal }
  }, [porCategoria])

  const tieneItems = (checklist?.length ?? 0) > 0

  // ── handlers ─────────────────────────────────────────────────────────────
  function toggleSeccion(cat: string) {
    setSeccionesAbiertas((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  function guardarCampo(conceptoId: string, campo: string, valor: unknown) {
    const existing = checkMap.get(conceptoId)
    const payload: Record<string, unknown> = {
      concepto_id: conceptoId,
      periodo,
      [campo]: valor,
    }
    // Si marca pagado y no tiene fecha_pago, auto-setear hoy
    if (campo === 'pagado' && valor === true && !existing?.fecha_pago) {
      payload.fecha_pago = hoy()
    }
    // Si desmarca pagado, limpiar fecha_pago
    if (campo === 'pagado' && valor === false) {
      payload.fecha_pago = null
    }
    upsertItem.mutate(payload as Partial<ChecklistItem> & { concepto_id: string; periodo: string })
  }

  // ── render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPeriodo(periodoAnterior(periodo))}
            className="px-2 py-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
          >
            ←
          </button>
          <h3 className="text-lg font-semibold text-gray-800 min-w-[160px] text-center">
            {labelMes(periodo)}
          </h3>
          <button
            onClick={() => setPeriodo(periodoSiguiente(periodo))}
            className="px-2 py-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
          >
            →
          </button>
        </div>
        <div className="flex items-center gap-2">
          {!tieneItems && !isLoading && (
            <button
              onClick={() => generarMes.mutate()}
              disabled={generarMes.isPending}
              className="px-4 py-2 bg-rodziny-800 hover:bg-rodziny-700 text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50"
            >
              {generarMes.isPending ? 'Generando...' : 'Generar mes'}
            </button>
          )}
          <button
            onClick={() => setShowConfig(!showConfig)}
            className={cn(
              'px-3 py-2 text-sm rounded-md transition-colors',
              showConfig ? 'bg-gray-200 text-gray-800' : 'text-gray-500 hover:bg-gray-100'
            )}
            title="Configurar conceptos"
          >
            ⚙️
          </button>
        </div>
      </div>

      {/* KPIs */}
      {tieneItems && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white rounded-lg border border-surface-border p-4">
            <p className="text-xs text-gray-500 mb-1">Total Estimado</p>
            <p className="text-lg font-semibold text-gray-800">{formatARS(resumen.totalEstimado)}</p>
          </div>
          <div className="bg-white rounded-lg border border-surface-border p-4">
            <p className="text-xs text-gray-500 mb-1">Total Pagado</p>
            <p className="text-lg font-semibold text-green-700">{formatARS(resumen.totalPagado)}</p>
          </div>
          <div className="bg-white rounded-lg border border-surface-border p-4">
            <p className="text-xs text-gray-500 mb-1">Pendiente</p>
            <p className="text-lg font-semibold text-red-600">{formatARS(resumen.pendiente)}</p>
          </div>
          <div className="bg-white rounded-lg border border-surface-border p-4">
            <p className="text-xs text-gray-500 mb-1">Progreso</p>
            <p className="text-lg font-semibold text-gray-800">{resumen.itemsPagados} / {resumen.itemsTotal}</p>
            <div className="mt-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full transition-all"
                style={{ width: resumen.itemsTotal > 0 ? `${(resumen.itemsPagados / resumen.itemsTotal) * 100}%` : '0%' }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Estado vacío */}
      {!tieneItems && !isLoading && (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <div className="text-4xl mb-3">📋</div>
          <p className="text-gray-600 font-medium">No hay checklist para {labelMes(periodo)}</p>
          <p className="text-sm text-gray-400 mt-1">
            Hacé click en "Generar mes" para crear la checklist desde {labelMes(periodoAnterior(periodo))} o desde la plantilla
          </p>
        </div>
      )}

      {/* Tabla agrupada por categoría */}
      {tieneItems && [...porCategoria.entries()].map(([cat, filas]) => {
        if (!filas.length) return null
        const abierta = seccionesAbiertas.has(cat)
        const subtotal = filas.reduce((s, { item }) => s + (item?.monto ?? 0), 0)
        const pagados = filas.filter(({ item }) => item?.pagado).length

        return (
          <div key={cat} className="bg-white rounded-lg border border-surface-border overflow-hidden">
            {/* Header categoría */}
            <button
              onClick={() => toggleSeccion(cat)}
              className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm">{abierta ? '▼' : '▶'}</span>
                <span className="text-sm">{CAT_ICONS[cat] ?? '📄'}</span>
                <span className="font-semibold text-gray-800 text-sm">{cat}</span>
                <span className="text-xs text-gray-400">({pagados}/{filas.length})</span>
              </div>
              <span className="text-sm font-semibold text-gray-700">{formatARS(subtotal)}</span>
            </button>

            {/* Filas */}
            {abierta && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
                    <th className="text-left px-4 py-2 font-medium w-[30%]">Concepto</th>
                    <th className="text-right px-4 py-2 font-medium w-[20%]">Monto</th>
                    <th className="text-center px-4 py-2 font-medium w-[18%]">Vencimiento</th>
                    <th className="text-center px-4 py-2 font-medium w-[8%]">Pagado</th>
                    <th className="text-left px-4 py-2 font-medium w-[24%]">Notas</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map(({ concepto, item }) => (
                    <FilaConcepto
                      key={concepto.id}
                      concepto={concepto}
                      item={item}
                      onGuardar={(campo, valor) => guardarCampo(concepto.id, campo, valor)}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )
      })}

      {/* Modal Config Conceptos */}
      {showConfig && (
        <ConfigConceptos
          conceptos={conceptos ?? []}
          onClose={() => setShowConfig(false)}
          onRefresh={() => qc.invalidateQueries({ queryKey: ['conceptos_gasto_fijo'] })}
        />
      )}
    </div>
  )
}

// ── fila editable ────────────────────────────────────────────────────────────
function FilaConcepto({
  concepto,
  item,
  onGuardar,
}: {
  concepto: Concepto
  item: ChecklistItem | null
  onGuardar: (campo: string, valor: unknown) => void
}) {
  const [montoLocal, setMontoLocal] = useState(item?.monto != null ? String(item.monto) : '')
  const [notasLocal, setNotasLocal] = useState(item?.notas ?? '')

  // Sync con datos del server cuando cambian
  const montoServer = item?.monto != null ? String(item.monto) : ''
  const notasServer = item?.notas ?? ''
  if (montoLocal !== montoServer && document.activeElement?.getAttribute('data-field') !== `monto-${concepto.id}`) {
    // Solo sync si el input no está enfocado
  }

  return (
    <tr className={cn('border-b border-gray-50 hover:bg-gray-50/50', item?.pagado && 'bg-green-50/30')}>
      <td className="px-4 py-2">
        <span className={cn('text-gray-700', item?.pagado && 'line-through text-gray-400')}>
          {concepto.nombre}
        </span>
      </td>
      <td className="px-4 py-2">
        <input
          data-field={`monto-${concepto.id}`}
          type="text"
          inputMode="numeric"
          className="w-full text-right text-sm border border-gray-200 rounded px-2 py-1 focus:border-rodziny-500 focus:outline-none"
          value={montoLocal}
          onChange={(e) => setMontoLocal(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={() => {
            const num = parseFloat(montoLocal.replace(/\./g, '').replace(',', '.')) || 0
            if (String(num) !== montoServer) onGuardar('monto', num)
          }}
          placeholder="0"
        />
      </td>
      <td className="px-4 py-2 text-center">
        <input
          type="date"
          className="text-sm border border-gray-200 rounded px-2 py-1 focus:border-rodziny-500 focus:outline-none"
          value={item?.fecha_vencimiento ?? ''}
          onChange={(e) => onGuardar('fecha_vencimiento', e.target.value || null)}
        />
      </td>
      <td className="px-4 py-2 text-center">
        <input
          type="checkbox"
          checked={item?.pagado ?? false}
          onChange={(e) => onGuardar('pagado', e.target.checked)}
          className="w-4 h-4 rounded border-gray-300 text-green-600 focus:ring-green-500 cursor-pointer"
        />
      </td>
      <td className="px-4 py-2">
        <input
          type="text"
          className="w-full text-sm border border-gray-200 rounded px-2 py-1 focus:border-rodziny-500 focus:outline-none"
          value={notasLocal}
          onChange={(e) => setNotasLocal(e.target.value)}
          onBlur={() => {
            if (notasLocal !== notasServer) onGuardar('notas', notasLocal || null)
          }}
          placeholder="—"
        />
      </td>
    </tr>
  )
}

// ── config conceptos (modal) ─────────────────────────────────────────────────
function ConfigConceptos({
  conceptos,
  onClose,
  onRefresh,
}: {
  conceptos: Concepto[]
  onClose: () => void
  onRefresh: () => void
}) {
  const [nombre, setNombre] = useState('')
  const [categoria, setCategoria] = useState(CATEGORIAS_ORDEN[0])
  const [montoDefault, setMontoDefault] = useState('')
  const [diaVto, setDiaVto] = useState('')
  const [saving, setSaving] = useState(false)

  async function agregarConcepto() {
    if (!nombre.trim()) return
    setSaving(true)
    const maxOrden = conceptos.filter((c) => c.categoria === categoria).reduce((m, c) => Math.max(m, c.orden), 0)
    await supabase.from('conceptos_gasto_fijo').insert({
      nombre: nombre.trim(),
      categoria,
      monto_default: montoDefault ? parseFloat(montoDefault.replace(/\./g, '').replace(',', '.')) : null,
      dia_vencimiento: diaVto ? parseInt(diaVto) : null,
      orden: maxOrden + 1,
    })
    setNombre('')
    setMontoDefault('')
    setDiaVto('')
    setSaving(false)
    onRefresh()
  }

  async function toggleActivo(id: string, activo: boolean) {
    await supabase.from('conceptos_gasto_fijo').update({ activo: !activo }).eq('id', id)
    onRefresh()
  }

  // Agrupar por categoría
  const porCat = new Map<string, Concepto[]>()
  for (const cat of CATEGORIAS_ORDEN) porCat.set(cat, [])
  for (const c of conceptos) {
    const arr = porCat.get(c.categoria) ?? []
    arr.push(c)
    if (!porCat.has(c.categoria)) porCat.set(c.categoria, arr)
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="font-semibold text-gray-800">Configurar Conceptos</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          {[...porCat.entries()].map(([cat, items]) => (
            <div key={cat}>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                {CAT_ICONS[cat]} {cat}
              </p>
              <div className="space-y-1">
                {items.map((c) => (
                  <div
                    key={c.id}
                    className={cn(
                      'flex items-center justify-between px-3 py-2 rounded text-sm',
                      c.activo ? 'bg-gray-50' : 'bg-red-50/50 text-gray-400'
                    )}
                  >
                    <span className={cn(!c.activo && 'line-through')}>{c.nombre}</span>
                    <div className="flex items-center gap-3 text-xs text-gray-400">
                      {c.monto_default != null && <span>{formatARS(c.monto_default)}</span>}
                      {c.dia_vencimiento != null && <span>Día {c.dia_vencimiento}</span>}
                      <button
                        onClick={() => toggleActivo(c.id, c.activo)}
                        className={cn(
                          'px-2 py-0.5 rounded text-xs font-medium',
                          c.activo
                            ? 'bg-green-100 text-green-700 hover:bg-green-200'
                            : 'bg-red-100 text-red-600 hover:bg-red-200'
                        )}
                      >
                        {c.activo ? 'Activo' : 'Inactivo'}
                      </button>
                    </div>
                  </div>
                ))}
                {items.length === 0 && (
                  <p className="text-xs text-gray-400 italic px-3">Sin conceptos</p>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Agregar nuevo */}
        <div className="border-t px-6 py-4">
          <p className="text-xs font-semibold text-gray-500 mb-2">Agregar nuevo concepto</p>
          <div className="flex gap-2 flex-wrap">
            <input
              type="text"
              placeholder="Nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              className="flex-1 min-w-[150px] text-sm border border-gray-200 rounded px-3 py-2 focus:border-rodziny-500 focus:outline-none"
            />
            <select
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              className="text-sm border border-gray-200 rounded px-3 py-2 focus:border-rodziny-500 focus:outline-none"
            >
              {CATEGORIAS_ORDEN.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Monto default"
              value={montoDefault}
              onChange={(e) => setMontoDefault(e.target.value)}
              className="w-[120px] text-sm border border-gray-200 rounded px-3 py-2 focus:border-rodziny-500 focus:outline-none"
            />
            <input
              type="number"
              placeholder="Día vto"
              min={1}
              max={31}
              value={diaVto}
              onChange={(e) => setDiaVto(e.target.value)}
              className="w-[80px] text-sm border border-gray-200 rounded px-3 py-2 focus:border-rodziny-500 focus:outline-none"
            />
            <button
              onClick={agregarConcepto}
              disabled={saving || !nombre.trim()}
              className="px-4 py-2 bg-rodziny-800 hover:bg-rodziny-700 text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50"
            >
              Agregar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
