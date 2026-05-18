import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface ComisionMpConfig {
  medio_pago: string;
  pct: number;
  descripcion: string | null;
  actualizado: string;
}

export function useComisionMpConfig() {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['comision-mp-config'],
    queryFn: async (): Promise<ComisionMpConfig[]> => {
      const { data, error } = await supabase
        .from('comision_mp_config')
        .select('*')
        .order('medio_pago');
      if (error) throw error;
      return data as ComisionMpConfig[];
    },
  });

  const actualizar = useMutation({
    mutationFn: async (payload: { medio_pago: string; pct: number; descripcion?: string }) => {
      const { error } = await supabase
        .from('comision_mp_config')
        .update({
          pct: payload.pct,
          descripcion: payload.descripcion,
          actualizado: new Date().toISOString(),
        })
        .eq('medio_pago', payload.medio_pago);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['comision-mp-config'] }),
  });

  // Helper: comisión por medio con fallback 0
  const getComision = (medio: string | null | undefined): number => {
    if (!query.data) return 0;
    const m = (medio ?? '').toLowerCase();
    return query.data.find((c) => c.medio_pago === m)?.pct ?? 0;
  };

  return { ...query, actualizar, getComision };
}
