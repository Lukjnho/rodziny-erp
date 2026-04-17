// Edge Function: fudo-ventas
// Proxy a la API de Fudo para obtener ventas de un día agrupadas por medio de pago.
// Resuelve el problema de CORS (browser no puede llamar directo a api.fu.do).
//
// Body: { local: "vedia" | "saavedra", fecha: "YYYY-MM-DD" }
// Response: { ok: true, data: { fecha, local, totalVentas, cantidadTickets, porMedioPago, efectivo, qr, ... } }
//
// Credenciales hardcodeadas (son API keys de solo lectura, no secretos sensibles).
// Si se prefiere mover a secrets: supabase secrets set FUDO_VEDIA_KEY=... FUDO_VEDIA_SECRET=...

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

// IDs de medios de pago
const PM = {
  efectivo: '1',
  qr: '14',
  debito: '15',
  credito: '16',
  transferencia: '8',
  mpLucas: '7',
  ctaCte: '2',
} as const

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Cache de tokens en memoria (persiste mientras el Edge Function está warm)
const tokenCache: Record<string, { token: string; exp: number }> = {}

async function autenticar(local: string): Promise<string> {
  const cached = tokenCache[local]
  if (cached && cached.exp * 1000 - Date.now() > 5 * 60 * 1000) {
    return cached.token
  }
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
  relationships?: Record<string, { data: { type: string; id: string } | { type: string; id: string }[] }>
}

async function fudoGet(token: string, endpoint: string, params: Record<string, string> = {}) {
  const url = new URL(`${BASE_URL}/${endpoint}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Fudo ${endpoint} (${res.status}): ${text}`)
  }
  return res.json()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const local: string = body.local
    const fecha: string = body.fecha // YYYY-MM-DD

    if (!local || !fecha) {
      throw new Error('Faltan parámetros: local y fecha (YYYY-MM-DD)')
    }
    if (!CREDENCIALES[local]) {
      throw new Error(`Local "${local}" no tiene credenciales Fudo`)
    }

    const token = await autenticar(local)

    // 1) Estimar última página
    const primera = await fudoGet(token, 'sales', {
      'page[size]': '1',
      'page[number]': '1',
    })
    const total = primera.meta?.page?.total
    let ultimaPagina = total ? Math.ceil(total / PAGE_SIZE) : 350

    // Si no tenemos total, verificar que la página tenga datos
    if (!total) {
      const test = await fudoGet(token, 'sales', {
        'page[size]': String(PAGE_SIZE),
        'page[number]': String(ultimaPagina),
      })
      if (test.data.length === 0) {
        // Búsqueda binaria rápida
        let low = 1, high = ultimaPagina
        while (low < high) {
          const mid = Math.ceil((low + high) / 2)
          const probe = await fudoGet(token, 'sales', {
            'page[size]': String(PAGE_SIZE),
            'page[number]': String(mid),
          })
          if (probe.data.length > 0) low = mid + 1
          else high = mid - 1
        }
        ultimaPagina = low
        // Ajustar: si low está vacío, bajar 1
        const check = await fudoGet(token, 'sales', {
          'page[size]': String(PAGE_SIZE),
          'page[number]': String(ultimaPagina),
        })
        if (check.data.length === 0 && ultimaPagina > 1) ultimaPagina--
      }
    }

    // 2) Paginar hacia atrás recolectando ventas del día
    const fechaInicio = `${fecha}T00:00:00`
    const fechaFin = `${fecha}T23:59:59`
    const ventasDelDia: JsonApiResource[] = []
    const paymentsMap = new Map<string, JsonApiResource>()
    let pag = ultimaPagina
    let terminamos = false

    while (pag >= 1 && !terminamos) {
      const res = await fudoGet(token, 'sales', {
        'page[size]': String(PAGE_SIZE),
        'page[number]': String(pag),
        'include': 'payments',
      })

      if (res.data.length === 0) { pag--; continue }

      // Indexar payments incluidos
      if (res.included) {
        for (const r of res.included) {
          if (r.type === 'Payment') paymentsMap.set(r.id, r)
        }
      }

      for (const sale of res.data) {
        const closedAt = sale.attributes.closedAt as string | null
        const saleState = sale.attributes.saleState as string
        if (!closedAt || saleState !== 'CLOSED') continue

        if (closedAt >= fechaInicio && closedAt <= fechaFin) {
          ventasDelDia.push(sale)
        } else if (closedAt < fechaInicio) {
          terminamos = true
          break
        }
      }

      pag--
    }

    // 3) Agrupar por medio de pago
    const porMedioPago: Record<string, number> = {}
    let totalVentas = 0

    for (const sale of ventasDelDia) {
      totalVentas += (sale.attributes.total as number) ?? 0

      const paymentRels = sale.relationships?.payments?.data
      if (Array.isArray(paymentRels)) {
        for (const rel of paymentRels) {
          const payment = paymentsMap.get(rel.id)
          if (!payment) continue
          const amount = (payment.attributes.amount as number) ?? 0
          if (payment.attributes.canceled) continue

          const pmData = payment.relationships?.paymentMethod?.data
          const pmId = pmData && !Array.isArray(pmData) ? pmData.id : 'unknown'
          porMedioPago[pmId] = (porMedioPago[pmId] ?? 0) + amount
        }
      }
    }

    const pmVals = Object.values(PM) as string[]
    const resultado = {
      fecha,
      local,
      totalVentas,
      cantidadTickets: ventasDelDia.length,
      porMedioPago,
      efectivo: porMedioPago[PM.efectivo] ?? 0,
      qr: porMedioPago[PM.qr] ?? 0,
      debito: porMedioPago[PM.debito] ?? 0,
      credito: porMedioPago[PM.credito] ?? 0,
      transferencia: porMedioPago[PM.transferencia] ?? 0,
      mpLucas: porMedioPago[PM.mpLucas] ?? 0,
      ctaCte: porMedioPago[PM.ctaCte] ?? 0,
      otros: Object.entries(porMedioPago)
        .filter(([id]) => !pmVals.includes(id))
        .reduce((s, [, v]) => s + v, 0),
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
