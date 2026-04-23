import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { supabase } from '@/lib/supabase'

export type CategoriaEfemeride = 'pasta' | 'vino' | 'argentina' | 'internacional' | 'fiesta' | 'tradicion' | 'postre' | 'otro'

export interface Efemeride {
  id: string
  mes: number | null // null = recurrente mensual (ej. 29 de cada mes)
  dia: number
  nombre: string
  descripcion: string | null
  categoria: CategoriaEfemeride
  idea_plato: string | null
  activo: boolean
  created_at: string
}

// Fecha concreta de una ocurrencia (ya expandida para recurrentes)
export interface OcurrenciaEfemeride extends Efemeride {
  fecha: Date
  diasRestantes: number // puede ser negativo (ya pasó este año)
}

export const CATEGORIA_LABEL: Record<CategoriaEfemeride, string> = {
  pasta: 'Pasta',
  vino: 'Vino',
  argentina: 'Argentina',
  internacional: 'Internacional',
  fiesta: 'Fiesta',
  tradicion: 'Tradición',
  postre: 'Postre',
  otro: 'Otro',
}

export const CATEGORIA_COLOR: Record<CategoriaEfemeride, string> = {
  pasta: 'bg-red-100 text-red-700',
  vino: 'bg-purple-100 text-purple-700',
  argentina: 'bg-sky-100 text-sky-700',
  internacional: 'bg-amber-100 text-amber-700',
  fiesta: 'bg-pink-100 text-pink-700',
  tradicion: 'bg-emerald-100 text-emerald-700',
  postre: 'bg-fuchsia-100 text-fuchsia-700',
  otro: 'bg-gray-100 text-gray-700',
}

export function useEfemerides() {
  return useQuery({
    queryKey: ['efemerides-gastronomicas'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('efemerides_gastronomicas')
        .select('*')
        .order('mes', { ascending: true, nullsFirst: false })
        .order('dia', { ascending: true })
      if (error) throw error
      return data as Efemeride[]
    },
  })
}

// Días entre dos fechas (sin horas)
function diffDias(desde: Date, hasta: Date): number {
  const d1 = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate())
  const d2 = new Date(hasta.getFullYear(), hasta.getMonth(), hasta.getDate())
  return Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24))
}

// Expande una efeméride a ocurrencias concretas dentro de un rango.
// Si mes es null (recurrente mensual), genera una ocurrencia en cada mes.
// Para fechas específicas, si ya pasó este año usa el año siguiente.
function expandirOcurrencias(ef: Efemeride, hoy: Date, diasAdelante: number): OcurrenciaEfemeride[] {
  const out: OcurrenciaEfemeride[] = []
  const limite = new Date(hoy)
  limite.setDate(limite.getDate() + diasAdelante)

  if (ef.mes == null) {
    // Recurrente mensual: tomar día ef.dia en el mes actual + siguientes
    let cursor = new Date(hoy.getFullYear(), hoy.getMonth(), 1)
    while (cursor <= limite) {
      // Clampear el día si el mes tiene menos días (ej. 29 en febrero no bisiesto → tomar último día)
      const ultimoDia = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()
      const diaReal = Math.min(ef.dia, ultimoDia)
      const fecha = new Date(cursor.getFullYear(), cursor.getMonth(), diaReal)
      const dr = diffDias(hoy, fecha)
      if (fecha >= hoy && fecha <= limite) {
        out.push({ ...ef, fecha, diasRestantes: dr })
      }
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
    }
    return out
  }

  // Fecha específica anual — probar año actual; si ya pasó, año siguiente
  for (const año of [hoy.getFullYear(), hoy.getFullYear() + 1]) {
    const fecha = new Date(año, ef.mes - 1, ef.dia)
    if (fecha >= hoy && fecha <= limite) {
      out.push({ ...ef, fecha, diasRestantes: diffDias(hoy, fecha) })
    }
  }
  return out
}

// Devuelve las próximas ocurrencias ordenadas por fecha (más cercanas primero)
export function useProximasEfemerides(diasAdelante: number = 15) {
  const query = useEfemerides()
  const proximas = useMemo<OcurrenciaEfemeride[]>(() => {
    if (!query.data) return []
    const hoy = new Date()
    hoy.setHours(0, 0, 0, 0)
    const activas = query.data.filter((e) => e.activo)
    const ocurrencias: OcurrenciaEfemeride[] = []
    for (const ef of activas) {
      ocurrencias.push(...expandirOcurrencias(ef, hoy, diasAdelante))
    }
    ocurrencias.sort((a, b) => a.fecha.getTime() - b.fecha.getTime())
    return ocurrencias
  }, [query.data, diasAdelante])

  return { proximas, isLoading: query.isLoading, error: query.error }
}

export function formatFechaEfemeride(fecha: Date): string {
  return fecha.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })
}

export function labelDiasRestantes(dias: number): string {
  if (dias === 0) return 'Hoy'
  if (dias === 1) return 'Mañana'
  if (dias < 7) return `En ${dias} días`
  if (dias < 14) return `En ${dias} días`
  return `En ${Math.round(dias / 7)} semanas`
}
