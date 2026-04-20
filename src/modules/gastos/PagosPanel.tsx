import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { LocalSelector } from '@/components/ui/LocalSelector'
import { formatARS, formatFecha, cn } from '@/lib/utils'
import type { Gasto, MedioPago, PagoGasto } from './types'
import { MEDIO_PAGO_LABEL } from './types'

const HOY = new Date()
function primerDiaDelMes(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0]
}
function ultimoDiaDelMes(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0]
}

type Vista = 'pendientes' | 'pagados' | 'todos'

export function PagosPanel() {
  const qc = useQueryClient()
  const [local, setLocal] = useState<'ambos' | 'vedia' | 'saavedra'>('vedia')
  const [vista, setVista] = useState<Vista>('pendientes')
  const [desde, setDesde] = useState(() => primerDiaDelMes(HOY))
  const [hasta, setHasta] = useState(() => ultimoDiaDelMes(HOY))
  const [busqueda, setBusqueda] = useState('')

  // Modal de pago
  const [gastoAPagar, setGastoAPagar] = useState<Gasto | null>(null)
  const [pagoFecha, setPagoFecha] = useState(() => new Date().toISOString().split('T')[0])
  const [pagoMedio, setPagoMedio] = useState<MedioPago>('efectivo')

  const { data: gastos, isLoading } = useQuery({
    queryKey: ['gastos_pagos', local, desde, hasta],
    queryFn: async () => {
      let q = supabase
        .from('gastos')
        .select('*')
        .gte('fecha', desde)
        .lte('fecha', hasta)
        .neq('cancelado', true)
        .order('fecha', { ascending: false })
        .limit(2000)
      if (local !== 'ambos') q = q.eq('local', local)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as Gasto[]
    },
  })

  // Historial de pagos realizados
  const { data: pagosHechos } = useQuery({
    queryKey: ['pagos_gastos_historial', local, desde, hasta],
    queryFn: async () => {
      const ids = (gastos ?? []).map((g) => g.id)
      if (!ids.length) return []
      const { data, error } = await supabase
        .from('pagos_gastos')
        .select('*')
        .in('gasto_id', ids)
        .order('fecha_pago', { ascending: false })
      if (error) throw error
      return (data ?? []) as PagoGasto[]
    },
    enabled: !!(gastos && gastos.length > 0),
  })

  const pagosMap = useMemo(() => {
    const m = new Map<string, PagoGasto>()
    for (const p of pagosHechos ?? []) m.set(p.gasto_id, p)
    return m
  }, [pagosHechos])

  const filtrados = useMemo(() => {
    let lista = gastos ?? []
    if (vista === 'pendientes') {
      lista = lista.filter((g) => (g.estado_pago ?? '').toLowerCase() !== 'pagado')
    } else if (vista === 'pagados') {
      lista = lista.filter((g) => (g.estado_pago ?? '').toLowerCase() === 'pagado')
    }
    if (busqueda.trim()) {
      const b = busqueda.toLowerCase()
      lista = lista.filter((g) =>
        (g.proveedor ?? '').toLowerCase().includes(b) ||
        (g.comentario ?? '').toLowerCase().includes(b) ||
        (g.categoria ?? '').toLowerCase().includes(b)
      )
    }
    return lista
  }, [gastos, vista, busqueda])

  const totales = useMemo(() => {
    const all = gastos ?? []
    const pendientes = all.filter((g) => (g.estado_pago ?? '').toLowerCase() !== 'pagado')
    const pagados = all.filter((g) => (g.estado_pago ?? '').toLowerCase() === 'pagado')
    return {
      cantPendientes: pendientes.length,
      montoPendiente: pendientes.reduce((s, g) => s + Number(g.importe_total), 0),
      cantPagados: pagados.length,
      montoPagado: pagados.reduce((s, g) => s + Number(g.importe_total), 0),
    }
  }, [gastos])

  function abrirModalPago(g: Gasto) {
    setGastoAPagar(g)
    setPagoFecha(new Date().toISOString().split('T')[0])
    setPagoMedio('efectivo')
  }

  async function confirmarPago() {
    if (!gastoAPagar) return
    const { error } = await supabase.from('gastos').update({
      estado_pago: 'Pagado',
      fecha_vencimiento: pagoFecha,
    }).eq('id', gastoAPagar.id)
    if (error) { window.alert(error.message); return }
    await supabase.from('pagos_gastos').insert({
      gasto_id: gastoAPagar.id,
      fecha_pago: pagoFecha,
      monto: gastoAPagar.importe_total,
      medio_pago: pagoMedio,
    })
    setGastoAPagar(null)
    qc.invalidateQueries({ queryKey: ['gastos_pagos'] })
    qc.invalidateQueries({ queryKey: ['pagos_gastos_historial'] })
    qc.invalidateQueries({ queryKey: ['pagos_gastos'] })
  }

  async function revertirPago(g: Gasto) {
    if (!window.confirm(`¿Revertir el pago de ${g.proveedor || 'sin proveedor'} por ${formatARS(g.importe_total)}?`)) return
    const { error } = await supabase.from('gastos').update({
      estado_pago: 'pendiente',
      fecha_vencimiento: null,
    }).eq('id', g.id)
    if (error) { window.alert(error.message); return }
    await supabase.from('pagos_gastos').delete().eq('gasto_id', g.id)
    qc.invalidateQueries({ queryKey: ['gastos_pagos'] })
    qc.invalidateQueries({ queryKey: ['pagos_gastos_historial'] })
    qc.invalidateQueries({ queryKey: ['pagos_gastos'] })
  }

  return (
    <div>
      {/* Filtros */}
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <LocalSelector value={local} onChange={(v) => setLocal(v as 'ambos' | 'vedia' | 'saavedra')} options={['vedia', 'saavedra', 'ambos']} />
        <input
          type="date"
          value={desde}
          onChange={(e) => setDesde(e.target.value)}
          className="text-xs border border-gray-300 rounded px-2 py-1.5"
        />
        <span className="text-gray-400 text-xs">→</span>
        <input
          type="date"
          value={hasta}
          onChange={(e) => setHasta(e.target.value)}
          className="text-xs border border-gray-300 rounded px-2 py-1.5"
        />
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar proveedor..."
          className="flex-1 min-w-[180px] text-xs border border-gray-300 rounded px-2 py-1.5"
        />
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-amber-50 rounded-lg border border-amber-200 px-4 py-3">
          <div className="text-[10px] uppercase text-amber-700 tracking-wide">Pendientes de pago</div>
          <div className="text-lg font-bold text-amber-900 mt-0.5">
            {totales.cantPendientes} — {formatARS(totales.montoPendiente)}
          </div>
        </div>
        <div className="bg-green-50 rounded-lg border border-green-200 px-4 py-3">
          <div className="text-[10px] uppercase text-green-700 tracking-wide">Pagados este período</div>
          <div className="text-lg font-bold text-green-900 mt-0.5">
            {totales.cantPagados} — {formatARS(totales.montoPagado)}
          </div>
        </div>
      </div>

      {/* Vista tabs */}
      <div className="flex gap-1 mb-4">
        {([
          { id: 'pendientes' as Vista, label: 'Pendientes', color: 'amber' },
          { id: 'pagados' as Vista, label: 'Pagados', color: 'green' },
          { id: 'todos' as Vista, label: 'Todos', color: 'gray' },
        ]).map((v) => (
          <button
            key={v.id}
            onClick={() => setVista(v.id)}
            className={cn(
              'text-xs px-3 py-1.5 rounded border font-medium',
              vista === v.id
                ? 'bg-rodziny-700 text-white border-rodziny-700'
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            )}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-lg border border-surface-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-gray-500 uppercase">
                <th className="px-3 py-2 text-left font-semibold">Fecha gasto</th>
                <th className="px-3 py-2 text-left font-semibold">Proveedor</th>
                <th className="px-3 py-2 text-left font-semibold">Categoría</th>
                <th className="px-3 py-2 text-left font-semibold">Comentario</th>
                <th className="px-3 py-2 text-right font-semibold">Total</th>
                <th className="px-3 py-2 text-center font-semibold">Estado</th>
                <th className="px-3 py-2 text-center font-semibold">Medio</th>
                <th className="px-3 py-2 text-center font-semibold">Fecha pago</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={9} className="px-3 py-8 text-center text-gray-400">Cargando...</td></tr>
              )}
              {!isLoading && filtrados.length === 0 && (
                <tr><td colSpan={9} className="px-3 py-8 text-center text-gray-400">Sin gastos en este rango</td></tr>
              )}
              {filtrados.map((g) => {
                const pagado = (g.estado_pago ?? '').toLowerCase() === 'pagado'
                const pago = pagosMap.get(g.id)
                return (
                  <tr key={g.id} className={cn('border-b border-gray-100 hover:bg-gray-50', pagado && 'bg-green-50/30')}>
                    <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{formatFecha(g.fecha)}</td>
                    <td className="px-3 py-2 text-gray-900 font-medium">{g.proveedor || '—'}</td>
                    <td className="px-3 py-2 text-gray-600">{g.categoria || '—'}</td>
                    <td className="px-3 py-2 text-gray-600 max-w-[200px] truncate" title={g.comentario ?? ''}>{g.comentario || '—'}</td>
                    <td className="px-3 py-2 text-right text-gray-900 font-semibold tabular-nums">{formatARS(g.importe_total)}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={cn(
                        'inline-block px-2 py-0.5 rounded text-[10px] font-medium',
                        pagado ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
                      )}>
                        {pagado ? 'Pagado' : 'Pendiente'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center text-gray-600">
                      {pago ? (MEDIO_PAGO_LABEL[pago.medio_pago as MedioPago] ?? pago.medio_pago) : '—'}
                    </td>
                    <td className="px-3 py-2 text-center text-gray-600 whitespace-nowrap">
                      {pago ? formatFecha(pago.fecha_pago) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {!pagado ? (
                        <button
                          onClick={() => abrirModalPago(g)}
                          className="text-[10px] px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700 font-medium"
                        >
                          Registrar pago
                        </button>
                      ) : (
                        <button
                          onClick={() => revertirPago(g)}
                          className="text-[10px] px-2 py-1 text-red-600 border border-red-200 rounded hover:bg-red-50"
                        >
                          Revertir
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            {filtrados.length > 0 && (
              <tfoot className="bg-gray-100 border-t border-gray-300">
                <tr className="font-semibold">
                  <td colSpan={4} className="px-3 py-2 text-right text-gray-600">
                    TOTAL ({filtrados.length}):
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatARS(filtrados.reduce((s, g) => s + Number(g.importe_total), 0))}
                  </td>
                  <td colSpan={4}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Modal de pago */}
      {gastoAPagar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm space-y-4">
            <h3 className="text-sm font-semibold text-gray-800">Registrar pago</h3>
            <p className="text-xs text-gray-500">
              {gastoAPagar.proveedor || 'Sin proveedor'} — {formatARS(gastoAPagar.importe_total)}
            </p>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Fecha de pago</label>
              <input
                type="date"
                value={pagoFecha}
                onChange={(e) => setPagoFecha(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Medio de pago</label>
              <select
                value={pagoMedio}
                onChange={(e) => setPagoMedio(e.target.value as MedioPago)}
                className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm"
              >
                {Object.entries(MEDIO_PAGO_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setGastoAPagar(null)}
                className="px-3 py-1.5 text-xs text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarPago}
                className="px-3 py-1.5 text-xs text-white bg-green-600 rounded-md hover:bg-green-700 font-medium"
              >
                Confirmar pago
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
