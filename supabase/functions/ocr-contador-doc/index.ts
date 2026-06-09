// Edge Function: ocr-contador-doc
// Recibe el path de un PDF/imagen ya subido al bucket 'correos-contadores',
// lo manda a Claude y CLASIFICA si es un recibo de sueldo o un VEP (volante de
// pago AFIP/ARCA), extrayendo los campos clave. No escribe en DB: devuelve el
// JSON y el front rutea a recibos_sueldo (RRHH) o veps (Finanzas).
//
// Body: { path: string }
// Response: { ok: true, datos: {...} } | { ok: false, error: string }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const STORAGE_BUCKET = 'correos-contadores';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PROMPT = `Sos un sistema de clasificacion y extraccion de documentos contables argentinos para la empresa Rodziny S.A.S. (gastronomia, Resistencia Chaco). Los manda el contador por mail.

Un documento puede ser:
- "recibo": un RECIBO DE SUELDO / haberes de un empleado.
- "vep": un VEP (Volante Electronico de Pago) de AFIP/ARCA, o una boleta/volante de pago de impuestos o cargas sociales (F931, IVA, Ganancias, Autonomos, Seguridad Social, etc.).
- "desconocido": cualquier otra cosa.

Analiza el archivo y devolve UNICAMENTE un JSON estricto (sin markdown, sin texto antes ni despues):

{
  "tipo": "recibo" | "vep" | "desconocido",
  "empleado_nombre": string | null,   // solo si tipo=recibo: nombre y apellido del empleado
  "cuil": string | null,              // solo recibo: CUIL del empleado, solo digitos (11)
  "periodo": string | null,           // periodo liquidado o del impuesto. Formato YYYY-MM si se puede
  "neto": number | null,              // solo recibo: neto a cobrar (sin signo ni separadores)
  "impuesto": string | null,          // solo vep: nombre corto del concepto (ej "F931 Seg. Social", "IVA", "Ganancias", "Autonomos")
  "vencimiento": string | null,       // solo vep: fecha de vencimiento de pago, formato YYYY-MM-DD
  "monto": number | null,             // solo vep: importe a pagar (sin signo ni separadores)
  "numero": string | null,            // solo vep: numero de VEP si aparece
  "descripcion": string | null,       // resumen corto humano del documento
  "confianza": number                 // 0 a 1, honesto
}

REGLAS:
1. Montos: numero plano, sin $ ni puntos de miles. Coma decimal -> punto.
2. Fechas: YYYY-MM-DD. Periodo: YYYY-MM (si solo hay mes/anio).
3. CUIL: solo los 11 digitos, sin guiones.
4. Si no estas seguro del tipo, usa "desconocido" y confianza baja. NO inventes.
5. SALIDA: exclusivamente el objeto JSON. Nada de markdown ni notas.`;

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
  if (mime === 'application/pdf') return 'application/pdf';
  return 'image/jpeg';
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
    const path: string = body.path;
    if (!path) throw new Error('path requerido');

    const { data: fileBlob, error: dlErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .download(path);
    if (dlErr || !fileBlob) throw new Error(`No se pudo descargar el archivo: ${dlErr?.message}`);

    const arrayBuffer = await fileBlob.arrayBuffer();
    const base64 = base64FromArrayBuffer(arrayBuffer);
    const mediaType = normalizeMediaType(fileBlob.type);
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
        messages: [
          {
            role: 'user',
            content: [
              { type: sourceType, source: { type: 'base64', media_type: mediaType, data: base64 } },
              { type: 'text', text: PROMPT },
            ],
          },
        ],
      }),
    });

    const claudeText = await claudeRes.text();
    if (!claudeRes.ok) throw new Error(`Claude API ${claudeRes.status}: ${claudeText.slice(0, 300)}`);

    const claudeJson = JSON.parse(claudeText);
    const rawText: string = claudeJson?.content?.[0]?.text ?? '';

    let datos: Record<string, unknown>;
    try {
      datos = JSON.parse(extraerObjetoJson(rawText));
    } catch {
      throw new Error(`No se pudo parsear JSON de Claude: ${rawText.slice(0, 200)}`);
    }

    return new Response(JSON.stringify({ ok: true, datos }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
