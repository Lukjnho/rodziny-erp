/**
 * El pizarrón de la fábrica se abre en su propia ventana, igual que la caja: la
 * tablet queda mostrando solo el stock, sin el menú del ERP al costado.
 *
 * La mecánica está en `ventanaPantalla.ts`, compartida con la caja. Acá quedan
 * solo los datos DEL PIZARRÓN.
 *
 * ⚠️ LANDMINE: la llamada TIENE que salir de un click del usuario, o el
 * navegador la bloquea como ventana emergente sin avisar.
 */

/** Nombre fijo: así nunca se abren dos pizarrones al mismo tiempo. */
export const NOMBRE_VENTANA_PIZARRON = 'rodziny-pizarron';

/**
 * La vista de la cámara de congelado (la tablet del depósito).
 *
 * La ruta es pública a propósito — se lee sin sesión, como el QR de producción.
 * Cuando se agreguen las otras estaciones van como `?vista=porcionar` (sala de
 * producción) y `?vista=cocina`, misma ruta y misma cuenta por debajo.
 */
export const RUTA_PIZARRON_CAMARA = '/pizarron?vista=camara&local=vedia';
