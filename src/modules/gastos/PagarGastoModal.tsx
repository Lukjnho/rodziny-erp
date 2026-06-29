// PagarGastoModal — modal único para registrar el pago de un gasto pendiente.
//
// Este es EL modal canónico de pagos. Lo invocan los tabs "Pagos" del módulo
// Gastos y de Compras. Soporta:
//   - Pagos parciales (saldo restante, "Pagar todo / Mitad")
//   - Descuento por pronto pago (se acredita junto al monto contra el saldo)
//   - Archivo de comprobante de pago (obligatorio si medio ≠ efectivo)
//   - Archivo de factura del proveedor (opcional, si el gasto no la tenía)
//
// Reglas de cierre del gasto:
//   - 'Pagado' si SUM(monto+descuento) cubre el importe total
//   - 'Parcial' si cubre algo pero no todo
//   - 'Pendiente' si nadie pagó nada (caso bordeantes — no debería pasar acá)

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { cn, formatARS } from '@/lib/utils';
import { procesarComprobantePago } from '@/lib/ocrComprobantePago';
import { MEDIO_PAGO_LABEL, medioRequiereComprobante, type MedioPago, type Gasto, type PagoGasto } from './types';
import { recomputarEstadoGasto } from './recomputarEstadoGasto';
import { useProveedoresMap, nombreProveedor } from './proveedorDisplay';

interface Props {
  open: boolean;
  gasto: Gasto | null;
  onClose: () => void;
}

function formatNumeroAR(value: number): string {
  if (!isFinite(value)) return '';
  const tieneDecimales = Math.round(value * 100) % 100 !== 0;
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: tieneDecimales ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function parseNumeroAR(text: string): number | null {
  if (!text || !text.trim()) return null;
  let limpio = text.trim().replace(/[^\d,.\-]/g, '');
  limpio = limpio.replace(/\./g, '').replace(',', '.');
  const num = parseFloat(limpio);
  return isFinite(num) ? num : null;
}

function formatError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e !== null) {
    const obj = e as Record<string, unknown>;
    if (typeof obj.message === 'string') {
      const detalles =
        (obj.details as string | undefined) ||
        (obj.hint as string | undefined) ||
        (obj.code as string | undefined);
      return detalles ? `${obj.message} [${detalles}]` : String(obj.message);
    }
    try { return JSON.stringify(obj).slice(0, 300); } catch { return '[error sin mensaje]'; }
  }
  return String(e);
}

// Extrae el N° de operación del nombre del archivo de comprobante.
// MercadoPago descarga con nombre `mercadopago_comprobante_payment-NNNNNN.pdf`
// (el ID es el numero de operación). Algunos bancos también lo incluyen.
// Retorna null si no encuentra match — en ese caso el usuario tipea manual.
function extraerNroOperacion(filename: string): string | null {
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

async function abrirArchivoStorage(path: string) {
  const { data } = await supabase.storage
    .from('gastos-comprobantes')
    .createSignedUrl(path, 60);
  if (data?.signedUrl) window.open(data.signedUrl, '_blank');
}

export function PagarGastoModal({ open, gasto, onClose }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: proveedoresMap } = useProveedoresMap({ enabled: open });

  const [fechaPago, setFechaPago] = useState<string>('');
  const [medioPago, setMedioPago] = useState<MedioPago>('transferencia_mp');
  const [importeTexto, setImporteTexto] = useState<string>('');
  const [descuentoTexto, setDescuentoTexto] = useState<string>('');
  const [nOperacion, setNOperacion] = useState<string>('');
  const [archivoComprobante, setArchivoComprobante] = useState<File | null>(null);
  // Path en Storage del comprobante ya subido por OCR (se reusa al confirmar)
  const [comprobantePagoPath, setComprobantePagoPath] = useState<string | null>(null);
  const [ocrEjecutando, setOcrEjecutando] = useState(false);
  const [ocrInfo, setOcrInfo] = useState<string | null>(null);
  const [ocrWarning, setOcrWarning] = useState<string | null>(null);
  const [archivoFactura, setArchivoFactura] = useState<File | null>(null);
  const [notas, setNotas] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Pagos previos del gasto — para calcular saldo pendiente
  const { data: pagosPrevios = [] } = useQuery<(PagoGasto & { descuento?: number | null })[]>({
    queryKey: ['pagos_gastos', gasto?.id],
    enabled: open && !!gasto?.id,
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from('pagos_gastos')
        .select('*')
        .eq('gasto_id', gasto!.id)
        .order('fecha_pago', { ascending: true });
      if (err) throw err;
      return (data ?? []) as (PagoGasto & { descuento?: number | null })[];
    },
  });

  const yaPagado = useMemo(
    () => pagosPrevios.reduce((s, p) => s + Number(p.monto ?? 0), 0),
    [pagosPrevios],
  );
  const yaDescuento = useMemo(
    () => pagosPrevios.reduce((s, p) => s + Number(p.descuento ?? 0), 0),
    [pagosPrevios],
  );
  const importeTotal = gasto ? Number(gasto.importe_total) : 0;
  const saldoPendiente = Math.max(0, importeTotal - yaPagado - yaDescuento);

  // Echeq programados (cuotas a futuro sin debitar). Se confirman cuando sale la plata.
  const pagosProgramados = useMemo(
    () => pagosPrevios.filter((p) => (p as { programado?: boolean }).programado),
    [pagosPrevios],
  );

  const importeNum = useMemo(() => parseNumeroAR(importeTexto) ?? 0, [importeTexto]);
  const descuentoNum = useMemo(() => parseNumeroAR(descuentoTexto) ?? 0, [descuentoTexto]);
  const totalDespuesDelPago = yaPagado + importeNum + yaDescuento + descuentoNum;
  const cubierto = totalDespuesDelPago >= importeTotal - 0.01;

  // Reset al abrir
  useEffect(() => {
    if (open && gasto) {
      setFechaPago(new Date().toISOString().slice(0, 10));
      setMedioPago('transferencia_mp');
      setImporteTexto(formatNumeroAR(saldoPendiente));
      setDescuentoTexto('');
      setNOperacion('');
      setArchivoComprobante(null);
      setComprobantePagoPath(null);
      setOcrEjecutando(false);
      setOcrInfo(null);
      setOcrWarning(null);
      setArchivoFactura(null);
      setNotas('');
      setError(null);
      setGuardando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, gasto?.id, saldoPendiente]);

  if (!open || !gasto) return null;

  async function handleSubirComprobante(file: File | null) {
    setArchivoComprobante(file);
    setComprobantePagoPath(null);
    setOcrInfo(null);
    setOcrWarning(null);
    if (!file) return;

    // Fallback inmediato: leer N° op del nombre del archivo (MP descarga así).
    if (!nOperacion.trim()) {
      const detectado = extraerNroOperacion(file.name);
      if (detectado) setNOperacion(detectado);
    }

    // OCR async: sube el archivo + Claude Haiku extrae N° op real del contenido
    setOcrEjecutando(true);
    try {
      const carpeta = gasto ? `${gasto.local}/${gasto.fecha.substring(0, 7)}` : 'pagos-cta-cte';
      const res = await procesarComprobantePago({
        archivo: file,
        subfolder: carpeta,
        userId: user?.id ?? null,
      });
      if (!res.ok && res.error) {
        setError(res.error);
        return;
      }
      setComprobantePagoPath(res.file_path);
      if (res.n_operacion) {
        // Solo sobreescribimos el N° op si el usuario no había tocado el campo
        // o si el valor actual proviene del nombre del archivo (no editado a mano).
        const actual = nOperacion.trim();
        const provieneDelNombre = !actual || actual === extraerNroOperacion(file.name);
        if (provieneDelNombre) setNOperacion(res.n_operacion);
        const pct = Math.round((res.confianza ?? 0) * 100);
        setOcrInfo(`✓ N° detectado: ${res.n_operacion}${pct ? ` (${pct}% confianza)` : ''}`);
      } else {
        setOcrInfo('Archivo subido. Completá el N° de operación manualmente.');
      }
      if (res.warning) setOcrWarning(res.warning);
    } finally {
      setOcrEjecutando(false);
    }
  }

  const requiereDatosBancarios = medioRequiereComprobante(medioPago);
  const yaTieneComprobante = !!gasto.comprobante_path;
  const yaTieneFactura = !!gasto.factura_path;

  // Confirmar que un echeq programado ya se debitó: deja de ser "a futuro" y el gasto
  // recalcula su estado (puede pasar de Parcial → Pagado).
  async function confirmarDebitoEcheq(pago: PagoGasto) {
    if (!gasto) return;
    if (
      !window.confirm(
        `¿Confirmar que se debitó el echeq de ${formatARS(Number(pago.monto))}?\n\nLa cuota pasa a pagada y el gasto se recalcula.`,
      )
    )
      return;
    setGuardando(true);
    try {
      const { error: errUpd } = await supabase
        .from('pagos_gastos')
        .update({ programado: false })
        .eq('id', pago.id);
      if (errUpd) throw errUpd;
      await recomputarEstadoGasto(gasto.id);
      qc.invalidateQueries({ queryKey: ['pagos_gastos'] });
      qc.invalidateQueries({ queryKey: ['gastos_listado'] });
      qc.invalidateQueries({ queryKey: ['gastos_pagos_pendientes'] });
      qc.invalidateQueries({ queryKey: ['gastos_pagos_rango'] });
      qc.invalidateQueries({ queryKey: ['gastos_resumen_kpis'] });
      onClose();
    } catch (e) {
      setError(formatError(e));
    } finally {
      setGuardando(false);
    }
  }

  async function handleConfirmar() {
    if (!gasto) return;
    setError(null);
    if (!fechaPago) {
      setError('Falta la fecha del pago');
      return;
    }
    if (importeNum < 0 || descuentoNum < 0) {
      setError('Importes no pueden ser negativos');
      return;
    }
    if (importeNum === 0 && descuentoNum === 0) {
      setError('Cargá un importe o un descuento');
      return;
    }
    if (importeNum + descuentoNum > saldoPendiente + 0.01) {
      setError(
        `Importe + descuento (${formatARS(importeNum + descuentoNum)}) supera el saldo pendiente (${formatARS(saldoPendiente)})`,
      );
      return;
    }
    if (requiereDatosBancarios) {
      if (!nOperacion.trim()) {
        setError('N° de operación obligatorio para transferencias, cheques y tarjeta. Copialo del comprobante.');
        return;
      }
      if (!archivoComprobante && !comprobantePagoPath && !yaTieneComprobante) {
        setError('Comprobante de pago obligatorio para transferencias, cheques y tarjeta. Subí la captura o PDF.');
        return;
      }
      if (ocrEjecutando) {
        setError('Esperá a que termine el análisis del comprobante.');
        return;
      }
    }

    setGuardando(true);
    try {
      const carpeta = `${gasto.local}/${gasto.fecha.substring(0, 7)}`;

      // 1) Comprobante: si OCR ya lo subió, reusamos el path. Si no, subimos ahora.
      let pathComprobantePago: string | null = comprobantePagoPath;
      if (!pathComprobantePago && archivoComprobante) {
        const ext = archivoComprobante.name.split('.').pop()?.toLowerCase() || 'pdf';
        const path = `${carpeta}/pago_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: errUp } = await supabase.storage
          .from('gastos-comprobantes')
          .upload(path, archivoComprobante, {
            contentType: archivoComprobante.type || 'application/octet-stream',
          });
        if (errUp) throw errUp;
        pathComprobantePago = path;
      }

      // 2) Subir factura del proveedor si se cargó (y el gasto no la tenía)
      let pathFactura: string | null = gasto.factura_path ?? null;
      if (archivoFactura && !yaTieneFactura) {
        const ext = archivoFactura.name.split('.').pop()?.toLowerCase() || 'pdf';
        const path = `${carpeta}/factura_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: errUp } = await supabase.storage
          .from('gastos-comprobantes')
          .upload(path, archivoFactura, {
            contentType: archivoFactura.type || 'application/octet-stream',
          });
        if (errUp) throw errUp;
        pathFactura = path;
      }

      // 3) Insertar pago. numero_operacion va al campo dedicado para que el
      //    matcher de import concilie por igualdad exacta con el extracto.
      const { data: pagoInsertado, error: errInsert } = await supabase
        .from('pagos_gastos')
        .insert({
          gasto_id: gasto.id,
          fecha_pago: fechaPago,
          monto: importeNum,
          descuento: descuentoNum,
          medio_pago: medioPago,
          numero_operacion: nOperacion.trim() || null,
          comprobante_pago_path: pathComprobantePago,
          notas: notas.trim() || null,
          creado_por: user?.id ?? null,
        })
        .select('id')
        .single();
      if (errInsert) throw errInsert;

      // 3.5) Auto-conciliar con el mov del extracto si hay N° de op cargado.
      //   Match: dígitos de numero_operacion coinciden exactos con dígitos
      //   de referencia, O la referencia es sufijo de los dígitos del N° op
      //   con diferencia máxima de 1 dígito (caso Galicia: el extracto
      //   trunca el primer dígito de los TRANSF. AFIP).
      if (nOperacion.trim() && pagoInsertado?.id) {
        const opDigits = nOperacion.replace(/\D/g, '');
        if (opDigits.length >= 6) {
          // Candidato más amplio: buscamos los últimos N-1 dígitos también
          // para cubrir el caso Galicia (perdió el primer dígito).
          const opTail = opDigits.slice(1);
          const { data: movs } = await supabase
            .from('movimientos_bancarios')
            .select('id, referencia')
            .is('gasto_id', null)
            .gt('debito', 0)
            .or(`referencia.ilike.%${opDigits}%,referencia.ilike.%${opTail}%`)
            .limit(20);
          const match = (movs ?? []).find((m) => {
            const ref = ((m.referencia as string | null) ?? '').replace(/\D/g, '');
            if (ref.length < 6) return false;
            // Acepta exacto o sufijo con diff <= 1
            return opDigits === ref || (opDigits.endsWith(ref) && opDigits.length - ref.length <= 1);
          });
          if (match) {
            await supabase
              .from('pagos_gastos')
              .update({ conciliado_movimiento_id: match.id })
              .eq('id', pagoInsertado.id);
            await supabase
              .from('movimientos_bancarios')
              .update({ gasto_id: gasto.id })
              .eq('id', match.id);
          }
        }
      }

      // 4) Actualizar el gasto: estado + (eventualmente) factura/comprobante/medio
      const updateGasto: Record<string, unknown> = {
        estado_pago: cubierto ? 'Pagado' : 'Parcial',
      };
      if (pathFactura && pathFactura !== gasto.factura_path) {
        updateGasto.factura_path = pathFactura;
      }
      // Sincronizar el comprobante al gasto solo si no tenía uno
      if (pathComprobantePago && !gasto.comprobante_path) {
        updateGasto.comprobante_path = pathComprobantePago;
      }
      // Si el gasto se cierra y no tenía medio_pago / nro_comprobante, anotamos
      if (cubierto) {
        if (!gasto.medio_pago) updateGasto.medio_pago = medioPago;
        if (!gasto.nro_comprobante && nOperacion.trim()) {
          updateGasto.nro_comprobante = nOperacion.trim();
        }
      }

      const { error: errUpd } = await supabase
        .from('gastos')
        .update(updateGasto)
        .eq('id', gasto.id);
      if (errUpd) throw errUpd;

      // 5) Invalidar caches que dependen de gastos / pagos
      qc.invalidateQueries({ queryKey: ['gastos_listado'] });
      qc.invalidateQueries({ queryKey: ['gastos_resumen_kpis'] });
      qc.invalidateQueries({ queryKey: ['gastos_conciliados_ids'] });
      qc.invalidateQueries({ queryKey: ['pagos_gastos'] });
      qc.invalidateQueries({ queryKey: ['gastos_pagos_map'] });
      qc.invalidateQueries({ queryKey: ['gastos_pagos_pendientes'] });
      qc.invalidateQueries({ queryKey: ['gastos_pagos_rango'] });
      qc.invalidateQueries({ queryKey: ['gastos_pagos'] });
      qc.invalidateQueries({ queryKey: ['pagos_gastos_compras'] });
      qc.invalidateQueries({ queryKey: ['conciliacion'] });

      onClose();
    } catch (e) {
      setError(formatError(e));
      setGuardando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 md:items-center md:p-4"
      onClick={onClose}
    >
      <div
        className="flex w-full flex-col bg-white shadow-xl md:max-w-md md:rounded-lg overflow-hidden"
        style={{ maxHeight: '92vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 className="text-lg font-semibold">💸 Registrar pago</h2>
            <p className="text-xs text-gray-500">
              {nombreProveedor(gasto, proveedoresMap, 's/proveedor')} · {gasto.fecha}
            </p>
          </div>
          <button onClick={onClose} className="rounded p-2 text-gray-500 hover:bg-gray-100">
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {/* Resumen del gasto */}
          <div className="rounded border border-gray-200 bg-gray-50 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Total del gasto</span>
              <span className="font-semibold tabular-nums">{formatARS(importeTotal)}</span>
            </div>
            {(yaPagado > 0 || yaDescuento > 0) && (
              <>
                {yaPagado > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">
                      Ya pagado ({pagosPrevios.length} pago{pagosPrevios.length === 1 ? '' : 's'})
                    </span>
                    <span className="tabular-nums text-gray-600">- {formatARS(yaPagado)}</span>
                  </div>
                )}
                {yaDescuento > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Descuentos previos</span>
                    <span className="tabular-nums text-gray-600">- {formatARS(yaDescuento)}</span>
                  </div>
                )}
              </>
            )}
            <div className="mt-1 flex justify-between border-t pt-1">
              <span className="font-medium text-amber-800">Saldo pendiente</span>
              <span className="font-bold tabular-nums text-amber-900">
                {formatARS(saldoPendiente)}
              </span>
            </div>
          </div>

          {/* Echeq programados (plan de pagos): cuotas a futuro sin debitar. */}
          {pagosProgramados.length > 0 && (
            <div className="rounded border border-blue-200 bg-blue-50/60 p-3 text-sm">
              <div className="mb-1 font-medium text-blue-900">
                🗓 Echeq programados ({pagosProgramados.length})
              </div>
              <p className="mb-2 text-xs text-blue-700">
                Cuotas agendadas a futuro. Confirmá cada una cuando el banco la debite.
              </p>
              <div className="space-y-1.5">
                {pagosProgramados.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between rounded border border-blue-100 bg-white px-2 py-1.5"
                  >
                    <div className="text-xs">
                      <div className="font-medium tabular-nums text-gray-900">
                        {formatARS(Number(p.monto))}
                      </div>
                      <div className="text-gray-500">
                        {MEDIO_PAGO_LABEL[p.medio_pago as MedioPago] ?? p.medio_pago} ·{' '}
                        {p.fecha_pago}
                        {p.numero_operacion ? ` · N° ${p.numero_operacion}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => confirmarDebitoEcheq(p)}
                      disabled={guardando}
                      className="rounded bg-blue-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      ✓ Confirmar débito
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fecha + Medio */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Fecha del pago *">
              <input
                type="date"
                value={fechaPago}
                onChange={(e) => setFechaPago(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Medio de pago *">
              <select
                value={medioPago}
                onChange={(e) => setMedioPago(e.target.value as MedioPago)}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
              >
                {(Object.keys(MEDIO_PAGO_LABEL) as MedioPago[]).map((m) => (
                  <option key={m} value={m}>
                    {MEDIO_PAGO_LABEL[m]}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {/* Importe + Descuento */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Importe a pagar *">
              <div className="flex items-center rounded border border-gray-300">
                <span className="px-3 text-sm text-gray-500">$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={importeTexto}
                  onChange={(e) => setImporteTexto(e.target.value)}
                  onBlur={() => {
                    const num = parseNumeroAR(importeTexto);
                    if (num !== null) setImporteTexto(formatNumeroAR(num));
                  }}
                  className="w-full rounded-r px-2 py-2 text-sm tabular-nums focus:outline-none"
                />
              </div>
            </Field>
            <Field label="Descuento (opcional)">
              <div className="flex items-center rounded border border-gray-300">
                <span className="px-3 text-sm text-gray-500">$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={descuentoTexto}
                  onChange={(e) => setDescuentoTexto(e.target.value)}
                  onBlur={() => {
                    const num = parseNumeroAR(descuentoTexto);
                    if (num !== null && num > 0) setDescuentoTexto(formatNumeroAR(num));
                  }}
                  placeholder="0"
                  className="w-full rounded-r px-2 py-2 text-sm tabular-nums focus:outline-none"
                />
              </div>
            </Field>
          </div>

          {/* Atajos + estado */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => {
                setImporteTexto(formatNumeroAR(saldoPendiente - descuentoNum));
              }}
              className="rounded bg-gray-100 px-2 py-0.5 text-gray-600 hover:bg-gray-200"
            >
              Pagar todo ({formatARS(saldoPendiente - descuentoNum)})
            </button>
            <button
              type="button"
              onClick={() =>
                setImporteTexto(formatNumeroAR(+(saldoPendiente / 2).toFixed(2)))
              }
              className="rounded bg-gray-100 px-2 py-0.5 text-gray-600 hover:bg-gray-200"
            >
              Mitad
            </button>
          </div>

          {/* Aviso de pago parcial */}
          {!cubierto && importeNum + descuentoNum > 0 && (
            <div className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
              Pago parcial. El gasto va a quedar como <strong>Parcial</strong>. Saldo restante
              después: {formatARS(saldoPendiente - importeNum - descuentoNum)}
            </div>
          )}

          {/* N° operación (cond.) */}
          {requiereDatosBancarios && (
            <Field label="N° de operación *">
              <input
                type="text"
                value={nOperacion}
                onChange={(e) => setNOperacion(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm font-mono"
                placeholder={
                  medioPago === 'transferencia_galicia' || medioPago === 'cheque_galicia'
                    ? 'Leyenda adicional (ej: 5034490189) o N° de cheque'
                    : medioPago === 'transferencia_mp'
                      ? 'N° de operación MP (ej: 156905408879)'
                      : 'Ref. bancaria / N° de transferencia / cheque'
                }
              />
              <p className="mt-1 text-[11px] text-gray-500">
                {medioPago === 'transferencia_galicia' || medioPago === 'cheque_galicia'
                  ? 'Copiá la "Leyenda adicional" del comprobante Galicia (10 dígitos). En el extracto aparece sin el primer dígito.'
                  : medioPago === 'transferencia_mp'
                    ? 'Copialo del comprobante MercadoPago.'
                    : 'Copialo del comprobante. Se usa para conciliar con el extracto bancario.'}
              </p>
            </Field>
          )}

          {/* Comprobante de pago */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              Comprobante de pago{' '}
              {!requiereDatosBancarios ? (
                <span className="font-normal text-gray-400">(opcional)</span>
              ) : yaTieneComprobante ? (
                <span className="font-normal text-gray-400">(ya cargado · podés reemplazar)</span>
              ) : (
                <span className="text-red-600">*</span>
              )}
            </label>
            {yaTieneComprobante && !archivoComprobante ? (
              <div className="flex items-center justify-between rounded-md border border-green-200 bg-green-50 px-3 py-1.5 text-xs">
                <span className="text-green-800">✓ Ya cargado en el gasto</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => abrirArchivoStorage(gasto.comprobante_path!)}
                    className="text-rodziny-700 underline hover:text-rodziny-800"
                  >
                    Ver
                  </button>
                  <label className="cursor-pointer text-gray-600 underline hover:text-gray-800">
                    Reemplazar
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      disabled={ocrEjecutando}
                      onChange={(e) => handleSubirComprobante(e.target.files?.[0] ?? null)}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>
            ) : (
              <input
                type="file"
                accept="image/*,application/pdf"
                disabled={ocrEjecutando}
                onChange={(e) => handleSubirComprobante(e.target.files?.[0] ?? null)}
                className="w-full text-xs file:mr-2 file:rounded file:border-0 file:bg-rodziny-700 file:px-2 file:py-1 file:text-[11px] file:text-white disabled:opacity-50"
              />
            )}
            {archivoComprobante && (
              <div className="mt-1 text-[11px] text-green-700">
                📎 {archivoComprobante.name}
              </div>
            )}
            {ocrEjecutando && (
              <div className="mt-1 flex items-center gap-1 text-[11px] text-blue-700">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-blue-300 border-t-blue-700" />
                Leyendo comprobante…
              </div>
            )}
            {ocrInfo && !ocrEjecutando && (
              <div className="mt-1 text-[11px] text-green-700">{ocrInfo}</div>
            )}
            {ocrWarning && (
              <div className="mt-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                {ocrWarning}
              </div>
            )}
          </div>

          {/* Factura del proveedor */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              Factura del proveedor <span className="font-normal text-gray-400">(opcional)</span>
            </label>
            {yaTieneFactura ? (
              <div className="flex items-center justify-between rounded-md border border-green-200 bg-green-50 px-3 py-1.5 text-xs">
                <span className="text-green-800">✓ Ya cargada en el gasto</span>
                <button
                  type="button"
                  onClick={() => abrirArchivoStorage(gasto.factura_path!)}
                  className="text-rodziny-700 underline hover:text-rodziny-800"
                >
                  Ver
                </button>
              </div>
            ) : (
              <>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => setArchivoFactura(e.target.files?.[0] ?? null)}
                  className="w-full text-xs file:mr-2 file:rounded file:border-0 file:bg-rodziny-700 file:px-2 file:py-1 file:text-[11px] file:text-white"
                />
                {archivoFactura && (
                  <div className="mt-1 text-[11px] text-green-700">📎 {archivoFactura.name}</div>
                )}
              </>
            )}
          </div>

          {/* Notas */}
          <Field label="Notas (opcional)">
            <textarea
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              rows={2}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
              placeholder="Ej: descuento por pronto pago"
            />
          </Field>

          {error && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t px-4 py-3">
          <button
            onClick={onClose}
            className="rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
            disabled={guardando}
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirmar}
            disabled={guardando || ocrEjecutando || saldoPendiente <= 0}
            className={cn(
              'rounded px-4 py-2 text-sm font-medium text-white disabled:opacity-50',
              cubierto ? 'bg-green-600 hover:bg-green-700' : 'bg-rodziny-600 hover:bg-rodziny-700',
            )}
          >
            {guardando ? 'Guardando…' : cubierto ? '💸 Confirmar pago' : '💸 Registrar pago parcial'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-700">{label}</span>
      {children}
    </label>
  );
}
