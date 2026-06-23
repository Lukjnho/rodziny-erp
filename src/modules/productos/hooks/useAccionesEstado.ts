import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';

export interface AccionEstado {
  id: string;
  accion_key: string;
  tipo: string;
  local: string;
  producto_codigo: string | null;
  producto_nombre: string | null;
  estado: 'hecha' | 'descartada';
  precio_objetivo: number | null;
  nota: string | null;
  usuario_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface MarcarPayload {
  accion_key: string;
  tipo: string;
  local: string;
  producto_codigo?: string | null;
  producto_nombre?: string | null;
  estado: 'hecha' | 'descartada';
  precio_objetivo?: number | null;
  nota?: string | null;
}

export function useAccionesEstado(local: 'vedia' | 'saavedra') {
  const qc = useQueryClient();
  const { user } = useAuth();

  // Key por local para no compartir cache entre Vedia/Saavedra.
  const queryKey = ['productos-acciones-estado', local];

  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<Map<string, AccionEstado>> => {
      const { data, error } = await supabase
        .from('productos_acciones_estado')
        .select('*')
        .eq('local', local);
      if (error) throw error;
      const map = new Map<string, AccionEstado>();
      for (const row of (data ?? []) as AccionEstado[]) map.set(row.accion_key, row);
      return map;
    },
  });

  const marcar = useMutation({
    mutationFn: async (payload: MarcarPayload) => {
      const { error } = await supabase
        .from('productos_acciones_estado')
        .upsert(
          {
            ...payload,
            usuario_id: user?.id ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'accion_key' },
        );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  // Deshacer = borrar el estado, la acción vuelve a aparecer como pendiente.
  const deshacer = useMutation({
    mutationFn: async (accion_key: string) => {
      const { error } = await supabase
        .from('productos_acciones_estado')
        .delete()
        .eq('accion_key', accion_key);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  return { estados: query.data, isLoading: query.isLoading, marcar, deshacer };
}
