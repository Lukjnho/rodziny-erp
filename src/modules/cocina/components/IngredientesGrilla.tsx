import { useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabaseAnon as supabase } from '@/lib/supabaseAnon'

export interface IngredienteReal {
  ing_id: string
  nombre: string
  cantidad_receta: number
  cantidad_real: number
  unidad: string
  producto_id: string | null
}

interface IngredienteRow {
  id: string
  nombre: string
  cantidad: number
  unidad: string
  producto_id: string | null
}

interface Props {
  recetaId: string | null
  onChange: (ingredientes: IngredienteReal[]) => void
}

// Muestra los ingredientes de la receta seleccionada con cantidades editables.
// Si no hay ingredientes cargados en la receta, no renderiza nada.
export function IngredientesGrilla({ recetaId, onChange }: Props) {
  const [expandido, setExpandido] = useState(false)
  const [cantidades, setCantidades] = useState<Record<string, string>>({})

  const { data: ingredientes, isLoading } = useQuery({
    queryKey: ['cocina-receta-ingredientes-grilla', recetaId],
    queryFn: async () => {
      if (!recetaId) return [] as IngredienteRow[]
      const { data, error } = await supabase
        .from('cocina_receta_ingredientes')
        .select('id, nombre, cantidad, unidad, producto_id')
        .eq('receta_id', recetaId)
        .order('orden')
      if (error) throw error
      return data as IngredienteRow[]
    },
    enabled: !!recetaId,
  })

  // Inicializar cantidades con defaults de la receta cuando cambia
  useEffect(() => {
    if (ingredientes) {
      const initial: Record<string, string> = {}
      for (const i of ingredientes) initial[i.id] = String(i.cantidad)
      setCantidades(initial)
    }
  }, [ingredientes])

  // Emitir al padre ante cada cambio
  const reales: IngredienteReal[] = useMemo(() => {
    if (!ingredientes) return []
    return ingredientes.map((i) => ({
      ing_id: i.id,
      nombre: i.nombre,
      cantidad_receta: i.cantidad,
      cantidad_real: Number(cantidades[i.id] ?? i.cantidad),
      unidad: i.unidad,
      producto_id: i.producto_id,
    }))
  }, [ingredientes, cantidades])

  useEffect(() => {
    onChange(reales)
  }, [reales, onChange])

  if (!recetaId) return null
  if (isLoading) return <p className="text-[10px] text-gray-400">Cargando ingredientes…</p>
  if (!ingredientes || ingredientes.length === 0) return null

  // Detectar si alguna cantidad fue modificada vs receta
  const ajustados = reales.filter((r) => Math.abs(r.cantidad_real - r.cantidad_receta) > 0.001).length

  return (
    <div className="border border-gray-200 rounded-lg bg-gray-50">
      <button
        type="button"
        onClick={() => setExpandido((v) => !v)}
        className="w-full px-3 py-2 flex items-center justify-between text-left hover:bg-gray-100 rounded-lg"
      >
        <div className="flex-1">
          <p className="text-xs font-medium text-gray-700">
            Ingredientes de la receta ({ingredientes.length})
          </p>
          <p className="text-[10px] text-gray-500">
            {ajustados > 0
              ? `${ajustados} ajustado${ajustados > 1 ? 's' : ''} — se guarda la cantidad real`
              : 'Cantidades por receta · Tocá para ajustar si hubo variación'}
          </p>
        </div>
        <span className="text-gray-400 text-xs">{expandido ? '▲' : '▼'}</span>
      </button>

      {expandido && (
        <div className="border-t border-gray-200 p-2 space-y-1.5 max-h-64 overflow-y-auto">
          {ingredientes.map((i) => {
            const raw = cantidades[i.id] ?? String(i.cantidad)
            const realNum = Number(raw)
            const ajustado = !Number.isNaN(realNum) && Math.abs(realNum - i.cantidad) > 0.001
            return (
              <div key={i.id} className="flex items-center gap-2">
                <span className={'flex-1 text-xs truncate ' + (ajustado ? 'text-amber-700 font-medium' : 'text-gray-700')}>
                  {i.nombre}
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min={0}
                  value={raw}
                  onChange={(e) => setCantidades((prev) => ({ ...prev, [i.id]: e.target.value }))}
                  className={'w-20 border rounded px-2 py-1 text-xs text-right ' + (ajustado ? 'border-amber-400 bg-amber-50' : 'border-gray-300 bg-white')}
                />
                <span className="text-[10px] text-gray-500 w-8">{i.unidad}</span>
              </div>
            )
          })}
          <div className="pt-1 flex justify-between text-[10px] text-gray-400">
            <span>Base de la receta</span>
            <button
              type="button"
              onClick={() => {
                const reset: Record<string, string> = {}
                for (const i of ingredientes) reset[i.id] = String(i.cantidad)
                setCantidades(reset)
              }}
              className="hover:text-gray-700 underline"
            >
              Resetear a receta
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
