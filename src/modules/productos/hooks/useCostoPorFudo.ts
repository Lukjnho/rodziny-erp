import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { condicionesDeCobro, margenSobreRecibido, useConfigCosteo, useCostosRecetas } from '@/modules/costeo';
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
        .select('id, receta_id, fudo_nombres')
        .eq('local', local!)
        .eq('activo', true)
        .not('fudo_nombres', 'is', null);
      if (error) throw error;
      return data as {
        id: string;
        receta_id: string | null;
        fudo_nombres: string[] | null;
      }[];
    },
  });

  // Las arma @/modules/costeo, no este archivo: el `?? 0.21` y el "la comisión
  // más alta" estaban escritos igual acá, en MenuTab y en useMenuEngineering.
  const condiciones = condicionesDeCobro({ ivaPct: configGen?.iva_pct, comisiones });
  const ivaPct = condiciones.ivaPct;
  const comisionMax = condiciones.comisionPct;

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
    //    receta_id es una receta vendible costeada.
    //
    //    El empaque NO se suma acá. Se cobra una sola vez, con la subreceta
    //    "Packaging Vianda"/"Packaging Congelado" adentro de la receta, que pasa
    //    por el motor de costeo como cualquier otro ingrediente (mig 204). Antes
    //    había un segundo mecanismo —`cocina_productos.costo_empaque` sumado acá y
    //    en Menu Engineering— que estaba en cero en las 100 filas, que ninguna
    //    pantalla escribía, y que ni siquiera se aplicaba parejo: solo entraba por
    //    este camino legacy, nunca cuando la receta matcheaba directo.
    for (const p of productosQ.data) {
      if (!p.receta_id || !vendibleIds.has(p.receta_id)) continue;
      const c = costos.get(p.receta_id);
      const base = c?.costoPorPorcion ?? c?.costoPorKg ?? null;
      if (base == null) continue;
      const costo = base;
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

  /**
   * Margen del producto a ese precio, como FRACCIÓN (0,62 = 62 %).
   *
   * 💣 Antes se llamaba `getMargenPct` y devolvía 62, mientras las otras dos
   * pantallas devolvían 0,62 con la misma cuenta. Ahora la cuenta vive una sola
   * vez en `@/modules/costeo` y la escala es una sola: fracción. El ×100 lo hace
   * quien dibuja.
   */
  function getMargen(nombreFudo: string, precioBruto: number): number | null {
    return margenSobreRecibido(precioBruto, getCosto(nombreFudo), condiciones);
  }

  return {
    costoPorFudo,
    getCosto,
    getMargen,
    condiciones,
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
