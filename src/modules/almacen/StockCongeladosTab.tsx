import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

interface LotePasta {
  producto_id: string
  porciones: number
  producto: { nombre: string; codigo: string; minimo_produccion: number }[] | null
}

interface Traspaso {
  producto_id: string
  porciones: number
}

interface Merma {
  producto_id: string
  porciones: number
}

interface PedidoEntregado {
  producto_nombre: string
  cantidad: number
}

interface StockItem {
  productoId: string
  nombre: string
  codigo: string
  producido: number
  traspasado: number
  merma: number
  entregadoPedidos: number
  stock: number
  minimo: number
}

export function StockCongeladosTab() {
  // Lotes de pasta producidos (solo saavedra, productos congelables)
  const { data: lotes } = useQuery({
    queryKey: ['almacen-stock-lotes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_pasta')
        .select('producto_id, porciones, producto:cocina_productos(nombre, codigo, minimo_produccion)')
        .eq('local', 'saavedra')
      if (error) throw error
      return data as LotePasta[]
    },
  })

  // Traspasos de saavedra
  const { data: traspasos } = useQuery({
    queryKey: ['almacen-stock-traspasos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_traspasos')
        .select('producto_id, porciones')
        .eq('local', 'saavedra')
      if (error) throw error
      return data as Traspaso[]
    },
  })

  // Merma de saavedra
  const { data: mermas } = useQuery({
    queryKey: ['almacen-stock-merma'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_merma')
        .select('producto_id, porciones')
        .eq('local', 'saavedra')
      if (error) throw error
      return data as Merma[]
    },
  })

  // Pedidos entregados (para descontar del stock)
  const { data: pedidosEntregados } = useQuery({
    queryKey: ['almacen-stock-pedidos-entregados'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('almacen_pedidos')
        .select('producto_nombre, cantidad')
        .eq('estado', 'entregado')
        .eq('local', 'saavedra')
      if (error) throw error
      return data as PedidoEntregado[]
    },
  })

  // Calcular stock por producto
  const isLoading = !lotes || !traspasos || !mermas || !pedidosEntregados

  const stockItems: StockItem[] = []

  if (!isLoading) {
    const mapa = new Map<string, StockItem>()

    // Producido
    for (const l of lotes) {
      const prod = Array.isArray(l.producto) ? l.producto[0] : l.producto
      if (!prod) continue
      if (!mapa.has(l.producto_id)) {
        mapa.set(l.producto_id, {
          productoId: l.producto_id,
          nombre: prod.nombre,
          codigo: prod.codigo,
          producido: 0,
          traspasado: 0,
          merma: 0,
          entregadoPedidos: 0,
          stock: 0,
          minimo: prod.minimo_produccion,
        })
      }
      mapa.get(l.producto_id)!.producido += l.porciones
    }

    // Traspasado
    for (const t of traspasos) {
      const item = mapa.get(t.producto_id)
      if (item) item.traspasado += t.porciones
    }

    // Merma
    for (const m of mermas) {
      const item = mapa.get(m.producto_id)
      if (item) item.merma += m.porciones
    }

    // Pedidos entregados (matchear por nombre ya que producto_id puede no estar seteado)
    for (const p of pedidosEntregados) {
      for (const item of mapa.values()) {
        if (item.nombre.toLowerCase() === p.producto_nombre.toLowerCase()) {
          item.entregadoPedidos += p.cantidad
        }
      }
    }

    // Calcular stock final
    for (const item of mapa.values()) {
      item.stock = item.producido - item.traspasado - item.merma - item.entregadoPedidos
      stockItems.push(item)
    }

    stockItems.sort((a, b) => a.stock - b.stock)
  }

  // KPIs
  const totalProductos = stockItems.length
  const sinStock = stockItems.filter(s => s.stock <= 0).length
  const bajoMinimo = stockItems.filter(s => s.stock > 0 && s.stock < s.minimo).length
  const ok = stockItems.filter(s => s.stock >= s.minimo).length

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-lg border bg-white border-gray-200 p-3 text-center">
          <div className="text-2xl font-bold text-gray-700">{totalProductos}</div>
          <div className="text-xs text-gray-500">Productos</div>
        </div>
        <div className={cn('rounded-lg border p-3 text-center', ok > 0 ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200')}>
          <div className={cn('text-2xl font-bold', ok > 0 ? 'text-green-600' : 'text-gray-400')}>{ok}</div>
          <div className="text-xs text-gray-500">OK</div>
        </div>
        <div className={cn('rounded-lg border p-3 text-center', bajoMinimo > 0 ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200')}>
          <div className={cn('text-2xl font-bold', bajoMinimo > 0 ? 'text-amber-600' : 'text-gray-400')}>{bajoMinimo}</div>
          <div className="text-xs text-gray-500">Bajo mínimo</div>
        </div>
        <div className={cn('rounded-lg border p-3 text-center', sinStock > 0 ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200')}>
          <div className={cn('text-2xl font-bold', sinStock > 0 ? 'text-red-600' : 'text-gray-400')}>{sinStock}</div>
          <div className="text-xs text-gray-500">Sin stock</div>
        </div>
      </div>

      {/* Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700">
        El stock se calcula automáticamente: <strong>Producción</strong> (lotes de pasta) - <strong>Traspasos</strong> (depósito → mostrador) - <strong>Merma</strong> - <strong>Pedidos entregados</strong> (almacén).
        Los datos vienen del módulo Cocina.
      </div>

      {/* Tabla */}
      {isLoading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-400">Cargando...</div>
      ) : stockItems.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <div className="text-3xl mb-2">📦</div>
          <p className="text-sm text-gray-500">No hay producción registrada para Saavedra todavía.</p>
          <p className="text-xs text-gray-400 mt-1">Registrá lotes en el módulo Cocina → Producción para ver el stock acá.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-xs text-gray-500 uppercase">
                <th className="text-left px-4 py-2 font-semibold">Producto</th>
                <th className="text-center px-3 py-2 font-semibold">Código</th>
                <th className="text-center px-3 py-2 font-semibold">Producido</th>
                <th className="text-center px-3 py-2 font-semibold">Traspasos</th>
                <th className="text-center px-3 py-2 font-semibold">Merma</th>
                <th className="text-center px-3 py-2 font-semibold">Pedidos</th>
                <th className="text-center px-3 py-2 font-semibold">Stock actual</th>
                <th className="text-center px-3 py-2 font-semibold">Mínimo</th>
                <th className="text-center px-3 py-2 font-semibold">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {stockItems.map((item) => {
                const estado = item.stock <= 0 ? 'sin-stock' : item.stock < item.minimo ? 'bajo' : 'ok'
                return (
                  <tr key={item.productoId} className={cn(
                    'hover:bg-gray-50',
                    estado === 'sin-stock' && 'bg-red-50/50',
                    estado === 'bajo' && 'bg-amber-50/50',
                  )}>
                    <td className="px-4 py-2 font-medium text-gray-900">{item.nombre}</td>
                    <td className="px-3 py-2 text-center text-gray-500 font-mono text-xs">{item.codigo}</td>
                    <td className="px-3 py-2 text-center text-gray-600">{item.producido}</td>
                    <td className="px-3 py-2 text-center text-gray-600">{item.traspasado}</td>
                    <td className="px-3 py-2 text-center text-gray-600">{item.merma}</td>
                    <td className="px-3 py-2 text-center text-gray-600">{item.entregadoPedidos}</td>
                    <td className={cn('px-3 py-2 text-center font-bold',
                      estado === 'sin-stock' ? 'text-red-600' : estado === 'bajo' ? 'text-amber-600' : 'text-green-600'
                    )}>
                      {item.stock}
                    </td>
                    <td className="px-3 py-2 text-center text-gray-400">{item.minimo}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={cn(
                        'text-xs font-medium px-2 py-0.5 rounded-full',
                        estado === 'sin-stock' ? 'bg-red-100 text-red-700' :
                        estado === 'bajo' ? 'bg-amber-100 text-amber-700' :
                        'bg-green-100 text-green-700'
                      )}>
                        {estado === 'sin-stock' ? 'Sin stock' : estado === 'bajo' ? 'Bajo mínimo' : 'OK'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
