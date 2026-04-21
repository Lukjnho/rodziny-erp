import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

const CLAVES = [
  'margen_seguridad_pct',
  'iva_pct',
  'comision_pago_pct',
] as const

type Clave = typeof CLAVES[number]

export interface ConfigCosteo {
  margen_seguridad_pct: number
  iva_pct: number
  comision_pago_pct: number
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const n = parseFloat(v)
    return isNaN(n) ? 0 : n
  }
  return 0
}

export function useConfigCosteo() {
  const qc = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ['config-costeo'],
    queryFn: async (): Promise<ConfigCosteo> => {
      const { data, error } = await supabase
        .from('configuracion')
        .select('clave, valor')
        .in('clave', CLAVES as unknown as string[])
      if (error) throw error
      const map: Record<string, unknown> = {}
      for (const row of data ?? []) map[row.clave] = row.valor
      return {
        margen_seguridad_pct: toNumber(map.margen_seguridad_pct),
        iva_pct: toNumber(map.iva_pct),
        comision_pago_pct: toNumber(map.comision_pago_pct),
      }
    },
  })

  const actualizar = useMutation({
    mutationFn: async ({ clave, valor }: { clave: Clave; valor: number }) => {
      const { error } = await supabase
        .from('configuracion')
        .upsert(
          { clave, valor, updated_at: new Date().toISOString() },
          { onConflict: 'clave' }
        )
      if (error) {
        const parts = [error.message, error.details, error.hint, error.code].filter(Boolean)
        throw new Error(parts.join(' · ') || 'Supabase devolvió un error sin mensaje')
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['config-costeo'] })
      qc.invalidateQueries({ queryKey: ['config-margen-seguridad'] })
    },
  })

  return {
    config: data,
    isLoading,
    error,
    actualizar,
    comision: data?.comision_pago_pct ?? 0,
  }
}
