import { useMemo, useRef, useState } from 'react'
import { formatARS } from '@/lib/utils'
import {
  parseMercadoPagoCSV,
  calcularKPIsMP,
  type MovimientoMP,
  type TipoMovimientoMP,
  type ResultadoParseoMP,
} from '../parsers/parseMercadoPago'

const ETIQUETAS_TIPO: Record<TipoMovimientoMP, string> = {
  payment: 'Cobro',
  refund: 'Devolución',
  payout: 'Transferencia salida',
  asset_management: 'Rendimiento',
}

const COLORES_TIPO: Record<TipoMovimientoMP, string> = {
  payment: 'bg-green-100 text-green-800',
  refund: 'bg-red-100 text-red-800',
  payout: 'bg-amber-100 text-amber-800',
  asset_management: 'bg-blue-100 text-blue-800',
}

type FiltroTipo = 'todos' | TipoMovimientoMP

export function ConciliacionBancaria() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [resultado, setResultado] = useState<ResultadoParseoMP | null>(null)
  const [nombreArchivo, setNombreArchivo] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [filtroTipo, setFiltroTipo] = useState<FiltroTipo>('todos')
  const [filtroMedio, setFiltroMedio] = useState<string>('todos')
  const [busqueda, setBusqueda] = useState<string>('')

  async function onArchivo(f: File) {
    setError(null)
    setNombreArchivo(f.name)
    try {
      const texto = await f.text()
      const res = parseMercadoPagoCSV(texto)
      if (res.movimientos.length === 0) {
        setError('El archivo no contiene movimientos reconocibles. ¿Es un export de MercadoPago?')
        setResultado(null)
        return
      }
      setResultado(res)
      setFiltroTipo('todos')
      setFiltroMedio('todos')
      setBusqueda('')
    } catch (e) {
      setError(`No se pudo leer el archivo: ${(e as Error).message}`)
      setResultado(null)
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f) onArchivo(f)
  }

  const kpis = useMemo(() => (resultado ? calcularKPIsMP(resultado.movimientos) : null), [resultado])

  const mediosDisponibles = useMemo(() => {
    if (!resultado) return []
    const set = new Set<string>()
    resultado.movimientos.forEach((m) => m.medioPago && set.add(m.medioPago))
    return Array.from(set).sort()
  }, [resultado])

  const movsFiltrados = useMemo(() => {
    if (!resultado) return []
    const q = busqueda.trim().toLowerCase()
    return resultado.movimientos.filter((m) => {
      if (filtroTipo !== 'todos' && m.tipo !== filtroTipo) return false
      if (filtroMedio !== 'todos' && m.medioPago !== filtroMedio) return false
      if (q && !m.sourceId.toLowerCase().includes(q) && !m.medioPago.toLowerCase().includes(q) && !m.subUnit.toLowerCase().includes(q)) return false
      return true
    })
  }, [resultado, filtroTipo, filtroMedio, busqueda])

  // ── Upload zone si todavía no hay archivo ──────────────────────────────────
  if (!resultado) {
    return (
      <div className="space-y-4">
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Conciliación bancaria — MercadoPago</h2>
          <p className="text-sm text-gray-500 mb-4">
            Subí el CSV de liquidaciones exportado desde MercadoPago (Actividad → Exportar).
          </p>

          <div
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => inputRef.current?.click()}
            className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-rodziny-500 hover:bg-gray-50 transition-colors"
          >
            <div className="text-3xl mb-2">🏦</div>
            <p className="text-sm text-gray-600 mb-1">Arrastrá el archivo CSV o hacé clic para seleccionar</p>
            <p className="text-xs text-gray-400">Formato: export de MercadoPago con separador ';'</p>
          </div>

          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onArchivo(f)
              e.target.value = ''
            }}
          />

          {error && <div className="mt-4 p-3 rounded bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}
        </div>

        <div className="p-4 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
          <p className="font-semibold mb-1">En qué está esta sección</p>
          <p>
            Primera iteración: parsea el CSV, muestra KPIs del período (cobros brutos, comisiones, impuestos, retiros)
            y lista los movimientos. El matching automático contra el Flujo de Caja queda para la próxima iteración —
            por ahora sirve para auditar el mes de MP sin tener que abrir Excel.
          </p>
        </div>
      </div>
    )
  }

  // ── Vista con datos ────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Header con nombre de archivo + reset */}
      <div className="flex items-center justify-between bg-white rounded-lg border border-gray-200 px-4 py-3">
        <div>
          <div className="text-xs text-gray-500">Archivo cargado</div>
          <div className="text-sm font-medium text-gray-900">{nombreArchivo}</div>
          <div className="text-xs text-gray-400 mt-0.5">
            {resultado.movimientos.length} movimientos · {resultado.descartados} reservas técnicas filtradas
          </div>
        </div>
        <button
          onClick={() => { setResultado(null); setNombreArchivo(''); setError(null) }}
          className="text-xs px-3 py-1.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
        >
          Cargar otro archivo
        </button>
      </div>

      {/* Saldos del período */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-xs text-gray-500">Saldo inicial del período</div>
          <div className="text-lg font-semibold text-gray-900">{formatARS(resultado.saldoInicial)}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-xs text-gray-500">Saldo final del período</div>
          <div className="text-lg font-semibold text-gray-900">{formatARS(resultado.saldoFinal)}</div>
        </div>
      </div>

      {/* KPIs */}
      {kpis && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPI label="Cobros brutos"          value={formatARS(kpis.cobrosBrutos)}          sub={`${kpis.cantidadPayments} operaciones`} />
          <KPI label="Cobros netos"           value={formatARS(kpis.cobrosNetos)}           sub={`Ticket prom. ${formatARS(kpis.ticketPromedio)}`} />
          <KPI label="Comisiones MP"          value={`- ${formatARS(kpis.comisiones)}`}     sub={kpis.cobrosBrutos > 0 ? `${((kpis.comisiones / kpis.cobrosBrutos) * 100).toFixed(2)}% sobre bruto` : ''} tone="negative" />
          <KPI label="Impuestos / retenciones" value={`- ${formatARS(kpis.impuestos)}`}     sub={kpis.cobrosBrutos > 0 ? `${((kpis.impuestos / kpis.cobrosBrutos) * 100).toFixed(2)}% sobre bruto` : ''} tone="negative" />
          <KPI label="Transferencias salida"  value={`- ${formatARS(kpis.payouts)}`}        sub="Payouts a banco / retiros" tone="negative" />
          <KPI label="Devoluciones"           value={`- ${formatARS(kpis.refunds)}`}        sub="Refunds a clientes" tone="negative" />
          <KPI label="Rendimientos"           value={`+ ${formatARS(kpis.rendimientos)}`}   sub="Fondo común MP" tone="positive" />
          <KPI label="Resultado neto"         value={formatARS(kpis.cobrosNetos - kpis.payouts - kpis.refunds + kpis.rendimientos)} sub="Neto del período" />
        </div>
      )}

      {/* Filtros */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={filtroTipo}
            onChange={(e) => setFiltroTipo(e.target.value as FiltroTipo)}
            className="text-sm border border-gray-300 rounded px-3 py-1.5 bg-white"
          >
            <option value="todos">Todos los tipos</option>
            <option value="payment">Cobros</option>
            <option value="refund">Devoluciones</option>
            <option value="payout">Transferencias salida</option>
            <option value="asset_management">Rendimientos</option>
          </select>

          <select
            value={filtroMedio}
            onChange={(e) => setFiltroMedio(e.target.value)}
            className="text-sm border border-gray-300 rounded px-3 py-1.5 bg-white"
          >
            <option value="todos">Todos los medios</option>
            {mediosDisponibles.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>

          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por ID, medio o canal…"
            className="flex-1 min-w-[200px] text-sm border border-gray-300 rounded px-3 py-1.5"
          />

          <span className="text-xs text-gray-500 whitespace-nowrap">
            {movsFiltrados.length} de {resultado.movimientos.length}
          </span>
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Medio</th>
                <th className="px-3 py-2">Canal</th>
                <th className="px-3 py-2 text-right">Bruto</th>
                <th className="px-3 py-2 text-right">Comisión</th>
                <th className="px-3 py-2 text-right">Impuestos</th>
                <th className="px-3 py-2 text-right">Neto</th>
                <th className="px-3 py-2 text-right">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {movsFiltrados.slice(0, 500).map((m) => <FilaMov key={`${m.sourceId}-${m.fechaHora}`} m={m} />)}
            </tbody>
          </table>
        </div>
        {movsFiltrados.length > 500 && (
          <div className="px-3 py-2 bg-gray-50 border-t border-gray-200 text-xs text-gray-500 text-center">
            Mostrando los primeros 500 — afiná los filtros para ver el resto.
          </div>
        )}
      </div>

      {/* Nota sobre matching */}
      <div className="p-4 bg-blue-50 border border-blue-200 rounded text-xs text-blue-800">
        <p className="font-semibold mb-1">Próxima iteración</p>
        <p>
          Matching automático contra el Flujo de Caja (tabla movimientos_bancarios cuenta=mercadopago)
          por fecha + monto + medio, con semáforo verde/ámbar/rojo para ver qué quedó sin conciliar.
        </p>
      </div>
    </div>
  )
}

function KPI({ label, value, sub, tone = 'neutral' }: { label: string; value: string; sub?: string; tone?: 'positive' | 'negative' | 'neutral' }) {
  const color = tone === 'positive' ? 'text-green-700' : tone === 'negative' ? 'text-red-700' : 'text-gray-900'
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  )
}

function FilaMov({ m }: { m: MovimientoMP }) {
  const neto = m.netoCredito - m.netoDebito
  const netoColor = neto >= 0 ? 'text-green-700' : 'text-red-700'

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50">
      <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{m.fecha}</td>
      <td className="px-3 py-2 whitespace-nowrap">
        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${COLORES_TIPO[m.tipo]}`}>
          {ETIQUETAS_TIPO[m.tipo]}
        </span>
      </td>
      <td className="px-3 py-2 text-xs text-gray-700">{m.medioPago || '—'}</td>
      <td className="px-3 py-2 text-xs text-gray-500">{m.subUnit || '—'}</td>
      <td className="px-3 py-2 text-right tabular-nums">{formatARS(m.bruto)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-gray-500">{m.comision !== 0 ? formatARS(m.comision) : '—'}</td>
      <td className="px-3 py-2 text-right tabular-nums text-gray-500">{m.impuestos !== 0 ? formatARS(m.impuestos) : '—'}</td>
      <td className={`px-3 py-2 text-right tabular-nums font-medium ${netoColor}`}>
        {neto >= 0 ? '+' : ''}{formatARS(neto)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-xs text-gray-400">{formatARS(m.saldoPosterior)}</td>
    </tr>
  )
}
