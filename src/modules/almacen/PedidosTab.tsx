import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

interface Pedido {
  id: string
  producto_id: string | null
  producto_nombre: string
  cantidad: number
  cliente_nombre: string
  cliente_telefono: string | null
  fecha_pedido: string
  fecha_entrega: string
  turno: string
  estado: Estado
  lote_id: string | null
  medio_pago: string | null
  abono: boolean
  vendedor: string | null
  nro_ticket: string | null
  observaciones: string | null
  local: string
  created_at: string
}

type Estado = 'pendiente' | 'en_preparacion' | 'listo' | 'entregado' | 'cancelado'
type FiltroEstado = 'todos' | Estado

const ESTADOS: { valor: Estado; label: string; color: string; bg: string }[] = [
  { valor: 'pendiente', label: 'Pendiente', color: 'text-amber-700', bg: 'bg-amber-100' },
  { valor: 'en_preparacion', label: 'En preparación', color: 'text-blue-700', bg: 'bg-blue-100' },
  { valor: 'listo', label: 'Listo', color: 'text-green-700', bg: 'bg-green-100' },
  { valor: 'entregado', label: 'Entregado', color: 'text-gray-600', bg: 'bg-gray-100' },
  { valor: 'cancelado', label: 'Cancelado', color: 'text-red-700', bg: 'bg-red-100' },
]

const SIGUIENTE_ESTADO: Record<Estado, Estado | null> = {
  pendiente: 'en_preparacion',
  en_preparacion: 'listo',
  listo: 'entregado',
  entregado: null,
  cancelado: null,
}

const MEDIOS_PAGO = ['Efectivo', 'Transferencia', 'Mercado Pago (point)', 'Mercado Pago (QR)', 'Débito', 'Crédito']

function hoy() {
  const d = new Date()
  return d.toISOString().substring(0, 10)
}

function manana() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().substring(0, 10)
}

function formatFecha(f: string) {
  const [y, m, d] = f.split('-')
  const fecha = new Date(+y, +m - 1, +d)
  const dias = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
  return `${dias[fecha.getDay()]} ${d}/${m}`
}

export function PedidosTab() {
  const qc = useQueryClient()
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>('todos')
  const [modalAbierto, setModalAbierto] = useState(false)
  const [editando, setEditando] = useState<Pedido | null>(null)

  // Cargar pedidos
  const { data: pedidos, isLoading } = useQuery({
    queryKey: ['almacen-pedidos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('almacen_pedidos')
        .select('*')
        .order('fecha_entrega', { ascending: true })
        .order('turno', { ascending: true })
      if (error) throw error
      return data as Pedido[]
    },
  })

  // Cargar clientes únicos para autocompletar
  const { data: clientesPrevios } = useQuery({
    queryKey: ['almacen-clientes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('almacen_pedidos')
        .select('cliente_nombre, cliente_telefono')
        .order('created_at', { ascending: false })
      if (error) throw error
      // Deduplicar por nombre
      const map = new Map<string, string | null>()
      for (const c of data) {
        if (!map.has(c.cliente_nombre)) {
          map.set(c.cliente_nombre, c.cliente_telefono)
        }
      }
      return Array.from(map.entries()).map(([nombre, telefono]) => ({ nombre, telefono }))
    },
  })

  // Cambiar estado
  const cambiarEstado = useMutation({
    mutationFn: async ({ id, estado }: { id: string; estado: Estado }) => {
      const { error } = await supabase
        .from('almacen_pedidos')
        .update({ estado })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['almacen-pedidos'] }),
  })

  // Filtrar
  const pedidosFiltrados = pedidos?.filter((p) => {
    if (filtroEstado === 'todos') return true
    return p.estado === filtroEstado
  }) ?? []

  // Agrupar: hoy, mañana, próximos, pasados
  const grupoHoy = pedidosFiltrados.filter(p => p.fecha_entrega === hoy() && p.estado !== 'entregado' && p.estado !== 'cancelado')
  const grupoManana = pedidosFiltrados.filter(p => p.fecha_entrega === manana() && p.estado !== 'entregado' && p.estado !== 'cancelado')
  const grupoProximos = pedidosFiltrados.filter(p => p.fecha_entrega > manana() && p.estado !== 'entregado' && p.estado !== 'cancelado')
  const grupoCompletados = pedidosFiltrados.filter(p => p.estado === 'entregado' || p.estado === 'cancelado')

  // KPIs
  const pendientesHoy = pedidos?.filter(p => p.fecha_entrega <= hoy() && p.estado !== 'entregado' && p.estado !== 'cancelado').length ?? 0
  const pendientesManana = pedidos?.filter(p => p.fecha_entrega === manana() && p.estado !== 'entregado' && p.estado !== 'cancelado').length ?? 0
  const enPreparacion = pedidos?.filter(p => p.estado === 'en_preparacion').length ?? 0
  const listos = pedidos?.filter(p => p.estado === 'listo').length ?? 0

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-4 gap-3">
        <KpiCard label="Para hoy" valor={pendientesHoy} color={pendientesHoy > 0 ? 'text-red-600' : 'text-gray-400'} bg={pendientesHoy > 0 ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'} />
        <KpiCard label="Para mañana" valor={pendientesManana} color={pendientesManana > 0 ? 'text-amber-600' : 'text-gray-400'} bg={pendientesManana > 0 ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'} />
        <KpiCard label="En preparación" valor={enPreparacion} color="text-blue-600" bg="bg-blue-50 border-blue-200" />
        <KpiCard label="Listos p/ retirar" valor={listos} color="text-green-600" bg="bg-green-50 border-green-200" />
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <select
          value={filtroEstado}
          onChange={(e) => setFiltroEstado(e.target.value as FiltroEstado)}
          className="text-sm border border-gray-300 rounded-md px-3 py-1.5"
        >
          <option value="todos">Todos los estados</option>
          {ESTADOS.map((e) => (
            <option key={e.valor} value={e.valor}>{e.label}</option>
          ))}
        </select>

        <div className="flex-1" />

        <button
          onClick={() => { setEditando(null); setModalAbierto(true) }}
          className="bg-rodziny-600 hover:bg-rodziny-700 text-white text-sm font-medium px-4 py-1.5 rounded-md transition-colors"
        >
          + Nuevo pedido
        </button>
      </div>

      {isLoading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-400">Cargando...</div>
      ) : pedidosFiltrados.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <div className="text-3xl mb-2">📋</div>
          <p className="text-sm text-gray-500">No hay pedidos {filtroEstado !== 'todos' ? `con estado "${ESTADOS.find(e => e.valor === filtroEstado)?.label}"` : 'cargados'}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {grupoHoy.length > 0 && (
            <GrupoPedidos titulo="Hoy" badge={grupoHoy.length} color="red" pedidos={grupoHoy} onCambiarEstado={(id, est) => cambiarEstado.mutate({ id, estado: est })} onEditar={(p) => { setEditando(p); setModalAbierto(true) }} />
          )}
          {grupoManana.length > 0 && (
            <GrupoPedidos titulo="Mañana" badge={grupoManana.length} color="amber" pedidos={grupoManana} onCambiarEstado={(id, est) => cambiarEstado.mutate({ id, estado: est })} onEditar={(p) => { setEditando(p); setModalAbierto(true) }} />
          )}
          {grupoProximos.length > 0 && (
            <GrupoPedidos titulo="Próximos" badge={grupoProximos.length} color="blue" pedidos={grupoProximos} onCambiarEstado={(id, est) => cambiarEstado.mutate({ id, estado: est })} onEditar={(p) => { setEditando(p); setModalAbierto(true) }} />
          )}
          {grupoCompletados.length > 0 && (
            <GrupoPedidos titulo="Completados" badge={grupoCompletados.length} color="gray" pedidos={grupoCompletados} onCambiarEstado={(id, est) => cambiarEstado.mutate({ id, estado: est })} onEditar={(p) => { setEditando(p); setModalAbierto(true) }} />
          )}
        </div>
      )}

      {modalAbierto && (
        <ModalPedido
          editando={editando}
          clientesPrevios={clientesPrevios ?? []}
          onClose={() => { setModalAbierto(false); setEditando(null) }}
          onGuardado={() => { setModalAbierto(false); setEditando(null); qc.invalidateQueries({ queryKey: ['almacen-pedidos'] }) }}
        />
      )}
    </div>
  )
}

function KpiCard({ label, valor, color, bg }: { label: string; valor: number; color: string; bg: string }) {
  return (
    <div className={cn('rounded-lg border p-3 text-center', bg)}>
      <div className={cn('text-2xl font-bold', color)}>{valor}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  )
}

function GrupoPedidos({
  titulo, badge, color, pedidos, onCambiarEstado, onEditar,
}: {
  titulo: string; badge: number; color: string; pedidos: Pedido[]
  onCambiarEstado: (id: string, estado: Estado) => void
  onEditar: (p: Pedido) => void
}) {
  const colorMap: Record<string, string> = {
    red: 'bg-red-100 text-red-700',
    amber: 'bg-amber-100 text-amber-700',
    blue: 'bg-blue-100 text-blue-700',
    gray: 'bg-gray-100 text-gray-600',
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-700">{titulo}</h3>
        <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', colorMap[color])}>{badge}</span>
      </div>
      <div className="divide-y divide-gray-50">
        {pedidos.map((p) => (
          <PedidoRow key={p.id} pedido={p} onCambiarEstado={onCambiarEstado} onEditar={onEditar} />
        ))}
      </div>
    </div>
  )
}

function PedidoRow({
  pedido, onCambiarEstado, onEditar,
}: {
  pedido: Pedido
  onCambiarEstado: (id: string, estado: Estado) => void
  onEditar: (p: Pedido) => void
}) {
  const estadoInfo = ESTADOS.find(e => e.valor === pedido.estado)!
  const siguiente = SIGUIENTE_ESTADO[pedido.estado]

  return (
    <div className="px-4 py-3 flex items-center gap-4 hover:bg-gray-50 transition-colors">
      {/* Info principal */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-medium text-sm text-gray-900">{pedido.cantidad}x {pedido.producto_nombre}</span>
          <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded', estadoInfo.bg, estadoInfo.color)}>
            {estadoInfo.label}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span>{pedido.cliente_nombre}</span>
          {pedido.cliente_telefono && <span>{pedido.cliente_telefono}</span>}
          <span>Entrega: {formatFecha(pedido.fecha_entrega)} ({pedido.turno})</span>
          {pedido.vendedor && <span>Vendedor: {pedido.vendedor}</span>}
        </div>
        {pedido.observaciones && (
          <div className="text-xs text-gray-400 mt-0.5 italic">{pedido.observaciones}</div>
        )}
      </div>

      {/* Pago */}
      <div className="text-right text-xs space-y-0.5 flex-shrink-0">
        {pedido.abono && <div className="text-green-600 font-medium">Abonado</div>}
        {pedido.medio_pago && <div className="text-gray-400">{pedido.medio_pago}</div>}
        {pedido.nro_ticket && <div className="text-gray-400">#{pedido.nro_ticket}</div>}
      </div>

      {/* Acciones */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {siguiente && (
          <button
            onClick={() => onCambiarEstado(pedido.id, siguiente)}
            className="text-xs bg-rodziny-50 hover:bg-rodziny-100 text-rodziny-700 px-2.5 py-1 rounded transition-colors"
          >
            {siguiente === 'en_preparacion' ? 'Preparar' : siguiente === 'listo' ? 'Listo' : 'Entregado'}
          </button>
        )}
        <button
          onClick={() => onEditar(pedido)}
          className="text-xs text-gray-400 hover:text-gray-600 px-1.5 py-1"
          title="Editar"
        >
          Editar
        </button>
        {pedido.estado !== 'cancelado' && pedido.estado !== 'entregado' && (
          <button
            onClick={() => onCambiarEstado(pedido.id, 'cancelado')}
            className="text-xs text-red-400 hover:text-red-600 px-1.5 py-1"
            title="Cancelar"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Modal crear/editar ─────────────────────────────────────────

const PRODUCTOS_ALMACEN = [
  'Pan Lactal', 'Pan de Molde', 'Pan Brioche', 'Pan de Campo',
  'Cheesecake', 'Torta Matilda', 'Torta Brownie', 'Torta de Ricota',
  'Budín', 'Alfajores', 'Cookies',
  'Sorrentinos', 'Ravioles', 'Ñoquis', 'Canelones', 'Lasagna',
]

function ModalPedido({
  editando,
  clientesPrevios,
  onClose,
  onGuardado,
}: {
  editando: Pedido | null
  clientesPrevios: { nombre: string; telefono: string | null }[]
  onClose: () => void
  onGuardado: () => void
}) {
  const [form, setForm] = useState({
    producto_nombre: editando?.producto_nombre ?? '',
    cantidad: editando?.cantidad ?? 1,
    cliente_nombre: editando?.cliente_nombre ?? '',
    cliente_telefono: editando?.cliente_telefono ?? '',
    fecha_entrega: editando?.fecha_entrega ?? manana(),
    turno: editando?.turno ?? 'mañana',
    observaciones: editando?.observaciones ?? '',
    medio_pago: editando?.medio_pago ?? '',
    abono: editando?.abono ?? false,
    vendedor: editando?.vendedor ?? '',
    nro_ticket: editando?.nro_ticket ?? '',
    estado: editando?.estado ?? 'pendiente' as Estado,
  })
  const [guardando, setGuardando] = useState(false)
  const [sugerenciasCliente, setSugerenciasCliente] = useState(false)

  const clientesFiltrados = clientesPrevios.filter(c =>
    form.cliente_nombre.length >= 2 &&
    c.nombre.toLowerCase().includes(form.cliente_nombre.toLowerCase()) &&
    c.nombre !== form.cliente_nombre
  )

  async function guardar() {
    if (!form.producto_nombre || !form.cliente_nombre || !form.fecha_entrega) return
    setGuardando(true)

    const payload = {
      producto_nombre: form.producto_nombre,
      cantidad: form.cantidad,
      cliente_nombre: form.cliente_nombre,
      cliente_telefono: form.cliente_telefono || null,
      fecha_entrega: form.fecha_entrega,
      turno: form.turno,
      observaciones: form.observaciones || null,
      medio_pago: form.medio_pago || null,
      abono: form.abono,
      vendedor: form.vendedor || null,
      nro_ticket: form.nro_ticket || null,
      estado: form.estado,
      local: 'saavedra',
    }

    if (editando) {
      const { error } = await supabase
        .from('almacen_pedidos')
        .update(payload)
        .eq('id', editando.id)
      if (error) { alert(error.message); setGuardando(false); return }
    } else {
      const { error } = await supabase
        .from('almacen_pedidos')
        .insert({ ...payload, fecha_pedido: hoy() })
      if (error) { alert(error.message); setGuardando(false); return }
    }

    setGuardando(false)
    onGuardado()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-lg">✕</button>
        <h3 className="text-lg font-bold text-gray-800 mb-4">{editando ? 'Editar pedido' : 'Nuevo pedido'}</h3>

        <div className="space-y-3">
          {/* Producto + Cantidad */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-medium text-gray-600 block mb-1">Producto *</label>
              <select
                value={form.producto_nombre}
                onChange={(e) => setForm({ ...form, producto_nombre: e.target.value })}
                className="w-full text-sm border border-gray-300 rounded-md px-3 py-1.5"
              >
                <option value="">Seleccionar...</option>
                {PRODUCTOS_ALMACEN.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Cantidad</label>
              <input
                type="number"
                min={1}
                value={form.cantidad}
                onChange={(e) => setForm({ ...form, cantidad: parseInt(e.target.value) || 1 })}
                className="w-full text-sm border border-gray-300 rounded-md px-3 py-1.5"
              />
            </div>
          </div>

          {/* Cliente */}
          <div className="grid grid-cols-2 gap-3">
            <div className="relative">
              <label className="text-xs font-medium text-gray-600 block mb-1">Cliente *</label>
              <input
                value={form.cliente_nombre}
                onChange={(e) => { setForm({ ...form, cliente_nombre: e.target.value }); setSugerenciasCliente(true) }}
                onBlur={() => setTimeout(() => setSugerenciasCliente(false), 200)}
                placeholder="Nombre del cliente"
                className="w-full text-sm border border-gray-300 rounded-md px-3 py-1.5"
              />
              {sugerenciasCliente && clientesFiltrados.length > 0 && (
                <div className="absolute z-10 top-full mt-1 w-full bg-white border border-gray-200 rounded-md shadow-md max-h-32 overflow-y-auto">
                  {clientesFiltrados.map((c) => (
                    <button
                      key={c.nombre}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setForm({ ...form, cliente_nombre: c.nombre, cliente_telefono: c.telefono ?? '' })
                        setSugerenciasCliente(false)
                      }}
                      className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50"
                    >
                      {c.nombre} {c.telefono && <span className="text-gray-400 text-xs ml-1">{c.telefono}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Teléfono</label>
              <input
                value={form.cliente_telefono}
                onChange={(e) => setForm({ ...form, cliente_telefono: e.target.value })}
                placeholder="3624-..."
                className="w-full text-sm border border-gray-300 rounded-md px-3 py-1.5"
              />
            </div>
          </div>

          {/* Fecha entrega + turno */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Fecha entrega *</label>
              <input
                type="date"
                value={form.fecha_entrega}
                onChange={(e) => setForm({ ...form, fecha_entrega: e.target.value })}
                className="w-full text-sm border border-gray-300 rounded-md px-3 py-1.5"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Turno</label>
              <select
                value={form.turno}
                onChange={(e) => setForm({ ...form, turno: e.target.value })}
                className="w-full text-sm border border-gray-300 rounded-md px-3 py-1.5"
              >
                <option value="mañana">Mañana</option>
                <option value="tarde">Tarde</option>
              </select>
            </div>
          </div>

          {/* Observaciones */}
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Observaciones</label>
            <textarea
              value={form.observaciones}
              onChange={(e) => setForm({ ...form, observaciones: e.target.value })}
              placeholder="Sin sal, abona al retirar, etc."
              rows={2}
              className="w-full text-sm border border-gray-300 rounded-md px-3 py-1.5"
            />
          </div>

          {/* Pago */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Medio de pago</label>
              <select
                value={form.medio_pago}
                onChange={(e) => setForm({ ...form, medio_pago: e.target.value })}
                className="w-full text-sm border border-gray-300 rounded-md px-3 py-1.5"
              >
                <option value="">Sin definir</option>
                {MEDIOS_PAGO.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Vendedor</label>
              <input
                value={form.vendedor}
                onChange={(e) => setForm({ ...form, vendedor: e.target.value })}
                placeholder="Nombre"
                className="w-full text-sm border border-gray-300 rounded-md px-3 py-1.5"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Nro. ticket</label>
              <input
                value={form.nro_ticket}
                onChange={(e) => setForm({ ...form, nro_ticket: e.target.value })}
                placeholder="#12345"
                className="w-full text-sm border border-gray-300 rounded-md px-3 py-1.5"
              />
            </div>
          </div>

          {/* Abonó? */}
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.abono}
              onChange={(e) => setForm({ ...form, abono: e.target.checked })}
              className="w-4 h-4"
            />
            El cliente ya abonó
          </label>

          {/* Estado (solo en edición) */}
          {editando && (
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Estado</label>
              <select
                value={form.estado}
                onChange={(e) => setForm({ ...form, estado: e.target.value as Estado })}
                className="w-full text-sm border border-gray-300 rounded-md px-3 py-1.5"
              >
                {ESTADOS.map((e) => (
                  <option key={e.valor} value={e.valor}>{e.label}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2">Cancelar</button>
          <button
            onClick={guardar}
            disabled={guardando || !form.producto_nombre || !form.cliente_nombre || !form.fecha_entrega}
            className="bg-rodziny-600 hover:bg-rodziny-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-md transition-colors"
          >
            {guardando ? 'Guardando...' : editando ? 'Guardar cambios' : 'Crear pedido'}
          </button>
        </div>
      </div>
    </div>
  )
}
