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
  /**
   * t = texto · lr = izquierda y derecha · sep = línea de guiones
   * nl = renglón vacío · qr = código QR (el contenido va en `x`)
   *
   * El QR lo dibuja la impresora con su propio comando, no se manda como
   * imagen: sale nítido y ocupa una fracción de los datos.
   */
  k?: 't' | 'lr' | 'sep' | 'nl' | 'qr';
  /** el texto (o la parte izquierda si es `lr`, o el contenido si es `qr`) */
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

// ── Configuración de la impresora ────────────────────────────────────────────
//
// Es DE CADA PC: cada caja tiene su impresora, y quien la elige es quien está
// sentado ahí. Por eso vive en el agente y no en la base de datos.

export interface EstadoAgente {
  impresora: string;
  /** la impresora elegida sigue existiendo en esta PC */
  instalada: boolean;
  ancho: number;
  tabla: number;
}

export interface ImpresoraDeLaPC {
  nombre: string;
  driver: string;
  puerto: string;
  /** tiene pinta de térmica: el agente la sugiere */
  probable: boolean;
  predeterminada: boolean;
}

export interface TablaDeCaracteres {
  valor: number;
  nombre: string;
}

/** `null` si el agente no está corriendo en esta PC. */
export async function estadoAgente(): Promise<EstadoAgente | null> {
  try {
    const respuesta = await pedir('/estado');
    if (!respuesta.ok) return null;
    const datos = (await respuesta.json()) as { ok?: boolean; agente?: string } & EstadoAgente;
    if (datos.ok !== true || datos.agente !== 'rodziny') return null;
    return {
      impresora: datos.impresora ?? '',
      instalada: !!datos.instalada,
      ancho: datos.ancho ?? 48,
      tabla: datos.tabla ?? 2,
    };
  } catch {
    return null;
  }
}

/** Las impresoras instaladas en ESTA PC, para poder elegir. */
export async function impresorasDeLaPC(): Promise<{
  impresoras: ImpresoraDeLaPC[];
  tablas: TablaDeCaracteres[];
}> {
  const respuesta = await pedir('/impresoras');
  if (!respuesta.ok) throw new Error('El agente no contestó la lista de impresoras.');
  const datos = (await respuesta.json()) as {
    impresoras?: ImpresoraDeLaPC[];
    tablas?: TablaDeCaracteres[];
  };
  return { impresoras: datos.impresoras ?? [], tablas: datos.tablas ?? [] };
}

/** Guarda la elección en la PC. Tira error con el motivo si no se pudo. */
export async function guardarConfigAgente(cambios: {
  impresora?: string;
  ancho?: number;
  tabla?: number;
}): Promise<void> {
  const respuesta = await pedir('/config', cambios);
  const datos = (await respuesta.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!respuesta.ok || !datos.ok) {
    throw new Error(datos.error ?? 'No se pudo guardar la configuración de la impresora.');
  }
}

/** Imprime el ticket de prueba en papel, para calibrar ancho y acentos. */
export async function imprimirPrueba(): Promise<void> {
  const respuesta = await pedir('/prueba', {});
  const datos = (await respuesta.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!respuesta.ok || !datos.ok) {
    throw new Error(datos.error ?? 'No se pudo imprimir la prueba.');
  }
}

/** Cómo quedaría el ticket de prueba, sin gastar papel. */
export async function vistaPreviaPrueba(): Promise<string> {
  const respuesta = await pedir('/vista-previa', {});
  const datos = (await respuesta.json().catch(() => ({}))) as { papel?: string };
  return datos.papel ?? '';
}
