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

  let base = POR_CODIGO[code];

  // Fallback por texto, por si el error llega sin código (red / PostgREST).
  if (!base) {
    if (raw.includes('duplicate key')) base = POR_CODIGO['23505'];
    else if (raw.includes('foreign key')) base = POR_CODIGO['23503'];
    else if (raw.includes('null value') || raw.includes('not-null')) base = POR_CODIGO['23502'];
    else if (raw.includes('check constraint')) base = POR_CODIGO['23514'];
  }

  // Mensaje escrito a mano por la app (throw new Error('...')): no tiene código
  // de Postgres ni pinta de técnico, así que ya es apto para mostrar tal cual.
  if (!base && error instanceof Error && rawMsg && !pareceTecnico(raw)) {
    return wrap(rawMsg);
  }

  if (!base) base = 'No se pudo completar la operación. Probá de nuevo en unos segundos.';
  return wrap(base);
}
