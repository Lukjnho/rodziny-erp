// Helper compartido para procesar comprobantes de pago vía OCR (Claude Haiku).
// Se usa en los modales de pago (PagarGastoModal cta cte, ChecklistPagos pagos fijos)
// para auto-detectar el N° de operación al subir un comprobante de MP/Galicia/etc.
//
// Flujo:
//   1. Calcula SHA256 del archivo
//   2. Limpia comprobantes huérfanos previos con mismo hash (evita unique conflict)
//   3. Sube el archivo a Storage (`gastos-comprobantes/{subfolder}/{YYYY-MM}/...`)
//   4. Crea fila en `comprobantes` con ocr_status='pending'
//   5. Invoca edge function `ocr-comprobante` (Claude Haiku 4.5 vision)
//   6. Devuelve { file_path, n_operacion, medio_pago } para que el modal autocomplete
//
// Si el OCR falla o no detecta N° op: el archivo igual quedó subido y el modal
// puede continuar con datos manuales. Si el upload falla: error fatal.

import { supabase } from './supabase';
import { comprimirImagen, extensionDe, OPTS_OCR } from './comprimirImagen';
import { sha256File } from './hashFile';
import { mensajeErrorEdgeFunction } from './erroresSupabase';

interface OcrExtraidoMin {
  n_operacion: string | null;
  medio_pago: string | null;
  monto: number | null;
  fecha: string | null;
  fecha_pago_cheque?: string | null;
  banco_origen?: string | null;
  confianza: number;
  es_transferencia_interna?: boolean;
  proveedor_cuit?: string | null;
}

// Extrae el N° de operación del NOMBRE del archivo. MercadoPago descarga como
// `mercadopago_comprobante_payment-NNNNNN.pdf` (el ID es el N° de operación) y
// varios bancos también lo meten en el nombre. Sirve de fallback inmediato: se
// completa apenas se elige el archivo, antes de que vuelva el OCR (~3-5s), y el
// OCR después lo pisa con lo que realmente dice el comprobante.
// Retorna null si no encuentra match — en ese caso el usuario tipea manual.
export function extraerNroOperacion(filename: string): string | null {
  const sinExt = filename.replace(/\.[^.]+$/, '');
  // Patrones de mayor a menor especificidad
  const patrones = [
    /payment[-_](\d{8,20})/i,
    /comprobante[-_](\d{8,20})/i,
    /mercadopago[-_]?(\d{8,20})/i,
    /\bmp[-_](\d{8,20})/i,
    /transfer(?:encia)?[-_](\d{8,20})/i,
  ];
  for (const re of patrones) {
    const m = sinExt.match(re);
    if (m) return m[1];
  }
  // Fallback: la última secuencia larga de dígitos del nombre
  const matches = sinExt.match(/\d{10,20}/g);
  if (matches && matches.length > 0) return matches[matches.length - 1];
  return null;
}

interface OcrResponse {
  ok: boolean;
  ocr_extraido?: OcrExtraidoMin;
  duplicados?: Array<{ match_type: string }>;
  error?: string;
}

export interface ProcesarComprobantePagoResult {
  ok: boolean;
  /** Path en Storage `gastos-comprobantes`. Se reusa al confirmar el pago. */
  file_path: string | null;
  comprobante_id: string | null;
  /** N° de operación extraído por OCR (puede ser null si no lo detectó). */
  n_operacion: string | null;
  /** Medio de pago detectado por OCR (transferencia, qr, etc.). */
  medio_pago_detectado: string | null;
  /** Banco/billetera de origen que leyó el OCR. Junto con el medio permite elegir
   *  la opción concreta del ERP (transferencia_mp vs transferencia_galicia…). */
  banco_origen_detectado: string | null;
  /** Monto detectado por OCR (para advertir si no coincide con el saldo). */
  monto_detectado: number | null;
  /** Fecha detectada por OCR (YYYY-MM-DD). En cheques es la fecha de emisión. */
  fecha_detectada: string | null;
  /** Fecha de pago / débito futuro del cheque-ECHEQ (YYYY-MM-DD). null si no es cheque. */
  fecha_pago_cheque_detectada: string | null;
  /** 0..1 — qué tan confiable fue la lectura. */
  confianza: number;
  /** El N° de op ya fue cargado antes (otro pago en el sistema). */
  duplicado_n_operacion: boolean;
  /** El comprobante es una transferencia entre cuentas propias (no es pago a tercero). */
  es_transferencia_interna: boolean;
  /** Mensaje no bloqueante para mostrar al usuario. */
  warning: string | null;
  /** Mensaje bloqueante si algo falló sin posibilidad de seguir. */
  error: string | null;
}

export interface ProcesarComprobantePagoOpts {
  archivo: File;
  /** Carpeta dentro de `gastos-comprobantes` (ej: 'pagos-fijos', 'vedia/2026-05'). */
  subfolder: string;
  userId: string | null;
}

const RESULT_VACIO: Omit<ProcesarComprobantePagoResult, 'ok' | 'error' | 'file_path' | 'comprobante_id'> = {
  n_operacion: null,
  medio_pago_detectado: null,
  banco_origen_detectado: null,
  monto_detectado: null,
  fecha_detectada: null,
  fecha_pago_cheque_detectada: null,
  confianza: 0,
  duplicado_n_operacion: false,
  es_transferencia_interna: false,
  warning: null,
};

export async function procesarComprobantePago(
  opts: ProcesarComprobantePagoOpts,
): Promise<ProcesarComprobantePagoResult> {
  const { archivo, subfolder, userId } = opts;

  try {
    const fileHash = await sha256File(archivo);

    // ¿Ya existe un comprobante con este MISMO archivo (mismo hash)? Reusarlo en
    // vez de re-subir: subir de nuevo el mismo PDF choca contra UNIQUE(hash_archivo)
    // y dejaba al usuario con "completá a mano". Reusamos la fila existente y
    // forzamos un OCR fresco (la edge function corre con service-role). Sirve tanto
    // para un huérfano de un intento anterior como para un comprobante ya vinculado
    // a otro gasto (mismo archivo → misma lectura).
    const { data: existente } = await supabase
      .from('comprobantes')
      .select('id, file_path, gasto_id')
      .eq('hash_archivo', fileHash)
      .maybeSingle();

    const reusado = !!existente;
    const yaVinculado = !!existente?.gasto_id;
    let comprobanteId: string;
    let path: string;

    if (existente) {
      comprobanteId = existente.id;
      path = existente.file_path;
    } else {
      // Subir a Storage. OJO: extensión, contentType y mime_type salen del archivo
      // YA COMPRIMIDO, no del original. `comprimirImagen` re-encodea a JPEG, así que
      // declarar el mime del original (ej: image/png) mandaba a la API de Anthropic
      // bytes JPEG con media_type image/png → 400 y "no se pudo leer el comprobante".
      const archivoSubir = await comprimirImagen(archivo, OPTS_OCR);
      const mimeSubido = archivoSubir.type || 'application/octet-stream';
      const ext = extensionDe(archivoSubir);
      const periodo = new Date().toISOString().slice(0, 7);
      path = `${subfolder}/${periodo}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

      const { error: errUp } = await supabase.storage
        .from('gastos-comprobantes')
        .upload(path, archivoSubir, { contentType: mimeSubido });
      if (errUp) {
        return {
          ok: false,
          file_path: null,
          comprobante_id: null,
          ...RESULT_VACIO,
          error: `Error subiendo archivo: ${errUp.message}`,
        };
      }

      // Registrar comprobante
      const { data: insComp, error: errInsComp } = await supabase
        .from('comprobantes')
        .insert({
          hash_archivo: fileHash,
          file_path: path,
          // mime/tamaño del archivo REAL en Storage (el comprimido): la edge function
          // usa mime_type como media_type al llamar a la API de vision.
          mime_type: mimeSubido,
          tamano_bytes: archivoSubir.size,
          subido_por: userId,
          ocr_status: 'pending',
          estado: 'huerfano',
        })
        .select('id')
        .single();
      if (errInsComp) {
        // Storage OK pero DB falló: igual devolvemos el path para que el modal pueda
        // usarlo (la asociación con el pago hace que el archivo no quede huérfano).
        return {
          ok: true,
          file_path: path,
          comprobante_id: null,
          ...RESULT_VACIO,
          warning: `No se pudo registrar el comprobante (${errInsComp.message}). Completá los datos manualmente.`,
          error: null,
        };
      }
      comprobanteId = insComp.id;
    }

    // Invocar OCR (force cuando reusamos: re-extrae aunque ya estuviera 'completed').
    const { data: ocrRes, error: errOcr } = await supabase.functions.invoke<OcrResponse>(
      'ocr-comprobante',
      { body: { comprobante_id: comprobanteId, force: reusado } },
    );

    if (errOcr || !ocrRes?.ok) {
      // El .message de supabase-js no dice nada cuando la function responde 500
      // ("Edge Function returned a non-2xx status code"): el motivo real (sin saldo,
      // saturado, archivo no soportado…) viaja en el CUERPO de la respuesta y lo
      // desenvuelve mensajeErrorEdgeFunction. El fail-open no cambia: el archivo
      // ya quedó subido y se sigue cargando a mano.
      console.warn('[ocrComprobantePago] el OCR falló:', errOcr ?? ocrRes?.error);
      const motivo = await mensajeErrorEdgeFunction(
        errOcr ?? ocrRes?.error,
        '⚠️ No se pudo leer el comprobante',
      );
      return {
        ok: true,
        file_path: path,
        comprobante_id: comprobanteId,
        ...RESULT_VACIO,
        warning: `${motivo} Completá manualmente el N° de operación.`,
        error: null,
      };
    }

    const extraido = ocrRes.ocr_extraido!;
    const tieneDupOp = (ocrRes.duplicados ?? []).some((d) => d.match_type === 'n_operacion');

    let warning: string | null = null;
    if (yaVinculado) {
      warning = '⚠️ Este mismo archivo (mismo hash) ya está vinculado a otro gasto. Verificá que no sea un duplicado.';
    } else if (tieneDupOp) {
      warning = `⚠️ El N° de operación ${extraido.n_operacion} ya fue cargado en otro pago. Verificá antes de confirmar.`;
    } else if (extraido.es_transferencia_interna) {
      warning = 'ℹ️ Este comprobante parece una transferencia entre cuentas propias de Rodziny — verificá.';
    }

    return {
      ok: true,
      file_path: path,
      comprobante_id: comprobanteId,
      n_operacion: extraido.n_operacion,
      medio_pago_detectado: extraido.medio_pago,
      banco_origen_detectado: extraido.banco_origen ?? null,
      monto_detectado: extraido.monto,
      fecha_detectada: extraido.fecha,
      fecha_pago_cheque_detectada: extraido.fecha_pago_cheque ?? null,
      confianza: extraido.confianza ?? 0,
      duplicado_n_operacion: tieneDupOp,
      es_transferencia_interna: !!extraido.es_transferencia_interna,
      warning,
      error: null,
    };
  } catch (e) {
    return {
      ok: false,
      file_path: null,
      comprobante_id: null,
      ...RESULT_VACIO,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
