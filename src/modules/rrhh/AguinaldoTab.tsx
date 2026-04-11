import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatARS, cn } from '@/lib/utils'
import { KPICard } from '@/components/ui/KPICard'
import type { Empleado } from './RRHHPage'
import { parseYmd, ymd } from './utils'

interface SueldoMensual {
  empleado_id: string
  periodo: string // YYYY-MM
  sueldo_recibo: number
  plus_mano: number
}

interface Aguinaldo {
  id: string
  empleado_id: string
  anio: number
  semestre: number
  mejor_sueldo: number
  dias_trabajados: number
  monto_calculado: number
  monto_pagado: number | null
  pagado: boolean
  fecha_pago: string | null
  notas: string | null
}

interface FilaAguinaldo {
  empleado: Empleado
  mejorSueldo: number
  mesEnQueGano: string | null
  mesesConSueldo: number
  diasTrabajados: number
  montoCalculado: number
  registro: Aguinaldo | null
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function mesesDelSemestre(año: number, sem: number): string[] {
  const start = sem === 1 ? 0 : 6
  return Array.from({ length: 6 }, (_, i) => {
    const m = start + i
    return `${año}-${String(m + 1).padStart(2, '0')}`
  })
}

function rangoDelSemestre(año: number, sem: number): { inicio: Date; fin: Date; diasTotales: number } {
  const inicio = sem === 1 ? new Date(año, 0, 1) : new Date(año, 6, 1)
  const fin = sem === 1 ? new Date(año, 5, 30) : new Date(año, 11, 31)
  const diasTotales = Math.round((fin.getTime() - inicio.getTime()) / 86400000) + 1
  return { inicio, fin, diasTotales }
}

function diasTrabajadosEnSemestre(fechaIngreso: string, año: number, sem: number): number {
  const { inicio, fin, diasTotales } = rangoDelSemestre(año, sem)
  const ing = parseYmd(fechaIngreso)
  if (ing > fin) return 0
  if (ing <= inicio) return diasTotales
  return Math.round((fin.getTime() - ing.getTime()) / 86400000) + 1
}

function vencimiento(año: number, sem: number): Date {
  return sem === 1 ? new Date(año, 5, 30) : new Date(año, 11, 18)
}

function diasAlVencimiento(año: number, sem: number): number {
  const v = vencimiento(año, sem)
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  return Math.round((v.getTime() - hoy.getTime()) / 86400000)
}

function nombreMes(periodo: string): string {
  const [, m] = periodo.split('-').map(Number)
  return ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'][m - 1]
}

// ── Componente principal ────────────────────────────────────────────────────
export function AguinaldoTab() {
  const qc = useQueryClient()
  const hoy = new Date()
  const [año, setAño] = useState(hoy.getFullYear())
  const [semestre, setSemestre] = useState<1 | 2>(hoy.getMonth() < 6 ? 1 : 2)
  const [filtroLocal, setFiltroLocal] = useState<'todos' | 'vedia' | 'saavedra'>('todos')
  const [busqueda, setBusqueda] = useState('')
  const [modalFila, setModalFila] = useState<FilaAguinaldo | null>(null)

  const meses = useMemo(() => mesesDelSemestre(año, semestre), [año, semestre])

  const { data: empleados } = useQuery({
    queryKey: ['empleados'],
    queryFn: async () => {
      const { data, error } = await supabase.from('empleados').select('*').order('apellido')
      if (error) throw error
      return data as Empleado[]
    },
  })

  const { data: sueldos } = useQuery({
    queryKey: ['sueldos-sac', año, semestre],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sueldos_mensuales')
        .select('empleado_id, periodo, sueldo_recibo, plus_mano')
        .in('periodo', meses)
      if (error) throw error
      return data as SueldoMensual[]
    },
  })

  const { data: aguinaldos } = useQuery({
    queryKey: ['aguinaldos', año, semestre],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('aguinaldos')
        .select('*')
        .eq('anio', año)
        .eq('semestre', semestre)
      if (error) throw error
      return data as Aguinaldo[]
    },
  })

  const upsertAguinaldo = useMutation({
    mutationFn: async (payload: Partial<Aguinaldo> & { empleado_id: string; anio: number; semestre: number }) => {
      const { error } = await supabase
        .from('aguinaldos')
        .upsert({ ...payload, updated_at: new Date().toISOString() }, { onConflict: 'empleado_id,anio,semestre' })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['aguinaldos'] }),
    onError: (e: Error) => window.alert(`Error: ${e.message}`),
  })

  const eliminar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('aguinaldos').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['aguinaldos'] }),
    onError: (e: Error) => window.alert(`Error: ${e.message}`),
  })

  const cargando = !empleados || !sueldos || !aguinaldos

  const filas = useMemo<FilaAguinaldo[]>(() => {
    if (!empleados || !sueldos || !aguinaldos) return []
    const activos = empleados.filter((e) => e.activo && e.estado_laboral !== 'baja')
    const filtrados = activos.filter((e) => {
      if (filtroLocal === 'vedia' && !(e.local === 'vedia' || e.local === 'ambos')) return false
      if (filtroLocal === 'saavedra' && !(e.local === 'saavedra' || e.local === 'ambos')) return false
      if (busqueda.trim()) {
        const q = busqueda.toLowerCase()
        if (!`${e.nombre} ${e.apellido}`.toLowerCase().includes(q)) return false
      }
      return true
    })

    return filtrados.map((emp) => {
      const sueldosEmp = sueldos.filter((s) => s.empleado_id === emp.id)
      const mesesConSueldo = sueldosEmp.filter((s) => s.sueldo_recibo > 0).length
      let mejorSueldo = 0
      let mesEnQueGano: string | null = null
      for (const s of sueldosEmp) {
        if (s.sueldo_recibo > mejorSueldo) {
          mejorSueldo = s.sueldo_recibo
          mesEnQueGano = s.periodo
        }
      }
      const { diasTotales } = rangoDelSemestre(año, semestre)
      const diasTrabSemestre = diasTrabajadosEnSemestre(emp.fecha_ingreso, año, semestre)
      const diasEfectivos = Math.min(diasTrabSemestre, diasTotales)
      const montoCalculado = mejorSueldo > 0
        ? (mejorSueldo / 2) * (diasEfectivos / diasTotales)
        : 0
      const registro = aguinaldos.find((a) => a.empleado_id === emp.id) || null
      return {
        empleado: emp,
        mejorSueldo,
        mesEnQueGano,
        mesesConSueldo,
        diasTrabajados: diasEfectivos,
        montoCalculado,
        registro,
      }
    }).sort((a, b) => b.montoCalculado - a.montoCalculado)
  }, [empleados, sueldos, aguinaldos, año, semestre, filtroLocal, busqueda])

  const kpis = useMemo(() => {
    const con = filas.filter((f) => f.montoCalculado > 0)
    const total = con.reduce((s, f) => s + f.montoCalculado, 0)
    const pagado = filas
      .filter((f) => f.registro?.pagado)
      .reduce((s, f) => s + (f.registro?.monto_pagado ?? f.montoCalculado), 0)
    const pendientes = con.length - filas.filter((f) => f.registro?.pagado).length
    return {
      total,
      pagado,
      pendientes,
      diasVenc: diasAlVencimiento(año, semestre),
      elegibles: con.length,
    }
  }, [filas, año, semestre])

  function marcarPagado(fila: FilaAguinaldo) {
    upsertAguinaldo.mutate({
      empleado_id: fila.empleado.id,
      anio: año,
      semestre,
      mejor_sueldo: fila.mejorSueldo,
      dias_trabajados: fila.diasTrabajados,
      monto_calculado: fila.montoCalculado,
      monto_pagado: fila.montoCalculado,
      pagado: true,
      fecha_pago: ymd(new Date()),
    } as any)
  }

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KPICard label="Elegibles" value={String(kpis.elegibles)} color="blue" loading={cargando} />
        <KPICard label="Total a pagar" value={formatARS(kpis.total)} color="neutral" loading={cargando} />
        <KPICard label="Ya pagado" value={formatARS(kpis.pagado)} color="green" loading={cargando} />
        <KPICard label="Pendientes" value={String(kpis.pendientes)} color={kpis.pendientes > 0 ? 'yellow' : 'green'} loading={cargando} />
        <KPICard
          label={`Vence ${semestre === 1 ? '30/06' : '18/12'}`}
          value={kpis.diasVenc > 0 ? `${kpis.diasVenc} días` : kpis.diasVenc === 0 ? 'hoy' : 'vencido'}
          color={kpis.diasVenc < 0 ? 'red' : kpis.diasVenc <= 15 ? 'yellow' : 'neutral'}
          loading={cargando}
        />
      </div>

      {/* Toolbar */}
      <div className="bg-white rounded-lg border border-surface-border p-3 flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Buscar empleado..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="flex-1 min-w-[200px] px-3 py-1.5 text-sm border border-gray-300 rounded-md"
        />
        <select value={año} onChange={(e) => setAño(Number(e.target.value))} className="px-3 py-1.5 text-sm border border-gray-300 rounded-md">
          {[hoy.getFullYear() - 1, hoy.getFullYear(), hoy.getFullYear() + 1].map((y) => (
            <option key={y} value={y}>Año {y}</option>
          ))}
        </select>
        <div className="flex items-center border border-gray-300 rounded-md overflow-hidden">
          <button
            onClick={() => setSemestre(1)}
            className={cn('px-3 py-1.5 text-sm', semestre === 1 ? 'bg-rodziny-600 text-white' : 'text-gray-600 hover:bg-gray-50')}
          >
            1° (ene–jun)
          </button>
          <button
            onClick={() => setSemestre(2)}
            className={cn('px-3 py-1.5 text-sm border-l border-gray-300', semestre === 2 ? 'bg-rodziny-600 text-white' : 'text-gray-600 hover:bg-gray-50')}
          >
            2° (jul–dic)
          </button>
        </div>
        <select value={filtroLocal} onChange={(e) => setFiltroLocal(e.target.value as any)} className="px-3 py-1.5 text-sm border border-gray-300 rounded-md">
          <option value="todos">Todos los locales</option>
          <option value="vedia">Vedia</option>
          <option value="saavedra">Saavedra</option>
        </select>
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-lg border border-surface-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="text-left px-4 py-2">Empleado</th>
              <th className="text-right px-2 py-2">Mejor sueldo</th>
              <th className="text-center px-2 py-2">Mes</th>
              <th className="text-center px-2 py-2">Días trabajados</th>
              <th className="text-right px-2 py-2">SAC teórico</th>
              <th className="text-center px-2 py-2">Estado</th>
              <th className="text-right px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {cargando && (
              <tr><td colSpan={7} className="text-center py-8 text-gray-400">Cargando...</td></tr>
            )}
            {!cargando && filas.length === 0 && (
              <tr><td colSpan={7} className="text-center py-8 text-gray-400">Sin empleados</td></tr>
            )}
            {!cargando && filas.map((f) => {
              const pagado = !!f.registro?.pagado
              const sinDatos = f.montoCalculado === 0
              return (
                <tr key={f.empleado.id} className={cn('border-t border-gray-100 hover:bg-gray-50', sinDatos && 'opacity-40')}>
                  <td className="px-4 py-2">
                    <div className="font-medium text-gray-900">{f.empleado.apellido}, {f.empleado.nombre}</div>
                    <div className="text-[11px] text-gray-400 capitalize">{f.empleado.puesto} · {f.empleado.local}</div>
                  </td>
                  <td className="px-2 py-2 text-right text-gray-700">{f.mejorSueldo > 0 ? formatARS(f.mejorSueldo) : '—'}</td>
                  <td className="px-2 py-2 text-center text-xs text-gray-500">{f.mesEnQueGano ? nombreMes(f.mesEnQueGano) : '—'}</td>
                  <td className="px-2 py-2 text-center text-xs text-gray-500">
                    {f.diasTrabajados} / {rangoDelSemestre(año, semestre).diasTotales}
                    {f.mesesConSueldo < 6 && f.mesesConSueldo > 0 && (
                      <div className="text-[10px] text-gray-400">{f.mesesConSueldo} mes{f.mesesConSueldo !== 1 ? 'es' : ''} c/sueldo</div>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right font-semibold text-gray-900">
                    {sinDatos ? '—' : formatARS(f.montoCalculado)}
                  </td>
                  <td className="px-2 py-2 text-center">
                    {pagado ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-medium">
                        ✓ Pagado
                      </span>
                    ) : sinDatos ? (
                      <span className="text-[10px] text-gray-400">sin sueldos</span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 font-medium">
                        Pendiente
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right space-x-1 whitespace-nowrap">
                    {!sinDatos && !pagado && (
                      <button
                        onClick={() => marcarPagado(f)}
                        className="text-[10px] px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700"
                      >
                        Marcar pagado
                      </button>
                    )}
                    {!sinDatos && (
                      <button
                        onClick={() => setModalFila(f)}
                        className="text-[10px] text-rodziny-600 hover:text-rodziny-800"
                      >
                        Editar
                      </button>
                    )}
                    {f.registro && (
                      <button
                        onClick={() => {
                          if (window.confirm('¿Borrar el registro de aguinaldo?')) eliminar.mutate(f.registro!.id)
                        }}
                        className="text-[10px] text-red-500 hover:text-red-700"
                      >
                        Borrar
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
          {!cargando && filas.some((f) => f.montoCalculado > 0) && (
            <tfoot className="bg-gray-50 text-sm">
              <tr className="border-t border-gray-200">
                <td colSpan={4} className="px-4 py-2 text-right font-semibold text-gray-700">TOTAL</td>
                <td className="px-2 py-2 text-right font-bold text-rodziny-700">{formatARS(kpis.total)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {modalFila && (
        <ModalAguinaldo
          fila={modalFila}
          año={año}
          semestre={semestre}
          onClose={() => setModalFila(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['aguinaldos'] })
            setModalFila(null)
          }}
        />
      )}
    </div>
  )
}

// ── Modal de edición ─────────────────────────────────────────────────────────
function ModalAguinaldo({
  fila, año, semestre, onClose, onSaved,
}: {
  fila: FilaAguinaldo
  año: number
  semestre: number
  onClose: () => void
  onSaved: () => void
}) {
  const r = fila.registro
  const [montoPagado, setMontoPagado] = useState(r?.monto_pagado ?? fila.montoCalculado)
  const [pagado, setPagado] = useState(r?.pagado ?? false)
  const [fechaPago, setFechaPago] = useState(r?.fecha_pago ?? ymd(new Date()))
  const [notas, setNotas] = useState(r?.notas ?? '')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function guardar() {
    setError(null)
    setGuardando(true)
    try {
      const { error: err } = await supabase
        .from('aguinaldos')
        .upsert({
          empleado_id: fila.empleado.id,
          anio: año,
          semestre,
          mejor_sueldo: fila.mejorSueldo,
          dias_trabajados: fila.diasTrabajados,
          monto_calculado: fila.montoCalculado,
          monto_pagado: montoPagado || null,
          pagado,
          fecha_pago: pagado ? fechaPago : null,
          notas: notas || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'empleado_id,anio,semestre' })
      if (err) throw err
      onSaved()
    } catch (e: any) {
      setError(e.message || 'Error al guardar.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Aguinaldo {semestre === 1 ? '1° semestre' : '2° semestre'} {año}</h3>
          <div className="text-xs text-gray-500">{fila.empleado.apellido}, {fila.empleado.nombre}</div>
        </div>
        <div className="px-6 py-4 space-y-3">
          <div className="bg-gray-50 rounded p-3 text-xs text-gray-600 space-y-1">
            <div>Mejor sueldo del semestre: <span className="font-semibold text-gray-900">{formatARS(fila.mejorSueldo)}</span></div>
            <div>Días trabajados: <span className="font-semibold text-gray-900">{fila.diasTrabajados}</span></div>
            <div>SAC teórico: <span className="font-semibold text-rodziny-700">{formatARS(fila.montoCalculado)}</span></div>
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={pagado} onChange={(e) => setPagado(e.target.checked)} className="w-4 h-4" />
              Pagado
            </label>
          </div>
          {pagado && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Monto real pagado</label>
                <input
                  type="number"
                  value={montoPagado}
                  onChange={(e) => setMontoPagado(Number(e.target.value))}
                  className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Fecha de pago</label>
                <input
                  type="date"
                  value={fechaPago}
                  onChange={(e) => setFechaPago(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded"
                />
              </div>
            </>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notas</label>
            <textarea
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              rows={2}
              className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded"
            />
          </div>
          {error && <div className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded">{error}</div>}
        </div>
        <div className="px-6 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50">Cancelar</button>
          <button
            onClick={guardar}
            disabled={guardando}
            className="px-4 py-1.5 text-sm bg-rodziny-600 text-white rounded hover:bg-rodziny-700 disabled:opacity-50"
          >
            {guardando ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
