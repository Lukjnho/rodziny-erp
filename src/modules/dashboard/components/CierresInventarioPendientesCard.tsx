import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatARS } from '@/lib/utils';

interface CierrePendiente {
  id: string;
  local: string;
  periodo: string;
  fecha_cierre: string;
  monto_alimentos: number;
  monto_bebidas: number;
  monto_indirectos: number;
  productos_sin_clasificar: number;
  cerrado_por: string | null;
  observaciones: string | null;
}

const NOMBRE_MES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function fechaCorta(iso: string) {
  return new Date(iso).toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function periodoLabel(periodo: string): string {
  const [y, m] = periodo.split('-');
  return `${NOMBRE_MES[parseInt(m, 10) - 1]} ${y}`;
}

export function CierresInventarioPendientesCard() {
  const { perfil } = useAuth();
  const qc = useQueryClient();
  const [confirmar, setConfirmar] = useState<{
    cierre: CierrePendiente;
    accion: 'aprobar' | 'rechazar';
    observacion: string;
  } | null>(null);
  const [guardando, setGuardando] = useState(false);

  const { data: pendientes } = useQuery({
    queryKey: ['edr_cierres_pendientes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('edr_cierres_inventario')
        .select('*')
        .eq('estado', 'pendiente')
        .order('fecha_cierre', { ascending: true });
      if (error) throw error;
      return (data ?? []) as CierrePendiente[];
    },
    refetchInterval: 60_000, // chequear cada minuto si hay nuevos pendientes
  });

  const decidir = useMutation({
    mutationFn: async (args: {
      id: string;
      estado: 'aprobado' | 'rechazado';
      observacion: string;
    }) => {
      const { error } = await supabase
        .from('edr_cierres_inventario')
        .update({
          estado: args.estado,
          aprobado_por: perfil?.nombre ?? null,
          aprobado_at: new Date().toISOString(),
          observacion_aprobacion: args.observacion.trim() || null,
        })
        .eq('id', args.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['edr_cierres_pendientes'] });
      qc.invalidateQueries({ queryKey: ['edr_cierres_inv_banner'] });
      qc.invalidateQueries({ queryKey: ['edr_stock_inventario'] });
      setConfirmar(null);
    },
  });

  // Solo admin (Lucas) ve esta card.
  if (!perfil?.es_admin) return null;
  if (!pendientes || pendientes.length === 0) return null;

  return (
    <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">📋</span>
          <h3 className="text-sm font-semibold text-amber-900">
            Cierres de inventario pendientes de aprobación
          </h3>
        </div>
        <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-bold text-amber-900">
          {pendientes.length}
        </span>
      </div>

      <div className="space-y-3">
        {pendientes.map((c) => {
          const total =
            Number(c.monto_alimentos) + Number(c.monto_bebidas) + Number(c.monto_indirectos);
          return (
            <div
              key={c.id}
              className="rounded-md border border-amber-200 bg-white p-3"
            >
              <div className="mb-2 flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold capitalize text-gray-900">
                    {c.local} — {periodoLabel(c.periodo)}
                  </p>
                  <p className="text-xs text-gray-500">
                    Enviado por <span className="font-medium">{c.cerrado_por ?? 'desconocido'}</span>{' '}
                    · {fechaCorta(c.fecha_cierre)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-base font-bold text-gray-900">{formatARS(total)}</p>
                  <p className="text-[10px] text-gray-500">total inventario</p>
                </div>
              </div>

              <div className="mb-2 grid grid-cols-3 gap-2 text-xs">
                <Mini label="Alimentos" monto={Number(c.monto_alimentos)} />
                <Mini label="Bebidas" monto={Number(c.monto_bebidas)} />
                <Mini label="Indirectos" monto={Number(c.monto_indirectos)} />
              </div>

              {c.productos_sin_clasificar > 0 && (
                <p className="mb-2 rounded border border-orange-200 bg-orange-50 px-2 py-1 text-[11px] text-orange-800">
                  ⚠ {c.productos_sin_clasificar} producto
                  {c.productos_sin_clasificar > 1 ? 's' : ''} sin categoría (no entran al cálculo)
                </p>
              )}

              {c.observaciones && (
                <p className="mb-2 rounded bg-gray-50 px-2 py-1 text-[11px] text-gray-600">
                  💬 {c.observaciones}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={() =>
                    setConfirmar({ cierre: c, accion: 'rechazar', observacion: '' })
                  }
                  className="rounded border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                >
                  Rechazar
                </button>
                <button
                  onClick={() =>
                    setConfirmar({ cierre: c, accion: 'aprobar', observacion: '' })
                  }
                  className="rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700"
                >
                  Aprobar
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {confirmar && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !guardando && setConfirmar(null)}
        >
          <div
            className="w-full max-w-md rounded-lg bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-base font-semibold text-gray-900">
              {confirmar.accion === 'aprobar' ? '✅ Aprobar cierre' : '❌ Rechazar cierre'} —{' '}
              {confirmar.cierre.local} {periodoLabel(confirmar.cierre.periodo)}
            </h3>
            <p className="mb-3 text-xs text-gray-600">
              {confirmar.accion === 'aprobar'
                ? 'Una vez aprobado, este cierre fija el stock final del mes en el EdR. Modificaciones posteriores en gastos del mes mostrarán un aviso.'
                : 'El cierre quedará rechazado. Martín podrá hacer un nuevo cierre con los ajustes.'}
            </p>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              {confirmar.accion === 'aprobar'
                ? 'Comentario (opcional)'
                : 'Motivo del rechazo (recomendado)'}
            </label>
            <textarea
              value={confirmar.observacion}
              onChange={(e) =>
                setConfirmar({ ...confirmar, observacion: e.target.value })
              }
              rows={2}
              className="mb-3 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              placeholder={
                confirmar.accion === 'aprobar'
                  ? '—'
                  : 'Ej: faltan ajustes en bebidas, los $X de alimentos no cuadran con el conteo físico…'
              }
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmar(null)}
                disabled={guardando}
                className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  setGuardando(true);
                  try {
                    await decidir.mutateAsync({
                      id: confirmar.cierre.id,
                      estado: confirmar.accion === 'aprobar' ? 'aprobado' : 'rechazado',
                      observacion: confirmar.observacion,
                    });
                  } finally {
                    setGuardando(false);
                  }
                }}
                disabled={guardando}
                className={
                  confirmar.accion === 'aprobar'
                    ? 'rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50'
                    : 'rounded bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50'
                }
              >
                {guardando
                  ? 'Guardando…'
                  : confirmar.accion === 'aprobar'
                    ? 'Aprobar'
                    : 'Rechazar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Mini({ label, monto }: { label: string; monto: number }) {
  return (
    <div className="rounded bg-gray-50 px-2 py-1">
      <p className="text-[10px] text-gray-500">{label}</p>
      <p className="text-xs font-semibold text-gray-900">{formatARS(monto)}</p>
    </div>
  );
}
