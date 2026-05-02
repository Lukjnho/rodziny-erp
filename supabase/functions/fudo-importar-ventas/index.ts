// Edge Function: fudo-importar-ventas
// Sincroniza TODOS los tickets (sales) de un local para un año dado desde la API
// de Fudo a las tablas locales:
//   - ventas_tickets (tickets básicos, ajustando MP Lucas como dividendo/mixto)
//   - ventas_pagos    (un row por payment, para mantener trazabilidad)
//   - dividendos      (auto-generados de pagos con medio "Mercadopago Lucas")
//
// Body: { local: "vedia" | "saavedra", anio: "2026" }
// Reemplaza por completo los datos del año dado para ese local.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

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
  relationships?: Record<
    string,
    { data: { type: string; id: string } | { type: string; id: string }[] | null }
  >
}

// Estado Fudo → estado normalizado (igual que el parser Excel)
function mapEstado(saleState: string): string {
  switch (saleState) {
    case 'CLOSED':
      return 'Cerrada'
    case 'CANCELED':
      return 'Cancelada'
    case 'DELETED':
      return 'Eliminada'
    case 'OPEN':
      return 'Abierta'
    default:
      return saleState
  }
}

// Argentina = UTC-3 → restar 3 horas a closedAt UTC para obtener fecha/hora local
function fechaHoraArg(closedAtUTC: string): { fecha: string; hora: string } {
  const dt = new Date(closedAtUTC)
  const arg = new Date(dt.getTime() - 3 * 60 * 60 * 1000)
  const y = arg.getUTCFullYear()
  const m = String(arg.getUTCMonth() + 1).padStart(2, '0')
  const d = String(arg.getUTCDate()).padStart(2, '0')
  const hh = String(arg.getUTCHours()).padStart(2, '0')
  const mm = String(arg.getUTCMinutes()).padStart(2, '0')
  return { fecha: `${y}-${m}-${d}`, hora: `${hh}:${mm}` }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const local: string = body.local
    const anio: string = String(body.anio ?? new Date().getFullYear())

    if (!local) throw new Error('Falta parámetro: local')
    if (!CREDENCIALES[local]) throw new Error(`Local "${local}" sin credenciales Fudo`)
    if (!/^\d{4}$/.test(anio)) throw new Error('anio inválido (formato YYYY)')

    // Cliente Supabase admin (service role) para escribir en tablas
    const supaUrl = Deno.env.get('SUPABASE_URL')!
    const supaKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supaUrl, supaKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const token = await autenticar(local)

    // Rango: 1 ene hasta 31 dic del año (ARG → UTC)
    const inicioUTC = `${anio}-01-01T03:00:00Z`
    const finUTC = `${Number(anio) + 1}-01-01T02:59:59Z`

    // Cargar paymentMethods (catalogo) — para resolver el nombre del medio.
    // Si el endpoint no existe o cambia de formato, seguimos con map vacío.
    const pmNombre = new Map<string, string>()
    try {
      const pmRes = await fudoGet(token, 'payment-methods')
      for (const r of (pmRes.data ?? []) as JsonApiResource[]) {
        if (!r?.id) continue
        const name = (r.attributes?.name as string | undefined) ?? `pm-${r.id}`
        pmNombre.set(r.id, name)
      }
    } catch (_e) {
      // ignorar — pm queda con names "pm-{id}"
    }

    // Cargar cashRegisters (cajas) — opcional
    const crNombre = new Map<string, string>()
    try {
      const crRes = await fudoGet(token, 'cash-registers')
      for (const r of (crRes.data ?? []) as JsonApiResource[]) {
        if (!r?.id) continue
        const name = (r.attributes?.name as string | undefined) ?? `caja-${r.id}`
        crNombre.set(r.id, name)
      }
    } catch (_e) {
      // ignorar
    }

    // Búsqueda binaria de la última página
    let lo = 1
    let hi = 1000
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

    interface TicketAcum {
      sale: JsonApiResource
      payments: JsonApiResource[]
      discounts: JsonApiResource[]
    }
    const tickets: TicketAcum[] = []
    const paymentsMap = new Map<string, JsonApiResource>()
    const discountsMap = new Map<string, JsonApiResource>()
    const ventaIds = new Set<string>()

    let pag = ultimaPagina
    let terminamos = false

    while (pag >= 1 && !terminamos) {
      const res = await fudoGet(token, 'sales', {
        'page[size]': String(PAGE_SIZE),
        'page[number]': String(pag),
        include: 'payments,cashRegister,discounts',
      })

      if (res.data.length === 0) {
        pag--
        continue
      }

      // Indexar payments y discounts del included
      if (res.included) {
        for (const r of res.included as JsonApiResource[]) {
          if (r.type === 'Payment') paymentsMap.set(r.id, r)
          else if (r.type === 'Discount') discountsMap.set(r.id, r)
        }
      }

      for (const sale of res.data as JsonApiResource[]) {
        const closedAt = sale.attributes.closedAt as string | null
        if (!closedAt) continue

        if (closedAt < inicioUTC) {
          terminamos = true
          continue
        }
        if (closedAt > finUTC) continue
        if (ventaIds.has(sale.id)) continue
        ventaIds.add(sale.id)

        const paymentRels = sale.relationships?.payments?.data
        const ticketPayments: JsonApiResource[] = []
        if (Array.isArray(paymentRels)) {
          for (const rel of paymentRels) {
            const p = paymentsMap.get(rel.id)
            if (p && !p.attributes.canceled) ticketPayments.push(p)
          }
        }

        const discountRels = sale.relationships?.discounts?.data
        const ticketDiscounts: JsonApiResource[] = []
        if (Array.isArray(discountRels)) {
          for (const rel of discountRels) {
            const d = discountsMap.get(rel.id)
            if (d && !d.attributes.canceled) ticketDiscounts.push(d)
          }
        }

        tickets.push({ sale, payments: ticketPayments, discounts: ticketDiscounts })
      }

      pag--
    }

    // Construir filas para insertar
    interface TicketRow {
      local: string
      fudo_id: string
      fecha: string
      hora: string | null
      caja: string
      estado: string
      tipo_venta: string
      medio_pago: string
      total_bruto: number
      total_neto: number | null
      iva: number
      es_fiscal: boolean
      es_dividendo: boolean
      periodo: string
    }
    interface PagoRow {
      local: string
      periodo: string
      fudo_ticket_id: string
      fecha: string | null
      medio_pago: string
      monto: number
      tipo_venta: string
      caja: string
      es_dividendo: boolean
    }

    const ticketsRows: TicketRow[] = []
    const pagosRows: PagoRow[] = []
    const dividendosRows: {
      socio: string
      fecha: string
      monto: number
      medio_pago: string
      concepto: string
      local: string
      periodo: string
      creado_por: string
    }[] = []

    let countPorEstado: Record<string, number> = {}

    // Acumulador de descuentos por periodo (cortesía = 100% off, otros = el resto)
    const descPorMes: Record<string, { cortesias_monto: number; cortesias_cant: number; otros_descuentos: number }> = {}

    for (const { sale, payments, discounts } of tickets) {
      const closedAt = sale.attributes.closedAt as string
      const { fecha, hora } = fechaHoraArg(closedAt)
      const periodo = fecha.substring(0, 7)
      const total = Number(sale.attributes.total ?? 0)
      const estado = mapEstado(sale.attributes.saleState as string)
      countPorEstado[estado] = (countPorEstado[estado] ?? 0) + 1

      // Excluir canceladas/eliminadas (mismo criterio que parser Excel)
      if (estado !== 'Cerrada') continue

      const crData = sale.relationships?.cashRegister?.data
      const cajaId = crData && !Array.isArray(crData) ? crData.id : null
      const caja = cajaId ? crNombre.get(cajaId) ?? `caja-${cajaId}` : ''

      // Calcular MP Lucas (medio_pago name contains 'mercadopago lucas')
      let totalPagos = 0
      let mpLucas = 0
      const mediosPago: string[] = []
      for (const p of payments) {
        const monto = Number(p.attributes.amount ?? 0)
        totalPagos += monto
        const pmRelData = p.relationships?.paymentMethod?.data
        const pmId = pmRelData && !Array.isArray(pmRelData) ? pmRelData.id : null
        const pmName = pmId ? pmNombre.get(pmId) ?? `pm-${pmId}` : 'Sin medio'
        mediosPago.push(pmName)
        if (pmName.toLowerCase().includes('mercadopago lucas')) mpLucas += monto

        pagosRows.push({
          local,
          periodo,
          fudo_ticket_id: sale.id,
          fecha,
          medio_pago: pmName,
          monto,
          tipo_venta: '',
          caja,
          es_dividendo: pmName.toLowerCase().includes('mercadopago lucas'),
        })

        // Si es MP Lucas, generar dividendo automático
        if (pmName.toLowerCase().includes('mercadopago lucas')) {
          dividendosRows.push({
            socio: 'lucas',
            fecha,
            monto,
            medio_pago: 'Mercadopago Lucas',
            concepto: 'Cobro de venta con posnet personal — autoasignado',
            local,
            periodo,
            creado_por: 'import_fudo',
          })
        }
      }

      const esDividendoCompleto = mpLucas > 0 && mpLucas >= total - 0.01
      const esMixto = mpLucas > 0 && !esDividendoCompleto
      const totalAjustado = esMixto ? total - mpLucas : total

      // Medio pago string: si tiene 1, ese; si tiene varios, "Mixto"
      const mediosUnicos = [...new Set(mediosPago)]
      const medioPagoStr =
        mediosUnicos.length === 0
          ? ''
          : mediosUnicos.length === 1
            ? mediosUnicos[0]
            : 'Mixto'

      ticketsRows.push({
        local,
        fudo_id: sale.id,
        fecha,
        hora,
        caja,
        estado,
        tipo_venta: '',
        medio_pago: medioPagoStr,
        total_bruto: totalAjustado,
        total_neto: null,
        iva: 0,
        es_fiscal: false,
        es_dividendo: esDividendoCompleto,
        periodo,
      })

      // Acumular descuentos del ticket en el periodo
      if (discounts.length > 0) {
        if (!descPorMes[periodo]) descPorMes[periodo] = { cortesias_monto: 0, cortesias_cant: 0, otros_descuentos: 0 }
        for (const d of discounts) {
          const monto = Number(d.attributes.amount ?? 0)
          const pct = d.attributes.percentage as number | null
          if (pct === 100) {
            descPorMes[periodo].cortesias_monto += monto
            descPorMes[periodo].cortesias_cant += 1
          } else {
            descPorMes[periodo].otros_descuentos += monto
          }
        }
      }
    }

    // Reemplazar datos del año/local — borra todo y reinserta
    const meses: string[] = []
    for (let i = 1; i <= 12; i++) meses.push(`${anio}-${String(i).padStart(2, '0')}`)

    await supabase.from('ventas_tickets').delete().eq('local', local).in('periodo', meses)
    await supabase.from('ventas_pagos').delete().eq('local', local).in('periodo', meses)
    await supabase
      .from('dividendos')
      .delete()
      .eq('local', local)
      .in('periodo', meses)
      .eq('creado_por', 'import_fudo')

    const errores: string[] = []

    // Insertar en chunks de 1000 para no superar límites
    async function insertChunk<T>(table: string, rows: T[]) {
      const CHUNK = 1000
      for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK)
        const { error } = await supabase.from(table).insert(slice)
        if (error) errores.push(`${table} chunk ${i / CHUNK}: ${error.message}`)
      }
    }

    if (ticketsRows.length) await insertChunk('ventas_tickets', ticketsRows)
    if (pagosRows.length) await insertChunk('ventas_pagos', pagosRows)
    if (dividendosRows.length) await insertChunk('dividendos', dividendosRows)

    // Cortesías y descuentos en edr_partidas (informativo, no afecta cálculos del EdR).
    // Upsert por (local, periodo, concepto) — reemplaza el monto del año entero.
    const partidasRows: { local: string; periodo: string; concepto: string; monto: number }[] = []
    for (const periodo of meses) {
      const d = descPorMes[periodo]
      if (!d) continue
      if (d.cortesias_monto > 0) partidasRows.push({ local, periodo, concepto: 'cortesias_monto', monto: d.cortesias_monto })
      if (d.cortesias_cant > 0) partidasRows.push({ local, periodo, concepto: 'cortesias_cant', monto: d.cortesias_cant })
      if (d.otros_descuentos > 0) partidasRows.push({ local, periodo, concepto: 'otros_descuentos', monto: d.otros_descuentos })
    }
    // Borrar partidas viejas de descuentos para los meses que volvimos a sincronizar
    await supabase
      .from('edr_partidas')
      .delete()
      .eq('local', local)
      .in('periodo', meses)
      .in('concepto', ['cortesias_monto', 'cortesias_cant', 'otros_descuentos'])
    if (partidasRows.length) await insertChunk('edr_partidas', partidasRows)

    // Resumen por mes para el response
    const resumenPorMes: Record<string, { tickets: number; bruto: number }> = {}
    for (const t of ticketsRows) {
      if (!resumenPorMes[t.periodo]) resumenPorMes[t.periodo] = { tickets: 0, bruto: 0 }
      resumenPorMes[t.periodo].tickets++
      resumenPorMes[t.periodo].bruto += t.total_bruto
    }

    return new Response(
      JSON.stringify({
        ok: errores.length === 0,
        data: {
          local,
          anio,
          ticketsImportados: ticketsRows.length,
          pagosImportados: pagosRows.length,
          dividendosImportados: dividendosRows.length,
          partidasImportadas: partidasRows.length,
          countPorEstado,
          resumenPorMes,
          descuentosPorMes: descPorMes,
          errores,
        },
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
