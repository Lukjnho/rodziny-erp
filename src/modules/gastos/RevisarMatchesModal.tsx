import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatARS, formatFecha, cn } from '@/lib/utils';
import {
  matchearMovsConGastos,
  type MatchSugerido,
  type MovimientoParaMatch,
  type GastoParaMatch,
} from './matchearMovimientos';
import type { MedioPago } from './types';

const CUENTA_LABEL: Record<string, string> = {
  mercadopago: 'MP',
  galicia: 'Galicia',
  icbc: 'ICBC',
};

const MEDIO_DESDE_CUENTA: Record<string, MedioPago> = {
  mercadopago: 'transferencia_mp',
  galicia: 'cheque_galicia',
  icbc: 'tarjeta_icbc',
};

type Etapa = 'cargando' | 'revision' | 'ejecutando' | 'resultado' | 'sin_matches' | 'error';

interface Props {
  open: boolean;
  cuentasImportadas: string[]; // ['mercadopago', 'galicia', ...] para acotar la búsqueda
  onClose: () => void;
  onSuccess: () => void;
}

export function RevisarMatchesModal({ open, cuentasImportadas, onClose, onSuccess }: Props) {
  const [etapa, setEtapa] = useState<Etapa>('cargando');
  const [matches, setMatches] = useState<MatchSugerido[]>([]);
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ ok: number; errores: string[] } | null>(null);

  useEffect(() => {
    if (!open) return;
    setEtapa('cargando');
    setMatches([]);
    setSeleccionados(new Set());
    setError(null);
    setResultado(null);
    cargarYMatchear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function cargarYMatchear() {
    try {
      // 1. Movs sin clasificar (tipo=null), egresos, de las cuentas importadas
      const cuentas = cuentasImportadas.length > 0 ? cuentasImportadas : ['mercadopago', 'galicia', 'icbc'];
      const movs: MovimientoParaMatch[] = [];
      const PAGE = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from('movimientos_bancarios')
          .select('id, cuenta, fecha, descripcion, debito, credito, referencia, tipo, gasto_id')
          .is('tipo', null)
          .is('gasto_id', null)
          .gt('debito', 0)
          .in('cuenta', cuentas)
          .order('id')
          .range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        movs.push(...(data as MovimientoParaMatch[]));
        if (data.length < PAGE) break;
        from += PAGE;
      }

      // 2. Gastos pendientes (no cancelados) últimos 90 días + sus pagos sin conciliar
      const desde90 = new Date();
      desde90.setDate(desde90.getDate() - 90);
      const desdeStr = desde90.toISOString().split('T')[0];

      const { data: gastosData, error: e2 } = await supabase
        .from('gastos')
        .select(
          'id, fecha, proveedor, categoria, importe_total, estado_pago, local, medio_pago, pagos:pagos_gastos(id, conciliado_movimiento_id, monto, fecha_pago)',
        )
        .neq('cancelado', true)
        .gte('fecha', desdeStr);
      if (e2) throw e2;

      type RawGasto = {
        id: string;
        fecha: string;
        proveedor: string | null;
        categoria: string | null;
        importe_total: number;
        estado_pago: string | null;
        local: 'vedia' | 'saavedra' | null;
        medio_pago: string | null;
        pagos:
          | { id: string; conciliado_movimiento_id: string | null; monto: number; fecha_pago: string }[]
          | null;
      };

      const gastos: GastoParaMatch[] = ((gastosData ?? []) as unknown as RawGasto[])
        .map((g) => ({
          id: g.id,
          fecha: g.fecha,
          proveedor: g.proveedor,
          categoria: g.categoria,
          importe_total: g.importe_total,
          estado_pago: g.estado_pago,
          local: g.local,
          medio_pago: g.medio_pago,
          pagos_sin_conciliar: (g.pagos ?? [])
            .filter((p) => p.conciliado_movimiento_id === null)
            .map((p) => ({ id: p.id, monto: p.monto, fecha_pago: p.fecha_pago })),
        }))
        // Filtrar gastos pagados sin pagos_sin_conciliar (ya reconciliados)
        .filter((g) => g.estado_pago !== 'Pagado' || g.pagos_sin_conciliar.length > 0);

      const sugerencias = matchearMovsConGastos(movs, gastos);
      if (sugerencias.length === 0) {
        setEtapa('sin_matches');
        return;
      }
      setMatches(sugerencias);
      setSeleccionados(new Set(sugerencias.filter((m) => m.recomendado).map(matchKey)));
      setEtapa('revision');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando matches');
      setEtapa('error');
    }
  }

  function toggleMatch(m: MatchSugerido) {
    const k = matchKey(m);
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function seleccionarTodos() {
    setSeleccionados(new Set(matches.map(matchKey)));
  }

  function deseleccionarTodos() {
    setSeleccionados(new Set());
  }

  async function ejecutar() {
    setEtapa('ejecutando');
    const errores: string[] = [];
    let ok = 0;
    const seleccionadosArr = matches.filter((m) => seleccionados.has(matchKey(m)));

    for (const m of seleccionadosArr) {
      try {
        // 1. Marcar el movimiento como pago_de_gasto vinculado al gasto
        const { error: e1 } = await supabase
          .from('movimientos_bancarios')
          .update({ tipo: 'pago_de_gasto', gasto_id: m.gastoId })
          .eq('id', m.movId);
        if (e1) throw e1;

        if (m.pagoExistenteId) {
          // Reconciliar pago existente (caso ChecklistPagos / financiación)
          const { error: e2 } = await supabase
            .from('pagos_gastos')
            .update({ conciliado_movimiento_id: m.movId })
            .eq('id', m.pagoExistenteId);
          if (e2) throw e2;
        } else {
          // Pago nuevo: gasto pendiente → pasar a Pagado + insertar pago
          const { error: e3 } = await supabase
            .from('gastos')
            .update({ estado_pago: 'Pagado' })
            .eq('id', m.gastoId);
          if (e3) throw e3;

          const { error: e4 } = await supabase.from('pagos_gastos').insert({
            gasto_id: m.gastoId,
            fecha_pago: m.movFecha,
            monto: m.movMonto,
            medio_pago: MEDIO_DESDE_CUENTA[m.movCuenta] ?? 'transferencia_mp',
            conciliado_movimiento_id: m.movId,
          });
          if (e4) throw e4;
        }
        ok++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'error';
        errores.push(`${m.gastoProveedor ?? '—'} ↔ ${m.movFecha}: ${msg}`);
      }
    }

    setResultado({ ok, errores });
    setEtapa('resultado');
    if (ok > 0) onSuccess();
  }

  const stats = useMemo(() => {
    const auto = matches.filter((m) => m.score >= 100).length;
    const alto = matches.filter((m) => m.score >= 90 && m.score < 100).length;
    const parcial = matches.filter((m) => m.score < 90).length;
    return { auto, alto, parcial, total: matches.length };
  }, [matches]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4">
          <h3 className="text-base font-semibold text-gray-800">
            🔗 Revisar conciliación automática
          </h3>
          <p className="mt-1 text-xs text-gray-500">
            Buscamos los movimientos recién importados contra gastos pendientes y pagos sin
            conciliar. Confirmá los matches y vamos a vincular cada movimiento al gasto
            correspondiente sin duplicar el egreso en Flujo de Caja.
          </p>
        </div>

        {etapa === 'cargando' && (
          <p className="py-8 text-center text-sm text-gray-400">⏳ Buscando matches...</p>
        )}

        {etapa === 'sin_matches' && (
          <div className="rounded-md bg-blue-50 p-4 text-sm text-blue-800">
            No encontramos matches automáticos entre los movimientos importados y los gastos
            pendientes. Podés vincularlos a mano desde la tabla, o dejá que el motor de reglas
            procese los gastos ocultos (impuestos, comisiones).
            <div className="mt-3 flex justify-end">
              <button
                onClick={onClose}
                className="rounded-md bg-rodziny-700 px-4 py-1.5 text-xs font-medium text-white"
              >
                Cerrar
              </button>
            </div>
          </div>
        )}

        {etapa === 'error' && (
          <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">❌ {error}</div>
        )}

        {etapa === 'revision' && (
          <>
            <div className="mb-3 grid grid-cols-4 gap-3 text-center">
              <div className="rounded-lg border border-green-200 bg-green-50 p-3">
                <p className="text-xs text-green-700">Auto (100%)</p>
                <p className="text-lg font-semibold text-green-900">{stats.auto}</p>
              </div>
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                <p className="text-xs text-blue-700">Alta (90%)</p>
                <p className="text-lg font-semibold text-blue-900">{stats.alto}</p>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs text-amber-700">Parcial (60%)</p>
                <p className="text-lg font-semibold text-amber-900">{stats.parcial}</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="text-xs text-gray-500">Total</p>
                <p className="text-lg font-semibold text-gray-800">{stats.total}</p>
              </div>
            </div>

            <div className="mb-2 flex items-center justify-between text-xs">
              <p className="text-gray-500">
                <strong>{seleccionados.size}</strong> de {matches.length} seleccionados. Los marcados
                con <span className="text-blue-700">★</span> son sugerencia automática (90%+).
              </p>
              <div className="flex gap-2">
                <button
                  onClick={seleccionarTodos}
                  className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50"
                >
                  Seleccionar todos
                </button>
                <button
                  onClick={deseleccionarTodos}
                  className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50"
                >
                  Deseleccionar
                </button>
              </div>
            </div>

            <div className="overflow-hidden rounded border border-gray-200">
              <table className="w-full text-xs">
                <thead className="border-b border-gray-200 bg-gray-50 text-[10px] uppercase text-gray-500">
                  <tr>
                    <th className="w-8 px-2 py-2"></th>
                    <th className="px-3 py-2 text-left">Movimiento</th>
                    <th className="px-3 py-2 text-right">Monto mov</th>
                    <th className="px-3 py-2 text-left">→ Gasto</th>
                    <th className="px-3 py-2 text-right">Monto gasto</th>
                    <th className="px-3 py-2 text-left">Match</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((m) => {
                    const k = matchKey(m);
                    const seleccionado = seleccionados.has(k);
                    return (
                      <tr
                        key={k}
                        className={cn(
                          'border-b border-gray-100 cursor-pointer hover:bg-gray-50',
                          seleccionado && 'bg-blue-50/40',
                        )}
                        onClick={() => toggleMatch(m)}
                      >
                        <td className="px-2 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={seleccionado}
                            onChange={() => toggleMatch(m)}
                            onClick={(e) => e.stopPropagation()}
                            className="h-4 w-4 cursor-pointer"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <p className="text-gray-700">
                            {formatFecha(m.movFecha)} ·{' '}
                            <span className="text-gray-500">
                              {CUENTA_LABEL[m.movCuenta] ?? m.movCuenta}
                            </span>
                          </p>
                          <p className="line-clamp-1 text-[10px] text-gray-400">
                            {m.movDescripcion ?? '—'}
                          </p>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums font-semibold text-gray-900">
                          {formatARS(m.movMonto)}
                        </td>
                        <td className="px-3 py-2">
                          <p className="font-medium text-gray-800">
                            {m.gastoProveedor ?? '—'}
                            {m.pagoExistenteId && (
                              <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-800">
                                pago pre-cargado
                              </span>
                            )}
                          </p>
                          <p className="text-[10px] text-gray-500">
                            {formatFecha(m.gastoFecha)}
                            {m.gastoCategoria ? ` · ${m.gastoCategoria}` : ''}
                          </p>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-700">
                          {formatARS(m.gastoMonto)}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={cn(
                              'rounded px-1.5 py-0.5 text-[10px] font-medium',
                              m.score >= 100
                                ? 'bg-green-100 text-green-800'
                                : m.score >= 90
                                  ? 'bg-blue-100 text-blue-800'
                                  : 'bg-amber-100 text-amber-800',
                            )}
                          >
                            {m.score >= 90 && '★ '}
                            {m.motivo}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex justify-between gap-2">
              <button
                onClick={onClose}
                className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
              >
                Saltar
              </button>
              <button
                onClick={ejecutar}
                disabled={seleccionados.size === 0}
                className="rounded-md bg-rodziny-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-rodziny-800 disabled:opacity-50"
              >
                Vincular {seleccionados.size} movimiento{seleccionados.size === 1 ? '' : 's'}
              </button>
            </div>
          </>
        )}

        {etapa === 'ejecutando' && (
          <p className="py-8 text-center text-sm text-blue-600 animate-pulse">
            ⏳ Vinculando movimientos a gastos...
          </p>
        )}

        {etapa === 'resultado' && resultado && (
          <>
            <div
              className={cn(
                'rounded-md p-4 text-sm',
                resultado.errores.length === 0
                  ? 'bg-green-50 text-green-800'
                  : 'bg-amber-50 text-amber-800',
              )}
            >
              ✅ {resultado.ok} movimientos vinculados correctamente
              {resultado.errores.length > 0 && (
                <div className="mt-2 text-red-700">
                  <p className="font-medium">Errores ({resultado.errores.length}):</p>
                  <ul className="mt-1 list-inside list-disc text-xs">
                    {resultado.errores.slice(0, 10).map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={onClose}
                className="rounded-md bg-rodziny-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-rodziny-800"
              >
                Cerrar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function matchKey(m: MatchSugerido): string {
  return `${m.movId}|${m.gastoId}|${m.pagoExistenteId ?? '_'}`;
}
