// Edge Function: sync-mp-release-trigger
// Solicita a MP la generacion de un Released Money Report y registra la fila
// en mp_release_reports con status=pending. NO espera el procesamiento.
// El processor (sync-mp-release-process) corre por pg_cron y descarga cuando esta listo.
//
// Body: { desde: 'YYYY-MM-DD', hasta: 'YYYY-MM-DD' }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MP_API = 'https://api.mercadopago.com';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const token = Deno.env.get('MP_ACCESS_TOKEN');
    if (!token) throw new Error('MP_ACCESS_TOKEN no configurado');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const body = await req.json().catch(() => ({}));
    const desde: string = body.desde;
    const hasta: string = body.hasta;
    if (!desde || !hasta || !/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
      throw new Error('desde/hasta requeridos en formato YYYY-MM-DD');
    }
    if (desde > hasta) throw new Error('desde no puede ser posterior a hasta');

    // Verificar si ya hay un pending/processing para el mismo rango.
    // Evita duplicar pedidos si el usuario hace doble click.
    const { data: existente } = await supabase
      .from('mp_release_reports')
      .select('id, status, created_at')
      .eq('begin_date', desde)
      .eq('end_date', hasta)
      .in('status', ['pending', 'processing'])
      .maybeSingle();

    if (existente) {
      return new Response(
        JSON.stringify({
          ok: true,
          ya_existe: true,
          report_id: existente.id,
          status: existente.status,
          mensaje: 'Ya hay un reporte en proceso para ese rango. Espera a que termine.',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // POST a MP. begin_date/end_date en UTC. MP los normaliza a -3 internamente.
    const beginIso = `${desde}T00:00:00Z`;
    const endIso = `${hasta}T23:59:59Z`;

    const createRes = await fetch(`${MP_API}/v1/account/release_report`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ begin_date: beginIso, end_date: endIso }),
    });
    const createBody = await createRes.text();
    if (!createRes.ok && createRes.status !== 202) {
      throw new Error(`MP POST status=${createRes.status}: ${createBody.slice(0, 300)}`);
    }

    let mpPostId: number | null = null;
    try {
      const parsed = JSON.parse(createBody);
      mpPostId = parsed.id ?? null;
    } catch {
      // ignorar
    }

    // Insertar registro pending
    const { data: inserted, error: insErr } = await supabase
      .from('mp_release_reports')
      .insert({
        begin_date: desde,
        end_date: hasta,
        status: 'pending',
        mp_post_id: mpPostId,
      })
      .select('id')
      .single();

    if (insErr) throw new Error(`No se pudo registrar el job: ${insErr.message}`);

    return new Response(
      JSON.stringify({
        ok: true,
        report_id: inserted.id,
        mp_post_id: mpPostId,
        rango: { desde, hasta },
        mensaje:
          'Reporte solicitado a MercadoPago. Tarda 5-10 minutos en estar listo. Se procesa automaticamente.',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
