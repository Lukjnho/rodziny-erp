import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Empleado } from './RRHHPage'
import { MESES, ymd, diffHoras } from './utils'

type PeriodoTipo = 'mes' | 'quincena'
type Quincena = 'q1' | 'q2'
type FiltroLocal = 'todos' | 'vedia' | 'saavedra'

interface Cronograma {
  empleado_id: string
  fecha: string
  hora_entrada: string | null
  hora_salida: string | null
  es_franco: boolean
  publicado: boolean
}

interface Fichada {
  empleado_id: string
  fecha: string
  tipo: 'entrada' | 'salida'
  timestamp: string
  minutos_diferencia: number | null
}

interface Stats {
  empleado: Empleado
  diasProgramados: number
  diasFichados: number
  ausencias: number
  tardanzasTotal: number
  porcentajePuntual: number
  horasProgramadas: number
  horasTrabajadas: number
  horasExtras: number
  rachaActual: number
}

const TOLERANCIA_TARDANZA = 10 // minutos

export function EvaluacionesTab() {
  const hoy = new Date()
  const [year, setYear] = useState(hoy.getFullYear())
  const [month, setMonth] = useState(hoy.getMonth())
  const [periodoTipo, setPeriodoTipo] = useState<PeriodoTipo>('mes')
  const [quincena, setQuincena] = useState<Quincena>(hoy.getDate() <= 14 ? 'q1' : 'q2')
  const [filtroLocal, setFiltroLocal] = useState<FiltroLocal>('todos')

  // Rango de fechas del período
  const { fechaDesde, fechaHasta, labelPeriodo } = useMemo(() => {
    const ultimoDia = new Date(year, month + 1, 0).getDate()
    if (periodoTipo === 'mes') {
      return {
        fechaDesde: ymd(new Date(year, month, 1)),
        fechaHasta: ymd(new Date(year, month, ultimoDia)),
        labelPeriodo: `${MESES[month]} ${year}`,
      }
    }
    const d = quincena === 'q1' ? 1 : 15
    const h = quincena === 'q1' ? 14 : ultimoDia
    return {
      fechaDesde: ymd(new Date(year, month, d)),
      fechaHasta: ymd(new Date(year, month, h)),
      labelPeriodo: `${MESES[month]} ${year} · ${quincena === 'q1' ? 'Q1 (1-14)' : `Q2 (15-${ultimoDia})`}`,
    }
  }, [year, month, periodoTipo, quincena])

  // Rango extendido para calcular racha (60 días atrás desde hoy)
  const fechaRachaDesde = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() - 60)
    return ymd(d)
  }, [])
  const hoyYmd = useMemo(() => ymd(new Date()), [])

  const { data: empleados } = useQuery({
    queryKey: ['empleados'],
    queryFn: async () => {
      const { data, error } = await supabase.from('empleados').select('*').order('apellido')
      if (error) throw error
      return data as Empleado[]
    },
  })

  const { data: cronograma } = useQuery({
    queryKey: ['cronograma-eval', fechaDesde, fechaHasta, fechaRachaDesde],
    queryFn: async () => {
      const desde = fechaDesde < fechaRachaDesde ? fechaDesde : fechaRachaDesde
      const hasta = fechaHasta > hoyYmd ? fechaHasta : hoyYmd
      const { data, error } = await supabase
        .from('cronograma')
        .select('empleado_id, fecha, hora_entrada, hora_salida, es_franco, publicado')
        .gte('fecha', desde)
        .lte('fecha', hasta)
      if (error) throw error
      return data as Cronograma[]
    },
  })

  const { data: fichadas } = useQuery({
    queryKey: ['fichadas-eval', fechaDesde, fechaHasta, fechaRachaDesde],
    queryFn: async () => {
      const desde = fechaDesde < fechaRachaDesde ? fechaDesde : fechaRachaDesde
      const hasta = fechaHasta > hoyYmd ? fechaHasta : hoyYmd
      const { data, error } = await supabase
        .from('fichadas')
        .select('empleado_id, fecha, tipo, timestamp, minutos_diferencia')
        .gte('fecha', desde)
        .lte('fecha', hasta)
      if (error) throw error
      return data as Fichada[]
    },
  })

  const cargando = !empleados || !cronograma || !fichadas

  const stats = useMemo<Stats[]>(() => {
    if (!empleados || !cronograma || !fichadas) return []
    const activos = empleados.filter((e) => e.activo && e.estado_laboral !== 'baja')
    const filtrados = activos.filter((e) => {
      if (filtroLocal === 'todos') return true
      if (filtroLocal === 'vedia') return e.local === 'vedia' || e.local === 'ambos'
      if (filtroLocal === 'saavedra') return e.local === 'saavedra' || e.local === 'ambos'
      return true
    })

    return filtrados.map((emp) => {
      // Cronograma del período
      const cronoPeriodo = cronograma.filter(
        (c) => c.empleado_id === emp.id && c.fecha >= fechaDesde && c.fecha <= fechaHasta,
      )
      const cronoProgramados = cronoPeriodo.filter((c) => c.publicado && !c.es_franco && c.hora_entrada)
      const diasProgramados = cronoProgramados.length

      // Fichadas del período (solo entradas cuentan para asistencia)
      const fichadasPeriodo = fichadas.filter(
        (f) => f.empleado_id === emp.id && f.fecha >= fechaDesde && f.fecha <= fechaHasta,
      )
      const diasFichadosSet = new Set(fichadasPeriodo.filter((f) => f.tipo === 'entrada').map((f) => f.fecha))

      // Ausencias: días programados sin fichada de entrada
      let ausencias = 0
      let tardanzasTotal = 0
      let puntualesTotal = 0
      let horasProgramadas = 0
      let horasTrabajadas = 0

      for (const c of cronoProgramados) {
        horasProgramadas += diffHoras(c.hora_entrada, c.hora_salida)
        if (!diasFichadosSet.has(c.fecha)) {
          ausencias++
          continue
        }
        // Chequear puntualidad por entrada del día
        const entrada = fichadasPeriodo.find((f) => f.fecha === c.fecha && f.tipo === 'entrada')
        if (entrada && entrada.minutos_diferencia !== null) {
          if (entrada.minutos_diferencia > TOLERANCIA_TARDANZA) tardanzasTotal++
          else puntualesTotal++
        } else if (entrada) {
          puntualesTotal++
        }
        // Horas trabajadas: calcular por entrada y salida del día
        const salida = fichadasPeriodo.find((f) => f.fecha === c.fecha && f.tipo === 'salida')
        if (entrada && salida) {
          const tIn = new Date(entrada.timestamp)
          const tOut = new Date(salida.timestamp)
          horasTrabajadas += Math.max(0, (tOut.getTime() - tIn.getTime()) / 3600000)
        }
      }

      const totalPuntualidad = tardanzasTotal + puntualesTotal
      const porcentajePuntual = totalPuntualidad > 0 ? Math.round((puntualesTotal / totalPuntualidad) * 100) : 0

      // Racha actual: días consecutivos sin ausencia (desde ayer hacia atrás, hoy no cuenta)
      let rachaActual = 0
      const hoyDate = new Date()
      for (let i = 1; i <= 60; i++) {
        const d = new Date(hoyDate)
        d.setDate(hoyDate.getDate() - i)
        const diaYmd = ymd(d)
        const cronoDia = cronograma.find(
          (c) => c.empleado_id === emp.id && c.fecha === diaYmd && c.publicado,
        )
        if (!cronoDia || cronoDia.es_franco || !cronoDia.hora_entrada) continue // no programado, no rompe racha
        const fichoDia = fichadas.some(
          (f) => f.empleado_id === emp.id && f.fecha === diaYmd && f.tipo === 'entrada',
        )
        if (fichoDia) rachaActual++
        else break
      }

      const horasExtras = Math.max(0, horasTrabajadas - horasProgramadas)

      return {
        empleado: emp,
        diasProgramados,
        diasFichados: diasFichadosSet.size,
        ausencias,
        tardanzasTotal,
        porcentajePuntual,
        horasProgramadas: Math.round(horasProgramadas * 10) / 10,
        horasTrabajadas: Math.round(horasTrabajadas * 10) / 10,
        horasExtras: Math.round(horasExtras * 10) / 10,
        rachaActual,
      }
    })
  }, [empleados, cronograma, fichadas, fechaDesde, fechaHasta, filtroLocal])

  // Filtrar por cantidad mínima de días para rankings del período
  const statsConDatos = stats.filter((s) => s.diasProgramados >= 5)

  // Rankings
  const topAsistenciaPerfecta = [...statsConDatos]
    .filter((s) => s.ausencias === 0)
    .sort((a, b) => b.diasProgramados - a.diasProgramados)
    .slice(0, 10)

  const topPuntualidad = [...statsConDatos]
    .sort((a, b) => b.porcentajePuntual - a.porcentajePuntual || b.diasProgramados - a.diasProgramados)
    .slice(0, 10)

  const topRacha = [...stats]
    .filter((s) => s.rachaActual > 0)
    .sort((a, b) => b.rachaActual - a.rachaActual)
    .slice(0, 10)

  const topHorasExtras = [...statsConDatos]
    .filter((s) => s.horasExtras > 0)
    .sort((a, b) => b.horasExtras - a.horasExtras)
    .slice(0, 10)

  function navegar(delta: number) {
    if (periodoTipo === 'mes') {
      let nm = month + delta
      let ny = year
      if (nm < 0) { nm = 11; ny-- }
      if (nm > 11) { nm = 0; ny++ }
      setMonth(nm); setYear(ny)
    } else {
      if (delta > 0) {
        if (quincena === 'q1') setQuincena('q2')
        else { setQuincena('q1'); navegarMes(1) }
      } else {
        if (quincena === 'q2') setQuincena('q1')
        else { setQuincena('q2'); navegarMes(-1) }
      }
    }
  }
  function navegarMes(delta: number) {
    let nm = month + delta
    let ny = year
    if (nm < 0) { nm = 11; ny-- }
    if (nm > 11) { nm = 0; ny++ }
    setMonth(nm); setYear(ny)
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="bg-white rounded-lg border border-surface-border p-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 text-sm">
          <select
            value={periodoTipo}
            onChange={(e) => setPeriodoTipo(e.target.value as PeriodoTipo)}
            className="px-3 py-1.5 border border-gray-300 rounded-md text-sm"
          >
            <option value="mes">Mensual</option>
            <option value="quincena">Quincenal</option>
          </select>
        </div>

        <div className="flex items-center gap-1">
          <button onClick={() => navegar(-1)} className="w-8 h-8 rounded border border-gray-300 hover:bg-gray-50">‹</button>
          <div className="px-3 py-1.5 text-sm font-medium text-gray-700 min-w-[200px] text-center">
            {labelPeriodo}
          </div>
          <button onClick={() => navegar(1)} className="w-8 h-8 rounded border border-gray-300 hover:bg-gray-50">›</button>
        </div>

        <select
          value={filtroLocal}
          onChange={(e) => setFiltroLocal(e.target.value as FiltroLocal)}
          className="px-3 py-1.5 border border-gray-300 rounded-md text-sm"
        >
          <option value="todos">Todos los locales</option>
          <option value="vedia">Vedia</option>
          <option value="saavedra">Saavedra</option>
        </select>

        <div className="ml-auto text-xs text-gray-500">
          {statsConDatos.length} empleado{statsConDatos.length !== 1 ? 's' : ''} con datos suficientes
        </div>
      </div>

      {cargando ? (
        <div className="bg-white rounded-lg border border-surface-border p-12 text-center text-gray-400">
          Calculando rankings…
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <RankingCard
            titulo="🏆 Asistencia perfecta"
            subtitulo="Cero ausencias en el período"
            items={topAsistenciaPerfecta}
            vacio="Nadie con asistencia perfecta aún"
            render={(s) => ({
              metrica: `${s.diasProgramados} días`,
              detalle: `${s.tardanzasTotal} tardanzas`,
            })}
          />

          <RankingCard
            titulo="⏰ Puntualidad"
            subtitulo="% fichadas dentro de los 10 min del horario"
            items={topPuntualidad}
            vacio="Sin datos de puntualidad"
            render={(s) => ({
              metrica: `${s.porcentajePuntual}%`,
              detalle: `${s.tardanzasTotal} tardanzas de ${s.diasProgramados - s.ausencias}`,
            })}
          />

          <RankingCard
            titulo="🔥 Racha actual"
            subtitulo="Días consecutivos sin faltar (desde hoy hacia atrás)"
            items={topRacha}
            vacio="Sin rachas activas"
            render={(s) => ({
              metrica: `${s.rachaActual} día${s.rachaActual !== 1 ? 's' : ''}`,
              detalle: '',
            })}
          />

          <RankingCard
            titulo="⚡ Horas extras"
            subtitulo="Horas trabajadas por encima del cronograma"
            items={topHorasExtras}
            vacio="Sin horas extras registradas en el período"
            render={(s) => ({
              metrica: `+${s.horasExtras}h`,
              detalle: `${s.horasTrabajadas}h trabajadas de ${s.horasProgramadas}h`,
            })}
          />
        </div>
      )}
    </div>
  )
}

function RankingCard({
  titulo,
  subtitulo,
  items,
  vacio,
  render,
}: {
  titulo: string
  subtitulo: string
  items: Stats[]
  vacio: string
  render: (s: Stats) => { metrica: string; detalle: string }
}) {
  const medallas = ['🥇', '🥈', '🥉']
  return (
    <div className="bg-white rounded-lg border border-surface-border overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <h3 className="font-semibold text-gray-900 text-sm">{titulo}</h3>
        <p className="text-xs text-gray-500 mt-0.5">{subtitulo}</p>
      </div>
      <div className="divide-y divide-gray-50">
        {items.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-gray-400">{vacio}</div>
        ) : (
          items.map((s, i) => {
            const r = render(s)
            return (
              <div key={s.empleado.id} className="px-4 py-2.5 flex items-center gap-3 hover:bg-gray-50">
                <div className="w-7 text-center text-lg">
                  {i < 3 ? medallas[i] : <span className="text-xs text-gray-400 font-semibold">#{i + 1}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">
                    {s.empleado.apellido}, {s.empleado.nombre}
                  </div>
                  <div className="text-[11px] text-gray-400 capitalize">
                    {s.empleado.puesto} · {s.empleado.local}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-rodziny-700">{r.metrica}</div>
                  {r.detalle && <div className="text-[10px] text-gray-400">{r.detalle}</div>}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
