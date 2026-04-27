import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { LocalSelector } from '@/components/ui/LocalSelector';
import { formatARS, formatFecha, cn } from '@/lib/utils';
import type { Gasto, MedioPago, PagoGasto } from './types';
import { MEDIO_PAGO_LABEL } from './types';

const HOY = new Date();
function primerDiaDelMes(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
}
function ultimoDiaDelMes(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0];
}

type Vista = 'pendientes' | 'pagados' | 'todos';

export function PagosPanel() {
  const qc = useQueryClient();
  const [local, setLocal] = useState<'ambos' | 'vedia' | 'saavedra'>('vedia');
  const [vista, setVista] = useState<Vista>('pendientes');
  const [desde, setDesde] = useState(() => primerDiaDelMes(HOY));
  const [hasta, setHasta] = useState(() => ultimoDiaDelMes(HOY));
  const [busqueda, setBusqueda] = useState('');

  // Modal de pago
  const [gastoAPagar, setGastoAPagar] = useState<Gasto | null>(null);
  const [pagoFecha, setPagoFecha] = useState(() => new Date().toISOString().split('T')[0]);
  const [pagoMedio, setPagoMedio] = useState<MedioPago>('efectivo');
  const [pagoReferencia, setPagoReferencia] = useState('');
  const [pagoNotas, setPagoNotas] = useState('');
  const [pagoComprobante, setPagoComprobante] = useState<File | null>(null);
  const [pagoFactura, setPagoFactura] = useState<File | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorPago, setErrorPago] = useState<string | null>(null);

  const { data: gastos, isLoading } = useQuery({
    queryKey: ['gastos_pagos', local, desde, hasta],
    queryFn: async () => {
      let q = supabase
        .from('gastos')
        .select('*')
        .gte('fecha', desde)
        .lte('fecha', hasta)
        .neq('cancelado', true)
        .order('fecha', { ascending: false })
        .limit(2000);
      if (local !== 'ambos') q = q.eq('local', local);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Gasto[];
    },
  });

  // Historial de pagos realizados
  const { data: pagosHechos } = useQuery({
    queryKey: ['pagos_gastos_historial', local, desde, hasta],
    queryFn: async () => {
      const ids = (gastos ?? []).map((g) => g.id);
      if (!ids.length) return [];
      const { data, error } = await supabase
        .from('pagos_gastos')
        .select('*')
        .in('gasto_id', ids)
        .order('fecha_pago', { ascending: false });
      if (error) throw error;
      return (data ?? []) as PagoGasto[];
    },
    enabled: !!(gastos && gastos.length > 0),
  });

  const pagosMap = useMemo(() => {
    const m = new Map<string, PagoGasto>();
    for (const p of pagosHechos ?? []) m.set(p.gasto_id, p);
    return m;
  }, [pagosHechos]);

  const filtrados = useMemo(() => {
    let lista = gastos ?? [];
    if (vista === 'pendientes') {
      lista = lista.filter((g) => (g.estado_pago ?? '').toLowerCase() !== 'pagado');
    } else if (vista === 'pagados') {
      lista = lista.filter((g) => (g.estado_pago ?? '').toLowerCase() === 'pagado');
    }
    if (busqueda.trim()) {
      const b = busqueda.toLowerCase();
      lista = lista.filter(
        (g) =>
          (g.proveedor ?? '').toLowerCase().includes(b) ||
          (g.comentario ?? '').toLowerCase().includes(b) ||
          (g.categoria ?? '').toLowerCase().includes(b),
      );
    }
    return lista;
  }, [gastos, vista, busqueda]);

  const totales = useMemo(() => {
    const all = gastos ?? [];
    const pendientes = all.filter((g) => (g.estado_pago ?? '').toLowerCase() !== 'pagado');
    const pagados = all.filter((g) => (g.estado_pago ?? '').toLowerCase() === 'pagado');
    return {
      cantPendientes: pendientes.length,
      montoPendiente: pendientes.reduce((s, g) => s + Number(g.importe_total), 0),
      cantPagados: pagados.length,
      montoPagado: pagados.reduce((s, g) => s + Number(g.importe_total), 0),
    };
  }, [gastos]);

  function abrirModalPago(g: Gasto) {
    setGastoAPagar(g);
    setPagoFecha(new Date().toISOString().split('T')[0]);
    setPagoMedio('efectivo');
    setPagoReferencia('');
    setPagoNotas('');
    setPagoComprobante(null);
    setPagoFactura(null);
    setErrorPago(null);
  }

  function cerrarModalPago() {
    setGastoAPagar(null);
    setErrorPago(null);
    setPagoComprobante(null);
    setPagoFactura(null);
  }

  async function abrirArchivoExistente(path: string) {
    const BUCKETS = ['gastos-comprobantes', 'comprobantes', 'recepciones-fotos'];
    for (const bucket of BUCKETS) {
      const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 60);
      if (data?.signedUrl) {
        window.open(data.signedUrl, '_blank');
        return;
      }
    }
    window.alert('No se pudo abrir el archivo');
  }

  async function confirmarPago() {
    if (!gastoAPagar) return;
    setErrorPago(null);
    setGuardando(true);
    try {
      const carpeta = `${gastoAPagar.local}/${gastoAPagar.fecha.substring(0, 7)}`;

      // Subir comprobante de pago si hay
      let pathComprobantePago: string | null = null;
      if (pagoComprobante) {
        const ext = pagoComprobante.name.split('.').pop()?.toLowerCase() || 'pdf';
        const path = `${carpeta}/pago_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await supabase.storage
          .from('gastos-comprobantes')
          .upload(path, pagoComprobante, {
            contentType: pagoComprobante.type || 'application/octet-stream',
          });
        if (error) throw error;
        pathComprobantePago = path;
      }

      // Subir factura del proveedor si hay (y el gasto no la tiene aún)
      let pathFactura = gastoAPagar.factura_path ?? null;
      if (pagoFactura && !gastoAPagar.factura_path) {
        const ext = pagoFactura.name.split('.').pop()?.toLowerCase() || 'pdf';
        const path = `${carpeta}/factura_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await supabase.storage
          .from('gastos-comprobantes')
          .upload(path, pagoFactura, {
            contentType: pagoFactura.type || 'application/octet-stream',
          });
        if (error) throw error;
        pathFactura = path;
      }

      // Update del gasto
      const updateGasto: Record<string, unknown> = {
        estado_pago: 'Pagado',
        fecha_vencimiento: pagoFecha,
      };
      if (pathFactura && pathFactura !== gastoAPagar.factura_path) {
        updateGasto.factura_path = pathFactura;
      }
      const { error: errUpd } = await supabase
        .from('gastos')
        .update(updateGasto)
        .eq('id', gastoAPagar.id);
      if (errUpd) throw errUpd;

      // Insert del pago
      const { error: errIns } = await supabase.from('pagos_gastos').insert({
        gasto_id: gastoAPagar.id,
        fecha_pago: pagoFecha,
        monto: gastoAPagar.importe_total,
        medio_pago: pagoMedio,
        referencia: pagoReferencia.trim() || null,
        notas: pagoNotas.trim() || null,
        comprobante_pago_path: pathComprobantePago,
      });
      if (errIns) throw errIns;

      cerrarModalPago();
      qc.invalidateQueries({ queryKey: ['gastos_pagos'] });
      qc.invalidateQueries({ queryKey: ['pagos_gastos_historial'] });
      qc.invalidateQueries({ queryKey: ['pagos_gastos'] });
    } catch (e) {
      setErrorPago((e as Error).message ?? 'Error al guardar el pago');
    } finally {
      setGuardando(false);
    }
  }

  async function revertirPago(g: Gasto) {
    if (
      !window.confirm(
        `¿Revertir el pago de ${g.proveedor || 'sin proveedor'} por ${formatARS(g.importe_total)}?`,
      )
    )
      return;
    const { error } = await supabase
      .from('gastos')
      .update({
        estado_pago: 'pendiente',
        fecha_vencimiento: null,
      })
      .eq('id', g.id);
    if (error) {
      window.alert(error.message);
      return;
    }
    await supabase.from('pagos_gastos').delete().eq('gasto_id', g.id);
    qc.invalidateQueries({ queryKey: ['gastos_pagos'] });
    qc.invalidateQueries({ queryKey: ['pagos_gastos_historial'] });
    qc.invalidateQueries({ queryKey: ['pagos_gastos'] });
  }

  return (
    <div>
      {/* Filtros */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <LocalSelector
          value={local}
          onChange={(v) => setLocal(v as 'ambos' | 'vedia' | 'saavedra')}
          options={['vedia', 'saavedra', 'ambos']}
        />
        <input
          type="date"
          value={desde}
          onChange={(e) => setDesde(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1.5 text-xs"
        />
        <span className="text-xs text-gray-400">→</span>
        <input
          type="date"
          value={hasta}
          onChange={(e) => setHasta(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1.5 text-xs"
        />
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar proveedor..."
          className="min-w-[180px] flex-1 rounded border border-gray-300 px-2 py-1.5 text-xs"
        />
      </div>

      {/* KPIs */}
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-amber-700">
            Pendientes de pago
          </div>
          <div className="mt-0.5 text-lg font-bold text-amber-900">
            {totales.cantPendientes} — {formatARS(totales.montoPendiente)}
          </div>
        </div>
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-green-700">
            Pagados este período
          </div>
          <div className="mt-0.5 text-lg font-bold text-green-900">
            {totales.cantPagados} — {formatARS(totales.montoPagado)}
          </div>
        </div>
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
                <th className="px-3 py-2 text-center font-semibold">Medio</th>
                <th className="px-3 py-2 text-center font-semibold">Fecha pago</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-gray-400">
                    Cargando...
                  </td>
                </tr>
              )}
              {!isLoading && filtrados.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-gray-400">
                    Sin gastos en este rango
                  </td>
                </tr>
              )}
              {filtrados.map((g) => {
                const pagado = (g.estado_pago ?? '').toLowerCase() === 'pagado';
                const pago = pagosMap.get(g.id);
                return (
                  <tr
                    key={g.id}
                    className={cn(
                      'border-b border-gray-100 hover:bg-gray-50',
                      pagado && 'bg-green-50/30',
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
                      <span
                        className={cn(
                          'inline-block rounded px-2 py-0.5 text-[10px] font-medium',
                          pagado ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800',
                        )}
                      >
                        {pagado ? 'Pagado' : 'Pendiente'}
                      </span>
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
                      {!pagado ? (
                        <button
                          onClick={() => abrirModalPago(g)}
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
                    {formatARS(filtrados.reduce((s, g) => s + Number(g.importe_total), 0))}
                  </td>
                  <td colSpan={4}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Modal de pago */}
      {gastoAPagar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <div>
              <h3 className="text-sm font-semibold text-gray-800">Registrar pago</h3>
              <p className="mt-0.5 text-xs text-gray-500">
                {gastoAPagar.proveedor || 'Sin proveedor'} —{' '}
                <span className="font-semibold">{formatARS(gastoAPagar.importe_total)}</span>
                <span className="ml-1 text-gray-400">· {formatFecha(gastoAPagar.fecha)}</span>
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Fecha de pago
                </label>
                <input
                  type="date"
                  value={pagoFecha}
                  onChange={(e) => setPagoFecha(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Medio de pago
                </label>
                <select
                  value={pagoMedio}
                  onChange={(e) => setPagoMedio(e.target.value as MedioPago)}
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                >
                  {Object.entries(MEDIO_PAGO_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Referencia <span className="text-gray-400">(opcional)</span>
              </label>
              <input
                type="text"
                value={pagoReferencia}
                onChange={(e) => setPagoReferencia(e.target.value)}
                placeholder="N° de transferencia, cupón, ticket..."
                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Comprobante de pago <span className="text-gray-400">(transferencia / voucher)</span>
              </label>
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => setPagoComprobante(e.target.files?.[0] ?? null)}
                className="w-full text-xs file:mr-2 file:rounded file:border-0 file:bg-rodziny-700 file:px-2 file:py-1 file:text-[11px] file:text-white"
              />
              {pagoComprobante && (
                <div className="mt-1 text-[11px] text-green-700">📎 {pagoComprobante.name}</div>
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Factura del proveedor{' '}
                <span className="text-gray-400">(A / C / remito)</span>
              </label>
              {gastoAPagar.factura_path ? (
                <div className="flex items-center justify-between rounded-md border border-green-200 bg-green-50 px-3 py-1.5 text-xs">
                  <span className="text-green-800">✓ Ya cargada en el gasto</span>
                  <button
                    type="button"
                    onClick={() => abrirArchivoExistente(gastoAPagar.factura_path!)}
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
                    onChange={(e) => setPagoFactura(e.target.files?.[0] ?? null)}
                    className="w-full text-xs file:mr-2 file:rounded file:border-0 file:bg-rodziny-700 file:px-2 file:py-1 file:text-[11px] file:text-white"
                  />
                  {pagoFactura && (
                    <div className="mt-1 text-[11px] text-green-700">📎 {pagoFactura.name}</div>
                  )}
                </>
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Notas <span className="text-gray-400">(opcional)</span>
              </label>
              <textarea
                value={pagoNotas}
                onChange={(e) => setPagoNotas(e.target.value)}
                placeholder="Observaciones sobre este pago..."
                rows={2}
                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
              />
            </div>

            {errorPago && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {errorPago}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={cerrarModalPago}
                disabled={guardando}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarPago}
                disabled={guardando}
                className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                {guardando ? 'Guardando…' : 'Confirmar pago'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
