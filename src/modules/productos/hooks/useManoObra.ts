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
  costoMoUnitario: number; // $ de MO por unidad nativa de la receta (kg o porción)
  tajadaPool: number; // $ del pool que se llevó esta receta
}

function periodoActual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Modelo de mano de obra (sueldo fijo mensual):
 *  - Pool mensual por local = Σ sueldo_neto de empleados es_produccion (RPC).
 *  - Ese pool se reparte entre las recetas que el local produjo ese mes,
 *    en proporción a la CANTIDAD producida.
 *
 *    💣 Antes decía "ponderado por cantidad × minutos_lote". La columna
 *    `minutos_lote` existió dos meses y **nunca se cargó en una sola receta**:
 *    las 274 estaban en null, así que el peso caía siempre al valor de
 *    respaldo y el reparto era, de hecho, por cantidad. Se borró la columna
 *    (migración 213) y se sacó la ponderación, que no calculaba nada. El
 *    resultado no cambia en un peso — lo que cambia es que ahora se lee lo
 *    que pasa.
 *
 *    Si algún día se quiere ponderar por tiempo de verdad, hay que volver a
 *    crear la columna Y cargarla: sin datos, la ponderación es decorativa.
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

  const resultado = useMemo(() => {
    const pools = poolQ.data ?? [];
    const prod = prodQ.data ?? [];

    // total_sueldos (RPC) suma el base SIN presentismo; el costo real de MO
    // incluye el presentismo +10% que efectivamente se paga.
    const poolByLocal = new Map<string, number>();
    for (const p of pools)
      poolByLocal.set(p.local, remuneracionConPresentismo(Number(p.total_sueldos)));

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

    // Σ cantidad producida por local: es el repartidor del pool.
    const sumaPesosLocal = new Map<string, number>();
    for (const pr of prodMap.values()) {
      sumaPesosLocal.set(pr.local, (sumaPesosLocal.get(pr.local) ?? 0) + pr.cantidad);
    }

    // Costo MO por receta
    const costoPorReceta = new Map<string, CostoMoReceta>();
    for (const pr of prodMap.values()) {
      const pool = poolByLocal.get(pr.local) ?? 0;
      const sumaPesos = sumaPesosLocal.get(pr.local) ?? 0;
      const tajada = sumaPesos > 0 ? pool * (pr.cantidad / sumaPesos) : 0;
      const costoUnit = pr.cantidad > 0 ? tajada / pr.cantidad : 0;
      costoPorReceta.set(pr.receta_id, {
        recetaId: pr.receta_id,
        local: pr.local,
        produccionMes: pr.cantidad,
        unidad: pr.unidad,
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
  }, [poolQ.data, prodQ.data, periodo]);

  return {
    ...resultado,
    isLoading: poolQ.isLoading || prodQ.isLoading,
  };
}
