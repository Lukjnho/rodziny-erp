/**
 * La caja se abre en su propia ventana, como el POS de Odoo: el cajero queda
 * con el punto de venta solo delante y el ERP sigue vivo en la ventana de atrás.
 *
 * La mecánica de la ventana vive en `ventanaPantalla.ts`, compartida con el
 * pizarrón de la fábrica. Acá quedan solo los datos de LA CAJA.
 *
 * ⚠️ LANDMINE: esto TIENE que salir de un click del usuario. Si se llama desde
 * un efecto, un timeout o después de un `await`, el navegador lo trata como
 * ventana emergente y lo bloquea sin avisar. Por eso la única llamada real está
 * en el onClick del ítem "Caja" del menú y en el botón del panel.
 */

import { abrirVentanaAparte, esVentanaAparte } from './ventanaPantalla';

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
  return abrirVentanaAparte({ nombre: NOMBRE_VENTANA_CAJA, ruta: RUTA_POS });
}

/**
 * `true` cuando este documento es la ventana aparte de la caja.
 *
 * Se usa para decidir cómo se sale: la ventana propia se cierra, y la pestaña
 * normal vuelve al ERP.
 */
export function esVentanaDeCaja(): boolean {
  return esVentanaAparte();
}
