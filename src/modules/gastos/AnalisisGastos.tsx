import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { LocalSelector } from '@/components/ui/LocalSelector'
import { formatARS, cn } from '@/lib/utils'

const MESES_LABEL = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

function totalMes(porMes: Map<string, number>, meses: string[]): number {
  return meses.reduce((s, m) => s + (porMes.get(m) ?? 0), 0)
}

function formatCell(v: number): string {
  return v !== 0 ? formatARS(v) : '—'
}

interface SubcatData { nombre: string; porMes: Map<string, number> }
interface CatData    { nombre: string; subcats: Map<string, SubcatData>; porMes: Map<string, number> }

export function AnalisisGastos() {
  const [local, setLocal] = useState<'ambos' | 'vedia' | 'saavedra'>('vedia')
  const localActivo = local === 'ambos' ? null : local
  const [año, setAño] = useState(() => String(new Date().getFullYear()))
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set())

  const { data: rawGastos, isLoading } = useQuery({
    queryKey: ['gastos_vista', año, local],
    queryFn: async () => {
      let q = supabase
        .from('gastos')
        .select('categoria, subcategoria, periodo, importe_total, importe_neto')
        .gte('periodo', `${año}-01`)
        .lte('periodo', `${año}-12`)
        .neq('cancelado', true)
      if (localActivo) q = q.eq('local', localActivo)
      const { data } = await q
      return data ?? []
    },
  })

  const { categorias, mesesConDatos } = useMemo(() => {
    const cats = new Map<string, CatData>()
    const mesesSet = new Set<string>()

    for (const g of rawGastos ?? []) {
      const cat = g.categoria  || 'Sin categoría'
      const sub = g.subcategoria || cat
      const mes = g.periodo
      const monto = Number(g.importe_neto ?? g.importe_total) || 0
      if (!monto) continue

      mesesSet.add(mes)

      if (!cats.has(cat)) cats.set(cat, { nombre: cat, subcats: new Map(), porMes: new Map() })
      const catObj = cats.get(cat)!
      catObj.porMes.set(mes, (catObj.porMes.get(mes) ?? 0) + monto)

      if (!catObj.subcats.has(sub)) catObj.subcats.set(sub, { nombre: sub, porMes: new Map() })
      const subObj = catObj.subcats.get(sub)!
      subObj.porMes.set(mes, (subObj.porMes.get(mes) ?? 0) + monto)
    }

    return {
      categorias: cats,
      mesesConDatos: Array.from(mesesSet).sort(),
    }
  }, [rawGastos])

  const totalGeneral = useMemo(() => {
    const map = new Map<string, number>()
    for (const [, cat] of categorias) {
      for (const [mes, v] of cat.porMes) {
        map.set(mes, (map.get(mes) ?? 0) + v)
      }
    }
    return map
  }, [categorias])

  const meses = useMemo(
    () => Array.from({ length: 12 }, (_, i) => `${año}-${String(i + 1).padStart(2, '0')}`),
    [año]
  )

  function toggleCat(cat: string) {
    setExpandidos((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat); else next.add(cat)
      return next
    })
  }

  function expandirTodo() { setExpandidos(new Set(categorias.keys())) }
  function colapsarTodo() { setExpandidos(new Set()) }

  const totalAcum = totalMes(totalGeneral, meses)

  return (
    <div>
      <div className="flex items-center gap-4 mb-4 flex-wrap">
        <LocalSelector value={local} onChange={(v) => setLocal(v as 'ambos' | 'vedia' | 'saavedra')} options={['vedia', 'saavedra', 'ambos']} />
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-500">Año</label>
          <input
            type="number" min="2020" max="2099"
            value={año} onChange={(e) => setAño(e.target.value)}
            className="w-24 border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-rodziny-500"
          />
        </div>
        <div className="flex gap-2 ml-auto">
          <button onClick={expandirTodo}  className="text-xs text-rodziny-700 hover:underline">Expandir todo</button>
          <span className="text-gray-300">|</span>
          <button onClick={colapsarTodo} className="text-xs text-gray-500 hover:underline">Colapsar todo</button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40 text-gray-400 text-sm">Cargando...</div>
      ) : categorias.size === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 text-gray-400 text-sm gap-2">
          <span>Sin datos para {año}.</span>
          <span className="text-xs">Cargá gastos en el tab "Listado" o importá desde Finanzas → Importar datos.</span>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-surface-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-900 text-white">
                  <th className="sticky left-0 bg-gray-900 px-4 py-3 text-left font-semibold min-w-[220px] z-10">CONCEPTO</th>
                  {meses.map((mes) => (
                    <th key={mes} className={cn(
                      'px-3 py-3 text-right font-semibold min-w-[100px]',
                      mesesConDatos.includes(mes) ? 'text-white' : 'text-gray-500'
                    )}>
                      {MESES_LABEL[parseInt(mes.substring(5, 7)) - 1]}
                    </th>
                  ))}
                  <th className="px-3 py-3 text-right font-semibold text-yellow-300 min-w-[115px] border-l border-gray-700">ACUM</th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-rodziny-800 text-white border-b-2 border-rodziny-600">
                  <td className="sticky left-0 bg-rodziny-800 px-4 py-2.5 font-bold z-10">
                    RODZINY {localActivo ? `· ${localActivo.toUpperCase()}` : '(CONSOLIDADO)'}
                  </td>
                  {meses.map((mes) => (
                    <td key={mes} className="px-3 py-2.5 text-right font-semibold">
                      {formatCell(totalGeneral.get(mes) ?? 0)}
                    </td>
                  ))}
                  <td className="px-3 py-2.5 text-right font-bold text-yellow-300 border-l border-rodziny-600">
                    {formatCell(totalAcum)}
                  </td>
                </tr>

                {Array.from(categorias.values()).map((cat) => {
                  const isOpen = expandidos.has(cat.nombre)
                  const acumCat = totalMes(cat.porMes, meses)

                  return [
                    <tr
                      key={`cat-${cat.nombre}`}
                      className="bg-gray-800 text-white cursor-pointer hover:bg-gray-700 transition-colors border-b border-gray-700"
                      onClick={() => toggleCat(cat.nombre)}
                    >
                      <td className="sticky left-0 bg-gray-800 px-4 py-2 font-semibold z-10 hover:bg-gray-700">
                        <span className="mr-2 text-gray-400">{isOpen ? '▾' : '▸'}</span>
                        {cat.nombre}
                      </td>
                      {meses.map((mes) => (
                        <td key={mes} className="px-3 py-2 text-right font-medium">
                          {formatCell(cat.porMes.get(mes) ?? 0)}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right font-semibold text-yellow-300 border-l border-gray-700">
                        {formatCell(acumCat)}
                      </td>
                    </tr>,

                    ...(isOpen
                      ? Array.from(cat.subcats.values()).map((sub) => {
                          const acumSub = totalMes(sub.porMes, meses)
                          if (sub.nombre === cat.nombre && cat.subcats.size === 1) return null
                          return (
                            <tr
                              key={`sub-${cat.nombre}-${sub.nombre}`}
                              className="bg-white border-b border-gray-50 hover:bg-gray-50"
                            >
                              <td className="sticky left-0 bg-white px-4 py-1.5 text-gray-700 pl-10 z-10 hover:bg-gray-50">
                                {sub.nombre}
                              </td>
                              {meses.map((mes) => (
                                <td key={mes} className="px-3 py-1.5 text-right text-gray-600">
                                  {formatCell(sub.porMes.get(mes) ?? 0)}
                                </td>
                              ))}
                              <td className="px-3 py-1.5 text-right text-gray-700 font-medium border-l border-gray-100">
                                {formatCell(acumSub)}
                              </td>
                            </tr>
                          )
                        }).filter(Boolean)
                      : []),
                  ]
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
