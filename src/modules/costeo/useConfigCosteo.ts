import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

const CLAVES = [
  'margen_seguridad_pct',
  'iva_pct',
  'comision_pago_pct',
  // Descuentos comerciales (no acumulables) para el margen real en el Menú.
  'descuento_efectivo_pct',
  'descuento_convenio_pct',
] as const;

type Clave = (typeof CLAVES)[number];

// 💣 Todos los campos son `number | null`, y el null NO es un descuido.
//
// Antes esto devolvía `number` y el dato que faltaba llegaba como CERO. El
// problema es que quien lo lee escribe `config?.iva_pct ?? 0.21` esperando que
// el respaldo salte — y no salta nunca: `??` solo actúa sobre null/undefined, y
// cero no es ninguno de los dos. Con la fila de IVA sin cargar, `neto = precio
// / (1 + 0)` = precio, y TODOS los márgenes del menú salían 21 puntos más altos
// de lo que son. Sin un solo cartel.
//
// `null` = "no está cargado". Cero = "está cargado y vale cero", que es un
// valor legítimo (una comisión del 0% existe). Son cosas distintas y ahora se
// distinguen. El valor por defecto lo elige cada pantalla, no este hook.
export interface ConfigCosteo {
  margen_seguridad_pct: number | null;
  iva_pct: number | null;
  comision_pago_pct: number | null;
  // % de descuento por pago en efectivo (ej. 0.25 = 25%).
  descuento_efectivo_pct: number | null;
  // Tope de descuento por convenio con empresas (ej. 0.15 = 15%).
  descuento_convenio_pct: number | null;
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (typeof v === 'string') {
    if (v.trim() === '') return null;
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  }
  return null;
}

export function useConfigCosteo() {
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['config-costeo'],
    queryFn: async (): Promise<ConfigCosteo> => {
      const { data, error } = await supabase
        .from('configuracion')
        .select('clave, valor')
        .in('clave', CLAVES as unknown as string[]);
      if (error) throw error;
      const map: Record<string, unknown> = {};
      for (const row of data ?? []) map[row.clave] = row.valor;
      return {
        margen_seguridad_pct: toNumber(map.margen_seguridad_pct),
        iva_pct: toNumber(map.iva_pct),
        comision_pago_pct: toNumber(map.comision_pago_pct),
        descuento_efectivo_pct: toNumber(map.descuento_efectivo_pct),
        descuento_convenio_pct: toNumber(map.descuento_convenio_pct),
      };
    },
  });

  const actualizar = useMutation({
    mutationFn: async ({ clave, valor }: { clave: Clave; valor: number }) => {
      const { error } = await supabase
        .from('configuracion')
        .upsert({ clave, valor, updated_at: new Date().toISOString() }, { onConflict: 'clave' });
      if (error) {
        const parts = [error.message, error.details, error.hint, error.code].filter(Boolean);
        throw new Error(parts.join(' · ') || 'Supabase devolvió un error sin mensaje');
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['config-costeo'] });
      qc.invalidateQueries({ queryKey: ['config-margen-seguridad'] });
    },
  });

  return {
    config: data,
    isLoading,
    error,
    actualizar,
    comision: data?.comision_pago_pct ?? 0,
  };
}
