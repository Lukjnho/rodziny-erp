import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import type { AgendaItem, AgendaItemInput } from './types';

const QUERY_KEY = 'agenda-items';

// Lista de usuarios para el selector de admin ("ver agenda de…").
// Solo se ejecuta para admins (RLS permite a admins leer todos los perfiles).
export interface PerfilAgenda {
  user_id: string;
  nombre: string;
}

export function usePerfilesAgenda() {
  const { perfil } = useAuth();
  return useQuery({
    queryKey: ['perfiles-agenda'],
    queryFn: async (): Promise<PerfilAgenda[]> => {
      const { data, error } = await supabase
        .from('perfiles')
        .select('user_id, nombre')
        .order('nombre');
      if (error) throw error;
      return (data ?? []) as PerfilAgenda[];
    },
    enabled: !!perfil?.es_admin,
  });
}

// Si se pasa usuarioId, trae la agenda de ESE usuario (admin viendo a otro).
// Si no, trae la propia. Siempre filtra explícito para no mezclar caches.
export function useAgendaItems(usuarioId?: string) {
  const { user } = useAuth();
  const targetId = usuarioId ?? user?.id;
  return useQuery({
    queryKey: [QUERY_KEY, targetId],
    queryFn: async (): Promise<AgendaItem[]> => {
      const { data, error } = await supabase
        .from('agenda_items')
        .select('*')
        .eq('usuario_id', targetId!)
        .order('fecha_inicio', { ascending: true });
      if (error) throw error;
      return (data ?? []) as AgendaItem[];
    },
    enabled: !!targetId,
  });
}

// usuarioId opcional: a quién se le crea el item (admin asignando a otro).
// Por defecto, el usuario logueado.
export function useCrearItem(usuarioId?: string) {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: AgendaItemInput) => {
      const targetId = usuarioId ?? user?.id;
      if (!targetId) throw new Error('Sin sesión');
      const { error } = await supabase.from('agenda_items').insert({
        ...input,
        usuario_id: targetId,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEY] }),
  });
}

export function useActualizarItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: Partial<AgendaItemInput> }) => {
      const { error } = await supabase.from('agenda_items').update(input).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEY] }),
  });
}

export function useToggleCompletado() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, completado }: { id: string; completado: boolean }) => {
      const { error } = await supabase
        .from('agenda_items')
        .update({
          completado,
          completado_at: completado ? new Date().toISOString() : null,
        })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEY] }),
  });
}

export function useEliminarItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('agenda_items').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEY] }),
  });
}
