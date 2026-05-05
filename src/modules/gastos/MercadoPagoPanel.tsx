import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cn, formatARS } from '@/lib/utils';
import { VincularGastoModal, type MovimientoVinculable } from './VincularGastoModal';
import {
  TransferenciaInternaModal,
  type MovimientoTransferible,
} from './TransferenciaInternaModal';
import { NuevoGastoModal, type PrefillGasto } from './NuevoGastoModal';

interface TriggerResult {
  ok: boolean;
  ya_existe?: boolean;
  report_id?: string;
  rango?: { desde: string; hasta: string };
  mensaje?: string;
  error?: string;
}

interface ReleaseReportRow {
  id: string;
  begin_date: string;
  end_date: string;
  status: 'pending' | 'processing' | 'done' | 'error' | 'timeout';
  payouts_insertados: number | null;
  cargos_insertados: number | null;
  filas_csv: number | null;
  error_msg: string | null;
  created_at: string;
  processed_at: string | null;
  poll_intentos: number | null;
}

interface MovMPRow {
  id: string;
  fecha: string;
  descripcion: string | null;
  debito: number;
  referencia: string | null;
  fuente: string;
  tipo: string | null;
  gasto_id: string | null;
  sugerencia: string | null;
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function MercadoPagoPanel() {
  const ahora = new Date();
  const primerDelMes = ymd(new Date(ahora.getFullYear(), ahora.getMonth(), 1));
  const primerMesAnt = ymd(new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1));
  const ultimoMesAnt = ymd(new Date(ahora.getFullYear(), ahora.getMonth(), 0));
  const hace3meses = ymd(new Date(ahora.getFullYear(), ahora.getMonth() - 3, 1));

  const [desde, setDesde] = useState(primerMesAnt);
  const [hasta, setHasta] = useState(ultimoMesAnt);
  const [syncing, setSyncing] = useState(false);
  const [resultado, setResultado] = useState<TriggerResult | null>(null);
  const [vincularMov, setVincularMov] = useState<MovimientoVinculable | null>(null);
  const [transferenciaMov, setTransferenciaMov] = useState<MovimientoTransferible | null>(null);
  const [crearGastoPrefill, setCrearGastoPrefill] = useState<{
    movId: string;
    prefill: PrefillGasto;
  } | null>(null);
  const qc = useQueryClient();

  function refrescar() {
    qc.invalidateQueries({ queryKey: ['mp_movs_recientes'] });
    qc.invalidateQueries({ queryKey: ['mp_release_reports'] });
    qc.invalidateQueries({ queryKey: ['movimientos_bandeja'] });
    qc.invalidateQueries({ queryKey: ['gastos_listado'] });
    qc.invalidateQueries({ queryKey: ['gastos_pagos_pendientes'] });
    qc.invalidateQueries({ queryKey: ['gastos_resumen_kpis'] });
  }

  function abrirVincular(m: MovMPRow) {
    setVincularMov({
      id: m.id,
      cuenta: 'mercadopago',
      fecha: m.fecha,
      debito: Number(m.debito),
      credito: 0,
      descripcion: m.descripcion,
      referencia: m.referencia,
    });
  }

  function abrirTransferencia(m: MovMPRow) {
    setTransferenciaMov({
      id: m.id,
      cuenta: 'mercadopago',
      fecha: m.fecha,
      debito: Number(m.debito),
      credito: 0,
      descripcion: m.descripcion,
    });
  }

  function abrirCrearGasto(m: MovMPRow) {
    const prefill: PrefillGasto = {
      fecha: m.fecha,
      importe_total: Number(m.debito),
      comentario: [m.descripcion, m.referencia].filter(Boolean).join(' · ') || null,
      medio_pago: 'transferencia_mp',
      estado_pago: 'pagado',
      fecha_pago: m.fecha,
      numero_operacion: m.referencia ?? '',
    };
    setCrearGastoPrefill({ movId: m.id, prefill });
  }

  async function onGastoCreado(gastoId: string) {
    const movId = crearGastoPrefill?.movId;
    setCrearGastoPrefill(null);
    if (!movId) return;
    const { error } = await supabase
      .from('movimientos_bancarios')
      .update({ tipo: 'gasto_auto', gasto_id: gastoId })
      .eq('id', movId);
    if (error) {
      window.alert(`Gasto creado pero no se pudo vincular el movimiento: ${error.message}`);
      return;
    }
    await supabase
      .from('pagos_gastos')
      .update({ conciliado_movimiento_id: movId })
      .eq('gasto_id', gastoId);
    refrescar();
  }

  async function ignorarMov(m: MovMPRow) {
    const { error } = await supabase
      .from('movimientos_bancarios')
      .update({ tipo: 'ignorado' })
      .eq('id', m.id);
    if (error) {
      window.alert(error.message);
      return;
    }
    refrescar();
  }

  const { data: ultimosReports } = useQuery({
    queryKey: ['mp_release_reports'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mp_release_reports')
        .select(
          'id, begin_date, end_date, status, payouts_insertados, cargos_insertados, filas_csv, error_msg, created_at, processed_at, poll_intentos',
        )
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as ReleaseReportRow[];
    },
    // Auto-refresh cada 30s mientras haya pending/processing
    refetchInterval: (query) => {
      const data = query.state.data as ReleaseReportRow[] | undefined;
      const hayActivos = data?.some((r) => r.status === 'pending' || r.status === 'processing');
      return hayActivos ? 30000 : false;
    },
  });

  const { data: movsRecientes } = useQuery({
    queryKey: ['mp_movs_recientes', desde, hasta],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('movimientos_bancarios')
        .select('id, fecha, descripcion, debito, referencia, fuente, tipo, gasto_id, sugerencia')
        .eq('cuenta', 'mercadopago')
        .in('fuente', ['api_mp_release', 'api_mp_release_charge'])
        .gte('fecha', desde)
        .lte('fecha', hasta)
        .order('fecha', { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as MovMPRow[];
    },
  });

  async function sincronizar() {
    setSyncing(true);
    setResultado(null);
    try {
      const { data, error } = await supabase.functions.invoke('sync-mp-release-trigger', {
        body: { desde, hasta },
      });
      if (error) {
        setResultado({ ok: false, error: error.message });
        return;
      }
      setResultado(data as TriggerResult);
      qc.invalidateQueries({ queryKey: ['mp_release_reports'] });
    } catch (e) {
      setResultado({ ok: false, error: (e as Error).message });
    } finally {
      setSyncing(false);
    }
  }

  function preset(d: string, h: string) {
    setDesde(d);
    setHasta(h);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <h3 className="text-sm font-semibold text-blue-900">🔄 Sincronización con MercadoPago</h3>
        <p className="mt-1 text-xs text-blue-800">
          Pide a MercadoPago el reporte completo de movimientos (Released Money). Trae{' '}
          <strong>transferencias salientes</strong> + <strong>comisiones</strong> +{' '}
          <strong>impuestos al débito</strong> de cada cobro. Es asincrónico:{' '}
          <strong>tarda 5-10 minutos</strong> en procesarse — el sistema chequea automáticamente cada 5 min.
          Los ingresos por ventas no se cargan acá (vienen por Fudo/POS).
        </p>
      </div>

      <div className="rounded-lg border border-surface-border bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500">Desde</label>
            <input
              type="date"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
              className="mt-1 rounded border border-gray-300 px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500">Hasta</label>
            <input
              type="date"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
              className="mt-1 rounded border border-gray-300 px-2 py-1 text-sm"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {[
              { label: 'Mes actual', d: primerDelMes, h: ymd(ahora) },
              { label: 'Mes anterior', d: primerMesAnt, h: ultimoMesAnt },
              { label: 'Últimos 3 meses', d: hace3meses, h: ymd(ahora) },
            ].map((p) => (
              <button
                key={p.label}
                onClick={() => preset(p.d, p.h)}
                className={cn(
                  'rounded px-2 py-1 text-xs',
                  desde === p.d && hasta === p.h
                    ? 'bg-rodziny-800 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            onClick={sincronizar}
            disabled={syncing}
            className="ml-auto rounded-md bg-rodziny-700 px-4 py-2 text-sm font-medium text-white hover:bg-rodziny-800 disabled:opacity-50"
          >
            {syncing ? '⏳ Solicitando...' : '🔄 Solicitar reporte MP'}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-gray-500">
          Hasta 60 días por reporte. Idempotente: si ya importaste un período, los repetidos se ignoran.
          Los reportes se procesan automáticamente cada 5 minutos.
        </p>
      </div>

      {resultado && (
        <div
          className={cn(
            'rounded-lg border p-3 text-sm',
            resultado.ok
              ? resultado.ya_existe
                ? 'border-amber-200 bg-amber-50 text-amber-800'
                : 'border-blue-200 bg-blue-50 text-blue-800'
              : 'border-red-200 bg-red-50 text-red-700',
          )}
        >
          {!resultado.ok ? (
            <span>❌ Error: {resultado.error ?? 'Falló la solicitud'}</span>
          ) : resultado.ya_existe ? (
            <span>⏳ {resultado.mensaje}</span>
          ) : (
            <span>📨 {resultado.mensaje} (Rango: {resultado.rango?.desde} → {resultado.rango?.hasta})</span>
          )}
        </div>
      )}

      {/* Historial de reportes */}
      {ultimosReports && ultimosReports.length > 0 && (
        <div className="rounded-lg border border-surface-border bg-white p-4">
          <h4 className="mb-2 text-sm font-semibold text-gray-800">Reportes solicitados</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-left text-gray-600">
                <tr>
                  <th className="px-2 py-1">Solicitado</th>
                  <th className="px-2 py-1">Rango</th>
                  <th className="px-2 py-1">Estado</th>
                  <th className="px-2 py-1 text-right">Payouts</th>
                  <th className="px-2 py-1 text-right">Cargos</th>
                  <th className="px-2 py-1 text-right">Filas CSV</th>
                  <th className="px-2 py-1">Tiempo</th>
                </tr>
              </thead>
              <tbody>
                {ultimosReports.map((r) => {
                  const esperaMin = r.processed_at
                    ? Math.round(
                        (new Date(r.processed_at).getTime() - new Date(r.created_at).getTime()) /
                          60000,
                      )
                    : Math.round((Date.now() - new Date(r.created_at).getTime()) / 60000);
                  return (
                    <tr key={r.id} className="border-t border-gray-100">
                      <td className="px-2 py-1 text-gray-500">
                        {new Date(r.created_at).toLocaleString('es-AR', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="px-2 py-1 text-gray-600">
                        {r.begin_date} → {r.end_date}
                      </td>
                      <td className="px-2 py-1">
                        {r.status === 'pending' && (
                          <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700">
                            ⏳ Esperando MP{r.poll_intentos ? ` (${r.poll_intentos} chequeos)` : ''}
                          </span>
                        )}
                        {r.status === 'processing' && (
                          <span className="rounded bg-cyan-100 px-1.5 py-0.5 text-[10px] text-cyan-700">
                            ⚙️ Procesando
                          </span>
                        )}
                        {r.status === 'done' && (
                          <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] text-green-700">
                            ✓ Completado
                          </span>
                        )}
                        {r.status === 'timeout' && (
                          <span
                            className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700"
                            title={r.error_msg ?? ''}
                          >
                            ⌛ Timeout
                          </span>
                        )}
                        {r.status === 'error' && (
                          <span
                            className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] text-red-700"
                            title={r.error_msg ?? ''}
                          >
                            ✗ Error
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1 text-right text-blue-700">
                        {r.payouts_insertados ?? '—'}
                      </td>
                      <td className="px-2 py-1 text-right text-amber-700">
                        {r.cargos_insertados ?? '—'}
                      </td>
                      <td className="px-2 py-1 text-right text-gray-500">{r.filas_csv ?? '—'}</td>
                      <td className="px-2 py-1 text-gray-500">
                        {esperaMin === 0 ? '<1 min' : `${esperaMin} min`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal: Vincular a gasto existente */}
      {vincularMov && (
        <VincularGastoModal
          movimiento={vincularMov}
          onClose={() => setVincularMov(null)}
          onVinculado={refrescar}
        />
      )}

      {/* Modal: Crear gasto desde movimiento (reusa NuevoGastoModal con prefill) */}
      {crearGastoPrefill && (
        <NuevoGastoModal
          open
          onClose={() => setCrearGastoPrefill(null)}
          prefill={crearGastoPrefill.prefill}
          onSaved={onGastoCreado}
        />
      )}

      {/* Modal: Transferencia interna con auto-match del gemelo */}
      {transferenciaMov && (
        <TransferenciaInternaModal
          movimiento={transferenciaMov}
          onClose={() => setTransferenciaMov(null)}
          onConfirmado={refrescar}
        />
      )}

      {/* Movimientos MP recientes */}
      {movsRecientes && movsRecientes.length > 0 && (
        <div className="rounded-lg border border-surface-border bg-white p-4">
          <h4 className="mb-2 text-sm font-semibold text-gray-800">
            Movimientos MP del período ({movsRecientes.length})
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-left text-gray-600">
                <tr>
                  <th className="px-2 py-1">Fecha</th>
                  <th className="px-2 py-1">Descripción</th>
                  <th className="px-2 py-1">Tipo</th>
                  <th className="px-2 py-1 text-right">Monto</th>
                  <th className="px-2 py-1">Ref</th>
                  <th className="px-2 py-1">Estado</th>
                  <th className="px-2 py-1 text-right">Acción</th>
                </tr>
              </thead>
              <tbody>
                {movsRecientes.map((m) => {
                  const sinVincular =
                    !m.gasto_id && m.tipo !== 'cargo_mp' && m.tipo !== 'ignorado';
                  return (
                    <tr key={m.id} className="border-t border-gray-100">
                      <td className="px-2 py-1 text-gray-600">{m.fecha}</td>
                      <td className="px-2 py-1">
                        <span className="block max-w-xs truncate">{m.descripcion ?? '—'}</span>
                        {m.sugerencia && (
                          <span className="text-[10px] text-gray-400">→ {m.sugerencia}</span>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        {m.fuente === 'api_mp_release_charge' ? (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
                            Cargo
                          </span>
                        ) : (
                          <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700">
                            Egreso
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1 text-right font-mono text-red-700">
                        -{formatARS(m.debito)}
                      </td>
                      <td className="px-2 py-1 font-mono text-[10px] text-gray-500">
                        {(m.referencia ?? '').slice(0, 14)}
                      </td>
                      <td className="px-2 py-1">
                        {m.gasto_id ? (
                          <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">
                            ✓ Vinculado
                          </span>
                        ) : m.tipo === 'cargo_mp' ? (
                          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">
                            Cargo automático
                          </span>
                        ) : m.tipo === 'ignorado' ? (
                          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">
                            Ignorado
                          </span>
                        ) : (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
                            Sin vincular
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1 text-right">
                        {sinVincular ? (
                          <div className="flex justify-end gap-1">
                            <button
                              onClick={() => abrirVincular(m)}
                              className="rounded bg-blue-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-blue-700"
                              title="Vincular este movimiento a un gasto que ya cargaste"
                            >
                              Vincular
                            </button>
                            <button
                              onClick={() => abrirCrearGasto(m)}
                              className="rounded bg-purple-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-purple-700"
                              title="Crear un gasto nuevo desde este movimiento"
                            >
                              Crear gasto
                            </button>
                            <button
                              onClick={() => abrirTransferencia(m)}
                              className="rounded bg-cyan-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-cyan-700"
                              title="Marcar como transferencia interna entre cuentas propias (MP ↔ Galicia/ICBC)"
                            >
                              Transf. interna
                            </button>
                            <button
                              onClick={() => ignorarMov(m)}
                              className="rounded border border-gray-300 px-2 py-1 text-[10px] text-gray-600 hover:bg-gray-50"
                            >
                              Ignorar
                            </button>
                          </div>
                        ) : (
                          <span className="text-[10px] text-gray-300">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
