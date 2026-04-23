import { useState, useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { KPICard } from '@/components/ui/KPICard'
import { cn } from '@/lib/utils'
import {
  useEfemerides,
  useProximasEfemerides,
  CATEGORIA_LABEL,
  CATEGORIA_COLOR,
  type Efemeride,
  type CategoriaEfemeride,
} from './hooks/useEfemerides'

const CATEGORIAS: CategoriaEfemeride[] = ['pasta', 'vino', 'argentina', 'internacional', 'fiesta', 'tradicion', 'postre', 'otro']

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

export function CalendarioTab() {
  const qc = useQueryClient()
  const { data: efemerides, isLoading } = useEfemerides()
  const { proximas } = useProximasEfemerides(30)
  const [filtroCategoria, setFiltroCategoria] = useState<CategoriaEfemeride | 'todas'>('todas')
  const [filtroActivo, setFiltroActivo] = useState<'todas' | 'activas' | 'inactivas'>('activas')
  const [mesSeleccionado, setMesSeleccionado] = useState<number | 'todos'>(new Date().getMonth() + 1)
  const [modalAbierto, setModalAbierto] = useState(false)
  const [editando, setEditando] = useState<Efemeride | null>(null)

  const kpis = useMemo(() => {
    const all = efemerides ?? []
    return {
      total: all.length,
      activas: all.filter((e) => e.activo).length,
      proximas30: proximas.length,
      recurrentes: all.filter((e) => e.mes == null).length,
    }
  }, [efemerides, proximas])

  const filtradas = useMemo(() => {
    let lista = efemerides ?? []
    if (filtroCategoria !== 'todas') lista = lista.filter((e) => e.categoria === filtroCategoria)
    if (filtroActivo === 'activas') lista = lista.filter((e) => e.activo)
    else if (filtroActivo === 'inactivas') lista = lista.filter((e) => !e.activo)
    if (mesSeleccionado !== 'todos') {
      lista = lista.filter((e) => e.mes === mesSeleccionado || e.mes == null)
    }
    return lista
  }, [efemerides, filtroCategoria, filtroActivo, mesSeleccionado])

  const eliminar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('efemerides_gastronomicas').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['efemerides-gastronomicas'] }),
  })

  const toggleActivo = useMutation({
    mutationFn: async ({ id, activo }: { id: string; activo: boolean }) => {
      const { error } = await supabase.from('efemerides_gastronomicas').update({ activo }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['efemerides-gastronomicas'] }),
  })

  return (
    <div className="space-y-4">
      {/* KPIs clickeables */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard
          label="Total efemérides"
          value={String(kpis.total)}
          color="blue"
          loading={isLoading}
          onClick={() => {
            setFiltroCategoria('todas')
            setFiltroActivo('todas')
            setMesSeleccionado('todos')
          }}
        />
        <KPICard
          label="Activas"
          value={String(kpis.activas)}
          color="green"
          loading={isLoading}
          active={filtroActivo === 'activas'}
          onClick={() => setFiltroActivo(filtroActivo === 'activas' ? 'todas' : 'activas')}
        />
        <KPICard
          label="Próximas 30 días"
          value={String(kpis.proximas30)}
          color={kpis.proximas30 > 0 ? 'yellow' : 'neutral'}
          loading={isLoading}
        />
        <KPICard
          label="Recurrentes mensuales"
          value={String(kpis.recurrentes)}
          color="neutral"
          loading={isLoading}
        />
      </div>

      {/* Toolbar */}
      <div className="bg-white rounded-lg border border-surface-border p-3 flex flex-wrap gap-2 items-center">
        <select
          value={mesSeleccionado}
          onChange={(e) => setMesSeleccionado(e.target.value === 'todos' ? 'todos' : Number(e.target.value))}
          className="border border-gray-300 rounded px-2 py-1.5 text-sm"
        >
          <option value="todos">Todos los meses</option>
          {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <select
          value={filtroCategoria}
          onChange={(e) => setFiltroCategoria(e.target.value as CategoriaEfemeride | 'todas')}
          className="border border-gray-300 rounded px-2 py-1.5 text-sm"
        >
          <option value="todas">Todas las categorías</option>
          {CATEGORIAS.map((c) => <option key={c} value={c}>{CATEGORIA_LABEL[c]}</option>)}
        </select>
        <select
          value={filtroActivo}
          onChange={(e) => setFiltroActivo(e.target.value as typeof filtroActivo)}
          className="border border-gray-300 rounded px-2 py-1.5 text-sm"
        >
          <option value="activas">Solo activas</option>
          <option value="inactivas">Solo inactivas</option>
          <option value="todas">Todas</option>
        </select>
        <button
          onClick={() => { setEditando(null); setModalAbierto(true) }}
          className="ml-auto bg-rodziny-700 hover:bg-rodziny-800 text-white text-sm rounded px-3 py-1.5"
        >+ Nueva efeméride</button>
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-lg border border-surface-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border bg-gray-50 text-left text-xs text-gray-500 uppercase">
              <th className="px-4 py-2 w-24">Fecha</th>
              <th className="px-4 py-2">Nombre</th>
              <th className="px-4 py-2">Categoría</th>
              <th className="px-4 py-2">Idea de plato</th>
              <th className="px-4 py-2">Estado</th>
              <th className="px-4 py-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtradas.map((e) => (
              <tr key={e.id} className={cn('border-b border-surface-border hover:bg-gray-50', !e.activo && 'opacity-50')}>
                <td className="px-4 py-2 tabular-nums font-mono text-xs text-gray-600">
                  {e.mes == null
                    ? <span title="Cada mes">{String(e.dia).padStart(2, '0')} · mensual</span>
                    : `${String(e.dia).padStart(2, '0')}/${String(e.mes).padStart(2, '0')}`}
                </td>
                <td className="px-4 py-2">
                  <div className="font-medium text-gray-800">{e.nombre}</div>
                  {e.descripcion && (
                    <div className="text-[11px] text-gray-500 mt-0.5 leading-snug">{e.descripcion}</div>
                  )}
                </td>
                <td className="px-4 py-2">
                  <span className={'text-[10px] px-2 py-0.5 rounded-full font-medium ' + CATEGORIA_COLOR[e.categoria]}>
                    {CATEGORIA_LABEL[e.categoria]}
                  </span>
                </td>
                <td className="px-4 py-2 text-xs text-gray-600 max-w-md">
                  {e.idea_plato || <span className="text-gray-300 italic">—</span>}
                </td>
                <td className="px-4 py-2">
                  {e.activo
                    ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Activa</span>
                    : <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">Inactiva</span>}
                </td>
                <td className="px-4 py-2">
                  <div className="flex gap-1.5 flex-wrap">
                    <button
                      onClick={() => { setEditando(e); setModalAbierto(true) }}
                      className="text-blue-600 hover:text-blue-800 text-xs"
                    >Editar</button>
                    <button
                      onClick={() => toggleActivo.mutate({ id: e.id, activo: !e.activo })}
                      className={cn('text-xs', e.activo ? 'text-orange-600 hover:text-orange-800' : 'text-green-600 hover:text-green-800')}
                    >{e.activo ? 'Desactivar' : 'Activar'}</button>
                    <button
                      onClick={() => { if (window.confirm(`¿Eliminar "${e.nombre}"?`)) eliminar.mutate(e.id) }}
                      className="text-red-500 hover:text-red-700 text-xs"
                    >Eliminar</button>
                  </div>
                </td>
              </tr>
            ))}
            {filtradas.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                {isLoading ? 'Cargando…' : 'No hay efemérides en el filtro actual'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {modalAbierto && (
        <ModalEfemeride
          efemeride={editando}
          onClose={() => setModalAbierto(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['efemerides-gastronomicas'] })
            setModalAbierto(false)
          }}
        />
      )}
    </div>
  )
}

// ─── Modal crear/editar ────────────────────────────────────────────────────
function ModalEfemeride({
  efemeride,
  onClose,
  onSaved,
}: {
  efemeride: Efemeride | null
  onClose: () => void
  onSaved: () => void
}) {
  const [nombre, setNombre] = useState(efemeride?.nombre ?? '')
  const [descripcion, setDescripcion] = useState(efemeride?.descripcion ?? '')
  const [categoria, setCategoria] = useState<CategoriaEfemeride>(efemeride?.categoria ?? 'otro')
  const [ideaPlato, setIdeaPlato] = useState(efemeride?.idea_plato ?? '')
  const [recurrenteMensual, setRecurrenteMensual] = useState(efemeride?.mes == null)
  const [mes, setMes] = useState<number>(efemeride?.mes ?? (new Date().getMonth() + 1))
  const [dia, setDia] = useState<number>(efemeride?.dia ?? 1)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const guardar = async () => {
    if (!nombre.trim()) { setError('El nombre es obligatorio'); return }
    if (dia < 1 || dia > 31) { setError('El día debe estar entre 1 y 31'); return }
    if (!recurrenteMensual && (mes < 1 || mes > 12)) { setError('El mes debe estar entre 1 y 12'); return }
    setGuardando(true)
    setError('')

    const payload = {
      nombre: nombre.trim(),
      descripcion: descripcion.trim() || null,
      categoria,
      idea_plato: ideaPlato.trim() || null,
      mes: recurrenteMensual ? null : mes,
      dia,
    }

    const { error: err } = efemeride
      ? await supabase.from('efemerides_gastronomicas').update(payload).eq('id', efemeride.id)
      : await supabase.from('efemerides_gastronomicas').insert({ ...payload, activo: true })

    if (err) { setError(err.message); setGuardando(false); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-gray-800 mb-4">{efemeride ? 'Editar efeméride' : 'Nueva efeméride'}</h3>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Nombre *</label>
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
              placeholder="Día Mundial de la Pasta"
            />
          </div>

          <div>
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={recurrenteMensual}
                onChange={(e) => setRecurrenteMensual(e.target.checked)}
              />
              Recurrente mensual (se celebra el mismo día todos los meses, ej. Día del Ñoqui)
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {!recurrenteMensual && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Mes</label>
                <select
                  value={mes}
                  onChange={(e) => setMes(Number(e.target.value))}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                >
                  {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                </select>
              </div>
            )}
            <div className={recurrenteMensual ? 'col-span-2' : ''}>
              <label className="block text-xs text-gray-500 mb-1">Día</label>
              <input
                type="number"
                min={1}
                max={31}
                value={dia}
                onChange={(e) => setDia(Number(e.target.value))}
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Categoría</label>
            <select
              value={categoria}
              onChange={(e) => setCategoria(e.target.value as CategoriaEfemeride)}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            >
              {CATEGORIAS.map((c) => <option key={c} value={c}>{CATEGORIA_LABEL[c]}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Descripción</label>
            <textarea
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              rows={2}
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
              placeholder="Contexto de la fecha, relevancia, etc."
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Idea de plato / acción</label>
            <textarea
              value={ideaPlato}
              onChange={(e) => setIdeaPlato(e.target.value)}
              rows={3}
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
              placeholder="Ej: Menú degustación de pastas. Promoción en redes. Plato firma."
            />
          </div>
        </div>

        {error && <p className="text-red-500 text-xs mt-2">{error}</p>}

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-1.5 text-sm text-gray-600 hover:text-gray-800">Cancelar</button>
          <button
            onClick={guardar}
            disabled={guardando}
            className="bg-rodziny-700 hover:bg-rodziny-800 text-white text-sm rounded px-4 py-1.5 disabled:opacity-50"
          >
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
