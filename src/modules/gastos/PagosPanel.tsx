import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { formatARS, formatFecha, cn } from '@/lib/utils';
import type { Gasto, MedioPago, PagoGasto } from './types';
import { MEDIO_PAGO_LABEL } from './types';
import { PagarGastoModal } from './PagarGastoModal';
import { recomputarEstadoGasto } from './recomputarEstadoGasto';

type Vista = 'pendientes' | 'pagados' | 'todos';

interface Props {
  local: 'vedia' | 'saavedra' | 'ambos' | 'sas';
  desde: string;
  hasta: string;
}

export function PagosPanel({ local, desde, hasta }: Props) {
  const qc = useQueryClient();
  const [vista, setVista] = useState<Vista>('pendientes');
  const [busqueda, setBusqueda] = useState('');

  // Modal único de pago — delegado a PagarGastoModal
  const [gastoAPagar, setGastoAPagar] = useState<Gasto | null>(null);

  const HOY = new Date().toISOString().split('T')[0];

  // Pendientes: TODA la deuda viva con fecha <= hasta, sin importar `desde`.
  // Si en abril quedó algo sin pagar, sigue apareciendo en mayo / junio / etc.
  const { data: pendientes, isLoading: loadingPend } = useQuery({
    queryKey: ['gastos_pagos_pendientes', local, hasta],
    queryFn: async () => {
      let q = supabase
        .from('gastos')
        .select('*')
        .lte('fecha', hasta)
        .neq('cancelado', true)
        .order('fecha', { ascending: true })
        .limit(3000);
      if (local !== 'ambos') q = q.eq('local', local);
      const { data, error } = await q;
      if (error) throw error;
      return ((data ?? []) as Gasto[]).filter(
        (g) => (g.estado_pago ?? '').toLowerCase() !== 'pagado',
      );
    },
  });

  // Pagados del rango: filtran por fecha_pago (cuando salió la plata),
  // no por la fecha del comprobante.
  const { data: pagosRango, isLoading: loadingPag } = useQuery({
    queryKey: ['gastos_pagos_rango', local, desde, hasta],
    queryFn: async () => {
      let q = supabase
        .from('pagos_gastos')
        .select('*, gasto:gastos!inner(*)')
        .gte('fecha_pago', desde)
        .lte('fecha_pago', hasta)
        .order('fecha_pago', { ascending: false });
      if (local !== 'ambos') q = q.eq('gasto.local', local);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as (PagoGasto & { gasto: Gasto })[];
    },
  });

  const isLoading = vista === 'pagados' ? loadingPag : loadingPend;

  const filtrados = useMemo(() => {
    let lista: { gasto: Gasto; pago?: PagoGasto }[] = [];
    if (vista === 'pendientes') {
      lista = (pendientes ?? []).map((g) => ({ gasto: g }));
    } else if (vista === 'pagados') {
      lista = (pagosRango ?? []).map((p) => ({ gasto: p.gasto, pago: p }));
    } else {
      const ids = new Set<string>();
      for (const g of pendientes ?? []) {
        lista.push({ gasto: g });
        ids.add(g.id);
      }
      for (const p of pagosRango ?? []) {
        if (!ids.has(p.gasto.id)) {
          lista.push({ gasto: p.gasto, pago: p });
          ids.add(p.gasto.id);
        }
      }
    }
    if (busqueda.trim()) {
      const b = busqueda.toLowerCase();
      lista = lista.filter(
        ({ gasto: g }) =>
          (g.proveedor ?? '').toLowerCase().includes(b) ||
          (g.comentario ?? '').toLowerCase().includes(b) ||
          (g.categoria ?? '').toLowerCase().includes(b),
      );
    }
    return lista;
  }, [pendientes, pagosRango, vista, busqueda]);

  const totales = useMemo(
    () => ({
      cantPendientes: pendientes?.length ?? 0,
      cantPagados: pagosRango?.length ?? 0,
    }),
    [pendientes, pagosRango],
  );

  async function revertirPago(g: Gasto) {
    if (
      !window.confirm(
        `¿Revertir el pago de ${g.proveedor || 'sin proveedor'} por ${formatARS(g.importe_total)}?\n\nEl gasto vuelve a Pendiente para poder pagarlo de nuevo con el medio correcto.`,
      )
    )
      return;
    // Volver a Pendiente manteniendo la fecha_vencimiento original. Antes la
    // reseteábamos a null y el gasto caía al final del query (orden venc ASC)
    // y desaparecía del listado.
    const { error } = await supabase
      .from('gastos')
      .update({ estado_pago: 'Pendiente' })
      .eq('id', g.id);
    if (error) {
      window.alert(error.message);
      return;
    }
    // Liberar el movimiento bancario conciliado para que pueda matchearse
    // contra el pago correcto cuando se vuelva a registrar.
    await supabase.from('movimientos_bancarios').update({ gasto_id: null }).eq('gasto_id', g.id);
    await supabase.from('pagos_gastos').delete().eq('gasto_id', g.id);
    qc.invalidateQueries({ queryKey: ['gastos_pagos_pendientes'] });
    qc.invalidateQueries({ queryKey: ['gastos_pagos_rango'] });
    qc.invalidateQueries({ queryKey: ['gastos_listado'] });
    qc.invalidateQueries({ queryKey: ['pagos_gastos'] });
    qc.invalidateQueries({ queryKey: ['gastos_resumen_kpis'] });
    qc.invalidateQueries({ queryKey: ['movimientos_bancarios'] });
  }

  // Confirmar el débito de un echeq programado: la plata salió, deja de ser "a futuro".
  // El gasto recalcula su estado (puede pasar de Parcial → Pagado).
  async function confirmarDebito(pago: PagoGasto, g: Gasto) {
    if (
      !window.confirm(
        `¿Confirmar que se debitó el echeq de ${formatARS(Number(pago.monto))} (${formatFecha(pago.fecha_pago)})?\n\nLa cuota pasa a pagada y el gasto se recalcula.`,
      )
    )
      return;
    const { error } = await supabase
      .from('pagos_gastos')
      .update({ programado: false })
      .eq('id', pago.id);
    if (error) {
      window.alert(error.message);
      return;
    }
    await recomputarEstadoGasto(g.id);
    qc.invalidateQueries({ queryKey: ['gastos_pagos_pendientes'] });
    qc.invalidateQueries({ queryKey: ['gastos_pagos_rango'] });
    qc.invalidateQueries({ queryKey: ['gastos_listado'] });
    qc.invalidateQueries({ queryKey: ['pagos_gastos'] });
    qc.invalidateQueries({ queryKey: ['gastos_resumen_kpis'] });
  }

  return (
    <div>
      {/* Filtros */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar proveedor..."
          className="min-w-[180px] flex-1 rounded border border-gray-300 px-2 py-1.5 text-xs"
        />
        <span className="text-xs text-gray-400">
          {totales.cantPendientes} pendientes · {totales.cantPagados} pagados
        </span>
      </div>

      {/* Vista tabs */}
      <div className="mb-4 flex gap-1">
        {[
          { id: 'pendientes' as Vista, label: 'Pendientes', color: 'amber' },
          { id: 'pagados' as Vista, label: 'Pagados', color: 'green' },
          { id: 'todos' as Vista, label: 'Todos', color: 'gray' },
        ].map((v) => (
          <button
            key={v.id}
            onClick={() => setVista(v.id)}
            className={cn(
              'rounded border px-3 py-1.5 text-xs font-medium',
              vista === v.id
                ? 'border-rodziny-700 bg-rodziny-700 text-white'
                : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50',
            )}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* Tabla */}
      <div className="overflow-hidden rounded-lg border border-surface-border bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr className="uppercase text-gray-500">
                <th className="px-3 py-2 text-left font-semibold">Fecha gasto</th>
                <th className="px-3 py-2 text-left font-semibold">Proveedor</th>
                <th className="px-3 py-2 text-left font-semibold">Categoría</th>
                <th className="px-3 py-2 text-left font-semibold">Comentario</th>
                <th className="px-3 py-2 text-right font-semibold">Total</th>
                <th className="px-3 py-2 text-center font-semibold">Estado</th>
                <th className="px-3 py-2 text-center font-semibold">Vence</th>
                <th className="px-3 py-2 text-center font-semibold">Medio</th>
                <th className="px-3 py-2 text-center font-semibold">Fecha pago</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-gray-400">
                    Cargando...
                  </td>
                </tr>
              )}
              {!isLoading && filtrados.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-gray-400">
                    Sin gastos
                  </td>
                </tr>
              )}
              {filtrados.map(({ gasto: g, pago }) => {
                const pagado = (g.estado_pago ?? '').toLowerCase() === 'pagado';
                const venc = !pagado && g.fecha_vencimiento ? g.fecha_vencimiento : null;
                const vencido = venc !== null && venc < HOY;
                return (
                  <tr
                    key={g.id}
                    className={cn(
                      'border-b border-gray-100 hover:bg-gray-50',
                      pagado && 'bg-green-50/30',
                      vencido && 'bg-red-50/40',
                    )}
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-gray-700">
                      {formatFecha(g.fecha)}
                    </td>
                    <td className="px-3 py-2 font-medium text-gray-900">{g.proveedor || '—'}</td>
                    <td className="px-3 py-2 text-gray-600">{g.categoria || '—'}</td>
                    <td
                      className="max-w-[200px] truncate px-3 py-2 text-gray-600"
                      title={g.comentario ?? ''}
                    >
                      {g.comentario || '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-900">
                      {formatARS(g.importe_total)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {pago?.programado ? (
                        <span className="inline-block rounded bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                          🗓 Programado
                        </span>
                      ) : (
                        <span
                          className={cn(
                            'inline-block rounded px-2 py-0.5 text-[10px] font-medium',
                            pagado
                              ? 'bg-green-100 text-green-800'
                              : vencido
                                ? 'bg-red-100 text-red-800'
                                : 'bg-amber-100 text-amber-800',
                          )}
                        >
                          {pagado ? 'Pagado' : vencido ? 'Vencido' : 'Pendiente'}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-center">
                      {pagado ? (
                        <span className="text-gray-300">—</span>
                      ) : venc ? (
                        <span
                          className={cn(
                            'text-xs',
                            vencido ? 'font-semibold text-red-700' : 'text-gray-600',
                          )}
                          title={vencido ? 'Vencido — pagar cuanto antes' : 'Vence en el futuro'}
                        >
                          {formatFecha(venc)}
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center text-gray-600">
                      {pago
                        ? (MEDIO_PAGO_LABEL[pago.medio_pago as MedioPago] ?? pago.medio_pago)
                        : '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-center text-gray-600">
                      {pago ? formatFecha(pago.fecha_pago) : '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {pago?.programado ? (
                        <button
                          onClick={() => confirmarDebito(pago, g)}
                          className="rounded bg-blue-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-blue-700"
                          title="Marcar que el echeq ya se debitó"
                        >
                          ✓ Confirmar débito
                        </button>
                      ) : !pagado ? (
                        <button
                          onClick={() => setGastoAPagar(g)}
                          className="rounded bg-green-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-green-700"
                        >
                          Registrar pago
                        </button>
                      ) : (
                        <button
                          onClick={() => revertirPago(g)}
                          className="rounded border border-red-200 px-2 py-1 text-[10px] text-red-600 hover:bg-red-50"
                        >
                          Revertir
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {filtrados.length > 0 && (
              <tfoot className="border-t border-gray-300 bg-gray-100">
                <tr className="font-semibold">
                  <td colSpan={4} className="px-3 py-2 text-right text-gray-600">
                    TOTAL ({filtrados.length}):
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatARS(
                      filtrados.reduce((s, { gasto: g }) => s + Number(g.importe_total), 0),
                    )}
                  </td>
                  <td colSpan={5}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Modal único de pago */}
      <PagarGastoModal
        open={!!gastoAPagar}
        gasto={gastoAPagar}
        onClose={() => setGastoAPagar(null)}
      />
    </div>
  );
}
