import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import {
  buildCosteoContext,
  costearReceta,
  type CostoReceta,
  type CosteoContext,
  type IngredienteRow,
  type ProductoRow,
  type RecetaRow,
} from '../lib/costeoEngine';

// Re-export para no romper imports existentes (RecetasTab importa el tipo desde acá).
export type { CostoReceta, CosteoContext, DetalleIngrediente } from '../lib/costeoEngine';

// Hook: trae los datos de la base y delega TODO el cálculo en el motor puro
// (lib/costeoEngine). Así el costeo guardado y el costeo de un borrador en edición
// usan exactamente la misma lógica.
export function useCostosRecetas() {
  const recetasQ = useQuery({
    queryKey: ['cocina-recetas-costeo'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_recetas')
        .select('id, nombre, tipo, rendimiento_kg, rendimiento_porciones, local')
        .eq('activo', true);
      if (error) throw error;
      return data as RecetaRow[];
    },
  });

  const margenGlobalQ = useQuery({
    queryKey: ['config-margen-seguridad'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('configuracion')
        .select('valor')
        .eq('clave', 'margen_seguridad_pct')
        .maybeSingle();
      if (error) throw error;
      const v = data?.valor;
      const num = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : 0;
      return isNaN(num) ? 0 : num;
    },
  });

  const ingredientesQ = useQuery({
    queryKey: ['cocina-receta-ingredientes-costeo'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_receta_ingredientes')
        .select('id, receta_id, nombre, cantidad, unidad, orden, producto_id')
        .order('orden');
      if (error) throw error;
      return data as IngredienteRow[];
    },
  });

  const productosQ = useQuery({
    queryKey: ['productos-costeo'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('productos')
        .select('id, nombre, unidad, costo_unitario, merma_pct, contenido_ml')
        .eq('activo', true);
      if (error) throw error;
      return data as ProductoRow[];
    },
  });

  // Contexto de costeo (índices). Reutilizable por el editor inline para costear
  // un borrador sin guardar.
  const ctx = useMemo<CosteoContext | null>(() => {
    const recetas = recetasQ.data;
    const ings = ingredientesQ.data;
    const prods = productosQ.data;
    if (!recetas || !ings || !prods) return null;
    return buildCosteoContext(recetas, ings, prods, margenGlobalQ.data ?? 0);
  }, [recetasQ.data, ingredientesQ.data, productosQ.data, margenGlobalQ.data]);

  const costos = useMemo(() => {
    const mapa = new Map<string, CostoReceta>();
    if (!ctx) return mapa;
    const enProgreso = new Set<string>();
    for (const r of ctx.recetas) costearReceta(r.id, ctx, mapa, enProgreso);
    return mapa;
  }, [ctx]);

  return {
    costos,
    ctx,
    margenGlobal: margenGlobalQ.data ?? 0,
    isLoading:
      recetasQ.isLoading ||
      ingredientesQ.isLoading ||
      productosQ.isLoading ||
      margenGlobalQ.isLoading,
    error: recetasQ.error || ingredientesQ.error || productosQ.error || margenGlobalQ.error,
  };
}
