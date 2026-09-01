/**
 * Aviso entre ventanas de la caja.
 *
 * El punto de venta vive en una ventana aparte, y cada ventana del navegador
 * tiene su propia copia de los datos en memoria. Cuando el cajero abre o cierra
 * un turno en el POS, la ventana del ERP no se entera: el menú lateral se queda
 * diciendo "Turno en curso" con el arqueo ya cerrado hasta que la consulta se
 * vence sola (un minuto) o alguien vuelve a hacerle foco a esa ventana.
 *
 * Esto avisa a todas las ventanas del sitio en el momento.
 */

const CANAL = 'rodziny-caja';

/**
 * Plan B para navegadores sin BroadcastChannel: escribir en `localStorage`
 * dispara el evento `storage` en las OTRAS ventanas del mismo sitio (nunca en
 * la que escribe, que es justo lo que queremos).
 */
const CLAVE = 'rodziny-caja-aviso';

function abrirCanal(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  try {
    return new BroadcastChannel(CANAL);
  } catch {
    return null;
  }
}

/** Se llama después de abrir o cerrar un turno, para que el resto se entere. */
export function avisarCambioDeTurno(): void {
  if (typeof window === 'undefined') return;

  const canal = abrirCanal();
  if (canal) {
    try {
      canal.postMessage('turno');
    } finally {
      canal.close();
    }
  }

  try {
    // El valor tiene que CAMBIAR para que dispare el evento en las otras
    // ventanas; por eso va la hora y no una constante.
    window.localStorage.setItem(CLAVE, String(Date.now()));
  } catch {
    // navegación privada con el almacenamiento bloqueado: alcanza con el canal
  }
}

/**
 * Escucha los avisos que mandan las otras ventanas.
 * Devuelve la función para dejar de escuchar.
 */
export function escucharCambioDeTurno(alCambiar: () => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const canal = abrirCanal();
  if (canal) canal.onmessage = () => alCambiar();

  const porAlmacenamiento = (e: StorageEvent) => {
    if (e.key === CLAVE) alCambiar();
  };
  window.addEventListener('storage', porAlmacenamiento);

  return () => {
    if (canal) canal.close();
    window.removeEventListener('storage', porAlmacenamiento);
  };
}
