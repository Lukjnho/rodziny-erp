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

const ES_IMAGEN = /^image\/(jpe?g|png|webp)$/i;

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
