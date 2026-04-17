// Edge Function: fudo-ventas
// Proxy a la API de Fudo para obtener ventas de un día agrupadas por medio de pago.
// Resuelve el problema de CORS (browser no puede llamar directo a api.fu.do).
//
// Body: { local: "vedia" | "saavedra", fecha: "YYYY-MM-DD", cajaId?: "1" | "4" }
// Response: { ok: true, data: { fecha, local, totalVentas, cantidadTickets, porMedioPago, efectivo, qr, ..., cajero, porCaja } }
//
// cajaId filtra ventas por CashRegister ID de Fudo. Sin cajaId = todas las cajas.
// cajero = nombre del usuario que más ventas cerró (closedBy) para esa caja.
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
    const modo: string | undefined = body.modo // "descubrir" para explorar estructura

    if (!local) {
      throw new Error('Falta parámetro: local')
    }
    if (!CREDENCIALES[local]) {
      throw new Error(`Local "${local}" no tiene credenciales Fudo`)
    }

    const token = await autenticar(local)

    // ── Modo descubrir: devuelve estructura cruda de 1 sale + endpoints extra ──
    if (modo === 'descubrir') {
      // Traer 1 sale con todos los includes posibles
      const saleRes = await fudoGet(token, 'sales', {
        'page[size]': '3',
        'page[number]': '1',
        'include': 'cashRegister,closedBy,payments,payments.paymentMethod',
      })
      // Probar endpoints de cajas y usuarios
      let cashRegisters = null
      let users = null
      let cashiers = null
      try { cashRegisters = await fudoGet(token, 'cash-registers', { 'page[size]': '5' }) } catch { /* no existe */ }
      try { users = await fudoGet(token, 'users', { 'page[size]': '5' }) } catch { /* no existe */ }
      try { cashiers = await fudoGet(token, 'cashiers', { 'page[size]': '5' }) } catch { /* no existe */ }

      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            sale: saleRes.data?.[0] ?? null,
            included: saleRes.included ?? [],
            saleRelationships: saleRes.data?.[0]?.relationships ? Object.keys(saleRes.data[0].relationships) : [],
            cashRegisters,
            users,
            cashiers,
          },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (!fecha) {
      throw new Error('Falta parámetro: fecha (YYYY-MM-DD)')
    }

    const cajaId: string | undefined = body.cajaId // CashRegister ID de Fudo (opcional)

    // 1) Encontrar la última página con datos.
    let ultimaPagina = 340
    while (ultimaPagina > 0) {
      const test = await fudoGet(token, 'sales', {
        'page[size]': String(PAGE_SIZE),
        'page[number]': String(ultimaPagina),
      })
      if (test.data.length > 0) break
      ultimaPagina -= 5
    }
    if (ultimaPagina <= 0) ultimaPagina = 1
    while (true) {
      const next = await fudoGet(token, 'sales', {
        'page[size]': String(PAGE_SIZE),
        'page[number]': String(ultimaPagina + 1),
      })
      if (next.data.length === 0) break
      ultimaPagina++
    }

    // 2) Paginar hacia atrás recolectando ventas del día
    //    Fudo guarda closedAt en UTC. Argentina = UTC-3.
    const fechaInicio = `${fecha}T03:00:00Z`
    const d = new Date(fecha + 'T12:00:00Z')
    d.setUTCDate(d.getUTCDate() + 1)
    const sigDia = d.toISOString().substring(0, 10)
    const fechaFin = `${sigDia}T02:59:59Z`
    const ventasDelDia: JsonApiResource[] = []
    const paymentsMap = new Map<string, JsonApiResource>()
    const usersMap = new Map<string, JsonApiResource>()
    let pag = ultimaPagina
    let terminamos = false

    while (pag >= 1 && !terminamos) {
      const res = await fudoGet(token, 'sales', {
        'page[size]': String(PAGE_SIZE),
        'page[number]': String(pag),
        'include': 'payments,cashRegister,closedBy',
      })

      if (res.data.length === 0) { pag--; continue }

      // Indexar included resources
      if (res.included) {
        for (const r of res.included) {
          if (r.type === 'Payment') paymentsMap.set(r.id, r)
          if (r.type === 'User') usersMap.set(r.id, r)
        }
      }

      for (const sale of res.data) {
        const closedAt = sale.attributes.closedAt as string | null
        const saleState = sale.attributes.saleState as string
        if (!closedAt || saleState !== 'CLOSED') continue

        if (closedAt >= fechaInicio && closedAt <= fechaFin) {
          // Filtrar por caja si se especificó
          if (cajaId) {
            const crData = sale.relationships?.cashRegister?.data
            const saleCajaId = crData && !Array.isArray(crData) ? crData.id : null
            if (saleCajaId !== cajaId) continue
          }
          ventasDelDia.push(sale)
        } else if (closedAt < fechaInicio) {
          terminamos = true
        }
      }

      pag--
    }

    // 3) Agrupar por medio de pago
    const porMedioPago: Record<string, number> = {}
    let totalVentas = 0
    // Conteo de cajeros (closedBy) para determinar el cajero principal
    const cajeroCounts: Record<string, number> = {}
    // Desglose por caja
    const porCaja: Record<string, { tickets: number; total: number; cajero: string | null }> = {}

    for (const sale of ventasDelDia) {
      totalVentas += (sale.attributes.total as number) ?? 0

      // Trackear cajero
      const closedByData = sale.relationships?.closedBy?.data
      const closedById = closedByData && !Array.isArray(closedByData) ? closedByData.id : null
      if (closedById) {
        cajeroCounts[closedById] = (cajeroCounts[closedById] ?? 0) + 1
      }

      // Trackear caja
      const crData = sale.relationships?.cashRegister?.data
      const crId = crData && !Array.isArray(crData) ? crData.id : 'unknown'
      if (!porCaja[crId]) {
        const cajeroUser = closedById ? usersMap.get(closedById) : null
        porCaja[crId] = { tickets: 0, total: 0, cajero: (cajeroUser?.attributes?.name as string) ?? null }
      }
      porCaja[crId].tickets++
      porCaja[crId].total += (sale.attributes.total as number) ?? 0

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

    // Determinar cajero principal (el que más ventas cerró)
    let cajero: string | null = null
    let maxCount = 0
    for (const [userId, count] of Object.entries(cajeroCounts)) {
      if (count > maxCount) {
        maxCount = count
        const user = usersMap.get(userId)
        cajero = (user?.attributes?.name as string) ?? null
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
      cajero,
      porCaja,
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
