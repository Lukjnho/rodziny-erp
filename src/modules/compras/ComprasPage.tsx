import { useState, useRef, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { PageContainer } from '@/components/layout/PageContainer'
import { LocalSelector } from '@/components/ui/LocalSelector'
import { formatARS, cn } from '@/lib/utils'
import { parseStockFudo } from './parsers/parseStock'

type Tab = 'stock' | 'movimientos' | 'importar'
type FiltroEstado = 'todos' | 'bajo_minimo' | 'sin_stock' | 'inactivos'

interface Producto {
  id: string; nombre: string; categoria: string; unidad: string
  stock_actual: number; stock_minimo: number; proveedor: string
  costo_unitario: number; activo: boolean
}

interface Movimiento {
  id: string; producto_id: string | null; producto_nombre: string; tipo: string; cantidad: number
  unidad: string; motivo: string; observacion: string | null
  registrado_por: string | null; created_at: string
}

export function ComprasPage() {
  const [local, setLocal] = useState<'vedia' | 'saavedra'>('vedia')
  const [tab, setTab]     = useState<Tab>('stock')
  const [filtro, setFiltro] = useState('')
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>('todos')
  const [editandoMin, setEditandoMin] = useState<string | null>(null) // producto id
  const [valorMin, setValorMin] = useState('')
  const qc = useQueryClient()

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: productos, isLoading } = useQuery({
    queryKey: ['productos_stock', local],
    queryFn: async () => {
      const { data } = await supabase
        .from('productos')
        .select('*')
        .eq('local', local)
        .order('categoria')
        .order('nombre')
      return (data ?? []) as Producto[]
    },
  })

  const { data: movimientos } = useQuery({
    queryKey: ['movimientos_stock', local],
    queryFn: async () => {
      const { data } = await supabase
        .from('movimientos_stock')
        .select('*')
        .eq('local', local)
        .order('created_at', { ascending: false })
        .limit(200)
      return (data ?? []) as Movimiento[]
    },
    enabled: tab === 'movimientos',
  })

  // ── Filtrar productos ──────────────────────────────────────────────────────
  const productosFiltrados = useMemo(() => {
    let lista = productos ?? []

    // Filtro por estado
    if (filtroEstado === 'inactivos') lista = lista.filter((p) => !p.activo)
    else {
      lista = lista.filter((p) => p.activo) // por defecto solo activos
      if (filtroEstado === 'sin_stock') lista = lista.filter((p) => p.stock_actual <= 0)
      else if (filtroEstado === 'bajo_minimo') lista = lista.filter((p) => p.stock_minimo > 0 && p.stock_actual <= p.stock_minimo)
    }

    // Filtro por texto
    if (filtro) {
      const f = filtro.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      lista = lista.filter((p) => {
        const n = (p.nombre + ' ' + p.categoria + ' ' + p.proveedor).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        return n.includes(f)
      })
    }

    return lista
  }, [productos, filtro, filtroEstado])

  // ── KPIs ───────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const todos = productos ?? []
    const activos = todos.filter((p) => p.activo)
    const inactivos = todos.filter((p) => !p.activo)
    const bajoMinimo = activos.filter((p) => p.stock_actual <= p.stock_minimo && p.stock_minimo > 0)
    const sinStock = activos.filter((p) => p.stock_actual <= 0)
    const valorTotal = activos.reduce((s, p) => s + (p.stock_actual * p.costo_unitario), 0)
    return { total: activos.length, bajoMinimo: bajoMinimo.length, sinStock: sinStock.length, valorTotal, inactivos: inactivos.length }
  }, [productos])

  // ── Import stock ───────────────────────────────────────────────────────────
  const inputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ insertados: number; error?: string } | null>(null)

  async function importarStock(file: File) {
    setImporting(true)
    setImportResult(null)
    try {
      const buffer = await file.arrayBuffer()
      const items = parseStockFudo(buffer)
      if (!items.length) throw new Error('No se encontraron productos en el archivo')

      const rows = items.map((p) => ({
        local,
        fudo_id: p.fudo_id || null,
        categoria: p.categoria,
        nombre: p.nombre,
        unidad: p.unidad,
        stock_actual: p.disponibilidad,
        stock_minimo: p.stock_minimo,
        proveedor: p.proveedor || null,
        costo_unitario: p.costo_unitario,
        activo: true,
        updated_at: new Date().toISOString(),
      }))

      const { error } = await supabase
        .from('productos')
        .upsert(rows, { onConflict: 'local,nombre' })

      if (error) throw new Error(error.message)
      setImportResult({ insertados: rows.length })
      qc.invalidateQueries({ queryKey: ['productos_stock'] })
      qc.invalidateQueries({ queryKey: ['productos_activos'] })
    } catch (e) {
      setImportResult({ insertados: 0, error: (e as Error).message })
    } finally {
      setImporting(false)
    }
  }

  return (
    <PageContainer title="Compras & Stock" subtitle="Inventario, movimientos y órdenes de compra">
      {/* Filtros */}
      <div className="flex items-center gap-4 mb-4 flex-wrap">
        <LocalSelector value={local} onChange={(v) => setLocal(v as 'vedia' | 'saavedra')} />

        <div className="flex gap-1 border-b border-gray-200">
          {([
            ['stock',       '📦 Stock'],
            ['movimientos', '📋 Movimientos'],
            ['importar',    '📥 Importar'],
          ] as [Tab, string][]).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
                tab === t ? 'border-rodziny-600 text-rodziny-800' : 'border-transparent text-gray-500 hover:text-gray-700'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ═══ TAB: STOCK ═══ */}
      {tab === 'stock' && (
        <>
          {/* KPIs clickeables */}
          <div className="grid grid-cols-4 gap-3 mb-4">
            <button
              onClick={() => setFiltroEstado('todos')}
              className={cn('bg-white rounded-lg border p-4 text-left transition-colors',
                filtroEstado === 'todos' ? 'border-rodziny-500 ring-1 ring-rodziny-200' : 'border-surface-border hover:border-gray-300'
              )}
            >
              <p className="text-xs text-gray-500 mb-1">Productos</p>
              <p className="text-lg font-semibold text-gray-900">{kpis.total}</p>
            </button>
            <button
              onClick={() => setFiltroEstado(filtroEstado === 'bajo_minimo' ? 'todos' : 'bajo_minimo')}
              className={cn('bg-white rounded-lg border p-4 text-left transition-colors',
                filtroEstado === 'bajo_minimo' ? 'border-orange-500 ring-1 ring-orange-200 bg-orange-50' : 'border-surface-border hover:border-gray-300'
              )}
            >
              <p className="text-xs text-gray-500 mb-1">Bajo mínimo</p>
              <p className={cn('text-lg font-semibold', kpis.bajoMinimo > 0 ? 'text-orange-600' : 'text-green-600')}>{kpis.bajoMinimo}</p>
            </button>
            <button
              onClick={() => setFiltroEstado(filtroEstado === 'sin_stock' ? 'todos' : 'sin_stock')}
              className={cn('bg-white rounded-lg border p-4 text-left transition-colors',
                filtroEstado === 'sin_stock' ? 'border-red-500 ring-1 ring-red-200 bg-red-50' : 'border-surface-border hover:border-gray-300'
              )}
            >
              <p className="text-xs text-gray-500 mb-1">Sin stock</p>
              <p className={cn('text-lg font-semibold', kpis.sinStock > 0 ? 'text-red-600' : 'text-green-600')}>{kpis.sinStock}</p>
            </button>
            <div className="bg-white rounded-lg border border-surface-border p-4">
              <p className="text-xs text-gray-500 mb-1">Valor inventario</p>
              <p className="text-lg font-semibold text-gray-900">{formatARS(kpis.valorTotal)}</p>
            </div>
          </div>
          {kpis.inactivos > 0 && (
            <div className="mb-3">
              <button
                onClick={() => setFiltroEstado(filtroEstado === 'inactivos' ? 'todos' : 'inactivos')}
                className={cn(
                  'text-xs px-3 py-1 rounded-full transition-colors',
                  filtroEstado === 'inactivos' ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                )}
              >
                {filtroEstado === 'inactivos' ? `Mostrando ${kpis.inactivos} inactivos ✕` : `Ver ${kpis.inactivos} inactivos`}
              </button>
            </div>
          )}

          {/* Búsqueda + filtro activo */}
          <div className="flex items-center gap-3 mb-3">
            <input
              type="text" value={filtro} onChange={(e) => setFiltro(e.target.value)}
              placeholder="Buscar producto, categoría o proveedor..."
              className="flex-1 max-w-md border border-gray-300 rounded-md px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-rodziny-500"
            />
            {filtroEstado !== 'todos' && (
              <span className={cn(
                'inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium',
                filtroEstado === 'bajo_minimo' ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700'
              )}>
                {filtroEstado === 'bajo_minimo' ? 'Bajo mínimo' : 'Sin stock'}
                <button onClick={() => setFiltroEstado('todos')} className="ml-1 hover:opacity-70">✕</button>
              </span>
            )}
            <span className="text-xs text-gray-400">{productosFiltrados.length} productos</span>
          </div>

          {/* Tabla de stock */}
          <div className="bg-white rounded-lg border border-surface-border overflow-hidden">
            {isLoading ? (
              <div className="p-8 text-center text-sm text-gray-400 animate-pulse">Cargando...</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">Producto</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">Categoría</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-600">Stock</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-600">Mínimo</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">Proveedor</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-600">Costo unit.</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-600">Valor</th>
                      <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-600">Estado</th>
                      <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-600">Activo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productosFiltrados.map((p) => {
                      const bajoMin = p.activo && p.stock_minimo > 0 && p.stock_actual <= p.stock_minimo
                      const sinStock = p.activo && p.stock_actual <= 0
                      return (
                        <tr key={p.id} className={cn(
                          'border-b border-gray-50 hover:bg-gray-50',
                          !p.activo && 'opacity-50',
                          sinStock && 'bg-red-50',
                          bajoMin && !sinStock && 'bg-orange-50'
                        )}>
                          <td className="px-4 py-2 font-medium text-gray-900">{p.nombre}</td>
                          <td className="px-4 py-2 text-gray-600">{p.categoria}</td>
                          <td className="px-4 py-2 text-right font-medium">
                            <span className={sinStock ? 'text-red-600' : bajoMin ? 'text-orange-600' : 'text-gray-900'}>
                              {p.stock_actual} {p.unidad}
                            </span>
                          </td>
                          <td
                            className="px-4 py-2 text-right text-gray-500 cursor-pointer hover:bg-blue-50"
                            onClick={() => { setEditandoMin(p.id); setValorMin(p.stock_minimo > 0 ? String(p.stock_minimo) : '') }}
                          >
                            {editandoMin === p.id ? (
                              <input
                                type="number" step="any" autoFocus
                                value={valorMin}
                                onChange={(e) => setValorMin(e.target.value)}
                                onKeyDown={async (e) => {
                                  if (e.key === 'Enter') {
                                    const val = parseFloat(valorMin.replace(',', '.')) || 0
                                    await supabase.from('productos').update({ stock_minimo: val }).eq('id', p.id)
                                    qc.invalidateQueries({ queryKey: ['productos_stock'] })
                                    setEditandoMin(null)
                                  }
                                  if (e.key === 'Escape') setEditandoMin(null)
                                }}
                                onBlur={async () => {
                                  const val = parseFloat(valorMin.replace(',', '.')) || 0
                                  await supabase.from('productos').update({ stock_minimo: val }).eq('id', p.id)
                                  qc.invalidateQueries({ queryKey: ['productos_stock'] })
                                  setEditandoMin(null)
                                }}
                                className="w-20 text-right bg-blue-50 border border-blue-400 rounded px-1 py-0.5 text-sm outline-none"
                              />
                            ) : (
                              <span className="text-xs">{p.stock_minimo > 0 ? `${p.stock_minimo} ${p.unidad}` : <span className="text-gray-300">editar</span>}</span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-gray-600 text-xs">{p.proveedor || '—'}</td>
                          <td className="px-4 py-2 text-right text-gray-600">{p.costo_unitario > 0 ? formatARS(p.costo_unitario) : '—'}</td>
                          <td className="px-4 py-2 text-right text-gray-700">{p.costo_unitario > 0 ? formatARS(p.stock_actual * p.costo_unitario) : '—'}</td>
                          <td className="px-4 py-2 text-center">
                            {!p.activo ? (
                              <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">Inactivo</span>
                            ) : sinStock ? (
                              <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">Sin stock</span>
                            ) : bajoMin ? (
                              <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-700">Bajo mínimo</span>
                            ) : (
                              <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">OK</span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-center">
                            <button
                              onClick={async () => {
                                await supabase.from('productos').update({ activo: !p.activo }).eq('id', p.id)
                                qc.invalidateQueries({ queryKey: ['productos_stock'] })
                                qc.invalidateQueries({ queryKey: ['productos_activos'] })
                              }}
                              className={cn(
                                'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                                p.activo ? 'bg-rodziny-600' : 'bg-gray-300'
                              )}
                            >
                              <span className={cn(
                                'inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform',
                                p.activo ? 'translate-x-4' : 'translate-x-1'
                              )} />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ═══ TAB: MOVIMIENTOS ═══ */}
      {tab === 'movimientos' && (
        <div className="bg-white rounded-lg border border-surface-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">Fecha</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">Producto</th>
                  <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-600">Tipo</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-600">Cantidad</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">Motivo</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">Observación</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">Registrado por</th>
                  <th className="px-2 py-2.5 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {(!movimientos || movimientos.length === 0) ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No hay movimientos registrados</td></tr>
                ) : movimientos.map((m) => (
                  <tr key={m.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-600 text-xs">
                      {new Date(m.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-2 font-medium text-gray-900">{m.producto_nombre}</td>
                    <td className="px-4 py-2 text-center">
                      <span className={cn(
                        'inline-block px-2 py-0.5 rounded text-xs font-medium',
                        m.tipo === 'entrada' ? 'bg-green-100 text-green-700' :
                        m.tipo === 'salida' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
                      )}>
                        {m.tipo === 'entrada' ? '↑ Entrada' : m.tipo === 'salida' ? '↓ Salida' : '⟳ Ajuste'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right font-medium text-gray-800">{m.cantidad} {m.unidad}</td>
                    <td className="px-4 py-2 text-gray-600 text-xs">{m.motivo || '—'}</td>
                    <td className="px-4 py-2 text-gray-500 text-xs max-w-[200px] truncate">{m.observacion || '—'}</td>
                    <td className="px-4 py-2 text-gray-500 text-xs">{m.registrado_por || '—'}</td>
                    <td className="px-2 py-2 text-center">
                      <button
                        onClick={async () => {
                          if (!confirm(`¿Eliminar este movimiento y revertir el stock de ${m.producto_nombre}?`)) return
                          // Revertir stock: si fue salida sumamos, si fue entrada restamos
                          if (m.producto_id) {
                            const { data: prod } = await supabase.from('productos').select('stock_actual').eq('id', m.producto_id).single()
                            if (prod) {
                              const nuevoStock = m.tipo === 'salida'
                                ? prod.stock_actual + m.cantidad
                                : Math.max(0, prod.stock_actual - m.cantidad)
                              await supabase.from('productos').update({ stock_actual: nuevoStock }).eq('id', m.producto_id)
                            }
                          }
                          await supabase.from('movimientos_stock').delete().eq('id', m.id)
                          qc.invalidateQueries({ queryKey: ['movimientos_stock'] })
                          qc.invalidateQueries({ queryKey: ['productos_stock'] })
                          qc.invalidateQueries({ queryKey: ['productos_activos'] })
                        }}
                        className="text-gray-300 hover:text-red-500 transition-colors text-xs"
                        title="Eliminar y revertir stock"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ TAB: IMPORTAR ═══ */}
      {tab === 'importar' && (
        <div className="max-w-xl">
          <div className="bg-white rounded-lg border border-surface-border p-6">
            <h3 className="font-semibold text-gray-900 mb-1">Importar stock desde Fudo</h3>
            <p className="text-xs text-gray-400 mb-3">
              Subí el export de stock/ingredientes de Fudo (.xls/.xlsx). Se actualizarán los productos existentes y se crearán los nuevos.
            </p>
            <div className="mb-4 p-3 bg-rodziny-50 border border-rodziny-200 rounded-lg text-sm">
              Importando para: <span className="font-semibold text-rodziny-800">{local === 'vedia' ? 'Rodziny Vedia' : 'Rodziny Saavedra'}</span>
              <span className="text-xs text-gray-500 ml-2">(cambiá el local arriba si necesitás importar para el otro)</span>
            </div>

            <div
              className={cn(
                'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
                'border-gray-300 hover:border-rodziny-500'
              )}
              onClick={() => inputRef.current?.click()}
            >
              <div className="text-2xl mb-2">📦</div>
              <p className="text-sm text-gray-600">
                Arrastrá el archivo acá o <span className="text-rodziny-700 font-medium">hacé clic para seleccionar</span>
              </p>
              <input
                ref={inputRef} type="file" className="hidden" accept=".xls,.xlsx"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) importarStock(f) }}
              />
            </div>

            {importing && <p className="mt-3 text-sm text-blue-600 animate-pulse">Procesando archivo...</p>}

            {importResult && (
              <div className={cn('mt-3 p-3 rounded-md text-sm', importResult.error ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-800')}>
                {importResult.error ? `Error: ${importResult.error}` : `${importResult.insertados} productos importados/actualizados`}
              </div>
            )}
          </div>
        </div>
      )}
    </PageContainer>
  )
}
