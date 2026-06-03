import { useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { parseExtracto } from '@/modules/finanzas/parsers/parseExtractos';
import { cn } from '@/lib/utils';
import { conciliarPorIdOperacion } from './conciliarPorIdOperacion';

// ID estable de la subcategoría "Impuestos y comisiones bancarias"
// (ver memory/reference_categorias_clave.md). Usada por la RPC
// crear_cargos_automaticos_bancarios para imputar los cargos auto del extracto.
const CATEGORIA_BANCARIA_ID = 'fcb639e7-4be6-4d7b-989a-fd15d42a2534';

interface ResultadoArchivo {
  nombre: string;
  cuenta: string | null;
  parseados: number;
  nuevos: number;
  duplicados: number;
  error: string | null;
}

interface ResumenAuto {
  etiquetados: number; // sugerencia agregada (Ley 25.413, Comisión MP, etc.)
  vinculados: number; // gastos manuales matcheados con su mov por N° op
  cargosCreados: number; // gastos auto creados (impuestos / comisiones bancarias)
  errores: string[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function ImportarExtractoModal({ open, onClose, onSuccess }: Props) {
  const { user } = useAuth();
  const [procesando, setProcesando] = useState(false);
  const [resultados, setResultados] = useState<ResultadoArchivo[]>([]);
  const [resumenAuto, setResumenAuto] = useState<ResumenAuto | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  async function procesarArchivos(files: FileList | File[]) {
    setProcesando(true);
    setResultados([]);
    setResumenAuto(null);
    const acc: ResultadoArchivo[] = [];
    // Rango cubierto por los archivos importados (para acotar las RPCs)
    let fechaMin: string | null = null;
    let fechaMax: string | null = null;
    for (const file of Array.from(files)) {
      try {
        const text = await file.text();
        const movimientos = parseExtracto(text, file.name);
        if (!movimientos.length) {
          acc.push({
            nombre: file.name,
            cuenta: null,
            parseados: 0,
            nuevos: 0,
            duplicados: 0,
            error: 'Formato no detectado (MP / Galicia / ICBC)',
          });
          continue;
        }
        const cuenta = movimientos[0]?.cuenta ?? null;
        // upsert + .select() devuelve solo las filas insertadas (las descartadas
        // por `ignoreDuplicates` no se incluyen). Con eso sabemos cuántos eran nuevos.
        const { data: insertados, error } = await supabase
          .from('movimientos_bancarios')
          .upsert(
            movimientos.map((m) => ({ ...m, fuente: file.name })),
            {
              onConflict: 'cuenta,fecha,referencia,debito,credito',
              ignoreDuplicates: true,
            },
          )
          .select('id');
        const nuevos = insertados?.length ?? 0;
        acc.push({
          nombre: file.name,
          cuenta,
          parseados: movimientos.length,
          nuevos,
          duplicados: movimientos.length - nuevos,
          error: error ? error.message : null,
        });
        if (nuevos > 0) {
          for (const m of movimientos) {
            if (!m.fecha) continue;
            if (!fechaMin || m.fecha < fechaMin) fechaMin = m.fecha;
            if (!fechaMax || m.fecha > fechaMax) fechaMax = m.fecha;
          }
        }
      } catch (e) {
        acc.push({
          nombre: file.name,
          cuenta: null,
          parseados: 0,
          nuevos: 0,
          duplicados: 0,
          error: e instanceof Error ? e.message : 'Error desconocido',
        });
      }
    }
    setResultados(acc);

    // Solo dispara auto-clasificación si hay filas nuevas — si todo eran
    // duplicados, los movs ya estaban procesados de un import previo.
    const huboImports = acc.some((r) => r.nuevos > 0 && !r.error);
    if (huboImports && fechaMin && fechaMax) {
      const errores: string[] = [];
      let etiquetados = 0;
      let cargosCreados = 0;

      // 1) Etiquetar campo `sugerencia` (Ley 25.413, Comisión MP, IVA bancario, etc.)
      try {
        const { data, error } = await supabase.rpc('aplicar_reglas_sugerencia');
        if (error) throw error;
        etiquetados = (data as { etiquetados: number })?.etiquetados ?? 0;
      } catch (e) {
        errores.push(`reglas: ${(e as Error).message}`);
      }

      // 2) Auto-vincular movs ↔ gastos cargados manualmente por N° de operación
      //    (RPC servidor — más rápida y robusta que conciliarPorIdOperacion en cliente)
      try {
        const { error } = await supabase.rpc('auto_match_gastos_extracto', {
          p_fecha_desde: fechaMin,
          p_fecha_hasta: fechaMax,
        });
        if (error) throw error;
        // Transferencias consolidadas (1 transferencia paga N gastos): vincula los
        // N pagos al movimiento cuando la suma del grupo = monto del retiro.
        const { error: errCons } = await supabase.rpc('conciliar_pagos_consolidados', {
          p_fecha_desde: fechaMin,
          p_fecha_hasta: fechaMax,
        });
        if (errCons) throw errCons;
      } catch (e) {
        errores.push(`auto-match: ${(e as Error).message}`);
      }

      // 3) Crear gastos automáticos por cargos del banco (impuestos, comisiones,
      //    retenciones, sellos). Se imputan a Rodziny S.A.S. en categoría
      //    "Impuestos y comisiones bancarias" → impactan el Flujo de caja.
      try {
        const { data, error } = await supabase.rpc('crear_cargos_automaticos_bancarios', {
          p_categoria_id: CATEGORIA_BANCARIA_ID,
          p_creado_por: user?.id ?? null,
          p_fecha_desde: fechaMin,
          p_fecha_hasta: fechaMax,
        });
        if (error) throw error;
        cargosCreados = (data as { creados: number })?.creados ?? 0;
      } catch (e) {
        errores.push(`cargos auto: ${(e as Error).message}`);
      }

      // 4) Conciliación adicional cliente (marca también pagos_gastos.conciliado_movimiento_id —
      //    cosa que la RPC servidor no toca). Reduntante con (2) en parte; pendiente unificar.
      const conc = await conciliarPorIdOperacion();
      errores.push(...conc.errores);

      setResumenAuto({
        etiquetados,
        vinculados: conc.vinculados,
        cargosCreados,
        errores,
      });
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
            {resultados.map((r, i) => {
              const todoDuplicado = !r.error && r.nuevos === 0 && r.parseados > 0;
              return (
                <div
                  key={i}
                  className={cn(
                    'rounded-md border p-3 text-xs',
                    r.error
                      ? 'border-red-200 bg-red-50'
                      : todoDuplicado
                        ? 'border-blue-200 bg-blue-50'
                        : 'border-green-200 bg-green-50',
                  )}
                >
                  <div className="font-medium text-gray-800">{r.nombre}</div>
                  {r.error ? (
                    <div className="mt-1 text-red-700">❌ {r.error}</div>
                  ) : todoDuplicado ? (
                    <div className="mt-1 text-blue-700">
                      ℹ {r.parseados} movimientos · {r.cuenta ?? '?'} — todos duplicados (ya estaban
                      cargados). Bajá un extracto más reciente del banco.
                    </div>
                  ) : (
                    <div className="mt-1 text-green-700">
                      ✅ {r.parseados} parseados · <strong>{r.nuevos} nuevos</strong>
                      {r.duplicados > 0 && ` · ${r.duplicados} ya existían`} · {r.cuenta ?? '?'}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {resumenAuto && (
          <div
            className={cn(
              'mt-3 rounded-md border p-3 text-xs',
              resumenAuto.errores.length === 0
                ? 'border-blue-200 bg-blue-50'
                : 'border-amber-200 bg-amber-50',
            )}
          >
            <div className="font-medium text-gray-800">🔗 Auto-clasificación</div>
            <ul className="mt-1 space-y-0.5 text-gray-700">
              <li>
                🏷 <strong>{resumenAuto.etiquetados}</strong> mov{resumenAuto.etiquetados === 1 ? '' : 's'} etiquetados con sugerencia
                {resumenAuto.etiquetados === 0 && ' (nada nuevo para etiquetar)'}
              </li>
              <li>
                💸 <strong>{resumenAuto.cargosCreados}</strong> gasto{resumenAuto.cargosCreados === 1 ? '' : 's'} automáticos creados
                {resumenAuto.cargosCreados > 0 && (
                  <span className="text-gray-500"> (impuestos / comisiones bancarias)</span>
                )}
              </li>
              <li>
                🔗 <strong>{resumenAuto.vinculados}</strong> pago{resumenAuto.vinculados === 1 ? '' : 's'} cargados vinculados a su mov por N° de operación
              </li>
            </ul>
            {resumenAuto.errores.length > 0 && (
              <ul className="mt-2 list-inside list-disc text-red-700">
                {resumenAuto.errores.slice(0, 5).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
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

