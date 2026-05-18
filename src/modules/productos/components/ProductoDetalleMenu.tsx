import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { useCostoCompleto, type Canal } from '../hooks/useCostoCompleto';
import { type CanalAdicional } from '../hooks/useAdicionalesProducto';
import { WaterfallCard, PackagingCard, AdicionalesCard, CANALES } from './CosteoCards';
import { HistorialPrecioCard } from './HistorialPrecioCard';

// Detalle del PRODUCTO VENDIBLE (lado venta): packaging, adicionales de
// servicio, costo total y margen por canal, e histórico de precio. La receta
// (ingredientes/costo base) se edita en el tab Costeo.

interface ProductoRow {
  id: string;
  nombre: string;
  codigo: string;
  tipo: string;
  local: string;
  receta_id: string | null;
  insumo_reventa_id: string | null;
}

const TIPO_COLOR: Record<string, string> = {
  pasta: 'bg-blue-100 text-blue-700',
  salsa: 'bg-orange-100 text-orange-700',
  postre: 'bg-pink-100 text-pink-700',
  panificado: 'bg-amber-100 text-amber-700',
  bebida: 'bg-cyan-100 text-cyan-700',
};

export function ProductoDetalleMenu({
  productoId,
  onVolver,
  onEditarDefinicion,
}: {
  productoId: string;
  onVolver: () => void;
  onEditarDefinicion: () => void;
}) {
  const [canal, setCanal] = useState<Canal>('plato');
  const [medioPago, setMedioPago] = useState('qr');

  const { data: producto } = useQuery({
    queryKey: ['menu-detalle-producto', productoId],
    queryFn: async (): Promise<ProductoRow | null> => {
      const { data, error } = await supabase
        .from('cocina_productos')
        .select('id, nombre, codigo, tipo, local, receta_id, insumo_reventa_id')
        .eq('id', productoId)
        .maybeSingle();
      if (error) throw error;
      return data as ProductoRow | null;
    },
  });

  const costo = useCostoCompleto(productoId, canal, medioPago);
  const esReventa = !!producto && !producto.receta_id && !!producto.insumo_reventa_id;

  return (
    <div className="space-y-4">
      <button
        onClick={onVolver}
        className="text-sm text-rodziny-700 hover:text-rodziny-900"
      >
        ← Volver al menú
      </button>

      <section className="rounded-lg border border-rodziny-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-gray-900">
                {producto?.nombre ?? '…'}
              </h2>
              {producto && (
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[10px] font-medium capitalize',
                    TIPO_COLOR[producto.tipo] ?? 'bg-gray-100 text-gray-600',
                  )}
                >
                  {producto.tipo}
                </span>
              )}
              {esReventa && (
                <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] text-sky-700">
                  reventa
                </span>
              )}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              <span className="font-mono">{producto?.codigo}</span> ·{' '}
              <span className="capitalize">{producto?.local}</span> · el precio por canal y el
              costo de receta se cargan en sus tabs (Menú / Costeo)
            </div>
            <button
              onClick={onEditarDefinicion}
              className="mt-2 rounded border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50"
            >
              ✎ Editar definición
            </button>
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-gray-500">
              Canal
            </label>
            <div className="flex gap-1">
              {CANALES.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setCanal(c.value)}
                  className={cn(
                    'rounded px-2.5 py-1.5 text-xs font-medium transition-colors',
                    canal === c.value
                      ? 'bg-rodziny-700 text-white'
                      : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
                  )}
                >
                  {c.icon} {c.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Packaging */}
      <PackagingCard cocinaProductoId={productoId} canalFiltro={canal} />

      {/* Adicionales de servicio */}
      {canal !== 'congelado' ? (
        <AdicionalesCard cocinaProductoId={productoId} canalFiltro={canal as CanalAdicional} />
      ) : (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-500">
          El canal congelado no lleva adicionales de servicio.
        </div>
      )}

      {/* Costo total + margen (lado venta — sí muestra precio/margen) */}
      {costo && <WaterfallCard costo={costo} medio={medioPago} setMedio={setMedioPago} />}

      {/* Histórico de precio */}
      <HistorialPrecioCard cocinaProductoId={productoId} />
    </div>
  );
}
