import { useState, useRef, useMemo, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { PageContainer } from '@/components/layout/PageContainer'
import { LocalSelector } from '@/components/ui/LocalSelector'
import { formatARS, cn } from '@/lib/utils'
import { parseStockFudo } from './parsers/parseStock'
import { parseFudoGastos, type DetalleRow, type GastoRow } from '@/modules/finanzas/parsers/parseFudoGastos'
import { NuevoGastoModal, type PrefillGasto } from '@/modules/gastos/NuevoGastoModal'
import { ProveedoresPanel } from '@/modules/gastos/ProveedoresPanel'

type Tab = 'stock' | 'movimientos' | 'importar' | 'recepcion' | 'pagos' | 'proveedores'
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

// ── Panel de ayuda contextual ────────────────────────────────────────────────
const ayudaPorTab: Record<Tab, { titulo: string; pasos: string[] }> = {
  stock: {
    titulo: 'Stock actual',
    pasos: [
      'Acá ves todos los productos cargados y su stock actual.',
      'Usá los filtros arriba para buscar por nombre, proveedor o categoría.',
      'Hacé clic en los KPIs de colores para filtrar rápido (bajo mínimo, sin stock, etc.).',
      'Para cambiar el stock mínimo de un producto, hacé clic en el número de la columna "Mín." y escribí el nuevo valor.',
    ],
  },
  movimientos: {
    titulo: 'Historial de movimientos',
    pasos: [
      'Acá se registran todas las entradas y salidas de mercadería.',
      'Cada vez que confirmás una recepción, se crean movimientos de entrada automáticamente.',
      'Podés ver quién registró cada movimiento, la fecha y el motivo.',
    ],
  },
  importar: {
    titulo: 'Importar productos',
    pasos: [
      'Usá esta pestaña para cargar el listado de productos desde un export de Fudo.',
      'Paso 1: Exportá el archivo de Stock desde Fudo (formato .xls o .xlsx).',
      'Paso 2: Arrastrá el archivo acá o hacé clic para seleccionarlo.',
      'Los productos se actualizan por nombre — si ya existen, se pisan con los nuevos datos.',
    ],
  },
  recepcion: {
    titulo: 'Recepción de mercadería',
    pasos: [
      'Paso 1: Exportá el archivo de GASTOS desde Fudo (no el de ventas).',
      'Paso 2: Seleccioná el local correcto arriba a la izquierda.',
      'Paso 3: Arrastrá el archivo o hacé clic para seleccionarlo.',
      'El sistema lee la hoja "Detalle" y cruza cada item con tus productos.',
      'Paso 4: Revisá los matches — los verdes son automáticos, los amarillos necesitan que elijas el producto correcto del desplegable.',
      'Paso 5: Tildá los items que querés confirmar y hacé clic en "Confirmar recepción".',
      'Esto actualiza el stock Y guarda los gastos para el tab de Pagos.',
    ],
  },
  pagos: {
    titulo: 'Pagos a proveedores',
    pasos: [
      'Arriba ves el resumen mensual: total comprado, pagado y lo que resta. Cambiá el mes con el selector.',
      'Los colores indican el estado: 🔴 Vencido — 🟠 Vence esta semana — 🔵 A pagar — 🟢 Pagado.',
      'Hacé clic en los KPIs de estado para filtrar rápido.',
      'Cuando pagues a un proveedor, hacé clic en "Marcar pagado" en esa fila.',
      'Los gastos se cargan automáticamente cuando subís un export en Recepción.',
      'Los que aparecen "Sin fecha" son gastos viejos — marcalos como pagados si ya se pagaron.',
    ],
  },
  proveedores: {
    titulo: 'Proveedores',
    pasos: [
      'Listado completo de proveedores con datos fiscales (CUIT, condición IVA, contacto).',
      'Usá "+ Nuevo proveedor" para crear uno desde cero.',
      'El botón "📥 Importar desde histórico" rastrea los gastos viejos y crea los proveedores que falten.',
      'Cada proveedor tiene categoría y medio de pago default — eso se autocompleta al cargar un gasto suyo.',
      'Activá/desactivá un proveedor con el toggle. Los inactivos no aparecen en el modal de Nuevo gasto.',
    ],
  },
}

function AyudaPanel({ tab, onClose }: { tab: Tab; onClose: () => void }) {
  const info = ayudaPorTab[tab]
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end p-4" onClick={onClose}>
      <div
        className="mt-16 mr-2 w-80 bg-white rounded-xl shadow-2xl border border-gray-200 animate-in slide-in-from-right"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h4 className="font-semibold text-sm text-gray-900">{info.titulo}</h4>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
        </div>
        <ol className="px-4 py-3 space-y-2">
          {info.pasos.map((paso, i) => (
            <li key={i} className="flex gap-2 text-xs text-gray-600 leading-relaxed">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-rodziny-100 text-rodziny-700 flex items-center justify-center text-[10px] font-bold mt-0.5">
                {i + 1}
              </span>
              <span>{paso}</span>
            </li>
          ))}
        </ol>
        <div className="px-4 py-2 border-t border-gray-100">
          <p className="text-[10px] text-gray-400">Dudas → consultá a Lucas o administración</p>
        </div>
      </div>
    </div>
  )
}

export function ComprasPage() {
  const [local, setLocal] = useState<'vedia' | 'saavedra'>('vedia')
  const [tab, setTab]     = useState<Tab>('stock')
  const [ayudaAbierta, setAyudaAbierta] = useState(false)
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

  interface GastoPago {
    id: string; fudo_id: string; fecha: string; fecha_vencimiento: string | null
    proveedor: string; categoria: string; subcategoria: string; importe_total: number
    estado_pago: string; comentario: string
  }

  const { data: gastosPagos } = useQuery({
    queryKey: ['gastos_pagos', local],
    queryFn: async () => {
      const { data } = await supabase
        .from('gastos')
        .select('id,fudo_id,fecha,fecha_vencimiento,proveedor,categoria,subcategoria,importe_total,estado_pago,comentario')
        .eq('local', local)
        .eq('cancelado', false)
        .order('fecha_vencimiento', { ascending: true, nullsFirst: false })
        .limit(500)
      return (data ?? []) as GastoPago[]
    },
    enabled: tab === 'pagos',
  })

  interface ItemRecepcion {
    producto_id: string
    producto_nombre: string
    cantidad: number
    unidad: string
  }
  interface RecepcionPendiente {
    id: string
    local: string
    proveedor: string | null
    items: ItemRecepcion[]
    registrado_por: string | null
    notas: string | null
    estado: string
    created_at: string
    foto_path: string | null
  }

  async function verFotoRecepcion(path: string) {
    const { data, error } = await supabase.storage
      .from('recepciones-fotos')
      .createSignedUrl(path, 60)
    if (error || !data) { window.alert(`Error: ${error?.message ?? 'sin URL'}`); return }
    window.open(data.signedUrl, '_blank')
  }

  const { data: recepcionesPendientes } = useQuery({
    queryKey: ['recepciones_pendientes', local],
    queryFn: async () => {
      const { data } = await supabase
        .from('recepciones_pendientes')
        .select('*')
        .eq('local', local)
        .eq('estado', 'pendiente')
        .order('created_at', { ascending: false })
      return (data ?? []) as RecepcionPendiente[]
    },
    enabled: tab === 'recepcion',
  })

  // Modal de Nuevo Gasto desde recepción pendiente
  const [modalGastoOpen, setModalGastoOpen] = useState(false)
  const [prefillGasto, setPrefillGasto] = useState<PrefillGasto | undefined>(undefined)

  function abrirGastoDesdeRecepcion(r: RecepcionPendiente) {
    setPrefillGasto({
      recepcion_id: r.id,
      local: r.local as 'vedia' | 'saavedra',
      proveedor_nombre: r.proveedor,
      comprobante_path: r.foto_path,
      items: r.items.map((it) => ({
        producto_id: it.producto_id,
        producto_nombre: it.producto_nombre,
        cantidad: it.cantidad,
        unidad: it.unidad,
      })),
      comentario: r.notas ? `Recepción del ${new Date(r.created_at).toLocaleDateString('es-AR')} · ${r.notas}` : null,
    })
    setModalGastoOpen(true)
  }

  async function descartarRecepcion(id: string) {
    if (!window.confirm('¿Descartar esta recepción? El stock NO se revierte automáticamente.')) return
    const { error } = await supabase
      .from('recepciones_pendientes')
      .update({ estado: 'descartada', validada_en: new Date().toISOString(), validada_por: 'Martín' })
      .eq('id', id)
    if (error) { window.alert(`Error: ${error.message}`); return }
    qc.invalidateQueries({ queryKey: ['recepciones_pendientes'] })
  }

  const [filtroPagos, setFiltroPagos] = useState<'todos' | 'pendientes' | 'vencidos' | 'semana'>('pendientes')
  const [filtroProveedor, setFiltroProveedor] = useState('')

  // Mes seleccionado para el resumen (default: mes actual)
  const [mesPagos, setMesPagos] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })

  // Lista única de proveedores para el dropdown
  const proveedoresPagos = useMemo(() => {
    const todos = gastosPagos ?? []
    const unicos = [...new Set(todos.map((g) => g.proveedor).filter(Boolean))].sort()
    return unicos
  }, [gastosPagos])

  const pagosFiltrados = useMemo(() => {
    const hoy = new Date().toISOString().split('T')[0]
    const en7dias = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]
    let lista = gastosPagos ?? []

    // Filtro por proveedor
    if (filtroProveedor) {
      const fp = filtroProveedor.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      lista = lista.filter((g) => g.proveedor?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(fp))
    }

    if (filtroPagos === 'pendientes') lista = lista.filter((g) => g.estado_pago?.toLowerCase() !== 'pagado')
    else if (filtroPagos === 'vencidos') lista = lista.filter((g) => g.estado_pago?.toLowerCase() !== 'pagado' && g.fecha_vencimiento && g.fecha_vencimiento < hoy)
    else if (filtroPagos === 'semana') lista = lista.filter((g) => g.estado_pago?.toLowerCase() !== 'pagado' && g.fecha_vencimiento && g.fecha_vencimiento >= hoy && g.fecha_vencimiento <= en7dias)

    return lista
  }, [gastosPagos, filtroPagos, filtroProveedor])

  const [vistaResumenProv, setVistaResumenProv] = useState<'mes' | 'año'>('mes')

  // Resumen por proveedor filtrado (cuánto se le debe)
  const resumenProveedor = useMemo(() => {
    if (!filtroProveedor) return null
    const fp = filtroProveedor.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    const todosDelProveedor = (gastosPagos ?? []).filter((g) =>
      g.proveedor?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(fp)
    )

    // Filtro temporal según vista (mes o año del mesPagos seleccionado)
    const año = mesPagos.split('-')[0]
    const delProveedor = vistaResumenProv === 'mes'
      ? todosDelProveedor.filter((g) => g.fecha?.startsWith(mesPagos))
      : todosDelProveedor.filter((g) => g.fecha?.startsWith(año))

    // Pendiente: SIEMPRE total (lo que se debe no depende del período seleccionado)
    const pendientesTotal = todosDelProveedor.filter((g) => g.estado_pago?.toLowerCase() !== 'pagado')
    const pagados = delProveedor.filter((g) => g.estado_pago?.toLowerCase() === 'pagado')

    return {
      nombre: todosDelProveedor[0]?.proveedor ?? filtroProveedor,
      totalCompras: delProveedor.reduce((s, g) => s + g.importe_total, 0),
      cantCompras: delProveedor.length,
      totalPendiente: pendientesTotal.reduce((s, g) => s + g.importe_total, 0),
      cantPendientes: pendientesTotal.length,
      totalPagado: pagados.reduce((s, g) => s + g.importe_total, 0),
    }
  }, [gastosPagos, filtroProveedor, vistaResumenProv, mesPagos])

  const pagosKpis = useMemo(() => {
    const hoy = new Date().toISOString().split('T')[0]
    const en7dias = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]
    const todos = gastosPagos ?? []
    const pendientes = todos.filter((g) => g.estado_pago?.toLowerCase() !== 'pagado')
    const vencidos = pendientes.filter((g) => g.fecha_vencimiento && g.fecha_vencimiento < hoy)
    const proxSemana = pendientes.filter((g) => g.fecha_vencimiento && g.fecha_vencimiento >= hoy && g.fecha_vencimiento <= en7dias)

    // Total gastado del mes seleccionado (todos los gastos, pagados o no)
    const delMes = todos.filter((g) => g.fecha?.startsWith(mesPagos))
    const pagadosDelMes = delMes.filter((g) => g.estado_pago?.toLowerCase() === 'pagado')

    return {
      totalPendiente: pendientes.reduce((s, g) => s + g.importe_total, 0),
      cantPendientes: pendientes.length,
      totalVencido: vencidos.reduce((s, g) => s + g.importe_total, 0),
      cantVencidos: vencidos.length,
      totalSemana: proxSemana.reduce((s, g) => s + g.importe_total, 0),
      cantSemana: proxSemana.length,
      totalMes: delMes.reduce((s, g) => s + g.importe_total, 0),
      cantMes: delMes.length,
      pagadoMes: pagadosDelMes.reduce((s, g) => s + g.importe_total, 0),
      cantPagadoMes: pagadosDelMes.length,
    }
  }, [gastosPagos, mesPagos])

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

  // ── Recepción de mercadería ──────────────────────────────────────────────
  interface DetalleConMatch extends DetalleRow {
    proveedor: string
    productoMatch: Producto | null
    confirmado: boolean
  }
  const recepcionRef = useRef<HTMLInputElement>(null)
  const [recItems, setRecItems] = useState<DetalleConMatch[]>([])
  const [recLoading, setRecLoading] = useState(false)
  const [recError, setRecError] = useState<string | null>(null)
  const [recPeriodo, setRecPeriodo] = useState('')
  const [recConfirmando, setRecConfirmando] = useState(false)
  const [recResultado, setRecResultado] = useState<string | null>(null)

  // Similitud simple por palabras compartidas
  const similitud = useCallback((a: string, b: string) => {
    const normStr = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '')
    const wordsA = normStr(a).split(/\s+/).filter(Boolean)
    const wordsB = normStr(b).split(/\s+/).filter(Boolean)
    if (!wordsA.length || !wordsB.length) return 0
    let matches = 0
    for (const w of wordsA) {
      if (wordsB.some((wb) => wb.includes(w) || w.includes(wb))) matches++
    }
    return matches / Math.max(wordsA.length, wordsB.length)
  }, [])

  async function cargarRecepcion(file: File) {
    setRecLoading(true)
    setRecError(null)
    setRecItems([])
    setRecResultado(null)
    try {
      const buffer = await file.arrayBuffer()
      const { gastos, detalle, periodo } = parseFudoGastos(buffer, local)
      if (!detalle.length) throw new Error('No se encontró hoja "Detalle" en el archivo o está vacía')

      setRecPeriodo(periodo)

      // Guardar gastos en Supabase (alimenta tab Pagos)
      const gastosRows = gastos
        .filter((g) => g.fecha && !g.cancelado)
        .map((g) => ({ local, periodo, ...g }))
      if (gastosRows.length) {
        await supabase.from('gastos').upsert(gastosRows, { onConflict: 'local,fudo_id' })
        qc.invalidateQueries({ queryKey: ['gastos_pagos'] })
      }

      // Mapa gasto_id → proveedor
      const provMap = new Map<string, string>()
      for (const g of gastos) {
        if (!g.cancelado) provMap.set(g.fudo_id, g.proveedor)
      }

      // Solo items de gastos no cancelados
      const itemsValidos = detalle.filter((d) => provMap.has(d.gasto_id))

      // Buscar match con productos existentes
      const prods = productos ?? []
      const items: DetalleConMatch[] = itemsValidos.map((d) => {
        let mejorMatch: Producto | null = null
        let mejorScore = 0
        for (const p of prods) {
          const score = similitud(d.descripcion, p.nombre)
          if (score > mejorScore) { mejorScore = score; mejorMatch = p }
        }
        return {
          ...d,
          proveedor: provMap.get(d.gasto_id) ?? '',
          productoMatch: mejorScore >= 0.4 ? mejorMatch : null,
          confirmado: mejorScore >= 0.6, // auto-confirmar si match alto
        }
      })

      setRecItems(items)
    } catch (e) {
      setRecError((e as Error).message)
    } finally {
      setRecLoading(false)
    }
  }

  function cambiarMatchRecepcion(idx: number, productoId: string | null) {
    setRecItems((prev) => prev.map((item, i) => {
      if (i !== idx) return item
      const prod = productoId ? (productos ?? []).find((p) => p.id === productoId) ?? null : null
      return { ...item, productoMatch: prod, confirmado: !!prod }
    }))
  }

  function toggleConfirmado(idx: number) {
    setRecItems((prev) => prev.map((item, i) =>
      i === idx ? { ...item, confirmado: !item.confirmado } : item
    ))
  }

  async function confirmarRecepcion() {
    const confirmados = recItems.filter((it) => it.confirmado && it.productoMatch)
    if (!confirmados.length) return

    setRecConfirmando(true)
    setRecResultado(null)
    try {
      // Agrupar cantidades por producto (puede haber varios items del mismo producto)
      const porProducto = new Map<string, { prod: Producto; totalCantidad: number; items: DetalleConMatch[] }>()
      for (const it of confirmados) {
        const p = it.productoMatch!
        const existing = porProducto.get(p.id)
        if (existing) {
          existing.totalCantidad += it.cantidad
          existing.items.push(it)
        } else {
          porProducto.set(p.id, { prod: p, totalCantidad: it.cantidad, items: [it] })
        }
      }

      // Crear movimientos de entrada y actualizar stock
      for (const [, { prod, totalCantidad, items }] of porProducto) {
        // Movimiento de entrada
        await supabase.from('movimientos_stock').insert({
          local,
          producto_id: prod.id,
          producto_nombre: prod.nombre,
          tipo: 'entrada',
          cantidad: totalCantidad,
          unidad: items[0].unidad || prod.unidad,
          motivo: 'Recepción mercadería',
          observacion: `Proveedor: ${items[0].proveedor} | ${items.length} item(s) del export Fudo (${recPeriodo})`,
        })

        // Actualizar stock
        await supabase
          .from('productos')
          .update({ stock_actual: prod.stock_actual + totalCantidad, updated_at: new Date().toISOString() })
          .eq('id', prod.id)
      }

      setRecResultado(`${confirmados.length} items recepcionados (${porProducto.size} productos actualizados)`)
      setRecItems([])
      qc.invalidateQueries({ queryKey: ['productos_stock'] })
      qc.invalidateQueries({ queryKey: ['productos_activos'] })
      qc.invalidateQueries({ queryKey: ['movimientos_stock'] })
    } catch (e) {
      setRecResultado(`Error: ${(e as Error).message}`)
    } finally {
      setRecConfirmando(false)
    }
  }

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
            ['recepcion',   '📬 Recepción'],
            ['pagos',       '💰 Pagos'],
            ['proveedores', '🏢 Proveedores'],
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

        <button
          onClick={() => setAyudaAbierta(true)}
          className="ml-auto w-8 h-8 rounded-full bg-rodziny-100 text-rodziny-700 hover:bg-rodziny-200 text-sm font-bold transition-colors flex items-center justify-center"
          title="Ayuda"
        >
          ?
        </button>
      </div>

      {ayudaAbierta && <AyudaPanel tab={tab} onClose={() => setAyudaAbierta(false)} />}

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
      {/* ═══ TAB: RECEPCIÓN ═══ */}
      {tab === 'recepcion' && (
        <div>
          {/* Pagos pendientes de cargar (mercadería ya recibida desde la PWA) */}
          {recepcionesPendientes && recepcionesPendientes.length > 0 && (
            <div className="mb-6 bg-amber-50 border border-amber-300 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-amber-900 text-sm">
                    💰 Pagos pendientes de cargar ({recepcionesPendientes.length})
                  </h3>
                  <p className="text-xs text-amber-700 mt-0.5">
                    Estas recepciones ya entraron al stock desde la PWA. Falta cargar el gasto (monto, fecha de pago, IVA) en Fudo o en la sección de Pagos.
                  </p>
                </div>
              </div>
              <div className="space-y-3">
                {recepcionesPendientes.map((r) => {
                  const fechaStr = new Date(r.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
                  return (
                    <div key={r.id} className="bg-white rounded border border-amber-200 p-3">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900">
                            {r.proveedor || 'Sin proveedor indicado'}
                          </div>
                          <div className="text-xs text-gray-500">
                            {fechaStr} · Recibió: <span className="font-medium">{r.registrado_por || '—'}</span>
                          </div>
                          {r.notas && <div className="text-xs text-gray-600 mt-1 italic">"{r.notas}"</div>}
                        </div>
                        <div className="flex gap-1">
                          {r.foto_path && (
                            <button
                              onClick={() => verFotoRecepcion(r.foto_path!)}
                              className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                            >
                              📷 Ver remito
                            </button>
                          )}
                          <button
                            onClick={() => abrirGastoDesdeRecepcion(r)}
                            className="text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700"
                            title="Cargar gasto en el sistema"
                          >
                            💰 Cargar gasto
                          </button>
                          <button
                            onClick={() => descartarRecepcion(r.id)}
                            className="text-xs px-2 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                          >
                            Descartar
                          </button>
                        </div>
                      </div>
                      <div className="bg-gray-50 rounded p-2 text-xs space-y-0.5">
                        {r.items.map((it, idx) => (
                          <div key={idx} className="flex justify-between text-gray-700">
                            <span>{it.producto_nombre}</span>
                            <span className="font-medium">{it.cantidad} {it.unidad}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Upload */}
          {recItems.length === 0 && (
            <div className="max-w-xl">
              <div className="bg-white rounded-lg border border-surface-border p-6">
                <h3 className="font-semibold text-gray-900 mb-1">Recepción de mercadería</h3>
                <p className="text-xs text-gray-400 mb-3">
                  Subí el export de <strong>gastos</strong> de Fudo (.xls/.xlsx). Se leerá la hoja "Detalle" para matchear los items con tu inventario.
                </p>
                <div className="mb-4 p-3 bg-rodziny-50 border border-rodziny-200 rounded-lg text-sm">
                  Recibiendo en: <span className="font-semibold text-rodziny-800">{local === 'vedia' ? 'Rodziny Vedia' : 'Rodziny Saavedra'}</span>
                </div>

                <div
                  className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors border-gray-300 hover:border-rodziny-500"
                  onClick={() => recepcionRef.current?.click()}
                >
                  <div className="text-2xl mb-2">📬</div>
                  <p className="text-sm text-gray-600">
                    Arrastrá el export de <strong>gastos</strong> de Fudo
                  </p>
                  <input
                    ref={recepcionRef} type="file" className="hidden" accept=".xls,.xlsx"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) cargarRecepcion(f) }}
                  />
                </div>

                {recLoading && <p className="mt-3 text-sm text-blue-600 animate-pulse">Procesando archivo...</p>}
                {recError && <div className="mt-3 p-3 rounded-md text-sm bg-red-50 text-red-700">{recError}</div>}
                {recResultado && (
                  <div className={cn('mt-3 p-3 rounded-md text-sm', recResultado.startsWith('Error') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-800')}>
                    {recResultado}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tabla de matching */}
          {recItems.length > 0 && (
            <>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-gray-900">
                    Items del export — {recPeriodo}
                  </h3>
                  <p className="text-xs text-gray-500">
                    {recItems.filter((i) => i.confirmado && i.productoMatch).length} de {recItems.length} items matcheados.
                    Confirmá o corregí el match de cada item antes de recepcionar.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setRecItems([]); setRecResultado(null) }}
                    className="px-3 py-1.5 text-xs border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={confirmarRecepcion}
                    disabled={recConfirmando || !recItems.some((i) => i.confirmado && i.productoMatch)}
                    className={cn(
                      'px-4 py-1.5 text-sm font-medium rounded-md text-white transition-colors',
                      recConfirmando ? 'bg-gray-400' : 'bg-rodziny-600 hover:bg-rodziny-700',
                      !recItems.some((i) => i.confirmado && i.productoMatch) && 'opacity-50 cursor-not-allowed'
                    )}
                  >
                    {recConfirmando ? 'Procesando...' : `Recepcionar (${recItems.filter((i) => i.confirmado && i.productoMatch).length})`}
                  </button>
                </div>
              </div>

              {recResultado && (
                <div className={cn('mb-3 p-3 rounded-md text-sm', recResultado.startsWith('Error') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-800')}>
                  {recResultado}
                </div>
              )}

              <div className="bg-white rounded-lg border border-surface-border overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-600 w-10">OK</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">Descripción (Fudo)</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-600">Cantidad</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">Unidad</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">Proveedor</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-600">Precio</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 min-w-[220px]">Match producto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recItems.map((item, idx) => (
                        <tr key={idx} className={cn(
                          'border-b border-gray-50 hover:bg-gray-50',
                          item.confirmado && item.productoMatch ? 'bg-green-50/50' : '',
                          !item.productoMatch ? 'bg-yellow-50/50' : ''
                        )}>
                          <td className="px-3 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={item.confirmado && !!item.productoMatch}
                              disabled={!item.productoMatch}
                              onChange={() => toggleConfirmado(idx)}
                              className="h-4 w-4 rounded border-gray-300 text-rodziny-600 focus:ring-rodziny-500"
                            />
                          </td>
                          <td className="px-4 py-2 font-medium text-gray-900">{item.descripcion}</td>
                          <td className="px-4 py-2 text-right font-medium text-gray-800">{item.cantidad}</td>
                          <td className="px-4 py-2 text-gray-600 text-xs">{item.unidad}</td>
                          <td className="px-4 py-2 text-gray-600 text-xs">{item.proveedor}</td>
                          <td className="px-4 py-2 text-right text-gray-600">{item.precio > 0 ? formatARS(item.precio) : '—'}</td>
                          <td className="px-4 py-2">
                            <select
                              value={item.productoMatch?.id ?? ''}
                              onChange={(e) => cambiarMatchRecepcion(idx, e.target.value || null)}
                              className={cn(
                                'w-full text-sm border rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-rodziny-500',
                                item.productoMatch ? 'border-green-300 bg-green-50' : 'border-orange-300 bg-orange-50'
                              )}
                            >
                              <option value="">— Sin match —</option>
                              {(productos ?? []).filter((p) => p.activo).map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.nombre} ({p.stock_actual} {p.unidad})
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══ TAB: PAGOS ═══ */}
      {tab === 'pagos' && (
        <div>
          {/* Resumen mensual */}
          <div className="bg-white rounded-lg border border-surface-border p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700">Resumen mensual — {local === 'vedia' ? 'Rodziny Vedia' : 'Rodziny Saavedra'}</h3>
              <input
                type="month"
                value={mesPagos}
                onChange={(e) => setMesPagos(e.target.value)}
                className="text-sm border border-gray-300 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-rodziny-500"
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Total comprado ({pagosKpis.cantMes})</p>
                <p className="text-xl font-bold text-gray-900">{formatARS(pagosKpis.totalMes)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Pagado ({pagosKpis.cantPagadoMes})</p>
                <p className="text-xl font-bold text-green-600">{formatARS(pagosKpis.pagadoMes)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Resta pagar</p>
                <p className={cn('text-xl font-bold', pagosKpis.totalMes - pagosKpis.pagadoMes > 0 ? 'text-red-600' : 'text-green-600')}>
                  {formatARS(pagosKpis.totalMes - pagosKpis.pagadoMes)}
                </p>
              </div>
            </div>
          </div>

          {/* KPIs de estado */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <button
              onClick={() => setFiltroPagos(filtroPagos === 'pendientes' ? 'todos' : 'pendientes')}
              className={cn('bg-white rounded-lg border p-4 text-left transition-colors',
                filtroPagos === 'pendientes' ? 'border-blue-500 ring-1 ring-blue-200' : 'border-surface-border hover:border-gray-300'
              )}
            >
              <p className="text-xs text-gray-500 mb-1">Pendiente total ({pagosKpis.cantPendientes})</p>
              <p className="text-lg font-semibold text-gray-900">{formatARS(pagosKpis.totalPendiente)}</p>
            </button>
            <button
              onClick={() => setFiltroPagos(filtroPagos === 'vencidos' ? 'todos' : 'vencidos')}
              className={cn('bg-white rounded-lg border p-4 text-left transition-colors',
                filtroPagos === 'vencidos' ? 'border-red-500 ring-1 ring-red-200 bg-red-50' : 'border-surface-border hover:border-gray-300'
              )}
            >
              <p className="text-xs text-gray-500 mb-1">Vencido ({pagosKpis.cantVencidos})</p>
              <p className={cn('text-lg font-semibold', pagosKpis.cantVencidos > 0 ? 'text-red-600' : 'text-green-600')}>
                {formatARS(pagosKpis.totalVencido)}
              </p>
            </button>
            <button
              onClick={() => setFiltroPagos(filtroPagos === 'semana' ? 'todos' : 'semana')}
              className={cn('bg-white rounded-lg border p-4 text-left transition-colors',
                filtroPagos === 'semana' ? 'border-orange-500 ring-1 ring-orange-200 bg-orange-50' : 'border-surface-border hover:border-gray-300'
              )}
            >
              <p className="text-xs text-gray-500 mb-1">Próximos 7 días ({pagosKpis.cantSemana})</p>
              <p className={cn('text-lg font-semibold', pagosKpis.cantSemana > 0 ? 'text-orange-600' : 'text-green-600')}>
                {formatARS(pagosKpis.totalSemana)}
              </p>
            </button>
          </div>

          {/* Buscador por proveedor */}
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1 max-w-sm">
              <input
                type="text"
                placeholder="Buscar proveedor..."
                value={filtroProveedor}
                onChange={(e) => setFiltroProveedor(e.target.value)}
                list="proveedores-pagos-list"
                className="w-full text-sm border border-gray-300 rounded-md pl-8 pr-8 py-2 focus:outline-none focus:ring-1 focus:ring-rodziny-500 focus:border-rodziny-500"
              />
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">🔍</span>
              {filtroProveedor && (
                <button
                  onClick={() => setFiltroProveedor('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
                >&times;</button>
              )}
              <datalist id="proveedores-pagos-list">
                {proveedoresPagos.map((p) => <option key={p} value={p} />)}
              </datalist>
            </div>
            {filtroProveedor && pagosFiltrados.length > 0 && (
              <p className="text-xs text-gray-500">{pagosFiltrados.length} resultado{pagosFiltrados.length !== 1 ? 's' : ''}</p>
            )}
          </div>

          {/* Resumen del proveedor filtrado */}
          {resumenProveedor && (
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h4 className="text-sm font-semibold text-purple-900">{resumenProveedor.nombre}</h4>
                  <p className="text-[10px] text-purple-600">
                    {vistaResumenProv === 'mes' ? `Vista mensual (${mesPagos})` : `Vista anual (${mesPagos.split('-')[0]})`}
                  </p>
                </div>
                <div className="flex bg-white rounded-md border border-purple-300 overflow-hidden text-xs">
                  <button
                    onClick={() => setVistaResumenProv('mes')}
                    className={cn('px-3 py-1 transition-colors',
                      vistaResumenProv === 'mes' ? 'bg-purple-600 text-white' : 'text-purple-700 hover:bg-purple-100'
                    )}
                  >
                    Mensual
                  </button>
                  <button
                    onClick={() => setVistaResumenProv('año')}
                    className={cn('px-3 py-1 transition-colors',
                      vistaResumenProv === 'año' ? 'bg-purple-600 text-white' : 'text-purple-700 hover:bg-purple-100'
                    )}
                  >
                    Anual
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-purple-600 mb-0.5">Total comprado ({resumenProveedor.cantCompras})</p>
                  <p className="text-lg font-bold text-purple-900">{formatARS(resumenProveedor.totalCompras)}</p>
                </div>
                <div>
                  <p className="text-xs text-purple-600 mb-0.5">Pagado en período</p>
                  <p className="text-lg font-bold text-green-600">{formatARS(resumenProveedor.totalPagado)}</p>
                </div>
                <div>
                  <p className="text-xs text-purple-600 mb-0.5">Deuda total ({resumenProveedor.cantPendientes})</p>
                  <p className={cn('text-lg font-bold', resumenProveedor.totalPendiente > 0 ? 'text-red-600' : 'text-green-600')}>
                    {formatARS(resumenProveedor.totalPendiente)}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Tabla de pagos */}
          <div className="bg-white rounded-lg border border-surface-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">Vencimiento</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">Proveedor</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">Categoría</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-600">Importe</th>
                    <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-600">Estado</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">Fecha compra</th>
                    <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-600 w-24">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {pagosFiltrados.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                      {filtroPagos === 'todos' ? 'No hay gastos cargados' : 'No hay pagos en esta categoría'}
                    </td></tr>
                  ) : pagosFiltrados.map((g) => {
                    const hoy = new Date().toISOString().split('T')[0]
                    const en7dias = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]
                    const pagado = g.estado_pago?.toLowerCase() === 'pagado'
                    const vencido = !pagado && g.fecha_vencimiento && g.fecha_vencimiento < hoy
                    const proxSemana = !pagado && !vencido && g.fecha_vencimiento && g.fecha_vencimiento <= en7dias
                    return (
                      <tr key={g.id} className={cn(
                        'border-b border-gray-50 hover:bg-gray-50',
                        pagado && 'opacity-50',
                        vencido && 'bg-red-50',
                        proxSemana && 'bg-orange-50'
                      )}>
                        <td className="px-4 py-2 font-medium">
                          {g.fecha_vencimiento ? (
                            <span className={cn(
                              vencido ? 'text-red-600' : proxSemana ? 'text-orange-600' : 'text-gray-900'
                            )}>
                              {new Date(g.fecha_vencimiento + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })}
                            </span>
                          ) : (
                            <span className="text-gray-300">Sin fecha</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-gray-900">{g.proveedor || '—'}</td>
                        <td className="px-4 py-2 text-gray-600 text-xs">{g.subcategoria || g.categoria}</td>
                        <td className="px-4 py-2 text-right font-medium text-gray-900">{formatARS(g.importe_total)}</td>
                        <td className="px-4 py-2 text-center">
                          {pagado ? (
                            <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">Pagado</span>
                          ) : vencido ? (
                            <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">Vencido</span>
                          ) : proxSemana ? (
                            <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-700">Próximo</span>
                          ) : (
                            <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">A pagar</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-gray-500 text-xs">
                          {g.fecha ? new Date(g.fecha + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'short' }) : '—'}
                        </td>
                        <td className="px-4 py-2 text-center">
                          {!pagado && (
                            <button
                              onClick={async () => {
                                await supabase.from('gastos').update({ estado_pago: 'Pagado' }).eq('id', g.id)
                                qc.invalidateQueries({ queryKey: ['gastos_pagos'] })
                              }}
                              className="px-2 py-1 text-xs rounded border border-green-300 text-green-700 hover:bg-green-50 transition-colors"
                            >
                              Marcar pagado
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ═══ TAB: PROVEEDORES ═══ */}
      {tab === 'proveedores' && <ProveedoresPanel />}

      {/* Modal de Nuevo Gasto desde una recepción pendiente */}
      <NuevoGastoModal
        open={modalGastoOpen}
        onClose={() => { setModalGastoOpen(false); setPrefillGasto(undefined) }}
        prefill={prefillGasto}
      />
    </PageContainer>
  )
}
