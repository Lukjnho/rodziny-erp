// Edge Function: sync-mercadopago
// Sincroniza pagos de MercadoPago con la tabla pagos_mp.
// Recibe { periodo: "YYYY-MM" } y trae todos los pagos aprobados de ese mes.
//
// El Access Token de MP se guarda como secret de Supabase:
//   supabase secrets set MP_ACCESS_TOKEN=APP_USR-...
//
// Invocacion desde el front:
//   supabase.functions.invoke('sync-mercadopago', { body: { periodo: '2026-04' } })

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const MP_API = 'https://api.mercadopago.com'
const PAGE_SIZE = 100  // maximo permitido por MP
const MAX_OFFSET = 10000  // limite de paginacion de MP

// Mapeo de POS/Store a local
// Ambos locales cobran con la misma cuenta de MP.
// Cuando Saavedra registre su Point como POS en MP, agregar su pos_id aquí.
const POS_LOCAL: Record<number, string> = {
  49059804: 'vedia',      // Caja PASTAS Rodziny (Point Vedia)
  53445396: 'vedia',      // Caja BEBIDAS (Point Vedia)
  111535446: 'vedia',     // CAJA BEBIDAS (Point Vedia)
  130672894: 'saavedra',  // Caja singluten (Point Saavedra - S/N N950NCBA01599737)
}

const STORE_LOCAL: Record<number, string> = {
  47836888: 'vedia',      // Local Central - Vedia 152
  81239526: 'saavedra',   // Local Saavedra - Saavedra 286
}

function resolverLocal(storeId: number | null, posId: number | null): string {
  if (posId && POS_LOCAL[posId]) return POS_LOCAL[posId]
  if (storeId && STORE_LOCAL[storeId]) return STORE_LOCAL[storeId]
  // Pagos sin POS (transferencias, QR sin point) → ambos locales
  return 'ambos'
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const mpToken = Deno.env.get('MP_ACCESS_TOKEN')
    if (!mpToken) throw new Error('MP_ACCESS_TOKEN no configurado como secret')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // Leer periodo del body
    const body = await req.json().catch(() => ({}))
    const periodo: string = body.periodo // 'YYYY-MM'
    if (!periodo || !/^\d{4}-\d{2}$/.test(periodo)) {
      throw new Error('Falta "periodo" en formato YYYY-MM')
    }

    // Calcular rango de fechas del mes (timezone Argentina -03:00)
    const [year, month] = periodo.split('-').map(Number)
    const beginDate = `${periodo}-01T00:00:00.000-03:00`
    // Ultimo dia del mes
    const lastDay = new Date(year, month, 0).getDate()
    const endDate = `${periodo}-${String(lastDay).padStart(2, '0')}T23:59:59.999-03:00`

    // Paginar resultados de MP
    const allPayments: any[] = []
    let offset = 0
    let totalFromApi = 0

    while (offset < MAX_OFFSET) {
      const url = new URL(`${MP_API}/v1/payments/search`)
      url.searchParams.set('sort', 'date_created')
      url.searchParams.set('criteria', 'asc')
      url.searchParams.set('range', 'date_created')
      url.searchParams.set('begin_date', beginDate)
      url.searchParams.set('end_date', endDate)
      url.searchParams.set('status', 'approved')
      url.searchParams.set('limit', String(PAGE_SIZE))
      url.searchParams.set('offset', String(offset))

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${mpToken}` },
      })

      if (!res.ok) {
        const errText = await res.text()
        throw new Error(`MP API ${res.status}: ${errText}`)
      }

      const data = await res.json()
      totalFromApi = data.paging?.total ?? 0
      const results = data.results ?? []

      allPayments.push(...results)

      // Si ya trajimos todos o no hay mas resultados, salir
      if (results.length < PAGE_SIZE || allPayments.length >= totalFromApi) break
      offset += PAGE_SIZE
    }

    // Transformar pagos al formato de la tabla
    const rows = allPayments.map((p: any) => {
      const td = p.transaction_details ?? {}
      const fees = p.fee_details ?? []
      const comision = fees.reduce((s: number, f: any) => s + (f.amount ?? 0), 0)
      const taxes = p.taxes_amount ?? 0

      return {
        id: p.id,
        fecha: p.date_created,
        fecha_aprobado: p.date_approved,
        monto: p.transaction_amount,
        monto_neto: td.net_received_amount ?? p.transaction_amount,
        comision_mp: comision,
        impuestos: taxes,
        medio_pago: p.payment_type_id,    // account_money, credit_card, bank_transfer, debit_card
        metodo_pago: p.payment_method_id, // visa, master, etc
        estado: p.status,
        descripcion: p.description ?? '',
        store_id: p.store_id ?? null,
        pos_id: p.pos_id ?? null,
        local: resolverLocal(p.store_id, p.pos_id),
        periodo,
        referencia_externa: p.external_reference ?? null,
        sincronizado_at: new Date().toISOString(),
      }
    })

    // Deduplicar por id (MP puede devolver el mismo pago en páginas solapadas)
    const uniqueMap = new Map<number, typeof rows[0]>()
    for (const r of rows) uniqueMap.set(r.id, r)
    const uniqueRows = [...uniqueMap.values()]

    // Upsert en batches de 500 (limite de Supabase)
    let insertados = 0
    let errores: string[] = []
    const BATCH = 500

    for (let i = 0; i < uniqueRows.length; i += BATCH) {
      const batch = uniqueRows.slice(i, i + BATCH)
      const { error } = await supabase
        .from('pagos_mp')
        .upsert(batch, { onConflict: 'id' })

      if (error) {
        errores.push(`Batch ${i}-${i + batch.length}: ${error.message}`)
      } else {
        insertados += batch.length
      }
    }

    return new Response(
      JSON.stringify({
        ok: errores.length === 0,
        periodo,
        total_api: totalFromApi,
        unicos: uniqueRows.length,
        sincronizados: insertados,
        errores,
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
