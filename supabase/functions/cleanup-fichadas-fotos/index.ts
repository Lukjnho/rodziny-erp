// Edge Function: cleanup-fichadas-fotos
// Borra las fotos de fichadas con más de DIAS_RETENCION días.
// El registro de la fichada se conserva — solo se borra el archivo del bucket
// y se setea foto_path = null.
//
// Invocación:
//   - Manual: desde Asistencia tab (botón oculto)
//   - Automática: pg_cron diario a las 03:00 AR (06:00 UTC)
//
// Devuelve: { ok, borradas, errores, total_candidatas }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DIAS_RETENCION = 30
const BATCH_LIMIT = 500
const BUCKET = 'fichadas-fotos'

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
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // 1) Buscar fichadas con foto vencida
    const corte = new Date()
    corte.setDate(corte.getDate() - DIAS_RETENCION)
    const fechaCorte = corte.toISOString().slice(0, 10) // YYYY-MM-DD

    const { data: candidatas, error: selErr } = await supabase
      .from('fichadas')
      .select('id, foto_path')
      .not('foto_path', 'is', null)
      .lt('fecha', fechaCorte)
      .limit(BATCH_LIMIT)

    if (selErr) throw selErr
    if (!candidatas || candidatas.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, borradas: 0, errores: [], total_candidatas: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // 2) Borrar archivos del Storage (en un solo batch)
    const paths = candidatas.map((c) => c.foto_path).filter((p): p is string => !!p)
    const errores: string[] = []
    let borradas = 0

    const { data: removed, error: rmErr } = await supabase.storage.from(BUCKET).remove(paths)
    if (rmErr) {
      errores.push(`Storage remove: ${rmErr.message}`)
    } else {
      borradas = removed?.length ?? 0
    }

    // 3) Setear foto_path = null en las filas afectadas (incluso si Storage falló parcialmente,
    //    así no reintenta indefinidamente archivos huérfanos)
    const ids = candidatas.map((c) => c.id)
    const { error: upErr } = await supabase
      .from('fichadas')
      .update({ foto_path: null })
      .in('id', ids)

    if (upErr) errores.push(`Update fichadas: ${upErr.message}`)

    return new Response(
      JSON.stringify({
        ok: errores.length === 0,
        borradas,
        errores,
        total_candidatas: candidatas.length,
        fecha_corte: fechaCorte,
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
