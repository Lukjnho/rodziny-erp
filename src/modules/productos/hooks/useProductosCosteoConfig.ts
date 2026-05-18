import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface ProductoCosteoConfig {
  categoria: string;
  markup_objetivo: number;
  margen_min: number;
  margen_max: number;
  redondeo: number;
  rango_mercado_min: number | null;
  rango_mercado_max: number | null;
  descripcion: string | null;
  updated_at: string;
}

export function useProductosCosteoConfig() {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['productos-costeo-config'],
    queryFn: async (): Promise<ProductoCosteoConfig[]> => {
      const { data, error } = await supabase
        .from('productos_costeo_config')
        .select('*')
        .order('categoria');
      if (error) throw error;
      return data as ProductoCosteoConfig[];
    },
  });

  const actualizar = useMutation({
    mutationFn: async (payload: { categoria: string; patch: Partial<ProductoCosteoConfig> }) => {
      const { error } = await supabase
        .from('productos_costeo_config')
        .update(payload.patch)
        .eq('categoria', payload.categoria);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['productos-costeo-config'] }),
  });

  const crear = useMutation({
    mutationFn: async (cfg: Omit<ProductoCosteoConfig, 'updated_at'>) => {
      const { error } = await supabase.from('productos_costeo_config').insert(cfg);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['productos-costeo-config'] }),
  });

  const eliminar = useMutation({
    mutationFn: async (categoria: string) => {
      const { error } = await supabase
        .from('productos_costeo_config')
        .delete()
        .eq('categoria', categoria);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['productos-costeo-config'] }),
  });

  // Helper: devuelve config de una categoría con fallback a 'default'
  const getConfig = (categoria: string | null | undefined): ProductoCosteoConfig | undefined => {
    if (!query.data) return undefined;
    const cat = (categoria ?? '').toLowerCase();
    return query.data.find((c) => c.categoria === cat) ?? query.data.find((c) => c.categoria === 'default');
  };

  return { ...query, actualizar, crear, eliminar, getConfig };
}
