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
import { sha256File } from './hashFile';

interface OcrExtraidoMin {
  n_operacion: string | null;
  medio_pago: string | null;
  monto: number | null;
  fecha: string | null;
  confianza: number;
  es_transferencia_interna?: boolean;
  proveedor_cuit?: string | null;
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
  /** Monto detectado por OCR (para advertir si no coincide con el saldo). */
  monto_detectado: number | null;
  /** Fecha detectada por OCR (YYYY-MM-DD). */
  fecha_detectada: string | null;
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
  monto_detectado: null,
  fecha_detectada: null,
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

    // Si ya existe un comprobante con este hash YA VINCULADO a un gasto: avisar
    // pero NO bloquear — el usuario puede querer cargar el mismo PDF para un pago
    // distinto del mismo gasto, o estar viendo un duplicado real (lo decide él).
    const { data: yaVinculado } = await supabase
      .from('comprobantes')
      .select('id, gasto_id')
      .eq('hash_archivo', fileHash)
      .not('gasto_id', 'is', null)
      .maybeSingle();

    // Limpiar huérfanos previos con mismo hash para evitar conflict con UNIQUE(hash_archivo)
    await supabase
      .from('comprobantes')
      .delete()
      .eq('hash_archivo', fileHash)
      .is('gasto_id', null);

    // Subir a Storage
    const ext = archivo.name.split('.').pop()?.toLowerCase() ?? 'bin';
    const periodo = new Date().toISOString().slice(0, 7);
    const path = `${subfolder}/${periodo}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const { error: errUp } = await supabase.storage
      .from('gastos-comprobantes')
      .upload(path, archivo, { contentType: archivo.type || 'application/octet-stream' });
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
        mime_type: archivo.type || null,
        tamano_bytes: archivo.size,
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

    // Invocar OCR
    const { data: ocrRes, error: errOcr } = await supabase.functions.invoke<OcrResponse>(
      'ocr-comprobante',
      { body: { comprobante_id: insComp.id } },
    );

    if (errOcr || !ocrRes?.ok) {
      const msg = errOcr?.message ?? ocrRes?.error ?? 'OCR no respondió';
      return {
        ok: true,
        file_path: path,
        comprobante_id: insComp.id,
        ...RESULT_VACIO,
        warning: `No se pudo leer el comprobante (${msg}). Completá manualmente el N° de operación.`,
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
      comprobante_id: insComp.id,
      n_operacion: extraido.n_operacion,
      medio_pago_detectado: extraido.medio_pago,
      monto_detectado: extraido.monto,
      fecha_detectada: extraido.fecha,
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
