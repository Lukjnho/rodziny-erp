// Edge Function: ocr-comprobante
// Recibe un comprobante_id, descarga el archivo de Storage, lo manda a Claude API
// con vision, parsea el JSON estructurado y actualiza la fila en `comprobantes`.
// Tambien busca duplicados por n_operacion exacto + match difuso por (monto, fecha, cuit).
//
// Body: { comprobante_id: uuid }
// Response: { ok: true, ocr_extraido: {...}, duplicados: [...] } | { ok: false, error: string }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const STORAGE_BUCKET = 'gastos-comprobantes';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const OCR_PROMPT = `Sos un sistema de extraccion de datos de comprobantes argentinos (transferencias bancarias, facturas A/B/C, tickets, vouchers de tarjeta) para una empresa llamada Rodziny S.A.S. / Rodziny Pastas / Rodziny Sin Gluten (CUIT 30-71735236-6).

CONTEXTO CRITICO: el comprobante refleja un PAGO que hizo Rodziny a un proveedor/tercero. Tu trabajo es identificar al PROVEEDOR (= quien RECIBE el dinero), nunca al emisor (Rodziny).

Analiza el archivo y devolve UNICAMENTE un JSON estricto con esta estructura, sin markdown ni explicaciones:

{
  "tipo_comprobante": "transferencia_bancaria" | "factura" | "ticket" | "voucher_tarjeta" | "otro",
  "proveedor_nombre": string | null,
  "proveedor_cuit": string | null,
  "monto": number | null,
  "fecha": string | null,
  "fecha_pago_cheque": string | null,
  "hora": string | null,
  "n_operacion": string | null,
  "medio_pago": "transferencia" | "tarjeta_credito" | "tarjeta_debito" | "efectivo" | "cheque" | "qr" | "otro" | null,
  "banco_origen": string | null,
  "banco_destino": string | null,
  "cbu_destino": string | null,
  "alias_destino": string | null,
  "concepto": string | null,
  "es_transferencia_interna": boolean,
  "confianza": number
}

REGLAS — leer con atencion:

1. PROVEEDOR (campos proveedor_nombre y proveedor_cuit):
   - En TRANSFERENCIAS BANCARIAS: es el DESTINATARIO del dinero (campo "Para", "Destino", "Beneficiario"). NUNCA el "De" / "Origen" / "Emisor".
   - En FACTURAS A/B/C: es quien EMITE la factura (la empresa que vendio).
   - En TICKETS: es el comercio que cobro.
   - Si el destinatario es Rodziny S.A.S. (CUIT 30-71735236-6) o Rodziny Pastas / Rodziny Sin Gluten, NO es un proveedor — es transferencia interna (ver regla 2).

2. ES_TRANSFERENCIA_INTERNA:
   - true: si origen y destino son ambos Rodziny (ej: de cuenta MP de Rodziny a cuenta Galicia de Rodziny). En ese caso NO hay proveedor — devolver proveedor_nombre y proveedor_cuit como null.
   - false: pago a un tercero (lo normal). Extraer proveedor del receptor.

3. monto: total final pagado, sin signo de pesos ni separadores.

4. n_operacion CRITICO:
   - En TRANSFERENCIAS/tickets/vouchers: buscar "N° operacion", "Numero de operacion", "Op.", "Autorizacion", "Ref.", "Comprobante N°", "transfer_id".
   - En CHEQUES/ECHEQ: usar SIEMPRE el "N° de cheque" / "Numero de cheque" (el numero corto, ej "00000142"). NUNCA usar el "ID del cheque" (alfanumerico largo, ej "V8794WK4EVDNPEY"), ni el "ID Multicheque", ni el "CMC7". Si ves ambos, devolve el "N° de cheque".

5. fecha en formato YYYY-MM-DD. En cheques/ECHEQ es la "Fecha de emision"; en transferencias/tickets es la fecha de la operacion.

5b. fecha_pago_cheque: SOLO para cheques/ECHEQ. Es la "Fecha de pago" del cheque = la fecha de DEBITO FUTURO en que se cobra/debita (distinta de la "Fecha de emision"). Formato YYYY-MM-DD. Para transferencias, tickets, facturas y vouchers: devolver null.

6. proveedor_cuit: solo digitos (sin guiones, formato XXXXXXXXXXX) o formato XX-XXXXXXXX-X. Verificar que NO sea 30717352366 (CUIT de Rodziny) — si lo es, ignorar y buscar el otro CUIT del documento.

7. confianza: entre 0 y 1, reflejar honestamente la calidad de la extraccion.

8. SALIDA: devolve EXCLUSIVAMENTE el objeto JSON. NO uses markdown (nada de \`\`\`), NO agregues notas, aclaraciones ni texto antes ni despues del JSON. Si falta informacion, reflejalo en los campos null y en confianza baja, NUNCA en texto adicional.`;

interface ComprobanteRow {
  id: string;
  file_path: string;
  mime_type: string | null;
  ocr_status: string;
}

interface OcrExtraido {
  tipo_comprobante: string | null;
  proveedor_nombre: string | null;
  proveedor_cuit: string | null;
  monto: number | null;
  fecha: string | null;
  fecha_pago_cheque: string | null;
  hora: string | null;
  n_operacion: string | null;
  medio_pago: string | null;
  banco_origen: string | null;
  banco_destino: string | null;
  cbu_destino: string | null;
  alias_destino: string | null;
  concepto: string | null;
  es_transferencia_interna: boolean;
  confianza: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY no configurado');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const body = await req.json().catch(() => ({}));
    const comprobanteId: string = body.comprobante_id;
    if (!comprobanteId) throw new Error('comprobante_id requerido');

    // 1. Leer la fila
    const { data: comp, error: compErr } = await supabase
      .from('comprobantes')
      .select('id, file_path, mime_type, ocr_status')
      .eq('id', comprobanteId)
      .single();

    if (compErr || !comp) throw new Error(`Comprobante no encontrado: ${compErr?.message ?? 'null'}`);
    const comprobante = comp as ComprobanteRow;

    if (comprobante.ocr_status === 'completed') {
      return new Response(
        JSON.stringify({ ok: true, ya_procesado: true, comprobante_id: comprobanteId }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Marcar como processing
    await supabase
      .from('comprobantes')
      .update({ ocr_status: 'processing' })
      .eq('id', comprobanteId);

    // 2. Descargar el archivo de Storage
    const { data: fileBlob, error: dlErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .download(comprobante.file_path);

    if (dlErr || !fileBlob) {
      await supabase
        .from('comprobantes')
        .update({ ocr_status: 'failed', ocr_raw: { error: dlErr?.message ?? 'no blob' } })
        .eq('id', comprobanteId);
      throw new Error(`No se pudo descargar el archivo: ${dlErr?.message}`);
    }

    const arrayBuffer = await fileBlob.arrayBuffer();
    const base64 = base64FromArrayBuffer(arrayBuffer);

    const mediaType = normalizeMediaType(comprobante.mime_type ?? fileBlob.type);
    const sourceType = mediaType === 'application/pdf' ? 'document' : 'image';

    // 3. Llamar a Claude API
    const claudeRes = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            {
              type: sourceType,
              source: { type: 'base64', media_type: mediaType, data: base64 },
            },
            { type: 'text', text: OCR_PROMPT },
          ],
        }],
      }),
    });

    const claudeBody = await claudeRes.text();
    if (!claudeRes.ok) {
      await supabase
        .from('comprobantes')
        .update({
          ocr_status: 'failed',
          ocr_raw: { error: claudeBody.slice(0, 500), status: claudeRes.status },
        })
        .eq('id', comprobanteId);
      throw new Error(`Claude API error ${claudeRes.status}: ${claudeBody.slice(0, 300)}`);
    }

    const claudeJson = JSON.parse(claudeBody);
    const rawText: string = claudeJson?.content?.[0]?.text ?? '';

    // 4. Parsear JSON. Claude a veces envuelve en ```json y/o agrega prosa
    // (notas, aclaraciones) ANTES o DESPUES del objeto. Extraemos el objeto
    // desde el primer "{" hasta el ultimo "}" en vez de depender de fences.
    let extraido: OcrExtraido;
    try {
      extraido = JSON.parse(extraerObjetoJson(rawText));
    } catch (_parseErr) {
      await supabase
        .from('comprobantes')
        .update({
          ocr_status: 'failed',
          ocr_raw: { claude_response: claudeJson, parse_error: true, raw_text: rawText.slice(0, 500) },
        })
        .eq('id', comprobanteId);
      throw new Error(`No se pudo parsear JSON de Claude: ${rawText.slice(0, 200)}`);
    }

    // 5. Detectar duplicados
    const duplicados = await detectarDuplicados(supabase, comprobanteId, extraido);
    const duplicadoDeId = duplicados.length > 0 ? duplicados[0].id : null;

    // 6. Actualizar fila con datos extraidos
    const { error: updErr } = await supabase
      .from('comprobantes')
      .update({
        ocr_status: 'completed',
        ocr_raw: claudeJson,
        ocr_extraido: extraido,
        n_operacion: extraido.n_operacion,
        cuit_emisor: extraido.proveedor_cuit,
        monto_extraido: extraido.monto,
        fecha_extraida: extraido.fecha,
        duplicado_de: duplicadoDeId,
      })
      .eq('id', comprobanteId);

    if (updErr) throw new Error(`No se pudo actualizar comprobante: ${updErr.message}`);

    return new Response(
      JSON.stringify({
        ok: true,
        comprobante_id: comprobanteId,
        ocr_extraido: extraido,
        duplicados,
        confianza: extraido.confianza,
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

// ----- Helpers -----

// Extrae el primer objeto JSON de la respuesta del modelo, ignorando fences
// ```json``` y cualquier prosa que Claude agregue antes o despues (notas,
// aclaraciones de confianza baja, etc.). Toma del primer "{" al ultimo "}".
function extraerObjetoJson(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return text.trim();
  return text.slice(start, end + 1);
}

function base64FromArrayBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize) as unknown as number[]);
  }
  return btoa(binary);
}

function normalizeMediaType(mime: string | null | undefined): string {
  const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
  if (mime && allowed.includes(mime)) return mime;
  if (mime === 'image/jpg') return 'image/jpeg';
  return 'image/jpeg';
}

interface DuplicadoMatch {
  id: string;
  match_type: 'n_operacion' | 'monto_fecha_cuit';
  gasto_id: string | null;
}

async function detectarDuplicados(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  selfId: string,
  extraido: OcrExtraido,
): Promise<DuplicadoMatch[]> {
  const matches: DuplicadoMatch[] = [];

  // Match exacto por N° operacion
  if (extraido.n_operacion) {
    const { data: porOp } = await supabase
      .from('comprobantes')
      .select('id, gasto_id')
      .eq('n_operacion', extraido.n_operacion)
      .neq('id', selfId)
      .neq('estado', 'descartado_duplicado')
      .limit(5);

    if (porOp) {
      for (const row of porOp) {
        matches.push({ id: row.id, match_type: 'n_operacion', gasto_id: row.gasto_id });
      }
    }
  }

  // Match difuso por (monto, fecha, cuit) — solo si no encontramos por n_operacion
  if (matches.length === 0 && extraido.monto && extraido.fecha) {
    const fechaDate = new Date(extraido.fecha);
    if (!isNaN(fechaDate.getTime())) {
      const margenDias = 2;
      const desde = new Date(fechaDate.getTime() - margenDias * 86400000).toISOString().slice(0, 10);
      const hasta = new Date(fechaDate.getTime() + margenDias * 86400000).toISOString().slice(0, 10);
      const margenMonto = extraido.monto * 0.02;

      let query = supabase
        .from('comprobantes')
        .select('id, gasto_id, cuit_emisor')
        .gte('monto_extraido', extraido.monto - margenMonto)
        .lte('monto_extraido', extraido.monto + margenMonto)
        .gte('fecha_extraida', desde)
        .lte('fecha_extraida', hasta)
        .neq('id', selfId)
        .neq('estado', 'descartado_duplicado')
        .limit(5);

      if (extraido.proveedor_cuit) {
        query = query.eq('cuit_emisor', extraido.proveedor_cuit);
      }

      const { data: porFuzzy } = await query;
      if (porFuzzy) {
        for (const row of porFuzzy) {
          matches.push({ id: row.id, match_type: 'monto_fecha_cuit', gasto_id: row.gasto_id });
        }
      }
    }
  }

  return matches;
}
