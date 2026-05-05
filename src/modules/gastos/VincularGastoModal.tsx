import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { formatARS, formatFecha, cn } from '@/lib/utils';
import type { Gasto, MedioPago } from './types';

export interface MovimientoVinculable {
  id: string;
  cuenta: string;
  fecha: string;
  debito: number;
  credito: number;
  descripcion: string | null;
  referencia: string | null;
}

interface PagoExistente {
  id: string;
  conciliado_movimiento_id: string | null;
  monto: number;
  fecha_pago: string;
}

interface GastoCandidato extends Gasto {
  pagos?: PagoExistente[];
}

const CUENTA_LABEL: Record<string, string> = {
  mercadopago: 'MercadoPago',
  galicia: 'Galicia',
  icbc: 'ICBC',
};

const MEDIO_DESDE_CUENTA: Record<string, MedioPago> = {
  mercadopago: 'transferencia_mp',
  galicia: 'cheque_galicia',
  icbc: 'tarjeta_icbc',
};

export function VincularGastoModal({
  movimiento,
  onClose,
  onVinculado,
}: {
  movimiento: MovimientoVinculable;
  onClose: () => void;
  onVinculado: () => void;
}) {
  const [busqueda, setBusqueda] = useState('');
  const [guardando, setGuardando] = useState(false);
  const monto =
    Number(movimiento.debito) > 0 ? Number(movimiento.debito) : Number(movimiento.credito);

  // Candidatos con monto similar (±20%) y fecha en una ventana ±60 días alrededor
  // del movimiento. La ventana es bidireccional porque:
  //   - Hacia atrás: factura cargada antes del débito (caso clásico).
  //   - Hacia adelante: factura cargada después (ej. Pagos Fijos pone fecha=hoy
  //     al marcar pagado, posterior a la fecha real del débito en el extracto).
  // Casos cubiertos:
  //   1) Gastos pendientes.
  //   2) Gastos pagados con pagos_gastos sin conciliar a un movimiento bancario
  //      (caso ChecklistPagos: pago marcado pagado, ahora aparece el débito real
  //      en el extracto y necesitamos reconciliarlo, NO duplicar).
  const { data: candidatos, isLoading } = useQuery({
    queryKey: ['vincular_gasto_candidatos', movimiento.id],
    queryFn: async () => {
      const tolerancia = monto * 0.2;
      const fechaBase = new Date(movimiento.fecha + 'T12:00:00Z');
      const desdeFecha = new Date(fechaBase);
      desdeFecha.setUTCDate(desdeFecha.getUTCDate() - 60);
      const hastaFecha = new Date(fechaBase);
      hastaFecha.setUTCDate(hastaFecha.getUTCDate() + 60);
      const { data, error } = await supabase
        .from('gastos')
        .select(
          'id, fecha, proveedor, categoria, importe_total, estado_pago, local, pagos:pagos_gastos(id, conciliado_movimiento_id, monto, fecha_pago)',
        )
        .neq('cancelado', true)
        .gte('importe_total', monto - tolerancia)
        .lte('importe_total', monto + tolerancia)
        .gte('fecha', desdeFecha.toISOString().split('T')[0])
        .lte('fecha', hastaFecha.toISOString().split('T')[0])
        .order('fecha', { ascending: false })
        .limit(100);
      if (error) throw error;
      const lista = (data ?? []) as unknown as GastoCandidato[];
      return lista.filter((g) => {
        if (g.estado_pago !== 'Pagado') return true;
        return (g.pagos ?? []).some((p) => p.conciliado_movimiento_id === null);
      });
    },
  });

  // Ordenar candidatos por cercanía al monto del movimiento — ascendente —
  // para que los matchs más probables aparezcan arriba.
  const filtrados = useMemo(() => {
    let lista = candidatos ?? [];
    if (busqueda.trim()) {
      const b = busqueda.toLowerCase();
      lista = lista.filter(
        (g) =>
          (g.proveedor ?? '').toLowerCase().includes(b) ||
          (g.categoria ?? '').toLowerCase().includes(b),
      );
    }
    return [...lista].sort(
      (a, b) =>
        Math.abs(Number(a.importe_total) - monto) - Math.abs(Number(b.importe_total) - monto),
    );
  }, [candidatos, busqueda, monto]);

  async function vincular(gasto: GastoCandidato) {
    if (guardando) return;
    setGuardando(true);
    try {
      const { error: e1 } = await supabase
        .from('movimientos_bancarios')
        .update({ tipo: 'pago_de_gasto', gasto_id: gasto.id })
        .eq('id', movimiento.id);
      if (e1) throw e1;

      const pagosSinConciliar = (gasto.pagos ?? []).filter(
        (p) => p.conciliado_movimiento_id === null,
      );

      if (pagosSinConciliar.length > 0) {
        const tol = monto * 0.2;
        const pagoTarget =
          pagosSinConciliar.find((p) => Math.abs(Number(p.monto) - monto) <= tol) ??
          pagosSinConciliar[0];
        const { error } = await supabase
          .from('pagos_gastos')
          .update({ conciliado_movimiento_id: movimiento.id })
          .eq('id', pagoTarget.id);
        if (error) throw error;
      } else {
        const { error: e2 } = await supabase
          .from('gastos')
          .update({ estado_pago: 'Pagado' })
          .eq('id', gasto.id);
        if (e2) throw e2;
        const { error: e3 } = await supabase.from('pagos_gastos').insert({
          gasto_id: gasto.id,
          fecha_pago: movimiento.fecha,
          monto: monto,
          medio_pago: MEDIO_DESDE_CUENTA[movimiento.cuenta] ?? 'transferencia_mp',
          referencia: movimiento.referencia,
          conciliado_movimiento_id: movimiento.id,
        });
        if (e3) throw e3;
      }

      onVinculado();
      onClose();
    } catch (e) {
      window.alert((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-gray-800">Vincular movimiento a gasto</h3>
          <p className="mt-1 text-xs text-gray-500">
            {formatFecha(movimiento.fecha)} ·{' '}
            {CUENTA_LABEL[movimiento.cuenta] ?? movimiento.cuenta} ·{' '}
            <span className="font-semibold">{formatARS(monto)}</span>
            <span className="ml-1 text-gray-400">— {movimiento.descripcion ?? '—'}</span>
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
            Candidatos con monto similar (±20%) en una ventana de ±60 días alrededor del
            movimiento, ordenados del más cercano al monto. Match exacto resaltado en verde.
          </p>
          <div className="mt-2 flex flex-wrap gap-3 text-[11px]">
            <span className="text-gray-500">
              <span className="rounded bg-blue-600 px-1.5 py-0.5 font-medium text-white">
                Vincular
              </span>{' '}
              gasto pendiente — lo marca pagado y registra el pago.
            </span>
            <span className="text-gray-500">
              <span className="rounded bg-blue-600 px-1.5 py-0.5 font-medium text-white">
                Reconciliar
              </span>{' '}
              gasto ya pagado (ej. desde Pagos Fijos) — solo une el pago al movimiento, no
              duplica el egreso en Flujo de Caja.
            </span>
          </div>
        </div>
        <input
          autoFocus
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Filtrar por proveedor o categoría..."
          className="mb-3 w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
        />
        <div className="overflow-hidden rounded border border-gray-200">
          <table className="w-full text-xs">
            <thead className="border-b border-gray-200 bg-gray-50 text-[10px] uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left">Fecha</th>
                <th className="px-3 py-2 text-left">Proveedor</th>
                <th className="px-3 py-2 text-left">Categoría</th>
                <th className="px-3 py-2 text-center">Estado</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-gray-400">
                    Buscando...
                  </td>
                </tr>
              )}
              {!isLoading && filtrados.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-gray-400">
                    No hay gastos compatibles con monto similar.
                    <br />
                    Probá "Crear gasto" en su lugar.
                  </td>
                </tr>
              )}
              {filtrados.map((g) => {
                const yaPagado = g.estado_pago === 'Pagado';
                const diff = Number(g.importe_total) - monto;
                const absDiff = Math.abs(diff);
                const matchExacto = absDiff < 1;
                const matchCercano = !matchExacto && absDiff < monto * 0.02; // ≤2 %
                return (
                  <tr
                    key={g.id}
                    className={cn(
                      'border-b border-gray-100 hover:bg-gray-50',
                      matchExacto && 'bg-green-50/60',
                    )}
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-gray-700">
                      {formatFecha(g.fecha)}
                    </td>
                    <td className="px-3 py-2 font-medium text-gray-900">{g.proveedor || '—'}</td>
                    <td className="px-3 py-2 text-gray-600">{g.categoria || '—'}</td>
                    <td className="px-3 py-2 text-center">
                      {yaPagado ? (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                          Pagado · sin conciliar
                        </span>
                      ) : (
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-700">
                          Pendiente
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-900">
                      {formatARS(g.importe_total)}
                      <div className="mt-0.5 text-[10px] font-normal">
                        {matchExacto ? (
                          <span className="font-bold text-green-700">✓ exacto</span>
                        ) : (
                          <span
                            className={cn(
                              matchCercano ? 'text-green-600' : 'text-gray-400',
                            )}
                          >
                            {diff > 0 ? '+' : '−'}
                            {formatARS(absDiff)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <button
                        disabled={guardando}
                        onClick={() => vincular(g)}
                        className="rounded bg-blue-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        title={
                          yaPagado
                            ? 'Reconciliar pago existente con este movimiento'
                            : 'Marcar como pagado y vincular'
                        }
                      >
                        {yaPagado ? 'Reconciliar' : 'Vincular'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
