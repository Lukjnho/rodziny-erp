// Edge Function: ocr-contador-doc
// Recibe el path de un PDF/imagen del bucket 'correos-contadores', lo manda a
// Claude y CLASIFICA: recibo(s) de sueldo o VEP (volante de pago AFIP/ARCA).
// Un PDF de recibos puede traer VARIOS empleados (uno por pagina, a veces con
// copia empleado/empleador duplicada) -> devuelve un ARRAY deduplicado por CUIL,
// con el numero de pagina de cada uno para poder cortar el PDF por empleado.
// No escribe en DB: el front rutea a recibos_sueldo (RRHH) o veps (Finanzas).
//
// Body: { path: string }
// Response: { ok: true, datos: { tipo, recibos?: [...], vep?: {...}, ... } } | { ok:false, error }

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
- "recibo": uno o VARIOS RECIBOS DE SUELDO / haberes de empleados (suele venir un PDF con muchos empleados, uno por pagina).
- "vep": un VEP (Volante Electronico de Pago) de AFIP/ARCA o boleta de pago de impuestos/cargas sociales (F931, IVA, Ganancias, Autonomos, SICOSS, etc.).
- "desconocido": cualquier otra cosa (acuses, declaraciones juradas sin importe, capturas de pantalla sin datos, etc.).

Analiza TODO el archivo (todas las paginas) y devolve UNICAMENTE un JSON estricto (sin markdown, sin texto antes ni despues):

{
  "tipo": "recibo" | "vep" | "desconocido",
  "recibos": [                      // SOLO si tipo=recibo. Un objeto por empleado, EN EL ORDEN del documento.
    {
      "empleado_nombre": string,    // apellido y nombre como figura
      "cuil": string,               // 11 digitos, solo numeros
      "periodo": string,            // periodo de pago, formato YYYY-MM
      "neto": number,               // TOTAL NETO a cobrar (sin signo ni separadores de miles, decimal con punto)
      "bruto": number | null,       // TOTAL HABERES / bruto antes de descuentos (remunerativo + no remunerativo)
      "aporte_jubilacion": number | null,  // descuento "Jubilacion" / SIPA (~11%)
      "aporte_obra_social": number | null, // descuento "Obra Social" (~3%)
      "aporte_pami": number | null,         // descuento "Ley 19032" / PAMI / INSSJP (~3%)
      "total_aportes": number | null,       // TOTAL de descuentos al empleado (= bruto - neto)
      "pagina": number              // numero de pagina del PDF (empieza en 1) donde aparece ESTE empleado
    }
  ],
  "vep": {                          // SOLO si tipo=vep
    "impuesto": string,             // concepto corto (ej "F931 SICOSS", "IVA", "Ganancias", "Autonomos")
    "periodo": string,              // periodo del impuesto/DDJJ, formato YYYY-MM
    "vencimiento": string | null,   // fecha de vencimiento/expiracion si figura, formato YYYY-MM-DD; null si no aparece
    "fecha_pago": string | null,    // fecha EFECTIVA de pago si el documento es un COMPROBANTE de pago ya realizado (ej "Fecha y hora de pago"), formato YYYY-MM-DD; null si es un VEP todavia a pagar
    "monto": number,                // importe total a pagar
    "numero": string                // Nro de VEP si aparece
  },
  "descripcion": string,            // resumen corto humano
  "confianza": number               // 0 a 1, honesto
}

REGLAS CRITICAS:
1. RECIBOS MULTIPLES: si el PDF tiene varios empleados, incluilos a TODOS en el array "recibos", en el orden en que aparecen.
2. DEDUPLICAR: cada recibo suele estar impreso dos veces (copia empleado y copia empleador) en la MISMA pagina. Incluí cada empleado UNA SOLA VEZ (por CUIL). No repitas. Las dos copias cuentan como UNA pagina.
3. pagina: numero de pagina (base 1) donde figura el recibo de ese empleado. Normalmente empleado 1 = pagina 1, empleado 2 = pagina 2, etc.
4. neto = el "TOTAL NETO" / "SON PESOS" que efectivamente cobra el empleado, NO el bruto ni los descuentos.
4b. DESGLOSE: bruto = total de haberes antes de descuentos. aporte_jubilacion/obra_social/pami = los descuentos AL EMPLEADO que figuran en el recibo. total_aportes = suma de descuentos del empleado (bruto - neto). Las CONTRIBUCIONES PATRONALES (lo que paga el empleador) NO figuran en el recibo: NO las inventes. Si algun campo del desglose no aparece, poné null (no estimes).
5. Montos: numero plano, sin $ ni puntos de miles, decimal con punto. Fechas YYYY-MM-DD, periodos YYYY-MM.
5b. VEP fecha_pago: si el documento es un COMPROBANTE de una operacion ya realizada (dice "Realizado", "Fecha y hora de pago", comprobante de banco/Interbanking), extrae esa fecha de pago en fecha_pago. Si es solo un volante A PAGAR (sin pago hecho), fecha_pago = null. El "periodo" es SIEMPRE el del impuesto (ej. 202512 => 2025-12), NO el mes en que se pago.
6. CUIL: 11 digitos sin guiones. El CUIT de la empresa (30-71735236-6) NO es el CUIL del empleado.
7. Si no estas seguro del tipo o no hay datos extraibles (ej. captura de pantalla, acuse), usa "desconocido". NO inventes montos ni fechas.
8. SALIDA: exclusivamente el objeto JSON. Nada de markdown ni notas.`;

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
        max_tokens: 4096,
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
