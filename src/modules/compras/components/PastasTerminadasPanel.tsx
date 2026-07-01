import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

interface VistaStockPasta {
  producto_id: string;
  nombre: string;
  codigo: string;
  local: string;
  minimo_produccion: number | null;
  porciones_camara: number | null;
  porciones_fresco: number | null;
  porciones_traspasadas: number | null;
  porciones_merma: number | null;
}

interface Row {
  id: string;
  nombre: string;
  codigo: string;
  frescos: number;
  stock: number;
  minimo: number;
}

/**
 * Panel read-only con el stock de pastas terminadas del local.
 * Lee de la vista canónica `v_cocina_stock_pastas` (misma que Cocina → Stock,
 * Dashboard y Traspasos): stock de cámara = último conteo físico (baseline) +
 * porcionado/traslados/merma/ajustes posteriores. Antes este panel sumaba todo
 * el histórico de lotes sin baseline y sobrecontaba (ej. 341 vs 88 reales).
 * El encargado de compras ve el disponible pero no lo edita (gestión en Cocina).
 */
export function PastasTerminadasPanel({
  local,
  filtro,
}: {
  local: 'vedia' | 'saavedra';
  filtro: string;
}) {
  const [abierto, setAbierto] = useState(true);

  const { data: vista } = useQuery({
    queryKey: ['compras-pastas-vista-stock', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_cocina_stock_pastas')
        .select(
          'producto_id, nombre, codigo, local, minimo_produccion, porciones_camara, porciones_fresco, porciones_traspasadas, porciones_merma',
        )
        .eq('local', local)
        .order('nombre');
      if (error) throw error;
      return data as VistaStockPasta[];
    },
  });

  const rows = useMemo<Row[]>(() => {
    if (!vista) return [];
    return vista.map((v) => {
      // Disponible en cámara = cámara (baseline + producido posterior) − traslados − merma.
      // Espeja exactamente el "Stock disponible" de Cocina → Stock.
      const stock =
        Number(v.porciones_camara ?? 0) -
        Number(v.porciones_traspasadas ?? 0) -
        Number(v.porciones_merma ?? 0);
      return {
        id: v.producto_id,
        nombre: v.nombre,
        codigo: v.codigo,
        frescos: Number(v.porciones_fresco ?? 0),
        stock: Math.max(0, stock),
        minimo: v.minimo_produccion ?? 0,
      };
    });
  }, [vista]);

  const rowsFiltradas = useMemo(() => {
    if (!filtro.trim()) return rows;
    const q = filtro
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    return rows.filter((r) =>
      (r.nombre + ' ' + r.codigo)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .includes(q),
    );
  }, [rows, filtro]);

  const totalDisponible = rowsFiltradas.reduce((s, r) => s + Math.max(0, r.stock), 0);
  const totalFrescos = rowsFiltradas.reduce((s, r) => s + r.frescos, 0);
  const sinStock = rowsFiltradas.filter((r) => r.stock <= 0).length;
  const bajoMin = rowsFiltradas.filter(
    (r) => r.minimo > 0 && r.stock > 0 && r.stock < r.minimo,
  ).length;

  if (rows.length === 0) return null;

  return (
    <div className="mb-4 rounded-lg border border-surface-border bg-white">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center justify-between rounded-lg px-4 py-3 text-left hover:bg-gray-50"
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-800">
            🍝 Pastas terminadas (de cocina)
          </span>
          <span className="text-xs text-gray-500">
            {totalDisponible} porciones disponibles · {totalFrescos} frescas por porcionar
          </span>
          {(sinStock > 0 || bajoMin > 0) && (
            <span className="text-xs text-orange-600">
              {sinStock > 0 && `${sinStock} sin stock`}
              {sinStock > 0 && bajoMin > 0 && ' · '}
              {bajoMin > 0 && `${bajoMin} bajo mínimo`}
            </span>
          )}
        </div>
        <span className="text-xs text-gray-400">{abierto ? '▲' : '▼'}</span>
      </button>

      {abierto && (
        <div className="overflow-x-auto border-t border-gray-100">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">
                  Producto
                </th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Código</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">
                  Stock disponible
                </th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">
                  Frescos
                </th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Mínimo</th>
                <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">
                  Estado
                </th>
              </tr>
            </thead>
            <tbody>
              {rowsFiltradas.map((r) => {
                const sin = r.stock <= 0;
                const bajo = r.minimo > 0 && r.stock > 0 && r.stock < r.minimo;
                return (
                  <tr
                    key={r.id}
                    className={cn(
                      'border-b border-gray-50 hover:bg-gray-50',
                      sin && 'bg-red-50/60',
                      bajo && 'bg-orange-50/60',
                    )}
                  >
                    <td className="px-4 py-2 font-medium text-gray-900">{r.nombre}</td>
                    <td className="px-4 py-2 font-mono text-xs text-gray-600">{r.codigo}</td>
                    <td className="px-4 py-2 text-right font-semibold">
                      <span
                        className={
                          sin ? 'text-red-600' : bajo ? 'text-orange-600' : 'text-gray-900'
                        }
                      >
                        {r.stock} porc.
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      {r.frescos > 0 ? (
                        <span className="text-blue-600">{r.frescos}</span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right text-xs text-gray-500">
                      {r.minimo > 0 ? r.minimo : '—'}
                    </td>
                    <td className="px-4 py-2 text-center">
                      {sin ? (
                        <span className="inline-block rounded bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700">
                          Sin stock
                        </span>
                      ) : bajo ? (
                        <span className="inline-block rounded bg-orange-100 px-2 py-0.5 text-[10px] font-medium text-orange-700">
                          Bajo mínimo
                        </span>
                      ) : (
                        <span className="inline-block rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                          OK
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rowsFiltradas.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-4 text-center text-xs text-gray-400">
                    Sin resultados
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="border-t border-gray-100 bg-gray-50 px-4 py-2 text-[11px] text-gray-500">
            Gestionado desde <span className="font-medium text-gray-700">Cocina → Stock</span>.
            Read-only desde acá.
          </div>
        </div>
      )}
    </div>
  );
}
