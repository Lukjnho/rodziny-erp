import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type CanalPackaging = 'todos' | 'plato' | 'vianda' | 'congelado';
/** @deprecated usar CanalPackaging o Canal de useCostoCompleto */
export type Canal = CanalPackaging;

export interface PackagingItem {
  id: string;
  cocina_producto_id: string;
  insumo_id: string;
  cantidad: number;
  canal: Canal;
  insumo_nombre: string;
  insumo_unidad: string;
  insumo_costo_unitario: number;
}

interface RawRow {
  id: string;
  cocina_producto_id: string;
  insumo_id: string;
  cantidad: number;
  canal: Canal;
  insumo: { nombre: string; unidad: string; costo_unitario: number } | null;
}

export function usePackagingProducto(cocinaProductoId: string | null) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['cocina-productos-packaging', cocinaProductoId],
    enabled: !!cocinaProductoId,
    queryFn: async (): Promise<PackagingItem[]> => {
      if (!cocinaProductoId) return [];
      const { data, error } = await supabase
        .from('cocina_productos_packaging')
        .select('id, cocina_producto_id, insumo_id, cantidad, canal, insumo:productos(nombre, unidad, costo_unitario)')
        .eq('cocina_producto_id', cocinaProductoId);
      if (error) throw error;
      return (data as unknown as RawRow[]).map((r) => ({
        id: r.id,
        cocina_producto_id: r.cocina_producto_id,
        insumo_id: r.insumo_id,
        cantidad: Number(r.cantidad),
        canal: r.canal,
        insumo_nombre: r.insumo?.nombre ?? '(sin nombre)',
        insumo_unidad: r.insumo?.unidad ?? '',
        insumo_costo_unitario: Number(r.insumo?.costo_unitario ?? 0),
      }));
    },
  });

  const agregar = useMutation({
    mutationFn: async (payload: { insumo_id: string; cantidad: number; canal: Canal }) => {
      if (!cocinaProductoId) throw new Error('Sin producto seleccionado');
      const { error } = await supabase.from('cocina_productos_packaging').insert({
        cocina_producto_id: cocinaProductoId,
        insumo_id: payload.insumo_id,
        cantidad: payload.cantidad,
        canal: payload.canal,
      });
      if (error) throw error;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['cocina-productos-packaging', cocinaProductoId] }),
  });

  const actualizar = useMutation({
    mutationFn: async (payload: { id: string; patch: Partial<{ cantidad: number; canal: Canal }> }) => {
      const { error } = await supabase
        .from('cocina_productos_packaging')
        .update(payload.patch)
        .eq('id', payload.id);
      if (error) throw error;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['cocina-productos-packaging', cocinaProductoId] }),
  });

  const eliminar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('cocina_productos_packaging').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['cocina-productos-packaging', cocinaProductoId] }),
  });

  return { ...query, agregar, actualizar, eliminar };
}
