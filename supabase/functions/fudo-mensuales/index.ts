// Edge Function: fudo-mensuales
// Devuelve totales de venta y tickets agrupados por mes para los últimos N meses.
// Liviana: NO trae items ni productos (sólo header de cada venta).
// Body: { local: "vedia" | "saavedra", meses?: number }  // meses default 12

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
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const local: string = body.local
    const meses: number = Math.min(Math.max(Number(body.meses ?? 12), 1), 24)

    if (!local) throw new Error('Falta parámetro: local')
    if (!CREDENCIALES[local]) throw new Error(`Local "${local}" no tiene credenciales Fudo`)

    const token = await autenticar(local)

    // Fecha de corte: primer día del mes (hoy - meses+1) en hora ARG
    const ahora = new Date()
    const cutoff = new Date(ahora.getFullYear(), ahora.getMonth() - (meses - 1), 1)
    // Convertir a UTC: Argentina = UTC-3 → 00:00 ARG = 03:00 UTC
    const cutoffUTC = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}T03:00:00Z`

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

    // Acumulador por mes (YYYY-MM)
    const porMes: Record<string, { totalVentas: number; cantidadTickets: number }> = {}

    let pag = ultimaPagina
    let terminamos = false
    const ventaIds = new Set<string>()

    while (pag >= 1 && !terminamos) {
      const res = await fudoGet(token, 'sales', {
        'page[size]': String(PAGE_SIZE),
        'page[number]': String(pag),
      })

      if (res.data.length === 0) { pag--; continue }

      for (const sale of res.data as JsonApiResource[]) {
        const closedAt = sale.attributes.closedAt as string | null
        const saleState = sale.attributes.saleState as string
        if (!closedAt || saleState !== 'CLOSED') continue

        if (closedAt < cutoffUTC) {
          terminamos = true
          continue
        }

        if (ventaIds.has(sale.id)) continue
        ventaIds.add(sale.id)

        const saleTotal = (sale.attributes.total as number) ?? 0

        // Mes ARG (closedAt está en UTC, restar 3hs para obtener fecha ARG)
        const dt = new Date(closedAt)
        const argDate = new Date(dt.getTime() - 3 * 60 * 60 * 1000)
        const mes = `${argDate.getUTCFullYear()}-${String(argDate.getUTCMonth() + 1).padStart(2, '0')}`

        if (!porMes[mes]) porMes[mes] = { totalVentas: 0, cantidadTickets: 0 }
        porMes[mes].totalVentas += saleTotal
        porMes[mes].cantidadTickets++
      }

      pag--
    }

    // Generar lista de meses ordenada (incluso meses sin ventas con 0)
    const lista: { mes: string; totalVentas: number; cantidadTickets: number; ticketPromedio: number }[] = []
    for (let i = meses - 1; i >= 0; i--) {
      const d = new Date(ahora.getFullYear(), ahora.getMonth() - i, 1)
      const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const data = porMes[mes] ?? { totalVentas: 0, cantidadTickets: 0 }
      lista.push({
        mes,
        totalVentas: data.totalVentas,
        cantidadTickets: data.cantidadTickets,
        ticketPromedio: data.cantidadTickets > 0 ? Math.round(data.totalVentas / data.cantidadTickets) : 0,
      })
    }

    return new Response(
      JSON.stringify({ ok: true, data: { local, meses: lista } }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
