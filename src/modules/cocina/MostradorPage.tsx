import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

type Turno = 'mediodia' | 'noche';

function hoy() {
  return new Date().toISOString().slice(0, 10);
}

// URL: /mostrador?local=vedia  o  /mostrador?local=saavedra
//
// Replica digital de la planilla "CONTROL STOCK PASTAS" que ya usan en Vedia.
// 4 columnas editables por pasta (Inicial, Entrega, Vendido, Real) + Merma
// calculada. Un solo formulario que se carga durante el turno y se guarda al
// cierre. Si ya existe un cierre para ese turno, se pueden editar los datos
// (upsert).
export function MostradorPage() {
  const [params] = useSearchParams();
  const local = (params.get('local') === 'saavedra' ? 'saavedra' : 'vedia') as 'vedia' | 'saavedra';

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="flex items-center justify-between bg-rodziny-800 px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-rodziny-600 text-xs font-bold">
            R
          </div>
          <span className="text-sm font-semibold">Control stock pastas</span>
        </div>
        <span className="text-rodziny-200 text-xs">{local === 'vedia' ? 'Vedia' : 'Saavedra'}</span>
      </div>

      {local === 'saavedra' ? (
        <div className="mx-auto max-w-md space-y-3 p-6 pt-10 text-center">
          <p className="text-5xl">🚧</p>
          <h2 className="text-lg font-semibold text-gray-800">Próximamente</h2>
          <p className="text-sm text-gray-500">
            El control de stock de mostrador todavía no está configurado para Saavedra. Por ahora
            funciona solo para Vedia.
          </p>
        </div>
      ) : (
        <ControlVedia />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────

interface Pasta {
  id: string;
  nombre: string;
  codigo: string;
}

interface Fila {
  inicial: string;
  entrega: string;
  vendido: string;
  real: string;
}

function ControlVedia() {
  const qc = useQueryClient();
  const fecha = hoy();
  const [turno, setTurno] = useState<Turno>('mediodia');
  const [responsable, setResponsable] = useState('');
  const [filas, setFilas] = useState<Record<string, Fila>>({});
  const [mensaje, setMensaje] = useState<string | null>(null);

  // ── Pastas de Vedia (catálogo) ───────────────────────────────────────────
  const { data: pastas, isLoading: loadingPastas } = useQuery({
    queryKey: ['mostrador-pastas-vedia'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_productos')
        .select('id, nombre, codigo')
        .eq('tipo', 'pasta')
        .eq('activo', true)
        .eq('local', 'vedia')
        .order('nombre');
      if (error) throw error;
      return data as Pasta[];
    },
  });

  // ── Cierre previo del mismo turno (para precargar si ya cargaron algo) ───
  const { data: cierrePrevio } = useQuery({
    queryKey: ['mostrador-cierre-previo', 'vedia', fecha, turno],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_conteos_mostrador')
        .select(
          'id, producto_id, cantidad_inicial, entrega_deposito, cantidad_vendida, cantidad_real, responsable',
        )
        .eq('local', 'vedia')
        .eq('fecha', fecha)
        .eq('turno', turno);
      if (error) throw error;
      return data as Array<{
        id: string;
        producto_id: string;
        cantidad_inicial: number;
        entrega_deposito: number;
        cantidad_vendida: number;
        cantidad_real: number;
        responsable: string | null;
      }>;
    },
  });

  // Hidratar filas desde cierre previo (o inicializar vacías)
  useEffect(() => {
    if (!pastas) return;
    const nuevas: Record<string, Fila> = {};
    for (const p of pastas) {
      const previo = cierrePrevio?.find((c) => c.producto_id === p.id);
      nuevas[p.id] = {
        inicial: previo ? String(previo.cantidad_inicial) : '',
        entrega: previo ? String(previo.entrega_deposito) : '',
        vendido: previo ? String(previo.cantidad_vendida) : '',
        real: previo ? String(previo.cantidad_real) : '',
      };
    }
    setFilas(nuevas);
    if (cierrePrevio && cierrePrevio.length > 0 && cierrePrevio[0].responsable) {
      setResponsable(cierrePrevio[0].responsable);
    }
  }, [pastas, cierrePrevio]);

  function setCampo(productoId: string, campo: keyof Fila, valor: string) {
    setFilas((prev) => ({
      ...prev,
      [productoId]: { ...prev[productoId], [campo]: valor },
    }));
  }

  function mermaDe(f: Fila): number | null {
    const ini = Number(f.inicial);
    const ent = Number(f.entrega);
    const vend = Number(f.vendido);
    const real = Number(f.real);
    if (f.real.trim() === '') return null;
    return ini + ent - vend - real;
  }

  const guardar = useMutation({
    mutationFn: async () => {
      if (!responsable.trim()) throw new Error('Cargá tu nombre arriba antes de guardar');
      const conDatos = Object.entries(filas).filter(
        ([, f]) => f.real.trim() !== '' && f.inicial.trim() !== '',
      );
      if (conDatos.length === 0) {
        throw new Error('Cargá al menos una fila con stock inicial y final');
      }

      // Borrar los conteos previos del turno para evitar duplicar mermas
      const prevIds = (cierrePrevio ?? []).map((c) => c.id);
      if (prevIds.length > 0) {
        const { error: errDel } = await supabase
          .from('cocina_conteos_mostrador')
          .delete()
          .in('id', prevIds);
        if (errDel) throw errDel;
      }

      // Insertar los nuevos (el trigger registra merma auto)
      const payload = conDatos.map(([productoId, f]) => ({
        fecha,
        turno,
        local: 'vedia',
        producto_id: productoId,
        cantidad_inicial: Number(f.inicial),
        entrega_deposito: f.entrega.trim() ? Number(f.entrega) : 0,
        cantidad_vendida: f.vendido.trim() ? Number(f.vendido) : 0,
        cantidad_real: Number(f.real),
        responsable: responsable.trim(),
      }));

      const { error } = await supabase.from('cocina_conteos_mostrador').insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      setMensaje('✅ Cierre guardado. Mermas registradas en Cocina.');
      qc.invalidateQueries({ queryKey: ['mostrador-cierre-previo'] });
      setTimeout(() => setMensaje(null), 3000);
    },
    onError: (e) => {
      setMensaje(`❌ ${(e as Error).message}`);
      setTimeout(() => setMensaje(null), 4000);
    },
  });

  if (loadingPastas) {
    return <div className="py-12 text-center text-sm text-gray-400">Cargando…</div>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-3">
      {/* Turno + responsable */}
      <div className="rounded-lg border border-gray-200 bg-white p-3">
        <div className="mb-2">
          <label className="mb-1 block text-xs font-medium text-gray-700">Turno</label>
          <div className="flex gap-2">
            {(['mediodia', 'noche'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTurno(t)}
                className={cn(
                  'flex-1 rounded border px-3 py-2 text-sm font-medium transition',
                  turno === t
                    ? 'border-rodziny-600 bg-rodziny-50 text-rodziny-700'
                    : 'border-gray-300 bg-white text-gray-500',
                )}
              >
                {t === 'mediodia' ? '🌅 Mediodía' : '🌇 Noche'}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Responsable *</label>
          <input
            type="text"
            value={responsable}
            onChange={(e) => setResponsable(e.target.value)}
            placeholder="Tu nombre"
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        {cierrePrevio && cierrePrevio.length > 0 && (
          <p className="mt-2 text-[11px] text-amber-700">
            ⚠️ Ya hay un cierre cargado en este turno. Al guardar se reemplaza.
          </p>
        )}
      </div>

      {/* Tabla de pastas */}
      <div className="overflow-hidden rounded-lg border border-surface-border bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50">
              <tr className="border-b border-gray-200 text-left">
                <th className="sticky left-0 z-10 bg-gray-50 px-2 py-2 text-[10px] font-semibold uppercase text-gray-600">
                  Pasta
                </th>
                <th className="px-1 py-2 text-center text-[10px] font-semibold uppercase text-gray-600">
                  Inicial
                </th>
                <th className="px-1 py-2 text-center text-[10px] font-semibold uppercase text-gray-600">
                  Entrega
                </th>
                <th className="px-1 py-2 text-center text-[10px] font-semibold uppercase text-gray-600">
                  Final
                </th>
                <th className="px-1 py-2 text-center text-[10px] font-semibold uppercase text-gray-600">
                  Ventas
                </th>
                <th className="px-1 py-2 text-center text-[10px] font-semibold uppercase text-gray-600">
                  Merma
                </th>
              </tr>
            </thead>
            <tbody>
              {(pastas ?? []).map((p) => {
                const f = filas[p.id] ?? { inicial: '', entrega: '', vendido: '', real: '' };
                const merma = mermaDe(f);
                return (
                  <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="sticky left-0 z-10 bg-white px-2 py-1.5">
                      <p className="truncate text-[12px] font-medium text-gray-800">{p.nombre}</p>
                    </td>
                    <td className="px-1 py-1.5">
                      <CeldaNum
                        value={f.inicial}
                        onChange={(v) => setCampo(p.id, 'inicial', v)}
                      />
                    </td>
                    <td className="px-1 py-1.5">
                      <CeldaNum
                        value={f.entrega}
                        onChange={(v) => setCampo(p.id, 'entrega', v)}
                      />
                    </td>
                    <td className="px-1 py-1.5">
                      <CeldaNum
                        value={f.real}
                        onChange={(v) => setCampo(p.id, 'real', v)}
                        destacado
                      />
                    </td>
                    <td className="px-1 py-1.5">
                      <CeldaNum
                        value={f.vendido}
                        onChange={(v) => setCampo(p.id, 'vendido', v)}
                      />
                    </td>
                    <td className="px-1 py-1.5 text-center">
                      {merma != null ? (
                        <span
                          className={cn(
                            'inline-block min-w-[36px] rounded px-1.5 py-0.5 text-[12px] font-bold tabular-nums',
                            merma > 0 && 'bg-amber-100 text-amber-800',
                            merma < 0 && 'bg-red-100 text-red-700',
                            merma === 0 && 'bg-green-100 text-green-700',
                          )}
                        >
                          {merma}
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 px-2 text-[10px] text-gray-500">
        <span>
          <span className="inline-block rounded bg-green-100 px-1.5 text-green-700">0</span> cuadra
        </span>
        <span>
          <span className="inline-block rounded bg-amber-100 px-1.5 text-amber-800">+</span> merma
        </span>
        <span>
          <span className="inline-block rounded bg-red-100 px-1.5 text-red-700">−</span> sobró
          (revisar carga)
        </span>
      </div>

      {mensaje && (
        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-center text-sm">
          {mensaje}
        </div>
      )}

      <button
        onClick={() => guardar.mutate()}
        disabled={guardar.isPending}
        className="w-full rounded-lg bg-rodziny-800 py-3 text-base font-semibold text-white hover:bg-rodziny-700 disabled:opacity-50"
      >
        {guardar.isPending ? 'Guardando…' : 'Guardar cierre de turno'}
      </button>
    </div>
  );
}

function CeldaNum({
  value,
  onChange,
  destacado,
}: {
  value: string;
  onChange: (v: string) => void;
  destacado?: boolean;
}) {
  return (
    <input
      type="number"
      inputMode="numeric"
      min="0"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'w-full rounded border px-2 py-1.5 text-center text-sm tabular-nums focus:outline-none',
        destacado
          ? 'border-rodziny-300 bg-rodziny-50 font-semibold focus:border-rodziny-500'
          : 'border-gray-300 focus:border-rodziny-400',
      )}
      placeholder="—"
    />
  );
}
