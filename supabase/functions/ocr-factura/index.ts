// Edge Function: ocr-factura
// Lee una factura fiscal argentina (A/B/C/Remito/Recibo) con Claude Haiku 4.5 vision
// y devuelve los campos estructurados para autocompletar el form de Nuevo Gasto.
//
// Body: { comprobante_id: uuid }
// Response: { ok: true, ocr_extraido: {...}, proveedor_match: {...} | null } | { ok: false, error: string }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const STORAGE_BUCKET = 'gastos-comprobantes';
const CUIT_RODZINY = '30717352366';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const OCR_PROMPT = `Sos un sistema de extracción de datos de FACTURAS FISCALES argentinas para una empresa llamada Rodziny S.A.S. / Rodziny Pastas / Rodziny Sin Gluten (CUIT 30-71735236-6).

CONTEXTO: el archivo es una FACTURA, REMITO, RECIBO o documento fiscal que un PROVEEDOR le emitió a Rodziny. Tu trabajo es extraer los datos del documento fiscal para precargar el formulario de carga de gasto.

Analizalo y devolvé ÚNICAMENTE un JSON estricto con esta estructura, sin markdown ni explicaciones:

{
  "tipo_comprobante": "factura_a" | "factura_b" | "factura_c" | "remito" | "recibo" | "otro",
  "punto_venta": string | null,
  "numero_comprobante": string | null,
  "nro_completo": string | null,
  "emisor_razon_social": string | null,
  "emisor_nombre_fantasia": string | null,
  "emisor_cuit": string | null,
  "emisor_condicion_iva": "responsable_inscripto" | "monotributo" | "exento" | "consumidor_final" | null,
  "fecha_emision": string | null,
  "fecha_vencimiento": string | null,
  "importe_neto": number | null,
  "iva": number | null,
  "alicuota_iva": 21 | 10.5 | 27 | 5 | 2.5 | 0 | null,
  "iibb": number | null,
  "percepciones": number | null,
  "importe_total": number | null,
  "cae": string | null,
  "confianza": number
}

REGLAS — leer con atención. Estas reglas están basadas en errores típicos del modelo:

1. ESTRUCTURA DE UNA FACTURA ARGENTINA:
   - Arriba a la IZQUIERDA: datos del EMISOR (proveedor) — logo, nombre/razón social, domicilio, condición IVA, y su CUIT.
   - Arriba a la DERECHA: tipo de comprobante (A/B/C), número, fecha y CUIT del emisor (a veces repetido).
   - Debajo: "Cliente:", "Sr/Sra:", "Razón Social:" — datos del RECEPTOR (que es Rodziny: CUIT 30-71735236-6).

2. EMISOR_CUIT — CRÍTICO:
   - Es el CUIT del PROVEEDOR (parte superior del documento, asociado al logo/nombre/razón social del emisor).
   - Es DIFERENTE del CUIT que aparece junto a "Cliente:" / "Sr.:" — ese CUIT es el de Rodziny (30717352366).
   - Si el documento tiene 2 CUITs distintos: el del emisor es el que NO es 30717352366. Devolvelo con 11 dígitos sin guiones.
   - Si solo encontrás el CUIT de Rodziny, igual seguí buscando el CUIT del emisor en el header del documento — a veces está al lado del logo, en letra más chica, o cerca de "Ingresos Brutos". NUNCA devuelvas 30717352366.

3. FECHA_EMISION — CRÍTICO:
   - Es la fecha en que el EMISOR emitió esta factura, NO otras fechas que aparecen en el documento.
   - Buscá específicamente "Fecha:", "Fecha de Emisión:" cerca del header o del número de comprobante.
   - NO uses "Inicio de Actividades" (esa es la fecha en que el proveedor abrió su negocio, suele ser de hace muchos años).
   - NO uses "FchVtoCAE" (esa es el vencimiento del código CAE).
   - NO uses "Vencimiento del Pago" para fecha_emision (eso va en fecha_vencimiento).
   - Formato YYYY-MM-DD. Si la factura es reciente (2024-2026), priorizar fechas de ese rango.

4. TIPO_COMPROBANTE:
   - "factura_a": dice "FACTURA A" o tiene letra A grande. Discrimina IVA.
   - "factura_b": dice "FACTURA B" o letra B. Discrimina IVA.
   - "factura_c": dice "FACTURA C" o letra C. Monotributo, NO discrimina IVA.
   - "remito": dice "REMITO" o letra R/X. Sin valor fiscal.
   - "recibo": dice "RECIBO".
   - "otro": ticket, nota de crédito, presupuesto, etc.

5. PUNTO_VENTA + NUMERO_COMPROBANTE:
   - Formato típico: 0001-00001234 (4 dígitos punto venta, 8 dígitos número).
   - Devolvé cada parte por separado y el formato completo en "nro_completo".

6. EMISOR_CONDICION_IVA: deducir del tipo si no está explícito:
   - factura_a o factura_b → "responsable_inscripto"
   - factura_c → "monotributo"

7. IMPORTES:
   - Sin signo de pesos ni separadores de miles. Punto como decimal.
   - Factura A/B: neto suele estar como "Subtotal", "Importe Neto", "Gravado". El IVA aparece discriminado.
   - Factura C: NO discrimina IVA → importe_neto e iva pueden ser null.

8. ALICUOTA_IVA:
   - Si está discriminado: alicuota = iva / neto * 100. Redondear al valor típico (21, 10.5, 27, 5, 2.5).
   - Si no discrimina, null.

9. CAE: código de autorización electrónica (14 dígitos), al pie. Opcional.

10. CONFIANZA: entre 0 y 1. Bajar si:
   - No encontraste el CUIT del emisor (los CUITs son críticos).
   - No encontraste la fecha de emisión.
   - El documento está borroso o no es claramente una factura.
   - El emisor parece ser Rodziny mismo (en ese caso, todos los campos del emisor van null y confianza = 0).`;

interface ComprobanteRow {
  id: string;
  file_path: string;
  mime_type: string | null;
  ocr_status: string;
}

interface ProveedorMatch {
  id: string;
  razon_social: string | null;
  nombre_comercial: string | null;
  cuit: string | null;
}

interface OcrFacturaExtraido {
  tipo_comprobante: string | null;
  punto_venta: string | null;
  numero_comprobante: string | null;
  nro_completo: string | null;
  emisor_razon_social: string | null;
  emisor_nombre_fantasia: string | null;
  emisor_cuit: string | null;
  emisor_condicion_iva: string | null;
  fecha_emision: string | null;
  fecha_vencimiento: string | null;
  importe_neto: number | null;
  iva: number | null;
  alicuota_iva: number | null;
  iibb: number | null;
  percepciones: number | null;
  importe_total: number | null;
  cae: string | null;
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

    const { data: comp, error: compErr } = await supabase
      .from('comprobantes')
      .select('id, file_path, mime_type, ocr_status')
      .eq('id', comprobanteId)
      .single();

    if (compErr || !comp) throw new Error(`Comprobante no encontrado: ${compErr?.message ?? 'null'}`);
    const comprobante = comp as ComprobanteRow;

    await supabase
      .from('comprobantes')
      .update({ ocr_status: 'processing' })
      .eq('id', comprobanteId);

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

    let extraido: OcrFacturaExtraido;
    try {
      const cleaned = rawText.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim();
      extraido = JSON.parse(cleaned);
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

    // Defensa extra: si el modelo igual devolvió el CUIT de Rodziny como emisor,
    // lo descartamos a mano. Así nunca termina seleccionando a Rodziny como proveedor.
    if (extraido.emisor_cuit) {
      const cuitLimpio = extraido.emisor_cuit.replace(/\D/g, '');
      if (cuitLimpio === CUIT_RODZINY) {
        extraido.emisor_cuit = null;
      } else {
        extraido.emisor_cuit = cuitLimpio;
      }
    }

    // Lookup de proveedor por CUIT (cuit + cuits_alt)
    let proveedorMatch: ProveedorMatch | null = null;
    if (extraido.emisor_cuit) {
      const cuit = extraido.emisor_cuit;
      if (cuit.length === 11) {
        const { data: porCuit } = await supabase
          .from('proveedores')
          .select('id, razon_social, nombre_comercial, cuit, cuits_alt')
          .or(`cuit.eq.${cuit},cuits_alt.cs.{${cuit}}`)
          .limit(1)
          .maybeSingle();
        if (porCuit) {
          proveedorMatch = {
            id: porCuit.id,
            razon_social: porCuit.razon_social,
            nombre_comercial: porCuit.nombre_comercial,
            cuit: porCuit.cuit,
          };
        }
      }
    }

    const { error: updErr } = await supabase
      .from('comprobantes')
      .update({
        ocr_status: 'completed',
        ocr_raw: claudeJson,
        ocr_extraido: extraido,
        cuit_emisor: extraido.emisor_cuit,
        monto_extraido: extraido.importe_total,
        fecha_extraida: extraido.fecha_emision,
      })
      .eq('id', comprobanteId);

    if (updErr) throw new Error(`No se pudo actualizar comprobante: ${updErr.message}`);

    return new Response(
      JSON.stringify({
        ok: true,
        comprobante_id: comprobanteId,
        ocr_extraido: extraido,
        proveedor_match: proveedorMatch,
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
