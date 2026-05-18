import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type CanalAdicional = 'todos' | 'plato' | 'vianda';
export type OrigenAdicional = 'insumo' | 'elaborado';

export interface AdicionalItem {
  id: string;
  cocina_producto_id: string;
  insumo_id: string | null;
  elaborado_id: string | null;
  cantidad: number;
  unidad: string;
  canal: CanalAdicional;
  origen: OrigenAdicional;
  origen_nombre: string;
  origen_unidad: string;
  origen_costo_unitario: number;
}

interface RawRow {
  id: string;
  cocina_producto_id: string;
  insumo_id: string | null;
  elaborado_id: string | null;
  cantidad: number;
  unidad: string;
  canal: CanalAdicional;
  insumo: { nombre: string; unidad: string; costo_unitario: number } | null;
  elaborado: { nombre: string; unidad: string } | null;
}

export function useAdicionalesProducto(cocinaProductoId: string | null) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['cocina-productos-adicionales', cocinaProductoId],
    enabled: !!cocinaProductoId,
    queryFn: async (): Promise<AdicionalItem[]> => {
      if (!cocinaProductoId) return [];
      const { data, error } = await supabase
        .from('cocina_productos_adicionales')
        .select(
          'id, cocina_producto_id, insumo_id, elaborado_id, cantidad, unidad, canal, ' +
            'insumo:productos(nombre, unidad, costo_unitario), ' +
            'elaborado:cocina_productos!cocina_productos_adicionales_elaborado_id_fkey(nombre, unidad)',
        )
        .eq('cocina_producto_id', cocinaProductoId);
      if (error) throw error;
      return (data as unknown as RawRow[]).map((r) => {
        const origen: OrigenAdicional = r.insumo_id ? 'insumo' : 'elaborado';
        return {
          id: r.id,
          cocina_producto_id: r.cocina_producto_id,
          insumo_id: r.insumo_id,
          elaborado_id: r.elaborado_id,
          cantidad: Number(r.cantidad),
          unidad: r.unidad,
          canal: r.canal,
          origen,
          origen_nombre:
            origen === 'insumo' ? r.insumo?.nombre ?? '(sin nombre)' : r.elaborado?.nombre ?? '(sin nombre)',
          origen_unidad: origen === 'insumo' ? r.insumo?.unidad ?? '' : r.elaborado?.unidad ?? '',
          origen_costo_unitario: origen === 'insumo' ? Number(r.insumo?.costo_unitario ?? 0) : 0,
        };
      });
    },
  });

  const agregar = useMutation({
    mutationFn: async (payload: {
      origen: OrigenAdicional;
      origen_id: string;
      cantidad: number;
      unidad: string;
      canal: CanalAdicional;
    }) => {
      if (!cocinaProductoId) throw new Error('Sin producto seleccionado');
      const insert: Record<string, unknown> = {
        cocina_producto_id: cocinaProductoId,
        cantidad: payload.cantidad,
        unidad: payload.unidad,
        canal: payload.canal,
        insumo_id: payload.origen === 'insumo' ? payload.origen_id : null,
        elaborado_id: payload.origen === 'elaborado' ? payload.origen_id : null,
      };
      const { error } = await supabase.from('cocina_productos_adicionales').insert(insert);
      if (error) throw error;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['cocina-productos-adicionales', cocinaProductoId] }),
  });

  const actualizar = useMutation({
    mutationFn: async (payload: {
      id: string;
      patch: Partial<{ cantidad: number; unidad: string; canal: CanalAdicional }>;
    }) => {
      const { error } = await supabase
        .from('cocina_productos_adicionales')
        .update(payload.patch)
        .eq('id', payload.id);
      if (error) throw error;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['cocina-productos-adicionales', cocinaProductoId] }),
  });

  const eliminar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('cocina_productos_adicionales').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['cocina-productos-adicionales', cocinaProductoId] }),
  });

  return { ...query, agregar, actualizar, eliminar };
}
