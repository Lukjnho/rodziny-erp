import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatARS } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { LocalSelector } from '@/components/ui/LocalSelector'
import { obtenerVentasFudo, CAJA_FUDO_ID, type VentasFudoResumen } from '@/lib/fudoApi'

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
  hora_inicio: string | null; hora_cierre: string | null
  monto_esperado: number | null; monto_contado: number; diferencia: number | null
  fudo_efectivo: number; fudo_qr: number; fudo_debito: number; fudo_credito: number; fudo_transferencia: number
  fondo_apertura: number; fondo_siguiente: number; retiro: number
  otros_retiros: number; otros_retiros_nota: string | null
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
  const [fHoraInicio, setFHoraInicio] = useState('')
  const [fHoraCierre, setFHoraCierre] = useState('')
  const [fFudoEfvo, setFFudoEfvo]   = useState('')
  const [fFudoQR, setFFudoQR]       = useState('')
  const [fFudoDebito, setFFudoDebito] = useState('')
  const [fFudoCredito, setFFudoCredito] = useState('')
  const [fFudoTransf, setFFudoTransf] = useState('')
  const [fContado, setFContado] = useState('')
  const [fFondoAp, setFFondoAp] = useState('')
  const [fFondoSig, setFFondoSig] = useState('')
  const [fOtrosRetiros, setFOtrosRetiros] = useState('')
  const [fOtrosRetNota, setFOtrosRetNota] = useState('')
  const [fNota, setFNota]       = useState('')

  // Fudo API state
  const [fudoCargando, setFudoCargando] = useState(false)
  const [fudoProgreso, setFudoProgreso] = useState('')
  const [fudoError, setFudoError]       = useState('')
  const [fudoResumen, setFudoResumen]   = useState<VentasFudoResumen | null>(null)

  async function cargarDesdeFudo() {
    setFudoCargando(true)
    setFudoError('')
    setFudoProgreso('Conectando con Fudo...')
    setFudoResumen(null)
    try {
      // Buscar el CashRegister ID de Fudo para la caja seleccionada
      const cajaFudoId = fCaja ? CAJA_FUDO_ID[local]?.[fCaja] : undefined
      const resumen = await obtenerVentasFudo(local, fFecha, setFudoProgreso, cajaFudoId)
      setFudoResumen(resumen)
      // Auto-completar campos del formulario
      setFFudoEfvo(resumen.efectivo > 0 ? String(Math.round(resumen.efectivo)) : '')
      setFFudoQR(resumen.qr > 0 ? String(Math.round(resumen.qr)) : '')
      setFFudoDebito(resumen.debito > 0 ? String(Math.round(resumen.debito)) : '')
      setFFudoCredito(resumen.credito > 0 ? String(Math.round(resumen.credito)) : '')
      setFFudoTransf(resumen.transferencia > 0 ? String(Math.round(resumen.transferencia)) : '')
      setFudoProgreso(`${resumen.cantidadTickets} tickets cargados`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('CORS')) {
        setFudoError('Error de red/CORS — la API de Fudo no permite llamadas directas desde el navegador. Se necesita un proxy (Edge Function).')
      } else {
        setFudoError(msg)
      }
    } finally {
      setFudoCargando(false)
    }
  }

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
      const parse = (v: string) => parseFloat((v || '0').replace(/\./g, '').replace(',', '.')) || 0
      const contado = parse(fContado)
      const fondoAp = parse(fFondoAp)
      const fondoSig = parse(fFondoSig)
      const otrosRet = parse(fOtrosRetiros)
      const fudoEfvo = parse(fFudoEfvo)
      const fudoQR = parse(fFudoQR)
      const fudoDebito = parse(fFudoDebito)
      const fudoCredito = parse(fFudoCredito)
      const fudoTransf = parse(fFudoTransf)
      const totalFudo = fudoEfvo + fudoQR + fudoDebito + fudoCredito + fudoTransf
      const retiro = contado - fondoSig

      const { error } = await supabase.from('cierres_caja').upsert({
        local,
        fecha: fFecha,
        turno: fTurno,
        caja: fCaja || null,
        hora_inicio: fHoraInicio || null,
        hora_cierre: fHoraCierre || null,
        fudo_efectivo: fudoEfvo,
        fudo_qr: fudoQR,
        fudo_debito: fudoDebito,
        fudo_credito: fudoCredito,
        fudo_transferencia: fudoTransf,
        monto_esperado: totalFudo > 0 ? totalFudo : null,
        monto_contado: contado,
        fondo_apertura: fondoAp,
        fondo_siguiente: fondoSig,
        retiro: retiro > 0 ? retiro : 0,
        otros_retiros: otrosRet,
        otros_retiros_nota: fOtrosRetNota || null,
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
    setFHoraInicio('')
    setFHoraCierre('')
    setFFudoEfvo('')
    setFFudoQR('')
    setFFudoDebito('')
    setFFudoCredito('')
    setFFudoTransf('')
    setFContado('')
    setFFondoAp('')
    setFFondoSig('')
    setFOtrosRetiros('')
    setFOtrosRetNota('')
    setFNota('')
    setFudoResumen(null)
    setFudoError('')
    setFudoProgreso('')
  }

  function abrirForm() {
    resetForm()
    setFormOpen(true)
  }

  // ── resumen del mes ────────────────────────────────────────────────────────
  const resumen = useMemo(() => {
    if (!cierres) return { total: 0, positivos: 0, negativos: 0, cantidad: 0, verificados: 0, pendientes: 0, totalRetiros: 0, totalOtrosRetiros: 0, totalFudo: 0 }
    let total = 0, positivos = 0, negativos = 0, verificados = 0, totalRetiros = 0, totalOtrosRetiros = 0, totalFudo = 0
    for (const c of cierres) {
      const dif = c.diferencia ?? 0
      total += dif
      if (dif > 0) positivos += dif
      if (dif < 0) negativos += dif
      if (c.verificado) verificados++
      totalRetiros += c.retiro ?? 0
      totalOtrosRetiros += c.otros_retiros ?? 0
      totalFudo += c.monto_esperado ?? 0
    }
    return { total, positivos, negativos, cantidad: cierres.length, verificados, pendientes: cierres.length - verificados, totalRetiros, totalOtrosRetiros, totalFudo }
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
        <div className="ml-auto">
          <button
            onClick={abrirForm}
            className="px-4 py-1.5 bg-rodziny-800 text-white text-sm font-medium rounded-md hover:bg-rodziny-700 transition-colors"
          >
            + Nuevo cierre
          </button>
        </div>
      </div>

      {/* KPIs resumen */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-lg border border-surface-border p-4">
          <p className="text-xs text-gray-500 mb-1">Efectivo del mes</p>
          <p className="text-lg font-semibold text-green-700">{formatARS(resumen.totalRetiros)}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">{resumen.cantidad} cierres</p>
        </div>
        <div className="bg-white rounded-lg border border-surface-border p-4">
          <p className="text-xs text-gray-500 mb-1">Total Fudo del mes</p>
          <p className="text-lg font-semibold text-blue-700">{formatARS(resumen.totalFudo)}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">Suma de todos los cierres</p>
        </div>
        <div className="bg-white rounded-lg border border-surface-border p-4">
          <p className="text-xs text-gray-500 mb-1">Diferencia neta</p>
          <p className={cn('text-lg font-semibold', resumen.total === 0 ? 'text-green-600' : resumen.total > 0 ? 'text-blue-600' : 'text-red-600')}>
            {formatARS(resumen.total)}
          </p>
          <p className="text-[10px] text-gray-400 mt-0.5">
            {resumen.positivos > 0 && `Sobrantes: ${formatARS(resumen.positivos)}`}
            {resumen.positivos > 0 && resumen.negativos < 0 && ' · '}
            {resumen.negativos < 0 && `Faltantes: ${formatARS(resumen.negativos)}`}
          </p>
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
              <label className="block text-xs font-medium text-gray-600 mb-1">Hora inicio (Fudo)</label>
              <input type="time" value={fHoraInicio} onChange={(e) => setFHoraInicio(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-rodziny-500" />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Hora cierre (Fudo)</label>
              <input type="time" value={fHoraCierre} onChange={(e) => setFHoraCierre(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-rodziny-500" />
            </div>

            {/* ── Datos de Fudo ── */}
            <div className="col-span-2 md:col-span-3 mt-2">
              <div className="flex items-center justify-between border-b border-gray-200 pb-1 mb-3">
                <p className="text-xs font-semibold text-gray-700">Datos de Fudo</p>
                <button
                  type="button"
                  onClick={cargarDesdeFudo}
                  disabled={fudoCargando}
                  className={cn(
                    'px-3 py-1 text-xs font-medium rounded-md transition-colors',
                    fudoCargando
                      ? 'bg-gray-100 text-gray-400 cursor-wait'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  )}
                >
                  {fudoCargando ? fudoProgreso || 'Cargando...' : 'Cargar desde Fudo API'}
                </button>
              </div>
              {fudoError && (
                <div className="bg-red-50 border border-red-200 rounded-md px-3 py-2 mb-3">
                  <p className="text-xs text-red-700">{fudoError}</p>
                </div>
              )}
              {fudoResumen && !fudoError && (
                <div className="bg-green-50 border border-green-200 rounded-md px-3 py-2 mb-3">
                  <p className="text-xs text-green-700">
                    {fudoResumen.cantidadTickets} tickets del {new Date(fudoResumen.fecha + 'T12:00:00').toLocaleDateString('es-AR')}
                    {' — '}Total: {formatARS(fudoResumen.totalVentas)}
                    {fudoResumen.cajero && ` — Cajero: ${fudoResumen.cajero}`}
                    {fudoResumen.mpLucas > 0 && ` — MP Lucas: ${formatARS(fudoResumen.mpLucas)}`}
                    {fudoResumen.ctaCte > 0 && ` — Cta.Cte: ${formatARS(fudoResumen.ctaCte)}`}
                  </p>
                  {/* Desglose por caja (solo si no se filtró por caja específica) */}
                  {Object.keys(fudoResumen.porCaja || {}).length > 1 && (
                    <p className="text-[10px] text-green-600 mt-1">
                      {Object.entries(fudoResumen.porCaja).map(([id, c]) => (
                        `Caja ${id}: ${c.tickets} tickets, ${c.cajero ?? 'sin cajero'}`
                      )).join(' · ')}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Efectivo (Fudo)</label>
              <input type="text" value={fFudoEfvo} onChange={(e) => setFFudoEfvo(e.target.value)}
                placeholder="0" className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-rodziny-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Código QR (Fudo)</label>
              <input type="text" value={fFudoQR} onChange={(e) => setFFudoQR(e.target.value)}
                placeholder="0" className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-rodziny-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Débito (Fudo)</label>
              <input type="text" value={fFudoDebito} onChange={(e) => setFFudoDebito(e.target.value)}
                placeholder="0" className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-rodziny-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Crédito (Fudo)</label>
              <input type="text" value={fFudoCredito} onChange={(e) => setFFudoCredito(e.target.value)}
                placeholder="0" className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-rodziny-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Transferencia (Fudo)</label>
              <input type="text" value={fFudoTransf} onChange={(e) => setFFudoTransf(e.target.value)}
                placeholder="0" className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-rodziny-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Total Fudo</label>
              {(() => {
                const parse = (v: string) => parseFloat((v || '0').replace(/\./g, '').replace(',', '.')) || 0
                const total = parse(fFudoEfvo) + parse(fFudoQR) + parse(fFudoDebito) + parse(fFudoCredito) + parse(fFudoTransf)
                return (
                  <div className="w-full rounded-md px-3 py-2 text-sm font-semibold bg-gray-100 text-gray-800">
                    {total > 0 ? formatARS(total) : '—'}
                  </div>
                )
              })()}
            </div>

            {/* ── Arqueo de efectivo ── */}
            <div className="col-span-2 md:col-span-3 mt-2">
              <p className="text-xs font-semibold text-gray-700 border-b border-gray-200 pb-1 mb-1">Arqueo de efectivo</p>
              <p className="text-[10px] text-gray-400 mb-3">Solo se compara el efectivo físico en caja contra lo que Fudo registró como pago en efectivo</p>
            </div>

            {/* Fila 1: Cambio apertura, Contado real, Otros retiros */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Cambio apertura</label>
              <input type="text" value={fFondoAp} onChange={(e) => setFFondoAp(e.target.value)}
                placeholder="0"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-rodziny-500" />
              <p className="text-[10px] text-gray-400 mt-0.5">Plata que había al abrir la caja</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Contado real <span className="text-red-500">*</span></label>
              <input type="text" value={fContado} onChange={(e) => setFContado(e.target.value)}
                placeholder="0" className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-rodziny-500" />
              <p className="text-[10px] text-gray-400 mt-0.5">Billetes y monedas al cerrar (solo efectivo)</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Diferencia efectivo</label>
              {(() => {
                const parse = (v: string) => parseFloat((v || '0').replace(/\./g, '').replace(',', '.')) || 0
                const fudoEfvo = parse(fFudoEfvo)
                const cont = parse(fContado)
                const fondoAp = parse(fFondoAp)
                const otrosRet = parse(fOtrosRetiros)
                const ventasReales = cont + otrosRet - fondoAp
                const mostrar = fudoEfvo > 0 && cont > 0
                const dif = mostrar ? ventasReales - fudoEfvo : 0
                return (
                  <div className={cn(
                    'w-full rounded-md px-3 py-2 text-sm font-medium',
                    !mostrar ? 'bg-gray-50 text-gray-500' : dif === 0 ? 'bg-green-50 text-green-700' : dif > 0 ? 'bg-blue-50 text-blue-700' : 'bg-red-50 text-red-700'
                  )}>
                    {mostrar ? `${formatARS(dif)} ${dif === 0 ? '— Cuadra' : dif > 0 ? '↑ Sobrante' : '↓ Faltante'}` : '—'}
                  </div>
                )
              })()}
              <p className="text-[10px] text-gray-400 mt-0.5">Contado + retiros - cambio apertura vs. efectivo Fudo</p>
            </div>

            {/* Fila 2: Cambio siguiente, Retiro, Otros retiros */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Cambio próximo turno</label>
              <input type="text" value={fFondoSig} onChange={(e) => setFFondoSig(e.target.value)}
                placeholder="0"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-rodziny-500" />
              <p className="text-[10px] text-gray-400 mt-0.5">Plata que se deja para el próximo turno</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Retiro de efectivo</label>
              {(() => {
                const cont = parseFloat((fContado || '0').replace(/\./g, '').replace(',', '.')) || 0
                const fondoSig = parseFloat((fFondoSig || '0').replace(/\./g, '').replace(',', '.')) || 0
                const retiro = cont - fondoSig
                return (
                  <div className="w-full rounded-md px-3 py-2 text-sm font-medium bg-green-50 text-green-800">
                    {cont > 0 ? formatARS(retiro > 0 ? retiro : 0) : '—'}
                  </div>
                )
              })()}
              <p className="text-[10px] text-gray-400 mt-0.5">Lo que admin se lleva</p>
            </div>

            {/* Otros retiros eventuales */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Otros retiros</label>
              <input type="text" value={fOtrosRetiros} onChange={(e) => setFOtrosRetiros(e.target.value)}
                placeholder="0"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-rodziny-500" />
              <p className="text-[10px] text-gray-400 mt-0.5">Dinero sacado de caja durante el turno</p>
            </div>

            <div className="col-span-1 md:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Motivo del retiro extra</label>
              <input type="text" value={fOtrosRetNota} onChange={(e) => setFOtrosRetNota(e.target.value)}
                placeholder="Ej: Pago proveedor hielo"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-rodziny-500" />
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
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-600">Fudo total</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-600">Contado</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-600">Cambio</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-600">Retiro</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-600">Otros ret.</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-600">Diferencia</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">Nota</th>
                  <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-600">Verificado</th>
                  <th className="px-2 py-2.5 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {porFecha.map(([fecha, rows]) => {
                  const difDia = rows.reduce((s, r) => s + (r.diferencia ?? 0), 0)
                  const efectivoDia = rows.reduce((s, r) => s + (r.retiro > 0 ? r.retiro : r.monto_contado) + (r.otros_retiros ?? 0), 0)
                  const fudoDia = rows.reduce((s, r) => s + (r.monto_esperado ?? 0), 0)
                  return rows.map((c, i) => (
                    <tr key={c.id} className={cn(
                      'border-b border-gray-50 hover:bg-gray-50',
                      i === 0 && 'border-t border-gray-100'
                    )}>
                      {/* Fecha: solo en la primera fila del grupo */}
                      {i === 0 ? (
                        <td className="px-4 py-2 font-medium text-gray-800 align-top" rowSpan={rows.length}>
                          <div>{new Date(fecha + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
                          <div className="mt-1 space-y-0.5">
                            <div className="text-[10px] text-green-700 font-medium">Efvo: {formatARS(efectivoDia)}</div>
                            {fudoDia > 0 && <div className="text-[10px] text-blue-700 font-medium">Fudo: {formatARS(fudoDia)}</div>}
                          </div>
                          <div className={cn(
                            'text-xs font-medium mt-1',
                            difDia === 0 ? 'text-green-600' : difDia > 0 ? 'text-blue-600' : 'text-red-600'
                          )}>
                            {difDia === 0 ? 'Cuadra' : formatARS(difDia)}
                          </div>
                        </td>
                      ) : null}
                      <td className="px-4 py-2 text-gray-700">{c.caja || '—'}</td>
                      <td className="px-4 py-2 text-gray-600">
                        <div>{turnoLabel(c.turno)}</div>
                        {c.hora_inicio && c.hora_cierre && (
                          <div className="text-[10px] text-gray-400">{c.hora_inicio.substring(0, 5)}–{c.hora_cierre.substring(0, 5)}</div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-600">
                        {c.monto_esperado != null ? formatARS(c.monto_esperado) : '—'}
                      </td>
                      <td className="px-4 py-2 text-right font-medium text-gray-900">{formatARS(c.monto_contado)}</td>
                      <td className="px-4 py-2 text-right text-gray-500 text-xs">
                        {c.fondo_apertura > 0 && <div>Inicio: {formatARS(c.fondo_apertura)}</div>}
                        {c.fondo_siguiente > 0 && <div>Deja: {formatARS(c.fondo_siguiente)}</div>}
                      </td>
                      <td className="px-4 py-2 text-right font-medium text-green-700">
                        {c.retiro > 0 ? formatARS(c.retiro) : '—'}
                      </td>
                      <td className="px-4 py-2 text-right text-xs">
                        {(c.otros_retiros ?? 0) > 0 ? (
                          <div>
                            <span className="font-medium text-amber-700">{formatARS(c.otros_retiros)}</span>
                            {c.otros_retiros_nota && <div className="text-gray-400 truncate max-w-[120px]" title={c.otros_retiros_nota}>{c.otros_retiros_nota}</div>}
                          </div>
                        ) : '—'}
                      </td>
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
