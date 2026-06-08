// Edge Function: fudo-convenios
// Mide el consumo de los convenios en un rango de fechas, cruzando las ventas
// de Fudo por el cliente vinculado a cada venta (relationships.customer).
//
// Body: { local: "vedia" | "saavedra", desde: "YYYY-MM-DD", hasta: "YYYY-MM-DD" }
// Response: { ok: true, data: { local, desde, hasta, ventasEscaneadas, conCliente,
//   convenios: [{ customerId, nombre, consumos, facturacion, descuento, ultimaFecha }] } }
//
// facturacion = suma de Sale.total (lo que efectivamente pagaron, ya neto de descuento).
// descuento   = suma de los Discount.amount aplicados (lo que se les bonifica = "lo que damos").
//
// Credenciales hardcodeadas (API keys de solo lectura, mismas que fudo-ventas).

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

interface JsonApiResource {
  type: string
  id: string
  attributes: Record<string, unknown>
  relationships?: Record<string, { data: { type: string; id: string } | { type: string; id: string }[] | null }>
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

// Trae todos los clientes y arma un mapa id -> nombre.
async function mapaClientes(token: string): Promise<Record<string, string>> {
  const mapa: Record<string, string> = {}
  for (let p = 1; p <= 30; p++) {
    const res = await fudoGet(token, 'customers', {
      'page[size]': String(PAGE_SIZE),
      'page[number]': String(p),
    })
    if (!res.data || res.data.length === 0) break
    for (const c of res.data as JsonApiResource[]) {
      mapa[c.id] = (c.attributes.name as string) ?? `#${c.id}`
    }
  }
  return mapa
}

interface Acum {
  customerId: string
  consumos: number
  facturacion: number
  descuento: number
  ultimaFecha: string | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json().catch(() => ({}))
    const local: string = body.local
    const desde: string = body.desde // YYYY-MM-DD
    const hasta: string = body.hasta // YYYY-MM-DD (inclusive)

    if (!local) throw new Error('Falta parámetro: local')
    if (!CREDENCIALES[local]) throw new Error(`Local "${local}" no tiene credenciales Fudo`)
    if (!desde || !hasta) throw new Error('Faltan parámetros: desde / hasta (YYYY-MM-DD)')

    const token = await autenticar(local)

    // Rango en UTC. Argentina = UTC-3, así que el día local arranca a las 03:00Z
    // y termina a las 02:59:59Z del día siguiente.
    const fechaInicio = `${desde}T03:00:00Z`
    const dFin = new Date(hasta + 'T12:00:00Z')
    dFin.setUTCDate(dFin.getUTCDate() + 1)
    const sigDia = dFin.toISOString().substring(0, 10)
    const fechaFin = `${sigDia}T02:59:59Z`

    // Mapa de nombres de clientes (para resolver el id del convenio).
    const clientes = await mapaClientes(token)

    // 1) Última página de sales (búsqueda binaria).
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

    // 2) Paginar hacia atrás acumulando ventas con cliente vinculado dentro del rango.
    const acum: Record<string, Acum> = {}
    const discountsMap = new Map<string, JsonApiResource>()
    let ventasEscaneadas = 0
    let conCliente = 0
    let pag = lo
    let terminamos = false

    while (pag >= 1 && !terminamos) {
      const res = await fudoGet(token, 'sales', {
        'page[size]': String(PAGE_SIZE),
        'page[number]': String(pag),
        'include': 'discounts',
      })
      if (res.data.length === 0) { pag--; continue }

      if (res.included) {
        for (const r of res.included as JsonApiResource[]) {
          if (r.type === 'Discount') discountsMap.set(r.id, r)
        }
      }

      for (const sale of res.data as JsonApiResource[]) {
        const closedAt = sale.attributes.closedAt as string | null
        const saleState = sale.attributes.saleState as string
        if (!closedAt || saleState !== 'CLOSED') continue

        if (closedAt < fechaInicio) { terminamos = true; continue }
        if (closedAt > fechaFin) continue
        ventasEscaneadas++

        const custData = sale.relationships?.customer?.data
        const customerId = custData && !Array.isArray(custData) ? custData.id : null
        if (!customerId) continue
        conCliente++

        if (!acum[customerId]) {
          acum[customerId] = { customerId, consumos: 0, facturacion: 0, descuento: 0, ultimaFecha: null }
        }
        const a = acum[customerId]
        a.consumos++
        a.facturacion += (sale.attributes.total as number) ?? 0
        if (!a.ultimaFecha || closedAt > a.ultimaFecha) a.ultimaFecha = closedAt

        const discRels = sale.relationships?.discounts?.data
        if (Array.isArray(discRels)) {
          for (const rel of discRels) {
            const d = discountsMap.get(rel.id)
            if (!d) continue
            if (d.attributes.canceled) continue
            a.descuento += (d.attributes.amount as number) ?? 0
          }
        }
      }
      pag--
    }

    const convenios = Object.values(acum)
      .map((a) => ({ ...a, nombre: clientes[a.customerId] ?? `#${a.customerId}` }))
      .sort((x, y) => y.facturacion - x.facturacion)

    return new Response(
      JSON.stringify({
        ok: true,
        data: { local, desde, hasta, ventasEscaneadas, conCliente, convenios },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
