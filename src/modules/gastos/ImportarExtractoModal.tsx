import { useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { parseExtracto } from '@/modules/finanzas/parsers/parseExtractos';
import { cn } from '@/lib/utils';

interface ResultadoArchivo {
  nombre: string;
  cuenta: string | null;
  procesados: number;
  error: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  // Devuelve la lista de cuentas (mercadopago/galicia/icbc) cuyos archivos se
  // procesaron sin error. Se usa para acotar el matcher proactivo a esas cuentas.
  onSuccess: (cuentasOk: string[]) => void;
}

export function ImportarExtractoModal({ open, onClose, onSuccess }: Props) {
  const [procesando, setProcesando] = useState(false);
  const [resultados, setResultados] = useState<ResultadoArchivo[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  async function procesarArchivos(files: FileList | File[]) {
    setProcesando(true);
    setResultados([]);
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
    setProcesando(false);
    const cuentasOk = Array.from(
      new Set(
        acc
          .filter((r) => r.procesados > 0 && !r.error && r.cuenta)
          .map((r) => r.cuenta as string),
      ),
    );
    if (cuentasOk.length > 0) onSuccess(cuentasOk);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-gray-800">Importar extracto bancario</h3>
          <p className="mt-1 text-xs text-gray-500">
            CSV de MercadoPago, Banco Galicia o ICBC. Detecta el banco automáticamente. Podés
            arrastrar varios archivos a la vez. Los movimientos duplicados se ignoran.
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
          <p className="mt-3 animate-pulse text-sm text-blue-600">⏳ Procesando archivos...</p>
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
