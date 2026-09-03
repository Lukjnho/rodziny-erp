import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import {
  SELECT_STOCK_PASTAS,
  vendibleHoy,
  bandejasEnProceso,
  type StockPastaRow,
} from '@/modules/cocina/lib/stockPastas';

interface Row {
  id: string;
  nombre: string;
  codigo: string;
  /** Bandejas armadas esperando el porcionado. NO son porciones vendibles. */
  bandejas: number;
  stock: number;
  minimo: number;
}

/**
 * Panel read-only con el stock de pastas terminadas del local.
 *
 * Lee la cuenta única de la base (migración 161) a través de
 * `cocina/lib/stockPastas`: acá NO se hace ninguna resta. Antes este panel
 * restaba a mano cámara − traslados − merma, igual que otras cinco pantallas,
 * cada una con su propia variante.
 *
 * La columna de bandejas cambió de significado: antes leía `porciones_fresco`,
 * que daba 0 SIEMPRE (en el freezer de producción las porciones son NULL), así
 * que la pasta armada nunca se veía. Ahora muestra bandejas de verdad.
 *
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
        .select(SELECT_STOCK_PASTAS)
        .eq('local', local)
        .order('nombre');
      if (error) throw error;
      return data as unknown as StockPastaRow[];
    },
  });

  const rows = useMemo<Row[]>(() => {
    if (!vista) return [];
    // Sin aritmética: la resta ya viene hecha de la base.
    return vista.map((v) => ({
      id: v.producto_id,
      nombre: v.nombre,
      codigo: v.codigo,
      bandejas: bandejasEnProceso(v),
      stock: vendibleHoy(v),
      minimo: v.minimo_produccion ?? 0,
    }));
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
  const totalBandejas = rowsFiltradas.reduce((s, r) => s + r.bandejas, 0);
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
            {totalDisponible} porciones disponibles · {totalBandejas} bandejas por porcionar
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
                  Por porcionar
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
                      {r.bandejas > 0 ? (
                        <span className="text-blue-600">{r.bandejas} band.</span>
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
