import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { cn, formatARS } from '@/lib/utils'
import type { Empleado } from './RRHHPage'
import {
  MESES,
  diasDeQuincena,
  ultimoDiaDelMes,
  normalizarTexto,
  type Quincena,
} from './utils'
import type { Liquidacion, Adelanto, Sancion } from './sueldos/tipos'
import { periodoQuincena, periodoMes } from './sueldos/tipos'
import { PanelAdelantos } from './sueldos/PanelAdelantos'
import { PanelSanciones } from './sueldos/PanelSanciones'
import { SeccionImpuestos } from './sueldos/SeccionImpuestos'

type FiltroLocal = 'todos' | 'vedia' | 'saavedra' | 'ambos'
type PanelEstado = { tipo: 'adelantos' | 'sanciones'; empleadoId: string } | null

interface Cronograma {
  id: string
  empleado_id: string
  fecha: string
  hora_entrada: string | null
  hora_salida: string | null
  es_franco: boolean
  publicado: boolean
}

interface Fichada {
  id: string
  empleado_id: string
  fecha: string
  tipo: 'entrada' | 'salida'
  minutos_diferencia: number | null
}

// ── Presentismo CCT ─────────────────────────────────────────────────────────
// Regla: 0 ausencias Y (0 tardanzas O exactamente 1 tardanza ≤10min)
function calcularPresentismoAuto(
  empleado: Empleado,
  rangoFechas: string[],
  fichadas: Fichada[],
  cronograma: Cronograma[],
  hoyYmd: string,
): boolean {
  let ausencias = 0
  let tardanzasTotales = 0
  let tardanzasGraves = 0

  for (const fecha of rangoFechas) {
    if (fecha > hoyYmd) continue // ignorar días futuros
    const crono = cronograma.find((c) => c.empleado_id === empleado.id && c.fecha === fecha)
    if (!crono || !crono.publicado || crono.es_franco) continue

    const fs = fichadas.filter((f) => f.empleado_id === empleado.id && f.fecha === fecha)
    if (fs.length === 0) {
      ausencias++
      continue
    }

    const entrada = fs.find((f) => f.tipo === 'entrada')
    if (entrada && entrada.minutos_diferencia !== null && entrada.minutos_diferencia > 0) {
      tardanzasTotales++
      if (entrada.minutos_diferencia > 10) tardanzasGraves++
    }
  }

  if (ausencias > 0) return false
  if (tardanzasTotales === 0) return true
  if (tardanzasTotales === 1 && tardanzasGraves === 0) return true
  return false
}

// ════════════════════════════════════════════════════════════════════════════
export function SueldosTab() {
  const qc = useQueryClient()
  const hoy = new Date()
  const [year, setYear] = useState(hoy.getFullYear())
  const [month, setMonth] = useState(hoy.getMonth())
  const [quincena, setQuincena] = useState<Quincena>(hoy.getDate() <= 14 ? 'q1' : 'q2')
  const [filtroLocal, setFiltroLocal] = useState<FiltroLocal>('todos')
  const [busqueda, setBusqueda] = useState('')
  const [panel, setPanel] = useState<PanelEstado>(null)

  const periodoActual = useMemo(() => periodoQuincena(year, month, quincena), [year, month, quincena])
  const periodoQ1 = useMemo(() => periodoQuincena(year, month, 'q1'), [year, month])
  const periodoQ2 = useMemo(() => periodoQuincena(year, month, 'q2'), [year, month])
  const pMes = useMemo(() => periodoMes(year, month), [year, month])

  // Rango del mes completo (para fetch de fichadas/cronograma)
  const ultimoDia = ultimoDiaDelMes(year, month)
  const fechaDesdeMes = `${pMes}-01`
  const fechaHastaMes = `${pMes}-${String(ultimoDia).padStart(2, '0')}`

  const diasQuincenaActual = useMemo(() => diasDeQuincena(year, month, quincena), [year, month, quincena])
  const diasMes = useMemo(
    () => [...diasDeQuincena(year, month, 'q1'), ...diasDeQuincena(year, month, 'q2')],
    [year, month],
  )

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data: empleados } = useQuery({
    queryKey: ['empleados'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('empleados')
        .select('*')
        .eq('activo', true)
        .neq('estado_laboral', 'baja')
        .order('apellido')
      if (error) throw error
      return data as Empleado[]
    },
  })

  const { data: fichadas } = useQuery({
    queryKey: ['fichadas', fechaDesdeMes, fechaHastaMes],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fichadas')
        .select('id, empleado_id, fecha, tipo, minutos_diferencia')
        .gte('fecha', fechaDesdeMes)
        .lte('fecha', fechaHastaMes)
      if (error) throw error
      return data as Fichada[]
    },
  })

  const { data: cronograma } = useQuery({
    queryKey: ['cronograma', fechaDesdeMes, fechaHastaMes],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cronograma')
        .select('*')
        .gte('fecha', fechaDesdeMes)
        .lte('fecha', fechaHastaMes)
      if (error) throw error
      return data as Cronograma[]
    },
  })

  const { data: liquidaciones } = useQuery({
    queryKey: ['liquidaciones', periodoQ1, periodoQ2],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('liquidaciones_quincenales')
        .select('*')
        .in('periodo', [periodoQ1, periodoQ2])
      if (error) throw error
      return data as Liquidacion[]
    },
  })

  const { data: adelantos } = useQuery({
    queryKey: ['adelantos', periodoQ1, periodoQ2],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('adelantos')
        .select('*')
        .in('periodo', [periodoQ1, periodoQ2])
      if (error) throw error
      return data as Adelanto[]
    },
  })

  const { data: sanciones } = useQuery({
    queryKey: ['sanciones', periodoQ1, periodoQ2],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sanciones')
        .select('*')
        .in('periodo', [periodoQ1, periodoQ2])
      if (error) throw error
      return data as Sancion[]
    },
  })

  // ── Mutaciones ────────────────────────────────────────────────────────────
  const upsertLiquidacion = useMutation({
    mutationFn: async (payload: {
      empleado_id: string
      periodo: string
      patch: Partial<Liquidacion>
    }) => {
      const { error } = await supabase
        .from('liquidaciones_quincenales')
        .upsert(
          { empleado_id: payload.empleado_id, periodo: payload.periodo, ...payload.patch },
          { onConflict: 'empleado_id,periodo' },
        )
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['liquidaciones'] }),
    onError: (e: Error) => window.alert(`Error: ${e.message}`),
  })

  const updateModalidad = useMutation({
    mutationFn: async (payload: { id: string; modalidad: 'quincenal' | 'mensual' }) => {
      const { data, error } = await supabase
        .from('empleados')
        .update({ modalidad_cobro: payload.modalidad })
        .eq('id', payload.id)
        .select('id, modalidad_cobro')
      if (error) throw error
      if (!data || data.length === 0) {
        throw new Error('El update no afectó ninguna fila. Posible causa: RLS bloquea UPDATE en empleados, o la columna modalidad_cobro no existe todavía.')
      }
      if (data[0].modalidad_cobro !== payload.modalidad) {
        throw new Error(`El DB devolvió modalidad=${data[0].modalidad_cobro}, esperaba ${payload.modalidad}`)
      }
    },
    onMutate: async (payload) => {
      await qc.cancelQueries({ queryKey: ['empleados'] })
      const previo = qc.getQueryData<Empleado[]>(['empleados'])
      if (previo) {
        qc.setQueryData<Empleado[]>(
          ['empleados'],
          previo.map((e) => (e.id === payload.id ? { ...e, modalidad_cobro: payload.modalidad } : e)),
        )
      }
      return { previo }
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.previo) qc.setQueryData(['empleados'], ctx.previo)
      window.alert(`Error al cambiar modalidad: ${e.message}`)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['empleados'] }),
  })

  // ── Empleados filtrados ──────────────────────────────────────────────────
  const empleadosFiltrados = useMemo(() => {
    if (!empleados) return []
    return empleados.filter((e) => {
      if (filtroLocal === 'vedia' && e.local !== 'vedia' && e.local !== 'ambos') return false
      if (filtroLocal === 'saavedra' && e.local !== 'saavedra' && e.local !== 'ambos') return false
      if (filtroLocal === 'ambos' && e.local !== 'ambos') return false
      if (busqueda.trim()) {
        const q = normalizarTexto(busqueda)
        const txt = normalizarTexto(`${e.nombre} ${e.apellido} ${e.dni ?? ''}`)
        if (!txt.includes(q)) return false
      }
      return true
    })
  }, [empleados, filtroLocal, busqueda])

  // ── Filas calculadas ─────────────────────────────────────────────────────
  type Fila = {
    empleado: Empleado
    modalidad: 'quincenal' | 'mensual'
    esMensualEnQ1: boolean // mensual viendo Q1 → row atenuada, no cobra
    base: number
    liquidacion: Liquidacion | undefined
    presentismoAuto: boolean
    cobraPresentismo: boolean
    presentismoOverride: boolean
    deduccionPresentismo: number
    adelantosEmp: Adelanto[]
    sancionesEmp: Sancion[]
    adelantosMonto: number
    sancionesMonto: number
    total: number
    pagado: boolean
  }

  const hoyYmd = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`

  const filas: Fila[] = useMemo(() => {
    if (!empleadosFiltrados.length || !fichadas || !cronograma) return []

    return empleadosFiltrados.map((emp) => {
      const modalidad = (emp.modalidad_cobro ?? 'quincenal') as 'quincenal' | 'mensual'
      const esMensualEnQ1 = modalidad === 'mensual' && quincena === 'q1'
      const esMensualEnQ2 = modalidad === 'mensual' && quincena === 'q2'

      // Base
      let base = 0
      if (modalidad === 'quincenal') base = Number(emp.sueldo_neto) / 2
      else if (esMensualEnQ2) base = Number(emp.sueldo_neto)
      else base = 0

      // Presentismo: rango según modalidad
      const rangoPres =
        modalidad === 'quincenal'
          ? diasQuincenaActual
          : esMensualEnQ2
            ? diasMes
            : diasQuincenaActual // Q1 mensual: no aplica pero calculamos igual para mostrar
      const presentismoAuto = calcularPresentismoAuto(emp, rangoPres, fichadas, cronograma, hoyYmd)

      // Liquidación: siempre en la quincena actual
      const liquidacion = liquidaciones?.find(
        (l) => l.empleado_id === emp.id && l.periodo === periodoActual,
      )
      const cobraPresentismo =
        liquidacion && liquidacion.cobra_presentismo !== null
          ? liquidacion.cobra_presentismo
          : presentismoAuto
      const presentismoOverride = !!liquidacion && liquidacion.cobra_presentismo !== presentismoAuto

      const deduccionPresentismo = !cobraPresentismo && base > 0 ? (base * 10) / 110 : 0

      // Adelantos y sanciones
      // - quincenal: solo los del periodo actual
      // - mensual Q1: los del Q1 (se muestran pero no descuentan porque base=0)
      // - mensual Q2: los de todo el mes (Q1 + Q2)
      const periodosRelevantes = esMensualEnQ2 ? [periodoQ1, periodoQ2] : [periodoActual]
      const adelantosEmp =
        adelantos?.filter((a) => a.empleado_id === emp.id && periodosRelevantes.includes(a.periodo)) ?? []
      const sancionesEmp =
        sanciones?.filter((s) => s.empleado_id === emp.id && periodosRelevantes.includes(s.periodo)) ?? []
      const adelantosMonto = adelantosEmp.reduce((s, a) => s + Number(a.monto), 0)
      const sancionesMonto = sancionesEmp.reduce((s, a) => s + Number(a.monto), 0)

      const total = base - deduccionPresentismo - adelantosMonto - sancionesMonto

      return {
        empleado: emp,
        modalidad,
        esMensualEnQ1,
        base,
        liquidacion,
        presentismoAuto,
        cobraPresentismo,
        presentismoOverride,
        deduccionPresentismo,
        adelantosEmp,
        sancionesEmp,
        adelantosMonto,
        sancionesMonto,
        total,
        pagado: !!liquidacion?.pagado,
      }
    })
  }, [
    empleadosFiltrados,
    fichadas,
    cronograma,
    liquidaciones,
    adelantos,
    sanciones,
    quincena,
    periodoActual,
    periodoQ1,
    periodoQ2,
    diasQuincenaActual,
    diasMes,
    hoyYmd,
  ])

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const filasAPagar = filas.filter((f) => !f.esMensualEnQ1)
    const totalAPagar = filasAPagar.reduce((s, f) => s + f.total, 0)
    const totalAdelantos = filas.reduce((s, f) => s + f.adelantosMonto, 0)
    const totalSanciones = filas.reduce((s, f) => s + f.sancionesMonto, 0)
    const pagados = filasAPagar.filter((f) => f.pagado).length
    const totalEmpleados = filasAPagar.length
    return { totalAPagar, totalAdelantos, totalSanciones, pagados, totalEmpleados }
  }, [filas])

  // ── Navegación ───────────────────────────────────────────────────────────
  function navegarQuincena(delta: number) {
    if (delta > 0) {
      if (quincena === 'q1') setQuincena('q2')
      else {
        setQuincena('q1')
        if (month === 11) { setMonth(0); setYear(year + 1) } else setMonth(month + 1)
      }
    } else {
      if (quincena === 'q2') setQuincena('q1')
      else {
        setQuincena('q2')
        if (month === 0) { setMonth(11); setYear(year - 1) } else setMonth(month - 1)
      }
    }
  }

  // ── Panel abierto: data ──────────────────────────────────────────────────
  const panelData = useMemo(() => {
    if (!panel) return null
    const fila = filas.find((f) => f.empleado.id === panel.empleadoId)
    if (!fila) return null
    // Para mensuales en Q2 el panel muestra todo el mes → usa periodoMes como label,
    // pero al cargar un adelanto lo asigna al periodo ACTUAL (quincena visible).
    return { fila, periodo: periodoActual }
  }, [panel, filas, periodoActual])

  return (
    <div className="space-y-4">
      {/* ── Toolbar ───────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-lg border border-gray-200 p-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <button onClick={() => navegarQuincena(-1)} className="px-2 py-1 text-gray-500 hover:bg-gray-100 rounded">‹</button>
          <span className="text-sm font-medium text-gray-900 min-w-[180px] text-center">
            {MESES[month]} {year} · {quincena === 'q1' ? 'Q1 (1-14)' : `Q2 (15-${ultimoDia})`}
          </span>
          <button onClick={() => navegarQuincena(1)} className="px-2 py-1 text-gray-500 hover:bg-gray-100 rounded">›</button>
        </div>

        <select
          value={filtroLocal}
          onChange={(e) => setFiltroLocal(e.target.value as FiltroLocal)}
          className="border border-gray-300 rounded px-2 py-1 text-xs"
        >
          <option value="todos">Todos los locales</option>
          <option value="vedia">Vedia</option>
          <option value="saavedra">Saavedra</option>
          <option value="ambos">Ambos locales</option>
        </select>

        <input
          type="text"
          placeholder="Buscar empleado..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="border border-gray-300 rounded px-2 py-1 text-xs flex-1 min-w-[180px]"
        />
      </div>

      {/* ── KPIs ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiMini label="Total a pagar" value={formatARS(kpis.totalAPagar)} color="green" />
        <KpiMini label="Pagados" value={`${kpis.pagados} / ${kpis.totalEmpleados}`} color={kpis.pagados === kpis.totalEmpleados ? 'green' : 'amber'} />
        <KpiMini label="Adelantos" value={formatARS(kpis.totalAdelantos)} color="gray" />
        <KpiMini label="Sanciones" value={formatARS(kpis.totalSanciones)} color="red" />
      </div>

      {/* ── Tabla de liquidación ──────────────────────────────────────────── */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-[10px] uppercase text-gray-500 tracking-wide">
                <th className="text-left px-3 py-2 font-semibold">Empleado</th>
                <th className="text-left px-2 py-2 font-semibold">Local</th>
                <th className="text-right px-2 py-2 font-semibold">Base</th>
                <th className="text-center px-2 py-2 font-semibold">Presentismo</th>
                <th className="text-right px-2 py-2 font-semibold">Adelantos</th>
                <th className="text-right px-2 py-2 font-semibold">Sanciones</th>
                <th className="text-right px-2 py-2 font-semibold">Total</th>
                <th className="text-center px-2 py-2 font-semibold">Pagado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filas.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-xs text-gray-400">
                    {empleados ? 'Sin empleados para mostrar' : 'Cargando...'}
                  </td>
                </tr>
              )}
              {filas.map((fila) => (
                <FilaEmpleado
                  key={fila.empleado.id}
                  fila={fila}
                  onTogglePresentismo={(nuevo) =>
                    upsertLiquidacion.mutate({
                      empleado_id: fila.empleado.id,
                      periodo: periodoActual,
                      patch: { cobra_presentismo: nuevo },
                    })
                  }
                  onTogglePagado={(nuevo) =>
                    upsertLiquidacion.mutate({
                      empleado_id: fila.empleado.id,
                      periodo: periodoActual,
                      patch: {
                        pagado: nuevo,
                        fecha_pago: nuevo ? hoyYmd : null,
                      },
                    })
                  }
                  onCambiarModalidad={(nuevo) =>
                    updateModalidad.mutate({ id: fila.empleado.id, modalidad: nuevo })
                  }
                  onAbrirAdelantos={() =>
                    setPanel({ tipo: 'adelantos', empleadoId: fila.empleado.id })
                  }
                  onAbrirSanciones={() =>
                    setPanel({ tipo: 'sanciones', empleadoId: fila.empleado.id })
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Sección impuestos ─────────────────────────────────────────────── */}
      <SeccionImpuestos periodoMes={pMes} />

      {/* ── Paneles laterales ─────────────────────────────────────────────── */}
      {panel && panelData && panel.tipo === 'adelantos' && (
        <PanelAdelantos
          empleado={panelData.fila.empleado}
          periodo={panelData.periodo}
          adelantos={panelData.fila.adelantosEmp}
          onClose={() => setPanel(null)}
        />
      )}
      {panel && panelData && panel.tipo === 'sanciones' && (
        <PanelSanciones
          empleado={panelData.fila.empleado}
          periodo={panelData.periodo}
          sanciones={panelData.fila.sancionesEmp}
          onClose={() => setPanel(null)}
        />
      )}
    </div>
  )
}

// ─── Fila empleado ──────────────────────────────────────────────────────────
function FilaEmpleado({
  fila,
  onTogglePresentismo,
  onTogglePagado,
  onCambiarModalidad,
  onAbrirAdelantos,
  onAbrirSanciones,
}: {
  fila: {
    empleado: Empleado
    modalidad: 'quincenal' | 'mensual'
    esMensualEnQ1: boolean
    base: number
    presentismoAuto: boolean
    cobraPresentismo: boolean
    presentismoOverride: boolean
    deduccionPresentismo: number
    adelantosMonto: number
    sancionesMonto: number
    total: number
    pagado: boolean
  }
  onTogglePresentismo: (v: boolean) => void
  onTogglePagado: (v: boolean) => void
  onCambiarModalidad: (v: 'quincenal' | 'mensual') => void
  onAbrirAdelantos: () => void
  onAbrirSanciones: () => void
}) {
  const { empleado, modalidad, esMensualEnQ1, base, cobraPresentismo, presentismoOverride, deduccionPresentismo, adelantosMonto, sancionesMonto, total, pagado } = fila

  return (
    <tr className={cn('hover:bg-gray-50', esMensualEnQ1 && 'bg-gray-50/60 text-gray-500')}>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="min-w-0">
            <div className="font-medium text-gray-900 truncate">
              {empleado.apellido}, {empleado.nombre}
            </div>
            <div className="flex items-center gap-2 text-[10px] text-gray-500 mt-0.5">
              <span>{empleado.puesto}</span>
              <select
                value={modalidad}
                onChange={(e) => onCambiarModalidad(e.target.value as 'quincenal' | 'mensual')}
                className="text-[10px] border border-gray-300 bg-white text-rodziny-700 hover:border-rodziny-500 rounded px-1 py-0.5 cursor-pointer"
                title="Modalidad de cobro"
              >
                <option value="quincenal">Quincenal</option>
                <option value="mensual">Mensual</option>
              </select>
              {esMensualEnQ1 && (
                <span className="text-[9px] bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full">Cobra en Q2</span>
              )}
            </div>
          </div>
        </div>
      </td>
      <td className="px-2 py-2 text-xs capitalize text-gray-600">{empleado.local}</td>
      <td className="px-2 py-2 text-right tabular-nums text-gray-900">
        {esMensualEnQ1 ? '—' : formatARS(base)}
      </td>
      <td className="px-2 py-2 text-center">
        {esMensualEnQ1 ? (
          <span className="text-gray-300 text-xs">—</span>
        ) : (
          <label className="inline-flex items-center gap-1 cursor-pointer" title={presentismoOverride ? 'Modificado manualmente' : 'Automático según asistencia'}>
            <input
              type="checkbox"
              checked={cobraPresentismo}
              onChange={(e) => onTogglePresentismo(e.target.checked)}
              className="w-4 h-4"
            />
            {presentismoOverride && <span className="text-[10px] text-rodziny-700">🖊</span>}
            {!cobraPresentismo && (
              <span className="text-[10px] text-red-600">-{formatARS(deduccionPresentismo)}</span>
            )}
          </label>
        )}
      </td>
      <td className="px-2 py-2 text-right">
        <button
          onClick={onAbrirAdelantos}
          className={cn(
            'tabular-nums hover:underline text-xs',
            adelantosMonto > 0 ? 'text-amber-700 font-medium' : 'text-gray-400',
          )}
        >
          {adelantosMonto > 0 ? formatARS(adelantosMonto) : '+ agregar'}
        </button>
      </td>
      <td className="px-2 py-2 text-right">
        <button
          onClick={onAbrirSanciones}
          className={cn(
            'tabular-nums hover:underline text-xs',
            sancionesMonto > 0 ? 'text-red-700 font-medium' : 'text-gray-400',
          )}
        >
          {sancionesMonto > 0 ? formatARS(sancionesMonto) : '+ agregar'}
        </button>
      </td>
      <td className="px-2 py-2 text-right tabular-nums font-semibold text-gray-900">
        {esMensualEnQ1 ? <span className="text-gray-400 font-normal">—</span> : formatARS(total)}
      </td>
      <td className="px-2 py-2 text-center">
        {esMensualEnQ1 ? (
          <span className="text-gray-300 text-xs">—</span>
        ) : (
          <input
            type="checkbox"
            checked={pagado}
            onChange={(e) => onTogglePagado(e.target.checked)}
            className="w-4 h-4"
          />
        )}
      </td>
    </tr>
  )
}

// ─── KPI mini (mismo estilo que AsistenciaTab) ──────────────────────────────
function KpiMini({ label, value, color }: { label: string; value: string; color: 'gray' | 'green' | 'red' | 'amber' }) {
  const colorClass = {
    gray: 'text-gray-900',
    green: 'text-green-700',
    red: 'text-red-700',
    amber: 'text-amber-700',
  }[color]
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3">
      <p className="text-[10px] uppercase text-gray-500 font-medium tracking-wide">{label}</p>
      <p className={cn('text-2xl font-bold mt-1', colorClass)}>{value}</p>
    </div>
  )
}
