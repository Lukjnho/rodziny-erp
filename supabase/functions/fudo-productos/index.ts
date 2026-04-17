// Edge Function: fudo-productos
// Trae ventas por producto de un rango de fechas, agrupado por producto.
// Body: { local: "vedia" | "saavedra", fechaDesde: "YYYY-MM-DD", fechaHasta: "YYYY-MM-DD" }

const CREDENCIALES: Record<string, { apiKey: string; apiSecret: string }> = {
  vedia: {
    apiKey: 'MjdAOTAyMjU=',
    apiSecret: 'jqHR2D0W0WV4spma8bUUyft4BlZrGo4F',
  },
  saavedra: {
    apiKey: 'MjJAMjg5ODc0',
    apiSecret: 'uiCQBxoCRoMa8BSrIvYGWq5mQlrRVMiS',
  },
}

const AUTH_URL = 'https://auth.fu.do/api'
const BASE_URL = 'https://api.fu.do/v1alpha1'
const PAGE_SIZE = 500

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const tokenCache: Record<string, { token: string; exp: number }> = {}

async function autenticar(local: string): Promise<string> {
  const cached = tokenCache[local]
  if (cached && cached.exp * 1000 - Date.now() > 5 * 60 * 1000) return cached.token
  const creds = CREDENCIALES[local]
  if (!creds) throw new Error(`Sin credenciales para local "${local}"`)
  const res = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(creds),
  })
  if (!res.ok) throw new Error(`Auth Fudo falló: ${res.status}`)
  const { token, exp } = await res.json()
  tokenCache[local] = { token, exp }
  return token
}

async function fudoGet(token: string, endpoint: string, params: Record<string, string> = {}) {
  const url = new URL(`${BASE_URL}/${endpoint}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Fudo ${endpoint} (${res.status}): ${text}`)
  }
  return res.json()
}

interface JsonApiResource {
  type: string
  id: string
  attributes: Record<string, unknown>
  relationships?: Record<string, { data: { type: string; id: string } | { type: string; id: string }[] | null }>
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const local: string = body.local
    const fechaDesde: string = body.fechaDesde
    const fechaHasta: string = body.fechaHasta

    if (!local || !fechaDesde || !fechaHasta) {
      throw new Error('Faltan parámetros: local, fechaDesde, fechaHasta (YYYY-MM-DD)')
    }
    if (!CREDENCIALES[local]) {
      throw new Error(`Local "${local}" no tiene credenciales Fudo`)
    }

    const token = await autenticar(local)

    // Rango UTC (Argentina = UTC-3)
    const inicioUTC = `${fechaDesde}T03:00:00Z`
    const dFin = new Date(fechaHasta + 'T12:00:00Z')
    dFin.setUTCDate(dFin.getUTCDate() + 1)
    const finUTC = `${dFin.toISOString().substring(0, 10)}T02:59:59Z`

    // Encontrar última página (búsqueda binaria)
    let lo = 1, hi = 500
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2)
      const test = await fudoGet(token, 'sales', {
        'page[size]': String(PAGE_SIZE),
        'page[number]': String(mid),
      })
      if (test.data.length > 0) lo = mid
      else hi = mid - 1
    }
    const ultimaPagina = lo

    // Paginar hacia atrás recolectando ventas del rango
    const productsMap = new Map<string, JsonApiResource>()
    const categoriesMap = new Map<string, JsonApiResource>()

    // Acumulador por producto
    interface ProdAcum {
      productId: string
      nombre: string
      categoria: string
      categoriaId: string
      precio: number
      costo: number | null
      cantidad: number
      facturacion: number
      tickets: number // en cuántas ventas aparece
    }
    const porProducto = new Map<string, ProdAcum>()

    let totalVentas = 0
    let cantidadTickets = 0
    let totalItems = 0
    let pag = ultimaPagina
    let terminamos = false
    const ventaIds = new Set<string>()

    // Stats por hora y por día de semana
    const porHora: Record<number, { tickets: number; total: number }> = {}
    const porDiaSemana: Record<number, { tickets: number; total: number }> = {}

    while (pag >= 1 && !terminamos) {
      const res = await fudoGet(token, 'sales', {
        'page[size]': String(PAGE_SIZE),
        'page[number]': String(pag),
        'include': 'items.product.productCategory',
      })

      if (res.data.length === 0) { pag--; continue }

      // Indexar included
      if (res.included) {
        for (const r of res.included as JsonApiResource[]) {
          if (r.type === 'Product') productsMap.set(r.id, r)
          if (r.type === 'ProductCategory') categoriesMap.set(r.id, r)
        }
      }

      for (const sale of res.data as JsonApiResource[]) {
        const closedAt = sale.attributes.closedAt as string | null
        const saleState = sale.attributes.saleState as string
        if (!closedAt || saleState !== 'CLOSED') continue

        if (closedAt >= inicioUTC && closedAt <= finUTC) {
          if (ventaIds.has(sale.id)) continue
          ventaIds.add(sale.id)

          const saleTotal = (sale.attributes.total as number) ?? 0
          totalVentas += saleTotal
          cantidadTickets++

          // Stats por hora (Argentina = UTC-3)
          const dt = new Date(closedAt)
          const horaArg = (dt.getUTCHours() - 3 + 24) % 24
          if (!porHora[horaArg]) porHora[horaArg] = { tickets: 0, total: 0 }
          porHora[horaArg].tickets++
          porHora[horaArg].total += saleTotal

          // Stats por día de semana
          // Ajustar al día argentino
          const argDate = new Date(dt.getTime() - 3 * 60 * 60 * 1000)
          const dow = argDate.getUTCDay() // 0=dom, 1=lun...
          if (!porDiaSemana[dow]) porDiaSemana[dow] = { tickets: 0, total: 0 }
          porDiaSemana[dow].tickets++
          porDiaSemana[dow].total += saleTotal

          // Items
          const items = res.included?.filter(
            (r: JsonApiResource) => r.type === 'Item' &&
            (r.relationships?.sale?.data as { id: string } | null)?.id === sale.id
          ) as JsonApiResource[] | undefined

          // Fallback: usar relationships.items.data
          const itemIds = new Set<string>()
          const itemRels = sale.relationships?.items?.data
          if (Array.isArray(itemRels)) {
            for (const rel of itemRels) itemIds.add(rel.id)
          }

          const saleItems = (res.included as JsonApiResource[] || []).filter(
            (r) => r.type === 'Item' && itemIds.has(r.id)
          )

          for (const item of saleItems) {
            if (item.attributes.canceled) continue
            const qty = (item.attributes.quantity as number) ?? 1
            const price = (item.attributes.price as number) ?? 0
            totalItems += qty

            const prodData = item.relationships?.product?.data
            const prodId = prodData && !Array.isArray(prodData) ? prodData.id : 'unknown'
            const product = productsMap.get(prodId)

            const catData = product?.relationships?.productCategory?.data
            const catId = catData && !Array.isArray(catData) ? catData.id : 'unknown'
            const category = categoriesMap.get(catId)

            if (!porProducto.has(prodId)) {
              porProducto.set(prodId, {
                productId: prodId,
                nombre: (product?.attributes?.name as string) ?? `Producto ${prodId}`,
                categoria: (category?.attributes?.name as string) ?? 'Sin categoría',
                categoriaId: catId,
                precio: (product?.attributes?.price as number) ?? price,
                costo: (product?.attributes?.cost as number) ?? null,
                cantidad: 0,
                facturacion: 0,
                tickets: 0,
              })
            }
            const acum = porProducto.get(prodId)!
            acum.cantidad += qty
            acum.facturacion += price * qty
            if (!ventaIds.has(`${sale.id}-${prodId}`)) {
              acum.tickets++
              ventaIds.add(`${sale.id}-${prodId}`)
            }
          }
        } else if (closedAt < inicioUTC) {
          terminamos = true
        }
      }

      pag--
    }

    // Ordenar por facturación desc
    const ranking = [...porProducto.values()]
      .sort((a, b) => b.facturacion - a.facturacion)

    // Agrupar por categoría
    const porCategoria: Record<string, { nombre: string; cantidad: number; facturacion: number; productos: number }> = {}
    for (const p of ranking) {
      if (!porCategoria[p.categoriaId]) {
        porCategoria[p.categoriaId] = { nombre: p.categoria, cantidad: 0, facturacion: 0, productos: 0 }
      }
      porCategoria[p.categoriaId].cantidad += p.cantidad
      porCategoria[p.categoriaId].facturacion += p.facturacion
      porCategoria[p.categoriaId].productos++
    }

    const dias = Math.max(1, Math.round((new Date(fechaHasta + 'T12:00:00Z').getTime() - new Date(fechaDesde + 'T12:00:00Z').getTime()) / (1000 * 60 * 60 * 24)) + 1)

    const resultado = {
      local,
      fechaDesde,
      fechaHasta,
      dias,
      totalVentas,
      cantidadTickets,
      ticketPromedio: cantidadTickets > 0 ? Math.round(totalVentas / cantidadTickets) : 0,
      totalItems,
      productosUnicos: porProducto.size,
      itemsPorTicket: cantidadTickets > 0 ? Math.round((totalItems / cantidadTickets) * 10) / 10 : 0,
      ventasDiarias: Math.round(totalVentas / dias),
      ticketsDiarios: Math.round(cantidadTickets / dias),
      ranking,
      porCategoria: Object.values(porCategoria).sort((a, b) => b.facturacion - a.facturacion),
      porHora,
      porDiaSemana,
    }

    return new Response(
      JSON.stringify({ ok: true, data: resultado }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
