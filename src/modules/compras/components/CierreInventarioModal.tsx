import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatARS } from '@/lib/utils';

interface SnapshotResult {
  monto_alimentos: number;
  monto_bebidas: number;
  monto_indirectos: number;
  productos_sin_clasificar: number;
  valor_sin_clasificar: number;
}

const NOMBRE_MES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

// Default: el "mes que toca" según día. Si día <= 15 → mes anterior; sino mes actual.
function periodoQueToca(): string {
  const hoy = new Date();
  const baseDate = hoy.getDate() <= 15
    ? new Date(hoy.getFullYear(), hoy.getMonth() - 1, 15)
    : hoy;
  return `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}`;
}

// Lista de últimos 12 periodos (YYYY-MM) más reciente primero.
function ultimos12Periodos(): string[] {
  const out: string[] = [];
  const hoy = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 15);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

function periodoLabel(periodo: string): string {
  const [y, m] = periodo.split('-');
  return `${NOMBRE_MES[parseInt(m, 10) - 1]} ${y}`;
}

export function CierreInventarioModal({
  local,
  periodo: periodoProp,
  mesLabel: mesLabelProp,
  cierrePrevioId,
  onClose,
}: {
  local: 'vedia' | 'saavedra';
  periodo?: string;          // Si viene fijo (desde banner) no muestra selector.
  mesLabel?: string;
  cierrePrevioId?: string;   // Re-cierre de uno rechazado.
  onClose: () => void;
}) {
  const { perfil } = useAuth();
  const qc = useQueryClient();
  const [observaciones, setObservaciones] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  // Selector de periodo (solo si NO viene fijo desde el banner).
  const [periodoElegido, setPeriodoElegido] = useState<string>(
    periodoProp ?? periodoQueToca(),
  );
  const periodo = periodoProp ?? periodoElegido;
  const mesLabel = mesLabelProp ?? periodoLabel(periodo);
  const mostrarSelector = !periodoProp;

  // Si Martín elige un mes que ya tiene cierre, avisamos.
  const { data: cierreExistente } = useQuery({
    queryKey: ['cierre_existente_check', local, periodo],
    queryFn: async () => {
      if (!mostrarSelector) return null;
      const { data } = await supabase
        .from('edr_cierres_inventario')
        .select('estado, aprobado_at, cerrado_por')
        .eq('local', local)
        .eq('periodo', periodo)
        .maybeSingle();
      return data;
    },
    enabled: mostrarSelector,
  });

  // Snapshot en tiempo real del valor de inventario actual.
  // Refresh cada vez que se abre el modal.
  const { data: snap, isLoading } = useQuery({
    queryKey: ['snapshot_inventario', local],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('snapshot_inventario_actual', {
        p_local: local,
      });
      if (error) throw error;
      return (data?.[0] ?? null) as SnapshotResult | null;
    },
  });

  const total =
    Number(snap?.monto_alimentos ?? 0) +
    Number(snap?.monto_bebidas ?? 0) +
    Number(snap?.monto_indirectos ?? 0);

  // Bloqueado si ya hay cierre pendiente o aprobado para ese periodo (solo aplica
  // cuando el selector está activo — desde el banner siempre podés re-cerrar).
  const bloqueadoPorExistente =
    mostrarSelector && cierreExistente && cierreExistente.estado !== 'rechazado';

  async function confirmar() {
    if (!snap || bloqueadoPorExistente) return;
    setGuardando(true);
    setError('');

    // Borrar cierre previo si corresponde (rechazado existente o re-cierre desde banner).
    const idABorrar =
      cierrePrevioId ??
      (mostrarSelector && cierreExistente?.estado === 'rechazado'
        ? await (async () => {
            const { data } = await supabase
              .from('edr_cierres_inventario')
              .select('id')
              .eq('local', local)
              .eq('periodo', periodo)
              .maybeSingle();
            return (data?.id as string | undefined) ?? null;
          })()
        : null);

    if (idABorrar) {
      const { error: errDel } = await supabase
        .from('edr_cierres_inventario')
        .delete()
        .eq('id', idABorrar);
      if (errDel) {
        setError(`Error al eliminar cierre previo: ${errDel.message}`);
        setGuardando(false);
        return;
      }
    }

    const { error: errIns } = await supabase.from('edr_cierres_inventario').insert({
      local,
      periodo,
      monto_alimentos: snap.monto_alimentos,
      monto_bebidas: snap.monto_bebidas,
      monto_indirectos: snap.monto_indirectos,
      productos_sin_clasificar: snap.productos_sin_clasificar,
      estado: 'pendiente',
      cerrado_por: perfil?.nombre ?? null,
      observaciones: observaciones.trim() || null,
    });

    if (errIns) {
      setError(errIns.message);
      setGuardando(false);
      return;
    }

    qc.invalidateQueries({ queryKey: ['edr_cierres_inv_banner', local] });
    qc.invalidateQueries({ queryKey: ['edr_cierre_que_toca', local] });
    qc.invalidateQueries({ queryKey: ['edr_cierres_pendientes'] });
    qc.invalidateQueries({ queryKey: ['cierre_existente_check', local] });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start gap-3">
          <span className="text-3xl">📦</span>
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              Cierre de inventario — {mesLabel} {periodo.split('-')[0]}
            </h3>
            <p className="mt-0.5 text-xs capitalize text-gray-500">{local}</p>
          </div>
        </div>

        {mostrarSelector && (
          <div className="mb-4">
            <label className="mb-1 block text-xs font-medium text-gray-700">
              Mes a cerrar
            </label>
            <select
              value={periodoElegido}
              onChange={(e) => setPeriodoElegido(e.target.value)}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            >
              {ultimos12Periodos().map((p) => (
                <option key={p} value={p}>
                  {periodoLabel(p)}
                </option>
              ))}
            </select>
            {bloqueadoPorExistente && cierreExistente?.estado === 'pendiente' && (
              <p className="mt-1 rounded bg-gray-100 px-2 py-1 text-xs text-gray-700">
                ⏳ Ya hay un cierre <strong>pendiente</strong> de {periodoLabel(periodo)}
                {cierreExistente.cerrado_por && ` (enviado por ${cierreExistente.cerrado_por})`}.
                Esperá la aprobación de Lucas o pedile que lo rechace si necesitás re-cerrar.
              </p>
            )}
            {bloqueadoPorExistente && cierreExistente?.estado === 'aprobado' && (
              <p className="mt-1 rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-800">
                ✅ {periodoLabel(periodo)} ya tiene cierre <strong>aprobado</strong>. Para
                modificarlo, pedile a Lucas que lo rechace primero.
              </p>
            )}
            {!bloqueadoPorExistente && cierreExistente?.estado === 'rechazado' && (
              <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
                ⚠ Hay un cierre <strong>rechazado</strong> de {periodoLabel(periodo)}. Confirmar
                lo reemplaza con uno nuevo (queda pendiente de aprobación).
              </p>
            )}
          </div>
        )}

        {isLoading ? (
          <div className="py-8 text-center text-sm text-gray-400">Calculando snapshot…</div>
        ) : !snap ? (
          <div className="py-8 text-center text-sm text-red-600">
            Error al obtener el snapshot del inventario.
          </div>
        ) : (
          <>
            <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
              Antes de cerrar, asegurate de haber actualizado el stock en el tab "Stock" con el
              conteo físico real. Estos montos quedan congelados como stock final del mes.
            </div>

            <div className="mb-4 space-y-2 rounded-md border border-gray-200 bg-gray-50 p-3">
              <Fila label="Alimentos (materia prima)" monto={snap.monto_alimentos} />
              <Fila label="Bebidas" monto={snap.monto_bebidas} />
              <Fila label="Indirectos" monto={snap.monto_indirectos} />
              <div className="border-t border-gray-300 pt-2">
                <Fila label="TOTAL" monto={total} bold />
              </div>
            </div>

            {snap.productos_sin_clasificar > 0 && (
              <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                ⚠ Hay <strong>{snap.productos_sin_clasificar}</strong> producto
                {snap.productos_sin_clasificar > 1 ? 's' : ''} sin categoría asignada (
                {formatARS(Number(snap.valor_sin_clasificar))} sin contar). Asignales categoría
                en el tab Stock antes de cerrar.
              </div>
            )}

            <div className="mb-4">
              <label className="mb-1 block text-xs font-medium text-gray-700">
                Observaciones (opcional)
              </label>
              <textarea
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                rows={2}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                placeholder="Diferencias detectadas, mermas, anomalías…"
              />
            </div>

            {error && <p className="mb-2 text-xs text-red-600">{error}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={onClose}
                className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={confirmar}
                disabled={guardando || !!bloqueadoPorExistente}
                className="rounded bg-rodziny-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rodziny-700 disabled:opacity-50"
              >
                {guardando ? 'Enviando…' : 'Solicitar cierre (Lucas aprueba)'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Fila({ label, monto, bold }: { label: string; monto: number; bold?: boolean }) {
  return (
    <div className={`flex justify-between text-sm ${bold ? 'font-semibold' : ''}`}>
      <span className="text-gray-700">{label}</span>
      <span className="text-gray-900">{formatARS(monto)}</span>
    </div>
  );
}
