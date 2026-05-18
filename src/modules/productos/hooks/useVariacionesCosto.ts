import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';

export interface VariacionPendiente {
  id: string;
  producto_id: string;
  costo_actual: number;
  costo_propuesto: number;
  variacion_pct: number;
  gasto_id: string | null;
  fecha_gasto: string | null;
  estado: 'pendiente' | 'aceptado' | 'rechazado';
  fecha_deteccion: string;
  resuelto_por: string | null;
  resuelto_at: string | null;
  comentario: string | null;
  producto_nombre: string;
  producto_unidad: string;
  gasto_proveedor: string | null;
}

interface RawRow {
  id: string;
  producto_id: string;
  costo_actual: number;
  costo_propuesto: number;
  variacion_pct: number;
  gasto_id: string | null;
  fecha_gasto: string | null;
  estado: 'pendiente' | 'aceptado' | 'rechazado';
  fecha_deteccion: string;
  resuelto_por: string | null;
  resuelto_at: string | null;
  comentario: string | null;
  producto: { nombre: string; unidad: string } | null;
  gasto: { proveedor: string | null } | null;
}

export function useVariacionesPendientes(estado: 'pendiente' | 'todas' = 'pendiente') {
  const qc = useQueryClient();
  const { perfil } = useAuth();

  const query = useQuery({
    queryKey: ['variaciones-costo', estado],
    queryFn: async (): Promise<VariacionPendiente[]> => {
      let q = supabase
        .from('productos_costo_pendientes')
        .select(
          'id, producto_id, costo_actual, costo_propuesto, variacion_pct, gasto_id, fecha_gasto, estado, fecha_deteccion, resuelto_por, resuelto_at, comentario, producto:productos(nombre, unidad), gasto:gastos(proveedor)',
        )
        .order('fecha_deteccion', { ascending: false })
        .limit(200);
      if (estado === 'pendiente') q = q.eq('estado', 'pendiente');
      const { data, error } = await q;
      if (error) throw error;
      return (data as unknown as RawRow[]).map((r) => ({
        id: r.id,
        producto_id: r.producto_id,
        costo_actual: Number(r.costo_actual),
        costo_propuesto: Number(r.costo_propuesto),
        variacion_pct: Number(r.variacion_pct),
        gasto_id: r.gasto_id,
        fecha_gasto: r.fecha_gasto,
        estado: r.estado,
        fecha_deteccion: r.fecha_deteccion,
        resuelto_por: r.resuelto_por,
        resuelto_at: r.resuelto_at,
        comentario: r.comentario,
        producto_nombre: r.producto?.nombre ?? '(sin nombre)',
        producto_unidad: r.producto?.unidad ?? '',
        gasto_proveedor: r.gasto?.proveedor ?? null,
      }));
    },
  });

  const detectar = useMutation({
    mutationFn: async (payload?: { dias?: number; umbralPct?: number }) => {
      const { data, error } = await supabase.rpc('detectar_variaciones_costo', {
        p_dias: payload?.dias ?? 30,
        p_umbral_pct: payload?.umbralPct ?? 0.05,
      });
      if (error) throw error;
      return data as Array<{ detectadas: number; ya_existentes: number; sin_variacion: number }>;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['variaciones-costo'] }),
  });

  const aceptar = useMutation({
    mutationFn: async (pendienteId: string) => {
      const { error } = await supabase.rpc('aceptar_variacion_costo', {
        p_pendiente_id: pendienteId,
        p_usuario: perfil?.nombre ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['variaciones-costo'] });
      qc.invalidateQueries({ queryKey: ['productos-insumos'] });
      qc.invalidateQueries({ queryKey: ['productos-costeo'] });
    },
  });

  const rechazar = useMutation({
    mutationFn: async (payload: { id: string; comentario?: string }) => {
      const { error } = await supabase.rpc('rechazar_variacion_costo', {
        p_pendiente_id: payload.id,
        p_usuario: perfil?.nombre ?? null,
        p_comentario: payload.comentario ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['variaciones-costo'] }),
  });

  return { ...query, detectar, aceptar, rechazar };
}
