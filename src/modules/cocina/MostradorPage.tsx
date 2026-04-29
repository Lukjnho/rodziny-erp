import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

type Local = 'vedia' | 'saavedra';
type Turno = 'mediodia' | 'noche';
type TipoTab = 'pasta' | 'salsa' | 'postre';

interface Producto {
  id: string;
  nombre: string;
  codigo: string;
}

function hoyAR(): string {
  // Argentina: UTC-3 sin horario de verano. toISOString() devuelve UTC.
  const ahora = new Date();
  const offsetMs = 3 * 60 * 60 * 1000;
  return new Date(ahora.getTime() - offsetMs).toISOString().slice(0, 10);
}

function ayerAR(fecha: string): string {
  const d = new Date(fecha + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

// /mostrador?local=vedia | saavedra
// Cierre obligatorio por turno/fin-de-día. Inserta en cocina_cierre_dia.
export function MostradorPage() {
  const [params] = useSearchParams();
  const local = (params.get('local') === 'saavedra' ? 'saavedra' : 'vedia') as Local;
  const [tab, setTab] = useState<TipoTab>('pasta');

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="flex items-center justify-between bg-rodziny-800 px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-rodziny-600 text-xs font-bold">
            R
          </div>
          <span className="text-sm font-semibold">Cierre de mostrador</span>
        </div>
        <span className="text-rodziny-200 text-xs">{local === 'vedia' ? 'Vedia' : 'Saavedra'}</span>
      </div>

      {local === 'saavedra' ? (
        <div className="mx-auto max-w-md space-y-3 p-6 pt-10 text-center">
          <p className="text-5xl">🚧</p>
          <h2 className="text-lg font-semibold text-gray-800">Próximamente</h2>
          <p className="text-sm text-gray-500">
            El cierre de mostrador todavía no está habilitado para Saavedra. Por ahora solo Vedia.
          </p>
        </div>
      ) : (
        <>
          <div className="flex border-b border-gray-200 bg-white">
            <TabBtn activo={tab === 'pasta'} onClick={() => setTab('pasta')}>
              🍝 Pastas
            </TabBtn>
            <TabBtn activo={tab === 'salsa'} onClick={() => setTab('salsa')}>
              🥫 Salsas
            </TabBtn>
            <TabBtn activo={tab === 'postre'} onClick={() => setTab('postre')}>
              🍰 Postres
            </TabBtn>
          </div>

          {tab === 'pasta' && <CierrePastas local="vedia" />}
          {tab === 'salsa' && <CierreSimple local="vedia" tipo="salsa" unidad="kg" />}
          {tab === 'postre' && <CierreSimple local="vedia" tipo="postre" unidad="unidades" />}
        </>
      )}
    </div>
  );
}

function TabBtn({
  activo,
  onClick,
  children,
}: {
  activo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-1 py-3 text-sm font-medium transition',
        activo
          ? 'border-b-2 border-rodziny-600 text-rodziny-700'
          : 'text-gray-500 hover:text-gray-700',
      )}
    >
      {children}
    </button>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Cierre de pastas — con turno (mediodia/noche) y 4 columnas
// ════════════════════════════════════════════════════════════════════════════

interface FilaPasta {
  inicial: string;
  entrega: string;
  vendido: string;
  real: string;
}

function CierrePastas({ local }: { local: Local }) {
  const qc = useQueryClient();
  const fecha = hoyAR();
  const [turno, setTurno] = useState<Turno>('mediodia');
  const [responsable, setResponsable] = useState('');
  const [filas, setFilas] = useState<Record<string, FilaPasta>>({});
  const [mensaje, setMensaje] = useState<string | null>(null);

  const { data: pastas, isLoading: loadingPastas } = useQuery({
    queryKey: ['mostrador-pastas', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_productos')
        .select('id, nombre, codigo')
        .eq('tipo', 'pasta')
        .eq('activo', true)
        .eq('local', local)
        .order('nombre');
      if (error) throw error;
      return data as Producto[];
    },
  });

  // Traspasos del día (Entrega = lo que vino del depósito)
  const { data: traspasosHoy } = useQuery({
    queryKey: ['mostrador-traspasos', local, fecha],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_traspasos')
        .select('producto_id, porciones')
        .eq('local', local)
        .eq('fecha', fecha);
      if (error) throw error;
      return data as Array<{ producto_id: string; porciones: number }>;
    },
    refetchInterval: 60_000,
  });

  // Cierre actual del turno (si ya cargaron y vuelven a editar)
  const { data: cierreActual } = useQuery({
    queryKey: ['mostrador-cierre-actual', local, fecha, turno],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_cierre_dia')
        .select('*')
        .eq('local', local)
        .eq('fecha', fecha)
        .eq('tipo', 'pasta')
        .eq('turno', turno);
      if (error) throw error;
      return data as Array<{
        id: string;
        producto_id: string;
        cantidad_real: number;
        inicial: number | null;
        entrega: number | null;
        vendido: number | null;
        responsable: string | null;
      }>;
    },
  });

  // Cierre del turno anterior (para autocompletar Inicial)
  // Si turno=noche → busca cierre del mismo día turno=mediodia
  // Si turno=mediodia → busca cierre del día anterior turno=noche
  const fechaInicial = turno === 'noche' ? fecha : ayerAR(fecha);
  const turnoInicial: Turno = turno === 'noche' ? 'mediodia' : 'noche';
  const { data: cierreInicial } = useQuery({
    queryKey: ['mostrador-cierre-inicial', local, fechaInicial, turnoInicial],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_cierre_dia')
        .select('producto_id, cantidad_real')
        .eq('local', local)
        .eq('fecha', fechaInicial)
        .eq('tipo', 'pasta')
        .eq('turno', turnoInicial);
      if (error) throw error;
      return data as Array<{ producto_id: string; cantidad_real: number }>;
    },
  });

  // Hidratar filas (autocompletar inicial + entrega; pisar con cierre actual si existe)
  useEffect(() => {
    if (!pastas) return;
    const nuevas: Record<string, FilaPasta> = {};
    for (const p of pastas) {
      const previo = cierreActual?.find((c) => c.producto_id === p.id);
      if (previo) {
        nuevas[p.id] = {
          inicial: previo.inicial != null ? String(previo.inicial) : '',
          entrega: previo.entrega != null ? String(previo.entrega) : '',
          vendido: previo.vendido != null ? String(previo.vendido) : '',
          real: String(previo.cantidad_real),
        };
        continue;
      }
      const inicial = cierreInicial?.find((c) => c.producto_id === p.id);
      const entrega = (traspasosHoy ?? [])
        .filter((t) => t.producto_id === p.id)
        .reduce((s, t) => s + (t.porciones ?? 0), 0);
      nuevas[p.id] = {
        inicial: inicial ? String(inicial.cantidad_real) : '',
        entrega: entrega > 0 ? String(entrega) : '',
        vendido: '',
        real: '',
      };
    }
    setFilas(nuevas);
    if (cierreActual && cierreActual.length > 0 && cierreActual[0].responsable) {
      setResponsable(cierreActual[0].responsable);
    }
  }, [pastas, cierreActual, cierreInicial, traspasosHoy]);

  function setCampo(pid: string, campo: keyof FilaPasta, valor: string) {
    setFilas((prev) => ({
      ...prev,
      [pid]: { ...prev[pid], [campo]: valor },
    }));
  }

  function mermaDe(f: FilaPasta): number | null {
    if (f.real.trim() === '') return null;
    const ini = Number(f.inicial) || 0;
    const ent = Number(f.entrega) || 0;
    const vend = Number(f.vendido) || 0;
    const real = Number(f.real) || 0;
    return ini + ent - vend - real;
  }

  const guardar = useMutation({
    mutationFn: async () => {
      if (!responsable.trim()) throw new Error('Cargá tu nombre antes de guardar');
      const conDatos = Object.entries(filas).filter(([, f]) => f.real.trim() !== '');
      if (conDatos.length === 0) throw new Error('Cargá al menos un producto con stock real');

      // Borrar el cierre previo del turno (upsert manual para evitar duplicados)
      const prevIds = (cierreActual ?? []).map((c) => c.id);
      if (prevIds.length > 0) {
        const { error: errDel } = await supabase
          .from('cocina_cierre_dia')
          .delete()
          .in('id', prevIds);
        if (errDel) throw errDel;
      }

      const payload = conDatos.map(([productoId, f]) => ({
        fecha,
        local,
        producto_id: productoId,
        tipo: 'pasta' as const,
        turno,
        cantidad_real: Number(f.real),
        unidad: 'porciones' as const,
        inicial: f.inicial.trim() ? Number(f.inicial) : null,
        entrega: f.entrega.trim() ? Number(f.entrega) : null,
        vendido: f.vendido.trim() ? Number(f.vendido) : null,
        responsable: responsable.trim(),
      }));

      const { error } = await supabase.from('cocina_cierre_dia').insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      setMensaje('✅ Cierre guardado.');
      qc.invalidateQueries({ queryKey: ['mostrador-cierre-actual'] });
      qc.invalidateQueries({ queryKey: ['cocina-cierre-dia'] });
      qc.invalidateQueries({ queryKey: ['cocina-cierre-faltantes'] });
      setTimeout(() => setMensaje(null), 2500);
    },
    onError: (e) => {
      setMensaje(`❌ ${(e as Error).message}`);
      setTimeout(() => setMensaje(null), 4000);
    },
  });

  // Mostrar TODAS las pastas activas del local. El cierre se controla sobre todas
  // (puede haber stock previo aunque no haya traslado del día). Las que tienen
  // movimiento (entrega del día o inicial > 0) se ordenan primero.
  const visibles = useMemo(() => {
    if (!pastas) return [];
    const conMovimiento = new Set<string>();
    (traspasosHoy ?? []).forEach((t) => conMovimiento.add(t.producto_id));
    (cierreActual ?? []).forEach((c) => conMovimiento.add(c.producto_id));
    (cierreInicial ?? [])
      .filter((c) => c.cantidad_real > 0)
      .forEach((c) => conMovimiento.add(c.producto_id));
    return [...pastas].sort((a, b) => {
      const am = conMovimiento.has(a.id) ? 0 : 1;
      const bm = conMovimiento.has(b.id) ? 0 : 1;
      if (am !== bm) return am - bm;
      return a.nombre.localeCompare(b.nombre);
    });
  }, [pastas, traspasosHoy, cierreActual, cierreInicial]);

  if (loadingPastas) {
    return <div className="py-12 text-center text-sm text-gray-400">Cargando…</div>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-3">
      <div className="rounded-lg border border-gray-200 bg-white p-3">
        <label className="mb-1 block text-xs font-medium text-gray-700">Turno</label>
        <div className="mb-3 flex gap-2">
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
        <label className="mb-1 block text-xs font-medium text-gray-700">Responsable *</label>
        <input
          type="text"
          value={responsable}
          onChange={(e) => setResponsable(e.target.value)}
          placeholder="Tu nombre"
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
        />
        {cierreActual && cierreActual.length > 0 && (
          <p className="mt-2 text-[11px] text-amber-700">
            ⚠️ Ya hay un cierre cargado en este turno. Al guardar se reemplaza.
          </p>
        )}
      </div>

      {visibles.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center">
          <p className="text-2xl">📦</p>
          <p className="mt-2 text-sm font-medium text-gray-700">
            No hay pastas cargadas
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Cargalas en Cocina → Productos con tipo "pasta" para que aparezcan acá.
          </p>
        </div>
      ) : (
        <>
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
                      Vendido
                    </th>
                    <th className="px-1 py-2 text-center text-[10px] font-semibold uppercase text-rodziny-700">
                      Real *
                    </th>
                    <th className="px-1 py-2 text-center text-[10px] font-semibold uppercase text-gray-600">
                      Merma
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((p) => {
                    const f = filas[p.id] ?? { inicial: '', entrega: '', vendido: '', real: '' };
                    const merma = mermaDe(f);
                    return (
                      <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="sticky left-0 z-10 bg-white px-2 py-1.5">
                          <p className="truncate text-[12px] font-medium text-gray-800">
                            {p.nombre}
                          </p>
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
                            value={f.vendido}
                            onChange={(v) => setCampo(p.id, 'vendido', v)}
                          />
                        </td>
                        <td className="px-1 py-1.5">
                          <CeldaNum
                            value={f.real}
                            onChange={(v) => setCampo(p.id, 'real', v)}
                            destacado
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

          <div className="flex flex-wrap gap-3 px-2 text-[10px] text-gray-500">
            <span>
              Inicial = stock al inicio del turno (auto del cierre anterior). Entrega = traspasos
              del depósito (auto). Vendido = lo que cobraron en mostrador. Real = lo que queda
              físico.
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
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Cierre simple — Salsas (kg) y Postres (unidades). Sin turno (fin de día).
// ════════════════════════════════════════════════════════════════════════════

function CierreSimple({
  local,
  tipo,
  unidad,
}: {
  local: Local;
  tipo: 'salsa' | 'postre';
  unidad: 'kg' | 'unidades';
}) {
  const qc = useQueryClient();
  const fecha = hoyAR();
  const [responsable, setResponsable] = useState('');
  const [valores, setValores] = useState<Record<string, string>>({});
  const [notas, setNotas] = useState<Record<string, string>>({});
  const [mensaje, setMensaje] = useState<string | null>(null);

  const { data: productos, isLoading } = useQuery({
    queryKey: ['mostrador-simple-productos', local, tipo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_productos')
        .select('id, nombre, codigo')
        .eq('tipo', tipo)
        .eq('activo', true)
        .eq('local', local)
        .order('nombre');
      if (error) throw error;
      return data as Producto[];
    },
  });

  const { data: cierreActual } = useQuery({
    queryKey: ['mostrador-simple-cierre', local, fecha, tipo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_cierre_dia')
        .select('id, producto_id, cantidad_real, notas, responsable')
        .eq('local', local)
        .eq('fecha', fecha)
        .eq('tipo', tipo)
        .is('turno', null);
      if (error) throw error;
      return data as Array<{
        id: string;
        producto_id: string;
        cantidad_real: number;
        notas: string | null;
        responsable: string | null;
      }>;
    },
  });

  useEffect(() => {
    if (!productos) return;
    const v: Record<string, string> = {};
    const n: Record<string, string> = {};
    for (const p of productos) {
      const previo = cierreActual?.find((c) => c.producto_id === p.id);
      v[p.id] = previo ? String(previo.cantidad_real) : '';
      n[p.id] = previo?.notas ?? '';
    }
    setValores(v);
    setNotas(n);
    if (cierreActual && cierreActual.length > 0 && cierreActual[0].responsable) {
      setResponsable(cierreActual[0].responsable);
    }
  }, [productos, cierreActual]);

  const guardar = useMutation({
    mutationFn: async () => {
      if (!responsable.trim()) throw new Error('Cargá tu nombre antes de guardar');
      const conDatos = Object.entries(valores).filter(([, v]) => v.trim() !== '');
      if (conDatos.length === 0) throw new Error('Cargá al menos un producto');

      const prevIds = (cierreActual ?? []).map((c) => c.id);
      if (prevIds.length > 0) {
        const { error: errDel } = await supabase
          .from('cocina_cierre_dia')
          .delete()
          .in('id', prevIds);
        if (errDel) throw errDel;
      }

      const payload = conDatos.map(([productoId, valor]) => ({
        fecha,
        local,
        producto_id: productoId,
        tipo,
        turno: null as null,
        cantidad_real: Number(valor.replace(',', '.')),
        unidad,
        responsable: responsable.trim(),
        notas: notas[productoId]?.trim() || null,
      }));

      const { error } = await supabase.from('cocina_cierre_dia').insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      setMensaje('✅ Cierre guardado.');
      qc.invalidateQueries({ queryKey: ['mostrador-simple-cierre'] });
      qc.invalidateQueries({ queryKey: ['cocina-cierre-dia'] });
      qc.invalidateQueries({ queryKey: ['cocina-cierre-faltantes'] });
      setTimeout(() => setMensaje(null), 2500);
    },
    onError: (e) => {
      setMensaje(`❌ ${(e as Error).message}`);
      setTimeout(() => setMensaje(null), 4000);
    },
  });

  if (isLoading) {
    return <div className="py-12 text-center text-sm text-gray-400">Cargando…</div>;
  }

  if (!productos || productos.length === 0) {
    return (
      <div className="mx-auto max-w-md p-3">
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center">
          <p className="text-2xl">{tipo === 'salsa' ? '🥫' : '🍰'}</p>
          <p className="mt-2 text-sm font-medium text-gray-700">
            No hay {tipo === 'salsa' ? 'salsas' : 'postres'} cargados
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Cargalos primero desde el ERP en Cocina → Productos → "Nuevo producto" con tipo "
            {tipo}".
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-3">
      <div className="rounded-lg border border-gray-200 bg-white p-3">
        <label className="mb-1 block text-xs font-medium text-gray-700">Responsable *</label>
        <input
          type="text"
          value={responsable}
          onChange={(e) => setResponsable(e.target.value)}
          placeholder="Tu nombre"
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
        />
        {cierreActual && cierreActual.length > 0 && (
          <p className="mt-2 text-[11px] text-amber-700">
            ⚠️ Ya hay un cierre cargado para hoy. Al guardar se reemplaza.
          </p>
        )}
        <p className="mt-2 text-[11px] text-gray-500">
          Cierre fin de día: lo que pesaste / contaste físico al cerrar el local.
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white">
        {productos.map((p, idx) => (
          <div
            key={p.id}
            className={cn('p-3', idx < productos.length - 1 && 'border-b border-gray-100')}
          >
            <p className="text-sm font-medium text-gray-800">{p.nombre}</p>
            <div className="mt-2 flex items-center gap-2">
              <input
                type={unidad === 'kg' ? 'text' : 'number'}
                inputMode={unidad === 'kg' ? 'decimal' : 'numeric'}
                pattern={unidad === 'kg' ? '[0-9]*[.,]?[0-9]*' : undefined}
                value={valores[p.id] ?? ''}
                onChange={(e) => setValores((prev) => ({ ...prev, [p.id]: e.target.value }))}
                placeholder={unidad === 'kg' ? '1,5' : '8'}
                className="flex-1 rounded border-2 border-gray-300 px-3 py-2 text-base font-semibold tabular-nums focus:border-rodziny-500 focus:outline-none"
              />
              <span className="text-sm font-medium text-gray-500">
                {unidad === 'kg' ? 'kg' : 'u'}
              </span>
            </div>
            <input
              type="text"
              value={notas[p.id] ?? ''}
              onChange={(e) => setNotas((prev) => ({ ...prev, [p.id]: e.target.value }))}
              placeholder="Notas (opcional)"
              className="mt-2 w-full rounded border border-gray-200 px-3 py-1.5 text-xs"
            />
          </div>
        ))}
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
        {guardar.isPending
          ? 'Guardando…'
          : `Guardar cierre de ${tipo === 'salsa' ? 'salsas' : 'postres'}`}
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
