/**
 * La caja se abre en su propia ventana, como el POS de Odoo: el cajero queda
 * con el punto de venta solo delante y el ERP sigue vivo en la ventana de atrás.
 *
 * ⚠️ LANDMINE: esto TIENE que salir de un click del usuario. Si se llama desde
 * un efecto, un timeout o después de un `await`, el navegador lo trata como
 * ventana emergente y lo bloquea sin avisar. Por eso la única llamada real está
 * en el onClick del ítem "Caja" del menú y en el botón del panel.
 */

/** Nombre fijo de la ventana: así nunca se abren dos cajas al mismo tiempo. */
export const NOMBRE_VENTANA_CAJA = 'rodziny-caja';

/** La ruta del punto de venta a pantalla completa (sin menú lateral). */
export const RUTA_POS = '/caja/pos';

/**
 * Abre (o trae al frente) la ventana de la caja.
 *
 * Devuelve `false` si el navegador la bloqueó, para que quien llame pueda caer
 * en el plan B: entrar al POS en la misma pestaña.
 */
export function abrirVentanaCaja(): boolean {
  if (typeof window === 'undefined') return false;

  const ancho = Math.min(1440, window.screen.availWidth);
  const alto = Math.min(920, window.screen.availHeight);
  const izquierda = Math.max(0, Math.round((window.screen.availWidth - ancho) / 2));
  const arriba = Math.max(0, Math.round((window.screen.availHeight - alto) / 2));

  // Se pide SIN dirección a propósito. Si la caja ya está abierta, `window.open`
  // con el mismo nombre devuelve esa ventana tal cual está y solo la traemos al
  // frente — si le pasáramos la URL la recargaría y el cajero perdería el
  // ticket que estaba armando. Recién si viene en blanco (o sea, es nueva) la
  // mandamos al POS.
  let ventana: Window | null = null;
  try {
    ventana = window.open(
      '',
      NOMBRE_VENTANA_CAJA,
      `popup=yes,width=${ancho},height=${alto},left=${izquierda},top=${arriba},resizable=yes,scrollbars=yes`,
    );
  } catch {
    return false;
  }
  if (!ventana) return false; // el navegador la bloqueó

  // Dirección absoluta: la ventana recién creada arranca en about:blank, y una
  // ruta relativa ahí no siempre se resuelve contra el sitio.
  const destino = window.location.origin + RUTA_POS;
  try {
    const actual = ventana.location.href;
    // Solo se deja quieta si YA está en el punto de venta: ahí recargarla le
    // haría perder al cajero el ticket que está armando.
    //
    // En cualquier otra dirección hay que mandarla igual. Si no, pasa esto: el
    // cajero toca "Salir al ERP" (aparece cuando se cerró la pestaña que abrió
    // la caja), la ventana queda en /caja, y desde ahí "Abrir la caja" la
    // encuentra por el nombre, no la navega y solo la trae al frente. El botón
    // parece muerto y, como el popup no tiene barra de direcciones, la única
    // salida es cerrarlo a mano.
    const yaEstaEnElPos =
      !!actual && actual !== 'about:blank' && new URL(actual).pathname === RUTA_POS;
    if (!yaEstaEnElPos) ventana.location.href = destino;
  } catch {
    // no se pudo leer la dirección (quedó en otro dominio): la mandamos al POS
    ventana.location.href = destino;
  }
  ventana.focus();
  return true;
}

/**
 * `true` cuando este documento es la ventana aparte de la caja.
 *
 * Se usa para decidir cómo se sale: la ventana propia se cierra, y la pestaña
 * normal vuelve al ERP.
 */
export function esVentanaDeCaja(): boolean {
  return typeof window !== 'undefined' && !!window.opener;
}
