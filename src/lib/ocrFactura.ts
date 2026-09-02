// Helper para procesar la factura fiscal del proveedor vía OCR (Claude Haiku 4.5).
// Se usa en NuevoGastoForm cuando el usuario sube el archivo de la factura.
//
// Flujo:
//   1. Calcula SHA256 del archivo
//   2. Limpia comprobantes huérfanos previos con mismo hash
//   3. Sube a Storage `gastos-comprobantes/facturas/{YYYY-MM}/...`
//   4. Crea fila en `comprobantes` con ocr_status='pending'
//   5. Invoca edge function `ocr-factura`
//   6. Devuelve los datos extraídos + match de proveedor por CUIT (si lo hay)
//
// Si el OCR falla: el archivo igual quedó subido y el form puede continuar manual.
// Si el upload falla: error fatal (el modal muestra el error).

import { supabase } from './supabase';
import { comprimirImagen, extensionDe, OPTS_OCR } from './comprimirImagen';
import { sha256File } from './hashFile';
import { mensajeErrorEdgeFunction } from './erroresSupabase';

interface OcrFacturaExtraido {
  tipo_comprobante: string | null;
  punto_venta: string | null;
  numero_comprobante: string | null;
  nro_completo: string | null;
  emisor_razon_social: string | null;
  emisor_nombre_fantasia: string | null;
  emisor_cuit: string | null;
  emisor_condicion_iva: string | null;
  fecha_emision: string | null;
  fecha_vencimiento: string | null;
  importe_neto: number | null;
  iva: number | null;
  alicuota_iva: number | null;
  iibb: number | null;
  percepciones: number | null;
  importe_total: number | null;
  cae: string | null;
  confianza: number;
}

interface ProveedorMatch {
  id: string;
  razon_social: string | null;
  nombre_comercial: string | null;
  cuit: string | null;
}

interface OcrFacturaResponse {
  ok: boolean;
  ocr_extraido?: OcrFacturaExtraido;
  proveedor_match?: ProveedorMatch | null;
  error?: string;
}

export interface ProcesarFacturaResult {
  ok: boolean;
  /** Path en Storage `gastos-comprobantes` — el form lo reusa al guardar el gasto. */
  factura_path: string | null;
  comprobante_id: string | null;
  /** Datos extraídos por OCR (campos pueden ser null individualmente). */
  datos: OcrFacturaExtraido | null;
  /** Proveedor del ERP que matcheó con el CUIT del emisor (null si no hay match o no detectó CUIT). */
  proveedor_match: ProveedorMatch | null;
  /** Mensaje no bloqueante para el usuario. */
  warning: string | null;
  /** Error bloqueante (típicamente upload falló). */
  error: string | null;
}

export interface ProcesarFacturaOpts {
  archivo: File;
  /** Carpeta dentro de `gastos-comprobantes`. Ej: 'facturas/2026-05'. */
  subfolder?: string;
  userId: string | null;
}

const RESULT_VACIO: Omit<ProcesarFacturaResult, 'ok' | 'error' | 'factura_path' | 'comprobante_id'> = {
  datos: null,
  proveedor_match: null,
  warning: null,
};

export async function procesarFactura(
  opts: ProcesarFacturaOpts,
): Promise<ProcesarFacturaResult> {
  const { archivo, userId } = opts;
  const subfolder = opts.subfolder ?? `facturas/${new Date().toISOString().slice(0, 7)}`;

  try {
    const fileHash = await sha256File(archivo);

    // Limpiar huérfanos previos con mismo hash para evitar conflict con UNIQUE(hash_archivo)
    await supabase
      .from('comprobantes')
      .delete()
      .eq('hash_archivo', fileHash)
      .is('gasto_id', null);

    // Subir a Storage. Extensión/contentType/mime salen del archivo YA COMPRIMIDO
    // (comprimirImagen re-encodea a JPEG) — si no, el media_type que recibe la API
    // de vision no coincide con los bytes y la lectura falla.
    const archivoSubir = await comprimirImagen(archivo, OPTS_OCR);
    const mimeSubido = archivoSubir.type || 'application/octet-stream';
    const ext = extensionDe(archivoSubir);
    const path = `${subfolder}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const { error: errUp } = await supabase.storage
      .from('gastos-comprobantes')
      .upload(path, archivoSubir, { contentType: mimeSubido });
    if (errUp) {
      return {
        ok: false,
        factura_path: null,
        comprobante_id: null,
        ...RESULT_VACIO,
        error: `Error subiendo factura: ${errUp.message}`,
      };
    }

    // Registrar comprobante
    const { data: insComp, error: errInsComp } = await supabase
      .from('comprobantes')
      .insert({
        hash_archivo: fileHash,
        file_path: path,
        // mime/tamaño del archivo REAL en Storage (el comprimido).
        mime_type: mimeSubido,
        tamano_bytes: archivoSubir.size,
        subido_por: userId,
        ocr_status: 'pending',
        estado: 'huerfano',
      })
      .select('id')
      .single();
    if (errInsComp) {
      // Storage OK pero DB falló: devolvemos el path para que el form siga usándolo
      return {
        ok: true,
        factura_path: path,
        comprobante_id: null,
        ...RESULT_VACIO,
        warning: `No se pudo registrar la factura en la base (${errInsComp.message}). Podés continuar a mano.`,
        error: null,
      };
    }

    // Invocar OCR
    const { data: ocrRes, error: errOcr } = await supabase.functions.invoke<OcrFacturaResponse>(
      'ocr-factura',
      { body: { comprobante_id: insComp.id } },
    );

    if (errOcr || !ocrRes?.ok) {
      // Mismo caso que en ocrComprobantePago: el motivo real está en el cuerpo de
      // la respuesta 500, no en el .message genérico que entrega supabase-js.
      console.warn('[ocrFactura] el OCR falló:', errOcr ?? ocrRes?.error);
      const motivo = await mensajeErrorEdgeFunction(
        errOcr ?? ocrRes?.error,
        '⚠️ No se pudo leer la factura',
      );
      return {
        ok: true,
        factura_path: path,
        comprobante_id: insComp.id,
        ...RESULT_VACIO,
        warning: `${motivo} Completá los datos manualmente.`,
        error: null,
      };
    }

    const datos = ocrRes.ocr_extraido!;
    const proveedorMatch = ocrRes.proveedor_match ?? null;

    let warning: string | null = null;
    if (datos.confianza < 0.5) {
      warning = `⚠️ La lectura de la factura tiene poca confianza (${Math.round(datos.confianza * 100)}%). Revisá los datos antes de guardar.`;
    } else if (datos.emisor_cuit && !proveedorMatch) {
      warning = `ℹ️ CUIT del emisor (${datos.emisor_cuit}) no coincide con ningún proveedor cargado. Podés crear uno nuevo con estos datos.`;
    }

    return {
      ok: true,
      factura_path: path,
      comprobante_id: insComp.id,
      datos,
      proveedor_match: proveedorMatch,
      warning,
      error: null,
    };
  } catch (e) {
    return {
      ok: false,
      factura_path: null,
      comprobante_id: null,
      ...RESULT_VACIO,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
