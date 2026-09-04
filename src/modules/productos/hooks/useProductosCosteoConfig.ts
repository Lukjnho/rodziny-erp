import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * Config de precios por categoría. Quedaron SOLO los dos campos que mandan sobre
 * algo (migración 176): el margen mínimo, que dispara la alerta y define el precio
 * objetivo del Plan de Acción, y el paso de redondeo con el que ese precio cae en
 * un número de carta. Los otros cuatro —markup objetivo, margen máximo y el rango
 * de mercado— no los leía ninguna pantalla y se borraron.
 */
export interface ProductoCosteoConfig {
  categoria: string;
  /** Piso de margen sobre lo recibido (neto de IVA y comisión). 0,55 = 55 %. */
  margen_min: number;
  /** A cuánto redondea el precio sugerido: 50 en panificados, 100 en el resto. */
  redondeo: number;
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
