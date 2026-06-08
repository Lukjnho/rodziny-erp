import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { remuneracionConPresentismo } from '@/modules/rrhh/utils';

export interface PoolLocal {
  local: string;
  total_sueldos: number;
  n_empleados: number;
}

export interface ProduccionReceta {
  receta_id: string;
  local: string;
  cantidad: number;
  unidad: string;
}

export interface CostoMoReceta {
  recetaId: string;
  local: string;
  produccionMes: number;
  unidad: string;
  minutosLote: number | null;
  costoMoUnitario: number; // $ de MO por unidad nativa de la receta (kg o porción)
  tajadaPool: number; // $ del pool que se llevó esta receta
}

interface RecetaMin {
  id: string;
  minutos_lote: number | null;
  local: string | null;
}

function periodoActual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Modelo de mano de obra (sueldo fijo mensual):
 *  - Pool mensual por local = Σ sueldo_neto de empleados es_produccion (RPC).
 *  - Ese pool se reparte entre las recetas que el local produjo ese mes,
 *    ponderado por (cantidad_producida × minutos_lote). Si una receta no
 *    tiene minutos cargados, usa el promedio de minutos del local (o 1 si
 *    ninguna tiene) para no distorsionar.
 *  - costo MO unitario de la receta = tajada_del_pool / cantidad_producida.
 *
 * Limitación v1 (documentada): la MO se imputa a la receta DIRECTA del
 * producto. No se acumula recursivamente la MO de subrecetas (relleno, masa).
 * Se refina en una fase futura.
 */
export function useManoObra(periodo: string = periodoActual()) {
  const poolQ = useQuery({
    queryKey: ['pool-mano-obra'],
    queryFn: async (): Promise<PoolLocal[]> => {
      const { data, error } = await supabase.rpc('pool_mano_obra_produccion');
      if (error) throw error;
      return (data ?? []) as PoolLocal[];
    },
  });

  const prodQ = useQuery({
    queryKey: ['produccion-mensual-receta', periodo],
    queryFn: async (): Promise<ProduccionReceta[]> => {
      const { data, error } = await supabase.rpc('produccion_mensual_por_receta', {
        p_periodo: periodo,
      });
      if (error) throw error;
      return (data ?? []) as ProduccionReceta[];
    },
  });

  const recetasQ = useQuery({
    queryKey: ['recetas-minutos-lote'],
    queryFn: async (): Promise<RecetaMin[]> => {
      const { data, error } = await supabase
        .from('cocina_recetas')
        .select('id, minutos_lote, local');
      if (error) throw error;
      return data as RecetaMin[];
    },
  });

  const resultado = useMemo(() => {
    const pools = poolQ.data ?? [];
    const prod = prodQ.data ?? [];
    const recetas = recetasQ.data ?? [];

    // total_sueldos (RPC) suma el base SIN presentismo; el costo real de MO
    // incluye el presentismo +10% que efectivamente se paga.
    const poolByLocal = new Map<string, number>();
    for (const p of pools)
      poolByLocal.set(p.local, remuneracionConPresentismo(Number(p.total_sueldos)));

    const minutosByReceta = new Map<string, number | null>();
    for (const r of recetas) minutosByReceta.set(r.id, r.minutos_lote);

    // Producción agrupada por (receta, local) — la RPC ya agrupa, pero una
    // misma receta podría aparecer en >1 fila si tiene producción en tablas
    // distintas; sumamos.
    const prodMap = new Map<string, ProduccionReceta>();
    for (const pr of prod) {
      const key = `${pr.local}|${pr.receta_id}`;
      const prev = prodMap.get(key);
      if (prev) prev.cantidad += Number(pr.cantidad);
      else prodMap.set(key, { ...pr, cantidad: Number(pr.cantidad) });
    }

    // Promedio de minutos por local (para recetas sin minutos cargados)
    const minutosPorLocal = new Map<string, { sum: number; n: number }>();
    for (const pr of prodMap.values()) {
      const m = minutosByReceta.get(pr.receta_id);
      if (m != null && m > 0) {
        const acc = minutosPorLocal.get(pr.local) ?? { sum: 0, n: 0 };
        acc.sum += m;
        acc.n += 1;
        minutosPorLocal.set(pr.local, acc);
      }
    }
    const minutosPromedioLocal = (local: string): number => {
      const acc = minutosPorLocal.get(local);
      return acc && acc.n > 0 ? acc.sum / acc.n : 1;
    };

    // Σ pesos por local: peso = cantidad × minutos_efectivos
    const sumaPesosLocal = new Map<string, number>();
    for (const pr of prodMap.values()) {
      const minutos =
        minutosByReceta.get(pr.receta_id) ?? minutosPromedioLocal(pr.local);
      const peso = pr.cantidad * (minutos > 0 ? minutos : 1);
      sumaPesosLocal.set(pr.local, (sumaPesosLocal.get(pr.local) ?? 0) + peso);
    }

    // Costo MO por receta
    const costoPorReceta = new Map<string, CostoMoReceta>();
    for (const pr of prodMap.values()) {
      const pool = poolByLocal.get(pr.local) ?? 0;
      const sumaPesos = sumaPesosLocal.get(pr.local) ?? 0;
      const minutos =
        minutosByReceta.get(pr.receta_id) ?? minutosPromedioLocal(pr.local);
      const peso = pr.cantidad * (minutos > 0 ? minutos : 1);
      const tajada = sumaPesos > 0 ? pool * (peso / sumaPesos) : 0;
      const costoUnit = pr.cantidad > 0 ? tajada / pr.cantidad : 0;
      costoPorReceta.set(pr.receta_id, {
        recetaId: pr.receta_id,
        local: pr.local,
        produccionMes: pr.cantidad,
        unidad: pr.unidad,
        minutosLote: minutosByReceta.get(pr.receta_id) ?? null,
        costoMoUnitario: costoUnit,
        tajadaPool: tajada,
      });
    }

    return {
      pools,
      costoPorReceta,
      periodo,
      hayProduccion: prodMap.size > 0,
    };
  }, [poolQ.data, prodQ.data, recetasQ.data, periodo]);

  return {
    ...resultado,
    isLoading: poolQ.isLoading || prodQ.isLoading || recetasQ.isLoading,
  };
}
