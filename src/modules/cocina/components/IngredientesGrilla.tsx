import { useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabaseAnon as supabase } from '@/lib/supabaseAnon'
import { useCostosRecetas } from '../hooks/useCostosRecetas'

export interface IngredienteReal {
  ing_id: string
  nombre: string
  cantidad_receta: number
  cantidad_real: number
  unidad: string
  producto_id: string | null
}

function formatARS(n: number): string {
  return n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
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
  // Cantidad de recetas que se van a producir. Los ingredientes se pre-llenan
  // multiplicados por este número. Default: 1.
  multiplicador?: number
}

// Muestra los ingredientes de la receta seleccionada con cantidades editables.
// Si no hay ingredientes cargados en la receta, no renderiza nada.
export function IngredientesGrilla({ recetaId, onChange, multiplicador = 1 }: Props) {
  const [expandido, setExpandido] = useState(false)
  const [cantidades, setCantidades] = useState<Record<string, string>>({})
  const { costos } = useCostosRecetas()
  const factor = multiplicador > 0 ? multiplicador : 1

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

  // Inicializar cantidades con defaults de la receta cuando cambia la receta
  // o el multiplicador (cantidad de recetas a producir). Multiplica cada
  // ingrediente base × factor para que el operario vea directamente cuánto usar.
  useEffect(() => {
    if (ingredientes) {
      const initial: Record<string, string> = {}
      for (const i of ingredientes) initial[i.id] = String(+(i.cantidad * factor).toFixed(3))
      setCantidades(initial)
    }
  }, [ingredientes, factor])

  // Emitir al padre ante cada cambio. cantidad_receta refleja el total base
  // (multiplicado por factor) — así lo que se guarda en ingredientes_reales
  // representa lo realmente pedido para ese lote.
  const reales: IngredienteReal[] = useMemo(() => {
    if (!ingredientes) return []
    return ingredientes.map((i) => ({
      ing_id: i.id,
      nombre: i.nombre,
      cantidad_receta: +(i.cantidad * factor).toFixed(3),
      cantidad_real: Number(cantidades[i.id] ?? i.cantidad * factor),
      unidad: i.unidad,
      producto_id: i.producto_id,
    }))
  }, [ingredientes, cantidades, factor])

  useEffect(() => {
    onChange(reales)
  }, [reales, onChange])

  // Costos por ingrediente — escalar según ratio cantidad_real/cantidad_receta
  const costoReceta = recetaId ? costos.get(recetaId) : null
  const costoPorIng = useMemo(() => {
    const m = new Map<string, number>()
    if (!costoReceta) return m
    for (const d of costoReceta.detalles) {
      if (d.costoTotal != null) m.set(d.id, d.costoTotal)
    }
    return m
  }, [costoReceta])

  const costoBaseTotal = useMemo(() => {
    if (!costoReceta) return null
    return costoReceta.costoBase * factor
  }, [costoReceta, factor])

  const costoAjustadoTotal = useMemo(() => {
    if (!ingredientes || !costoReceta) return null
    let total = 0
    for (const i of ingredientes) {
      const base = costoPorIng.get(i.id) ?? 0
      const real = Number(cantidades[i.id] ?? i.cantidad * factor)
      const ratio = i.cantidad > 0 ? real / i.cantidad : 1
      total += base * ratio
    }
    return total
  }, [ingredientes, cantidades, costoPorIng, costoReceta, factor])

  if (!recetaId) return null
  if (isLoading) return <p className="text-[10px] text-gray-400">Cargando ingredientes…</p>
  if (!ingredientes || ingredientes.length === 0) return null

  // Detectar si alguna cantidad fue modificada vs el default (receta × factor)
  const ajustados = reales.filter((r) => Math.abs(r.cantidad_real - r.cantidad_receta) > 0.001).length
  const hayAjuste = ajustados > 0 && costoAjustadoTotal != null && costoBaseTotal != null && Math.abs(costoAjustadoTotal - costoBaseTotal) > 1

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
              : factor > 1
                ? `Multiplicado por ${factor} recetas · Tocá para ajustar`
                : 'Cantidades por receta · Tocá para ajustar si hubo variación'}
          </p>
        </div>
        {costoAjustadoTotal != null && costoAjustadoTotal > 0 && (
          <div className="text-right mr-2">
            <p className={'text-xs font-semibold ' + (hayAjuste ? 'text-amber-700' : 'text-emerald-700')}>
              {formatARS(costoAjustadoTotal)}
            </p>
            {hayAjuste && costoBaseTotal != null && (
              <p className="text-[9px] text-gray-400">base: {formatARS(costoBaseTotal)}</p>
            )}
          </div>
        )}
        <span className="text-gray-400 text-xs">{expandido ? '▲' : '▼'}</span>
      </button>

      {expandido && (
        <div className="border-t border-gray-200 p-2 space-y-1.5 max-h-64 overflow-y-auto">
          {ingredientes.map((i) => {
            const esperado = +(i.cantidad * factor).toFixed(3)
            const raw = cantidades[i.id] ?? String(esperado)
            const realNum = Number(raw)
            const ajustado = !Number.isNaN(realNum) && Math.abs(realNum - esperado) > 0.001
            const costoBaseIng = costoPorIng.get(i.id) ?? null
            const ratio = i.cantidad > 0 && !Number.isNaN(realNum) ? realNum / i.cantidad : 1
            const costoIng = costoBaseIng != null ? costoBaseIng * ratio : null
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
                <span className="text-[10px] text-gray-500 w-14 text-right tabular-nums">
                  {costoIng != null ? formatARS(costoIng) : '—'}
                </span>
              </div>
            )
          })}
          <div className="pt-1 flex justify-between text-[10px] text-gray-400">
            <span>{factor > 1 ? `Base × ${factor} recetas` : 'Base de la receta'}</span>
            <button
              type="button"
              onClick={() => {
                const reset: Record<string, string> = {}
                for (const i of ingredientes) reset[i.id] = String(+(i.cantidad * factor).toFixed(3))
                setCantidades(reset)
              }}
              className="hover:text-gray-700 underline"
            >
              Resetear
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
