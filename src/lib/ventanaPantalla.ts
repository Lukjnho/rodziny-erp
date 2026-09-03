/**
 * Ventanas aparte del ERP: pantallas que se usan todo el turno y no quieren el
 * menú lateral al costado. Hoy son dos — el punto de venta de la caja y el
 * pizarrón de la fábrica — y las dos tienen exactamente el mismo problema de
 * ventana, así que la mecánica vive acá una sola vez.
 *
 * ⚠️ LANDMINE: esto TIENE que salir de un click del usuario. Si se llama desde
 * un efecto, un timeout o después de un `await`, el navegador lo trata como
 * ventana emergente y lo bloquea sin avisar.
 */

export interface VentanaAparte {
  /**
   * Nombre fijo de la ventana. Dos llamadas con el mismo nombre reusan la MISMA
   * ventana, así nunca se abren dos cajas ni dos pizarrones a la vez.
   */
  nombre: string;
  /**
   * Ruta que se abre adentro. Puede llevar query (`/pizarron?vista=camara`):
   * para decidir si la ventana ya está en su lugar se compara solo el camino,
   * no los parámetros.
   */
  ruta: string;
  ancho?: number;
  alto?: number;
}

/**
 * Abre (o trae al frente) una ventana aparte.
 *
 * Devuelve `false` si el navegador la bloqueó, para que quien llame pueda caer
 * en el plan B: entrar a la misma ruta en la pestaña actual.
 */
export function abrirVentanaAparte({
  nombre,
  ruta,
  ancho: anchoMax = 1440,
  alto: altoMax = 920,
}: VentanaAparte): boolean {
  if (typeof window === 'undefined') return false;

  const ancho = Math.min(anchoMax, window.screen.availWidth);
  const alto = Math.min(altoMax, window.screen.availHeight);
  const izquierda = Math.max(0, Math.round((window.screen.availWidth - ancho) / 2));
  const arriba = Math.max(0, Math.round((window.screen.availHeight - alto) / 2));

  // Se pide SIN dirección a propósito. Si la ventana ya está abierta,
  // `window.open` con el mismo nombre devuelve esa ventana tal cual está y solo
  // la traemos al frente — si le pasáramos la URL la recargaría y el cajero
  // perdería el ticket que estaba armando. Recién si viene en blanco (o sea, es
  // nueva) la mandamos a destino.
  let ventana: Window | null = null;
  try {
    ventana = window.open(
      '',
      nombre,
      `popup=yes,width=${ancho},height=${alto},left=${izquierda},top=${arriba},resizable=yes,scrollbars=yes`,
    );
  } catch {
    return false;
  }
  if (!ventana) return false; // el navegador la bloqueó

  // Dirección absoluta: la ventana recién creada arranca en about:blank, y una
  // ruta relativa ahí no siempre se resuelve contra el sitio.
  const destino = window.location.origin + ruta;
  const caminoDestino = new URL(destino).pathname;
  try {
    const actual = ventana.location.href;
    // Solo se deja quieta si YA está en la ruta pedida: ahí recargarla le haría
    // perder al cajero el ticket que está armando, o al cocinero el conteo que
    // está escribiendo.
    //
    // En cualquier otra dirección hay que mandarla igual. Si no, pasa esto: el
    // cajero toca "Salir al ERP", la ventana queda en /caja, y desde ahí
    // "Abrir la caja" la encuentra por el nombre, no la navega y solo la trae
    // al frente. El botón parece muerto y, como el popup no tiene barra de
    // direcciones, la única salida es cerrarlo a mano.
    const yaEstaEnDestino =
      !!actual && actual !== 'about:blank' && new URL(actual).pathname === caminoDestino;
    if (!yaEstaEnDestino) ventana.location.href = destino;
  } catch {
    // no se pudo leer la dirección (quedó en otro dominio): la mandamos igual
    ventana.location.href = destino;
  }
  ventana.focus();
  return true;
}

/**
 * `true` cuando este documento ES una ventana aparte (la abrió otra ventana).
 *
 * Se usa para decidir cómo se sale: la ventana propia se cierra, y la pestaña
 * normal vuelve al ERP.
 */
export function esVentanaAparte(): boolean {
  return typeof window !== 'undefined' && !!window.opener;
}
