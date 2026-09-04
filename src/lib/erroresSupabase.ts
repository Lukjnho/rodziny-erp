import type { PostgrestError } from '@supabase/supabase-js';

// Traduce un error de Supabase/Postgres a un mensaje claro en español para
// mostrarle a la persona en la pantalla, en vez del texto técnico crudo
// (ej. "duplicate key value violates unique constraint ...").
//
// Uso típico en una mutación:
//   if (err) { setError(mensajeErrorAmigable(err, 'No se pudo guardar el lote')); return; }

// Mensajes por código SQLSTATE de Postgres.
const POR_CODIGO: Record<string, string> = {
  '23505': 'Ya existe un registro con esos datos. Puede que ya lo hayas cargado hoy.',
  '23503':
    'No se puede completar: este registro está vinculado a otros (por ejemplo, un lote de relleno o masa que ya se usó en una pasta).',
  '23502': 'Falta completar un dato obligatorio.',
  '23514': 'Alguna cantidad no es válida. Revisá los números cargados.',
  '22P02': 'Hay un valor con formato inválido (revisá las cantidades).',
  '40001': 'Otra persona guardó al mismo tiempo. Esperá un segundo y probá de nuevo.',
  // RLS: la fila se rechazó por permisos, no por los datos. Antes caía en el
  // mensaje genérico ("no se pudo completar") y la persona no tenía forma de
  // saber que le faltaba un permiso — probaba de nuevo para siempre.
  '42501':
    'Tu usuario no tiene permiso para hacer esto. Pedile a un administrador que te habilite el módulo.',
  PGRST116: 'No se encontró el registro (quizás se borró o cambió desde otra pantalla).',
};

// Palabras que delatan un mensaje técnico crudo (en inglés) de Postgres/PostgREST.
// Si aparecen, NO mostramos ese texto: usamos uno traducido.
const TOKENS_TECNICOS = [
  'violates',
  'constraint',
  'duplicate key',
  'syntax',
  'permission denied',
  'relation ',
  'column ',
  'jwt',
  'invalid input',
  'null value',
];

// Candados con nombre propio. Para estos, el mensaje generico de 23505 -"ya
// existe un registro, puede que ya lo hayas cargado hoy"- no solo no ayuda:
// MIENTE, porque no es que el operario cargo dos veces. Postgres manda el
// nombre del indice adentro del texto del error, asi que se puede traducir de
// verdad y decirle a la persona que hacer.
const POR_RESTRICCION: Record<string, string> = {
  cocina_lotes_pasta_codigo_unico_por_local:
    'Ya hay otro lote con ese mismo codigo en este local. El sistema deberia haberle puesto una letra al final solo: avisa, porque algo no funciono.',
};

function pareceTecnico(rawLower: string): boolean {
  return TOKENS_TECNICOS.some((t) => rawLower.includes(t));
}

export function mensajeErrorAmigable(error: unknown, contexto?: string): string {
  const e = (error ?? {}) as Partial<PostgrestError> & { message?: string };
  const code = e.code ?? '';
  const rawMsg = e.message ?? '';
  const raw = rawMsg.toLowerCase();
  const wrap = (m: string) => (contexto ? `${contexto}: ${m}` : m);

  // Errores lanzados a mano por funciones de la base (RAISE EXCEPTION): ya
  // vienen con un mensaje en español pensado para el usuario, lo respetamos.
  if (code === 'P0001' && rawMsg) return wrap(rawMsg);

  // Problema de conexión / red.
  if (raw.includes('failed to fetch') || raw.includes('networkerror') || raw.includes('network request')) {
    return wrap('Problema de conexión. Revisá internet y probá de nuevo.');
  }

  // Un candado con nombre propio gana sobre el mensaje generico del codigo.
  for (const [restriccion, mensaje] of Object.entries(POR_RESTRICCION)) {
    if (raw.includes(restriccion)) return wrap(mensaje);
  }

  let base = POR_CODIGO[code];

  // Fallback por texto, por si el error llega sin código (red / PostgREST).
  if (!base) {
    if (raw.includes('duplicate key')) base = POR_CODIGO['23505'];
    else if (raw.includes('foreign key')) base = POR_CODIGO['23503'];
    else if (raw.includes('null value') || raw.includes('not-null')) base = POR_CODIGO['23502'];
    else if (raw.includes('check constraint')) base = POR_CODIGO['23514'];
    // PostgREST a veces devuelve el rechazo de RLS sin el código 42501.
    else if (raw.includes('row-level security') || raw.includes('permission denied'))
      base = POR_CODIGO['42501'];
  }

  // Mensaje escrito a mano por la app (throw new Error('...')): no tiene código
  // de Postgres ni pinta de técnico, así que ya es apto para mostrar tal cual.
  if (!base && error instanceof Error && rawMsg && !pareceTecnico(raw)) {
    return wrap(rawMsg);
  }

  if (!base) base = 'No se pudo completar la operación. Probá de nuevo en unos segundos.';
  return wrap(base);
}

// ---------------------------------------------------------------------------
// Errores de Edge Functions (OCR de comprobantes y facturas, Fudo, push, etc.)
// ---------------------------------------------------------------------------
//
// EL PROBLEMA: cuando una edge function responde con un código que no es 2xx,
// supabase-js NO nos entrega el motivo. El `.message` del error es siempre el
// mismo texto inútil ("Edge Function returned a non-2xx status code"). El motivo
// de verdad viaja en el CUERPO de la respuesta — nuestras functions devuelven
// { ok: false, error: "..." } — y queda colgado en `error.context`, que es un
// objeto Response todavía sin leer. Esta función lo lee y lo traduce a criollo.
//
// Nació del incidente del 1-sep-2026: la cuenta de Anthropic se quedó sin saldo
// y en pantalla decía "non-2xx status code", indistinguible de un archivo roto.
//
// Es asincrónica porque leer el cuerpo de una respuesta HTTP lo es.

/** Texto que pone supabase-js cuando la function responde 4xx/5xx. No dice nada:
 *  jamás se lo mostramos a la persona. */
const GENERICO_SDK = 'edge function returned a non-2xx status code';

/** Motivos conocidos → mensaje en criollo. Se evalúan en orden: gana el primero
 *  que matchea, así que van del más específico al más general. */
const MOTIVOS_EDGE: Array<{ patrones: string[]; mensaje: string }> = [
  {
    // La cuenta de Anthropic se quedó sin plata (incidente del 1-sep-2026).
    patrones: ['credit balance is too low', 'insufficient credit', 'insufficient_quota'],
    mensaje:
      'El servicio de lectura automática no tiene saldo. Avisale a Lucas para que cargue créditos.',
  },
  {
    // Falta la clave, o está vencida / revocada.
    patrones: ['no configurado', 'authentication_error', 'invalid x-api-key', 'invalid api key', 'permission_error'],
    mensaje:
      'El servicio de lectura automática no está configurado (falta la clave o venció). Avisale a Lucas.',
  },
  {
    patrones: ['rate_limit', 'rate limit', 'too many requests', 'overloaded'],
    mensaje: 'El servicio de lectura automática está saturado en este momento. Esperá un minuto.',
  },
  {
    patrones: ['timeout', 'timed out', 'deadline', 'worker_limit', 'aborted'],
    mensaje: 'La lectura tardó demasiado y se cortó. Probá de nuevo con una foto más liviana.',
  },
  {
    patrones: ['media_type', 'unsupported', 'could not process image', 'image exceeds', 'too large', 'payload too'],
    mensaje: 'El formato o el tamaño del archivo no sirven. Probá con una foto JPG o un PDF más chico.',
  },
  {
    patrones: ['no se pudo parsear', 'parse_error'],
    mensaje: 'El sistema no entendió lo que dice el comprobante.',
  },
  {
    patrones: ['no se pudo descargar el archivo', 'object not found'],
    mensaje: 'No se pudo recuperar el archivo del almacenamiento. Volvé a subirlo.',
  },
  {
    patrones: ['missing authorization', 'unauthorized', 'invalid claim'],
    mensaje: 'Tu sesión venció. Cerrá sesión, volvé a entrar y probá de nuevo.',
  },
  {
    patrones: ['boot_error', 'worker_error', 'function not found'],
    mensaje: 'El servicio de lectura automática no está respondiendo. Avisale a Lucas.',
  },
  {
    patrones: ['failed to send a request', 'failed to fetch', 'networkerror', 'network request'],
    mensaje: 'No se pudo contactar al servidor. Revisá internet y probá de nuevo.',
  },
];

/** Último recurso: mensaje según el código HTTP, cuando el cuerpo no dijo nada útil. */
function mensajePorEstadoHttp(status: number | null): string {
  if (status === 401 || status === 403) return 'Tu sesión venció. Cerrá sesión, volvé a entrar y probá de nuevo.';
  if (status === 404) return 'El servicio de lectura automática no está disponible. Avisale a Lucas.';
  if (status === 413) return 'El archivo es demasiado grande. Probá con una foto más liviana.';
  if (status === 429) return 'Hay demasiados pedidos al mismo tiempo. Esperá un minuto y probá de nuevo.';
  if (status === 504 || status === 546) return 'El servidor tardó demasiado y cortó la operación.';
  return 'No se pudo completar la operación. Probá de nuevo en un minuto; si sigue igual, avisale a Lucas.';
}

/** Lee el cuerpo de la respuesta que supabase-js dejó colgada en `error.context`.
 *  OJO: el cuerpo se puede leer UNA SOLA VEZ. Clonamos antes de leer para no
 *  dejarlo consumido, y si otro código ya lo leyó el clone revienta — por eso va
 *  todo dentro de try/catch. Si no se puede leer, el mensaje sale del código HTTP. */
async function leerCuerpoRespuesta(contexto: unknown): Promise<{ status: number | null; texto: string | null }> {
  if (!contexto || typeof contexto !== 'object') return { status: null, texto: null };
  const resp = contexto as Partial<Response>;
  const status = typeof resp.status === 'number' ? resp.status : null;
  // Puede no ser un Response (en un error de red, .context es el error del fetch).
  if (typeof resp.text !== 'function') return { status, texto: null };
  try {
    const fuente =
      typeof resp.clone === 'function' && resp.bodyUsed !== true ? resp.clone() : (resp as Response);
    const texto = (await fuente.text()).trim();
    return { status, texto: texto || null };
  } catch {
    // Cuerpo ya consumido o ilegible: seguimos con el código HTTP.
    return { status, texto: null };
  }
}

/** De un cuerpo { ok:false, error:"..." } saca el texto del motivo. Si no es JSON
 *  (el gateway a veces responde texto plano), devuelve lo que vino tal cual. */
function motivoDesdeCuerpo(texto: string): string {
  try {
    const json: unknown = JSON.parse(texto);
    if (json && typeof json === 'object') {
      const obj = json as Record<string, unknown>;
      for (const campo of ['error', 'message', 'msg', 'error_description']) {
        const valor = obj[campo];
        if (typeof valor === 'string' && valor.trim()) return valor.trim();
        // Anthropic anida el motivo: { error: { type, message } }
        if (valor && typeof valor === 'object') {
          const anidado = (valor as Record<string, unknown>).message;
          if (typeof anidado === 'string' && anidado.trim()) return anidado.trim();
        }
      }
    }
  } catch {
    // No era JSON: usamos el texto crudo.
  }
  return texto;
}

/** Busca el motivo crudo en la tabla de casos conocidos. */
function traducirMotivoEdge(crudo: string): string | null {
  const bajo = crudo.toLowerCase();
  if (!bajo.trim()) return null;
  for (const caso of MOTIVOS_EDGE) {
    if (caso.patrones.some((p) => bajo.includes(p))) return caso.mensaje;
  }
  return null;
}

// ¿El texto crudo se puede mostrar tal cual? Solo si lo escribimos nosotros, en
// castellano, y no tiene pinta de volcado técnico.
const PINTA_CASTELLANO = /[áéíóúñ¿¡]|\b(no se|no hay|falta|faltan|el|la|los|las)\b/i;
const TOKENS_TECNICOS_EDGE = ['{', '}', 'stack', 'at async', 'http', 'exception', 'traceback', 'undefined'];

function textoMostrable(crudo: string): string | null {
  const t = crudo.trim();
  if (!t || t.length > 200) return null;
  const bajo = t.toLowerCase();
  if (bajo.includes(GENERICO_SDK)) return null;
  if (pareceTecnico(bajo)) return null;
  if (TOKENS_TECNICOS_EDGE.some((k) => bajo.includes(k))) return null;
  return PINTA_CASTELLANO.test(t) ? t : null;
}

/**
 * Traduce el error de una edge function a un mensaje claro en castellano.
 * Acepta tanto el `error` de supabase-js (lee el cuerpo de la respuesta que quedó
 * colgado en `.context`) como el string que devuelve la propia function cuando
 * responde 200 con { ok:false, error:"..." }.
 *
 * Uso:
 *   const { data, error } = await supabase.functions.invoke('ocr-comprobante', { body });
 *   if (error || !data?.ok) {
 *     setError(await mensajeErrorEdgeFunction(error ?? data?.error, 'No se pudo leer el comprobante'));
 *   }
 *
 * @param error    error de `supabase.functions.invoke`, o el string de la function.
 * @param contexto texto que va adelante. Ej: 'No se pudo leer el comprobante'.
 */
export async function mensajeErrorEdgeFunction(error: unknown, contexto?: string): Promise<string> {
  const wrap = (m: string) => (contexto ? `${contexto}: ${m}` : m);

  if (error == null) return wrap(mensajePorEstadoHttp(null));

  // La function respondió 200 con { ok:false, error:'...' } y nos pasan ese string.
  if (typeof error === 'string') {
    return wrap(traducirMotivoEdge(error) ?? textoMostrable(error) ?? mensajePorEstadoHttp(null));
  }

  const e = error as { message?: unknown; context?: unknown };
  const mensajeSdk = typeof e.message === 'string' ? e.message : '';

  // Acá está el motivo real: el cuerpo de la respuesta que supabase-js descartó.
  const { status, texto } = await leerCuerpoRespuesta(e.context);
  const crudo = texto ? motivoDesdeCuerpo(texto) : '';

  // 1) Caso conocido (miramos el cuerpo y, si no dijo nada, el mensaje del SDK).
  const conocido = traducirMotivoEdge(crudo) ?? traducirMotivoEdge(mensajeSdk);
  if (conocido) return wrap(conocido);

  // 2) Mensaje nuestro, en castellano, apto para mostrar tal cual.
  const mostrable = textoMostrable(crudo);
  if (mostrable) return wrap(mostrable);

  // 3) Fallback honesto — nunca el texto genérico de supabase-js.
  return wrap(mensajePorEstadoHttp(status));
}
