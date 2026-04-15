import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { Empleado } from './RRHHPage'
import {
  DIAS_SEMANA,
  diasDeQuincena,
  diffHoras,
  sumHorasTurnos,
  sumarDias,
  ymd,
  type Quincena,
  type TurnoCrono,
} from './utils'

type FiltroLocal = 'todos' | 'vedia' | 'saavedra' | 'ambos'

interface Cronograma {
  id: string
  empleado_id: string
  fecha: string           // YYYY-MM-DD
  hora_entrada: string | null
  hora_salida: string | null
  turnos: TurnoCrono[] | null
  es_franco: boolean
  publicado: boolean
  observaciones: string | null
}

// ── Componente principal ────────────────────────────────────────────────────
export function CronogramaTab() {
  const qc = useQueryClient()
  const hoy = new Date()
  const [year, setYear] = useState(hoy.getFullYear())
  const [month, setMonth] = useState(hoy.getMonth())   // 0-indexed
  const [quincena, setQuincena] = useState<Quincena>(hoy.getDate() <= 14 ? 'q1' : 'q2')
  const [filtroLocal, setFiltroLocal] = useState<FiltroLocal>('todos')
  const [filtroDia, setFiltroDia] = useState<number | null>(null)  // 0=Dom, 1=Lun...
  const [celdaAbierta, setCeldaAbierta] = useState<{ empleado: Empleado; fecha: string; existente: Cronograma | null } | null>(null)
  const [copiaAbierta, setCopiaAbierta] = useState<'quincena_anterior' | 'dia_a_dia' | null>(null)
  const [publicando, setPublicando] = useState(false)

  const dias = useMemo(() => diasDeQuincena(year, month, quincena), [year, month, quincena])
  const fechaDesde = dias[0]
  const fechaHasta = dias[dias.length - 1]

  // Empleados
  const { data: empleados } = useQuery({
    queryKey: ['empleados'],
    queryFn: async () => {
      const { data, error } = await supabase.from('empleados').select('*').eq('activo', true).neq('estado_laboral', 'baja').order('apellido')
      if (error) throw error
      return data as Empleado[]
    },
  })

  // Cronograma de la quincena visible
  const { data: cronograma } = useQuery({
    queryKey: ['cronograma', fechaDesde, fechaHasta],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cronograma')
        .select('*')
        .gte('fecha', fechaDesde)
        .lte('fecha', fechaHasta)
      if (error) throw error
      return data as Cronograma[]
    },
  })

  const empleadosFiltrados = useMemo(() => {
    let lista = empleados ?? []
    if (filtroLocal === 'vedia') lista = lista.filter((e) => e.local === 'vedia' || e.local === 'ambos')
    else if (filtroLocal === 'saavedra') lista = lista.filter((e) => e.local === 'saavedra' || e.local === 'ambos')
    else if (filtroLocal === 'ambos') lista = lista.filter((e) => e.local === 'ambos')
    return lista
  }, [empleados, filtroLocal])

  const diasMostrados = useMemo(() => {
    if (filtroDia === null) return dias
    return dias.filter((d) => new Date(d + 'T00:00:00').getDay() === filtroDia)
  }, [dias, filtroDia])

  // Lookup rápido: { 'empleado_id|fecha': Cronograma }
  const cronoMap = useMemo(() => {
    const m = new Map<string, Cronograma>()
    ;(cronograma ?? []).forEach((c) => m.set(`${c.empleado_id}|${c.fecha}`, c))
    return m
  }, [cronograma])

  // Horas asignadas por empleado en TODA la quincena (no solo días filtrados)
  const horasPorEmpleado = useMemo(() => {
    const map = new Map<string, number>()
    ;(cronograma ?? []).forEach((c) => {
      if (c.es_franco) return
      const h = sumHorasTurnos(c.turnos, c.hora_entrada, c.hora_salida)
      map.set(c.empleado_id, (map.get(c.empleado_id) ?? 0) + h)
    })
    return map
  }, [cronograma])

  // ¿Hay borradores en la quincena visible?
  const hayBorradores = useMemo(() => (cronograma ?? []).some((c) => !c.publicado), [cronograma])

  async function publicar() {
    if (!confirm('¿Publicar el cronograma de esta quincena? Los empleados podrán verlo.')) return
    setPublicando(true)
    try {
      const { error } = await supabase
        .from('cronograma')
        .update({ publicado: true, updated_at: new Date().toISOString() })
        .gte('fecha', fechaDesde)
        .lte('fecha', fechaHasta)
        .eq('publicado', false)
      if (error) throw error
      qc.invalidateQueries({ queryKey: ['cronograma'] })
    } catch (err: any) {
      alert('Error al publicar: ' + err.message)
    } finally {
      setPublicando(false)
    }
  }

  function navegarQuincena(delta: number) {
    if (quincena === 'q1') {
      if (delta > 0) setQuincena('q2')
      else {
        // ir a Q2 del mes anterior
        const m = month - 1
        if (m < 0) { setMonth(11); setYear(year - 1) } else setMonth(m)
        setQuincena('q2')
      }
    } else {
      if (delta < 0) setQuincena('q1')
      else {
        const m = month + 1
        if (m > 11) { setMonth(0); setYear(year + 1) } else setMonth(m)
        setQuincena('q1')
      }
    }
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="bg-white rounded-lg border border-surface-border p-3 flex flex-wrap gap-2 items-center">
        <button onClick={() => navegarQuincena(-1)} className="px-2 py-1 text-sm border rounded hover:bg-gray-50">◀</button>
        <div className="text-sm font-semibold text-gray-800 min-w-[170px] text-center">
          {new Date(year, month).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}
          {' · '}
          {quincena === 'q1' ? 'Q1 (1-14)' : 'Q2 (15-fin)'}
        </div>
        <button onClick={() => navegarQuincena(1)} className="px-2 py-1 text-sm border rounded hover:bg-gray-50">▶</button>

        <select value={filtroLocal} onChange={(e) => setFiltroLocal(e.target.value as FiltroLocal)} className="px-3 py-1.5 text-sm border border-gray-300 rounded-md">
          <option value="todos">Todos los locales</option>
          <option value="vedia">Vedia</option>
          <option value="saavedra">Saavedra</option>
          <option value="ambos">Ambos locales</option>
        </select>

        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500 mr-1">Día:</span>
          <button
            onClick={() => setFiltroDia(null)}
            className={cn('px-2 py-1 text-xs rounded', filtroDia === null ? 'bg-rodziny-100 text-rodziny-700 font-semibold' : 'text-gray-500 hover:bg-gray-100')}
          >Todos</button>
          {DIAS_SEMANA.map((d, i) => (
            <button
              key={d}
              onClick={() => setFiltroDia(filtroDia === i ? null : i)}
              className={cn('px-2 py-1 text-xs rounded', filtroDia === i ? 'bg-rodziny-100 text-rodziny-700 font-semibold' : 'text-gray-500 hover:bg-gray-100')}
            >{d}</button>
          ))}
        </div>

        <div className="ml-auto flex gap-2">
          <button onClick={() => setCopiaAbierta('quincena_anterior')} className="px-3 py-1.5 text-xs bg-white border border-gray-300 rounded-md hover:bg-gray-50">📋 Copiar quincena anterior</button>
          <button onClick={() => setCopiaAbierta('dia_a_dia')} className="px-3 py-1.5 text-xs bg-white border border-gray-300 rounded-md hover:bg-gray-50">📅 Copiar día → día</button>
          <button
            onClick={publicar}
            disabled={!hayBorradores || publicando}
            className="px-3 py-1.5 text-xs bg-rodziny-600 text-white rounded-md hover:bg-rodziny-700 disabled:opacity-50"
          >
            {publicando ? 'Publicando...' : hayBorradores ? '📤 Publicar' : '✅ Publicado'}
          </button>
        </div>
      </div>

      {/* Grilla */}
      <div className="bg-white rounded-lg border border-surface-border overflow-x-auto">
        <table className="text-xs w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-3 py-2 sticky left-0 bg-gray-50 z-10 min-w-[180px]">Empleado</th>
              {diasMostrados.map((fecha) => {
                const d = new Date(fecha + 'T00:00:00')
                return (
                  <th key={fecha} className="text-center px-2 py-2 min-w-[70px] border-l border-gray-100">
                    <div className="text-[10px] text-gray-400 uppercase">{DIAS_SEMANA[d.getDay()]}</div>
                    <div className="text-sm font-semibold text-gray-700">{d.getDate()}</div>
                  </th>
                )
              })}
              <th className="text-center px-3 py-2 border-l border-gray-200 min-w-[80px]">Horas</th>
            </tr>
          </thead>
          <tbody>
            {empleadosFiltrados.length === 0 && (
              <tr><td colSpan={diasMostrados.length + 2} className="text-center py-8 text-gray-400">No hay empleados activos en este filtro.</td></tr>
            )}
            {empleadosFiltrados.map((emp) => {
              const horasAsignadas = horasPorEmpleado.get(emp.id) ?? 0
              const horasRequeridas = emp.horario_tipo === 'flexible' ? (emp.horas_semanales_requeridas ?? 0) * 2 : 0  // *2 = quincena
              const cumpleHoras = emp.horario_tipo !== 'flexible' || horasRequeridas === 0 || horasAsignadas >= horasRequeridas
              return (
                <tr key={emp.id} className="border-t border-gray-100">
                  <td className="px-3 py-2 sticky left-0 bg-white z-10 border-r border-gray-100">
                    <div className="font-medium text-gray-800">{emp.apellido}, {emp.nombre}</div>
                    <div className="text-[10px] text-gray-400">
                      {emp.puesto} · {emp.horario_tipo === 'flexible' ? 'Flex' : 'Fijo'}
                    </div>
                  </td>
                  {diasMostrados.map((fecha) => {
                    const c = cronoMap.get(`${emp.id}|${fecha}`)
                    return (
                      <td
                        key={fecha}
                        onClick={() => setCeldaAbierta({ empleado: emp, fecha, existente: c ?? null })}
                        title={c?.observaciones ?? undefined}
                        className={cn(
                          'relative text-center px-1 py-2 border-l border-gray-100 cursor-pointer hover:bg-rodziny-50 align-middle',
                          c && !c.publicado && 'bg-yellow-50',
                          c?.es_franco && 'bg-blue-50 text-blue-700',
                        )}
                      >
                        {c?.observaciones && (
                          <span className="absolute top-0.5 right-0.5 text-[10px] text-amber-500" title={c.observaciones}>📝</span>
                        )}
                        {c?.es_franco ? (
                          <div className="text-base">🌴</div>
                        ) : c?.turnos && c.turnos.length > 0 ? (
                          <div className="text-[11px] font-medium text-gray-700 leading-tight space-y-0.5">
                            {c.turnos.map((t, i) => (
                              <div key={i} className={i > 0 ? 'pt-0.5 border-t border-gray-200' : ''}>
                                <div>{t.entrada.slice(0, 5)}</div>
                                <div className="text-gray-400">{t.salida.slice(0, 5)}</div>
                              </div>
                            ))}
                          </div>
                        ) : c?.hora_entrada && c?.hora_salida ? (
                          <div className="text-[11px] font-medium text-gray-700 leading-tight">
                            <div>{c.hora_entrada.slice(0, 5)}</div>
                            <div className="text-gray-400">{c.hora_salida.slice(0, 5)}</div>
                          </div>
                        ) : (
                          <div className="text-gray-300">—</div>
                        )}
                      </td>
                    )
                  })}
                  <td className="text-center px-2 py-2 border-l border-gray-200">
                    {emp.horario_tipo === 'flexible' ? (
                      <div className={cn('text-xs font-semibold', cumpleHoras ? 'text-green-700' : 'text-red-600')}>
                        {horasAsignadas.toFixed(0)}/{horasRequeridas}h
                      </div>
                    ) : (
                      <div className="text-xs text-gray-500">{horasAsignadas.toFixed(0)}h</div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-gray-500 flex gap-4 px-1">
        <span><span className="inline-block w-3 h-3 bg-yellow-50 border border-yellow-200 rounded mr-1"></span>Borrador (sin publicar)</span>
        <span><span className="inline-block w-3 h-3 bg-blue-50 border border-blue-200 rounded mr-1"></span>Franco</span>
        <span>Click en una celda para asignar / editar</span>
      </div>

      {celdaAbierta && (
        <ModalCelda
          {...celdaAbierta}
          onClose={() => setCeldaAbierta(null)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['cronograma'] }); setCeldaAbierta(null) }}
        />
      )}

      {copiaAbierta && (
        <ModalCopia
          modo={copiaAbierta}
          fechaDesde={fechaDesde}
          fechaHasta={fechaHasta}
          empleados={empleadosFiltrados}
          onClose={() => setCopiaAbierta(null)}
          onCopied={() => { qc.invalidateQueries({ queryKey: ['cronograma'] }); setCopiaAbierta(null) }}
        />
      )}
    </div>
  )
}

// ── Modal: asignar horario a una celda ──────────────────────────────────────
function ModalCelda({ empleado, fecha, existente, onClose, onSaved }: {
  empleado: Empleado
  fecha: string
  existente: Cronograma | null
  onClose: () => void
  onSaved: () => void
}) {
  const [esFranco, setEsFranco] = useState(existente?.es_franco ?? false)
  // Estado de turnos del día. Se inicializa desde turnos[] si existe, o
  // desde el par legacy, o con un turno por default 08:00-16:00.
  const [turnos, setTurnos] = useState<TurnoCrono[]>(() => {
    if (existente?.turnos && existente.turnos.length > 0) return existente.turnos
    if (existente?.hora_entrada && existente?.hora_salida) {
      return [{ entrada: existente.hora_entrada.slice(0, 5), salida: existente.hora_salida.slice(0, 5) }]
    }
    return [{ entrada: '08:00', salida: '16:00' }]
  })
  const [observaciones, setObservaciones] = useState(existente?.observaciones ?? '')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const horas = esFranco ? 0 : turnos.reduce((s, t) => s + diffHoras(t.entrada, t.salida), 0)

  function actualizarTurno(idx: number, campo: 'entrada' | 'salida', valor: string) {
    setTurnos((prev) => prev.map((t, i) => (i === idx ? { ...t, [campo]: valor } : t)))
  }
  function agregarTurno() {
    setTurnos((prev) => [...prev, { entrada: '20:00', salida: '00:00' }])
  }
  function quitarTurno(idx: number) {
    setTurnos((prev) => prev.filter((_, i) => i !== idx))
  }

  async function guardar() {
    setError(null)
    // Validación: al menos 1 turno con horas válidas, si no es franco
    if (!esFranco) {
      if (turnos.length === 0) { setError('Agregá al menos un turno.'); return }
      for (const t of turnos) {
        if (!t.entrada || !t.salida) { setError('Completá entrada y salida de todos los turnos.'); return }
      }
    }
    setGuardando(true)
    try {
      // Turnos ordenados por entrada para que hora_entrada sea la primera.
      const ordenados = [...turnos].sort((a, b) => a.entrada.localeCompare(b.entrada))
      const payload = {
        empleado_id: empleado.id,
        fecha,
        es_franco: esFranco,
        turnos: esFranco ? [] : ordenados,
        // Compat legacy: primera entrada y última salida del día
        hora_entrada: esFranco ? null : ordenados[0].entrada,
        hora_salida:  esFranco ? null : ordenados[ordenados.length - 1].salida,
        observaciones: observaciones.trim() || null,
        publicado: false,
        updated_at: new Date().toISOString(),
      }
      const { error } = await supabase
        .from('cronograma')
        .upsert(payload, { onConflict: 'empleado_id,fecha' })
      if (error) throw error
      onSaved()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setGuardando(false)
    }
  }

  async function eliminar() {
    if (!existente) return onClose()
    if (!confirm('¿Eliminar esta asignación?')) return
    setGuardando(true)
    try {
      const { error } = await supabase.from('cronograma').delete().eq('id', existente.id)
      if (error) throw error
      onSaved()
    } catch (err: any) {
      setError(err.message)
      setGuardando(false)
    }
  }

  const fechaLegible = new Date(fecha + 'T00:00:00').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900 text-sm">{empleado.apellido}, {empleado.nombre}</h3>
          <p className="text-xs text-gray-500 capitalize">{fechaLegible}</p>
        </div>
        <div className="px-5 py-4 space-y-3">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={esFranco} onChange={(e) => setEsFranco(e.target.checked)} />
            <span>🌴 Marcar como franco</span>
          </label>

          {!esFranco && (
            <div className="space-y-2">
              {turnos.map((t, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
                  <div>
                    {idx === 0 && <label className="block text-xs text-gray-600 mb-1">Hora entrada</label>}
                    <input
                      type="time"
                      value={t.entrada}
                      onChange={(e) => actualizarTurno(idx, 'entrada', e.target.value)}
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
                    />
                  </div>
                  <div>
                    {idx === 0 && <label className="block text-xs text-gray-600 mb-1">Hora salida</label>}
                    <input
                      type="time"
                      value={t.salida}
                      onChange={(e) => actualizarTurno(idx, 'salida', e.target.value)}
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
                    />
                  </div>
                  {turnos.length > 1 && (
                    <button
                      onClick={() => quitarTurno(idx)}
                      className="px-2 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded"
                      title="Quitar turno"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              <button
                onClick={agregarTurno}
                className="w-full px-3 py-1.5 text-xs border border-dashed border-gray-300 text-gray-600 rounded hover:bg-gray-50"
              >
                + Agregar otro turno (jornada partida)
              </button>
            </div>
          )}

          {!esFranco && (
            <div className="text-xs text-gray-500">Total: <span className="font-semibold text-gray-700">{horas.toFixed(1)} hs</span></div>
          )}

          <div>
            <label className="block text-xs text-gray-600 mb-1">Observaciones</label>
            <textarea
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              placeholder="Ej: cubre turno de Pedro, llega tarde avisado..."
              rows={2}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded resize-none"
            />
          </div>

          {error && <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</div>}
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex justify-between gap-2">
          <button onClick={eliminar} disabled={!existente || guardando} className="px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded disabled:opacity-30">Eliminar</button>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-xs border border-gray-300 rounded hover:bg-gray-50">Cancelar</button>
            <button onClick={guardar} disabled={guardando} className="px-3 py-1.5 text-xs bg-rodziny-600 text-white rounded hover:bg-rodziny-700 disabled:opacity-50">
              {guardando ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Modal: copiar cronograma ────────────────────────────────────────────────
function ModalCopia({ modo, fechaDesde, fechaHasta, empleados, onClose, onCopied }: {
  modo: 'quincena_anterior' | 'dia_a_dia'
  fechaDesde: string
  fechaHasta: string
  empleados: Empleado[]
  onClose: () => void
  onCopied: () => void
}) {
  const [diaOrigen, setDiaOrigen] = useState(fechaDesde)
  const [diaDestino, setDiaDestino] = useState(fechaDesde)
  const [seleccionados, setSeleccionados] = useState<Set<string>>(() => new Set(empleados.map((e) => e.id)))
  const [busqueda, setBusqueda] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const empleadosVistos = useMemo(() => {
    if (!busqueda.trim()) return empleados
    const q = busqueda.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    return empleados.filter((e) => `${e.nombre} ${e.apellido} ${e.puesto}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(q))
  }, [empleados, busqueda])

  function toggle(id: string) {
    setSeleccionados((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function todos() { setSeleccionados(new Set(empleados.map((e) => e.id))) }
  function ninguno() { setSeleccionados(new Set()) }

  async function ejecutar() {
    setError(null)
    if (seleccionados.size === 0) { setError('Seleccioná al menos un empleado.'); return }
    setTrabajando(true)
    try {
      const ids = Array.from(seleccionados)
      if (modo === 'dia_a_dia') {
        await copiarDiaADia(diaOrigen, diaDestino, ids)
      } else {
        const origenDesde = sumarDias(fechaDesde, -14)
        const origenHasta = sumarDias(fechaDesde, -1)
        await copiarRango(origenDesde, origenHasta, fechaDesde, ids)
      }
      onCopied()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setTrabajando(false)
    }
  }

  async function copiarRango(origDesde: string, origHasta: string, destDesde: string, ids: string[]) {
    const { data, error } = await supabase
      .from('cronograma')
      .select('*')
      .gte('fecha', origDesde)
      .lte('fecha', origHasta)
      .in('empleado_id', ids)
    if (error) throw error
    if (!data || data.length === 0) throw new Error('No hay cronograma en el rango origen para los empleados seleccionados.')

    const [oy, om, od] = origDesde.split('-').map(Number)
    const [dy, dm, dd] = destDesde.split('-').map(Number)
    const offsetMs = new Date(dy, dm - 1, dd).getTime() - new Date(oy, om - 1, od).getTime()
    const offsetDias = Math.round(offsetMs / (1000 * 60 * 60 * 24))

    const nuevos = data.map((c) => ({
      empleado_id: c.empleado_id,
      fecha: sumarDias(c.fecha, offsetDias),
      hora_entrada: c.hora_entrada,
      hora_salida: c.hora_salida,
      turnos: c.turnos ?? [],
      es_franco: c.es_franco,
      publicado: false,
    }))
    const { error: errIns } = await supabase.from('cronograma').upsert(nuevos, { onConflict: 'empleado_id,fecha' })
    if (errIns) throw errIns
  }

  async function copiarDiaADia(origen: string, destino: string, ids: string[]) {
    const { data, error } = await supabase.from('cronograma').select('*').eq('fecha', origen).in('empleado_id', ids)
    if (error) throw error
    if (!data || data.length === 0) throw new Error('No hay cronograma en el día origen para los empleados seleccionados.')
    const nuevos = data.map((c) => ({
      empleado_id: c.empleado_id,
      fecha: destino,
      hora_entrada: c.hora_entrada,
      hora_salida: c.hora_salida,
      turnos: c.turnos ?? [],
      es_franco: c.es_franco,
      publicado: false,
    }))
    const { error: errIns } = await supabase.from('cronograma').upsert(nuevos, { onConflict: 'empleado_id,fecha' })
    if (errIns) throw errIns
  }

  const titulos = {
    quincena_anterior: 'Copiar quincena anterior',
    dia_a_dia: 'Copiar día → día',
  }

  const descripciones = {
    quincena_anterior: `Copia los 14 días anteriores (${sumarDias(fechaDesde, -14)} a ${sumarDias(fechaDesde, -1)}) al rango actual (${fechaDesde} a ${fechaHasta}).`,
    dia_a_dia: 'Elegí un día origen y un día destino. Se copian las asignaciones de ese día.',
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900 text-sm">{titulos[modo]}</h3>
        </div>
        <div className="px-5 py-4 space-y-3 overflow-y-auto">
          <p className="text-xs text-gray-600">{descripciones[modo]}</p>

          {modo === 'dia_a_dia' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Día origen</label>
                <input type="date" value={diaOrigen} onChange={(e) => setDiaOrigen(e.target.value)} className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded" />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Día destino</label>
                <input type="date" value={diaDestino} onChange={(e) => setDiaDestino(e.target.value)} className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded" />
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-700">Empleados a copiar ({seleccionados.size}/{empleados.length})</label>
              <div className="flex gap-1 text-[10px]">
                <button onClick={todos} className="px-2 py-0.5 border border-gray-300 rounded hover:bg-gray-50">Todos</button>
                <button onClick={ninguno} className="px-2 py-0.5 border border-gray-300 rounded hover:bg-gray-50">Ninguno</button>
              </div>
            </div>
            <input
              type="text"
              placeholder="Buscar empleado..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded mb-2"
            />
            <div className="max-h-56 overflow-y-auto border border-gray-200 rounded">
              {empleadosVistos.length === 0 && (
                <div className="text-center text-xs text-gray-400 py-4">Sin resultados</div>
              )}
              {empleadosVistos.map((e) => (
                <label key={e.id} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-50 cursor-pointer border-b border-gray-50 last:border-0">
                  <input type="checkbox" checked={seleccionados.has(e.id)} onChange={() => toggle(e.id)} />
                  <span className="font-medium text-gray-700">{e.apellido}, {e.nombre}</span>
                  <span className="text-gray-400">— {e.puesto}</span>
                  <span className="ml-auto text-[10px] text-gray-400 capitalize">{e.local}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="text-xs text-yellow-700 bg-yellow-50 border border-yellow-100 rounded p-2">
            ⚠ Si ya hay asignaciones en el destino para los empleados seleccionados, se sobrescriben.
          </div>
          {error && <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</div>}
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs border border-gray-300 rounded hover:bg-gray-50">Cancelar</button>
          <button onClick={ejecutar} disabled={trabajando || seleccionados.size === 0} className="px-3 py-1.5 text-xs bg-rodziny-600 text-white rounded hover:bg-rodziny-700 disabled:opacity-50">
            {trabajando ? 'Copiando...' : `Copiar (${seleccionados.size})`}
          </button>
        </div>
      </div>
    </div>
  )
}
