import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { LocalSelector } from '@/components/ui/LocalSelector'

// ── Tipos ────────────────────────────────────────────────────────────────────

interface RecetaRef {
  id: string
  nombre: string
  tipo: string | null
  rendimiento_kg: number | null
  rendimiento_porciones: number | null
}

interface LoteRelleno {
  id: string
  receta_id: string | null
  fecha: string
  cantidad_recetas: number | null
  peso_total_kg: number | null
  local: string | null
}

interface LoteMasa {
  id: string
  receta_id: string | null
  fecha: string
  kg_producidos: number | null
  local: string | null
}

interface LoteProduccion {
  id: string
  receta_id: string | null
  nombre_libre: string | null
  categoria: string | null
  fecha: string
  cantidad_producida: number | null
  unidad: string | null
  merma_cantidad: number | null
  merma_motivo: string | null
  local: string | null
}

interface RendimientoAgg {
  receta_id: string
  receta_nombre: string
  tipo: string
  lotes: number
  teorico: number
  teoricoUnidad: 'kg' | 'porciones'
  realPromedio: number
  desvioPct: number
  ultimaFecha: string
}

interface MermaAgg {
  key: string
  nombre: string
  categoria: string
  producido: number
  mermado: number
  pctMerma: number
  lotesConMerma: number
  motivosTop: { motivo: string; count: number }[]
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function restarDias(d: number): string {
  return new Date(Date.now() - d * 86400000).toISOString().split('T')[0]
}

function fmtNum(n: number, dec = 1): string {
  return n.toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

function fmtFecha(s: string): string {
  return new Date(s + 'T12:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })
}

// ── Componente ───────────────────────────────────────────────────────────────

export function AnalisisTab() {
  const [local, setLocal] = useState<'vedia' | 'saavedra'>('vedia')
  const [ventanaDias, setVentanaDias] = useState<7 | 30 | 90>(30)
  const desde = useMemo(() => restarDias(ventanaDias), [ventanaDias])

  // ── Recetas ──
  const { data: recetas } = useQuery({
    queryKey: ['cocina-recetas-analisis'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_recetas')
        .select('id, nombre, tipo, rendimiento_kg, rendimiento_porciones')
      if (error) throw error
      const m = new Map<string, RecetaRef>()
      for (const r of (data as RecetaRef[])) m.set(r.id, r)
      return m
    },
  })

  // ── Lotes de relleno ──
  const { data: lotesRelleno } = useQuery({
    queryKey: ['cocina-analisis-relleno', local, desde],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_relleno')
        .select('id, receta_id, fecha, cantidad_recetas, peso_total_kg, local')
        .eq('local', local)
        .gte('fecha', desde)
      if (error) throw error
      return data as LoteRelleno[]
    },
  })

  // ── Lotes de masa ──
  const { data: lotesMasa } = useQuery({
    queryKey: ['cocina-analisis-masa', local, desde],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_masa')
        .select('id, receta_id, fecha, kg_producidos, local')
        .eq('local', local)
        .gte('fecha', desde)
      if (error) throw error
      return data as LoteMasa[]
    },
  })

  // ── Lotes de producción (salsa/postre/pasteleria/panaderia/prueba) ──
  const { data: lotesProduccion } = useQuery({
    queryKey: ['cocina-analisis-produccion', local, desde],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_produccion')
        .select('id, receta_id, nombre_libre, categoria, fecha, cantidad_producida, unidad, merma_cantidad, merma_motivo, local')
        .eq('local', local)
        .gte('fecha', desde)
      if (error) throw error
      return data as LoteProduccion[]
    },
  })

  // ── Agregado: rendimientos por receta ──
  const rendimientos = useMemo<RendimientoAgg[]>(() => {
    if (!recetas) return []
    const recetasMap = recetas
    const agg = new Map<string, { lotes: Array<{ real: number; fecha: string }>; tipo: string; unidad: 'kg' | 'porciones'; teorico: number }>()

    function push(recetaId: string | null, real: number, fecha: string, tipoDefault: string, unidad: 'kg' | 'porciones') {
      if (!recetaId) return
      const r = recetasMap.get(recetaId)
      if (!r) return
      const teorico = unidad === 'kg' ? (r.rendimiento_kg ?? 0) : (r.rendimiento_porciones ?? 0)
      if (!teorico || teorico <= 0) return
      if (!agg.has(recetaId)) {
        agg.set(recetaId, { lotes: [], tipo: r.tipo ?? tipoDefault, unidad, teorico })
      }
      agg.get(recetaId)!.lotes.push({ real, fecha })
    }

    // Relleno: real = peso_total_kg / cantidad_recetas
    for (const l of lotesRelleno ?? []) {
      if (!l.peso_total_kg || !l.cantidad_recetas || l.cantidad_recetas <= 0) continue
      push(l.receta_id, l.peso_total_kg / l.cantidad_recetas, l.fecha, 'relleno', 'kg')
    }

    // Masa: real = kg_producidos (asume 1 receta)
    for (const l of lotesMasa ?? []) {
      if (!l.kg_producidos) continue
      push(l.receta_id, l.kg_producidos, l.fecha, 'masa', 'kg')
    }

    // Producción (salsa/postre/etc.)
    for (const l of lotesProduccion ?? []) {
      if (!l.cantidad_producida) continue
      const unidad = l.unidad === 'kg' ? 'kg' : 'porciones'
      push(l.receta_id, l.cantidad_producida, l.fecha, l.categoria ?? 'otro', unidad)
    }

    const out: RendimientoAgg[] = []
    for (const [recetaId, info] of agg) {
      const r = recetasMap.get(recetaId)!
      if (info.lotes.length === 0) continue
      const sum = info.lotes.reduce((s, x) => s + x.real, 0)
      const realPromedio = sum / info.lotes.length
      const desvioPct = ((realPromedio - info.teorico) / info.teorico) * 100
      const ultima = info.lotes.reduce((m, x) => (x.fecha > m ? x.fecha : m), info.lotes[0].fecha)
      out.push({
        receta_id: recetaId,
        receta_nombre: r.nombre,
        tipo: info.tipo,
        lotes: info.lotes.length,
        teorico: info.teorico,
        teoricoUnidad: info.unidad,
        realPromedio,
        desvioPct,
        ultimaFecha: ultima,
      })
    }
    // Ordenar por desvío absoluto desc
    out.sort((a, b) => Math.abs(b.desvioPct) - Math.abs(a.desvioPct))
    return out
  }, [recetas, lotesRelleno, lotesMasa, lotesProduccion])

  // ── Agregado: merma ──
  const merma = useMemo<MermaAgg[]>(() => {
    if (!lotesProduccion || !recetas) return []
    const agg = new Map<string, { nombre: string; categoria: string; producido: number; mermado: number; lotesConMerma: number; motivos: Map<string, number> }>()
    for (const l of lotesProduccion) {
      const recetaNombre = l.receta_id ? recetas.get(l.receta_id)?.nombre ?? null : null
      const nombre = recetaNombre ?? l.nombre_libre ?? '(sin nombre)'
      const key = nombre.toLowerCase()
      if (!agg.has(key)) {
        agg.set(key, { nombre, categoria: l.categoria ?? '—', producido: 0, mermado: 0, lotesConMerma: 0, motivos: new Map() })
      }
      const e = agg.get(key)!
      e.producido += l.cantidad_producida ?? 0
      const m = l.merma_cantidad ?? 0
      if (m > 0) {
        e.mermado += m
        e.lotesConMerma += 1
        const motivo = (l.merma_motivo ?? 'Sin motivo').trim()
        e.motivos.set(motivo, (e.motivos.get(motivo) ?? 0) + 1)
      }
    }
    const out: MermaAgg[] = []
    for (const [key, v] of agg) {
      if (v.mermado === 0) continue
      const pct = v.producido > 0 ? (v.mermado / v.producido) * 100 : 0
      const motivosTop = [...v.motivos.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([motivo, count]) => ({ motivo, count }))
      out.push({
        key,
        nombre: v.nombre,
        categoria: v.categoria,
        producido: v.producido,
        mermado: v.mermado,
        pctMerma: pct,
        lotesConMerma: v.lotesConMerma,
        motivosTop,
      })
    }
    out.sort((a, b) => b.pctMerma - a.pctMerma)
    return out
  }, [lotesProduccion, recetas])

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex items-center gap-4 flex-wrap">
        <LocalSelector value={local} onChange={(v) => setLocal(v as 'vedia' | 'saavedra')} />
        <div className="flex items-center gap-1 border border-gray-200 rounded-lg bg-white p-0.5">
          <span className="text-[10px] text-gray-500 px-2">Período:</span>
          {([7, 30, 90] as const).map((n) => (
            <button
              key={n}
              onClick={() => setVentanaDias(n)}
              className={cn(
                'px-2.5 py-1 text-xs rounded transition-colors',
                ventanaDias === n
                  ? 'bg-rodziny-700 text-white font-medium'
                  : 'text-gray-600 hover:bg-gray-100'
              )}
            >
              {n} días
            </button>
          ))}
        </div>
      </div>

      {/* ── RENDIMIENTO REAL vs TEÓRICO ── */}
      <section className="bg-white rounded-lg border border-surface-border overflow-hidden">
        <header className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-800">Rendimiento real vs. teórico</h3>
            <p className="text-[11px] text-gray-500">
              Promedio real de los últimos {ventanaDias} días comparado con el rendimiento de la receta. Desvío alto sugiere ajustar procesos o actualizar la receta.
            </p>
          </div>
          <span className="text-[10px] text-gray-400">{rendimientos.length} receta{rendimientos.length !== 1 ? 's' : ''}</span>
        </header>
        {rendimientos.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-gray-500">
            Sin datos suficientes en este período. Necesitás recetas con rendimiento teórico y lotes de producción con cantidad real.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr className="text-[10px] uppercase text-gray-500">
                  <th className="px-4 py-2.5 text-left">Receta</th>
                  <th className="px-4 py-2.5 text-left">Tipo</th>
                  <th className="px-4 py-2.5 text-right">Lotes</th>
                  <th className="px-4 py-2.5 text-right">Teórico</th>
                  <th className="px-4 py-2.5 text-right">Real prom.</th>
                  <th className="px-4 py-2.5 text-right">Desvío</th>
                  <th className="px-4 py-2.5 text-right">Último</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rendimientos.map((r) => {
                  const abs = Math.abs(r.desvioPct)
                  const color = abs < 5 ? 'text-green-700' : abs < 10 ? 'text-amber-700' : 'text-red-700'
                  const rowBg = abs >= 10 ? 'bg-red-50/50' : abs >= 5 ? 'bg-amber-50/30' : ''
                  return (
                    <tr key={r.receta_id} className={cn('hover:bg-gray-50', rowBg)}>
                      <td className="px-4 py-3 font-medium text-gray-900">{r.receta_nombre}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs capitalize">{r.tipo}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{r.lotes}</td>
                      <td className="px-4 py-3 text-right text-gray-600">
                        {fmtNum(r.teorico, r.teoricoUnidad === 'kg' ? 2 : 0)} <span className="text-[10px] text-gray-400">{r.teoricoUnidad === 'kg' ? 'kg' : 'porc.'}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700 font-medium">
                        {fmtNum(r.realPromedio, r.teoricoUnidad === 'kg' ? 2 : 0)}
                      </td>
                      <td className={cn('px-4 py-3 text-right font-semibold', color)}>
                        {r.desvioPct >= 0 ? '+' : ''}{fmtNum(r.desvioPct, 1)}%
                      </td>
                      <td className="px-4 py-3 text-right text-[10px] text-gray-400">
                        {fmtFecha(r.ultimaFecha)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── MERMA HISTÓRICA ── */}
      <section className="bg-white rounded-lg border border-surface-border overflow-hidden">
        <header className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-800">Merma por producto</h3>
            <p className="text-[11px] text-gray-500">
              Cantidad descartada sobre el total producido en los últimos {ventanaDias} días. Motivos más frecuentes a la derecha.
            </p>
          </div>
          <span className="text-[10px] text-gray-400">{merma.length} con merma</span>
        </header>
        {merma.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-gray-500">
            Sin merma registrada en este período.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr className="text-[10px] uppercase text-gray-500">
                  <th className="px-4 py-2.5 text-left">Producto</th>
                  <th className="px-4 py-2.5 text-left">Categoría</th>
                  <th className="px-4 py-2.5 text-right">Producido</th>
                  <th className="px-4 py-2.5 text-right">Mermado</th>
                  <th className="px-4 py-2.5 text-right">% Merma</th>
                  <th className="px-4 py-2.5 text-right">Lotes</th>
                  <th className="px-4 py-2.5 text-left">Motivos top</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {merma.map((m) => {
                  const color = m.pctMerma < 3 ? 'text-green-700' : m.pctMerma < 8 ? 'text-amber-700' : 'text-red-700'
                  const rowBg = m.pctMerma >= 8 ? 'bg-red-50/50' : m.pctMerma >= 3 ? 'bg-amber-50/30' : ''
                  return (
                    <tr key={m.key} className={cn('hover:bg-gray-50', rowBg)}>
                      <td className="px-4 py-3 font-medium text-gray-900">{m.nombre}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{m.categoria}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{fmtNum(m.producido, 0)}</td>
                      <td className="px-4 py-3 text-right text-gray-700 font-medium">{fmtNum(m.mermado, 1)}</td>
                      <td className={cn('px-4 py-3 text-right font-semibold', color)}>{fmtNum(m.pctMerma, 1)}%</td>
                      <td className="px-4 py-3 text-right text-gray-500">{m.lotesConMerma}</td>
                      <td className="px-4 py-3 text-[11px] text-gray-600">
                        {m.motivosTop.length === 0 ? (
                          <span className="text-gray-400">—</span>
                        ) : (
                          m.motivosTop.map((t, i) => (
                            <span key={i} className="inline-block mr-2">
                              {t.motivo} <span className="text-gray-400">×{t.count}</span>
                            </span>
                          ))
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
