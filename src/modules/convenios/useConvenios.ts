import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mensajeErrorAmigable } from '@/lib/erroresSupabase';
import type { Convenio, ConvenioInput, LocalConv, MedicionResp } from './types';

const QUERY_KEY = 'convenios';

// ── Catálogo de convenios (tabla convenios) ──────────────────────────────
export function useConvenios() {
  return useQuery({
    queryKey: [QUERY_KEY],
    queryFn: async (): Promise<Convenio[]> => {
      const { data, error } = await supabase
        .from('convenios')
        .select('*')
        .order('local', { ascending: true })
        .order('nombre', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Convenio[];
    },
  });
}

export function useGuardarConvenio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id?: string; input: ConvenioInput }) => {
      if (id) {
        const { error } = await supabase.from('convenios').update(input).eq('id', id);
        if (error) throw new Error(mensajeErrorAmigable(error));
      } else {
        const { error } = await supabase.from('convenios').insert(input);
        if (error) throw new Error(mensajeErrorAmigable(error));
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEY] }),
  });
}

export function useEliminarConvenio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('convenios').delete().eq('id', id);
      if (error) throw new Error(mensajeErrorAmigable(error));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEY] }),
  });
}

// ── Medición en vivo desde Fudo (edge function fudo-convenios) ────────────
export function useMedicionConvenios(local: LocalConv, desde: string, hasta: string) {
  return useQuery({
    // Cache por local + rango. 10 min: la consulta a Fudo es cara (pagina ventas).
    queryKey: ['convenios-medicion', local, desde, hasta],
    queryFn: async (): Promise<MedicionResp> => {
      const { data, error } = await supabase.functions.invoke<{
        ok: boolean;
        data?: MedicionResp;
        error?: string;
      }>('fudo-convenios', { body: { local, desde, hasta } });
      if (error) throw new Error(`Error consultando Fudo: ${error.message}`);
      if (!data?.ok || !data.data) throw new Error(data?.error ?? 'Fudo no devolvió datos');
      return data.data;
    },
    enabled: !!local && !!desde && !!hasta,
    staleTime: 1000 * 60 * 10,
    retry: false,
  });
}
