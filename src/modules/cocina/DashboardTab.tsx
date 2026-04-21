import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { LocalSelector } from '@/components/ui/LocalSelector'

// ── Productos que el chef controla ──────────────────────────────────────────
// tipo determina unidad de medida y cálculo de porciones
type TipoProducto = 'salsa' | 'postre' | 'pasta'

interface ProductoCocina {
  nombre: string
  fudoNombres?: string[]
  tipo: TipoProducto
  categoria: string            // Categoría visual para agrupar en accordion
  gramosporcion: number
  porcionesporunidad: number
  unidadstock: string
  diasObjetivo: number
  local?: 'vedia' | 'saavedra'
}

const PRODUCTOS_COCINA: ProductoCocina[] = [
  // ════════════════════════════════════════════════════════════════
  // SALSAS (ambos locales — stock en kg, porción referencia ~200g)
  // ════════════════════════════════════════════════════════════════
  { nombre: 'Bolognesa',     categoria: 'Salsas', tipo: 'salsa', gramosporcion: 200, porcionesporunidad: 1, unidadstock: 'kg', diasObjetivo: 3 },
  { nombre: 'Ragú de Roast Beef', categoria: 'Salsas', tipo: 'salsa', gramosporcion: 200, porcionesporunidad: 1, unidadstock: 'kg', diasObjetivo: 3 },
  { nombre: 'Parisienne',    categoria: 'Salsas', tipo: 'salsa', gramosporcion: 200, porcionesporunidad: 1, unidadstock: 'kg', diasObjetivo: 3 },
  { nombre: 'Scarparo',      categoria: 'Salsas', tipo: 'salsa', gramosporcion: 200, porcionesporunidad: 1, unidadstock: 'kg', diasObjetivo: 3 },
  { nombre: 'Rosé', fudoNombres: ['Rosé', 'Rose'], categoria: 'Salsas', tipo: 'salsa', gramosporcion: 200, porcionesporunidad: 1, unidadstock: 'kg', diasObjetivo: 3 },
  { nombre: 'Crema Blanca',  categoria: 'Salsas', tipo: 'salsa', gramosporcion: 200, porcionesporunidad: 1, unidadstock: 'kg', diasObjetivo: 3 },
  { nombre: 'Amatriciana',   categoria: 'Salsas', tipo: 'salsa', gramosporcion: 200, porcionesporunidad: 1, unidadstock: 'kg', diasObjetivo: 3, local: 'vedia' },
  { nombre: 'Pomodoro',      categoria: 'Salsas', tipo: 'salsa', gramosporcion: 200, porcionesporunidad: 1, unidadstock: 'kg', diasObjetivo: 3, local: 'saavedra' },

  // ════════════════════════════════════════════════════════════════
  // PASTAS — Vedia (salón + vianda + congelada se suman)
  // ════════════════════════════════════════════════════════════════
  { nombre: 'Sorrentino J&Q', fudoNombres: ['Sorrentino Jamón, Queso y Cebollas', 'Sorrentino Jamón, Cebollas y Quesos VIANDA', 'Sorrentino de Jamón, Quesos y Cebollas Confitadas CONGELADA'], categoria: 'Pastas', tipo: 'pasta', gramosporcion: 0, porcionesporunidad: 1, unidadstock: 'porciones', diasObjetivo: 2, local: 'vedia' },
  { nombre: 'Ñoquis de Papa', fudoNombres: ['Ñoquis de Papa', 'Ñoquis de Papa VIANDA'], categoria: 'Pastas', tipo: 'pasta', gramosporcion: 0, porcionesporunidad: 1, unidadstock: 'porciones', diasObjetivo: 2, local: 'vedia' },
  { nombre: 'Ravioli espinaca y quesos', fudoNombres: ['Ravioli de espinaca y quesos', 'Ravioli de espinaca y quesos VIANDA', 'Ravioli espinaca y quesos CONGELADA'], categoria: 'Pastas', tipo: 'pasta', gramosporcion: 0, porcionesporunidad: 1, unidadstock: 'porciones', diasObjetivo: 2, local: 'vedia' },
  { nombre: 'Ñoquis rellenos', fudoNombres: ['Ñoquis rellenos', 'Ñoquis rellenos VIANDA'], categoria: 'Pastas', tipo: 'pasta', gramosporcion: 0, porcionesporunidad: 1, unidadstock: 'porciones', diasObjetivo: 2 },
  { nombre: 'Scapinocc Vacio', fudoNombres: ['Scapinocc Vacio de cerdo, cerveza y barbacoa', 'Scapinocc Vacio de cerdo, cerveza y barbacoa VIANDA'], categoria: 'Pastas', tipo: 'pasta', gramosporcion: 0, porcionesporunidad: 1, unidadstock: 'porciones', diasObjetivo: 2, local: 'vedia' },
  { nombre: 'Cappelletti pollo', fudoNombres: ['Cappelletti de pollo y puerro', 'Cappelletti de pollo y puerro VIANDA'], categoria: 'Pastas', tipo: 'pasta', gramosporcion: 0, porcionesporunidad: 1, unidadstock: 'porciones', diasObjetivo: 2, local: 'vedia' },
  { nombre: 'Tagliatelles al Huevo', fudoNombres: ['Tagliatelles al Huevo', 'Tagliatelles al Huevo VIANDA'], categoria: 'Pastas', tipo: 'pasta', gramosporcion: 0, porcionesporunidad: 1, unidadstock: 'porciones', diasObjetivo: 2, local: 'vedia' },
  { nombre: 'Tagliatelles mix', fudoNombres: ['Tagliatelles mix', 'Tagliatelles Mixtos VIANDA', 'Tagliatelles mix CONGELADA'], categoria: 'Pastas', tipo: 'pasta', gramosporcion: 0, porcionesporunidad: 1, unidadstock: 'porciones', diasObjetivo: 2, local: 'vedia' },

  // ════════════════════════════════════════════════════════════════
  // PASTAS — Saavedra (salón + congelada se suman)
  // ════════════════════════════════════════════════════════════════
  { nombre: 'Mila napo + fideos', categoria: 'Pastas', tipo: 'pasta', gramosporcion: 0, porcionesporunidad: 1, unidadstock: 'porciones', diasObjetivo: 2, local: 'saavedra' },
  { nombre: 'Ñoquis de papa', fudoNombres: ['Ñoquis de papa'], categoria: 'Pastas', tipo: 'pasta', gramosporcion: 0, porcionesporunidad: 1, unidadstock: 'porciones', diasObjetivo: 2, local: 'saavedra' },
  { nombre: 'Cappelletti Capresse', fudoNombres: ['Cappelletti Capresse', 'Cappelletti Capresse (CONGELADA)'], categoria: 'Pastas', tipo: 'pasta', gramosporcion: 0, porcionesporunidad: 1, unidadstock: 'porciones', diasObjetivo: 2, local: 'saavedra' },
  { nombre: 'Scarpinocc J&Q', fudoNombres: ['Scarpinocc de Jamón, Quesos y cebollas caramelizadas', 'Scarpinocc de Jamón, Quesos y cebollas caramelizadas (CONGELADA)'], categoria: 'Pastas', tipo: 'pasta', gramosporcion: 0, porcionesporunidad: 1, unidadstock: 'porciones', diasObjetivo: 2, local: 'saavedra' },
  { nombre: 'Mezzelune de Bondiola', fudoNombres: ['Mezzelune de Bondiola Braseada', 'Mezzelune de Bondiola Braseada (CONGELADA)'], categoria: 'Pastas', tipo: 'pasta', gramosporcion: 0, porcionesporunidad: 1, unidadstock: 'porciones', diasObjetivo: 2, local: 'saavedra' },
  { nombre: 'Spaghetti al huevo', fudoNombres: ['Spaghetti al huevo', 'Spaghettis al huevo (CONGELADOS)'], categoria: 'Pastas', tipo: 'pasta', gramosporcion: 0, porcionesporunidad: 1, unidadstock: 'porciones', diasObjetivo: 2, local: 'saavedra' },

  // ════════════════════════════════════════════════════════════════
  // PIZZAS — Saavedra
  // ════════════════════════════════════════════════════════════════
  { nombre: 'Pizza Especial',     categoria: 'Pizzas', tipo: 'pasta', gramosporcion: 0, porcionesporunidad: 1, unidadstock: 'porciones', diasObjetivo: 2, local: 'saavedra' },
  { nombre: 'Pizza Napolitana',   categoria: 'Pizzas', tipo: 'pasta', gramosporcion: 0, porcionesporunidad: 1, unidadstock: 'porciones', diasObjetivo: 2, local: 'saavedra' },
  { nombre: 'Pizza Muzzarella',   categoria: 'Pizzas', tipo: 'pasta', gramosporcion: 0, porcionesporunidad: 1, unidadstock: 'porciones', diasObjetivo: 2, local: 'saavedra' },

  // ════════════════════════════════════════════════════════════════
  // POSTRES — Vedia
  // ════════════════════════════════════════════════════════════════
  { nombre: 'Flan', fudoNombres: ['Flan', 'Flan M.E'], categoria: 'Postres', tipo: 'postre', gramosporcion: 0, porcionesporunidad: 8, unidadstock: 'unidades', diasObjetivo: 2 },
  { nombre: 'Tiramisú', fudoNombres: ['Tiramisú', 'Tiramisu', 'Tiramisu M.E'], categoria: 'Postres', tipo: 'postre', gramosporcion: 0, porcionesporunidad: 8, unidadstock: 'unidades', diasObjetivo: 2 },
  { nombre: 'Budín de pan', fudoNombres: ['Budín de pan', 'Budin de Pan M.E'], categoria: 'Postres', tipo: 'postre', gramosporcion: 0, porcionesporunidad: 8, unidadstock: 'unidades', diasObjetivo: 2, local: 'vedia' },

  // ════════════════════════════════════════════════════════════════
  // HELADOS — Vedia
  // ════════════════════════════════════════════════════════════════
  { nombre: 'Helado soft americana', categoria: 'Helados', tipo: 'postre', gramosporcion: 0, porcionesporunidad: 1, unidadstock: 'porciones', diasObjetivo: 2, local: 'vedia' },
  { nombre: 'Helado soft pistacho', categoria: 'Helados', tipo: 'postre', gramosporcion: 0, porcionesporunidad: 1, unidadstock: 'porciones', diasObjetivo: 2, local: 'vedia' },
  { nombre: 'Helado soft mixto', categoria: 'Helados', tipo: 'postre', gramosporcion: 0, porcionesporunidad: 1, unidadstock: 'porciones', diasObjetivo: 2, local: 'vedia' },

  // ════════════════════════════════════════════════════════════════
  // POSTRES/TORTAS — Saavedra
  // ════════════════════════════════════════════════════════════════
  { nombre: 'Cheese cake', fudoNombres: ['Cheese cake (porcion)', 'Cheesecake (ALMACEN)'], categoria: 'Postres/Tortas', tipo: 'postre', gramosporcion: 0, porcionesporunidad: 8, unidadstock: 'unidades', diasObjetivo: 2, local: 'saavedra' },
  { nombre: 'Brownie', fudoNombres: ['Brownie (porcion)', 'Torta brownie ( ALMACEN)'], categoria: 'Postres/Tortas', tipo: 'postre', gramosporcion: 0, porcionesporunidad: 8, unidadstock: 'unidades', diasObjetivo: 2, local: 'saavedra' },
  { nombre: 'Matilda', fudoNombres: ['Matilda (porcion)'], categoria: 'Postres/Tortas', tipo: 'postre', gramosporcion: 0, porcionesporunidad: 8, unidadstock: 'unidades', diasObjetivo: 2, local: 'saavedra' },
  { nombre: 'Carrot cake', fudoNombres: ['Carrot cake (porcion)'], categoria: 'Postres/Tortas', tipo: 'postre', gramosporcion: 0, porcionesporunidad: 8, unidadstock: 'unidades', diasObjetivo: 2, local: 'saavedra' },
  { nombre: 'Lemon pie', fudoNombres: ['Lemon pie (porcion)'], categoria: 'Postres/Tortas', tipo: 'postre', gramosporcion: 0, porcionesporunidad: 8, unidadstock: 'unidades', diasObjetivo: 2, local: 'saavedra' },
  { nombre: 'Tarta Vasca', categoria: 'Postres/Tortas', tipo: 'postre', gramosporcion: 0, porcionesporunidad: 8, unidadstock: 'unidades', diasObjetivo: 2, local: 'saavedra' },

  // ════════════════════════════════════════════════════════════════
  // DESAYUNOS Y MERIENDAS — Saavedra
  // ════════════════════════════════════════════════════════════════
  { nombre: 'Facturas', categoria: 'Desayunos y Meriendas', tipo: 'postre', gramosporcion: 0, porcionesporunidad: 1, unidadstock: 'unidades', diasObjetivo: 1, local: 'saavedra' },
  { nombre: 'Medialuna Dulce', categoria: 'Desayunos y Meriendas', tipo: 'postre', gramosporcion: 0, porcionesporunidad: 1, unidadstock: 'unidades', diasObjetivo: 1, local: 'saavedra' },
  { nombre: 'Cookies choco', fudoNombres: ['Cookies con chips de chocolate'], categoria: 'Desayunos y Meriendas', tipo: 'postre', gramosporcion: 0, porcionesporunidad: 1, unidadstock: 'unidades', diasObjetivo: 2, local: 'saavedra' },
  { nombre: 'Cookies avellanas', fudoNombres: ['Cookies de chocolate con crema de avellanas'], categoria: 'Desayunos y Meriendas', tipo: 'postre', gramosporcion: 0, porcionesporunidad: 1, unidadstock: 'unidades', diasObjetivo: 2, local: 'saavedra' },

  // ════════════════════════════════════════════════════════════════
  // SALADOS — Saavedra
  // ════════════════════════════════════════════════════════════════
  { nombre: 'Chipa (200g)', categoria: 'Salados', tipo: 'postre', gramosporcion: 0, porcionesporunidad: 1, unidadstock: 'unidades', diasObjetivo: 1, local: 'saavedra' },
  { nombre: 'Mbejú clasico', fudoNombres: ['Mbejú clasico', 'Mbeju de jamon y queso'], categoria: 'Salados', tipo: 'postre', gramosporcion: 0, porcionesporunidad: 1, unidadstock: 'unidades', diasObjetivo: 1, local: 'saavedra' },
]

// Orden fijo de categorías para mostrar
const ORDEN_CATEGORIAS = ['Salsas', 'Pastas', 'Pizzas', 'Postres', 'Helados', 'Postres/Tortas', 'Desayunos y Meriendas', 'Salados']

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
  porDiaSemana: Record<number, { tickets: number; total: number }>
  porHora: Record<number, { tickets: number; total: number }>
}

const DIAS_SEMANA = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

// ── Componente ──────────────────────────────────────────────────────────────
export function DashboardTab() {
  const qc = useQueryClient()
  const [local, setLocal] = useState<'vedia' | 'saavedra'>('vedia')
  const [ventanaDias, setVentanaDias] = useState<1 | 3 | 7>(3)
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

  // ── Query: ventas de la VENTANA reciente (configurable: 1/3/7 días) ──
  // Termina ayer (no incluye hoy porque el día está incompleto).
  const ventanaHasta = new Date(Date.now() - 86400000).toISOString().split('T')[0]
  const ventanaDesde = new Date(Date.now() - ventanaDias * 86400000).toISOString().split('T')[0]
  const { data: fudoReciente } = useQuery({
    queryKey: ['fudo-consumo-reciente', local, ventanaDesde, ventanaHasta],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('fudo-productos', {
        body: { local, fechaDesde: ventanaDesde, fechaHasta: ventanaHasta },
      })
      if (error) return null
      if (!data?.ok) return null
      return data.data as FudoData
    },
    staleTime: 30 * 60 * 1000,
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

  // ── Factor por día de semana (mañana importa más que promedio) ──
  // Calcula cuánto se vende un día X vs el promedio general
  const factorManana = useMemo(() => {
    if (!fudoData?.porDiaSemana) return 1
    const manana = new Date(Date.now() + 86400000)
    const dowManana = manana.getDay() // 0=dom..6=sab
    const dataPorDia = fudoData.porDiaSemana
    const dias = Object.keys(dataPorDia)
    if (dias.length === 0) return 1
    const totalTickets = Object.values(dataPorDia).reduce((s, d) => s + d.tickets, 0)
    const promedioTicketsPorDia = totalTickets / dias.length
    const ticketsManana = dataPorDia[dowManana]?.tickets ?? promedioTicketsPorDia
    if (promedioTicketsPorDia === 0) return 1
    return ticketsManana / promedioTicketsPorDia
  }, [fudoData])

  const diaManana = DIAS_SEMANA[new Date(Date.now() + 86400000).getDay()]

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
      const nombres = prod.fudoNombres ?? [prod.nombre]
      let ventasTotal = 0
      for (const n of nombres) {
        const fudoProd = fudoData?.ranking.find((r) =>
          r.nombre.toLowerCase() === n.toLowerCase()
        )
        if (fudoProd) ventasTotal += fudoProd.cantidad
      }
      const ventasDiariasPromedio = fudoData && fudoData.dias > 0
        ? ventasTotal / fudoData.dias
        : 0

      // Venta ajustada por día de semana (para sugerencia de producción)
      const ventasDiariasAjustadas = ventasDiariasPromedio * factorManana

      // Ventas de la ventana reciente para este producto (promedio diario)
      let ventasReciente = 0
      if (fudoReciente?.ranking) {
        for (const n of nombres) {
          const p = fudoReciente.ranking.find((r) => r.nombre.toLowerCase() === n.toLowerCase())
          if (p) ventasReciente += p.cantidad
        }
      }
      const diasReciente = fudoReciente?.dias ?? ventanaDias
      const ventasRecientePromedio = diasReciente > 0
        ? Math.round((ventasReciente / diasReciente) * 10) / 10
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

      // Días de stock restante (usar ajustada para ser conservador)
      const ventasParaCalculo = Math.max(ventasDiariasPromedio, ventasDiariasAjustadas)
      const diasRestantes = ventasParaCalculo > 0 && stockCantidad !== null
        ? porcionesStock / ventasParaCalculo
        : null

      // Producción sugerida (usar venta ajustada para mañana)
      const porcionesObjetivo = ventasDiariasAjustadas * prod.diasObjetivo
      const porcionesFaltantes = Math.max(0, porcionesObjetivo - porcionesStock)

      // Convertir a unidad de stock
      let producirCantidad = 0
      let producirLabel = ''
      if (prod.tipo === 'salsa') {
        const kgNecesarios = (porcionesFaltantes * prod.gramosporcion) / 1000
        producirCantidad = Math.ceil(kgNecesarios * 10) / 10
        producirLabel = `${producirCantidad} kg`
      } else if (prod.tipo === 'pasta') {
        producirCantidad = Math.ceil(porcionesFaltantes)
        producirLabel = `${producirCantidad} porc.`
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
        ventasDiariasPromedio: Math.round(ventasDiariasPromedio * 10) / 10,
        ventasDiariasAjustadas: Math.round(ventasDiariasAjustadas * 10) / 10,
        ventasReciente: ventasRecientePromedio,
        diasRestantes: diasRestantes !== null ? Math.round(diasRestantes * 10) / 10 : null,
        producirLabel,
        producirCantidad,
        estado,
      }
    })
  }, [conteos, fudoData, fudoReciente, factorManana, ventanaDias])

  // Agrupar filas por categoría, en orden definido
  const categorias = useMemo(() => {
    const grupos = new Map<string, typeof filas>()
    for (const f of filas) {
      const cat = f.categoria
      if (!grupos.has(cat)) grupos.set(cat, [])
      grupos.get(cat)!.push(f)
    }
    // Ordenar por ORDEN_CATEGORIAS, y si aparece alguna nueva al final
    return ORDEN_CATEGORIAS
      .filter((c) => grupos.has(c))
      .map((c) => ({ nombre: c, filas: grupos.get(c)! }))
  }, [filas])

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

  // ── KPIs resumen ──
  const countOk = filas.filter((f) => f.estado === 'ok').length
  const countBajo = filas.filter((f) => f.estado === 'bajo').length
  const countCritico = filas.filter((f) => f.estado === 'critico').length
  const countSinDatos = filas.filter((f) => f.estado === 'sin_datos').length

  // ── Plan de producción: items que necesitan producción, ordenados por urgencia ──
  const planProduccion = filas
    .filter((f) => f.producirCantidad > 0 && f.stockCantidad !== null)
    .sort((a, b) => (a.diasRestantes ?? 0) - (b.diasRestantes ?? 0))

  // ── Pizarrón ──
  const [pizarronAbierto, setPizarronAbierto] = useState(false)
  const [copiado, setCopiado] = useState(false)

  function generarPizarron(): string {
    const hoyFmt = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
    const localLabel = local === 'vedia' ? 'Vedia' : 'Saavedra'

    let txt = `COCINA ${localLabel.toUpperCase()} — ${hoyFmt.charAt(0).toUpperCase() + hoyFmt.slice(1)}\n`
    txt += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n'

    // Urgentes primero
    const criticos = filas.filter((f) => f.estado === 'critico')
    if (criticos.length > 0) {
      txt += 'URGENTE:\n'
      for (const f of criticos) {
        txt += `  !! ${f.nombre} — ${f.diasRestantes !== null ? f.diasRestantes + ' días' : 'sin stock'}\n`
      }
      txt += '\n'
    }

    // Producir hoy — agrupado por categoría
    if (planProduccion.length > 0) {
      txt += 'PRODUCIR HOY:\n'
      let lastCat = ''
      for (const f of planProduccion) {
        if (f.categoria !== lastCat) {
          txt += `  [${f.categoria}]\n`
          lastCat = f.categoria
        }
        const urgencia = f.estado === 'critico' ? ' !!' : ''
        txt += `    * ${f.producirLabel} ${f.nombre}${urgencia}\n`
      }
      txt += '\n'
    }

    // Stock por categoría
    for (const cat of categorias) {
      const okEnCat = cat.filas.filter((f: any) => f.estado === 'ok')
      const bajoEnCat = cat.filas.filter((f: any) => f.estado === 'bajo')
      if (okEnCat.length === 0 && bajoEnCat.length === 0) continue

      txt += `${cat.nombre.toUpperCase()}:\n`
      for (const f of okEnCat) {
        txt += `  OK  ${f.nombre} — ${f.diasRestantes}d (${f.stockCantidad} ${f.unidadstock})\n`
      }
      for (const f of bajoEnCat) {
        txt += `  *   ${f.nombre} — ${f.diasRestantes}d (${f.stockCantidad} ${f.unidadstock})\n`
      }
      txt += '\n'
    }

    // Nota mañana
    const factorPct = Math.round((factorManana - 1) * 100)
    if (factorPct !== 0) {
      txt += `NOTA: Mañana ${diaManana} (${factorPct >= 0 ? '+' : ''}${factorPct}% ventas vs promedio)\n`
    }

    return txt
  }

  function copiarPizarron() {
    const txt = generarPizarron()
    navigator.clipboard.writeText(txt)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-4 flex-wrap">
        <LocalSelector value={local} onChange={(v) => setLocal(v as 'vedia' | 'saavedra')} />
        <button
          onClick={() => setPizarronAbierto(true)}
          className="px-3 py-1.5 text-xs font-medium bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition-colors"
        >
          Pizarron
        </button>
        <div className="flex items-center gap-1 border border-gray-200 rounded-lg bg-white p-0.5">
          <span className="text-[10px] text-gray-500 px-2">Comparar:</span>
          {([1, 3, 7] as const).map((n) => (
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
              {n === 1 ? 'Ayer' : `${n}d`}
            </button>
          ))}
        </div>
        {fudoLoading && <span className="text-xs text-gray-400 animate-pulse">Cargando ventas de Fudo...</span>}
        {fudoData && (
          <span className="text-xs text-gray-400 ml-auto">
            Promedios últimos {fudoData.dias} días · Ajuste {diaManana}: {factorManana >= 1 ? '+' : ''}{Math.round((factorManana - 1) * 100)}%
          </span>
        )}
      </div>

      {/* ── KPIs RESUMEN ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-center">
          <div className="text-2xl font-bold text-green-700">{countOk}</div>
          <div className="text-[10px] uppercase text-green-600 font-medium">OK</div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-center">
          <div className="text-2xl font-bold text-amber-700">{countBajo}</div>
          <div className="text-[10px] uppercase text-amber-600 font-medium">Stock bajo</div>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-center">
          <div className="text-2xl font-bold text-red-700">{countCritico}</div>
          <div className="text-[10px] uppercase text-red-600 font-medium">Urgente</div>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-center">
          <div className="text-2xl font-bold text-gray-500">{countSinDatos}</div>
          <div className="text-[10px] uppercase text-gray-400 font-medium">Sin contar</div>
        </div>
      </div>

      {/* ── PLAN DE PRODUCCIÓN DEL DÍA ── */}
      {planProduccion.length > 0 && (
        <div className="bg-rodziny-50 border border-rodziny-200 rounded-lg p-4">
          <h3 className="text-sm font-bold text-rodziny-800 mb-2">
            Plan de producción — preparar para {diaManana}
          </h3>
          <div className="flex flex-wrap gap-2">
            {planProduccion.map((item) => (
              <span
                key={item.nombre}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium',
                  item.estado === 'critico'
                    ? 'bg-red-100 text-red-800 ring-1 ring-red-300'
                    : 'bg-amber-100 text-amber-800 ring-1 ring-amber-300'
                )}
              >
                <span className="font-bold">{item.producirLabel}</span>
                <span>{item.nombre}</span>
                {item.diasRestantes !== null && (
                  <span className="text-[10px] opacity-70">({item.diasRestantes}d)</span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── CATEGORÍAS ACCORDION ── */}
      {categorias.map((cat) => (
        <CategoriaAccordion
          key={cat.nombre}
          nombre={cat.nombre}
          filas={cat.filas}
          diaManana={diaManana}
          ventanaDias={ventanaDias}
          editando={editando}
          valorEdit={valorEdit}
          onIniciarEdicion={iniciarEdicion}
          onCambiarValor={setValorEdit}
          onGuardar={guardar}
          onCancelar={() => setEditando(null)}
        />
      ))}

      {/* ── MODAL PIZARRÓN ── */}
      {pizarronAbierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setPizarronAbierto(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative bg-gray-900 text-green-400 rounded-xl shadow-2xl p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto font-mono"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">Pizarron del dia</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={copiarPizarron}
                  className={cn(
                    'px-3 py-1 text-xs rounded font-medium transition-colors',
                    copiado
                      ? 'bg-green-700 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  )}
                >
                  {copiado ? 'Copiado!' : 'Copiar texto'}
                </button>
                <button
                  onClick={() => setPizarronAbierto(false)}
                  className="text-gray-500 hover:text-gray-300 text-lg"
                >x</button>
              </div>
            </div>
            <pre className="text-xs leading-relaxed whitespace-pre-wrap">{generarPizarron()}</pre>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Categoría accordion ─────────────────────────────────────────────────────
function CategoriaAccordion({
  nombre,
  filas,
  diaManana,
  ventanaDias,
  editando,
  valorEdit,
  onIniciarEdicion,
  onCambiarValor,
  onGuardar,
  onCancelar,
}: {
  nombre: string
  filas: any[]
  diaManana: string
  ventanaDias: 1 | 3 | 7
  editando: string | null
  valorEdit: string
  onIniciarEdicion: (producto: string, valorActual: number | null) => void
  onCambiarValor: (v: string) => void
  onGuardar: (producto: string) => void
  onCancelar: () => void
}) {
  const [abierto, setAbierto] = useState(true)

  const countOk = filas.filter((f) => f.estado === 'ok').length
  const countBajo = filas.filter((f) => f.estado === 'bajo').length
  const countCritico = filas.filter((f) => f.estado === 'critico').length
  const countSinDatos = filas.filter((f) => f.estado === 'sin_datos').length

  return (
    <div className="bg-white rounded-lg border border-surface-border overflow-hidden">
      {/* Header clickeable */}
      <button
        onClick={() => setAbierto(!abierto)}
        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors"
      >
        <span className={cn(
          'text-xs transition-transform',
          abierto ? 'rotate-90' : 'rotate-0'
        )}>&#9654;</span>
        <h3 className="text-sm font-semibold text-gray-800">{nombre}</h3>
        <span className="text-xs text-gray-400">{filas.length} producto{filas.length !== 1 ? 's' : ''}</span>

        {/* Mini badges resumen en la fila del header */}
        <div className="flex items-center gap-1.5 ml-auto">
          {countCritico > 0 && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700">{countCritico} urgente</span>
          )}
          {countBajo > 0 && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700">{countBajo} bajo</span>
          )}
          {countOk > 0 && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-700">{countOk} ok</span>
          )}
          {countSinDatos > 0 && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-500">{countSinDatos} sin datos</span>
          )}
        </div>
      </button>

      {/* Contenido expandible */}
      {abierto && (
        <div className="border-t border-gray-100 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-[10px] uppercase text-gray-500">
                <th className="px-4 py-2.5 text-left">Producto</th>
                <th className="px-4 py-2.5 text-center">Estado</th>
                <th className="px-4 py-2.5 text-right">Stock actual</th>
                <th className="px-4 py-2.5 text-right">Porc. aprox</th>
                <th className="px-4 py-2.5 text-right">{ventanaDias === 1 ? 'Ayer' : `Últ. ${ventanaDias}d`}</th>
                <th className="px-4 py-2.5 text-right">Prom/día</th>
                <th className="px-4 py-2.5 text-right">Días rest.</th>
                <th className="px-4 py-2.5 text-right">{'Producir (' + diaManana + ')'}</th>
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
                      {f.ventasReciente > 0 ? (
                        <div>
                          <span className={cn(
                            'font-medium',
                            f.ventasReciente > f.ventasDiariasPromedio * 1.2 ? 'text-green-700' :
                            f.ventasReciente < f.ventasDiariasPromedio * 0.8 ? 'text-red-600' : 'text-gray-700'
                          )}>{f.ventasReciente}</span>
                          {f.ventasDiariasPromedio > 0 && f.ventasReciente !== f.ventasDiariasPromedio && (
                            <span className="text-[10px] text-gray-400 ml-1">
                              {f.ventasReciente > f.ventasDiariasPromedio ? '+' : ''}{Math.round(((f.ventasReciente / f.ventasDiariasPromedio) - 1) * 100)}%
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {f.ventasDiariasPromedio > 0 ? (
                        <span className="text-gray-700">{f.ventasDiariasPromedio} porc.</span>
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
      )}
    </div>
  )
}
