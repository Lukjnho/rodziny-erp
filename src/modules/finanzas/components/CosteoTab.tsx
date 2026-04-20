import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { KPICard } from '@/components/ui/KPICard'
import { cn, formatARS } from '@/lib/utils'
import { useCostosRecetas } from '@/modules/cocina/hooks/useCostosRecetas'

interface Receta {
  id: string
  nombre: string
  tipo: string
  rendimiento_kg: number | null
  rendimiento_porciones: number | null
  margen_seguridad_pct: number | null
  activo: boolean
}

interface Producto {
  id: string
  nombre: string
  codigo: string
  tipo: string
  unidad: string
  local: string
  activo: boolean
  receta_id: string | null
  precio_venta: number | null
}

const TIPO_RECETA_LABEL: Record<string, string> = {
  relleno: 'Relleno', masa: 'Masa', salsa: 'Salsa', subreceta: 'Subreceta', otro: 'Otro',
}
const TIPO_PRODUCTO_LABEL: Record<string, string> = {
  pasta: 'Pasta', salsa: 'Salsa', postre: 'Postre', relleno: 'Relleno', masa: 'Masa', panificado: 'Panificado',
}

export function CosteoTab() {
  const [subtab, setSubtab] = useState<'productos' | 'recetas'>('productos')

  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        <button
          onClick={() => setSubtab('productos')}
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
            subtab === 'productos' ? 'border-rodziny-600 text-rodziny-800' : 'border-transparent text-gray-500 hover:text-gray-700'
          )}
        >Productos y márgenes</button>
        <button
          onClick={() => setSubtab('recetas')}
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
            subtab === 'recetas' ? 'border-rodziny-600 text-rodziny-800' : 'border-transparent text-gray-500 hover:text-gray-700'
          )}
        >Recetas y margen de seguridad</button>
      </div>

      {subtab === 'productos' && <VistaProductos />}
      {subtab === 'recetas' && <VistaRecetas />}
    </div>
  )
}

// ─── Vista Productos: costo, precio venta, margen ───────────────────────────
function VistaProductos() {
  const qc = useQueryClient()
  const [busqueda, setBusqueda] = useState('')
  const [filtroLocal, setFiltroLocal] = useState<'todos' | 'vedia' | 'saavedra' | 'ambos'>('todos')
  const [editando, setEditando] = useState<{ id: string; valor: string } | null>(null)

  const { data: productos } = useQuery({
    queryKey: ['cocina-productos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_productos')
        .select('id, nombre, codigo, tipo, unidad, local, activo, receta_id, precio_venta')
        .eq('activo', true)
        .order('nombre')
      if (error) throw error
      return data as Producto[]
    },
  })

  const { data: recetas } = useQuery({
    queryKey: ['cocina-recetas-opciones-costeo'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_recetas')
        .select('id, nombre')
        .order('nombre')
      if (error) throw error
      return data as { id: string; nombre: string }[]
    },
  })

  const { costos } = useCostosRecetas()

  const actualizarPrecio = useMutation({
    mutationFn: async ({ id, precio }: { id: string; precio: number | null }) => {
      const { error } = await supabase.from('cocina_productos').update({ precio_venta: precio }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cocina-productos'] }),
  })

  const costoPorProducto = useMemo(() => {
    const map = new Map<string, { costo: number | null; base: string | null }>()
    for (const p of productos ?? []) {
      if (!p.receta_id) { map.set(p.id, { costo: null, base: null }); continue }
      const c = costos.get(p.receta_id)
      if (!c) { map.set(p.id, { costo: null, base: null }); continue }
      const u = (p.unidad ?? '').toLowerCase()
      const esPeso = u === 'kg' || u === 'litros' || u === 'lt'
      if (esPeso && c.costoPorKg != null) map.set(p.id, { costo: c.costoPorKg, base: 'kg' })
      else if (!esPeso && c.costoPorPorcion != null) map.set(p.id, { costo: c.costoPorPorcion, base: 'porción' })
      else map.set(p.id, { costo: null, base: null })
    }
    return map
  }, [productos, costos])

  const filtrados = useMemo(() => {
    let lista = productos ?? []
    if (filtroLocal === 'vedia') lista = lista.filter((p) => p.local === 'vedia' || p.local === 'ambos')
    else if (filtroLocal === 'saavedra') lista = lista.filter((p) => p.local === 'saavedra' || p.local === 'ambos')
    else if (filtroLocal === 'ambos') lista = lista.filter((p) => p.local === 'ambos')
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase()
      lista = lista.filter((p) => p.nombre.toLowerCase().includes(q) || p.codigo.toLowerCase().includes(q))
    }
    return lista
  }, [productos, filtroLocal, busqueda])

  const kpis = useMemo(() => {
    const all = productos ?? []
    let conPrecio = 0, sinPrecio = 0, margenSum = 0, margenN = 0
    let mejorMargen: { nombre: string; pct: number } | null = null
    let peorMargen: { nombre: string; pct: number } | null = null
    for (const p of all) {
      const info = costoPorProducto.get(p.id)
      if (p.precio_venta && info?.costo && p.precio_venta > 0) {
        conPrecio++
        const pct = ((p.precio_venta - info.costo) / p.precio_venta) * 100
        margenSum += pct
        margenN++
        if (!mejorMargen || pct > mejorMargen.pct) mejorMargen = { nombre: p.nombre, pct }
        if (!peorMargen || pct < peorMargen.pct) peorMargen = { nombre: p.nombre, pct }
      } else if (!p.precio_venta) sinPrecio++
    }
    return {
      conPrecio,
      sinPrecio,
      margenProm: margenN > 0 ? margenSum / margenN : null,
      mejor: mejorMargen,
      peor: peorMargen,
    }
  }, [productos, costoPorProducto])

  function guardarPrecio(id: string, valor: string) {
    const num = valor === '' ? null : parseFloat(valor.replace(',', '.'))
    actualizarPrecio.mutate({ id, precio: num && !isNaN(num) ? num : null })
    setEditando(null)
  }

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard label="Con precio" value={String(kpis.conPrecio)} color="green" />
        <KPICard label="Sin precio" value={String(kpis.sinPrecio)} color={kpis.sinPrecio > 0 ? 'yellow' : 'neutral'} />
        <KPICard
          label="Margen promedio"
          value={kpis.margenProm != null ? `${kpis.margenProm.toFixed(1)}%` : '—'}
          color={kpis.margenProm != null && kpis.margenProm > 60 ? 'green' : kpis.margenProm != null && kpis.margenProm > 40 ? 'yellow' : 'neutral'}
        />
        <KPICard
          label="Mejor margen"
          value={kpis.mejor ? `${kpis.mejor.pct.toFixed(1)}%` : '—'}
          color="blue"
        />
      </div>

      {/* Toolbar */}
      <div className="bg-white rounded-lg border border-surface-border p-3 flex flex-wrap gap-2 items-center">
        <input
          placeholder="Buscar por nombre o código..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm w-56"
        />
        <select
          value={filtroLocal}
          onChange={(e) => setFiltroLocal(e.target.value as typeof filtroLocal)}
          className="border border-gray-300 rounded px-2 py-1.5 text-sm"
        >
          <option value="todos">Todos los locales</option>
          <option value="vedia">Vedia</option>
          <option value="saavedra">Saavedra</option>
          <option value="ambos">Ambos</option>
        </select>
        <div className="ml-auto text-xs text-gray-400">
          Click en el precio para editarlo
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-lg border border-surface-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border bg-gray-50 text-left text-xs text-gray-500 uppercase">
              <th className="px-4 py-2">Producto</th>
              <th className="px-4 py-2">Tipo</th>
              <th className="px-4 py-2">Local</th>
              <th className="px-4 py-2">Receta</th>
              <th className="px-4 py-2 text-right">Costo</th>
              <th className="px-4 py-2 text-right">Precio venta</th>
              <th className="px-4 py-2 text-right">Margen</th>
              <th className="px-4 py-2 text-right">Markup</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((p) => {
              const rec = recetas?.find((r) => r.id === p.receta_id) ?? null
              const info = costoPorProducto.get(p.id)
              const costo = info?.costo ?? null
              const margenAbs = p.precio_venta && costo ? p.precio_venta - costo : null
              const margenPct = p.precio_venta && costo && p.precio_venta > 0 ? ((p.precio_venta - costo) / p.precio_venta) * 100 : null
              const markupPct = p.precio_venta && costo && costo > 0 ? ((p.precio_venta - costo) / costo) * 100 : null
              const enEdicion = editando?.id === p.id
              return (
                <tr key={p.id} className="border-b border-surface-border hover:bg-gray-50">
                  <td className="px-4 py-2">
                    <div className="font-medium">{p.nombre}</div>
                    <div className="text-[10px] text-gray-400 font-mono">{p.codigo} · {p.unidad}</div>
                  </td>
                  <td className="px-4 py-2">
                    <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700">{TIPO_PRODUCTO_LABEL[p.tipo] ?? p.tipo}</span>
                  </td>
                  <td className="px-4 py-2 capitalize text-xs text-gray-500">{p.local}</td>
                  <td className="px-4 py-2 text-xs">
                    {rec ? (
                      <span className="text-gray-700">{rec.nombre}</span>
                    ) : (
                      <span className="text-gray-300 italic">sin vincular</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {costo != null ? (
                      <div>
                        <div className="font-medium text-gray-800">{formatARS(costo)}</div>
                        <div className="text-[10px] text-gray-400">/{info?.base}</div>
                      </div>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {enEdicion ? (
                      <input
                        autoFocus
                        type="number"
                        step="0.01"
                        value={editando.valor}
                        onChange={(e) => setEditando({ id: p.id, valor: e.target.value })}
                        onBlur={() => guardarPrecio(p.id, editando.valor)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') guardarPrecio(p.id, editando.valor)
                          if (e.key === 'Escape') setEditando(null)
                        }}
                        className="w-24 border border-rodziny-400 rounded px-2 py-0.5 text-sm text-right"
                      />
                    ) : (
                      <button
                        onClick={() => setEditando({ id: p.id, valor: p.precio_venta != null ? String(p.precio_venta) : '' })}
                        className="font-medium text-gray-800 hover:bg-rodziny-50 rounded px-2 py-0.5 min-w-[80px] text-right"
                      >
                        {p.precio_venta != null ? formatARS(p.precio_venta) : <span className="text-gray-300 italic">—</span>}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {margenPct != null ? (
                      <div>
                        <div className={cn('font-semibold', margenPct > 60 ? 'text-green-600' : margenPct > 40 ? 'text-amber-600' : 'text-red-600')}>
                          {margenPct.toFixed(1)}%
                        </div>
                        {margenAbs != null && <div className="text-[10px] text-gray-400">{formatARS(margenAbs)}</div>}
                      </div>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-xs text-gray-500">
                    {markupPct != null ? `${markupPct.toFixed(0)}%` : '—'}
                  </td>
                </tr>
              )
            })}
            {filtrados.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No hay productos</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Advertencia */}
      {(kpis.sinPrecio > 0 || (kpis.peor && kpis.peor.pct < 30)) && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 space-y-1">
          {kpis.sinPrecio > 0 && (
            <div>⚠ {kpis.sinPrecio} producto(s) sin precio de venta cargado.</div>
          )}
          {kpis.peor && kpis.peor.pct < 30 && (
            <div>⚠ Menor margen: <strong>{kpis.peor.nombre}</strong> ({kpis.peor.pct.toFixed(1)}%) — considerá revisar el precio.</div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Vista Recetas: margen de seguridad editable ────────────────────────────
function VistaRecetas() {
  const qc = useQueryClient()
  const [busqueda, setBusqueda] = useState('')
  const [filtroTipo, setFiltroTipo] = useState<string>('todos')
  const [editando, setEditando] = useState<{ id: string; valor: string } | null>(null)

  const { data: recetas } = useQuery({
    queryKey: ['cocina-recetas'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_recetas')
        .select('id, nombre, tipo, rendimiento_kg, rendimiento_porciones, margen_seguridad_pct, activo')
        .eq('activo', true)
        .order('nombre')
      if (error) throw error
      return data as Receta[]
    },
  })

  const { costos } = useCostosRecetas()

  const actualizarMargen = useMutation({
    mutationFn: async ({ id, pct }: { id: string; pct: number }) => {
      const { error } = await supabase.from('cocina_recetas').update({ margen_seguridad_pct: pct }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cocina-recetas'] })
      qc.invalidateQueries({ queryKey: ['cocina-recetas-costeo'] })
    },
  })

  const filtrados = useMemo(() => {
    let lista = recetas ?? []
    if (filtroTipo !== 'todos') lista = lista.filter((r) => r.tipo === filtroTipo)
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase()
      lista = lista.filter((r) => r.nombre.toLowerCase().includes(q))
    }
    return lista
  }, [recetas, filtroTipo, busqueda])

  function guardarMargen(id: string, valor: string) {
    const num = parseFloat(valor.replace(',', '.'))
    const pct = !isNaN(num) ? num / 100 : 0
    actualizarMargen.mutate({ id, pct })
    setEditando(null)
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="bg-white rounded-lg border border-surface-border p-3 flex flex-wrap gap-2 items-center">
        <input
          placeholder="Buscar receta..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm w-56"
        />
        <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-sm">
          <option value="todos">Todos los tipos</option>
          <option value="subreceta">Subrecetas</option>
          <option value="relleno">Rellenos</option>
          <option value="masa">Masas</option>
          <option value="salsa">Salsas</option>
          <option value="otro">Otro</option>
        </select>
        <div className="ml-auto text-xs text-gray-400">
          Click en el margen para editarlo · colchón sobre el costo base por merma/variación
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-lg border border-surface-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border bg-gray-50 text-left text-xs text-gray-500 uppercase">
              <th className="px-4 py-2">Receta</th>
              <th className="px-4 py-2">Tipo</th>
              <th className="px-4 py-2 text-right">Rinde</th>
              <th className="px-4 py-2 text-right">Costo base</th>
              <th className="px-4 py-2 text-right">Margen seg.</th>
              <th className="px-4 py-2 text-right">Costo total</th>
              <th className="px-4 py-2 text-right">$/kg</th>
              <th className="px-4 py-2 text-right">$/porción</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((r) => {
              const c = costos.get(r.id)
              const enEdicion = editando?.id === r.id
              const margenDisplay = r.margen_seguridad_pct != null ? (r.margen_seguridad_pct * 100).toFixed(1) : '0'
              return (
                <tr key={r.id} className="border-b border-surface-border hover:bg-gray-50">
                  <td className="px-4 py-2 font-medium text-gray-900">
                    <div className="flex items-center gap-1.5">
                      <span>{r.nombre}</span>
                      {c && c.advertencias.length > 0 && (
                        <span title={c.advertencias.join('\n')} className="text-amber-500 text-xs">⚠</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700">{TIPO_RECETA_LABEL[r.tipo] ?? r.tipo}</span>
                  </td>
                  <td className="px-4 py-2 text-right text-xs text-gray-500 tabular-nums">
                    {r.rendimiento_kg != null && `${r.rendimiento_kg} kg`}
                    {r.rendimiento_kg != null && r.rendimiento_porciones != null && <br />}
                    {r.rendimiento_porciones != null && `${r.rendimiento_porciones} porc.`}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                    {c && c.costoBase > 0 ? formatARS(c.costoBase) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {enEdicion ? (
                      <div className="inline-flex items-center gap-0.5">
                        <input
                          autoFocus
                          type="number"
                          step="0.5"
                          min="0"
                          value={editando.valor}
                          onChange={(e) => setEditando({ id: r.id, valor: e.target.value })}
                          onBlur={() => guardarMargen(r.id, editando.valor)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') guardarMargen(r.id, editando.valor)
                            if (e.key === 'Escape') setEditando(null)
                          }}
                          className="w-16 border border-rodziny-400 rounded px-2 py-0.5 text-sm text-right"
                        />
                        <span className="text-xs text-gray-500">%</span>
                      </div>
                    ) : (
                      <button
                        onClick={() => setEditando({ id: r.id, valor: margenDisplay })}
                        className="hover:bg-rodziny-50 rounded px-2 py-0.5 min-w-[60px] text-right font-medium text-gray-700"
                      >
                        {margenDisplay}%
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold text-gray-800">
                    {c && c.costoConMargen > 0 ? formatARS(c.costoConMargen) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                    {c?.costoPorKg != null ? formatARS(c.costoPorKg) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                    {c?.costoPorPorcion != null ? formatARS(c.costoPorPorcion) : <span className="text-gray-300">—</span>}
                  </td>
                </tr>
              )
            })}
            {filtrados.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No hay recetas</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
