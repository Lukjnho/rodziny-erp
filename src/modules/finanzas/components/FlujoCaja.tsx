import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { LocalSelector } from '@/components/ui/LocalSelector'
import { KPICard } from '@/components/ui/KPICard'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatARS, formatFecha } from '@/lib/utils'
import { useState } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

const CUENTAS = ['mercadopago', 'galicia', 'icbc'] as const
type Cuenta = typeof CUENTAS[number]

export function FlujoCaja() {
  const [local, setLocal] = useState<'ambos' | 'vedia' | 'saavedra'>('vedia')
  const [periodo, setPeriodo] = useState(() => new Date().toISOString().substring(0, 7))
  const [cuenta, setCuenta] = useState<Cuenta | 'todas'>('todas')

  const { data: movimientos, isLoading } = useQuery({
    queryKey: ['movimientos', periodo, cuenta],
    queryFn: async () => {
      let q = supabase.from('movimientos_bancarios').select('*').eq('periodo', periodo).order('fecha', { ascending: true })
      if (cuenta !== 'todas') q = q.eq('cuenta', cuenta)
      const { data } = await q
      return data ?? []
    },
  })

  // KPIs
  const totalCreditos = movimientos?.reduce((s, m) => s + Number(m.credito), 0) ?? 0
  const totalDebitos  = movimientos?.reduce((s, m) => s + Number(m.debito), 0) ?? 0
  const saldoNeto     = totalCreditos - totalDebitos

  // Datos para gráfico acumulado
  const chartData = (() => {
    if (!movimientos?.length) return []
    let acum = 0
    const byDay = new Map<string, number>()
    for (const m of movimientos) {
      acum += Number(m.credito) - Number(m.debito)
      byDay.set(m.fecha as string, acum)
    }
    return Array.from(byDay.entries()).map(([fecha, saldo]) => ({ fecha: fecha.substring(8), saldo }))
  })()

  return (
    <div className="space-y-6">
      {/* Filtros */}
      <div className="flex items-center gap-4 flex-wrap">
        <LocalSelector value={local} onChange={(v) => setLocal(v as 'ambos' | 'vedia' | 'saavedra')} options={['vedia', 'saavedra', 'ambos']} />
        <div>
          <label className="text-xs font-medium text-gray-500 mr-2">Período</label>
          <input type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-rodziny-500" />
        </div>
        <div className="flex gap-1">
          {(['todas', ...CUENTAS] as const).map((c) => (
            <button key={c} onClick={() => setCuenta(c)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${cuenta === c ? 'bg-rodziny-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {c === 'todas' ? 'Todas' : c === 'mercadopago' ? 'MercadoPago' : c.charAt(0).toUpperCase() + c.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <KPICard label="Ingresos" value={formatARS(totalCreditos)} color="green" loading={isLoading} />
        <KPICard label="Egresos"  value={formatARS(totalDebitos)}  color="red"   loading={isLoading} />
        <KPICard label="Saldo neto" value={formatARS(saldoNeto)} color={saldoNeto >= 0 ? 'green' : 'red'} loading={isLoading} />
      </div>

      {/* Gráfico */}
      {chartData.length > 0 && (
        <div className="bg-white rounded-lg border border-surface-border p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Saldo acumulado — {periodo}</h3>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="saldoGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#65a832" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#65a832" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="fecha" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
              <Tooltip formatter={(v) => formatARS(Number(v))} labelFormatter={(l) => `Día ${l}`} />
              <Area type="monotone" dataKey="saldo" stroke="#4f8828" fill="url(#saldoGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Tabla de movimientos */}
      <div className="bg-white rounded-lg border border-surface-border overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">Movimientos ({movimientos?.length ?? 0})</h3>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Cargando...</div>
        ) : !movimientos?.length ? (
          <div className="p-8 text-center text-gray-400 text-sm">No hay movimientos para este período. Importá un extracto bancario.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {['Fecha', 'Cuenta', 'Descripción', 'Débito', 'Crédito', 'Saldo'].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {movimientos.map((m) => (
                  <tr key={m.id as string} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{formatFecha(m.fecha as string)}</td>
                    <td className="px-4 py-2.5">
                      <StatusBadge
                        status={m.cuenta === 'mercadopago' ? 'blue' : m.cuenta === 'galicia' ? 'green' : 'yellow'}
                        label={m.cuenta === 'mercadopago' ? 'MP' : (m.cuenta as string).toUpperCase()}
                      />
                    </td>
                    <td className="px-4 py-2.5 text-gray-700 max-w-xs truncate">{m.descripcion as string}</td>
                    <td className="px-4 py-2.5 text-red-600 text-mono-val">
                      {Number(m.debito) > 0 ? formatARS(Number(m.debito)) : ''}
                    </td>
                    <td className="px-4 py-2.5 text-green-700 text-mono-val">
                      {Number(m.credito) > 0 ? formatARS(Number(m.credito)) : ''}
                    </td>
                    <td className="px-4 py-2.5 text-gray-700 text-mono-val">
                      {m.saldo != null ? formatARS(Number(m.saldo)) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
