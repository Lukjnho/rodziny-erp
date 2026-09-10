import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

interface LotePasta {
  producto_id: string;
  porciones: number | null;
  producto: {
    nombre: string;
    codigo: string;
    minimo_produccion: number | null;
    activo: boolean;
  }[] | null;
}

interface Traspaso {
  producto_id: string;
  porciones: number;
}

interface Merma {
  producto_id: string;
  porciones: number;
}

interface PedidoEntregado {
  producto_id: string | null;
  producto_nombre: string;
  cantidad: number;
}

interface StockItem {
  productoId: string;
  nombre: string;
  codigo: string;
  producido: number;
  traspasado: number;
  merma: number;
  entregadoPedidos: number;
  stock: number;
  minimo: number | null;
}

export function StockCongeladosTab() {
  // Lotes de pasta producidos (solo saavedra, productos congelables)
  const { data: lotes } = useQuery({
    queryKey: ['almacen-stock-lotes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_pasta')
        .select(
          'producto_id, porciones, producto:cocina_productos(nombre, codigo, minimo_produccion, activo)',
        )
        .eq('local', 'saavedra');
      if (error) throw error;
      return data as LotePasta[];
    },
  });

  // Traspasos de saavedra
  const { data: traspasos } = useQuery({
    queryKey: ['almacen-stock-traspasos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_traspasos')
        .select('producto_id, porciones')
        .eq('local', 'saavedra');
      if (error) throw error;
      return data as Traspaso[];
    },
  });

  // Merma de saavedra
  const { data: mermas } = useQuery({
    queryKey: ['almacen-stock-merma'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_merma')
        .select('producto_id, porciones')
        .eq('local', 'saavedra');
      if (error) throw error;
      return data as Merma[];
    },
  });

  // Pedidos entregados (para descontar del stock)
  const { data: pedidosEntregados } = useQuery({
    queryKey: ['almacen-stock-pedidos-entregados'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('almacen_pedidos')
        .select('producto_id, producto_nombre, cantidad')
        .eq('estado', 'entregado')
        .eq('local', 'saavedra');
      if (error) throw error;
      return data as PedidoEntregado[];
    },
  });

  // Calcular stock por producto
  const isLoading = !lotes || !traspasos || !mermas || !pedidosEntregados;

  const stockItems: StockItem[] = [];

  if (!isLoading) {
    const mapa = new Map<string, StockItem>();

    // Producido
    for (const l of lotes) {
      const prod = Array.isArray(l.producto) ? l.producto[0] : l.producto;
      if (!prod) continue;
      // Los productos dados de baja seguían apareciendo con stock: el Capellacci
      // de Pollo está jubilado desde la migración 194 y mostraba 38 porciones.
      if (!prod.activo) continue;
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
        });
      }
      mapa.get(l.producto_id)!.producido += l.porciones ?? 0;
    }

    // Traspasado
    for (const t of traspasos) {
      const item = mapa.get(t.producto_id);
      if (item) item.traspasado += t.porciones;
    }

    // Merma
    for (const m of mermas) {
      const item = mapa.get(m.producto_id);
      if (item) item.merma += m.porciones;
    }

    // Pedidos entregados: preferir match por producto_id (preciso). Si el pedido
    // es legacy y no tiene producto_id, fallback a nombre pero solo descuenta del
    // PRIMER match para evitar doble descuento cuando hay productos homónimos.
    for (const p of pedidosEntregados) {
      if (p.producto_id) {
        const item = mapa.get(p.producto_id);
        if (item) item.entregadoPedidos += p.cantidad;
        continue;
      }
      const objetivo = p.producto_nombre.toLowerCase().trim();
      for (const item of mapa.values()) {
        if (item.nombre.toLowerCase().trim() === objetivo) {
          item.entregadoPedidos += p.cantidad;
          break;
        }
      }
    }

    // Calcular stock final
    for (const item of mapa.values()) {
      item.stock = item.producido - item.traspasado - item.merma - item.entregadoPedidos;
      stockItems.push(item);
    }

    stockItems.sort((a, b) => a.stock - b.stock);
  }

  // KPIs
  const totalProductos = stockItems.length;
  const sinStock = stockItems.filter((s) => s.stock <= 0).length;
  // Sin mínimo cargado no se puede decir si está bien o mal. Antes `stock >= null`
  // daba verdadero (null vale 0) y esos productos se contaban como "OK" siempre.
  const bajoMinimo = stockItems.filter(
    (s) => s.stock > 0 && s.minimo != null && s.minimo > 0 && s.stock < s.minimo,
  ).length;
  const ok = stockItems.filter(
    (s) => s.minimo != null && s.minimo > 0 && s.stock >= s.minimo,
  ).length;

  return (
    <div className="space-y-4">
      {/* Este número no resta lo que se vendió. Suma toda la producción de la
          historia y le resta traspasos, merma y pedidos — y en Saavedra no hay
          traspasos, así que nunca baja. Medido el 10-sep-2026: acá decía 2.715
          porciones y el conteo físico de la cámara daba 272. El número bueno
          sale de Cocina → Stock, que arranca del último conteo. */}
      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
        ⚠ <strong>Este stock está mal contado y no lo uses para tomar pedidos.</strong> Suma toda
        la producción desde siempre y nunca resta lo que se vendió, así que solo sube. El 10 de
        septiembre marcaba <strong>2.715 porciones</strong> cuando en la cámara había{' '}
        <strong>272</strong>. El número bueno está en <strong>Cocina → Stock</strong>, que parte
        del último conteo físico.
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
          <div className="text-2xl font-bold text-gray-700">{totalProductos}</div>
          <div className="text-xs text-gray-500">Productos</div>
        </div>
        <div
          className={cn(
            'rounded-lg border p-3 text-center',
            ok > 0 ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50',
          )}
        >
          <div className={cn('text-2xl font-bold', ok > 0 ? 'text-green-600' : 'text-gray-400')}>
            {ok}
          </div>
          <div className="text-xs text-gray-500">OK</div>
        </div>
        <div
          className={cn(
            'rounded-lg border p-3 text-center',
            bajoMinimo > 0 ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50',
          )}
        >
          <div
            className={cn(
              'text-2xl font-bold',
              bajoMinimo > 0 ? 'text-amber-600' : 'text-gray-400',
            )}
          >
            {bajoMinimo}
          </div>
          <div className="text-xs text-gray-500">Bajo mínimo</div>
        </div>
        <div
          className={cn(
            'rounded-lg border p-3 text-center',
            sinStock > 0 ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-gray-50',
          )}
        >
          <div
            className={cn('text-2xl font-bold', sinStock > 0 ? 'text-red-600' : 'text-gray-400')}
          >
            {sinStock}
          </div>
          <div className="text-xs text-gray-500">Sin stock</div>
        </div>
      </div>

      {/* Info */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700">
        El stock se calcula automáticamente: <strong>Producción</strong> (lotes de pasta) -{' '}
        <strong>Traspasos</strong> (depósito → mostrador) - <strong>Merma</strong> -{' '}
        <strong>Pedidos entregados</strong> (almacén). Los datos vienen del módulo Cocina.
      </div>

      {/* Tabla */}
      {isLoading ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
          Cargando...
        </div>
      ) : stockItems.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <div className="mb-2 text-3xl">📦</div>
          <p className="text-sm text-gray-500">
            No hay producción registrada para Saavedra todavía.
          </p>
          <p className="mt-1 text-xs text-gray-400">
            Registrá lotes en el módulo Cocina → Producción para ver el stock acá.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr className="text-xs uppercase text-gray-500">
                <th className="px-4 py-2 text-left font-semibold">Producto</th>
                <th className="px-3 py-2 text-center font-semibold">Código</th>
                <th className="px-3 py-2 text-center font-semibold">Producido</th>
                <th className="px-3 py-2 text-center font-semibold">Traspasos</th>
                <th className="px-3 py-2 text-center font-semibold">Merma</th>
                <th className="px-3 py-2 text-center font-semibold">Pedidos</th>
                <th className="px-3 py-2 text-center font-semibold">Stock actual</th>
                <th className="px-3 py-2 text-center font-semibold">Mínimo</th>
                <th className="px-3 py-2 text-center font-semibold">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {stockItems.map((item) => {
                // Sin mínimo cargado no se puede afirmar que esté OK. Antes caía
                // en el verde por descarte y Tortelli y Bondiola se pintaban bien
                // pasara lo que pasara.
                const sinMinimo = item.minimo == null || item.minimo <= 0;
                const estado =
                  item.stock <= 0
                    ? 'sin-stock'
                    : sinMinimo
                      ? 'sin-minimo'
                      : item.stock < item.minimo!
                        ? 'bajo'
                        : 'ok';
                return (
                  <tr
                    key={item.productoId}
                    className={cn(
                      'hover:bg-gray-50',
                      estado === 'sin-stock' && 'bg-red-50/50',
                      estado === 'bajo' && 'bg-amber-50/50',
                    )}
                  >
                    <td className="px-4 py-2 font-medium text-gray-900">{item.nombre}</td>
                    <td className="px-3 py-2 text-center font-mono text-xs text-gray-500">
                      {item.codigo}
                    </td>
                    <td className="px-3 py-2 text-center text-gray-600">{item.producido}</td>
                    <td className="px-3 py-2 text-center text-gray-600">{item.traspasado}</td>
                    <td className="px-3 py-2 text-center text-gray-600">{item.merma}</td>
                    <td className="px-3 py-2 text-center text-gray-600">{item.entregadoPedidos}</td>
                    <td
                      className={cn(
                        'px-3 py-2 text-center font-bold',
                        estado === 'sin-stock'
                          ? 'text-red-600'
                          : estado === 'bajo'
                            ? 'text-amber-600'
                            : estado === 'sin-minimo'
                              ? 'text-gray-500'
                              : 'text-green-600',
                      )}
                    >
                      {item.stock}
                    </td>
                    <td className="px-3 py-2 text-center text-gray-400">
                      {sinMinimo ? '—' : item.minimo}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-xs font-medium',
                          estado === 'sin-stock'
                            ? 'bg-red-100 text-red-700'
                            : estado === 'bajo'
                              ? 'bg-amber-100 text-amber-700'
                              : estado === 'sin-minimo'
                                ? 'bg-gray-100 text-gray-600'
                                : 'bg-green-100 text-green-700',
                        )}
                      >
                        {estado === 'sin-stock'
                          ? 'Sin stock'
                          : estado === 'bajo'
                            ? 'Bajo mínimo'
                            : estado === 'sin-minimo'
                              ? 'Sin mínimo'
                              : 'OK'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
