import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { supabase } from '@/lib/supabase'

interface RecetaRow {
  id: string
  nombre: string
  tipo: string
  rendimiento_kg: number | null
  rendimiento_porciones: number | null
}

interface IngredienteRow {
  id: string
  receta_id: string
  nombre: string
  cantidad: number
  unidad: string
  orden: number
  producto_id: string | null
}

interface ProductoRow {
  id: string
  nombre: string
  unidad: string
  costo_unitario: number
}

export interface DetalleIngrediente {
  id: string
  nombre: string
  cantidad: number
  unidad: string
  productoId: string | null
  productoNombre: string | null
  esSubreceta: boolean
  subrecetaId: string | null
  costoUnitario: number | null
  costoTotal: number | null
  error: string | null
}

export interface CostoReceta {
  recetaId: string
  costoBase: number
  margenPct: number
  costoConMargen: number
  costoPorKg: number | null
  costoPorPorcion: number | null
  detalles: DetalleIngrediente[]
  advertencias: string[]
}

function normalizarUnidad(u: string): string {
  const x = (u ?? '').toLowerCase().trim()
  if (x === 'kg' || x === 'kgs') return 'kg'
  if (x === 'g' || x === 'gr' || x === 'grs' || x === 'gramos' || x === 'gramo') return 'g'
  if (x === 'lt' || x === 'l' || x === 'lts' || x === 'litros' || x === 'litro') return 'lt'
  if (x === 'ml' || x === 'mililitros') return 'ml'
  if (x === 'unid.' || x === 'unid' || x === 'u' || x === 'unidades' || x === 'unidad') return 'unid'
  if (x === 'cda' || x === 'cdta') return x
  return x
}

// factor de unidad → unidad base del grupo
// peso: base g; volumen: base ml; unidad: base unid
function aBase(cantidad: number, unidad: string): { cantidad: number; grupo: 'peso' | 'vol' | 'unid' | null } {
  const u = normalizarUnidad(unidad)
  if (u === 'kg') return { cantidad: cantidad * 1000, grupo: 'peso' }
  if (u === 'g') return { cantidad, grupo: 'peso' }
  if (u === 'lt') return { cantidad: cantidad * 1000, grupo: 'vol' }
  if (u === 'ml') return { cantidad, grupo: 'vol' }
  if (u === 'unid') return { cantidad, grupo: 'unid' }
  return { cantidad, grupo: null }
}

function normalizarNombre(n: string): string {
  return (n ?? '')
    .toLowerCase()
    .trim()
    .replace(/^subreceta\s+/i, '')
    .replace(/\s+/g, ' ')
}

export function useCostosRecetas() {
  const recetasQ = useQuery({
    queryKey: ['cocina-recetas-costeo'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_recetas')
        .select('id, nombre, tipo, rendimiento_kg, rendimiento_porciones')
      if (error) throw error
      return data as RecetaRow[]
    },
  })

  const margenGlobalQ = useQuery({
    queryKey: ['config-margen-seguridad'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('configuracion')
        .select('valor')
        .eq('clave', 'margen_seguridad_pct')
        .maybeSingle()
      if (error) throw error
      const v = data?.valor
      const num = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : 0
      return isNaN(num) ? 0 : num
    },
  })

  const ingredientesQ = useQuery({
    queryKey: ['cocina-receta-ingredientes-costeo'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_receta_ingredientes')
        .select('id, receta_id, nombre, cantidad, unidad, orden, producto_id')
        .order('orden')
      if (error) throw error
      return data as IngredienteRow[]
    },
  })

  const productosQ = useQuery({
    queryKey: ['productos-costeo'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('productos')
        .select('id, nombre, unidad, costo_unitario')
        .eq('activo', true)
      if (error) throw error
      return data as ProductoRow[]
    },
  })

  const costos = useMemo(() => {
    const mapa = new Map<string, CostoReceta>()
    const recetas = recetasQ.data
    const ings = ingredientesQ.data
    const prods = productosQ.data
    const margenGlobal = margenGlobalQ.data ?? 0
    if (!recetas || !ings || !prods) return mapa

    // Index de productos por id
    const prodById = new Map<string, ProductoRow>()
    for (const p of prods) prodById.set(p.id, p)

    // Index de productos por nombre normalizado (fallback cuando no hay producto_id)
    const prodByNombre = new Map<string, ProductoRow>()
    for (const p of prods) {
      const k = normalizarNombre(p.nombre)
      if (!prodByNombre.has(k)) prodByNombre.set(k, p)
    }

    // Index de recetas por nombre normalizado (para resolver subrecetas por texto)
    const recetaByNombre = new Map<string, RecetaRow>()
    for (const r of recetas) {
      const k = normalizarNombre(r.nombre)
      if (!recetaByNombre.has(k)) recetaByNombre.set(k, r)
    }

    // Agrupar ingredientes por receta
    const ingsPorReceta = new Map<string, IngredienteRow[]>()
    for (const ing of ings) {
      if (!ingsPorReceta.has(ing.receta_id)) ingsPorReceta.set(ing.receta_id, [])
      ingsPorReceta.get(ing.receta_id)!.push(ing)
    }

    const enProgreso = new Set<string>()

    function calcularCostoProducto(prod: ProductoRow, cantidad: number, unidadIng: string): { costo: number | null; error: string | null } {
      if (!prod.costo_unitario || prod.costo_unitario <= 0) {
        return { costo: null, error: 'Sin costo cargado' }
      }
      const base = aBase(cantidad, unidadIng)
      const baseProd = aBase(1, prod.unidad)
      if (base.grupo === null || baseProd.grupo === null) {
        return { costo: null, error: `Unidad "${unidadIng}" desconocida` }
      }
      if (base.grupo !== baseProd.grupo) {
        return { costo: null, error: `No se puede convertir ${unidadIng} → ${prod.unidad}` }
      }
      // costo_unitario es por 1 unidad base del producto convertida a su forma original
      // ej: si producto está en kg con costo 800, 1kg = 1000g → costo por g = 800/1000
      // cantidad del ingrediente en base / cantidad base del producto × costo
      const costoPorBase = prod.costo_unitario / baseProd.cantidad
      const costo = base.cantidad * costoPorBase
      return { costo, error: null }
    }

    function costearReceta(recetaId: string): CostoReceta {
      const cached = mapa.get(recetaId)
      if (cached) return cached

      const receta = recetas?.find((r) => r.id === recetaId)
      if (!receta) {
        return {
          recetaId,
          costoBase: 0,
          margenPct: 0,
          costoConMargen: 0,
          costoPorKg: null,
          costoPorPorcion: null,
          detalles: [],
          advertencias: ['Receta no encontrada'],
        }
      }

      if (enProgreso.has(recetaId)) {
        // Recursión circular — cortar
        const resultado: CostoReceta = {
          recetaId,
          costoBase: 0,
          margenPct: 0,
          costoConMargen: 0,
          costoPorKg: null,
          costoPorPorcion: null,
          detalles: [],
          advertencias: [`Referencia circular detectada en "${receta.nombre}"`],
        }
        return resultado
      }
      enProgreso.add(recetaId)

      const misIngs = ingsPorReceta.get(recetaId) ?? []
      const detalles: DetalleIngrediente[] = []
      const advertencias: string[] = []
      let costoBase = 0

      for (const ing of misIngs) {
        const esSubrecetaPrefijo = /^subreceta\s+/i.test(ing.nombre ?? '')
        const nombreNorm = normalizarNombre(ing.nombre)

        // 1) intentar resolver como subreceta (por flag o por match de nombre con otra receta)
        let subrecetaMatch: RecetaRow | null = null
        if (esSubrecetaPrefijo || ing.producto_id == null) {
          subrecetaMatch = recetaByNombre.get(nombreNorm) ?? null
        }

        if (subrecetaMatch) {
          const sub = costearReceta(subrecetaMatch.id)
          // usar costo por kg o por porcion según unidad del ingrediente
          const u = normalizarUnidad(ing.unidad)
          let costoUnit: number | null = null
          let error: string | null = null
          if (u === 'kg' || u === 'g') {
            if (sub.costoPorKg != null) {
              const cantKg = u === 'kg' ? ing.cantidad : ing.cantidad / 1000
              costoUnit = sub.costoPorKg
              const costoTotal = cantKg * sub.costoPorKg
              costoBase += costoTotal
              detalles.push({
                id: ing.id,
                nombre: ing.nombre,
                cantidad: ing.cantidad,
                unidad: ing.unidad,
                productoId: null,
                productoNombre: subrecetaMatch.nombre,
                esSubreceta: true,
                subrecetaId: subrecetaMatch.id,
                costoUnitario: costoUnit,
                costoTotal,
                error: null,
              })
              continue
            }
            error = `Subreceta "${subrecetaMatch.nombre}" no tiene rendimiento en kg`
          } else if (u === 'unid') {
            if (sub.costoPorPorcion != null) {
              costoUnit = sub.costoPorPorcion
              const costoTotal = ing.cantidad * sub.costoPorPorcion
              costoBase += costoTotal
              detalles.push({
                id: ing.id,
                nombre: ing.nombre,
                cantidad: ing.cantidad,
                unidad: ing.unidad,
                productoId: null,
                productoNombre: subrecetaMatch.nombre,
                esSubreceta: true,
                subrecetaId: subrecetaMatch.id,
                costoUnitario: costoUnit,
                costoTotal,
                error: null,
              })
              continue
            }
            error = `Subreceta "${subrecetaMatch.nombre}" no tiene rendimiento en porciones`
          } else {
            error = `Unidad "${ing.unidad}" no soportada para subreceta`
          }

          advertencias.push(error)
          detalles.push({
            id: ing.id,
            nombre: ing.nombre,
            cantidad: ing.cantidad,
            unidad: ing.unidad,
            productoId: null,
            productoNombre: subrecetaMatch.nombre,
            esSubreceta: true,
            subrecetaId: subrecetaMatch.id,
            costoUnitario: null,
            costoTotal: null,
            error,
          })
          continue
        }

        // 2) resolver como producto
        let prod: ProductoRow | null = null
        if (ing.producto_id) {
          prod = prodById.get(ing.producto_id) ?? null
        }
        if (!prod) {
          // fallback por nombre
          prod = prodByNombre.get(nombreNorm) ?? null
        }

        if (!prod) {
          const msg = `Sin match: "${ing.nombre}"`
          advertencias.push(msg)
          detalles.push({
            id: ing.id,
            nombre: ing.nombre,
            cantidad: ing.cantidad,
            unidad: ing.unidad,
            productoId: null,
            productoNombre: null,
            esSubreceta: false,
            subrecetaId: null,
            costoUnitario: null,
            costoTotal: null,
            error: msg,
          })
          continue
        }

        const { costo, error } = calcularCostoProducto(prod, ing.cantidad, ing.unidad)
        if (costo == null) {
          if (error) advertencias.push(`${ing.nombre}: ${error}`)
          detalles.push({
            id: ing.id,
            nombre: ing.nombre,
            cantidad: ing.cantidad,
            unidad: ing.unidad,
            productoId: prod.id,
            productoNombre: prod.nombre,
            esSubreceta: false,
            subrecetaId: null,
            costoUnitario: prod.costo_unitario || null,
            costoTotal: null,
            error,
          })
          continue
        }

        costoBase += costo
        detalles.push({
          id: ing.id,
          nombre: ing.nombre,
          cantidad: ing.cantidad,
          unidad: ing.unidad,
          productoId: prod.id,
          productoNombre: prod.nombre,
          esSubreceta: false,
          subrecetaId: null,
          costoUnitario: prod.costo_unitario,
          costoTotal: costo,
          error: null,
        })
      }

      const margenPct = margenGlobal
      const costoConMargen = costoBase * (1 + margenPct)
      const costoPorKg = receta.rendimiento_kg && receta.rendimiento_kg > 0 ? costoConMargen / receta.rendimiento_kg : null
      const costoPorPorcion = receta.rendimiento_porciones && receta.rendimiento_porciones > 0 ? costoConMargen / receta.rendimiento_porciones : null

      const resultado: CostoReceta = {
        recetaId,
        costoBase,
        margenPct,
        costoConMargen,
        costoPorKg,
        costoPorPorcion,
        detalles,
        advertencias,
      }
      mapa.set(recetaId, resultado)
      enProgreso.delete(recetaId)
      return resultado
    }

    for (const r of recetas) costearReceta(r.id)
    return mapa
  }, [recetasQ.data, ingredientesQ.data, productosQ.data, margenGlobalQ.data])

  return {
    costos,
    margenGlobal: margenGlobalQ.data ?? 0,
    isLoading: recetasQ.isLoading || ingredientesQ.isLoading || productosQ.isLoading || margenGlobalQ.isLoading,
    error: recetasQ.error || ingredientesQ.error || productosQ.error || margenGlobalQ.error,
  }
}
