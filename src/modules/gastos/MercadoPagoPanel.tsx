import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cn, formatARS } from '@/lib/utils';
import { conciliarPorIdOperacion } from './conciliarPorIdOperacion';
import { VincularGastoModal, type MovimientoVinculable } from './VincularGastoModal';
import { NuevoGastoModal, type PrefillGasto } from './NuevoGastoModal';

interface MesDetalle {
  mes: string;
  payments: number;
  movs_nuevos: number;
  movs_existentes: number;
  charges_nuevos: number;
  charges_existentes: number;
  errores: string[];
}

interface SyncResult {
  ok: boolean;
  run_id?: string;
  status?: 'success' | 'partial' | 'error';
  meses_procesados?: number;
  totales?: {
    payments_encontrados: number;
    movs_principales_nuevos: number;
    movs_principales_existentes: number;
    charges_nuevos: number;
    charges_existentes: number;
  };
  detalle_meses?: MesDetalle[];
  errores?: string[];
  error?: string;
}

interface Conc {
  vinculados: number;
  errores: string[];
}

interface SyncRunRow {
  id: string;
  started_at: string;
  finished_at: string | null;
  desde: string;
  hasta: string;
  meses_procesados: number;
  payments_encontrados: number;
  movs_principales_nuevos: number;
  charges_nuevos: number;
  conciliados: number;
  status: string;
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
  const [resultado, setResultado] = useState<SyncResult | null>(null);
  const [conc, setConc] = useState<Conc | null>(null);
  const [vincularMov, setVincularMov] = useState<MovimientoVinculable | null>(null);
  const [crearGastoPrefill, setCrearGastoPrefill] = useState<{
    movId: string;
    prefill: PrefillGasto;
  } | null>(null);
  const qc = useQueryClient();

  function refrescar() {
    qc.invalidateQueries({ queryKey: ['mp_movs_recientes'] });
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

  const { data: ultimosRuns } = useQuery({
    queryKey: ['mp_sync_runs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mp_sync_runs')
        .select(
          'id, started_at, finished_at, desde, hasta, meses_procesados, payments_encontrados, movs_principales_nuevos, charges_nuevos, conciliados, status',
        )
        .order('started_at', { ascending: false })
        .limit(8);
      if (error) throw error;
      return (data ?? []) as SyncRunRow[];
    },
  });

  const { data: movsRecientes } = useQuery({
    queryKey: ['mp_movs_recientes', desde, hasta],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('movimientos_bancarios')
        .select('id, fecha, descripcion, debito, referencia, fuente, tipo, gasto_id, sugerencia')
        .eq('cuenta', 'mercadopago')
        .in('fuente', ['api_mp_egresos', 'api_mp_egresos_charge'])
        .gte('fecha', desde)
        .lte('fecha', hasta)
        .order('fecha', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as MovMPRow[];
    },
  });

  async function sincronizar() {
    setSyncing(true);
    setResultado(null);
    setConc(null);
    try {
      const { data, error } = await supabase.functions.invoke('sync-mp-egresos', {
        body: { desde, hasta },
      });
      if (error) {
        setResultado({ ok: false, error: error.message });
        return;
      }
      setResultado(data as SyncResult);

      // Si hubo movs nuevos, correr conciliacion por N° operacion
      const totalNuevos = (data as SyncResult)?.totales?.movs_principales_nuevos ?? 0;
      if (totalNuevos > 0) {
        const c = await conciliarPorIdOperacion();
        setConc(c);

        // Actualizar contador de conciliados en el run
        const runId = (data as SyncResult)?.run_id;
        if (runId && c.vinculados > 0) {
          await supabase
            .from('mp_sync_runs')
            .update({ conciliados: c.vinculados })
            .eq('id', runId);
        }
      }

      qc.invalidateQueries({ queryKey: ['mp_sync_runs'] });
      qc.invalidateQueries({ queryKey: ['mp_movs_recientes'] });
      qc.invalidateQueries({ queryKey: ['mov_bancarios'] });
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
          Trae automáticamente tus egresos de MP (transferencias, pagos con tarjeta, suscripciones) y
          los carga como movimientos bancarios. Las comisiones e impuestos al débito se desglosan
          como cargos hijos. Después de importar, el sistema concilia automáticamente con los pagos
          que tengan N° de operación cargado.
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
            {syncing ? '⏳ Sincronizando...' : '🔄 Sincronizar egresos MP'}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-gray-500">
          Máximo 12 meses por sincronización. Idempotente: si ya importaste un período, los repetidos
          se ignoran.
        </p>
      </div>

      {syncing && (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
          ⏳ Procesando mes a mes... esto puede tardar 5-30 segundos según el rango.
        </div>
      )}

      {resultado && !syncing && (
        <div
          className={cn(
            'rounded-lg border p-4',
            resultado.ok && resultado.status === 'success'
              ? 'border-green-200 bg-green-50'
              : resultado.status === 'partial'
                ? 'border-amber-200 bg-amber-50'
                : 'border-red-200 bg-red-50',
          )}
        >
          {!resultado.ok && (
            <div className="text-sm text-red-700">❌ Error: {resultado.error ?? 'Falló el sync'}</div>
          )}
          {resultado.ok && resultado.totales && (
            <>
              <div className="mb-2 text-sm font-semibold text-gray-800">
                {resultado.status === 'success' ? '✅' : '⚠️'} Sincronización{' '}
                {resultado.status === 'success' ? 'completa' : 'con avisos'}
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-5">
                <Stat label="Meses procesados" valor={resultado.meses_procesados ?? 0} />
                <Stat label="Egresos encontrados" valor={resultado.totales.payments_encontrados} />
                <Stat
                  label="Movs nuevos"
                  valor={resultado.totales.movs_principales_nuevos}
                  destacado
                />
                <Stat
                  label="Ya existían"
                  valor={resultado.totales.movs_principales_existentes}
                  muted
                />
                <Stat label="Cargos (com/imp)" valor={resultado.totales.charges_nuevos} />
              </div>

              {resultado.detalle_meses && resultado.detalle_meses.length > 0 && (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-white/50 text-left text-gray-600">
                      <tr>
                        <th className="px-2 py-1">Mes</th>
                        <th className="px-2 py-1 text-right">Payments</th>
                        <th className="px-2 py-1 text-right">Nuevos</th>
                        <th className="px-2 py-1 text-right">Existentes</th>
                        <th className="px-2 py-1 text-right">Cargos nuevos</th>
                        <th className="px-2 py-1">Errores</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resultado.detalle_meses.map((m) => (
                        <tr key={m.mes} className="border-t border-gray-100">
                          <td className="px-2 py-1 font-medium">{m.mes}</td>
                          <td className="px-2 py-1 text-right">{m.payments}</td>
                          <td className="px-2 py-1 text-right text-green-700">{m.movs_nuevos}</td>
                          <td className="px-2 py-1 text-right text-gray-500">
                            {m.movs_existentes}
                          </td>
                          <td className="px-2 py-1 text-right">{m.charges_nuevos}</td>
                          <td className="px-2 py-1 text-red-700">
                            {m.errores.length > 0 ? m.errores[0].slice(0, 60) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {resultado.errores && resultado.errores.length > 0 && (
                <div className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                  <div className="font-medium">Errores:</div>
                  <ul className="mt-1 list-inside list-disc">
                    {resultado.errores.slice(0, 5).map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {conc && !syncing && (
        <div
          className={cn(
            'rounded-lg border p-3 text-sm',
            conc.errores.length === 0
              ? 'border-blue-200 bg-blue-50 text-blue-800'
              : 'border-amber-200 bg-amber-50 text-amber-800',
          )}
        >
          {conc.vinculados > 0 ? (
            <>
              🔗 <strong>{conc.vinculados}</strong> pago{conc.vinculados === 1 ? '' : 's'} vinculado
              {conc.vinculados === 1 ? '' : 's'} automáticamente al gasto correspondiente por N° de
              operación.
            </>
          ) : (
            <span className="text-gray-600">
              Ningún pago coincidió por N° de operación con los movimientos importados. Cargá pagos
              con N° de operación o usá las reglas para vincular en lote.
            </span>
          )}
        </div>
      )}

      {/* Historial de syncs */}
      {ultimosRuns && ultimosRuns.length > 0 && (
        <div className="rounded-lg border border-surface-border bg-white p-4">
          <h4 className="mb-2 text-sm font-semibold text-gray-800">Últimas sincronizaciones</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-left text-gray-600">
                <tr>
                  <th className="px-2 py-1">Cuándo</th>
                  <th className="px-2 py-1">Rango</th>
                  <th className="px-2 py-1 text-right">Meses</th>
                  <th className="px-2 py-1 text-right">Egresos</th>
                  <th className="px-2 py-1 text-right">Nuevos</th>
                  <th className="px-2 py-1 text-right">Cargos</th>
                  <th className="px-2 py-1 text-right">Conciliados</th>
                  <th className="px-2 py-1">Estado</th>
                </tr>
              </thead>
              <tbody>
                {ultimosRuns.map((r) => (
                  <tr key={r.id} className="border-t border-gray-100">
                    <td className="px-2 py-1 text-gray-500">
                      {new Date(r.started_at).toLocaleString('es-AR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="px-2 py-1 text-gray-600">
                      {r.desde} → {r.hasta}
                    </td>
                    <td className="px-2 py-1 text-right">{r.meses_procesados}</td>
                    <td className="px-2 py-1 text-right">{r.payments_encontrados}</td>
                    <td className="px-2 py-1 text-right text-green-700">
                      {r.movs_principales_nuevos}
                    </td>
                    <td className="px-2 py-1 text-right">{r.charges_nuevos}</td>
                    <td className="px-2 py-1 text-right text-blue-700">{r.conciliados}</td>
                    <td className="px-2 py-1">
                      {r.status === 'success' && <span className="text-green-700">✓ OK</span>}
                      {r.status === 'partial' && <span className="text-amber-700">⚠ Parcial</span>}
                      {r.status === 'error' && <span className="text-red-700">✗ Error</span>}
                      {r.status === 'running' && <span className="text-blue-700">⏳ Corriendo</span>}
                    </td>
                  </tr>
                ))}
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
                        {m.fuente === 'api_mp_egresos_charge' ? (
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

function Stat({
  label,
  valor,
  destacado,
  muted,
}: {
  label: string;
  valor: number;
  destacado?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-md p-2',
        destacado ? 'bg-green-100' : muted ? 'bg-gray-100' : 'bg-white',
      )}
    >
      <div className="text-[10px] uppercase text-gray-500">{label}</div>
      <div
        className={cn(
          'text-lg font-bold',
          destacado ? 'text-green-700' : muted ? 'text-gray-500' : 'text-gray-800',
        )}
      >
        {valor.toLocaleString('es-AR')}
      </div>
    </div>
  );
}
