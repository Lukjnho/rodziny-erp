import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { KPICard } from '@/components/ui/KPICard';
import { cn } from '@/lib/utils';
import { PRODUCTOS_COCINA, normNombre } from './DashboardTab';
import { StockProduccionSection } from './components/StockProduccionSection';

interface Producto {
  id: string;
  nombre: string;
  codigo: string;
  tipo: string;
  unidad: string;
  minimo_produccion: number | null;
  local: string;
  activo: boolean;
}
interface LotePasta {
  producto_id: string;
  porciones: number | null;
  local: string;
  ubicacion: 'freezer_produccion' | 'camara_congelado';
}
interface Traspaso {
  producto_id: string;
  porciones: number;
  local: string;
}
interface Merma {
  producto_id: string;
  porciones: number;
  local: string;
}
interface FudoRankingItem {
  nombre: string;
  cantidad: number;
  facturacion: number;
  categoria: string;
}
interface FudoData {
  dias: number;
  ranking: FudoRankingItem[];
}

type FiltroLocal = 'todos' | 'vedia' | 'saavedra';

interface StockRow {
  producto: Producto;
  local: string;
  producido: number;
  fresco: number;
  traspasado: number;
  vendidoHoy: number;
  mostrador: number;
  merma: number;
  stock: number;
}

const HOY = () => new Date().toISOString().slice(0, 10);

// Mapa nombre normalizado → config con fudoNombres (para resolver ventas de Fudo por producto)
const PRODUCTO_POR_NOMBRE = new Map(
  PRODUCTOS_COCINA.map((p) => [normNombre(p.nombre), p] as const),
);

function ventasFudoDelProducto(producto: Producto, ranking: FudoRankingItem[] | undefined) {
  if (!ranking || ranking.length === 0) return 0;
  const cfg = PRODUCTO_POR_NOMBRE.get(normNombre(producto.nombre));
  const nombres = cfg?.fudoNombres ?? [producto.nombre];
  let total = 0;
  for (const n of nombres) {
    const hit = ranking.find((r) => r.nombre.toLowerCase() === n.toLowerCase());
    if (hit) total += hit.cantidad;
  }
  return total;
}

export function StockTab() {
  const [filtroLocal, setFiltroLocal] = useState<FiltroLocal>('todos');
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'bajo' | 'sin_stock' | 'con_fresco'>(
    'todos',
  );
  const hoy = HOY();

  const { data: productos } = useQuery({
    queryKey: ['cocina-productos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_productos')
        .select('*')
        .eq('activo', true)
        .order('nombre');
      if (error) throw error;
      return data as Producto[];
    },
  });

  const { data: lotesPasta } = useQuery({
    queryKey: ['cocina-stock-lotes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_pasta')
        .select('producto_id, porciones, local, ubicacion');
      if (error) throw error;
      return data as LotePasta[];
    },
  });

  const { data: traspasos } = useQuery({
    queryKey: ['cocina-stock-traspasos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_traspasos')
        .select('producto_id, porciones, local');
      if (error) throw error;
      return data as Traspaso[];
    },
  });

  const { data: traspasosHoy } = useQuery({
    queryKey: ['cocina-stock-traspasos-hoy', hoy],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_traspasos')
        .select('producto_id, porciones, local')
        .eq('fecha', hoy);
      if (error) throw error;
      return data as Traspaso[];
    },
  });

  const { data: mermas } = useQuery({
    queryKey: ['cocina-stock-merma'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_merma')
        .select('producto_id, porciones, local');
      if (error) throw error;
      return data as Merma[];
    },
  });

  const { data: mermasHoy } = useQuery({
    queryKey: ['cocina-stock-merma-hoy', hoy],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_merma')
        .select('producto_id, porciones, local')
        .eq('fecha', hoy);
      if (error) throw error;
      return data as Merma[];
    },
  });

  // Ventas Fudo del día — solo Vedia tiene API habilitada (fudoApi.ts: Saavedra pendiente)
  const { data: fudoVedia } = useQuery({
    queryKey: ['cocina-stock-fudo', 'vedia', hoy],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('fudo-productos', {
        body: { local: 'vedia', fechaDesde: hoy, fechaHasta: hoy },
      });
      if (error) return null;
      if (!data?.ok) return null;
      return data.data as FudoData;
    },
    staleTime: 2 * 60 * 1000, // refrescar cada 2 min
  });

  const isLoading =
    !productos || !lotesPasta || !traspasos || !mermas || !traspasosHoy || !mermasHoy;

  // Calcular stock por producto × local
  const stockRows = useMemo(() => {
    if (!productos || !lotesPasta || !traspasos || !mermas || !traspasosHoy || !mermasHoy)
      return [];

    const rows: StockRow[] = [];
    const locales: string[] = filtroLocal === 'todos' ? ['vedia', 'saavedra'] : [filtroLocal];

    for (const prod of productos) {
      for (const loc of locales) {
        if (prod.local !== loc) continue;

        // Producido en cámara = stock disponible. "Pastas en produ" = frescas sin porcionar (no cuentan como stock vendible).
        const producido = lotesPasta
          .filter(
            (l) =>
              l.producto_id === prod.id && l.local === loc && l.ubicacion === 'camara_congelado',
          )
          .reduce((s, l) => s + (l.porciones ?? 0), 0);
        const fresco = lotesPasta
          .filter(
            (l) =>
              l.producto_id === prod.id && l.local === loc && l.ubicacion === 'freezer_produccion',
          )
          .reduce((s, l) => s + (l.porciones ?? 0), 0);
        const traspasado = traspasos
          .filter((t) => t.producto_id === prod.id && t.local === loc)
          .reduce((s, t) => s + t.porciones, 0);
        const mermaTotal = mermas
          .filter((m) => m.producto_id === prod.id && m.local === loc)
          .reduce((s, m) => s + m.porciones, 0);

        // Stock del día en el freezer del mostrador (aproximado hasta Fase 2 con conteo físico):
        //   traspasos_hoy − ventas_fudo_hoy − merma_hoy
        // Asume que el mostrador arranca vacío cada día. Solo Vedia tiene ventas de Fudo hoy.
        const traspasadoHoy = traspasosHoy
          .filter((t) => t.producto_id === prod.id && t.local === loc)
          .reduce((s, t) => s + t.porciones, 0);
        const mermaDelDia = mermasHoy
          .filter((m) => m.producto_id === prod.id && m.local === loc)
          .reduce((s, m) => s + m.porciones, 0);
        const vendidoHoy =
          loc === 'vedia' ? ventasFudoDelProducto(prod, fudoVedia?.ranking) : 0;
        const mostrador = Math.max(0, traspasadoHoy - vendidoHoy - mermaDelDia);

        const stock = producido - traspasado - mermaTotal;

        // Solo mostrar si hay actividad o stock
        if (producido > 0 || fresco > 0 || traspasado > 0 || mermaTotal > 0 || mostrador > 0) {
          rows.push({
            producto: prod,
            local: loc,
            producido,
            fresco,
            traspasado,
            vendidoHoy,
            mostrador,
            merma: mermaTotal,
            stock,
          });
        }
      }
    }

    return rows.sort((a, b) => a.stock - b.stock); // los de menor stock primero
  }, [
    productos,
    lotesPasta,
    traspasos,
    mermas,
    traspasosHoy,
    mermasHoy,
    fudoVedia,
    filtroLocal,
  ]);

  const kpis = useMemo(() => {
    const totalProductos = stockRows.length;
    const bajoMinimo = stockRows.filter(
      (r) => r.producto.minimo_produccion && r.stock < r.producto.minimo_produccion && r.stock > 0,
    ).length;
    const sinStock = stockRows.filter((r) => r.stock <= 0).length;
    const totalPorciones = stockRows.reduce((s, r) => s + Math.max(0, r.stock), 0);
    const totalFrescos = stockRows.reduce((s, r) => s + r.fresco, 0);
    const conFresco = stockRows.filter((r) => r.fresco > 0).length;
    const totalMostrador = stockRows.reduce((s, r) => s + r.mostrador, 0);
    const conMostrador = stockRows.filter((r) => r.mostrador > 0).length;
    return {
      totalProductos,
      bajoMinimo,
      sinStock,
      totalPorciones,
      totalFrescos,
      conFresco,
      totalMostrador,
      conMostrador,
    };
  }, [stockRows]);

  // Filtro de estado aplicado solo a la tabla (los KPIs muestran totales)
  const stockRowsFiltrados = useMemo(() => {
    if (filtroEstado === 'todos') return stockRows;
    if (filtroEstado === 'bajo') {
      return stockRows.filter(
        (r) =>
          r.producto.minimo_produccion && r.stock < r.producto.minimo_produccion && r.stock > 0,
      );
    }
    if (filtroEstado === 'sin_stock') return stockRows.filter((r) => r.stock <= 0);
    if (filtroEstado === 'con_fresco') return stockRows.filter((r) => r.fresco > 0);
    return stockRows;
  }, [stockRows, filtroEstado]);

  return (
    <div className="space-y-4">
      {/* KPIs — clickeables para filtrar la tabla */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <KPICard
          label="Productos en stock"
          value={String(kpis.totalProductos)}
          color="blue"
          loading={isLoading}
          onClick={() => {
            setFiltroEstado('todos');
            setFiltroLocal('todos');
          }}
        />
        <KPICard
          label="Bajo mínimo"
          value={String(kpis.bajoMinimo)}
          color="yellow"
          loading={isLoading}
          active={filtroEstado === 'bajo'}
          onClick={() => setFiltroEstado(filtroEstado === 'bajo' ? 'todos' : 'bajo')}
        />
        <KPICard
          label="Sin stock"
          value={String(kpis.sinStock)}
          color="red"
          loading={isLoading}
          active={filtroEstado === 'sin_stock'}
          onClick={() => setFiltroEstado(filtroEstado === 'sin_stock' ? 'todos' : 'sin_stock')}
        />
        <KPICard
          label="En cámara"
          value={String(kpis.totalPorciones)}
          color="green"
          loading={isLoading}
        />
        <KPICard
          label="En mostrador"
          value={String(kpis.totalMostrador)}
          color={kpis.totalMostrador > 0 ? 'green' : 'neutral'}
          loading={isLoading}
        />
        <KPICard
          label="Pastas en produ"
          value={String(kpis.totalFrescos)}
          color={kpis.totalFrescos > 0 ? 'blue' : 'neutral'}
          loading={isLoading}
          active={filtroEstado === 'con_fresco'}
          onClick={
            kpis.conFresco > 0
              ? () => setFiltroEstado(filtroEstado === 'con_fresco' ? 'todos' : 'con_fresco')
              : undefined
          }
        />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-surface-border bg-white p-3">
        <select
          value={filtroLocal}
          onChange={(e) => setFiltroLocal(e.target.value as FiltroLocal)}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm"
        >
          <option value="todos">Todos los locales</option>
          <option value="vedia">Vedia</option>
          <option value="saavedra">Saavedra</option>
        </select>
        <span className="ml-auto text-xs text-gray-400">
          En cámara (depósito) = histórico − traspasos − merma · En mostrador = traspasos hoy −
          ventas Fudo − merma hoy · Pastas en produ = frescas sin porcionar
        </span>
      </div>

      {/* Tabla de pastas */}
      <h3 className="text-base font-semibold text-gray-800">Pastas</h3>
      <div className="overflow-x-auto rounded-lg border border-surface-border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border bg-gray-50 text-left text-xs uppercase text-gray-500">
              <th className="px-4 py-2">Producto</th>
              <th className="px-4 py-2">Código</th>
              <th className="px-4 py-2">Local</th>
              <th className="px-4 py-2 text-right">Pastas en produ</th>
              <th className="px-4 py-2 text-right">En cámara</th>
              <th className="px-4 py-2 text-right">En mostrador</th>
              <th className="px-4 py-2 text-right">Vendido hoy</th>
              <th className="px-4 py-2 text-right">Merma</th>
              <th className="px-4 py-2">Mín.</th>
              <th className="px-4 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {stockRowsFiltrados.map((r, i) => {
              const min = r.producto.minimo_produccion ?? 0;
              const estado = r.stock <= 0 ? 'sin-stock' : r.stock < min ? 'bajo' : 'ok';
              return (
                <tr
                  key={`${r.producto.id}-${r.local}-${i}`}
                  className={cn(
                    'border-b border-surface-border',
                    estado === 'sin-stock' && 'bg-red-50',
                    estado === 'bajo' && 'bg-yellow-50',
                  )}
                >
                  <td className="px-4 py-2 font-medium">{r.producto.nombre}</td>
                  <td className="px-4 py-2 font-mono text-xs">{r.producto.codigo}</td>
                  <td className="px-4 py-2 capitalize">{r.local}</td>
                  <td className="px-4 py-2 text-right">
                    {r.fresco > 0 ? (
                      <span className="font-medium text-blue-600">{r.fresco}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-2 text-right font-semibold">{r.stock}</td>
                  <td className="px-4 py-2 text-right">
                    {r.mostrador > 0 ? (
                      <span className="font-medium text-green-700">{r.mostrador}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-2 text-right text-gray-500">
                    {r.vendidoHoy > 0 ? r.vendidoHoy : '—'}
                  </td>
                  <td className="px-4 py-2 text-right">{r.merma}</td>
                  <td className="px-4 py-2">{min || '—'}</td>
                  <td className="px-4 py-2">
                    {estado === 'ok' && (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                        OK
                      </span>
                    )}
                    {estado === 'bajo' && (
                      <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-700">
                        Bajo mínimo
                      </span>
                    )}
                    {estado === 'sin-stock' && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
                        Sin stock
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {stockRowsFiltrados.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-gray-400">
                  {isLoading
                    ? 'Cargando...'
                    : filtroEstado !== 'todos'
                      ? 'No hay productos con ese estado en el filtro actual'
                      : 'No hay datos de stock aún'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Otras producciones: salsas, postres, pastelería, panadería ────── */}
      <div className="pt-6">
        <h3 className="mb-3 text-base font-semibold text-gray-800">
          Salsas, postres y otras producciones
        </h3>
        <StockProduccionSection filtroLocal={filtroLocal} />
      </div>
    </div>
  );
}
