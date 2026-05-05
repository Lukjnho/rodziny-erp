// Edge Function: sync-mp-release-process
// Procesa los reportes de mp_release_reports con status=pending o processing.
// Para cada uno:
//   1. GET /v1/account/release_report/list -> busca matching por begin_date/end_date
//   2. Si no esta listo, deja en pending (con poll_intentos++)
//   3. Si esta listo, descarga CSV, parsea, inserta movimientos_bancarios (opcion B)
//   4. Marca status=done con stats
//
// Body opcional: { force_id?: uuid } -> procesar solo ese registro.
// Sin body: procesa todos los pendientes (tope 5 por corrida).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MP_API = 'https://api.mercadopago.com';
const MAX_POR_CORRIDA = 5;
const MAX_INTENTOS_ANTES_TIMEOUT = 30; // 30 corridas x 5min = 2:30hs

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface ReleaseListItem {
  id: number;
  file_name: string;
  status: string;
  format: string;
  begin_date: string;
  end_date: string;
  date_created: string;
}

async function fetchReleaseList(token: string): Promise<ReleaseListItem[]> {
  const res = await fetch(`${MP_API}/v1/account/release_report/list`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`LIST status=${res.status}: ${await res.text()}`);
  const json = await res.json();
  return Array.isArray(json) ? json : (json.results ?? []);
}

// Procesa un job individual. Retorna stats.
async function procesarJob(
  supabase: any,
  token: string,
  job: { id: string; begin_date: string; end_date: string; created_at: string; poll_intentos: number },
) {
  const { id: jobId, begin_date, end_date, created_at, poll_intentos } = job;

  // 1. Buscar el reporte en /list. MP convierte begin_date a UTC restando 3hs:
  //    nuestro 2026-05-01 -> "2026-04-30T03:00:00Z" en MP.
  // Estrategia robusta: buscar reportes creados despues de created_at de nuestro job,
  // formato CSV, status enabled, y cuyo rango cubra nuestro begin_date/end_date.
  const lista = await fetchReleaseList(token);

  const jobCreatedTime = new Date(created_at).getTime();
  // Margen: 5 min antes del created_at (por si MP usa otra timezone)
  const corteMin = jobCreatedTime - 5 * 60 * 1000;

  const candidatos = lista.filter((r) => {
    if (r.format !== 'CSV') return false;
    if ((r.status ?? '').toLowerCase() !== 'enabled') return false;
    const dc = new Date(r.date_created).getTime();
    if (dc < corteMin) return false;

    // Validar que el rango de MP cubra exactamente nuestro pedido.
    // MP convierte begin_date a "<dia anterior>T03:00:00Z" y end_date a "<dia siguiente>T02:59:59Z".
    const beginR = (r.begin_date ?? '').slice(0, 10);
    const endR = (r.end_date ?? '').slice(0, 10);
    // Calcular dia anterior de begin_date:
    const beginEsperado = new Date(begin_date + 'T12:00:00Z');
    beginEsperado.setUTCDate(beginEsperado.getUTCDate() - 1);
    const endEsperado = new Date(end_date + 'T12:00:00Z');
    endEsperado.setUTCDate(endEsperado.getUTCDate() + 1);

    return beginR === beginEsperado.toISOString().slice(0, 10) && endR === endEsperado.toISOString().slice(0, 10);
  });

  // Tomar el mas reciente
  candidatos.sort((a, b) => new Date(b.date_created).getTime() - new Date(a.date_created).getTime());
  const reporte = candidatos[0];

  if (!reporte) {
    // No esta listo todavia. Aumentar contador.
    const nuevoIntento = poll_intentos + 1;
    if (nuevoIntento >= MAX_INTENTOS_ANTES_TIMEOUT) {
      await supabase
        .from('mp_release_reports')
        .update({
          status: 'timeout',
          poll_intentos: nuevoIntento,
          error_msg: `MP no genero el reporte tras ${nuevoIntento} intentos`,
          processed_at: new Date().toISOString(),
        })
        .eq('id', jobId);
      return { jobId, action: 'timeout' };
    }
    await supabase
      .from('mp_release_reports')
      .update({ poll_intentos: nuevoIntento })
      .eq('id', jobId);
    return { jobId, action: 'still_pending', intentos: nuevoIntento };
  }

  // 2. Marcar como processing y guardar metadata
  await supabase
    .from('mp_release_reports')
    .update({
      status: 'processing',
      mp_list_id: reporte.id,
      file_name: reporte.file_name,
    })
    .eq('id', jobId);

  // 3. Descargar CSV
  const dlRes = await fetch(`${MP_API}/v1/account/release_report/${reporte.file_name}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!dlRes.ok) {
    const err = await dlRes.text();
    await supabase
      .from('mp_release_reports')
      .update({
        status: 'error',
        error_msg: `Download status=${dlRes.status}: ${err.slice(0, 300)}`,
        processed_at: new Date().toISOString(),
      })
      .eq('id', jobId);
    return { jobId, action: 'error_download' };
  }

  const csvRaw = await dlRes.text();
  const lineas = csvRaw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const headerLine = lineas[0] ?? '';
  const sep = headerLine.includes(';') ? ';' : ',';
  const headers = headerLine.split(sep).map((h) => h.trim());

  const idx = (name: string) => headers.findIndex((h) => h.toUpperCase() === name);
  const iDate = idx('DATE');
  const iSourceId = idx('SOURCE_ID');
  const iDescription = idx('DESCRIPTION');
  const iNetCredit = idx('NET_CREDIT_AMOUNT');
  const iNetDebit = idx('NET_DEBIT_AMOUNT');
  const iGross = idx('GROSS_AMOUNT');
  const iMpFee = idx('MP_FEE_AMOUNT');
  const iTaxes = idx('TAXES_AMOUNT');
  const iPaymentMethod = idx('PAYMENT_METHOD');

  if (iDate < 0 || iSourceId < 0 || iDescription < 0 || iNetCredit < 0 || iNetDebit < 0) {
    await supabase
      .from('mp_release_reports')
      .update({
        status: 'error',
        error_msg: `CSV invalido. Headers: ${headers.join('|')}`,
        processed_at: new Date().toISOString(),
      })
      .eq('id', jobId);
    return { jobId, action: 'error_headers' };
  }

  // 4. Procesar filas (opcion B: solo egresos + cargos de cobros)
  const movimientos: any[] = [];
  let filasIgnoradas = 0;
  let payouts = 0;
  let cargos = 0;

  for (let i = 1; i < lineas.length; i++) {
    const fila = lineas[i].split(sep);
    const dateRaw = fila[iDate] ?? '';
    const sourceId = (fila[iSourceId] ?? '').trim();
    const desc = (fila[iDescription] ?? '').trim().toLowerCase();
    const netCredit = Number(fila[iNetCredit] ?? '0');
    const netDebit = Number(fila[iNetDebit] ?? '0');
    const mpFee = Math.abs(Number(fila[iMpFee] ?? '0'));
    const taxes = Math.abs(Number(fila[iTaxes] ?? '0'));
    const paymentMethod = (fila[iPaymentMethod] ?? '').trim();

    // Fecha en formato YYYY-MM-DD desde "2026-04-30T08:24:05.000-03:00"
    const fecha = dateRaw.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      filasIgnoradas++;
      continue;
    }
    const periodo = fecha.slice(0, 7);

    if (desc === 'payout') {
      // Egreso real (transferencia saliente)
      if (netDebit > 0 && sourceId) {
        movimientos.push({
          cuenta: 'mercadopago',
          fecha,
          descripcion: `Transferencia saliente${paymentMethod ? ` (${paymentMethod})` : ''}`,
          debito: netDebit,
          credito: 0,
          saldo: null,
          referencia: sourceId,
          periodo,
          fuente: 'api_mp_release',
          tipo: null, // sin clasificar -> Lucas vincula
        });
        payouts++;

        // El payout puede traer su propio impuesto/comision en la misma fila
        if (taxes > 0) {
          movimientos.push({
            cuenta: 'mercadopago',
            fecha,
            descripcion: `[Cargo MP] Impuesto al debito por payout`,
            debito: taxes,
            credito: 0,
            saldo: null,
            referencia: `${sourceId}_payout_tax`,
            periodo,
            fuente: 'api_mp_release_charge',
            tipo: 'cargo_mp',
            sugerencia: 'Impuesto al debito (Ley 25.413)',
          });
          cargos++;
        }
        if (mpFee > 0) {
          movimientos.push({
            cuenta: 'mercadopago',
            fecha,
            descripcion: `[Cargo MP] Comision por payout`,
            debito: mpFee,
            credito: 0,
            saldo: null,
            referencia: `${sourceId}_payout_fee`,
            periodo,
            fuente: 'api_mp_release_charge',
            tipo: 'cargo_mp',
            sugerencia: 'Comision MP por transferencia',
          });
          cargos++;
        }
      }
    } else if (desc === 'payment') {
      // Cobro recibido. Ignoramos el ingreso, pero registramos los cargos asociados.
      if (sourceId && taxes > 0) {
        movimientos.push({
          cuenta: 'mercadopago',
          fecha,
          descripcion: `[Cargo MP] Impuesto al debito por cobro`,
          debito: taxes,
          credito: 0,
          saldo: null,
          referencia: `${sourceId}_cobro_tax`,
          periodo,
          fuente: 'api_mp_release_charge',
          tipo: 'cargo_mp',
          sugerencia: 'Impuesto al debito (Ley 25.413)',
        });
        cargos++;
      }
      if (sourceId && mpFee > 0) {
        movimientos.push({
          cuenta: 'mercadopago',
          fecha,
          descripcion: `[Cargo MP] Comision por cobro${paymentMethod ? ` (${paymentMethod})` : ''}`,
          debito: mpFee,
          credito: 0,
          saldo: null,
          referencia: `${sourceId}_cobro_fee`,
          periodo,
          fuente: 'api_mp_release_charge',
          tipo: 'cargo_mp',
          sugerencia: `Comision MP - ${paymentMethod || 'pago'}`,
        });
        cargos++;
      }
      filasIgnoradas++; // el ingreso en si lo ignoramos
    } else {
      // reserve_for_payout, reserve_for_payment, asset_management, vacios -> ignorar
      filasIgnoradas++;
    }
  }

  // 5. Insertar en batches (idempotente por unique cuenta+fecha+referencia+debito+credito)
  let insertados = 0;
  let erroresInsert: string[] = [];
  const BATCH = 200;
  for (let i = 0; i < movimientos.length; i += BATCH) {
    const batch = movimientos.slice(i, i + BATCH);
    const { data: ins, error } = await supabase
      .from('movimientos_bancarios')
      .upsert(batch, {
        onConflict: 'cuenta,fecha,referencia,debito,credito',
        ignoreDuplicates: true,
      })
      .select('id');
    if (error) {
      erroresInsert.push(`Batch ${i}: ${error.message}`);
    } else {
      insertados += ins?.length ?? 0;
    }
  }

  // 6. Marcar done
  await supabase
    .from('mp_release_reports')
    .update({
      status: erroresInsert.length === 0 ? 'done' : 'error',
      payouts_insertados: payouts,
      cargos_insertados: cargos,
      filas_csv: lineas.length - 1,
      filas_ignoradas: filasIgnoradas,
      error_msg: erroresInsert.length > 0 ? erroresInsert.join(' | ') : null,
      processed_at: new Date().toISOString(),
    })
    .eq('id', jobId);

  return {
    jobId,
    action: 'processed',
    payouts,
    cargos,
    insertados,
    filas_csv: lineas.length - 1,
    filas_ignoradas: filasIgnoradas,
  };
}

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
    const forceId: string | undefined = body.force_id;

    // Obtener jobs pendientes
    let q = supabase
      .from('mp_release_reports')
      .select('id, begin_date, end_date, created_at, poll_intentos, status')
      .order('created_at', { ascending: true });

    if (forceId) {
      q = q.eq('id', forceId);
    } else {
      q = q.in('status', ['pending', 'processing']).limit(MAX_POR_CORRIDA);
    }

    const { data: jobs, error: jobsErr } = await q;
    if (jobsErr) throw new Error(`Query jobs: ${jobsErr.message}`);

    if (!jobs || jobs.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, mensaje: 'sin trabajos pendientes', procesados: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const resultados: any[] = [];
    for (const job of jobs) {
      try {
        const r = await procesarJob(supabase, token, job);
        resultados.push(r);
      } catch (e) {
        await supabase
          .from('mp_release_reports')
          .update({
            status: 'error',
            error_msg: (e as Error).message.slice(0, 500),
            processed_at: new Date().toISOString(),
          })
          .eq('id', job.id);
        resultados.push({ jobId: job.id, action: 'error', error: (e as Error).message });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, procesados: resultados.length, resultados }, null, 2),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
