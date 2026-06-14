import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useCostosRecetas } from '@/modules/cocina/hooks/useCostosRecetas';
import { useConfigCosteo } from '@/modules/cocina/hooks/useConfigCosteo';
import { useComisionMpConfig } from './useComisionMpConfig';

// Normalización idéntica a la de useMenuEngineering para matchear nombres Fudo
// (minúsculas + espacios). No saca acentos: el nombre de venta Fudo es el contrato.
function normalizar(n: string): string {
  return (n ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
}

// Mapa: nombre de venta Fudo (normalizado) -> costo unitario CANÓNICO (motor de
// costeo de Productos), para un local. Misma lógica de matcheo que
// useMenuEngineering: receta vendible por fudo_productos[] primero, y cocina_producto
// por fudo_nombres[] solo si su receta_id es una receta vendible costeada. Sirve para
// que "En vivo Fudo" (Ventas) muestre el costo/margen del módulo Productos y no el
// maestro de Fudo. Si un producto no está vinculado/costeado en Productos, NO entra
// al mapa (la UI muestra "—" en vez de un costo de otra fuente).
export function useCostoPorFudo(local: 'vedia' | 'saavedra' | null) {
  const { costos, isLoading: costosLoading } = useCostosRecetas();
  const { config: configGen, isLoading: configLoading } = useConfigCosteo();
  const { data: comisiones, isLoading: comisionesLoading } = useComisionMpConfig();

  const recetasQ = useQuery({
    queryKey: ['costo-fudo-recetas', local],
    enabled: !!local,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_recetas')
        .select('id, fudo_productos')
        .eq('local', local!)
        .eq('vendible', true)
        .eq('activo', true);
      if (error) throw error;
      return data as { id: string; fudo_productos: string[] | null }[];
    },
  });

  const productosQ = useQuery({
    queryKey: ['costo-fudo-productos', local],
    enabled: !!local,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_productos')
        .select('id, receta_id, costo_empaque, fudo_nombres')
        .eq('local', local!)
        .eq('activo', true)
        .not('fudo_nombres', 'is', null);
      if (error) throw error;
      return data as {
        id: string;
        receta_id: string | null;
        costo_empaque: number | null;
        fudo_nombres: string[] | null;
      }[];
    },
  });

  const ivaPct = configGen?.iva_pct ?? 0.21;
  // Comisión bancaria más alta (criterio conservador, igual que Menú/Ingeniería).
  const comisionMax = Math.max(0, ...(comisiones ?? []).map((c) => Number(c.pct)));

  const costoPorFudo = useMemo(() => {
    const m = new Map<string, number>();
    if (!recetasQ.data || !productosQ.data) return m;

    // Set de ids de recetas vendibles, para el guard del camino legacy (producto
    // cuyo receta_id apunta a una subreceta/relleno NO se costea: no es el plato).
    const vendibleIds = new Set(recetasQ.data.map((r) => r.id));

    // 1) Receta vendible por fudo_productos[] (vinculación canónica).
    for (const r of recetasQ.data) {
      const c = costos.get(r.id);
      const costo = c?.costoPorPorcion ?? c?.costoPorKg ?? null;
      if (costo == null) continue;
      for (const fn of r.fudo_productos ?? []) {
        const k = normalizar(fn);
        if (k && !m.has(k)) m.set(k, costo);
      }
    }

    // 2) cocina_producto por fudo_nombres[] (bebidas reventa / legacy), solo si su
    //    receta_id es una receta vendible costeada. Suma costo_empaque.
    for (const p of productosQ.data) {
      if (!p.receta_id || !vendibleIds.has(p.receta_id)) continue;
      const c = costos.get(p.receta_id);
      const base = c?.costoPorPorcion ?? c?.costoPorKg ?? null;
      if (base == null) continue;
      const costo = base + (p.costo_empaque ?? 0);
      for (const fn of p.fudo_nombres ?? []) {
        const k = normalizar(fn);
        if (k && !m.has(k)) m.set(k, costo);
      }
    }

    return m;
  }, [recetasQ.data, productosQ.data, costos]);

  // Helper: costo canónico por nombre Fudo (null si no está vinculado/costeado).
  function getCosto(nombreFudo: string): number | null {
    return costoPorFudo.get(normalizar(nombreFudo)) ?? null;
  }

  // Helper: margen % con el MISMO modelo que Productos/Ingeniería de Menú:
  // precio neto de IVA, menos la comisión más alta, menos el costo, sobre lo recibido.
  function getMargenPct(nombreFudo: string, precioBruto: number): number | null {
    const costo = getCosto(nombreFudo);
    if (costo == null || precioBruto <= 0) return null;
    const neto = precioBruto / (1 + ivaPct);
    const recibido = neto - neto * comisionMax;
    if (recibido <= 0) return null;
    return ((recibido - costo) / recibido) * 100;
  }

  return {
    costoPorFudo,
    getCosto,
    getMargenPct,
    ivaPct,
    comisionMax,
    isLoading:
      recetasQ.isLoading ||
      productosQ.isLoading ||
      costosLoading ||
      configLoading ||
      comisionesLoading,
  };
}
