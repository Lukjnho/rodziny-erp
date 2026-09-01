/**
 * Impresión directa a la térmica, sin el diálogo del navegador.
 *
 * Del otro lado hay un agente que corre en la PC de la caja (ver la carpeta
 * `agente-impresion/`): recibe el ticket y se lo manda a la impresora en su
 * propio idioma (ESC/POS), así sale solo, corta el papel y abre la gaveta.
 *
 * ⚠️ SIEMPRE HAY PLAN B. Si el agente no está instalado, está caído o tarda,
 * esto devuelve `false` y la caja imprime como hasta ahora, con el diálogo del
 * navegador. Nunca se queda sin imprimir por culpa del agente.
 */

const URL_AGENTE = 'http://localhost:9110';

/** Si el agente no contesta en este rato, se usa el diálogo del navegador. */
const ESPERA_MS = 2500;

/**
 * Cuánto se deja de insistir después de que el agente falló. Sirve para el caso
 * feo: el agente instalado pero colgado, que haría esperar 2,5 segundos en CADA
 * venta. Si simplemente no está instalado no molesta, porque el navegador
 * rechaza la conexión al instante.
 */
const DESCANSO_MS = 15_000;

let noInsistirHasta = 0;

/** Un renglón del ticket. El agente lo traduce a ESC/POS. */
export interface RenglonImpreso {
  /** t = texto · lr = izquierda y derecha · sep = línea de guiones · nl = renglón vacío */
  k?: 't' | 'lr' | 'sep' | 'nl';
  /** el texto (o la parte izquierda si es `lr`) */
  x?: string;
  /** la parte derecha, pegada al borde */
  y?: string;
  /** centrado */
  c?: boolean;
  /** negrita */
  b?: boolean;
  /** tamaño: 1 normal, 2 doble, 3 triple */
  s?: number;
  /** sangría en espacios */
  i?: number;
}

export interface TrabajoImpresion {
  /** nombre que se ve en la cola de Windows */
  titulo?: string;
  /** si no va, el agente usa la impresora que tiene configurada */
  impresora?: string;
  lineas: RenglonImpreso[];
  /** cortar el papel al final (por defecto sí) */
  cortar?: boolean;
  /** abrir la gaveta (solo tiene sentido al cobrar en efectivo) */
  gaveta?: boolean;
}

async function pedir(ruta: string, cuerpo?: unknown): Promise<Response> {
  const corte = new AbortController();
  const reloj = setTimeout(() => corte.abort(), ESPERA_MS);
  try {
    return await fetch(URL_AGENTE + ruta, {
      method: cuerpo ? 'POST' : 'GET',
      headers: cuerpo ? { 'Content-Type': 'application/json' } : undefined,
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: corte.signal,
    });
  } finally {
    clearTimeout(reloj);
  }
}

/**
 * Manda el ticket al agente. Devuelve `true` solo si salió por la impresora.
 * Nunca tira error: si algo falla, devuelve `false` y quien llama usa el plan B.
 */
export async function imprimirConAgente(trabajo: TrabajoImpresion): Promise<boolean> {
  if (Date.now() < noInsistirHasta) return false;
  try {
    const respuesta = await pedir('/imprimir', trabajo);
    if (!respuesta.ok) {
      noInsistirHasta = Date.now() + DESCANSO_MS;
      return false;
    }
    const datos = (await respuesta.json()) as { ok?: boolean };
    if (!datos.ok) {
      noInsistirHasta = Date.now() + DESCANSO_MS;
      return false;
    }
    return true;
  } catch {
    // El agente no está, o no contestó a tiempo. Silencio a propósito: esto es
    // lo normal en las PCs donde todavía no se instaló.
    noInsistirHasta = Date.now() + DESCANSO_MS;
    return false;
  }
}

/** ¿Hay agente escuchando? Para mostrarlo en la pantalla, no para decidir. */
export async function agenteDisponible(): Promise<boolean> {
  try {
    const respuesta = await pedir('/estado');
    if (!respuesta.ok) return false;
    const datos = (await respuesta.json()) as { ok?: boolean; agente?: string };
    return datos.ok === true && datos.agente === 'rodziny';
  } catch {
    return false;
  }
}
