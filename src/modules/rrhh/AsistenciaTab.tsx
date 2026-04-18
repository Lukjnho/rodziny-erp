import { useState, useMemo, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { Empleado } from './RRHHPage'
import {
  TOLERANCIA_MIN,
  MESES,
  diasDeQuincena,
  diffMinutosVsHorario,
  etiquetaDia,
  normalizarTexto,
  parseYmd,
  ultimoDiaDelMes,
  ymd,
  type Quincena,
} from './utils'

type FiltroLocal = 'todos' | 'vedia' | 'saavedra' | 'ambos'
type FiltroEstado = 'todos' | 'completas' | 'ausencias' | 'tardanzas' | 'incompletas'

type EstadoEmpleadoDia = 'completa' | 'incompleta' | 'en_turno' | 'ausente' | 'franco' | 'sin_turno'

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
  timestamp: string
  local: string
  lat: number | null
  lng: number | null
  foto_path: string | null
  minutos_diferencia: number | null
  origen: 'pwa' | 'manual' | 'biometrico'
  observaciones: string | null
}

// ── Componente principal ────────────────────────────────────────────────────
export function AsistenciaTab() {
  const qc = useQueryClient()
  const hoy = new Date()
  const [year, setYear] = useState(hoy.getFullYear())
  const [month, setMonth] = useState(hoy.getMonth())
  const [quincena, setQuincena] = useState<Quincena>(hoy.getDate() <= 14 ? 'q1' : 'q2')
  const [filtroLocal, setFiltroLocal] = useState<FiltroLocal>('todos')
  const [busqueda, setBusqueda] = useState('')
  const [diaExpandido, setDiaExpandido] = useState<string | null>(ymd(hoy))
  const [modalManualAbierto, setModalManualAbierto] = useState(false)
  const [menuAbierto, setMenuAbierto] = useState(false)
  const [limpiando, setLimpiando] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>('todos')
  const menuRef = useRef<HTMLDivElement>(null)

  // Cierra el menú al hacer click fuera
  useEffect(() => {
    if (!menuAbierto) return
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuAbierto(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [menuAbierto])

  async function limpiarFotosViejas() {
    if (limpiando) return
    const ok = window.confirm(
      '¿Borrar fotos de fichadas con más de 30 días?\n\nLas fichadas se conservan, solo se eliminan las imágenes del bucket.',
    )
    if (!ok) return
    setLimpiando(true)
    setMenuAbierto(false)
    try {
      const { data, error } = await supabase.functions.invoke('cleanup-fichadas-fotos')
      if (error) throw error
      const r = data as { ok: boolean; borradas: number; total_candidatas: number; errores: string[] }
      if (r.ok) {
        window.alert(`✓ Limpieza completada\n\nFotos borradas: ${r.borradas} de ${r.total_candidatas}`)
      } else {
        window.alert(`Limpieza con errores:\n${r.errores.join('\n')}`)
      }
      qc.invalidateQueries({ queryKey: ['fichadas'] })
    } catch (e) {
      window.alert(`Error al limpiar fotos: ${(e as Error).message}`)
    } finally {
      setLimpiando(false)
    }
  }

  const dias = useMemo(() => diasDeQuincena(year, month, quincena), [year, month, quincena])
  const fechaDesde = dias[0]
  const fechaHasta = dias[dias.length - 1]

  // ── Datos ────────────────────────────────────────────────────────────────
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
    queryKey: ['fichadas', fechaDesde, fechaHasta],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fichadas')
        .select('*')
        .gte('fecha', fechaDesde)
        .lte('fecha', fechaHasta)
        .order('timestamp')
      if (error) throw error
      return data as Fichada[]
    },
  })

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

  const empleadoIdsFiltrados = useMemo(() => new Set(empleadosFiltrados.map((e) => e.id)), [empleadosFiltrados])
  const empleadosMap = useMemo(() => {
    const m = new Map<string, Empleado>()
    empleadosFiltrados.forEach((e) => m.set(e.id, e))
    return m
  }, [empleadosFiltrados])

  // ── Datos cruzados por día ───────────────────────────────────────────────
  type DiaResumen = {
    fecha: string
    fichadasDelDia: Fichada[]
    cronoDelDia: Cronograma[]
    completos: number
    enTurno: number
    incompletos: number
    ausencias: number
    tardanzas: number
    francos: number
    sinTurno: number
    nombresAnomalias: string[]
  }

  const resumenPorDia: DiaResumen[] = useMemo(() => {
    if (!fichadas || !cronograma) return []
    const hoyYmd = ymd(new Date())

    return dias.map((fecha) => {
      const fichadasDelDia = fichadas.filter((f) => f.fecha === fecha && empleadoIdsFiltrados.has(f.empleado_id))
      const cronoDelDia = cronograma.filter((c) => c.fecha === fecha && empleadoIdsFiltrados.has(c.empleado_id))

      let completos = 0
      let incompletos = 0
      let enTurno = 0
      let ausencias = 0
      let tardanzas = 0
      let francos = 0
      const sinTurno = fichadasDelDia.length > 0
        ? new Set(fichadasDelDia.map((f) => f.empleado_id)).size -
          new Set(cronoDelDia.filter((c) => !c.es_franco).map((c) => c.empleado_id)).size
        : 0
      const nombresAnomalias: string[] = []

      // Por cada empleado del filtro, calcular su estado
      empleadosFiltrados.forEach((emp) => {
        const c = cronoDelDia.find((x) => x.empleado_id === emp.id)
        const fs = fichadasDelDia.filter((x) => x.empleado_id === emp.id)
        if (c?.es_franco) {
          francos++
          return
        }
        if (!c?.publicado) return // sin turno publicado, no cuenta

        if (fs.length === 0) {
          // Solo cuenta ausencia si la fecha ya pasó (o es hoy)
          if (fecha <= hoyYmd) {
            ausencias++
            nombresAnomalias.push(`${emp.nombre} ${emp.apellido} (ausente)`)
          }
          return
        }

        const tieneEntrada = fs.some((f) => f.tipo === 'entrada')
        const tieneSalida = fs.some((f) => f.tipo === 'salida')
        if (tieneEntrada && tieneSalida && fs.length % 2 === 0) {
          completos++
        } else if (tieneEntrada && !tieneSalida && fecha === hoyYmd) {
          // Hoy y tiene entrada sin salida → está trabajando
          enTurno++
        } else {
          incompletos++
          nombresAnomalias.push(`${emp.nombre} ${emp.apellido} (incompleto)`)
        }

        // Tardanzas: entrada con minutos_diferencia > tolerancia
        const tardo = fs.some(
          (f) => f.tipo === 'entrada' && f.minutos_diferencia !== null && f.minutos_diferencia > TOLERANCIA_MIN
        )
        if (tardo) tardanzas++
      })

      return {
        fecha,
        fichadasDelDia,
        cronoDelDia,
        completos,
        enTurno,
        incompletos,
        ausencias,
        tardanzas,
        francos,
        sinTurno: Math.max(0, sinTurno),
        nombresAnomalias,
      }
    })
  }, [dias, fichadas, cronograma, empleadosFiltrados, empleadoIdsFiltrados])

  // ── KPIs de la quincena ──────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const totalFichajes = resumenPorDia.reduce((s, d) => s + d.fichadasDelDia.length, 0)
    const totalCompletos = resumenPorDia.reduce((s, d) => s + d.completos, 0)
    const totalAusencias = resumenPorDia.reduce((s, d) => s + d.ausencias, 0)
    const totalTardanzas = resumenPorDia.reduce((s, d) => s + d.tardanzas, 0)
    return { totalFichajes, totalCompletos, totalAusencias, totalTardanzas }
  }, [resumenPorDia])

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

  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ['fichadas'] })
    qc.invalidateQueries({ queryKey: ['cronograma'] })
  }

  return (
    <div className="space-y-4">
      {/* ── Toolbar ───────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-lg border border-gray-200 p-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <button onClick={() => navegarQuincena(-1)} className="px-2 py-1 text-gray-500 hover:bg-gray-100 rounded">‹</button>
          <span className="text-sm font-medium text-gray-900 min-w-[160px] text-center">
            {MESES[month]} {year} · {quincena === 'q1' ? 'Q1 (1-14)' : `Q2 (15-${ultimoDiaDelMes(year, month)})`}
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

        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setModalManualAbierto(true)}
            className="bg-rodziny-700 hover:bg-rodziny-800 text-white px-3 py-1.5 rounded text-xs font-medium"
          >
            + Fichaje manual
          </button>
          <div ref={menuRef} className="relative">
            <button
              onClick={() => setMenuAbierto((v) => !v)}
              className="px-2 py-1.5 text-gray-500 hover:bg-gray-100 rounded text-base leading-none"
              title="Más opciones"
            >
              ⋯
            </button>
            {menuAbierto && (
              <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-gray-200 rounded-md shadow-lg z-10 py-1">
                <button
                  onClick={limpiarFotosViejas}
                  disabled={limpiando}
                  className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {limpiando ? 'Limpiando…' : 'Limpiar fotos +30 días'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── KPIs ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiMini label="Fichajes" value={kpis.totalFichajes} color="gray"
          activo={false} onClick={() => {}} />
        <KpiMini label="Asistencias completas" value={kpis.totalCompletos} color="green"
          activo={filtroEstado === 'completas'}
          onClick={() => setFiltroEstado(filtroEstado === 'completas' ? 'todos' : 'completas')} />
        <KpiMini label="Ausencias" value={kpis.totalAusencias} color="red"
          activo={filtroEstado === 'ausencias'}
          onClick={() => setFiltroEstado(filtroEstado === 'ausencias' ? 'todos' : 'ausencias')} />
        <KpiMini label="Tardanzas" value={kpis.totalTardanzas} color="amber"
          activo={filtroEstado === 'tardanzas'}
          onClick={() => setFiltroEstado(filtroEstado === 'tardanzas' ? 'todos' : 'tardanzas')} />
      </div>

      {/* ── Lista de días ─────────────────────────────────────────────────── */}
      <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
        {[...resumenPorDia].reverse().map((d) => {
          const expandido = diaExpandido === d.fecha
          const tieneActividad = d.fichadasDelDia.length > 0 || d.ausencias > 0 || d.incompletos > 0 || d.enTurno > 0
          const fechaPasada = d.fecha <= ymd(new Date())
          return (
            <div key={d.fecha}>
              <button
                onClick={() => setDiaExpandido(expandido ? null : d.fecha)}
                className={cn(
                  'w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-50',
                  expandido && 'bg-gray-50',
                )}
              >
                <span className="text-sm font-medium text-gray-900 capitalize w-28">{etiquetaDia(d.fecha)}</span>

                <div className="flex items-center gap-3 text-xs flex-1" onClick={(e) => e.stopPropagation()}>
                  {d.completos > 0 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setFiltroEstado(filtroEstado === 'completas' ? 'todos' : 'completas'); setDiaExpandido(d.fecha) }}
                      className={cn('text-green-700 hover:underline', filtroEstado === 'completas' && 'font-bold underline')}
                    >✓ {d.completos} completos</button>
                  )}
                  {d.enTurno > 0 && (
                    <span className="text-blue-700">{d.enTurno} en turno</span>
                  )}
                  {d.incompletos > 0 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setFiltroEstado(filtroEstado === 'incompletas' ? 'todos' : 'incompletas'); setDiaExpandido(d.fecha) }}
                      className={cn('text-amber-700 hover:underline', filtroEstado === 'incompletas' && 'font-bold underline')}
                    >⚠ {d.incompletos} incompletos</button>
                  )}
                  {d.ausencias > 0 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setFiltroEstado(filtroEstado === 'ausencias' ? 'todos' : 'ausencias'); setDiaExpandido(d.fecha) }}
                      className={cn('text-red-700 hover:underline', filtroEstado === 'ausencias' && 'font-bold underline')}
                    >✗ {d.ausencias} ausentes</button>
                  )}
                  {d.tardanzas > 0 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setFiltroEstado(filtroEstado === 'tardanzas' ? 'todos' : 'tardanzas'); setDiaExpandido(d.fecha) }}
                      className={cn('text-amber-700 hover:underline', filtroEstado === 'tardanzas' && 'font-bold underline')}
                    >⏱ {d.tardanzas} tarde</button>
                  )}
                  {d.francos > 0 && <span className="text-blue-700">F {d.francos}</span>}
                  {!tieneActividad && fechaPasada && <span className="text-gray-400">Sin actividad</span>}
                  {!fechaPasada && !tieneActividad && <span className="text-gray-400">A futuro</span>}
                </div>

                <span className="text-gray-400 text-sm">{expandido ? '▾' : '▸'}</span>
              </button>

              {expandido && (
                <DetalleDia
                  fecha={d.fecha}
                  fichadas={d.fichadasDelDia}
                  cronograma={d.cronoDelDia}
                  empleados={empleadosFiltrados}
                  empleadosMap={empleadosMap}
                  onCambio={refrescar}
                  filtroEstado={filtroEstado}
                  filtroLocal={filtroLocal}
                />
              )}
            </div>
          )
        })}
        {resumenPorDia.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-gray-500">Cargando...</div>
        )}
      </div>

      {/* ── Modal fichaje manual ──────────────────────────────────────────── */}
      {modalManualAbierto && (
        <ModalFichajeManual
          empleados={empleados || []}
          onClose={() => setModalManualAbierto(false)}
          onSaved={() => { setModalManualAbierto(false); refrescar() }}
        />
      )}
    </div>
  )
}

// ─── KPI mini (clickable) ──────────────────────────────────────────────────
function KpiMini({ label, value, color, activo, onClick }: {
  label: string; value: number; color: 'gray' | 'green' | 'red' | 'amber'
  activo: boolean; onClick: () => void
}) {
  const colorClass = {
    gray: 'text-gray-900',
    green: 'text-green-700',
    red: 'text-red-700',
    amber: 'text-amber-700',
  }[color]
  const ringClass = {
    gray: 'ring-gray-400',
    green: 'ring-green-500',
    red: 'ring-red-500',
    amber: 'ring-amber-500',
  }[color]
  return (
    <button
      onClick={onClick}
      className={cn(
        'bg-white rounded-lg border border-gray-200 p-3 text-left transition-all',
        color !== 'gray' && 'cursor-pointer hover:shadow-sm',
        activo && `ring-2 ${ringClass} shadow-sm`,
      )}
    >
      <p className="text-[10px] uppercase text-gray-500 font-medium tracking-wide">{label}</p>
      <p className={cn('text-2xl font-bold mt-1', colorClass)}>{value}</p>
    </button>
  )
}

// ─── Helpers de estado por empleado ─────────────────────────────────────────
function calcularEstadoEmpleado(
  emp: Empleado,
  fichadas: Fichada[],
  crono: Cronograma | undefined,
  fecha: string,
): { estado: EstadoEmpleadoDia; tarde: boolean } {
  const hoyYmd = ymd(new Date())
  const fs = fichadas.filter((f) => f.empleado_id === emp.id)

  if (crono?.es_franco) return { estado: 'franco', tarde: false }
  if (!crono?.publicado) return { estado: 'sin_turno', tarde: false }

  const tarde = fs.some(
    (f) => f.tipo === 'entrada' && f.minutos_diferencia !== null && f.minutos_diferencia > TOLERANCIA_MIN,
  )

  if (fs.length === 0) {
    if (fecha <= hoyYmd) return { estado: 'ausente', tarde: false }
    return { estado: 'sin_turno', tarde: false }
  }

  const tieneEntrada = fs.some((f) => f.tipo === 'entrada')
  const tieneSalida = fs.some((f) => f.tipo === 'salida')
  if (tieneEntrada && tieneSalida && fs.length % 2 === 0) {
    return { estado: 'completa', tarde }
  }

  // Si es hoy y tiene entrada sin salida → está trabajando (no "incompleta")
  if (tieneEntrada && !tieneSalida && fecha === hoyYmd) {
    return { estado: 'en_turno', tarde }
  }

  return { estado: 'incompleta', tarde }
}

function formatDiferencia(min: number): string {
  const abs = Math.abs(min)
  const signo = min > 0 ? '+' : '-'
  if (abs < 60) return `${signo}${abs} min`
  const h = Math.floor(abs / 60)
  const m = abs % 60
  return m > 0 ? `${signo}${h}h ${m}m` : `${signo}${h}h`
}

function calcularHorasTrabajadas(fichadas: Fichada[]): string | null {
  const entradas = fichadas.filter((f) => f.tipo === 'entrada').sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  const salidas = fichadas.filter((f) => f.tipo === 'salida').sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  if (entradas.length === 0 || salidas.length === 0) return null

  let totalMin = 0
  const pares = Math.min(entradas.length, salidas.length)
  for (let i = 0; i < pares; i++) {
    const e = new Date(entradas[i].timestamp).getTime()
    const s = new Date(salidas[i].timestamp).getTime()
    if (s > e) totalMin += (s - e) / 60000
  }
  if (totalMin === 0) return null
  const h = Math.floor(totalMin / 60)
  const m = Math.round(totalMin % 60)
  return `${h}h ${m}m trabajadas`
}

function BadgeEstado({ estado, tarde }: { estado: EstadoEmpleadoDia; tarde: boolean }) {
  const base = 'px-1.5 py-0.5 rounded text-[10px] font-medium'
  const cfg: Record<EstadoEmpleadoDia, { bg: string; label: string }> = {
    completa: { bg: 'bg-green-100 text-green-700', label: 'Completa' },
    en_turno: { bg: 'bg-blue-100 text-blue-700', label: 'En turno' },
    incompleta: { bg: 'bg-amber-100 text-amber-700', label: 'Incompleta' },
    ausente: { bg: 'bg-red-100 text-red-700', label: 'Ausente' },
    franco: { bg: 'bg-blue-100 text-blue-700', label: 'Franco' },
    sin_turno: { bg: 'bg-gray-100 text-gray-500', label: 'Sin turno' },
  }
  const c = cfg[estado]
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn(base, c.bg)}>{c.label}</span>
      {tarde && <span className={cn(base, 'bg-orange-100 text-orange-700')}>Tarde</span>}
    </span>
  )
}

// ─── Detalle del día (expandido) ────────────────────────────────────────────
function DetalleDia({
  fecha, fichadas, cronograma, empleados, empleadosMap, onCambio, filtroEstado, filtroLocal,
}: {
  fecha: string
  fichadas: Fichada[]
  cronograma: Cronograma[]
  empleados: Empleado[]
  empleadosMap: Map<string, Empleado>
  onCambio: () => void
  filtroEstado: FiltroEstado
  filtroLocal: FiltroLocal
}) {
  const [editando, setEditando] = useState<Fichada | null>(null)
  const [agregandoParaEmp, setAgregandoParaEmp] = useState<string | null>(null)

  // Empleados a mostrar: con turno publicado o con fichadas
  const idsConActividad = new Set<string>()
  cronograma.forEach((c) => { if (c.publicado || c.es_franco) idsConActividad.add(c.empleado_id) })
  fichadas.forEach((f) => idsConActividad.add(f.empleado_id))

  // Calcular estado de cada empleado
  const filasConEstado = empleados
    .filter((e) => idsConActividad.has(e.id))
    .map((emp) => {
      const crono = cronograma.find((x) => x.empleado_id === emp.id)
      const { estado, tarde } = calcularEstadoEmpleado(emp, fichadas, crono, fecha)
      return { emp, estado, tarde }
    })
    // Filtrar por filtroEstado
    .filter(({ estado, tarde }) => {
      if (filtroEstado === 'todos') return true
      if (filtroEstado === 'completas') return estado === 'completa'
      if (filtroEstado === 'ausencias') return estado === 'ausente'
      if (filtroEstado === 'incompletas') return estado === 'incompleta' || estado === 'en_turno'
      if (filtroEstado === 'tardanzas') return tarde
      return true
    })
    // Sort: francos to the bottom
    .sort((a, b) => {
      if (a.estado === 'franco' && b.estado !== 'franco') return 1
      if (a.estado !== 'franco' && b.estado === 'franco') return -1
      return 0
    })

  if (filasConEstado.length === 0) {
    return (
      <div className="px-4 py-3 bg-gray-50 text-xs text-gray-500">
        {filtroEstado !== 'todos'
          ? 'Ningún empleado coincide con el filtro seleccionado.'
          : 'No hay empleados con turno asignado ni fichajes este día.'}
      </div>
    )
  }

  // Group by local when filtroLocal is 'todos'
  const mostrarSeparadores = filtroLocal === 'todos'
  const grupoVedia = mostrarSeparadores ? filasConEstado.filter(({ emp }) => emp.local === 'vedia' || emp.local === 'ambos') : []
  const grupoSaavedra = mostrarSeparadores ? filasConEstado.filter(({ emp }) => emp.local === 'saavedra' || emp.local === 'ambos') : []

  function renderCard({ emp, estado, tarde }: typeof filasConEstado[number]) {
    const fs = fichadas.filter((f) => f.empleado_id === emp.id).sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    const c = cronograma.find((x) => x.empleado_id === emp.id)
    const esFranco = estado === 'franco'
    const esAusente = estado === 'ausente'
    const horasTrabajadas = calcularHorasTrabajadas(fs)

    return (
      <div
        key={emp.id}
        className={cn(
          'bg-white rounded border p-3 transition-opacity',
          esAusente && 'bg-red-50 border-red-200',
          !esAusente && 'border-gray-200',
          esFranco && 'opacity-50',
        )}
      >
        <div className="flex items-start justify-between mb-2">
          <div>
            <p className="text-sm font-medium text-gray-900 inline-flex items-center gap-2">
              {emp.nombre} {emp.apellido}
              <BadgeEstado estado={estado} tarde={tarde} />
            </p>
            <p className="text-[11px] text-gray-500">
              {c?.es_franco
                ? 'FRANCO'
                : c?.hora_entrada
                  ? `Turno: ${c.hora_entrada} – ${c.hora_salida}`
                  : 'Sin turno'}
              {c && !c.publicado && ' · borrador'}
              {horasTrabajadas && <span className="ml-2 text-green-700">({horasTrabajadas})</span>}
            </p>
          </div>
          <button
            onClick={() => setAgregandoParaEmp(emp.id)}
            className="text-[11px] text-rodziny-700 hover:text-rodziny-800 underline"
          >
            + Fichada
          </button>
        </div>

        {fs.length === 0 ? (
          <p className="text-[11px] text-gray-400 italic">Sin fichajes</p>
        ) : (
          <div className="space-y-1">
            {fs.map((f) => (
              <FilaFichada key={f.id} fichada={f} onEdit={() => setEditando(f)} onCambio={onCambio} />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="px-4 py-3 bg-gray-50 space-y-2">
      {mostrarSeparadores ? (
        <>
          {grupoVedia.length > 0 && (
            <>
              <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 pt-1">Vedia</p>
              {grupoVedia.map(renderCard)}
            </>
          )}
          {grupoSaavedra.length > 0 && (
            <>
              <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 pt-2">Saavedra</p>
              {grupoSaavedra.map(renderCard)}
            </>
          )}
        </>
      ) : (
        filasConEstado.map(renderCard)
      )}

      {editando && (
        <ModalEditarFichada
          fichada={editando}
          empleado={empleadosMap.get(editando.empleado_id)}
          onClose={() => setEditando(null)}
          onSaved={() => { setEditando(null); onCambio() }}
        />
      )}

      {agregandoParaEmp && (
        <ModalFichajeManual
          empleados={empleados}
          empleadoIdInicial={agregandoParaEmp}
          fechaInicial={fecha}
          onClose={() => setAgregandoParaEmp(null)}
          onSaved={() => { setAgregandoParaEmp(null); onCambio() }}
        />
      )}
    </div>
  )
}

// ─── Fila de una fichada con foto ───────────────────────────────────────────
function FilaFichada({ fichada, onEdit, onCambio }: {
  fichada: Fichada
  onEdit: () => void
  onCambio: () => void
}) {
  const [fotoUrl, setFotoUrl] = useState<string | null>(null)
  const [verFoto, setVerFoto] = useState(false)

  const d = new Date(fichada.timestamp)
  const hora = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const dif = fichada.minutos_diferencia
  const dentroTolerancia = dif === null || Math.abs(dif) <= TOLERANCIA_MIN

  async function cargarFoto() {
    if (!fichada.foto_path || fotoUrl) { setVerFoto(true); return }
    const { data, error } = await supabase.storage.from('fichadas-fotos').createSignedUrl(fichada.foto_path, 300)
    if (error || !data?.signedUrl) {
      console.error('[ver foto] createSignedUrl falló', { error, foto_path: fichada.foto_path })
      alert(`No se pudo cargar la foto:\n${error?.message ?? 'sin detalle'}\n\nPath: ${fichada.foto_path}`)
      return
    }
    setFotoUrl(data.signedUrl)
    setVerFoto(true)
  }

  async function eliminar() {
    if (!confirm('¿Eliminar esta fichada?')) return
    if (fichada.foto_path) {
      await supabase.storage.from('fichadas-fotos').remove([fichada.foto_path])
    }
    await supabase.from('fichadas').delete().eq('id', fichada.id)
    onCambio()
  }

  return (
    <>
      <div className="flex items-center gap-2 text-xs">
        <span className="capitalize w-14 text-gray-700">{fichada.tipo}</span>
        <span className="font-mono text-gray-900 w-12">{hora}</span>
        {dif !== null && (
          <span className={cn('w-20', dentroTolerancia ? 'text-green-700' : 'text-amber-700')}>
            {dif === 0 ? 'puntual' : formatDiferencia(dif)}
          </span>
        )}
        <span className={cn(
          'px-1.5 py-0.5 rounded text-[10px] font-medium',
          fichada.origen === 'manual' ? 'bg-amber-100 text-amber-800' :
          fichada.origen === 'pwa' ? 'bg-blue-100 text-blue-800' :
          'bg-gray-100 text-gray-700'
        )}>
          {fichada.origen}
        </span>
        <span className="text-gray-500">{fichada.local}</span>
        <div className="ml-auto flex items-center gap-2">
          {fichada.foto_path && (
            <button onClick={cargarFoto} className="text-rodziny-700 hover:text-rodziny-800 underline">
              ver foto
            </button>
          )}
          <button onClick={onEdit} className="text-gray-500 hover:text-gray-700">editar</button>
          <button onClick={eliminar} className="text-red-600 hover:text-red-700">×</button>
        </div>
      </div>

      {verFoto && fotoUrl && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setVerFoto(false)}>
          <img src={fotoUrl} alt="fichada" className="max-w-full max-h-full rounded" />
        </div>
      )}
    </>
  )
}

// ─── Modal editar fichada ───────────────────────────────────────────────────
function ModalEditarFichada({
  fichada, empleado, onClose, onSaved,
}: {
  fichada: Fichada
  empleado: Empleado | undefined
  onClose: () => void
  onSaved: () => void
}) {
  const [tipo, setTipo] = useState(fichada.tipo)
  const [hora, setHora] = useState(() => {
    const d = new Date(fichada.timestamp)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  })
  const [obs, setObs] = useState(fichada.observaciones || '')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function guardar() {
    setError(null)
    setGuardando(true)
    try {
      const [h, m] = hora.split(':').map(Number)
      const nuevoTs = parseYmd(fichada.fecha)
      nuevoTs.setHours(h, m, 0, 0)

      // Recalcular minutos_diferencia si hay cronograma
      const { data: crono } = await supabase
        .from('cronograma')
        .select('hora_entrada, hora_salida')
        .eq('empleado_id', fichada.empleado_id)
        .eq('fecha', fichada.fecha)
        .maybeSingle()
      const horaProgramada = tipo === 'entrada' ? crono?.hora_entrada ?? null : crono?.hora_salida ?? null
      const minutosDif = diffMinutosVsHorario(nuevoTs, horaProgramada)

      const { error: e } = await supabase
        .from('fichadas')
        .update({
          tipo,
          timestamp: nuevoTs.toISOString(),
          minutos_diferencia: minutosDif,
          observaciones: obs || null,
        })
        .eq('id', fichada.id)
      if (e) throw e
      onSaved()
    } catch (e: any) {
      setError(e?.message || 'Error guardando')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900">Editar fichada</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        {empleado && (
          <p className="text-xs text-gray-500 mb-3">{empleado.nombre} {empleado.apellido} · {fichada.fecha}</p>
        )}

        <label className="block text-xs font-medium text-gray-700 mb-1">Tipo</label>
        <select value={tipo} onChange={(e) => setTipo(e.target.value as 'entrada' | 'salida')} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm mb-3">
          <option value="entrada">Entrada</option>
          <option value="salida">Salida</option>
        </select>

        <label className="block text-xs font-medium text-gray-700 mb-1">Hora</label>
        <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm mb-3" />

        <label className="block text-xs font-medium text-gray-700 mb-1">Observaciones</label>
        <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm mb-3" />

        {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded">Cancelar</button>
          <button onClick={guardar} disabled={guardando} className="px-3 py-1.5 text-sm bg-rodziny-700 hover:bg-rodziny-800 text-white rounded disabled:opacity-50">
            {guardando ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal fichaje manual (crear nueva fichada) ─────────────────────────────
function ModalFichajeManual({
  empleados, empleadoIdInicial, fechaInicial, onClose, onSaved,
}: {
  empleados: Empleado[]
  empleadoIdInicial?: string
  fechaInicial?: string
  onClose: () => void
  onSaved: () => void
}) {
  const [empleadoId, setEmpleadoId] = useState(empleadoIdInicial || '')
  const [fecha, setFecha] = useState(fechaInicial || ymd(new Date()))
  const [tipo, setTipo] = useState<'entrada' | 'salida'>('entrada')
  const [hora, setHora] = useState('09:00')
  const [local, setLocal] = useState<'vedia' | 'saavedra'>('vedia')
  const [obs, setObs] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const empleadoSel = empleados.find((e) => e.id === empleadoId)

  const empleadosFiltrados = empleados.filter((e) => {
    if (!busqueda) return true
    const q = busqueda.toLowerCase()
    return `${e.nombre} ${e.apellido} ${e.dni}`.toLowerCase().includes(q)
  })

  async function guardar() {
    setError(null)
    if (!empleadoId) { setError('Elegí un empleado'); return }
    setGuardando(true)
    try {
      const ts = parseYmd(fecha)
      const [h, m] = hora.split(':').map(Number)
      ts.setHours(h, m, 0, 0)

      // Calcular minutos_diferencia
      const { data: crono } = await supabase
        .from('cronograma')
        .select('hora_entrada, hora_salida')
        .eq('empleado_id', empleadoId)
        .eq('fecha', fecha)
        .maybeSingle()
      const horaProgramada = tipo === 'entrada' ? crono?.hora_entrada ?? null : crono?.hora_salida ?? null
      const minutosDif = diffMinutosVsHorario(ts, horaProgramada)

      const { error: e } = await supabase.from('fichadas').insert({
        empleado_id: empleadoId,
        fecha,
        tipo,
        timestamp: ts.toISOString(),
        local,
        minutos_diferencia: minutosDif,
        origen: 'manual',
        observaciones: obs || null,
      })
      if (e) throw e
      onSaved()
    } catch (e: any) {
      setError(e?.message || 'Error guardando')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900">Fichaje manual</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        <p className="text-xs text-gray-500 mb-3">
          Cargá un fichaje manualmente cuando alguien se olvidó el celular o no pudo fichar por la app.
        </p>

        {!empleadoIdInicial && (
          <>
            <label className="block text-xs font-medium text-gray-700 mb-1">Empleado *</label>
            <input
              type="text"
              placeholder="Buscar..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm mb-1"
            />
            <select
              value={empleadoId}
              onChange={(e) => setEmpleadoId(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm mb-3"
              size={5}
            >
              {empleadosFiltrados.map((e) => (
                <option key={e.id} value={e.id}>{e.apellido}, {e.nombre} ({e.local})</option>
              ))}
            </select>
          </>
        )}
        {empleadoIdInicial && empleadoSel && (
          <div className="bg-gray-50 rounded px-2 py-1.5 text-sm text-gray-700 mb-3">
            {empleadoSel.nombre} {empleadoSel.apellido}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Fecha</label>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Hora</label>
            <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Tipo</label>
            <select value={tipo} onChange={(e) => setTipo(e.target.value as 'entrada' | 'salida')} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
              <option value="entrada">Entrada</option>
              <option value="salida">Salida</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Local</label>
            <select value={local} onChange={(e) => setLocal(e.target.value as 'vedia' | 'saavedra')} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
              <option value="vedia">Vedia</option>
              <option value="saavedra">Saavedra</option>
            </select>
          </div>
        </div>

        <label className="block text-xs font-medium text-gray-700 mb-1">Motivo / observaciones</label>
        <textarea
          value={obs}
          onChange={(e) => setObs(e.target.value)}
          rows={2}
          placeholder="Ej: Olvidó el celular"
          className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm mb-3"
        />

        {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded">Cancelar</button>
          <button onClick={guardar} disabled={guardando} className="px-3 py-1.5 text-sm bg-rodziny-700 hover:bg-rodziny-800 text-white rounded disabled:opacity-50">
            {guardando ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
