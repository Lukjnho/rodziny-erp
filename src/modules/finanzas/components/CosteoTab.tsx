import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { KPICard } from '@/components/ui/KPICard'
import { cn, formatARS } from '@/lib/utils'
import { useCostosRecetas } from '@/modules/cocina/hooks/useCostosRecetas'
import { useConfigCosteo, type ConfigCosteo } from '@/modules/cocina/hooks/useConfigCosteo'

interface Receta {
  id: string
  nombre: string
  tipo: string
  rendimiento_kg: number | null
  rendimiento_porciones: number | null
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
  costo_empaque: number | null
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
        >Recetas y parámetros</button>
      </div>

      {subtab === 'productos' && <VistaProductos />}
      {subtab === 'recetas' && <VistaRecetas />}
    </div>
  )
}

// ─── Card de parámetros globales ────────────────────────────────────────────
function CardParametros({ config }: { config: ConfigCosteo | undefined }) {
  const { actualizar } = useConfigCosteo()
  const [edits, setEdits] = useState<Partial<Record<keyof ConfigCosteo, string>>>({})
  const [guardado, setGuardado] = useState<string | null>(null)

  function display(c: ConfigCosteo | undefined, k: keyof ConfigCosteo): string {
    if (!c) return '0.0'
    return (c[k] * 100).toFixed(1)
  }

  function guardar(k: keyof ConfigCosteo) {
    const raw = edits[k]
    if (raw == null) return
    const num = parseFloat(raw.replace(',', '.'))
    if (isNaN(num) || num < 0) return
    actualizar.mutate({ clave: k, valor: num / 100 }, {
      onSuccess: () => {
        setEdits((s) => ({ ...s, [k]: undefined }))
        setGuardado(k)
        setTimeout(() => setGuardado(null), 1500)
      },
    })
  }

  const items: { key: keyof ConfigCosteo; label: string; hint: string }[] = [
    { key: 'margen_seguridad_pct', label: 'Margen de seguridad', hint: 'Colchón sobre costo base (merma, variación)' },
    { key: 'iva_pct', label: 'IVA', hint: 'Para calcular precio neto sin impuesto' },
    { key: 'comision_pago_vedia_pct', label: 'Comisión Vedia', hint: 'Promedio medios de pago' },
    { key: 'comision_pago_saavedra_pct', label: 'Comisión Saavedra', hint: 'Promedio medios de pago' },
  ]

  return (
    <div className="bg-gradient-to-br from-rodziny-50 to-white border border-rodziny-200 rounded-lg p-4">
      <h3 className="text-sm font-semibold text-rodziny-800 mb-1">⚙ Parámetros globales de costeo</h3>
      <p className="text-xs text-gray-600 mb-3">Aplican a todos los productos. Cambiá el valor y hacé click en ✓ para guardar.</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {items.map((it) => {
          const actual = display(config, it.key)
          const nuevo = edits[it.key]
          const editando = nuevo != null
          return (
            <div key={it.key} className="bg-white rounded border border-gray-200 p-2.5">
              <div className="text-[10px] text-gray-500 uppercase font-medium mb-1">{it.label}</div>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={editando ? nuevo : actual}
                  onChange={(e) => setEdits((s) => ({ ...s, [it.key]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') guardar(it.key) }}
                  className="w-full border border-gray-300 rounded px-2 py-1 text-sm text-right tabular-nums"
                />
                <span className="text-sm text-gray-500">%</span>
                {editando && (
                  <button
                    onClick={() => guardar(it.key)}
                    className="bg-rodziny-700 hover:bg-rodziny-800 text-white rounded px-2 py-1 text-xs"
                    title="Guardar"
                  >✓</button>
                )}
                {guardado === it.key && (
                  <span className="text-xs text-green-600">✓</span>
                )}
              </div>
              <div className="text-[10px] text-gray-400 mt-1 leading-tight">{it.hint}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Vista Productos: costo real, precio neto, margen real ──────────────────
function VistaProductos() {
  const qc = useQueryClient()
  const [busqueda, setBusqueda] = useState('')
  const [filtroLocal, setFiltroLocal] = useState<'todos' | 'vedia' | 'saavedra' | 'ambos'>('todos')
  const [editando, setEditando] = useState<{ id: string; campo: 'precio' | 'empaque'; valor: string } | null>(null)

  const { data: productos } = useQuery({
    queryKey: ['cocina-productos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_productos')
        .select('id, nombre, codigo, tipo, unidad, local, activo, receta_id, precio_venta, costo_empaque')
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
  const { config, comisionPorLocal } = useConfigCosteo()

  const actualizar = useMutation({
    mutationFn: async ({ id, campo, valor }: { id: string; campo: 'precio_venta' | 'costo_empaque'; valor: number | null }) => {
      const { error } = await supabase.from('cocina_productos').update({ [campo]: valor }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cocina-productos'] }),
  })

  // Cálculo de costos + márgenes reales
  const analisis = useMemo(() => {
    const ivaPct = config?.iva_pct ?? 0
    const map = new Map<string, {
      costoReceta: number | null
      costoBase: string | null
      empaque: number
      costoTotal: number | null
      precioNeto: number | null
      precioRecibido: number | null
      margenPct: number | null
      margenAbs: number | null
      comisionLocal: number
    }>()
    for (const p of productos ?? []) {
      const empaque = p.costo_empaque ?? 0
      let costoReceta: number | null = null
      let costoBase: string | null = null
      if (p.receta_id) {
        const c = costos.get(p.receta_id)
        if (c) {
          const u = (p.unidad ?? '').toLowerCase()
          const esPeso = u === 'kg' || u === 'litros' || u === 'lt'
          if (esPeso && c.costoPorKg != null) { costoReceta = c.costoPorKg; costoBase = 'kg' }
          else if (!esPeso && c.costoPorPorcion != null) { costoReceta = c.costoPorPorcion; costoBase = 'porción' }
        }
      }
      const costoTotal = costoReceta != null ? costoReceta + empaque : null
      const comLocal = comisionPorLocal(p.local)
      const precioNeto = p.precio_venta != null && ivaPct >= 0 ? p.precio_venta / (1 + ivaPct) : null
      const precioRecibido = precioNeto != null ? precioNeto * (1 - comLocal) : null
      let margenPct: number | null = null
      let margenAbs: number | null = null
      if (precioRecibido != null && costoTotal != null && precioRecibido > 0) {
        margenAbs = precioRecibido - costoTotal
        margenPct = (margenAbs / precioRecibido) * 100
      }
      map.set(p.id, { costoReceta, costoBase, empaque, costoTotal, precioNeto, precioRecibido, margenPct, margenAbs, comisionLocal: comLocal })
    }
    return map
  }, [productos, costos, config, comisionPorLocal])

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
    let mejor: { nombre: string; pct: number } | null = null
    let peor: { nombre: string; pct: number } | null = null
    for (const p of all) {
      const a = analisis.get(p.id)
      if (p.precio_venta && a?.margenPct != null) {
        conPrecio++
        margenSum += a.margenPct
        margenN++
        if (!mejor || a.margenPct > mejor.pct) mejor = { nombre: p.nombre, pct: a.margenPct }
        if (!peor || a.margenPct < peor.pct) peor = { nombre: p.nombre, pct: a.margenPct }
      } else if (!p.precio_venta) sinPrecio++
    }
    return {
      conPrecio, sinPrecio,
      margenProm: margenN > 0 ? margenSum / margenN : null,
      mejor, peor,
    }
  }, [productos, analisis])

  function guardar(id: string, campo: 'precio' | 'empaque', valor: string) {
    const num = valor === '' ? null : parseFloat(valor.replace(',', '.'))
    const final = num != null && !isNaN(num) ? num : null
    const col = campo === 'precio' ? 'precio_venta' : 'costo_empaque'
    actualizar.mutate({ id, campo: col, valor: final })
    setEditando(null)
  }

  return (
    <div className="space-y-4">
      {/* Parámetros globales */}
      <CardParametros config={config} />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard label="Con precio" value={String(kpis.conPrecio)} color="green" />
        <KPICard label="Sin precio" value={String(kpis.sinPrecio)} color={kpis.sinPrecio > 0 ? 'yellow' : 'neutral'} />
        <KPICard
          label="Margen real promedio"
          value={kpis.margenProm != null ? `${kpis.margenProm.toFixed(1)}%` : '—'}
          color={kpis.margenProm != null && kpis.margenProm > 50 ? 'green' : kpis.margenProm != null && kpis.margenProm > 30 ? 'yellow' : 'neutral'}
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
          Click en precio/empaque para editar · Enter guarda
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-lg border border-surface-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border bg-gray-50 text-left text-[11px] text-gray-500 uppercase">
              <th className="px-3 py-2">Producto</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Local</th>
              <th className="px-3 py-2">Receta</th>
              <th className="px-3 py-2 text-right">Costo insumo</th>
              <th className="px-3 py-2 text-right">Empaque</th>
              <th className="px-3 py-2 text-right">Costo total</th>
              <th className="px-3 py-2 text-right">Precio venta</th>
              <th className="px-3 py-2 text-right">Precio neto</th>
              <th className="px-3 py-2 text-right">Recibido</th>
              <th className="px-3 py-2 text-right">Margen real</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((p) => {
              const rec = recetas?.find((r) => r.id === p.receta_id) ?? null
              const a = analisis.get(p.id)
              const edPrecio = editando?.id === p.id && editando.campo === 'precio'
              const edEmpaque = editando?.id === p.id && editando.campo === 'empaque'
              return (
                <tr key={p.id} className="border-b border-surface-border hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <div className="font-medium">{p.nombre}</div>
                    <div className="text-[10px] text-gray-400 font-mono">{p.codigo} · {p.unidad}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span className="px-2 py-0.5 rounded-full text-[10px] bg-gray-100 text-gray-700">{TIPO_PRODUCTO_LABEL[p.tipo] ?? p.tipo}</span>
                  </td>
                  <td className="px-3 py-2 capitalize text-[11px] text-gray-500">
                    {p.local}
                    {a && a.comisionLocal > 0 && (
                      <div className="text-[9px] text-gray-400">com {(a.comisionLocal * 100).toFixed(1)}%</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-[11px]">
                    {rec ? (
                      <span className="text-gray-700">{rec.nombre}</span>
                    ) : (
                      <span className="text-gray-300 italic">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {a?.costoReceta != null ? (
                      <div>
                        <div className="text-gray-700">{formatARS(a.costoReceta)}</div>
                        <div className="text-[9px] text-gray-400">/{a.costoBase}</div>
                      </div>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {edEmpaque ? (
                      <input
                        autoFocus
                        type="number"
                        step="0.01"
                        value={editando.valor}
                        onChange={(e) => setEditando({ id: p.id, campo: 'empaque', valor: e.target.value })}
                        onBlur={() => guardar(p.id, 'empaque', editando.valor)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') guardar(p.id, 'empaque', editando.valor)
                          if (e.key === 'Escape') setEditando(null)
                        }}
                        className="w-20 border border-rodziny-400 rounded px-2 py-0.5 text-sm text-right"
                      />
                    ) : (
                      <button
                        onClick={() => setEditando({ id: p.id, campo: 'empaque', valor: a?.empaque != null ? String(a.empaque) : '' })}
                        className="text-gray-600 hover:bg-rodziny-50 rounded px-2 py-0.5 min-w-[60px] text-right"
                      >
                        {a?.empaque ? formatARS(a.empaque) : <span className="text-gray-300 text-xs">—</span>}
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-gray-800">
                    {a?.costoTotal != null ? formatARS(a.costoTotal) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {edPrecio ? (
                      <input
                        autoFocus
                        type="number"
                        step="0.01"
                        value={editando.valor}
                        onChange={(e) => setEditando({ id: p.id, campo: 'precio', valor: e.target.value })}
                        onBlur={() => guardar(p.id, 'precio', editando.valor)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') guardar(p.id, 'precio', editando.valor)
                          if (e.key === 'Escape') setEditando(null)
                        }}
                        className="w-24 border border-rodziny-400 rounded px-2 py-0.5 text-sm text-right"
                      />
                    ) : (
                      <button
                        onClick={() => setEditando({ id: p.id, campo: 'precio', valor: p.precio_venta != null ? String(p.precio_venta) : '' })}
                        className="font-medium text-gray-800 hover:bg-rodziny-50 rounded px-2 py-0.5 min-w-[70px] text-right"
                      >
                        {p.precio_venta != null ? formatARS(p.precio_venta) : <span className="text-gray-300 italic">—</span>}
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs text-gray-500">
                    {a?.precioNeto != null ? formatARS(a.precioNeto) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs text-gray-500">
                    {a?.precioRecibido != null ? formatARS(a.precioRecibido) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {a?.margenPct != null ? (
                      <div>
                        <div className={cn('font-semibold', a.margenPct > 50 ? 'text-green-600' : a.margenPct > 30 ? 'text-amber-600' : 'text-red-600')}>
                          {a.margenPct.toFixed(1)}%
                        </div>
                        {a.margenAbs != null && <div className="text-[10px] text-gray-400">{formatARS(a.margenAbs)}</div>}
                      </div>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
            {filtrados.length === 0 && (
              <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-400">No hay productos</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Advertencia */}
      {(kpis.sinPrecio > 0 || (kpis.peor && kpis.peor.pct < 20)) && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 space-y-1">
          {kpis.sinPrecio > 0 && (
            <div>⚠ {kpis.sinPrecio} producto(s) sin precio de venta cargado.</div>
          )}
          {kpis.peor && kpis.peor.pct < 20 && (
            <div>⚠ Menor margen real: <strong>{kpis.peor.nombre}</strong> ({kpis.peor.pct.toFixed(1)}%) — considerá revisar el precio.</div>
          )}
        </div>
      )}

      {/* Leyenda de cálculo */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-[11px] text-gray-600">
        <div className="font-medium text-gray-700 mb-1">📐 Cómo se calcula el margen real:</div>
        <div className="font-mono text-[10px] space-y-0.5">
          <div>costo_total = costo_insumo (con margen seguridad) + empaque</div>
          <div>precio_neto = precio_venta ÷ (1 + IVA)</div>
          <div>recibido = precio_neto × (1 − comisión del local)</div>
          <div>margen = recibido − costo_total</div>
        </div>
      </div>
    </div>
  )
}

// ─── Vista Recetas: tabla con costos ─────────────────────────────────────────
function VistaRecetas() {
  const [busqueda, setBusqueda] = useState('')
  const [filtroTipo, setFiltroTipo] = useState<string>('todos')

  const { data: recetas } = useQuery({
    queryKey: ['cocina-recetas'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_recetas')
        .select('id, nombre, tipo, rendimiento_kg, rendimiento_porciones, activo')
        .eq('activo', true)
        .order('nombre')
      if (error) throw error
      return data as Receta[]
    },
  })

  const { costos } = useCostosRecetas()
  const { config } = useConfigCosteo()

  const filtrados = useMemo(() => {
    let lista = recetas ?? []
    if (filtroTipo !== 'todos') lista = lista.filter((r) => r.tipo === filtroTipo)
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase()
      lista = lista.filter((r) => r.nombre.toLowerCase().includes(q))
    }
    return lista
  }, [recetas, filtroTipo, busqueda])

  return (
    <div className="space-y-4">
      {/* Parámetros globales */}
      <CardParametros config={config} />

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
              <th className="px-4 py-2 text-right">Costo c/margen</th>
              <th className="px-4 py-2 text-right">$/kg</th>
              <th className="px-4 py-2 text-right">$/porción</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((r) => {
              const c = costos.get(r.id)
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
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No hay recetas</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
