import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatARS, cn } from '@/lib/utils'
import { LocalSelector } from '@/components/ui/LocalSelector'

// ── Productos que el chef controla ──────────────────────────────────────────
// tipo determina unidad de medida y cálculo de porciones
type TipoProducto = 'salsa' | 'postre' | 'pasta'

interface ProductoCocina {
  nombre: string              // Nombre exacto en Fudo (o variantes para match)
  fudoNombres?: string[]      // Nombres alternativos en Fudo para sumar ventas
  tipo: TipoProducto
  gramosporcion: number       // Salsas: ~200g, para referencia. Pastas/postres: 0
  porcionesporunidad: number  // Postres: 8 porc/unidad. Pastas: 1 (se mide en porciones)
  unidadstock: string         // 'kg', 'unidades', 'porciones'
  diasObjetivo: number        // Días de stock mínimo objetivo
  local?: 'vedia' | 'saavedra' // Si es exclusivo de un local
}

const PRODUCTOS_COCINA: ProductoCocina[] = [
  // ── Salsas (stock en kg, porción referencia ~200g) ──
  { nombre: 'Bolognesa',     tipo: 'salsa',  gramosporcion: 200, porcionesporunidad: 1, unidadstock: 'kg', diasObjetivo: 3 },
  { nombre: 'Parisienne',    tipo: 'salsa',  gramosporcion: 200, porcionesporunidad: 1, unidadstock: 'kg', diasObjetivo: 3, local: 'vedia' },
  { nombre: 'Scarparo',      tipo: 'salsa',  gramosporcion: 200, porcionesporunidad: 1, unidadstock: 'kg', diasObjetivo: 3 },
  { nombre: 'Rose',          tipo: 'salsa',  gramosporcion: 200, porcionesporunidad: 1, unidadstock: 'kg', diasObjetivo: 3 },
  { nombre: 'Crema Blanca',  tipo: 'salsa',  gramosporcion: 200, porcionesporunidad: 1, unidadstock: 'kg', diasObjetivo: 3 },

  // ── Pastas Salón (stock en porciones / bateas) ──
  { nombre: 'Sorrentino Jamón, Queso y Cebollas', fudoNombres: ['Sorrentino Jamón, Queso y Cebollas', 'Scarpinocc de Jamón, Quesos y cebollas caramelizadas'], tipo: 'pasta', gramosporcion: 0, porcionesporunidad: 1, unidadstock: 'porciones', diasObjetivo: 2 },
  { nombre: 'Ñoquis de Papa', fudoNombres: ['Ñoquis de Papa', 'Ñoquis de papa'], tipo: 'pasta', gramosporcion: 0, porcionesporunidad: 1, unidadstock: 'porciones', diasObjetivo: 2 },
  { nombre: 'Ñoquis rellenos', tipo: 'pasta', gramosporcion: 0, porcionesporunidad: 1, unidadstock: 'porciones', diasObjetivo: 2 },
  { nombre: 'Tagliatelles mix', fudoNombres: ['Tagliatelles mix', 'Spaghetti al huevo', 'Spaghettis al huevo'], tipo: 'pasta', gramosporcion: 0, porcionesporunidad: 1, unidadstock: 'porciones', diasObjetivo: 2 },
  { nombre: 'Mezzelune de Bondiola', fudoNombres: ['Mezzelune de Bondiola Braseada', 'Mezzelune de Bondiola Braseada VIANDA', 'Mezzelune de Bondiola Braseada CONGELADA'], tipo: 'pasta', gramosporcion: 0, porcionesporunidad: 1, unidadstock: 'porciones', diasObjetivo: 2, local: 'vedia' },
  { nombre: 'Cappelletti Capresse', tipo: 'pasta', gramosporcion: 0, porcionesporunidad: 1, unidadstock: 'porciones', diasObjetivo: 2, local: 'saavedra' },

  // ── Pastas Viandas (se suman con salón, ya incluidas arriba via fudoNombres) ──

  // ── Postres (stock en unidades enteras, 8 porciones cada una) ──
  { nombre: 'Tiramisú', fudoNombres: ['Tiramisú', 'Tiramisu'], tipo: 'postre', gramosporcion: 0, porcionesporunidad: 8, unidadstock: 'unidades', diasObjetivo: 2 },
  { nombre: 'Flan', tipo: 'postre', gramosporcion: 0, porcionesporunidad: 8, unidadstock: 'unidades', diasObjetivo: 2 },
  { nombre: 'Budín de pan', tipo: 'postre', gramosporcion: 0, porcionesporunidad: 8, unidadstock: 'unidades', diasObjetivo: 2, local: 'vedia' },
  // Saavedra
  { nombre: 'Matilda', fudoNombres: ['Matilda (porcion)'], tipo: 'postre', gramosporcion: 0, porcionesporunidad: 8, unidadstock: 'unidades', diasObjetivo: 2, local: 'saavedra' },
  { nombre: 'Carrot cake', fudoNombres: ['Carrot cake (porcion)'], tipo: 'postre', gramosporcion: 0, porcionesporunidad: 8, unidadstock: 'unidades', diasObjetivo: 2, local: 'saavedra' },
  { nombre: 'Brownie', fudoNombres: ['Brownie (porcion)'], tipo: 'postre', gramosporcion: 0, porcionesporunidad: 8, unidadstock: 'unidades', diasObjetivo: 2, local: 'saavedra' },
  { nombre: 'Lemon pie', fudoNombres: ['Lemon pie (porcion)'], tipo: 'postre', gramosporcion: 0, porcionesporunidad: 8, unidadstock: 'unidades', diasObjetivo: 2, local: 'saavedra' },
  { nombre: 'Cheese cake', fudoNombres: ['Cheese cake (porcion)'], tipo: 'postre', gramosporcion: 0, porcionesporunidad: 8, unidadstock: 'unidades', diasObjetivo: 2, local: 'saavedra' },
  { nombre: 'Tarta Vasca', tipo: 'postre', gramosporcion: 0, porcionesporunidad: 8, unidadstock: 'unidades', diasObjetivo: 2, local: 'saavedra' },
]

interface ConteoStock {
  id: string
  producto: string
  fecha: string
  cantidad: number // kg para salsas, unidades para postres
  local: string
  responsable: string | null
  created_at: string
}

interface FudoProductoRanking {
  nombre: string
  cantidad: number
  facturacion: number
  categoria: string
}

interface FudoData {
  dias: number
  ranking: FudoProductoRanking[]
}

// ── Componente ──────────────────────────────────────────────────────────────
export function DashboardTab() {
  const qc = useQueryClient()
  const [local, setLocal] = useState<'vedia' | 'saavedra'>('vedia')
  const hoy = new Date().toISOString().split('T')[0]

  // ── Query: último conteo de stock por producto ──
  const { data: conteos } = useQuery({
    queryKey: ['cocina_conteo_stock', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_conteo_stock')
        .select('*')
        .eq('local', local)
        .order('created_at', { ascending: false })
      if (error) throw error
      // Agrupar: quedarse con el más reciente por producto
      const porProducto = new Map<string, ConteoStock>()
      for (const c of data as ConteoStock[]) {
        if (!porProducto.has(c.producto)) porProducto.set(c.producto, c)
      }
      return porProducto
    },
  })

  // ── Query: ventas promedio de Fudo (últimos 14 días) ──
  const hace14 = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0]
  const { data: fudoData, isLoading: fudoLoading } = useQuery({
    queryKey: ['fudo-consumo', local, hace14, hoy],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('fudo-productos', {
        body: { local, fechaDesde: hace14, fechaHasta: hoy },
      })
      if (error) throw new Error(error.message)
      if (!data?.ok) throw new Error(data?.error ?? 'Error')
      return data.data as FudoData
    },
    staleTime: 10 * 60 * 1000,
  })

  // ── Mutation: guardar conteo de stock ──
  const guardarConteo = useMutation({
    mutationFn: async (payload: { producto: string; cantidad: number }) => {
      const { error } = await supabase.from('cocina_conteo_stock').insert({
        producto: payload.producto,
        cantidad: payload.cantidad,
        fecha: hoy,
        local,
        responsable: 'Chef',
      })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cocina_conteo_stock'] }),
  })

  // ── Calcular datos por producto ──
  const filas = useMemo(() => {
    // Filtrar productos por local
    const productosLocal = PRODUCTOS_COCINA.filter((p) => !p.local || p.local === local)

    return productosLocal.map((prod) => {
      // Stock actual (último conteo)
      const conteo = conteos?.get(prod.nombre)
      const stockCantidad = conteo?.cantidad ?? null
      const stockFecha = conteo?.fecha ?? null

      // Ventas diarias promedio desde Fudo
      // Sumar todas las variantes de nombre (salón + vianda + congelada)
      const nombres = prod.fudoNombres ?? [prod.nombre]
      let ventasTotal = 0
      for (const n of nombres) {
        const fudoProd = fudoData?.ranking.find((r) =>
          r.nombre.toLowerCase() === n.toLowerCase()
        )
        if (fudoProd) ventasTotal += fudoProd.cantidad
      }
      const ventasDiarias = fudoData && fudoData.dias > 0
        ? ventasTotal / fudoData.dias
        : 0

      // Calcular porciones aprox del stock
      let porcionesStock = 0
      if (stockCantidad !== null) {
        if (prod.tipo === 'salsa') {
          porcionesStock = Math.round((stockCantidad * 1000) / prod.gramosporcion)
        } else {
          porcionesStock = stockCantidad * prod.porcionesporunidad
        }
      }

      // Días de stock restante
      const diasRestantes = ventasDiarias > 0 && stockCantidad !== null
        ? porcionesStock / ventasDiarias
        : null

      // Producción sugerida (en porciones para alcanzar objetivo)
      const porcionesObjetivo = ventasDiarias * prod.diasObjetivo
      const porcionesFaltantes = Math.max(0, porcionesObjetivo - porcionesStock)

      // Convertir a unidad de stock
      let producirCantidad = 0
      let producirLabel = ''
      if (prod.tipo === 'salsa') {
        const kgNecesarios = (porcionesFaltantes * prod.gramosporcion) / 1000
        producirCantidad = Math.ceil(kgNecesarios * 10) / 10
        producirLabel = `${producirCantidad} kg`
      } else {
        producirCantidad = Math.ceil(porcionesFaltantes / prod.porcionesporunidad)
        producirLabel = `${producirCantidad} unidad${producirCantidad !== 1 ? 'es' : ''}`
      }

      // Estado semáforo
      let estado: 'ok' | 'bajo' | 'critico' | 'sin_datos' = 'sin_datos'
      if (diasRestantes !== null) {
        if (diasRestantes >= prod.diasObjetivo) estado = 'ok'
        else if (diasRestantes >= 1) estado = 'bajo'
        else estado = 'critico'
      }

      return {
        ...prod,
        stockCantidad,
        stockFecha,
        porcionesStock,
        ventasDiarias: Math.round(ventasDiarias * 10) / 10,
        diasRestantes: diasRestantes !== null ? Math.round(diasRestantes * 10) / 10 : null,
        producirLabel,
        producirCantidad,
        estado,
      }
    })
  }, [conteos, fudoData])

  const salsas = filas.filter((f) => f.tipo === 'salsa')
  const pastas = filas.filter((f) => f.tipo === 'pasta')
  const postres = filas.filter((f) => f.tipo === 'postre')

  // ── Estado inline para edición rápida ──
  const [editando, setEditando] = useState<string | null>(null)
  const [valorEdit, setValorEdit] = useState('')

  function iniciarEdicion(producto: string, valorActual: number | null) {
    setEditando(producto)
    setValorEdit(valorActual !== null ? String(valorActual) : '')
  }

  function guardar(producto: string) {
    const n = parseFloat(valorEdit.replace(',', '.'))
    if (!isNaN(n) && n >= 0) {
      guardarConteo.mutate({ producto, cantidad: n })
    }
    setEditando(null)
    setValorEdit('')
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-4 flex-wrap">
        <LocalSelector value={local} onChange={(v) => setLocal(v as 'vedia' | 'saavedra')} />
        {fudoLoading && <span className="text-xs text-gray-400 animate-pulse">Cargando ventas de Fudo...</span>}
        {fudoData && (
          <span className="text-xs text-gray-400">
            Promedios basados en últimos {fudoData.dias} días de ventas
          </span>
        )}
      </div>

      {/* ── PASTAS ── */}
      <SeccionProductos
        titulo="Pastas"
        subtitulo="Stock en porciones — incluye salón, vianda y congelada"
        filas={pastas}
        editando={editando}
        valorEdit={valorEdit}
        onIniciarEdicion={iniciarEdicion}
        onCambiarValor={setValorEdit}
        onGuardar={guardar}
        onCancelar={() => setEditando(null)}
      />

      {/* ── SALSAS ── */}
      <SeccionProductos
        titulo="Salsas"
        subtitulo="Stock en kg — porciones aprox. a 200g"
        filas={salsas}
        editando={editando}
        valorEdit={valorEdit}
        onIniciarEdicion={iniciarEdicion}
        onCambiarValor={setValorEdit}
        onGuardar={guardar}
        onCancelar={() => setEditando(null)}
      />

      {/* ── POSTRES ── */}
      <SeccionProductos
        titulo="Postres"
        subtitulo="Stock en unidades enteras — 8 porciones cada una"
        filas={postres}
        editando={editando}
        valorEdit={valorEdit}
        onIniciarEdicion={iniciarEdicion}
        onCambiarValor={setValorEdit}
        onGuardar={guardar}
        onCancelar={() => setEditando(null)}
      />
    </div>
  )
}

// ── Sección reutilizable ────────────────────────────────────────────────────
function SeccionProductos({
  titulo,
  subtitulo,
  filas,
  editando,
  valorEdit,
  onIniciarEdicion,
  onCambiarValor,
  onGuardar,
  onCancelar,
}: {
  titulo: string
  subtitulo: string
  filas: ReturnType<typeof Array<any>>
  editando: string | null
  valorEdit: string
  onIniciarEdicion: (producto: string, valorActual: number | null) => void
  onCambiarValor: (v: string) => void
  onGuardar: (producto: string) => void
  onCancelar: () => void
}) {
  return (
    <div className="bg-white rounded-lg border border-surface-border overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-800">{titulo}</h3>
        <p className="text-[10px] text-gray-400">{subtitulo}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr className="text-[10px] uppercase text-gray-500">
              <th className="px-4 py-2.5 text-left">Producto</th>
              <th className="px-4 py-2.5 text-center">Estado</th>
              <th className="px-4 py-2.5 text-right">Stock actual</th>
              <th className="px-4 py-2.5 text-right">Porciones aprox</th>
              <th className="px-4 py-2.5 text-right">Venta/día</th>
              <th className="px-4 py-2.5 text-right">Días restantes</th>
              <th className="px-4 py-2.5 text-right">Producir</th>
              <th className="px-4 py-2.5 text-center w-24">Actualizar</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filas.map((f: any) => {
              const isEditing = editando === f.nombre
              return (
                <tr key={f.nombre} className={cn(
                  'hover:bg-gray-50',
                  f.estado === 'critico' && 'bg-red-50/50',
                  f.estado === 'bajo' && 'bg-amber-50/30',
                )}>
                  <td className="px-4 py-3 font-medium text-gray-900">{f.nombre}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={cn(
                      'inline-block px-2 py-0.5 rounded-full text-[10px] font-medium',
                      f.estado === 'ok' && 'bg-green-100 text-green-800',
                      f.estado === 'bajo' && 'bg-amber-100 text-amber-800',
                      f.estado === 'critico' && 'bg-red-100 text-red-800',
                      f.estado === 'sin_datos' && 'bg-gray-100 text-gray-500',
                    )}>
                      {f.estado === 'ok' ? 'OK' : f.estado === 'bajo' ? 'Bajo' : f.estado === 'critico' ? 'Urgente' : 'Sin datos'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {f.stockCantidad !== null ? (
                      <div>
                        <span className="font-medium">{f.stockCantidad} {f.unidadstock}</span>
                        {f.stockFecha && (
                          <div className="text-[10px] text-gray-400">
                            {new Date(f.stockFecha + 'T12:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-400 text-xs">
                    {f.porcionesStock > 0 ? `~${f.porcionesStock} porc.` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {f.ventasDiarias > 0 ? (
                      <span className="text-gray-700">{f.ventasDiarias} porc.</span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {f.diasRestantes !== null ? (
                      <span className={cn(
                        'font-medium',
                        f.diasRestantes >= f.diasObjetivo ? 'text-green-700' :
                        f.diasRestantes >= 1 ? 'text-amber-700' : 'text-red-700'
                      )}>
                        {f.diasRestantes} días
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {f.producirCantidad > 0 && f.stockCantidad !== null ? (
                      <span className="font-medium text-rodziny-700">{f.producirLabel}</span>
                    ) : f.stockCantidad === null ? (
                      <span className="text-gray-300">—</span>
                    ) : (
                      <span className="text-green-600 text-xs">Suficiente</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {isEditing ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={valorEdit}
                          onChange={(e) => onCambiarValor(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') onGuardar(f.nombre)
                            if (e.key === 'Escape') onCancelar()
                          }}
                          autoFocus
                          className="w-16 border border-rodziny-300 rounded px-2 py-1 text-xs text-center focus:outline-none focus:ring-1 focus:ring-rodziny-500"
                          placeholder={f.unidadstock}
                        />
                        <button onClick={() => onGuardar(f.nombre)}
                          className="text-green-600 hover:text-green-800 text-xs font-medium">OK</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => onIniciarEdicion(f.nombre, f.stockCantidad)}
                        className="text-xs text-rodziny-700 hover:text-rodziny-900 hover:underline"
                      >
                        {f.stockCantidad !== null ? 'Editar' : 'Cargar'}
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
  )
}
