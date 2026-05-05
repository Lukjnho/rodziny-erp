import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { formatARS, formatFecha } from '@/lib/utils';

export interface MovimientoTransferible {
  id: string;
  cuenta: string;
  fecha: string;
  debito: number;
  credito: number;
  descripcion: string | null;
}

interface GemeloRow {
  id: string;
  cuenta: string;
  fecha: string;
  descripcion: string | null;
  debito: number;
  credito: number;
}

const CUENTA_LABEL: Record<string, string> = {
  mercadopago: 'MercadoPago',
  galicia: 'Galicia',
  icbc: 'ICBC',
};

export function TransferenciaInternaModal({
  movimiento,
  onClose,
  onConfirmado,
}: {
  movimiento: MovimientoTransferible;
  onClose: () => void;
  onConfirmado: () => void;
}) {
  const monto =
    Number(movimiento.debito) > 0 ? Number(movimiento.debito) : Number(movimiento.credito);
  const esEgreso = Number(movimiento.debito) > 0;
  const [guardando, setGuardando] = useState(false);

  // Gemelos: en otra cuenta, signo opuesto, monto igual, ±2 días, sin par.
  const { data: gemelos, isLoading } = useQuery({
    queryKey: ['transf_gemelos', movimiento.id],
    queryFn: async () => {
      const fmin = new Date(movimiento.fecha + 'T12:00:00Z');
      fmin.setUTCDate(fmin.getUTCDate() - 2);
      const fmax = new Date(movimiento.fecha + 'T12:00:00Z');
      fmax.setUTCDate(fmax.getUTCDate() + 2);
      let q = supabase
        .from('movimientos_bancarios')
        .select('id, cuenta, fecha, descripcion, debito, credito')
        .neq('cuenta', movimiento.cuenta)
        .neq('id', movimiento.id)
        .is('transferencia_par_id', null)
        .gte('fecha', fmin.toISOString().split('T')[0])
        .lte('fecha', fmax.toISOString().split('T')[0])
        .or(`tipo.is.null,tipo.eq.transferencia_interna`);
      if (esEgreso) q = q.eq('credito', monto).eq('debito', 0);
      else q = q.eq('debito', monto).eq('credito', 0);
      const { data, error } = await q.limit(20);
      if (error) throw error;
      return (data ?? []) as GemeloRow[];
    },
  });

  async function emparejar(gemelo: GemeloRow | null) {
    if (guardando) return;
    setGuardando(true);
    try {
      if (gemelo) {
        const { error: e1 } = await supabase
          .from('movimientos_bancarios')
          .update({ tipo: 'transferencia_interna', transferencia_par_id: gemelo.id })
          .eq('id', movimiento.id);
        if (e1) throw e1;
        const { error: e2 } = await supabase
          .from('movimientos_bancarios')
          .update({ tipo: 'transferencia_interna', transferencia_par_id: movimiento.id })
          .eq('id', gemelo.id);
        if (e2) throw e2;
      } else {
        const { error } = await supabase
          .from('movimientos_bancarios')
          .update({ tipo: 'transferencia_interna' })
          .eq('id', movimiento.id);
        if (error) throw error;
      }
      onConfirmado();
      onClose();
    } catch (e) {
      window.alert((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-gray-800">Transferencia interna</h3>
          <p className="mt-1 text-xs text-gray-500">
            {esEgreso ? 'Sale' : 'Entra'} {formatARS(monto)} de{' '}
            {CUENTA_LABEL[movimiento.cuenta] ?? movimiento.cuenta} el{' '}
            {formatFecha(movimiento.fecha)}
          </p>
          <p className="mt-2 text-[11px] text-gray-500">
            Buscamos el gemelo en otra cuenta (mismo monto, ±2 días). Al emparejar, ninguno de los
            dos cuenta como egreso/ingreso del flujo.
          </p>
        </div>

        {isLoading ? (
          <div className="py-6 text-center text-xs text-gray-400">Buscando gemelos...</div>
        ) : (gemelos ?? []).length === 0 ? (
          <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            No encontramos gemelo en las otras cuentas dentro de ±2 días. Puede ser que el otro
            extracto aún no se importó. Si querés podés marcarlo como transferencia interna sólo
            por este lado y emparejarlo cuando importes el otro.
          </div>
        ) : (
          <div className="overflow-hidden rounded border border-gray-200">
            <table className="w-full text-xs">
              <thead className="border-b border-gray-200 bg-gray-50 text-[10px] uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left">Fecha</th>
                  <th className="px-3 py-2 text-left">Cuenta</th>
                  <th className="px-3 py-2 text-left">Descripción</th>
                  <th className="px-3 py-2 text-right">Monto</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {(gemelos ?? []).map((g) => (
                  <tr key={g.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="whitespace-nowrap px-3 py-2 text-gray-700">
                      {formatFecha(g.fecha)}
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      {CUENTA_LABEL[g.cuenta] ?? g.cuenta}
                    </td>
                    <td
                      className="max-w-[220px] truncate px-3 py-2 text-gray-700"
                      title={g.descripcion ?? ''}
                    >
                      {g.descripcion ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-900">
                      {formatARS(Number(g.debito) > 0 ? Number(g.debito) : Number(g.credito))}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <button
                        disabled={guardando}
                        onClick={() => emparejar(g)}
                        className="rounded bg-cyan-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-cyan-700 disabled:opacity-50"
                      >
                        Emparejar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            disabled={guardando}
            onClick={() => emparejar(null)}
            className="rounded border border-cyan-300 bg-cyan-50 px-3 py-1.5 text-xs text-cyan-800 hover:bg-cyan-100 disabled:opacity-50"
          >
            Marcar solo este lado
          </button>
        </div>
      </div>
    </div>
  );
}
