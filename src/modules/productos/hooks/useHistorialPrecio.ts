import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface CambioPrecio {
  id: string;
  cocina_producto_id: string;
  precio_anterior: number | null;
  precio_nuevo: number | null;
  variacion_pct: number | null;
  fecha: string;
  usuario: string | null;
  motivo: string | null;
}

export function useHistorialPrecio(cocinaProductoId: string | null) {
  return useQuery({
    queryKey: ['cocina-productos-precio-historial', cocinaProductoId],
    enabled: !!cocinaProductoId,
    queryFn: async (): Promise<CambioPrecio[]> => {
      if (!cocinaProductoId) return [];
      const { data, error } = await supabase
        .from('cocina_productos_precio_historial')
        .select('*')
        .eq('cocina_producto_id', cocinaProductoId)
        .order('fecha', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as CambioPrecio[];
    },
  });
}
