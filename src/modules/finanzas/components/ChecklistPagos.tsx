import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatARS, cn } from '@/lib/utils'
import { type MedioPago, MEDIO_PAGO_LABEL } from '@/modules/gastos/types'
import { urgenciaPago, type UrgenciaPago } from '@/modules/finanzas/hooks/usePagosAlertas'

// ── tipos ────────────────────────────────────────────────────────────────────
interface PagoFijo {
  id: string
  periodo: string
  concepto: string
  categoria: string
  categoria_gasto_id: string | null
  monto: number | null
  fecha_vencimiento: string | null
  pagado: boolean
  fecha_pago: string | null
  medio_pago: string | null
  gasto_id: string | null
  notas: string | null
}

interface CategoriaGasto {
  id: string
  nombre: string
  parent_id: string | null
  tipo_edr: string | null
  activo: boolean
}

// ── constantes ───────────────────────────────────────────────────────────────
const CATEGORIAS = [
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

const MEDIOS: MedioPago[] = ['efectivo', 'transferencia_mp', 'cheque_galicia', 'tarjeta_icbc', 'otro']

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

// Derivar local del concepto (heurística simple)
function derivarLocal(concepto: string): 'vedia' | 'saavedra' {
  const c = concepto.toLowerCase()
  if (c.includes('saavedra') || c.includes('saveedra') || c.includes('sin gluten')) return 'saavedra'
  return 'vedia'
}

// ── componente ───────────────────────────────────────────────────────────────
export function ChecklistPagos() {
  const qc = useQueryClient()
  const [periodo, setPeriodo] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [showModal, setShowModal] = useState(false)
  const [seccionesAbiertas, setSeccionesAbiertas] = useState<Set<string>>(new Set(CATEGORIAS))
  const [medioPagoModal, setMedioPagoModal] = useState<{ pagoId: string; concepto: string } | null>(null)

  // ── queries ──────────────────────────────────────────────────────────────
  const { data: pagos, isLoading } = useQuery({
    queryKey: ['pagos_fijos', periodo],
    queryFn: async () => {
      const { data } = await supabase
        .from('pagos_fijos')
        .select('*')
        .eq('periodo', periodo)
        .order('created_at')
      return (data ?? []) as PagoFijo[]
    },
  })

  const { data: categoriasGasto } = useQuery({
    queryKey: ['categorias_gasto_checklist'],
    queryFn: async () => {
      const { data } = await supabase
        .from('categorias_gasto')
        .select('id, nombre, parent_id, tipo_edr, activo')
        .eq('activo', true)
        .order('orden')
      return (data ?? []) as CategoriaGasto[]
    },
  })

  // Subcategorías (hijas) para el select de EdR
  const subcategorias = useMemo(
    () => (categoriasGasto ?? []).filter((c) => c.parent_id !== null),
    [categoriasGasto]
  )

  // Padres para agrupar en el select
  const padres = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of categoriasGasto ?? []) {
      if (c.parent_id === null) map.set(c.id, c.nombre)
    }
    return map
  }, [categoriasGasto])

  // ── mutaciones ───────────────────────────────────────────────────────────
  const insertPago = useMutation({
    mutationFn: async (pago: Partial<PagoFijo>) => {
      const { error } = await supabase.from('pagos_fijos').insert(pago)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pagos_fijos', periodo] }),
  })

  const updatePago = useMutation({
    mutationFn: async ({ id, ...fields }: Partial<PagoFijo> & { id: string }) => {
      const { error } = await supabase.from('pagos_fijos').update(fields).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pagos_fijos', periodo] }),
  })

  const deletePago = useMutation({
    mutationFn: async (pago: PagoFijo) => {
      // Si tiene gasto asociado, eliminar pago_gasto y gasto
      if (pago.gasto_id) {
        await supabase.from('pagos_gastos').delete().eq('gasto_id', pago.gasto_id)
        await supabase.from('gastos').delete().eq('id', pago.gasto_id)
      }
      const { error } = await supabase.from('pagos_fijos').delete().eq('id', pago.id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pagos_fijos', periodo] })
      qc.invalidateQueries({ queryKey: ['fc_pagos'] })
    },
  })

  const copiarMesAnterior = useMutation({
    mutationFn: async () => {
      const pAnterior = periodoAnterior(periodo)
      const { data: anterior } = await supabase
        .from('pagos_fijos')
        .select('*')
        .eq('periodo', pAnterior)
      if (!anterior?.length) throw new Error(`No hay datos en ${labelMes(pAnterior)}`)

      const [y, m] = periodo.split('-').map(Number)
      const ultimoDia = new Date(y, m, 0).getDate()

      const rows = anterior.map((a: PagoFijo) => {
        // Recalcular fecha vencimiento para el nuevo mes
        let fechaVto: string | null = null
        if (a.fecha_vencimiento) {
          const dia = Math.min(new Date(a.fecha_vencimiento + 'T12:00:00').getDate(), ultimoDia)
          fechaVto = `${periodo}-${String(dia).padStart(2, '0')}`
        }
        return {
          periodo,
          concepto: a.concepto,
          categoria: a.categoria,
          categoria_gasto_id: a.categoria_gasto_id,
          monto: a.monto,
          fecha_vencimiento: fechaVto,
          pagado: false,
          fecha_pago: null,
          medio_pago: null,
          gasto_id: null,
          notas: null,
        }
      })
      const { error } = await supabase.from('pagos_fijos').upsert(rows, { onConflict: 'periodo,concepto' })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pagos_fijos', periodo] }),
  })

  // Marcar como pagado: crea gasto + pago_gasto
  async function marcarPagado(pago: PagoFijo, medioPago: string) {
    const fechaPago = hoy()
    const local = derivarLocal(pago.concepto)

    // Buscar nombre de categoría padre para el campo 'categoria' de gastos
    const subcat = subcategorias.find((c) => c.id === pago.categoria_gasto_id)
    const catPadre = subcat?.parent_id ? padres.get(subcat.parent_id) ?? '' : ''

    // 1. Crear gasto
    const { data: gastoData, error: e1 } = await supabase.from('gastos').insert({
      local,
      fecha: fechaPago,
      fecha_vencimiento: pago.fecha_vencimiento,
      importe_total: pago.monto ?? 0,
      importe_neto: pago.monto ?? 0,
      iva: 0,
      iibb: 0,
      categoria_id: pago.categoria_gasto_id,
      categoria: catPadre,
      subcategoria: subcat?.nombre ?? pago.concepto,
      proveedor: pago.concepto,
      estado_pago: 'Pagado',
      medio_pago: medioPago,
      comentario: `Pago fijo: ${pago.concepto}`,
      creado_manual: true,
      cancelado: false,
      periodo,
    }).select('id').single()

    if (e1 || !gastoData) {
      console.error('Error creando gasto:', e1)
      return
    }

    // 2. Crear pago_gasto
    await supabase.from('pagos_gastos').insert({
      gasto_id: gastoData.id,
      fecha_pago: fechaPago,
      monto: pago.monto ?? 0,
      medio_pago: medioPago,
    })

    // 3. Actualizar pago_fijo
    await supabase.from('pagos_fijos').update({
      pagado: true,
      fecha_pago: fechaPago,
      medio_pago: medioPago,
      gasto_id: gastoData.id,
    }).eq('id', pago.id)

    qc.invalidateQueries({ queryKey: ['pagos_fijos', periodo] })
    qc.invalidateQueries({ queryKey: ['fc_pagos'] })
    qc.invalidateQueries({ queryKey: ['edr_gastos_resumen'] })
  }

  // Desmarcar pagado: elimina gasto + pago_gasto
  async function desmarcarPagado(pago: PagoFijo) {
    if (pago.gasto_id) {
      await supabase.from('pagos_gastos').delete().eq('gasto_id', pago.gasto_id)
      await supabase.from('gastos').delete().eq('id', pago.gasto_id)
    }
    await supabase.from('pagos_fijos').update({
      pagado: false,
      fecha_pago: null,
      medio_pago: null,
      gasto_id: null,
    }).eq('id', pago.id)

    qc.invalidateQueries({ queryKey: ['pagos_fijos', periodo] })
    qc.invalidateQueries({ queryKey: ['fc_pagos'] })
    qc.invalidateQueries({ queryKey: ['edr_gastos_resumen'] })
  }

  // ── datos derivados ──────────────────────────────────────────────────────
  const porCategoria = useMemo(() => {
    const grupos = new Map<string, PagoFijo[]>()
    for (const cat of CATEGORIAS) grupos.set(cat, [])
    for (const p of pagos ?? []) {
      const arr = grupos.get(p.categoria)
      if (arr) arr.push(p)
      else {
        // Categoría no estándar
        const existing = grupos.get(p.categoria) ?? []
        existing.push(p)
        grupos.set(p.categoria, existing)
      }
    }
    return grupos
  }, [pagos])

  const resumen = useMemo(() => {
    let totalEstimado = 0, totalPagado = 0, itemsPagados = 0, itemsTotal = 0
    for (const p of pagos ?? []) {
      itemsTotal++
      const m = p.monto ?? 0
      totalEstimado += m
      if (p.pagado) { totalPagado += m; itemsPagados++ }
    }
    return { totalEstimado, totalPagado, pendiente: totalEstimado - totalPagado, itemsPagados, itemsTotal }
  }, [pagos])

  // Alertas por urgencia (solo pagos no pagados del mes actual)
  const alertasUrgencia = useMemo(() => {
    const pendientes = (pagos ?? []).filter((p) => !p.pagado && p.fecha_vencimiento)
    const porUrgencia = { vencido: [] as PagoFijo[], hoy: [] as PagoFijo[], semana: [] as PagoFijo[] }
    for (const p of pendientes) {
      const u = urgenciaPago(p.fecha_vencimiento)
      if (u === 'vencido') porUrgencia.vencido.push(p)
      else if (u === 'hoy') porUrgencia.hoy.push(p)
      else if (u === 'semana') porUrgencia.semana.push(p)
    }
    return porUrgencia
  }, [pagos])

  const tieneAlertas = alertasUrgencia.vencido.length + alertasUrgencia.hoy.length + alertasUrgencia.semana.length > 0

  const tieneItems = (pagos?.length ?? 0) > 0

  function toggleSeccion(cat: string) {
    setSeccionesAbiertas((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  // ── render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setPeriodo(periodoAnterior(periodo))} className="px-2 py-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded">←</button>
          <h3 className="text-lg font-semibold text-gray-800 min-w-[160px] text-center">{labelMes(periodo)}</h3>
          <button onClick={() => setPeriodo(periodoSiguiente(periodo))} className="px-2 py-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded">→</button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => copiarMesAnterior.mutate()}
            disabled={copiarMesAnterior.isPending}
            className="px-3 py-2 text-sm border border-gray-200 rounded-md hover:bg-gray-50 text-gray-600 transition-colors disabled:opacity-50"
          >
            {copiarMesAnterior.isPending ? 'Copiando...' : `Copiar desde ${labelMes(periodoAnterior(periodo))}`}
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="px-4 py-2 bg-rodziny-800 hover:bg-rodziny-700 text-white text-sm font-medium rounded-md transition-colors"
          >
            + Agregar pago
          </button>
        </div>
      </div>

      {copiarMesAnterior.isError && (
        <div className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{(copiarMesAnterior.error as Error).message}</div>
      )}

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

      {/* Banner de alertas por urgencia */}
      {tieneAlertas && (
        <div className="space-y-2">
          {alertasUrgencia.vencido.length > 0 && (
            <div className="bg-red-50 border border-red-300 rounded-lg p-3 flex items-start gap-3">
              <div className="text-xl">🔴</div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-red-900">
                  {alertasUrgencia.vencido.length} pago{alertasUrgencia.vencido.length > 1 ? 's' : ''} vencido{alertasUrgencia.vencido.length > 1 ? 's' : ''}
                </p>
                <p className="text-xs text-red-700 mt-0.5">
                  {alertasUrgencia.vencido.map((p) => p.concepto).join(', ')}
                </p>
              </div>
              <div className="text-sm font-bold text-red-900">
                {formatARS(alertasUrgencia.vencido.reduce((s, p) => s + (p.monto ?? 0), 0))}
              </div>
            </div>
          )}
          {alertasUrgencia.hoy.length > 0 && (
            <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 flex items-start gap-3">
              <div className="text-xl">⚠️</div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-amber-900">
                  {alertasUrgencia.hoy.length} pago{alertasUrgencia.hoy.length > 1 ? 's' : ''} vence{alertasUrgencia.hoy.length > 1 ? 'n' : ''} HOY
                </p>
                <p className="text-xs text-amber-700 mt-0.5">
                  {alertasUrgencia.hoy.map((p) => p.concepto).join(', ')}
                </p>
              </div>
              <div className="text-sm font-bold text-amber-900">
                {formatARS(alertasUrgencia.hoy.reduce((s, p) => s + (p.monto ?? 0), 0))}
              </div>
            </div>
          )}
          {alertasUrgencia.semana.length > 0 && (
            <div className="bg-orange-50 border border-orange-300 rounded-lg p-3 flex items-start gap-3">
              <div className="text-xl">📅</div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-orange-900">
                  {alertasUrgencia.semana.length} pago{alertasUrgencia.semana.length > 1 ? 's' : ''} próximo{alertasUrgencia.semana.length > 1 ? 's' : ''} a vencer (7 días)
                </p>
                <p className="text-xs text-orange-700 mt-0.5">
                  {alertasUrgencia.semana.map((p) => p.concepto).join(', ')}
                </p>
              </div>
              <div className="text-sm font-bold text-orange-900">
                {formatARS(alertasUrgencia.semana.reduce((s, p) => s + (p.monto ?? 0), 0))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Estado vacío */}
      {!tieneItems && !isLoading && (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <div className="text-4xl mb-3">📋</div>
          <p className="text-gray-600 font-medium">No hay pagos fijos para {labelMes(periodo)}</p>
          <p className="text-sm text-gray-400 mt-1">
            Agregá pagos manualmente o copiá desde {labelMes(periodoAnterior(periodo))}
          </p>
        </div>
      )}

      {/* Tabla agrupada */}
      {tieneItems && [...porCategoria.entries()].map(([cat, filas]) => {
        if (!filas.length) return null
        const abierta = seccionesAbiertas.has(cat)
        const subtotal = filas.reduce((s, p) => s + (p.monto ?? 0), 0)
        const pagados = filas.filter((p) => p.pagado).length

        return (
          <div key={cat} className="bg-white rounded-lg border border-surface-border overflow-hidden">
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

            {abierta && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
                      <th className="text-left px-4 py-2 font-medium">Concepto</th>
                      <th className="text-left px-4 py-2 font-medium">Cat. EdR</th>
                      <th className="text-right px-4 py-2 font-medium">Monto</th>
                      <th className="text-center px-4 py-2 font-medium">Vto.</th>
                      <th className="text-center px-4 py-2 font-medium">Pagado</th>
                      <th className="text-left px-4 py-2 font-medium">Medio</th>
                      <th className="text-left px-4 py-2 font-medium">Notas</th>
                      <th className="px-2 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filas.map((pago) => (
                      <FilaPago
                        key={pago.id}
                        pago={pago}
                        subcategorias={subcategorias}
                        padres={padres}
                        onUpdate={(fields) => updatePago.mutate({ id: pago.id, ...fields })}
                        onTogglePagado={() => {
                          if (pago.pagado) {
                            desmarcarPagado(pago)
                          } else if (pago.medio_pago) {
                            marcarPagado(pago, pago.medio_pago)
                          } else {
                            setMedioPagoModal({ pagoId: pago.id, concepto: pago.concepto })
                          }
                        }}
                        onDelete={() => { if (confirm(`¿Eliminar "${pago.concepto}"?`)) deletePago.mutate(pago) }}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}

      {/* Modal agregar pago */}
      {showModal && (
        <ModalAgregarPago
          periodo={periodo}
          subcategorias={subcategorias}
          padres={padres}
          onSave={(pago) => {
            insertPago.mutate(pago)
            setShowModal(false)
          }}
          onClose={() => setShowModal(false)}
        />
      )}

      {/* Modal medio de pago (al marcar pagado sin medio) */}
      {medioPagoModal && (
        <ModalMedioPago
          concepto={medioPagoModal.concepto}
          onSelect={(medio) => {
            const pago = (pagos ?? []).find((p) => p.id === medioPagoModal.pagoId)
            if (pago) marcarPagado(pago, medio)
            setMedioPagoModal(null)
          }}
          onClose={() => setMedioPagoModal(null)}
        />
      )}
    </div>
  )
}

// ── fila editable ────────────────────────────────────────────────────────────
function FilaPago({
  pago, subcategorias, padres, onUpdate, onTogglePagado, onDelete,
}: {
  pago: PagoFijo
  subcategorias: CategoriaGasto[]
  padres: Map<string, string>
  onUpdate: (fields: Partial<PagoFijo>) => void
  onTogglePagado: () => void
  onDelete: () => void
}) {
  const [montoLocal, setMontoLocal] = useState(pago.monto != null ? String(pago.monto) : '')
  const [notasLocal, setNotasLocal] = useState(pago.notas ?? '')

  const subcatNombre = subcategorias.find((c) => c.id === pago.categoria_gasto_id)?.nombre ?? ''
  const urg: UrgenciaPago = pago.pagado ? 'ok' : urgenciaPago(pago.fecha_vencimiento)

  return (
    <tr className={cn(
      'border-b border-gray-50 hover:bg-gray-50/50',
      pago.pagado && 'bg-green-50/30',
      !pago.pagado && urg === 'vencido' && 'bg-red-50',
      !pago.pagado && urg === 'hoy' && 'bg-amber-50',
      !pago.pagado && urg === 'semana' && 'bg-orange-50/60',
    )}>
      <td className="px-4 py-2">
        <span className={cn('text-gray-700', pago.pagado && 'line-through text-gray-400')}>
          {pago.concepto}
        </span>
      </td>
      <td className="px-4 py-2">
        <select
          className="text-xs border border-gray-200 rounded px-1.5 py-1 focus:border-rodziny-500 focus:outline-none max-w-[140px]"
          value={pago.categoria_gasto_id ?? ''}
          onChange={(e) => onUpdate({ categoria_gasto_id: e.target.value || null })}
          disabled={pago.pagado}
        >
          <option value="">Sin asignar</option>
          {[...padres.entries()].map(([padreId, padreNombre]) => (
            <optgroup key={padreId} label={padreNombre}>
              {subcategorias.filter((s) => s.parent_id === padreId).map((s) => (
                <option key={s.id} value={s.id}>{s.nombre}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </td>
      <td className="px-4 py-2">
        <input
          type="text"
          inputMode="numeric"
          className="w-full text-right text-sm border border-gray-200 rounded px-2 py-1 focus:border-rodziny-500 focus:outline-none max-w-[120px]"
          value={montoLocal}
          onChange={(e) => setMontoLocal(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={() => {
            const num = parseFloat(montoLocal.replace(/\./g, '').replace(',', '.')) || 0
            if (num !== (pago.monto ?? 0)) onUpdate({ monto: num })
          }}
          disabled={pago.pagado}
          placeholder="0"
        />
      </td>
      <td className="px-4 py-2 text-center">
        <div className="flex items-center gap-1.5 justify-center">
          <input
            type="date"
            className="text-xs border border-gray-200 rounded px-1.5 py-1 focus:border-rodziny-500 focus:outline-none"
            value={pago.fecha_vencimiento ?? ''}
            onChange={(e) => onUpdate({ fecha_vencimiento: e.target.value || null })}
            disabled={pago.pagado}
          />
          {!pago.pagado && urg === 'vencido' && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-200 text-red-800">VENCIDO</span>
          )}
          {!pago.pagado && urg === 'hoy' && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-200 text-amber-800">HOY</span>
          )}
          {!pago.pagado && urg === 'semana' && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-200 text-orange-800">7 días</span>
          )}
        </div>
      </td>
      <td className="px-4 py-2 text-center">
        <input
          type="checkbox"
          checked={pago.pagado}
          onChange={onTogglePagado}
          className="w-4 h-4 rounded border-gray-300 text-green-600 focus:ring-green-500 cursor-pointer"
        />
      </td>
      <td className="px-4 py-2 text-xs text-gray-500">
        {pago.medio_pago ? MEDIO_PAGO_LABEL[pago.medio_pago as MedioPago] ?? pago.medio_pago : '—'}
      </td>
      <td className="px-4 py-2">
        <input
          type="text"
          className="w-full text-sm border border-gray-200 rounded px-2 py-1 focus:border-rodziny-500 focus:outline-none max-w-[140px]"
          value={notasLocal}
          onChange={(e) => setNotasLocal(e.target.value)}
          onBlur={() => { if (notasLocal !== (pago.notas ?? '')) onUpdate({ notas: notasLocal || null }) }}
          placeholder="—"
        />
      </td>
      <td className="px-2 py-2">
        <button
          onClick={onDelete}
          className="text-gray-300 hover:text-red-500 transition-colors text-sm"
          title="Eliminar"
        >
          🗑
        </button>
      </td>
    </tr>
  )
}

// ── modal agregar pago ───────────────────────────────────────────────────────
function ModalAgregarPago({
  periodo, subcategorias, padres, onSave, onClose,
}: {
  periodo: string
  subcategorias: CategoriaGasto[]
  padres: Map<string, string>
  onSave: (pago: Partial<PagoFijo>) => void
  onClose: () => void
}) {
  const [concepto, setConcepto] = useState('')
  const [categoria, setCategoria] = useState(CATEGORIAS[0])
  const [catGastoId, setCatGastoId] = useState('')
  const [monto, setMonto] = useState('')
  const [fechaVto, setFechaVto] = useState('')
  const [notas, setNotas] = useState('')

  function guardar() {
    if (!concepto.trim()) return
    onSave({
      periodo,
      concepto: concepto.trim(),
      categoria,
      categoria_gasto_id: catGastoId || null,
      monto: monto ? parseFloat(monto.replace(/\./g, '').replace(',', '.')) : null,
      fecha_vencimiento: fechaVto || null,
      notas: notas || null,
      pagado: false,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="font-semibold text-gray-800">Agregar pago fijo</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>

        <div className="px-6 py-4 space-y-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Concepto</label>
            <input
              type="text"
              value={concepto}
              onChange={(e) => setConcepto(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded px-3 py-2 focus:border-rodziny-500 focus:outline-none"
              placeholder="Ej: Alquiler Vedia"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Categoría</label>
              <select
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded px-3 py-2 focus:border-rodziny-500 focus:outline-none"
              >
                {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Categoría EdR</label>
              <select
                value={catGastoId}
                onChange={(e) => setCatGastoId(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded px-3 py-2 focus:border-rodziny-500 focus:outline-none"
              >
                <option value="">Opcional</option>
                {[...padres.entries()].map(([padreId, padreNombre]) => (
                  <optgroup key={padreId} label={padreNombre}>
                    {subcategorias.filter((s) => s.parent_id === padreId).map((s) => (
                      <option key={s.id} value={s.id}>{s.nombre}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Monto</label>
              <input
                type="text"
                inputMode="numeric"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded px-3 py-2 focus:border-rodziny-500 focus:outline-none"
                placeholder="$0"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Vencimiento</label>
              <input
                type="date"
                value={fechaVto}
                onChange={(e) => setFechaVto(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded px-3 py-2 focus:border-rodziny-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">Notas</label>
            <input
              type="text"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded px-3 py-2 focus:border-rodziny-500 focus:outline-none"
              placeholder="Opcional"
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:bg-gray-100 rounded-md">Cancelar</button>
          <button
            onClick={guardar}
            disabled={!concepto.trim()}
            className="px-4 py-2 bg-rodziny-800 hover:bg-rodziny-700 text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50"
          >
            Agregar
          </button>
        </div>
      </div>
    </div>
  )
}

// ── modal medio de pago ──────────────────────────────────────────────────────
function ModalMedioPago({
  concepto, onSelect, onClose,
}: {
  concepto: string
  onSelect: (medio: string) => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-sm w-full">
        <div className="px-6 py-4 border-b">
          <h3 className="font-semibold text-gray-800">Medio de pago</h3>
          <p className="text-xs text-gray-400 mt-1">¿Cómo se pagó "{concepto}"?</p>
        </div>
        <div className="px-6 py-4 space-y-2">
          {MEDIOS.map((m) => (
            <button
              key={m}
              onClick={() => onSelect(m)}
              className="w-full text-left px-4 py-2.5 text-sm border border-gray-200 rounded-lg hover:bg-rodziny-50 hover:border-rodziny-300 transition-colors"
            >
              {MEDIO_PAGO_LABEL[m]}
            </button>
          ))}
        </div>
        <div className="px-6 py-3 border-t">
          <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700">Cancelar</button>
        </div>
      </div>
    </div>
  )
}
