// Edge Function TEMPORAL: diag-anthropic
// Diagnostico puntual (1-sep-2026): el OCR falla con "credit balance is too low"
// aunque Lucas cargo creditos. Sirve para saber a QUE organizacion de Anthropic
// pertenece la clave guardada en los secrets del proyecto, y si ve saldo.
//
// NO expone la clave: solo devuelve un prefijo enmascarado para poder
// identificarla visualmente en el panel de Anthropic.
//
// BORRAR una vez resuelto:  supabase functions delete diag-anthropic

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

// Cabeceras que identifican la cuenta y el estado de los limites.
const CABECERAS_INTERES = [
  'anthropic-organization-id',
  'request-id',
  'anthropic-ratelimit-requests-limit',
  'anthropic-ratelimit-requests-remaining',
  'anthropic-ratelimit-input-tokens-limit',
  'anthropic-ratelimit-input-tokens-remaining',
  'retry-after',
];

function extraerCabeceras(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const nombre of CABECERAS_INTERES) {
    const valor = res.headers.get(nombre);
    if (valor) out[nombre] = valor;
  }
  return out;
}

// "sk-ant-api03-AbCdEf...XyZ9" -> "sk-ant-api03-AbCd…XyZ9" (nunca la clave entera)
function enmascarar(clave: string): string {
  if (clave.length <= 20) return `${clave.slice(0, 4)}…(${clave.length} chars)`;
  return `${clave.slice(0, 16)}…${clave.slice(-4)} (${clave.length} chars)`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body, null, 2), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return json({ ok: false, error: 'ANTHROPIC_API_KEY no esta configurado en los secrets' }, 200);
    }

    const headersAnthropic = {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    };

    // 1) /v1/models: NO consume creditos. Valida la clave y revela la organizacion.
    //    Si esto anda pero /v1/messages falla por saldo => la clave es valida,
    //    el problema es de donde esta la plata (otra org / tope de workspace).
    const resModelos = await fetch('https://api.anthropic.com/v1/models?limit=1', {
      headers: headersAnthropic,
    });
    const bodyModelos = await resModelos.text();

    // 2) /v1/messages minimo: 1 token de salida. Es la prueba real de saldo.
    const resMensaje = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: headersAnthropic,
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hola' }],
      }),
    });
    const bodyMensaje = await resMensaje.text();

    return json({
      ok: true,
      clave_enmascarada: enmascarar(apiKey),
      // Prueba 1 — no gasta saldo
      modelos: {
        status: resModelos.status,
        cabeceras: extraerCabeceras(resModelos),
        body: bodyModelos.slice(0, 600),
      },
      // Prueba 2 — esta es la que revela el problema de saldo
      mensaje: {
        status: resMensaje.status,
        cabeceras: extraerCabeceras(resMensaje),
        body: bodyMensaje.slice(0, 600),
      },
    });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 200);
  }
});
