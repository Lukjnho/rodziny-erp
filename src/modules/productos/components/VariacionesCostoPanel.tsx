import { useState } from 'react';
import { formatARS, cn } from '@/lib/utils';
import { useVariacionesPendientes, type VariacionPendiente } from '../hooks/useVariacionesCosto';

export function VariacionesCostoPanel() {
  const [diasBusqueda, setDiasBusqueda] = useState(30);
  const [umbralBusqueda, setUmbralBusqueda] = useState(5); // %
  const [mensaje, setMensaje] = useState<string | null>(null);
  const { data: pendientes, detectar, aceptar, rechazar, isLoading } =
    useVariacionesPendientes('pendiente');

  function correrDeteccion() {
    setMensaje(null);
    detectar.mutate(
      { dias: diasBusqueda, umbralPct: umbralBusqueda / 100 },
      {
        onSuccess: (rows) => {
          const r = rows?.[0];
          if (r) {
            setMensaje(
              `Detección completa: ${r.detectadas} nuevas variaciones · ${r.ya_existentes} ya estaban en la lista · ${r.sin_variacion} sin cambio relevante`,
            );
          }
        },
        onError: (e: Error) => setMensaje(`Error: ${e.message}`),
      },
    );
  }

  const total = pendientes?.length ?? 0;
  const subes = (pendientes ?? []).filter((p) => p.variacion_pct > 0).length;
  const bajes = (pendientes ?? []).filter((p) => p.variacion_pct < 0).length;

  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50/50 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-amber-900">
            🔔 Variaciones de costo pendientes ({total})
          </h3>
          <p className="mt-0.5 text-[11px] text-amber-800">
            Detecta cambios de precio en las facturas de Compras vs el costo unitario actual del
            insumo. Aceptar = actualiza el costo y queda en histórico. Rechazar = se ignora.
          </p>
          {total > 0 && (
            <p className="mt-1 text-[11px] text-amber-700">
              ↑ {subes} subas · ↓ {bajes} bajas
            </p>
          )}
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="block text-[9px] uppercase text-amber-700">Últimos días</label>
            <input
              type="number"
              value={diasBusqueda}
              onChange={(e) => setDiasBusqueda(parseInt(e.target.value) || 30)}
              className="w-16 rounded border border-amber-300 px-2 py-1 text-xs"
            />
          </div>
          <div>
            <label className="block text-[9px] uppercase text-amber-700">Umbral %</label>
            <input
              type="number"
              step="0.5"
              value={umbralBusqueda}
              onChange={(e) => setUmbralBusqueda(parseFloat(e.target.value) || 5)}
              className="w-16 rounded border border-amber-300 px-2 py-1 text-xs"
            />
          </div>
          <button
            onClick={correrDeteccion}
            disabled={detectar.isPending}
            className="rounded bg-amber-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-800 disabled:opacity-50"
          >
            {detectar.isPending ? 'Buscando…' : 'Detectar'}
          </button>
        </div>
      </div>

      {mensaje && (
        <div className="mb-3 rounded border border-amber-300 bg-white px-3 py-2 text-[11px] text-amber-900">
          {mensaje}
        </div>
      )}

      {isLoading ? (
        <div className="rounded bg-white p-4 text-center text-xs text-gray-400">Cargando…</div>
      ) : total === 0 ? (
        <div className="rounded border border-amber-200 bg-white p-4 text-center text-xs text-gray-500">
          No hay variaciones pendientes. Tocá <strong>Detectar</strong> para escanear gastos recientes.
        </div>
      ) : (
        <div className="overflow-x-auto rounded border border-amber-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-amber-100/50 text-left text-[10px] uppercase tracking-wide text-amber-800">
              <tr>
                <th className="px-3 py-2">Insumo</th>
                <th className="px-3 py-2 text-right">Costo actual</th>
                <th className="px-3 py-2 text-right">Costo nuevo</th>
                <th className="px-3 py-2 text-right">Variación</th>
                <th className="px-3 py-2">Origen</th>
                <th className="px-3 py-2 text-right">Detectada</th>
                <th className="px-3 py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(pendientes ?? []).map((v) => (
                <FilaVariacion
                  key={v.id}
                  v={v}
                  onAceptar={() => aceptar.mutate(v.id)}
                  onRechazar={(comentario) => rechazar.mutate({ id: v.id, comentario })}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function FilaVariacion({
  v,
  onAceptar,
  onRechazar,
}: {
  v: VariacionPendiente;
  onAceptar: () => void;
  onRechazar: (comentario?: string) => void;
}) {
  const [rechazando, setRechazando] = useState(false);
  const [comentario, setComentario] = useState('');

  const esSuba = v.variacion_pct > 0;
  const colorVariacion = esSuba ? 'text-red-700' : 'text-green-700';

  return (
    <tr className="hover:bg-amber-50/30">
      <td className="px-3 py-2">
        <div className="font-medium">{v.producto_nombre}</div>
        <div className="text-[10px] text-gray-400">{v.producto_unidad}</div>
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-gray-600">
        {formatARS(v.costo_actual)}
      </td>
      <td className="px-3 py-2 text-right font-medium tabular-nums">
        {formatARS(v.costo_propuesto)}
      </td>
      <td className={cn('px-3 py-2 text-right font-bold tabular-nums', colorVariacion)}>
        {esSuba ? '↑' : '↓'} {(v.variacion_pct * 100).toFixed(1)}%
      </td>
      <td className="px-3 py-2 text-[11px] text-gray-600">
        {v.gasto_proveedor ?? <span className="italic text-gray-400">—</span>}
        {v.fecha_gasto && (
          <div className="text-[9px] text-gray-400">{new Date(v.fecha_gasto).toLocaleDateString('es-AR')}</div>
        )}
      </td>
      <td className="px-3 py-2 text-right text-[10px] text-gray-400">
        {new Date(v.fecha_deteccion).toLocaleDateString('es-AR')}
      </td>
      <td className="px-3 py-2 text-right">
        {rechazando ? (
          <div className="flex flex-col items-end gap-1">
            <input
              autoFocus
              type="text"
              placeholder="Motivo (opcional)"
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              className="w-40 rounded border border-gray-300 px-2 py-0.5 text-[11px]"
            />
            <div className="flex gap-1">
              <button
                onClick={() => {
                  onRechazar(comentario || undefined);
                  setRechazando(false);
                }}
                className="rounded bg-red-600 px-2 py-0.5 text-[10px] text-white hover:bg-red-700"
              >
                Confirmar
              </button>
              <button
                onClick={() => setRechazando(false)}
                className="text-[10px] text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-1">
            <button
              onClick={onAceptar}
              className="rounded bg-green-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-green-700"
              title="Actualizar el costo del producto"
            >
              ✓ Aceptar
            </button>
            <button
              onClick={() => setRechazando(true)}
              className="rounded border border-gray-300 px-2 py-1 text-[10px] text-gray-700 hover:bg-gray-50"
              title="Ignorar esta variación"
            >
              Rechazar
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
