import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// Nombre Fudo (ventas_items.nombre) agregado por últimos 2 meses con info de
// vinculación. Si vinculadoA != null, ese nombre ya está mapeado a una receta
// vendible o cocina_producto (=> no es huérfano).
export interface FudoNombre {
  nombre: string;
  uds: number;
  total: number;
  vinculadoA: {
    tipo: 'receta' | 'producto';
    id: string;
    nombre: string;
  } | null;
}

function ultimos2Meses(): string[] {
  const hoy = new Date();
  const m1 = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
  const ant = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  const m0 = `${ant.getFullYear()}-${String(ant.getMonth() + 1).padStart(2, '0')}`;
  return [m0, m1];
}

// Hook que lista los nombres Fudo de ventas_items (últimos 2 meses) para un
// local, agregando uds + total y marcando si ya están vinculados a alguna
// receta vendible (cocina_recetas.fudo_productos[]) o cocina_producto
// (cocina_productos.fudo_nombres[]).
//
// Caso de uso: alimentar el VinculacionFudoSelector y la sección informativa
// del MenuTab "productos vendidos en Fudo sin contraparte en el catálogo".
export function useFudoHuerfanos(local: 'vedia' | 'saavedra' | null) {
  const periodos = useMemo(ultimos2Meses, []);

  const ventasQ = useQuery({
    queryKey: ['fudo-huerfanos-ventas', periodos, local],
    enabled: !!local,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ventas_items')
        .select('nombre, cantidad, total')
        .in('periodo', periodos)
        .eq('local', local!);
      if (error) throw error;
      return data as { nombre: string; cantidad: number; total: number }[];
    },
  });

  const recetasQ = useQuery({
    queryKey: ['fudo-huerfanos-recetas', local],
    enabled: !!local,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_recetas')
        .select('id, nombre, fudo_productos')
        .eq('local', local!)
        .eq('vendible', true)
        .eq('activo', true)
        .not('fudo_productos', 'is', null);
      if (error) throw error;
      return data as { id: string; nombre: string; fudo_productos: string[] | null }[];
    },
  });

  const productosQ = useQuery({
    queryKey: ['fudo-huerfanos-productos', local],
    enabled: !!local,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_productos')
        .select('id, nombre, fudo_nombres')
        .eq('local', local!)
        .eq('activo', true)
        .not('fudo_nombres', 'is', null);
      if (error) throw error;
      return data as { id: string; nombre: string; fudo_nombres: string[] | null }[];
    },
  });

  const data = useMemo<FudoNombre[]>(() => {
    if (!ventasQ.data || !recetasQ.data || !productosQ.data) return [];

    // Index nombre Fudo → {tipo, id, nombre} con el primer match.
    // Receta primero (vendible es la vinculación canónica), producto después.
    const vinculados = new Map<
      string,
      { tipo: 'receta' | 'producto'; id: string; nombre: string }
    >();
    for (const r of recetasQ.data) {
      for (const fn of r.fudo_productos ?? []) {
        const key = fn.trim();
        if (key && !vinculados.has(key)) {
          vinculados.set(key, { tipo: 'receta', id: r.id, nombre: r.nombre });
        }
      }
    }
    for (const p of productosQ.data) {
      for (const fn of p.fudo_nombres ?? []) {
        const key = fn.trim();
        if (key && !vinculados.has(key)) {
          vinculados.set(key, { tipo: 'producto', id: p.id, nombre: p.nombre });
        }
      }
    }

    // Agregar ventas_items por nombre exacto.
    const agg = new Map<string, { uds: number; total: number }>();
    for (const v of ventasQ.data) {
      const key = (v.nombre ?? '').trim();
      if (!key) continue;
      const prev = agg.get(key) ?? { uds: 0, total: 0 };
      prev.uds += Number(v.cantidad) || 0;
      prev.total += Number(v.total) || 0;
      agg.set(key, prev);
    }

    return Array.from(agg.entries())
      .map(([nombre, { uds, total }]) => ({
        nombre,
        uds,
        total,
        vinculadoA: vinculados.get(nombre) ?? null,
      }))
      .sort((a, b) => b.total - a.total);
  }, [ventasQ.data, recetasQ.data, productosQ.data]);

  return {
    data,
    isLoading: ventasQ.isLoading || recetasQ.isLoading || productosQ.isLoading,
    error: ventasQ.error || recetasQ.error || productosQ.error,
  };
}
