// Compresión de imágenes en el browser antes de subir a Storage.
// Motivo: las fotos de celular llegan a 3+ MB y llenan la cuota de Storage.
// Redimensiona al lado máximo y re-encodea a JPEG. Los PDF (y cualquier
// no-imagen) pasan intactos. Si algo falla, devuelve el original: NUNCA
// debe romper una subida por intentar comprimir.
//
// Misma técnica (canvas + toBlob) que ya se usa para las selfies de fichaje,
// acá parametrizada y con más resolución para que los comprobantes se lean.

export interface ComprimirOpts {
  /** Lado máximo (px) del lado más largo. Default 2000 (legible para comprobantes). */
  maxLado?: number;
  /** Calidad JPEG 0–1. Default 0.72. */
  quality?: number;
}

/**
 * Preset para archivos que van a pasar por OCR (comprobantes de pago, facturas).
 * Más resolución y menos compresión que el default: el "N° de operación" de
 * Mercado Pago va en gris chico al pie y a 0.72 se borronea → el OCR devolvía null.
 * No es el default global para no inflar Storage en fotos que nadie lee (recepciones,
 * selfies de fichaje).
 */
export const OPTS_OCR: ComprimirOpts = { maxLado: 2400, quality: 0.88 };

const ES_IMAGEN = /^image\/(jpe?g|png|webp)$/i;

/**
 * Detecta fotos en formato HEIC/HEIF (el que usa el iPhone por defecto).
 *
 * Por qué existe: `comprimirImagen` no toca estos archivos (no matchean ES_IMAGEN),
 * y tampoco podría: ningún navegador de escritorio sabe decodificar HEIC, así que el
 * canvas no sirve. El archivo sube crudo y la edge function de OCR termina mandándole
 * a la API de lectura bytes HEIC etiquetados como JPEG (ver normalizeMediaType) → error
 * 400 con un texto técnico que no le dice nada a nadie. Conviene cortar antes.
 *
 * Mira el nombre además del mime porque en Windows, sin el complemento HEIF instalado,
 * el navegador devuelve `file.type` vacío y la extensión queda como única pista.
 */
export function esArchivoHeic(file: File): boolean {
  const mime = (file.type || '').toLowerCase();
  // Cubre image/heic, image/heif y sus variantes -sequence.
  if (/^image\/hei[cf]/.test(mime)) return true;
  return /\.(heic|heif)$/i.test(file.name || '');
}

/**
 * Texto para mostrarle a la persona cuando sube una foto HEIC. Sin jerga: qué pasó
 * y las tres salidas concretas, de la más rápida a la definitiva.
 * Se muestra con `whitespace-pre-line` para que los saltos de línea se respeten.
 */
export const MENSAJE_HEIC =
  'Esta foto está en formato HEIC, el que usa el iPhone por defecto, y el sistema no puede leerla.\n\n' +
  'Se resuelve con cualquiera de estas tres:\n' +
  '• Mandátela por WhatsApp a vos misma y descargá la que llega: WhatsApp la convierte a JPG sola.\n' +
  '• Sacá la foto directamente con el botón de cámara de esta pantalla.\n' +
  '• En el iPhone entrá a Ajustes › Cámara › Formatos y elegí "Más compatible": desde ahí todas las fotos nuevas salen en JPG.';

const EXT_POR_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
};

/**
 * Extensión coherente con el CONTENIDO del archivo, no con su nombre original.
 * Necesario porque `comprimirImagen` re-encodea a JPEG: si tomábamos la extensión
 * del nombre, un PNG comprimido quedaba guardado como `.png` con bytes JPEG.
 */
export function extensionDe(file: File): string {
  const porMime = EXT_POR_MIME[(file.type || '').toLowerCase()];
  if (porMime) return porMime;
  return file.name.split('.').pop()?.toLowerCase() || 'bin';
}

/**
 * Comprime una imagen si conviene; si no es imagen o falla, devuelve el archivo original.
 * Devuelve siempre un File (con nombre .jpg cuando comprime) listo para `.upload()`.
 */
export async function comprimirImagen(file: File, opts: ComprimirOpts = {}): Promise<File> {
  const maxLado = opts.maxLado ?? 2000;
  const quality = opts.quality ?? 0.72;

  // No-imagen (PDF, etc.) → intacto.
  if (!ES_IMAGEN.test(file.type)) return file;

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const i = new Image();
      i.onload = () => {
        URL.revokeObjectURL(url);
        resolve(i);
      };
      i.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(e);
      };
      i.src = url;
    });

    const escala = Math.min(1, maxLado / Math.max(img.width, img.height));
    const w = Math.round(img.width * escala);
    const h = Math.round(img.height * escala);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, w, h);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', quality);
    });
    // Si no se pudo comprimir o quedó más grande que el original, uso el original.
    if (!blob || blob.size >= file.size) return file;

    const nombre = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], nombre, { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return file;
  }
}
