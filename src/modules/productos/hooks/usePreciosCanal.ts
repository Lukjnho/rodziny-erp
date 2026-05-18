import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// Canal de venta. 'plato' = servicio en Salón (label de UI: "Salón").
export type CanalPrecio = 'plato' | 'vianda' | 'congelado';
export const CANALES_PRECIO: CanalPrecio[] = ['plato', 'vianda', 'congelado'];

export interface PrecioCanalRow {
  id: string;
  cocina_producto_id: string;
  canal: CanalPrecio;
  precio: number;
}

export type PreciosPorCanal = Record<CanalPrecio, number | null>;

// Lee/escribe el precio de venta por canal de un producto.
// Fuente de verdad: cocina_productos_precios_canal. El precio del canal 'plato'
// se espeja a cocina_productos.precio_venta por trigger (no hay que tocarlo acá).
export function usePreciosCanal(cocinaProductoId: string | null) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['cocina-productos-precios-canal', cocinaProductoId],
    enabled: !!cocinaProductoId,
    queryFn: async (): Promise<PrecioCanalRow[]> => {
      if (!cocinaProductoId) return [];
      const { data, error } = await supabase
        .from('cocina_productos_precios_canal')
        .select('id, cocina_producto_id, canal, precio')
        .eq('cocina_producto_id', cocinaProductoId);
      if (error) throw error;
      return (data as PrecioCanalRow[]).map((r) => ({ ...r, precio: Number(r.precio) }));
    },
  });

  const precios = useMemo<PreciosPorCanal>(() => {
    const base: PreciosPorCanal = { plato: null, vianda: null, congelado: null };
    for (const r of query.data ?? []) base[r.canal] = r.precio;
    return base;
  }, [query.data]);

  // Upsert por (producto, canal). Unique constraint → onConflict actualiza.
  const setPrecio = useMutation({
    mutationFn: async (payload: { canal: CanalPrecio; precio: number }) => {
      if (!cocinaProductoId) throw new Error('Sin producto seleccionado');
      const { error } = await supabase
        .from('cocina_productos_precios_canal')
        .upsert(
          {
            cocina_producto_id: cocinaProductoId,
            canal: payload.canal,
            precio: payload.precio,
          },
          { onConflict: 'cocina_producto_id,canal' },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ['cocina-productos-precios-canal', cocinaProductoId],
      });
      // El trigger espeja el canal 'plato' a precio_venta → refrescar lo que lo lee.
      qc.invalidateQueries({ queryKey: ['ficha-productos'] });
      qc.invalidateQueries({ queryKey: ['productos-costeo'] });
      qc.invalidateQueries({ queryKey: ['historial-precio'] });
    },
  });

  const borrarCanal = useMutation({
    mutationFn: async (canal: CanalPrecio) => {
      if (!cocinaProductoId) throw new Error('Sin producto seleccionado');
      const { error } = await supabase
        .from('cocina_productos_precios_canal')
        .delete()
        .eq('cocina_producto_id', cocinaProductoId)
        .eq('canal', canal);
      if (error) throw error;
    },
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ['cocina-productos-precios-canal', cocinaProductoId],
      }),
  });

  return { ...query, precios, setPrecio, borrarCanal };
}
