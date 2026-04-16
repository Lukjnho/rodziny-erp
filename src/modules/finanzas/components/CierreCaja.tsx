import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatARS } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { LocalSelector } from '@/components/ui/LocalSelector'

// ── config por local ─────────────────────────────────────────────────────────
const CAJAS: Record<string, string[]> = {
  vedia:    ['Principal Pastas 1', 'Barra Bebidas'],
  saavedra: ['Caja Principal'],
}

const TURNOS: Record<string, { key: string; label: string }[]> = {
  vedia: [
    { key: 'almuerzo', label: 'Almuerzo' },
    { key: 'cena',     label: 'Cena' },
  ],
  saavedra: [
    { key: 'desayuno',  label: 'Desayuno' },
    { key: 'almuerzo',  label: 'Almuerzo' },
    { key: 'merienda',  label: 'Merienda' },
    { key: 'cena',      label: 'Cena' },
  ],
}

interface CierreRow {
  id: string; local: string; fecha: string; turno: string; caja: string | null
  monto_esperado: number | null; monto_contado: number; diferencia: number | null
  nota: string | null; creado_por: string | null
  verificado: boolean; verificado_por: string | null; verificado_at: string | null
}

// ── componente ───────────────────────────────────────────────────────────────
export function CierreCaja() {
  const [local, setLocal]     = useState<'vedia' | 'saavedra'>('vedia')
  const [periodo, setPeriodo] = useState(() => new Date().toISOString().substring(0, 7))
  const [formOpen, setFormOpen] = useState(false)
  const qc = useQueryClient()

  // Form state
  const hoy = new Date().toISOString().split('T')[0]
  const [fFecha, setFFecha]     = useState(hoy)
  const [fTurno, setFTurno]     = useState('')
  const [fCaja, setFCaja]       = useState('')
  const [fEsperado, setFEsperado] = useState('')
  const [fContado, setFContado] = useState('')
  const [fNota, setFNota]       = useState('')

  // ── query: cierres del mes ─────────────────────────────────────────────────
  const { data: cierres, isLoading } = useQuery({
    queryKey: ['cierres_mes', local, periodo],
    queryFn: async () => {
      const [y, m] = periodo.split('-').map(Number)
      const lastDay = new Date(y, m, 0).getDate()
      const { data } = await supabase
        .from('cierres_caja')
        .select('*')
        .eq('local', local)
        .gte('fecha', `${periodo}-01`)
        .lte('fecha', `${periodo}-${lastDay}`)
        .order('fecha', { ascending: false })
        .order('caja')
        .order('turno')
      return (data ?? []) as CierreRow[]
    },
  })

  // ── mutation: guardar cierre ───────────────────────────────────────────────
  const guardarMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('cierres_caja').upsert({
        local,
        fecha: fFecha,
        turno: fTurno,
        caja: fCaja || null,
        monto_esperado: fEsperado ? parseFloat(fEsperado.replace(/\./g, '').replace(',', '.')) : null,
        monto_contado: parseFloat(fContado.replace(/\./g, '').replace(',', '.')) || 0,
        nota: fNota || null,
        creado_por: 'Lucas',
      }, { onConflict: 'local,fecha,turno,caja' })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cierres_mes'] })
      setFormOpen(false)
      resetForm()
    },
  })

  // ── mutation: eliminar cierre ──────────────────────────────────────────────
  const eliminarMut = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from('cierres_caja').delete().eq('id', id)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cierres_mes'] }),
  })

  // ── mutation: verificar cierre ─────────────────────────────────────────────
  const verificarMut = useMutation({
    mutationFn: async ({ id, verificado }: { id: string; verificado: boolean }) => {
      const { error } = await supabase.from('cierres_caja').update({
        verificado,
        verificado_por: verificado ? 'Admin' : null,
        verificado_at: verificado ? new Date().toISOString() : null,
      }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cierres_mes'] }),
  })

  function resetForm() {
    setFFecha(hoy)
    setFTurno(TURNOS[local]?.[0]?.key ?? '')
    setFCaja(CAJAS[local]?.[0] ?? '')
    setFEsperado('')
    setFContado('')
    setFNota('')
  }

  function abrirForm() {
    resetForm()
    setFormOpen(true)
  }

  // ── resumen del mes ────────────────────────────────────────────────────────
  const resumen = useMemo(() => {
    if (!cierres) return { total: 0, positivos: 0, negativos: 0, cantidad: 0, verificados: 0, pendientes: 0 }
    let total = 0, positivos = 0, negativos = 0, verificados = 0
    for (const c of cierres) {
      const dif = c.diferencia ?? 0
      total += dif
      if (dif > 0) positivos += dif
      if (dif < 0) negativos += dif
      if (c.verificado) verificados++
    }
    return { total, positivos, negativos, cantidad: cierres.length, verificados, pendientes: cierres.length - verificados }
  }, [cierres])

  // Agrupar por fecha
  const porFecha = useMemo(() => {
    const map = new Map<string, CierreRow[]>()
    for (const c of cierres ?? []) {
      if (!map.has(c.fecha)) map.set(c.fecha, [])
      map.get(c.fecha)!.push(c)
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [cierres])

  const turnoLabel = (t: string) => {
    const found = TURNOS[local]?.find((x) => x.key === t)
    return found ? found.label : t
  }

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex items-center gap-4 flex-wrap">
        <LocalSelector value={local} onChange={(v) => setLocal(v as 'vedia' | 'saavedra')} />
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-500">Período</label>
          <input
            type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-rodziny-500"
          />
        </div>
        <button
          onClick={abrirForm}
          className="ml-auto px-4 py-1.5 bg-rodziny-800 text-white text-sm font-medium rounded-md hover:bg-rodziny-700 transition-colors"
        >
          + Nuevo cierre
        </button>
      </div>

      {/* KPIs resumen */}
      <div className="grid grid-cols-5 gap-3">
        <div className="bg-white rounded-lg border border-surface-border p-4">
          <p className="text-xs text-gray-500 mb-1">Cierres del mes</p>
          <p className="text-lg font-semibold text-gray-900">{resumen.cantidad}</p>
        </div>
        <div className="bg-white rounded-lg border border-surface-border p-4">
          <p className="text-xs text-gray-500 mb-1">Diferencia neta</p>
          <p className={cn('text-lg font-semibold', resumen.total === 0 ? 'text-green-600' : resumen.total > 0 ? 'text-blue-600' : 'text-red-600')}>
            {formatARS(resumen.total)}
          </p>
        </div>
        <div className="bg-white rounded-lg border border-surface-border p-4">
          <p className="text-xs text-gray-500 mb-1">Sobrantes</p>
          <p className="text-lg font-semibold text-blue-600">{formatARS(resumen.positivos)}</p>
        </div>
        <div className="bg-white rounded-lg border border-surface-border p-4">
          <p className="text-xs text-gray-500 mb-1">Faltantes</p>
          <p className="text-lg font-semibold text-red-600">{formatARS(resumen.negativos)}</p>
        </div>
        <div className="bg-white rounded-lg border border-surface-border p-4">
          <p className="text-xs text-gray-500 mb-1">Verificación</p>
          <p className={cn('text-lg font-semibold', resumen.pendientes === 0 ? 'text-green-600' : 'text-amber-600')}>
            {resumen.verificados}/{resumen.cantidad}
          </p>
          {resumen.pendientes > 0 && <p className="text-[10px] text-amber-500 mt-0.5">{resumen.pendientes} pendiente{resumen.pendientes > 1 ? 's' : ''}</p>}
        </div>
      </div>

      {/* Form nuevo cierre (expandible) */}
      {formOpen && (
        <div className="bg-white rounded-lg border-2 border-rodziny-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900 text-sm">Nuevo cierre de caja</h3>
            <button onClick={() => setFormOpen(false)} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Fecha</label>
              <input type="date" value={fFecha} onChange={(e) => setFFecha(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-rodziny-500" />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Caja</label>
              <select value={fCaja} onChange={(e) => setFCaja(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-rodziny-500">
                {CAJAS[local]?.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Turno</label>
              <select value={fTurno} onChange={(e) => setFTurno(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-rodziny-500">
                {TURNOS[local]?.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Esperado (Fudo)</label>
              <input type="text" value={fEsperado} onChange={(e) => setFEsperado(e.target.value)}
                placeholder="0" className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-rodziny-500" />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Contado real <span className="text-red-500">*</span></label>
              <input type="text" value={fContado} onChange={(e) => setFContado(e.target.value)}
                placeholder="0" className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-rodziny-500" />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Diferencia</label>
              {(() => {
                const esp = parseFloat((fEsperado || '0').replace(/\./g, '').replace(',', '.')) || 0
                const cont = parseFloat((fContado || '0').replace(/\./g, '').replace(',', '.')) || 0
                const dif = esp > 0 ? cont - esp : 0
                return (
                  <div className={cn(
                    'w-full rounded-md px-3 py-2 text-sm font-medium',
                    dif === 0 ? 'bg-gray-50 text-gray-500' : dif > 0 ? 'bg-blue-50 text-blue-700' : 'bg-red-50 text-red-700'
                  )}>
                    {esp > 0 ? `${formatARS(dif)} ${dif === 0 ? '— Cuadra' : dif > 0 ? '↑ Sobrante' : '↓ Faltante'}` : '—'}
                  </div>
                )
              })()}
            </div>

            <div className="col-span-2 md:col-span-3">
              <label className="block text-xs font-medium text-gray-600 mb-1">Nota (opcional)</label>
              <input type="text" value={fNota} onChange={(e) => setFNota(e.target.value)}
                placeholder="Ej: Error en vuelto ticket #163045"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-rodziny-500" />
            </div>
          </div>

          <div className="flex justify-end mt-4 gap-2">
            <button onClick={() => setFormOpen(false)}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors">
              Cancelar
            </button>
            <button
              onClick={() => guardarMut.mutate()}
              disabled={guardarMut.isPending || !fContado}
              className="px-4 py-2 bg-rodziny-800 text-white text-sm font-medium rounded-md hover:bg-rodziny-700 transition-colors disabled:opacity-50"
            >
              {guardarMut.isPending ? 'Guardando...' : 'Guardar cierre'}
            </button>
          </div>

          {guardarMut.isError && (
            <p className="mt-2 text-xs text-red-600">Error al guardar: {(guardarMut.error as Error).message}</p>
          )}
        </div>
      )}

      {/* Tabla de cierres */}
      <div className="bg-white rounded-lg border border-surface-border overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-gray-400 animate-pulse">Cargando cierres...</div>
        ) : porFecha.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">No hay cierres cargados en este período</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">Fecha</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">Caja</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">Turno</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-600">Esperado</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-600">Contado</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-600">Diferencia</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">Nota</th>
                  <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-600">Verificado</th>
                  <th className="px-2 py-2.5 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {porFecha.map(([fecha, rows]) => {
                  const difDia = rows.reduce((s, r) => s + (r.diferencia ?? 0), 0)
                  return rows.map((c, i) => (
                    <tr key={c.id} className={cn(
                      'border-b border-gray-50 hover:bg-gray-50',
                      i === 0 && 'border-t border-gray-100'
                    )}>
                      {/* Fecha: solo en la primera fila del grupo */}
                      {i === 0 ? (
                        <td className="px-4 py-2 font-medium text-gray-800 align-top" rowSpan={rows.length}>
                          <div>{new Date(fecha + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
                          <div className={cn(
                            'text-xs font-medium mt-0.5',
                            difDia === 0 ? 'text-green-600' : difDia > 0 ? 'text-blue-600' : 'text-red-600'
                          )}>
                            {difDia === 0 ? 'Cuadra' : formatARS(difDia)}
                          </div>
                        </td>
                      ) : null}
                      <td className="px-4 py-2 text-gray-700">{c.caja || '—'}</td>
                      <td className="px-4 py-2 text-gray-600">{turnoLabel(c.turno)}</td>
                      <td className="px-4 py-2 text-right text-gray-600">
                        {c.monto_esperado != null ? formatARS(c.monto_esperado) : '—'}
                      </td>
                      <td className="px-4 py-2 text-right font-medium text-gray-900">{formatARS(c.monto_contado)}</td>
                      <td className="px-4 py-2 text-right">
                        {c.diferencia != null ? (
                          <span className={cn(
                            'inline-block px-2 py-0.5 rounded text-xs font-medium',
                            c.diferencia === 0 ? 'bg-green-50 text-green-700' :
                            c.diferencia > 0 ? 'bg-blue-50 text-blue-700' : 'bg-red-50 text-red-700'
                          )}>
                            {c.diferencia === 0 ? '$0' : formatARS(c.diferencia)}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-2 text-gray-400 text-xs max-w-[200px] truncate">{c.nota || ''}</td>
                      <td className="px-4 py-2 text-center">
                        <button
                          onClick={() => verificarMut.mutate({ id: c.id, verificado: !c.verificado })}
                          disabled={verificarMut.isPending}
                          className={cn(
                            'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors',
                            c.verificado
                              ? 'bg-green-100 text-green-800 hover:bg-green-200'
                              : 'bg-gray-100 text-gray-500 hover:bg-amber-100 hover:text-amber-700'
                          )}
                          title={c.verificado ? `Verificado por ${c.verificado_por}` : 'Marcar como verificado'}
                        >
                          {c.verificado ? '✓ Verificado' : '○ Pendiente'}
                        </button>
                      </td>
                      <td className="px-2 py-2 text-center">
                        <button
                          onClick={() => { if (confirm('¿Eliminar este cierre?')) eliminarMut.mutate(c.id) }}
                          className="text-gray-300 hover:text-red-500 transition-colors text-xs"
                          title="Eliminar"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
