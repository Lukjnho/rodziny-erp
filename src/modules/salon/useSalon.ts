import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mensajeErrorAmigable } from '@/lib/erroresSupabase';

/**
 * Los espacios y las mesas del salón (migración 190).
 *
 * El plano es UNA sola fuente: lo arma administración desde acá, y de la misma
 * tabla leen después el teléfono del mozo y la pantalla del mostrador. Si una
 * mesa no está cargada acá, para ellos no existe.
 *
 * ⚠️ Escribir estas dos tablas es SOLO de administración: así lo decidió Lucas
 * el 8-sep-2026 y así están las reglas de la base. El mozo y el cajero las leen
 * y nada más. Por eso acá no hay ningún camino que un cajero pueda usar.
 *
 * 💣 Toda escritura pide las filas de vuelta y cuenta cuántas vinieron: cuando
 * la base no deja tocar una fila NO tira error, devuelve cero filas. Sin este
 * chequeo la pantalla diría "guardado" y no se guardó nada.
 */

export type LocalSalon = 'vedia' | 'saavedra';
export type FormaMesa = 'rectangular' | 'redonda';

export interface Sala {
  id: string;
  local: string;
  nombre: string;
  orden: number;
  activo: boolean;
}

export interface Mesa {
  id: string;
  local: string;
  sala_id: string;
  numero: string;
  capacidad: number | null;
  forma: FormaMesa;
  pos_x: number;
  pos_y: number;
  ancho: number;
  alto: number;
  activo: boolean;
}

const CLAVE_SALAS = 'salon-salas';
const CLAVE_MESAS = 'salon-mesas';

export function useSalas(local: LocalSalon) {
  return useQuery({
    queryKey: [CLAVE_SALAS, local],
    queryFn: async (): Promise<Sala[]> => {
      const { data, error } = await supabase
        .from('caja_salas')
        .select('id, local, nombre, orden, activo')
        .eq('local', local)
        .order('orden')
        .order('nombre');
      if (error) throw new Error(mensajeErrorAmigable(error, 'No se pudieron traer los espacios'));
      return (data ?? []) as Sala[];
    },
  });
}

export function useMesas(local: LocalSalon) {
  return useQuery({
    queryKey: [CLAVE_MESAS, local],
    queryFn: async (): Promise<Mesa[]> => {
      const { data, error } = await supabase
        .from('caja_mesas')
        .select('id, local, sala_id, numero, capacidad, forma, pos_x, pos_y, ancho, alto, activo')
        .eq('local', local);
      if (error) throw new Error(mensajeErrorAmigable(error, 'No se pudieron traer las mesas'));
      return (data ?? []) as Mesa[];
    },
  });
}

/** Invalida las dos listas del local: el plano se dibuja con las dos juntas. */
function refrescar(qc: ReturnType<typeof useQueryClient>, local: LocalSalon) {
  qc.invalidateQueries({ queryKey: [CLAVE_SALAS, local] });
  qc.invalidateQueries({ queryKey: [CLAVE_MESAS, local] });
}

// ── Espacios ────────────────────────────────────────────────────────────────

export function useCrearSala(local: LocalSalon) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { nombre: string; orden: number }) => {
      const nombre = input.nombre.trim();
      if (!nombre) throw new Error('Ponele un nombre al espacio.');
      const { data, error } = await supabase
        .from('caja_salas')
        .insert({ local, nombre, orden: input.orden })
        .select('id');
      if (error) throw new Error(mensajeErrorAmigable(error, 'No se pudo crear el espacio'));
      if (!data || data.length === 0) {
        throw new Error('No se creó el espacio. Puede que no tengas permiso de administrador.');
      }
      return data[0].id as string;
    },
    onSuccess: () => refrescar(qc, local),
  });
}

export function useEditarSala(local: LocalSalon) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; nombre?: string; orden?: number; activo?: boolean }) => {
      const cambios: Record<string, unknown> = {};
      if (input.nombre !== undefined) {
        const nombre = input.nombre.trim();
        if (!nombre) throw new Error('El espacio no puede quedarse sin nombre.');
        cambios.nombre = nombre;
      }
      if (input.orden !== undefined) cambios.orden = input.orden;
      if (input.activo !== undefined) cambios.activo = input.activo;

      const { data, error } = await supabase
        .from('caja_salas')
        .update(cambios)
        .eq('id', input.id)
        .select('id');
      if (error) throw new Error(mensajeErrorAmigable(error, 'No se pudo guardar el espacio'));
      if (!data || data.length === 0) {
        throw new Error('No se guardó el cambio. Puede que no tengas permiso de administrador.');
      }
    },
    onSuccess: () => refrescar(qc, local),
  });
}

export function useBorrarSala(local: LocalSalon) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from('caja_salas')
        .delete()
        .eq('id', id)
        .select('id');
      // La base no deja borrar un espacio que todavía tiene mesas colgando.
      if (error) throw new Error(mensajeErrorAmigable(error, 'No se pudo borrar el espacio'));
      if (!data || data.length === 0) {
        throw new Error('No se borró el espacio. Puede que no tengas permiso de administrador.');
      }
    },
    onSuccess: () => refrescar(qc, local),
  });
}

// ── Mesas ───────────────────────────────────────────────────────────────────

export function useCrearMesa(local: LocalSalon) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      salaId: string;
      numero: string;
      pos_x: number;
      pos_y: number;
      capacidad?: number | null;
    }) => {
      const numero = input.numero.trim();
      if (!numero) throw new Error('La mesa necesita un número o un nombre.');
      const { data, error } = await supabase
        .from('caja_mesas')
        .insert({
          // el local lo vuelve a sellar la base subiendo por el espacio; se manda
          // igual porque la columna no admite nulos
          local,
          sala_id: input.salaId,
          numero,
          capacidad: input.capacidad ?? null,
          pos_x: input.pos_x,
          pos_y: input.pos_y,
        })
        .select('id');
      if (error) throw new Error(mensajeErrorAmigable(error, 'No se pudo crear la mesa'));
      if (!data || data.length === 0) {
        throw new Error('No se creó la mesa. Puede que no tengas permiso de administrador.');
      }
      return data[0].id as string;
    },
    onSuccess: () => refrescar(qc, local),
  });
}

export function useEditarMesa(local: LocalSalon) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string } & Partial<Omit<Mesa, 'id' | 'local'>>) => {
      const { id, ...cambios } = input;
      if (cambios.numero !== undefined) {
        cambios.numero = String(cambios.numero).trim();
        if (!cambios.numero) throw new Error('La mesa necesita un número o un nombre.');
      }
      const { data, error } = await supabase
        .from('caja_mesas')
        .update(cambios)
        .eq('id', id)
        .select('id');
      if (error) throw new Error(mensajeErrorAmigable(error, 'No se pudo guardar la mesa'));
      if (!data || data.length === 0) {
        throw new Error('No se guardó el cambio. Puede que no tengas permiso de administrador.');
      }
    },
    onSuccess: () => refrescar(qc, local),
  });
}

export function useBorrarMesa(local: LocalSalon) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from('caja_mesas')
        .delete()
        .eq('id', id)
        .select('id');
      // Si la mesa ya tuvo gente sentada, la base no la deja borrar: se apaga.
      if (error) throw new Error(mensajeErrorAmigable(error, 'No se pudo borrar la mesa'));
      if (!data || data.length === 0) {
        throw new Error('No se borró la mesa. Puede que no tengas permiso de administrador.');
      }
    },
    onSuccess: () => refrescar(qc, local),
  });
}
