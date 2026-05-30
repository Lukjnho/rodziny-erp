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

  // Cliente y runId fuera del try para que el catch pueda registrar el error en
  // fudo_sync_runs (sin esto, una falla post-insert quedaría como 'running' eterno).
  const supaUrl = Deno.env.get('SUPABASE_URL')!
  const supaKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supaUrl, supaKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  let runId: string | null = null

  try {
    const body = await req.json().catch(() => ({}))
    const local: string = body.local
    const anio: string = String(body.anio ?? new Date().getFullYear())
    const iniciadoPor: string | null = body.iniciado_por ?? null

    if (!local) throw new Error('Falta parámetro: local')
    if (!CREDENCIALES[local]) throw new Error(`Local "${local}" sin credenciales Fudo`)
    if (!/^\d{4}$/.test(anio)) throw new Error('anio inválido (formato YYYY)')

    // Registrar inicio del sync. El frontend lee finished_at para el "Última sync hace X min".
    const { data: runData } = await supabase
      .from('fudo_sync_runs')
      .insert({ local, anio, status: 'running', iniciado_por: iniciadoPor })
      .select('id')
      .single()
    runId = runData?.id ?? null

    const token = await autenticar(local)

    // Permite sincronizar solo meses específicos para evitar timeouts cuando
    // un local tiene muchos tickets/items (Vedia con año entero supera 150s).
    // Si no se pasa, sincroniza el año completo.
    const mesesBody = body.meses
    const mesesSync: string[] = Array.isArray(mesesBody) && mesesBody.length > 0
      ? (mesesBody as string[]).filter((m) => /^\d{4}-\d{2}$/.test(m)).sort()
      : Array.from({ length: 12 }, (_, i) => `${anio}-${String(i + 1).padStart(2, '0')}`)

    const primerMes = mesesSync[0]
    const ultimoMes = mesesSync[mesesSync.length - 1]
    const [yF, mF] = ultimoMes.split('-').map(Number)
    const yNext = mF === 12 ? yF + 1 : yF
    const mNext = mF === 12 ? 1 : mF + 1

    // Rango ARG → UTC: ARG 00:00 = UTC 03:00. Tope inclusivo del último mes
    // = UTC 02:59:59 del día 1 del mes siguiente.
    const inicioUTC = `${primerMes}-01T03:00:00Z`
    const finUTC = `${yNext}-${String(mNext).padStart(2, '0')}-01T02:59:59Z`

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

    // Cargar productCategories (mapa id → nombre). Lo usamos para enriquecer
    // ventas_items.categoria desde Product.relationships.productCategory.
    const catNombre = new Map<string, string>()
    try {
      let p = 1
      while (true) {
        const r = await fudoGet(token, 'product-categories', {
          'page[size]': String(PAGE_SIZE),
          'page[number]': String(p),
        })
        if (!r.data?.length) break
        for (const c of r.data as JsonApiResource[]) {
          const name = (c.attributes?.name as string | undefined) ?? `cat-${c.id}`
          catNombre.set(c.id, name)
        }
        if (r.data.length < PAGE_SIZE) break
        p++
      }
    } catch (_e) {
      // si /product-categories no existe en este local, categoria queda null
    }

    // Cargar products (mapa id → { code, name, categoryId }). Pagina hasta
    // que la API devuelva una página vacía o incompleta.
    interface ProductLite {
      code: string | null
      name: string
      categoryId: string | null
    }
    const productoById = new Map<string, ProductLite>()
    {
      let p = 1
      while (true) {
        const r = await fudoGet(token, 'products', {
          'page[size]': String(PAGE_SIZE),
          'page[number]': String(p),
        })
        if (!r.data?.length) break
        for (const prod of r.data as JsonApiResource[]) {
          const pcData = prod.relationships?.productCategory?.data
          const catId = pcData && !Array.isArray(pcData) ? pcData.id : null
          productoById.set(prod.id, {
            code: (prod.attributes?.code as string | null) ?? null,
            name: (prod.attributes?.name as string | undefined) ?? `prod-${prod.id}`,
            categoryId: catId,
          })
        }
        if (r.data.length < PAGE_SIZE) break
        p++
      }
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
      items: JsonApiResource[]
    }
    const tickets: TicketAcum[] = []
    const paymentsMap = new Map<string, JsonApiResource>()
    const discountsMap = new Map<string, JsonApiResource>()
    const itemsMap = new Map<string, JsonApiResource>()
    const ventaIds = new Set<string>()

    let pag = ultimaPagina
    let terminamos = false

    while (pag >= 1 && !terminamos) {
      const res = await fudoGet(token, 'sales', {
        'page[size]': String(PAGE_SIZE),
        'page[number]': String(pag),
        include: 'payments,cashRegister,discounts,items',
      })

      if (res.data.length === 0) {
        pag--
        continue
      }

      // Indexar payments, discounts e items del included
      if (res.included) {
        for (const r of res.included as JsonApiResource[]) {
          if (r.type === 'Payment') paymentsMap.set(r.id, r)
          else if (r.type === 'Discount') discountsMap.set(r.id, r)
          else if (r.type === 'Item') itemsMap.set(r.id, r)
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

        const itemRels = sale.relationships?.items?.data
        const ticketItems: JsonApiResource[] = []
        if (Array.isArray(itemRels)) {
          for (const rel of itemRels) {
            const it = itemsMap.get(rel.id)
            if (it && !it.attributes.canceled) ticketItems.push(it)
          }
        }

        tickets.push({ sale, payments: ticketPayments, discounts: ticketDiscounts, items: ticketItems })
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
    interface VentaItemRow {
      local: string
      periodo: string
      codigo: string
      nombre: string
      categoria: string | null
      subcategoria: string | null
      cantidad: number
      total: number
    }

    const ticketsRows: TicketRow[] = []
    const pagosRows: PagoRow[] = []
    const ventasItemsRows: VentaItemRow[] = []
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

    // Meses a sincronizar (subset del año o año entero, según body.meses)
    const meses: string[] = mesesSync

    // Preservar campos fiscales (iva / total_neto / es_fiscal) que vienen del
    // Excel de Fudo. La API pública v1alpha1 no los expone, así que si los
    // borráramos sin más, perderíamos el dato bueno cargado por UploadFudo.
    // Estrategia: leer los previos ANTES de borrar y mergear al re-insertar.
    const { data: previos } = await supabase
      .from('ventas_tickets')
      .select('fudo_id, iva, total_neto, es_fiscal')
      .eq('local', local)
      .in('periodo', meses)
    const fiscalPrevio = new Map<
      string,
      { iva: number; total_neto: number | null; es_fiscal: boolean }
    >()
    for (const r of (previos ?? []) as { fudo_id: string; iva: number | null; total_neto: number | null; es_fiscal: boolean | null }[]) {
      const tieneDato = (Number(r.iva ?? 0) > 0) || r.es_fiscal === true || r.total_neto !== null
      if (tieneDato) {
        fiscalPrevio.set(r.fudo_id, {
          iva: Number(r.iva ?? 0),
          total_neto: r.total_neto,
          es_fiscal: !!r.es_fiscal,
        })
      }
    }

    for (const { sale, payments, discounts, items } of tickets) {
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

      // Si el ticket ya tenía datos fiscales (cargado vía Excel), respetarlos
      const previo = fiscalPrevio.get(sale.id)
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
        total_neto: previo?.total_neto ?? null,
        iva: previo?.iva ?? 0,
        es_fiscal: previo?.es_fiscal ?? false,
        es_dividendo: esDividendoCompleto,
        periodo,
      })

      // Persistir items del ticket en ventas_items (necesario para Menu Engineering
      // y Price Engineering). Cada Item tiene attributes.price (total del line item,
      // ya con quantity aplicada) y attributes.quantity. El Product asociado nos da
      // codigo + nombre + categoría (vía productCategory).
      for (const it of items) {
        const prRel = it.relationships?.product?.data
        const productId = prRel && !Array.isArray(prRel) ? prRel.id : null
        const prod = productId ? productoById.get(productId) : null
        const codigo = prod?.code ?? ''
        const nombre = prod?.name ?? ''
        const categoria = prod?.categoryId ? catNombre.get(prod.categoryId) ?? null : null
        const cantidad = Number(it.attributes.quantity ?? 0)
        const totalItem = Number(it.attributes.price ?? 0)
        // Saltar items sin nombre y sin código (no aportan info útil)
        if (!nombre && !codigo) continue
        ventasItemsRows.push({
          local,
          periodo,
          codigo,
          nombre,
          categoria,
          subcategoria: null,
          cantidad,
          total: totalItem,
        })
      }

      // Acumular descuentos del ticket en el periodo.
      // Fudo guarda el discount con percentage pero amount=0 cuando es % sobre la venta,
      // así que el monto real lo calculamos como (subtotal de items) - (total post-descuento).
      // OJO: Item.price ya viene con quantity aplicada (es el total del line item),
      // NO multiplicar por quantity — eso infla el subtotal varias veces.
      // Si el ticket tiene algún discount al 100% → cortesía completa; sino → otros descuentos.
      if (discounts.length > 0) {
        let subtotal = 0
        for (const it of items) {
          subtotal += Number(it.attributes.price ?? 0)
        }
        const descuentoVenta = subtotal - total
        if (descuentoVenta > 0.01) {
          if (!descPorMes[periodo]) descPorMes[periodo] = { cortesias_monto: 0, cortesias_cant: 0, otros_descuentos: 0 }
          const tieneCortesia = discounts.some((d) => Number(d.attributes.percentage) === 100)
          if (tieneCortesia) {
            descPorMes[periodo].cortesias_monto += descuentoVenta
            descPorMes[periodo].cortesias_cant += 1
          } else {
            descPorMes[periodo].otros_descuentos += descuentoVenta
          }
        }
      }
    }

    // Reemplazar datos del año/local — borra todo y reinserta. Los campos
    // fiscales ya fueron preservados arriba via fiscalPrevio y mergeados en
    // ticketsRows, así que borrar acá no pierde nada.
    await supabase.from('ventas_tickets').delete().eq('local', local).in('periodo', meses)
    await supabase.from('ventas_pagos').delete().eq('local', local).in('periodo', meses)
    await supabase.from('ventas_items').delete().eq('local', local).in('periodo', meses)
    await supabase
      .from('dividendos')
      .delete()
      .eq('local', local)
      .in('periodo', meses)
      .eq('creado_por', 'import_fudo')

    const errores: string[] = []

    // Helper para marcar progreso intermedio en el log. Si la función se mata
    // (timeout) podemos ver hasta qué punto llegó. No bloquea si falla.
    async function marcarProgreso(msg: string) {
      if (!runId) return
      try {
        await supabase
          .from('fudo_sync_runs')
          .update({ error_msg: msg })
          .eq('id', runId)
      } catch (_) { /* ignorar */ }
    }

    // Insertar en chunks de 2000 + hasta 3 chunks en paralelo. Antes hacía
    // chunks de 1000 secuenciales (~106 chunks × 300ms = 32s sólo en inserts).
    // Con 2000 + concurrencia 3 baja a ~5-7s por tabla grande.
    async function insertChunk<T>(table: string, rows: T[]) {
      const CHUNK = 2000
      const CONCURRENCY = 3
      const slices: T[][] = []
      for (let i = 0; i < rows.length; i += CHUNK) slices.push(rows.slice(i, i + CHUNK))
      for (let i = 0; i < slices.length; i += CONCURRENCY) {
        const batch = slices.slice(i, i + CONCURRENCY)
        const results = await Promise.all(
          batch.map((slice) => supabase.from(table).insert(slice)),
        )
        results.forEach((r, j) => {
          if (r.error) errores.push(`${table} batch ${i + j}: ${r.error.message}`)
        })
      }
    }

    if (ticketsRows.length) {
      await insertChunk('ventas_tickets', ticketsRows)
      await marcarProgreso(`Insertados ${ticketsRows.length} tickets`)
    }
    if (pagosRows.length) {
      await insertChunk('ventas_pagos', pagosRows)
      await marcarProgreso(`Insertados ${pagosRows.length} pagos`)
    }
    if (ventasItemsRows.length) {
      await insertChunk('ventas_items', ventasItemsRows)
      await marcarProgreso(`Insertados ${ventasItemsRows.length} items`)
    }
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

    // Cerrar el log con resultado final.
    if (runId) {
      await supabase
        .from('fudo_sync_runs')
        .update({
          finished_at: new Date().toISOString(),
          status: errores.length === 0 ? 'ok' : 'error',
          tickets_importados: ticketsRows.length,
          dividendos_importados: dividendosRows.length,
          errores: errores,
          error_msg: errores.length > 0 ? errores[0] : null,
        })
        .eq('id', runId)
    }

    return new Response(
      JSON.stringify({
        ok: errores.length === 0,
        data: {
          local,
          anio,
          ticketsImportados: ticketsRows.length,
          pagosImportados: pagosRows.length,
          itemsImportados: ventasItemsRows.length,
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
    const msg = (e as Error).message
    if (runId) {
      await supabase
        .from('fudo_sync_runs')
        .update({
          finished_at: new Date().toISOString(),
          status: 'error',
          error_msg: msg,
        })
        .eq('id', runId)
    }
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
