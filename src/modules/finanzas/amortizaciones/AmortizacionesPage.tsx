import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { PageContainer } from '@/components/layout/PageContainer'
import { formatARS, cn } from '@/lib/utils'
import { LocalSelector } from '@/components/ui/LocalSelector'

const MESES_LABEL = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

interface Gasto {
  id: string; fudo_id: string; fecha: string; proveedor: string
  subcategoria: string; comentario: string; importe_total: number
}

interface Amortizacion {
  id: string; gasto_id: string; descripcion: string; fecha_inicio: string
  importe_total: number; vida_util_meses: number; cuota_mensual: number; activo: boolean
  gastos?: { proveedor: string; subcategoria: string; fudo_id: string }
}

// Vida útil sugerida por subcategoría
const VIDA_UTIL_DEFAULT: Record<string, number> = {
  'Maquinaria': 60,
  'Mejoras del local': 36,
  'Utensilios varios': 24,
}

export function AmortizacionesPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [año, setAño]           = useState(() => String(new Date().getFullYear()))
  const [local, setLocal]       = useState<'vedia' | 'saavedra'>('vedia')
  const [editando, setEditando] = useState<string | null>(null) // gasto_id
  const [vidaUtil, setVidaUtil] = useState('')
  const [desc, setDesc]         = useState('')
  const qc = useQueryClient()

  // ── Inversiones sin amortizar ──────────────────────────────────────────────
  const { data: inversiones } = useQuery({
    queryKey: ['inversiones_sin_amort', local],
    queryFn: async () => {
      // Traer gastos de inversiones
      const { data: gastos } = await supabase
        .from('gastos')
        .select('id, fudo_id, fecha, proveedor, subcategoria, comentario, importe_total')
        .eq('local', local)
        .eq('categoria', 'Inversiones')
        .eq('cancelado', false)
        .order('fecha', { ascending: false })

      // Traer ids ya amortizados
      const { data: amorts } = await supabase
        .from('amortizaciones')
        .select('gasto_id')
        .eq('local', local)

      const amortIds = new Set((amorts ?? []).map((a) => a.gasto_id))
      return (gastos ?? []).filter((g) => !amortIds.has(g.id)) as Gasto[]
    },
  })

  // ── Amortizaciones activas ─────────────────────────────────────────────────
  const { data: amortizaciones } = useQuery({
    queryKey: ['amortizaciones_activas', local, año],
    queryFn: async () => {
      const { data } = await supabase
        .from('amortizaciones')
        .select('*, gastos(proveedor, subcategoria, fudo_id)')
        .eq('local', local)
        .eq('activo', true)
        .order('fecha_inicio', { ascending: false })
      return (data ?? []) as Amortizacion[]
    },
  })

  // ── Crear amortización ─────────────────────────────────────────────────────
  const crearMut = useMutation({
    mutationFn: async ({ gasto, vidaUtilMeses, descripcion }: { gasto: Gasto; vidaUtilMeses: number; descripcion: string }) => {
      const { error } = await supabase.from('amortizaciones').insert({
        gasto_id: gasto.id,
        local,
        descripcion,
        fecha_inicio: gasto.fecha,
        importe_total: gasto.importe_total,
        vida_util_meses: vidaUtilMeses,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inversiones_sin_amort'] })
      qc.invalidateQueries({ queryKey: ['amortizaciones_activas'] })
      qc.invalidateQueries({ queryKey: ['edr_amortizaciones'] })
      setEditando(null)
    },
  })

  // ── Desactivar amortización ────────────────────────────────────────────────
  const desactivarMut = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from('amortizaciones').update({ activo: false }).eq('id', id)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['amortizaciones_activas'] })
      qc.invalidateQueries({ queryKey: ['inversiones_sin_amort'] })
      qc.invalidateQueries({ queryKey: ['edr_amortizaciones'] })
    },
  })

  // ── Meses del año para la grilla ───────────────────────────────────────────
  const meses = useMemo(
    () => Array.from({ length: 12 }, (_, i) => `${año}-${String(i + 1).padStart(2, '0')}`),
    [año]
  )

  // Verificar si un mes está activo para una amortización
  function mesActivo(a: Amortizacion, mes: string): boolean {
    const inicio = a.fecha_inicio.substring(0, 7)
    const finDate = new Date(a.fecha_inicio)
    finDate.setMonth(finDate.getMonth() + a.vida_util_meses)
    const fin = `${finDate.getFullYear()}-${String(finDate.getMonth() + 1).padStart(2, '0')}`
    return mes >= inicio && mes < fin
  }

  // Totales por mes
  const totalesMes = useMemo(() => {
    const totales = new Map<string, number>()
    for (const mes of meses) {
      let total = 0
      for (const a of amortizaciones ?? []) {
        if (mesActivo(a, mes)) total += a.cuota_mensual
      }
      totales.set(mes, total)
    }
    return totales
  }, [meses, amortizaciones])

  const inner = (
    <>
      {/* Filtros */}
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        <LocalSelector value={local} onChange={(v) => setLocal(v as 'vedia' | 'saavedra')} />
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-500">Año</label>
          <input
            type="number" min="2020" max="2099"
            value={año} onChange={(e) => setAño(e.target.value)}
            className="w-24 border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-rodziny-500"
          />
        </div>
      </div>

      {/* ── Inversiones pendientes ──────────────────────────────────────────── */}
      <div className="bg-white rounded-lg border border-surface-border mb-6">
        <div className="px-5 py-3 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900 text-sm">Inversiones pendientes de amortizar</h3>
          <p className="text-xs text-gray-400 mt-0.5">Gastos con categoría "Inversiones" que aún no tienen vida útil asignada</p>
        </div>

        {(!inversiones || inversiones.length === 0) ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400">
            No hay inversiones pendientes de amortizar
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Fecha</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Proveedor</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Subcategoría</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Comentario</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Importe</th>
                  <th className="px-4 py-2 text-center text-xs font-medium text-gray-500">Acción</th>
                </tr>
              </thead>
              <tbody>
                {inversiones.map((g) => (
                  <tr key={g.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-600">{g.fecha}</td>
                    <td className="px-4 py-2 text-gray-800 font-medium">{g.proveedor || '—'}</td>
                    <td className="px-4 py-2 text-gray-600">{g.subcategoria || '—'}</td>
                    <td className="px-4 py-2 text-gray-500 text-xs max-w-[200px] truncate">{g.comentario || '—'}</td>
                    <td className="px-4 py-2 text-right font-medium text-gray-900">{formatARS(g.importe_total)}</td>
                    <td className="px-4 py-2 text-center">
                      {editando === g.id ? (
                        <div className="flex flex-col gap-1.5 items-end min-w-[200px]">
                          <input
                            value={desc}
                            onChange={(e) => setDesc(e.target.value)}
                            placeholder="Descripción"
                            className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-rodziny-500"
                          />
                          <div className="flex gap-1.5 items-center w-full">
                            <input
                              type="number" min="1" max="120"
                              value={vidaUtil}
                              onChange={(e) => setVidaUtil(e.target.value)}
                              placeholder="Meses"
                              className="w-20 border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-rodziny-500"
                            />
                            <span className="text-xs text-gray-400">meses</span>
                            <button
                              onClick={() => {
                                const meses = parseInt(vidaUtil)
                                if (!meses || meses < 1) return
                                crearMut.mutate({ gasto: g, vidaUtilMeses: meses, descripcion: desc || `${g.proveedor} - ${g.subcategoria}` })
                              }}
                              disabled={crearMut.isPending}
                              className="ml-auto px-3 py-1 bg-rodziny-800 text-white text-xs rounded hover:bg-rodziny-700 transition-colors disabled:opacity-50"
                            >
                              Guardar
                            </button>
                            <button
                              onClick={() => setEditando(null)}
                              className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700"
                            >
                              Cancelar
                            </button>
                          </div>
                          {vidaUtil && parseInt(vidaUtil) > 0 && (
                            <p className="text-xs text-gray-400">
                              Cuota mensual: <span className="font-medium text-gray-600">{formatARS(g.importe_total / parseInt(vidaUtil))}</span>
                            </p>
                          )}
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setEditando(g.id)
                            setDesc(`${g.proveedor || ''} - ${g.subcategoria || ''}`.replace(/^ - | - $/g, ''))
                            setVidaUtil(String(VIDA_UTIL_DEFAULT[g.subcategoria] ?? 12))
                          }}
                          className="px-3 py-1 bg-blue-50 text-blue-700 text-xs font-medium rounded hover:bg-blue-100 transition-colors"
                        >
                          Amortizar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Amortizaciones activas ──────────────────────────────────────────── */}
      <div className="bg-white rounded-lg border border-surface-border">
        <div className="px-5 py-3 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900 text-sm">Amortizaciones activas</h3>
          <p className="text-xs text-gray-400 mt-0.5">Cuotas mensuales de depreciación — se reflejan automáticamente en el EdR</p>
        </div>

        {(!amortizaciones || amortizaciones.length === 0) ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400">
            No hay amortizaciones configuradas
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="sticky left-0 bg-gray-50 px-4 py-2 text-left text-xs font-medium text-gray-500 min-w-[200px] z-10">Inversión</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 min-w-[100px]">Total</th>
                  <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 min-w-[60px]">Meses</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 min-w-[90px]">Cuota</th>
                  {meses.map((mes) => (
                    <th key={mes} className="px-2 py-2 text-center text-xs font-medium text-gray-400 min-w-[70px]">
                      {MESES_LABEL[parseInt(mes.substring(5, 7)) - 1]}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-center text-xs font-medium text-gray-400 min-w-[50px]"></th>
                </tr>
              </thead>
              <tbody>
                {amortizaciones.map((a) => {
                  const subcat = a.gastos?.subcategoria ?? ''
                  return (
                    <tr key={a.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="sticky left-0 bg-white px-4 py-2 z-10">
                        <div className="font-medium text-gray-800 text-xs">{a.descripcion}</div>
                        <div className="text-xs text-gray-400">{subcat} · desde {a.fecha_inicio.substring(0, 7)}</div>
                      </td>
                      <td className="px-3 py-2 text-right text-xs text-gray-700">{formatARS(a.importe_total)}</td>
                      <td className="px-3 py-2 text-center text-xs text-gray-600">{a.vida_util_meses}</td>
                      <td className="px-3 py-2 text-right text-xs font-medium text-gray-800">{formatARS(a.cuota_mensual)}</td>
                      {meses.map((mes) => {
                        const activo = mesActivo(a, mes)
                        return (
                          <td key={mes} className="px-2 py-2 text-center">
                            {activo ? (
                              <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700">
                                {formatARS(a.cuota_mensual)}
                              </span>
                            ) : (
                              <span className="text-xs text-gray-200">—</span>
                            )}
                          </td>
                        )
                      })}
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={() => { if (confirm('¿Desactivar esta amortización?')) desactivarMut.mutate(a.id) }}
                          className="text-xs text-red-400 hover:text-red-600 transition-colors"
                          title="Desactivar"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  )
                })}

                {/* Fila total */}
                <tr className="bg-gray-50 border-t border-gray-200 font-semibold">
                  <td className="sticky left-0 bg-gray-50 px-4 py-2 text-xs text-gray-700 z-10">TOTAL AMORTIZACIÓN</td>
                  <td className="px-3 py-2 text-right text-xs text-gray-700">
                    {formatARS(amortizaciones.reduce((s, a) => s + a.importe_total, 0))}
                  </td>
                  <td />
                  <td />
                  {meses.map((mes) => (
                    <td key={mes} className="px-2 py-2 text-center">
                      <span className={cn(
                        'text-xs font-medium',
                        (totalesMes.get(mes) ?? 0) > 0 ? 'text-rodziny-800' : 'text-gray-300'
                      )}>
                        {(totalesMes.get(mes) ?? 0) > 0 ? formatARS(totalesMes.get(mes)!) : '—'}
                      </span>
                    </td>
                  ))}
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="mt-3 text-xs text-gray-400">
        Las amortizaciones se reflejan automáticamente en la línea "Amortizaciones" del Estado de Resultados.
      </p>
    </>
  )

  if (embedded) return inner
  return (
    <PageContainer title="Amortizaciones" subtitle="Inversiones y depreciación mensual">
      {inner}
    </PageContainer>
  )
}
