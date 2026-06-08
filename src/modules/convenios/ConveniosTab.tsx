import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { useConvenios, useEliminarConvenio } from './useConvenios';
import { ConvenioFormModal } from './ConvenioFormModal';
import { ESTADO_LABEL, LOCAL_LABEL, type Convenio, type EstadoConvenio, type LocalConv } from './types';

const ESTADO_STYLE: Record<EstadoConvenio, string> = {
  activo: 'bg-green-100 text-green-700',
  proximo: 'bg-blue-100 text-blue-700',
  negociacion: 'bg-amber-100 text-amber-700',
  vencido: 'bg-gray-200 text-gray-500',
};

export function ConveniosTab() {
  const { data: convenios, isLoading } = useConvenios();
  const eliminar = useEliminarConvenio();
  const [editando, setEditando] = useState<Convenio | null>(null);
  const [creando, setCreando] = useState(false);

  const porLocal = useMemo(() => {
    const grupos: Record<LocalConv, Convenio[]> = { vedia: [], saavedra: [] };
    for (const c of convenios ?? []) grupos[c.local].push(c);
    return grupos;
  }, [convenios]);

  async function onEliminar(c: Convenio) {
    if (!confirm(`¿Eliminar el convenio "${c.nombre}"? Esto no borra nada en Fudo.`)) return;
    await eliminar.mutateAsync(c.id);
  }

  if (isLoading) {
    return <div className="py-8 text-center text-sm text-gray-500">Cargando convenios…</div>;
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-gray-500">
          Cada convenio se vincula a un cliente de Fudo (el que se elige al cobrar). La medición sale
          de ahí.
        </p>
        <button
          onClick={() => setCreando(true)}
          className="rounded-md bg-rodziny-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-rodziny-800"
        >
          + Nuevo convenio
        </button>
      </div>

      {(['vedia', 'saavedra'] as LocalConv[]).map((local) => (
        <div key={local} className="mb-6">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-400">
            {LOCAL_LABEL[local]}
          </h3>
          {porLocal[local].length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-200 px-4 py-3 text-sm text-gray-400">
              Sin convenios en {LOCAL_LABEL[local]}.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {porLocal[local].map((c) => (
                <div
                  key={c.id}
                  className={cn(
                    'rounded-lg border bg-white p-4 transition-shadow hover:shadow-sm',
                    c.activo ? 'border-gray-200' : 'border-gray-200 opacity-60',
                  )}
                >
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-800">{c.nombre}</span>
                      {c.descuento_pct != null && (
                        <span className="rounded-full bg-rodziny-100 px-2 py-0.5 text-xs font-bold text-rodziny-700">
                          {c.descuento_pct}%
                        </span>
                      )}
                    </div>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs font-medium',
                        ESTADO_STYLE[c.estado],
                      )}
                    >
                      {ESTADO_LABEL[c.estado]}
                    </span>
                  </div>

                  <div className="space-y-0.5 text-xs text-gray-500">
                    {c.tipo && <div className="capitalize">{c.tipo}</div>}
                    {c.fudo_customer_id ? (
                      <div>Cliente Fudo #{c.fudo_customer_id}</div>
                    ) : (
                      <div className="text-amber-600">⚠ Sin vincular a Fudo — no se puede medir</div>
                    )}
                    {c.contacto && <div>📞 {c.contacto}</div>}
                    {c.beneficios_extra && (
                      <div className="mt-1 rounded bg-gray-50 px-2 py-1 text-gray-600">
                        🎁 {c.beneficios_extra}
                      </div>
                    )}
                    {(c.vigencia_desde || c.vigencia_hasta) && (
                      <div>
                        Vigencia: {c.vigencia_desde ?? '—'} → {c.vigencia_hasta ?? 'sin fin'}
                      </div>
                    )}
                    {c.notas && <div className="italic">{c.notas}</div>}
                  </div>

                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => setEditando(c)}
                      className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => onEliminar(c)}
                      className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {(creando || editando) && (
        <ConvenioFormModal
          convenio={editando}
          onClose={() => {
            setCreando(false);
            setEditando(null);
          }}
        />
      )}
    </div>
  );
}
