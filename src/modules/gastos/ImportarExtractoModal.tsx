import { useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { parseExtracto } from '@/modules/finanzas/parsers/parseExtractos';
import { cn } from '@/lib/utils';
import {
  matchearPorIdOperacion,
  type MovimientoParaMatchId,
  type PagoParaMatchId,
} from './matchearPorIdOperacion';

interface ResultadoArchivo {
  nombre: string;
  cuenta: string | null;
  procesados: number;
  error: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function ImportarExtractoModal({ open, onClose, onSuccess }: Props) {
  const [procesando, setProcesando] = useState(false);
  const [resultados, setResultados] = useState<ResultadoArchivo[]>([]);
  const [conciliacion, setConciliacion] = useState<{
    vinculados: number;
    errores: string[];
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  async function procesarArchivos(files: FileList | File[]) {
    setProcesando(true);
    setResultados([]);
    setConciliacion(null);
    const acc: ResultadoArchivo[] = [];
    for (const file of Array.from(files)) {
      try {
        const text = await file.text();
        const movimientos = parseExtracto(text, file.name);
        if (!movimientos.length) {
          acc.push({
            nombre: file.name,
            cuenta: null,
            procesados: 0,
            error: 'Formato no detectado (MP / Galicia / ICBC)',
          });
          continue;
        }
        const cuenta = movimientos[0]?.cuenta ?? null;
        const { error } = await supabase.from('movimientos_bancarios').upsert(
          movimientos.map((m) => ({ ...m, fuente: file.name })),
          {
            onConflict: 'cuenta,fecha,referencia,debito,credito',
            ignoreDuplicates: true,
          },
        );
        acc.push({
          nombre: file.name,
          cuenta,
          procesados: movimientos.length,
          error: error ? error.message : null,
        });
      } catch (e) {
        acc.push({
          nombre: file.name,
          cuenta: null,
          procesados: 0,
          error: e instanceof Error ? e.message : 'Error desconocido',
        });
      }
    }
    setResultados(acc);

    const huboImports = acc.some((r) => r.procesados > 0 && !r.error);
    if (huboImports) {
      // Conciliación automática por igualdad EXACTA de N° de operación.
      // Sin scoring, sin tolerancia, sin sugerencias parciales: si el N°
      // capturado al pagar aparece en la referencia/descripción del mov,
      // se vincula. El resto queda para motor de reglas + manual.
      const conc = await conciliarPorIdOperacion();
      setConciliacion(conc);
      onSuccess();
    }
    setProcesando(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-gray-800">Importar extracto bancario</h3>
          <p className="mt-1 text-xs text-gray-500">
            CSV de MercadoPago, Banco Galicia o ICBC. Detecta el banco automáticamente. Podés
            arrastrar varios archivos a la vez. Los movimientos duplicados se ignoran. Después
            del import, conciliamos automáticamente los pagos cargados (con N° de operación)
            contra los movimientos del extracto.
          </p>
        </div>

        <div
          className="cursor-pointer rounded-lg border-2 border-dashed border-gray-300 p-8 text-center transition-colors hover:border-rodziny-500"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files.length) procesarArchivos(e.dataTransfer.files);
          }}
        >
          <div className="mb-2 text-2xl">📂</div>
          <p className="text-sm text-gray-600">
            Arrastrá los CSV acá o{' '}
            <span className="font-medium text-rodziny-700">hacé clic para seleccionar</span>
          </p>
          <p className="mt-1 text-[11px] text-gray-400">
            Tip: nombrá los archivos con el banco en el nombre (ej:{' '}
            <span className="font-medium">Galicia Marzo.csv</span>) para que el detector no falle si
            el formato cambia.
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".csv,.txt"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) procesarArchivos(e.target.files);
            }}
          />
        </div>

        {procesando && (
          <p className="mt-3 animate-pulse text-sm text-blue-600">⏳ Procesando archivos y conciliando...</p>
        )}

        {resultados.length > 0 && (
          <div className="mt-4 space-y-2">
            {resultados.map((r, i) => (
              <div
                key={i}
                className={cn(
                  'rounded-md border p-3 text-xs',
                  r.error ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50',
                )}
              >
                <div className="font-medium text-gray-800">{r.nombre}</div>
                {r.error ? (
                  <div className="mt-1 text-red-700">❌ {r.error}</div>
                ) : (
                  <div className="mt-1 text-green-700">
                    ✅ {r.procesados} movimientos · {r.cuenta ?? '?'}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {conciliacion && (
          <div
            className={cn(
              'mt-3 rounded-md border p-3 text-xs',
              conciliacion.errores.length === 0
                ? 'border-blue-200 bg-blue-50'
                : 'border-amber-200 bg-amber-50',
            )}
          >
            <div className="font-medium text-gray-800">🔗 Conciliación automática</div>
            <div className="mt-1 text-gray-700">
              {conciliacion.vinculados > 0 ? (
                <>
                  ✅ <strong>{conciliacion.vinculados}</strong> pago{conciliacion.vinculados === 1 ? '' : 's'}{' '}
                  vinculado{conciliacion.vinculados === 1 ? '' : 's'} automáticamente por N° de operación
                </>
              ) : (
                <span className="text-gray-500">
                  Ningún pago coincidió por N° de operación con los movimientos importados.
                  Vinculá manualmente desde la tabla, o aplicá reglas para gastos automáticos.
                </span>
              )}
              {conciliacion.errores.length > 0 && (
                <ul className="mt-2 list-inside list-disc text-red-700">
                  {conciliacion.errores.slice(0, 5).map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
          >
            {resultados.length > 0 ? 'Cerrar' : 'Cancelar'}
          </button>
        </div>
      </div>
    </div>
  );
}

async function conciliarPorIdOperacion(): Promise<{
  vinculados: number;
  errores: string[];
}> {
  const errores: string[] = [];
  try {
    // Movs candidatos: sin clasificar, egresos
    const movs: MovimientoParaMatchId[] = [];
    const PAGE = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('movimientos_bancarios')
        .select('id, cuenta, fecha, descripcion, debito, credito, referencia, tipo, gasto_id')
        .is('tipo', null)
        .is('gasto_id', null)
        .gt('debito', 0)
        .order('id')
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      movs.push(...(data as MovimientoParaMatchId[]));
      if (data.length < PAGE) break;
      from += PAGE;
    }
    if (movs.length === 0) return { vinculados: 0, errores: [] };

    // Pagos candidatos: con N° operación, sin conciliar
    const { data: pagosRaw, error: ePagos } = await supabase
      .from('pagos_gastos')
      .select('id, gasto_id, fecha_pago, monto, numero_operacion, conciliado_movimiento_id, gasto:gastos(proveedor)')
      .is('conciliado_movimiento_id', null)
      .not('numero_operacion', 'is', null);
    if (ePagos) throw ePagos;

    type RawPago = {
      id: string;
      gasto_id: string;
      fecha_pago: string;
      monto: number;
      numero_operacion: string;
      conciliado_movimiento_id: string | null;
      gasto: { proveedor: string | null } | { proveedor: string | null }[] | null;
    };
    const pagos: PagoParaMatchId[] = ((pagosRaw ?? []) as unknown as RawPago[]).map((p) => {
      const gasto = Array.isArray(p.gasto) ? p.gasto[0] : p.gasto;
      return {
        id: p.id,
        gasto_id: p.gasto_id,
        fecha_pago: p.fecha_pago,
        monto: Number(p.monto),
        numero_operacion: p.numero_operacion,
        conciliado_movimiento_id: p.conciliado_movimiento_id,
        gasto_proveedor: gasto?.proveedor ?? null,
      };
    });

    const matches = matchearPorIdOperacion(movs, pagos);
    if (matches.length === 0) return { vinculados: 0, errores: [] };

    // Aplicar matches: actualizar movimiento + pago_gasto
    let vinculados = 0;
    for (const m of matches) {
      try {
        const { error: e1 } = await supabase
          .from('movimientos_bancarios')
          .update({ tipo: 'pago_de_gasto', gasto_id: m.gastoId })
          .eq('id', m.movId);
        if (e1) throw e1;
        const { error: e2 } = await supabase
          .from('pagos_gastos')
          .update({ conciliado_movimiento_id: m.movId })
          .eq('id', m.pagoId);
        if (e2) throw e2;
        vinculados++;
      } catch (e) {
        errores.push(
          `${m.gastoProveedor ?? '—'} (N° ${m.numeroOperacion}): ${(e as Error).message}`,
        );
      }
    }
    return { vinculados, errores };
  } catch (e) {
    return { vinculados: 0, errores: [(e as Error).message] };
  }
}
