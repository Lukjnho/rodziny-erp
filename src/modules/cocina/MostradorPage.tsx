import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

type Tab = 'stock' | 'cierre';
type Turno = 'mediodia' | 'noche' | 'unico';
type TipoProducto = 'pasta' | 'salsa' | 'postre' | 'pasteleria' | 'panaderia';

const TIPO_LABEL: Record<TipoProducto, string> = {
  pasta: 'Pastas',
  salsa: 'Salsas',
  postre: 'Postres',
  pasteleria: 'Pastelería',
  panaderia: 'Panadería',
};

const TIPO_EMOJI: Record<TipoProducto, string> = {
  pasta: '🍝',
  salsa: '🍅',
  postre: '🍰',
  pasteleria: '🥐',
  panaderia: '🍞',
};

function hoy() {
  return new Date().toISOString().slice(0, 10);
}

// URL: /mostrador?local=vedia  o  /mostrador?local=saavedra
// PWA pública pegada arriba del freezer del mostrador. Dos tabs:
//   - Stock ahora: qué hay en el freezer según el sistema (producido/trasladado hoy - merma)
//   - Cierre de servicio: conteo físico al cierre de turno, genera merma automática.
export function MostradorPage() {
  const [params] = useSearchParams();
  const local = (params.get('local') === 'saavedra' ? 'saavedra' : 'vedia') as 'vedia' | 'saavedra';
  const [tab, setTab] = useState<Tab>('stock');

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="flex items-center justify-between bg-rodziny-800 px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-rodziny-600 text-xs font-bold">
            R
          </div>
          <span className="text-sm font-semibold">Mostrador</span>
        </div>
        <span className="text-rodziny-200 text-xs">{local === 'vedia' ? 'Vedia' : 'Saavedra'}</span>
      </div>

      <div className="flex border-b border-gray-200 bg-white">
        <button
          onClick={() => setTab('stock')}
          className={cn(
            'flex-1 py-3 text-sm font-medium transition',
            tab === 'stock'
              ? 'border-b-2 border-rodziny-600 text-rodziny-700'
              : 'text-gray-500 hover:text-gray-700',
          )}
        >
          📊 Stock ahora
        </button>
        <button
          onClick={() => setTab('cierre')}
          className={cn(
            'flex-1 py-3 text-sm font-medium transition',
            tab === 'cierre'
              ? 'border-b-2 border-rodziny-600 text-rodziny-700'
              : 'text-gray-500 hover:text-gray-700',
          )}
        >
          ✍️ Cierre de servicio
        </button>
      </div>

      {tab === 'stock' ? <StockAhora local={local} /> : <CierreServicio local={local} />}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Hook compartido: stock por producto del día
// ──────────────────────────────────────────────────────────────────────────────

interface ProductoStock {
  id: string;
  nombre: string;
  codigo: string;
  tipo: TipoProducto;
  recetaId: string | null;
  inicial: number; // traslados hoy (pastas) | producción hoy (resto)
  mermaPrevia: number; // mermas registradas hoy
  disponible: number; // inicial - mermaPrevia
}

function useStockDia(local: 'vedia' | 'saavedra') {
  const fecha = hoy();

  const productosQ = useQuery({
    queryKey: ['mostrador-productos', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_productos')
        .select('id, nombre, codigo, tipo, receta_id, local')
        .eq('activo', true)
        .eq('local', local)
        .in('tipo', ['pasta', 'salsa', 'postre', 'pasteleria', 'panaderia'])
        .order('tipo')
        .order('nombre');
      if (error) throw error;
      return data as Array<{
        id: string;
        nombre: string;
        codigo: string;
        tipo: TipoProducto;
        receta_id: string | null;
      }>;
    },
    refetchInterval: 60_000,
  });

  const traspasosQ = useQuery({
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

  const produccionQ = useQuery({
    queryKey: ['mostrador-produccion', local, fecha],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_produccion')
        .select('receta_id, cantidad_producida, categoria')
        .eq('local', local)
        .eq('fecha', fecha);
      if (error) throw error;
      return data as Array<{
        receta_id: string | null;
        cantidad_producida: number;
        categoria: string;
      }>;
    },
    refetchInterval: 60_000,
  });

  const mermasQ = useQuery({
    queryKey: ['mostrador-mermas', local, fecha],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_merma')
        .select('producto_id, porciones')
        .eq('local', local)
        .eq('fecha', fecha);
      if (error) throw error;
      return data as Array<{ producto_id: string; porciones: number }>;
    },
    refetchInterval: 60_000,
  });

  const rows = useMemo<ProductoStock[]>(() => {
    const productos = productosQ.data ?? [];
    const traspasos = traspasosQ.data ?? [];
    const produccion = produccionQ.data ?? [];
    const mermas = mermasQ.data ?? [];

    return productos.map((p) => {
      let inicial = 0;
      if (p.tipo === 'pasta') {
        inicial = traspasos
          .filter((t) => t.producto_id === p.id)
          .reduce((s, t) => s + t.porciones, 0);
      } else if (p.receta_id) {
        inicial = produccion
          .filter((l) => l.receta_id === p.receta_id)
          .reduce((s, l) => s + Number(l.cantidad_producida ?? 0), 0);
      }
      const mermaPrevia = mermas
        .filter((m) => m.producto_id === p.id)
        .reduce((s, m) => s + Number(m.porciones ?? 0), 0);
      return {
        id: p.id,
        nombre: p.nombre,
        codigo: p.codigo,
        tipo: p.tipo,
        recetaId: p.receta_id,
        inicial,
        mermaPrevia,
        disponible: inicial - mermaPrevia,
      };
    });
  }, [productosQ.data, traspasosQ.data, produccionQ.data, mermasQ.data]);

  return {
    rows,
    isLoading:
      productosQ.isLoading || traspasosQ.isLoading || produccionQ.isLoading || mermasQ.isLoading,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Tab 1 — Stock ahora (solo lectura, refresca cada 60s)
// ──────────────────────────────────────────────────────────────────────────────

function StockAhora({ local }: { local: 'vedia' | 'saavedra' }) {
  const { rows, isLoading } = useStockDia(local);

  const porTipo = useMemo(() => {
    const map = new Map<TipoProducto, ProductoStock[]>();
    for (const r of rows) {
      if (r.inicial === 0 && r.mermaPrevia === 0) continue; // no mostrar productos sin movimiento hoy
      const arr = map.get(r.tipo) ?? [];
      arr.push(r);
      map.set(r.tipo, arr);
    }
    return map;
  }, [rows]);

  if (isLoading) {
    return <div className="py-12 text-center text-sm text-gray-400">Cargando…</div>;
  }

  if (porTipo.size === 0) {
    return (
      <div className="mx-auto max-w-md px-4 py-8 text-center">
        <p className="text-sm text-gray-500">Todavía no hay producción ni traslados de hoy.</p>
        <p className="mt-2 text-xs text-gray-400">Se actualiza cada 1 min automáticamente.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-3 p-4">
      <p className="text-center text-[11px] text-gray-400">
        Actualizado cada 1 min · {new Date().toLocaleTimeString('es-AR').slice(0, 5)}
      </p>
      {Array.from(porTipo.entries()).map(([tipo, items]) => {
        const totalDisp = items.reduce((s, i) => s + i.disponible, 0);
        return (
          <section
            key={tipo}
            className="overflow-hidden rounded-lg border border-surface-border bg-white"
          >
            <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-3 py-2">
              <span className="text-sm font-semibold text-gray-800">
                {TIPO_EMOJI[tipo]} {TIPO_LABEL[tipo]}
              </span>
              <span className="text-xs text-gray-500">{totalDisp} disp.</span>
            </div>
            <ul className="divide-y divide-gray-100">
              {items.map((r) => (
                <li key={r.id} className="flex items-center justify-between px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{r.nombre}</p>
                    <p className="text-[10px] text-gray-400">
                      Recibido hoy: {r.inicial}
                      {r.mermaPrevia > 0 && ` · Merma: ${r.mermaPrevia}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className={cn(
                        'text-lg font-bold tabular-nums',
                        r.disponible > 0 ? 'text-gray-900' : 'text-red-500',
                      )}
                    >
                      {r.disponible}
                    </p>
                    <p className="text-[10px] text-gray-400">disp.</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <p className="pt-2 text-center text-[11px] italic text-gray-400">
        Este es el estimado del sistema. Al cierre de turno contá físicamente y cargalo en el otro
        tab.
      </p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Tab 2 — Cierre de servicio (conteo físico + merma automática)
// ──────────────────────────────────────────────────────────────────────────────

interface CierreFila {
  productoId: string;
  vendido: string;
  real: string;
}

function CierreServicio({ local }: { local: 'vedia' | 'saavedra' }) {
  const qc = useQueryClient();
  const fecha = hoy();
  const [turno, setTurno] = useState<Turno>(local === 'vedia' ? 'mediodia' : 'unico');
  const [responsable, setResponsable] = useState('');
  const [filas, setFilas] = useState<Record<string, CierreFila>>({});
  const [exito, setExito] = useState(false);

  const { rows, isLoading } = useStockDia(local);

  // Ya existe un cierre para este turno hoy?
  const yaHechoQ = useQuery({
    queryKey: ['mostrador-cierre-existente', local, fecha, turno],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_conteos_mostrador')
        .select('id, producto_id')
        .eq('local', local)
        .eq('fecha', fecha)
        .eq('turno', turno);
      if (error) throw error;
      return data;
    },
  });

  const yaContados = useMemo(
    () => new Set((yaHechoQ.data ?? []).map((r) => (r as { producto_id: string }).producto_id)),
    [yaHechoQ.data],
  );

  function setFila(productoId: string, patch: Partial<CierreFila>) {
    setFilas((prev) => ({
      ...prev,
      [productoId]: {
        productoId,
        vendido: prev[productoId]?.vendido ?? '',
        real: prev[productoId]?.real ?? '',
        ...patch,
      },
    }));
  }

  const porTipo = useMemo(() => {
    const map = new Map<TipoProducto, ProductoStock[]>();
    for (const r of rows) {
      if (r.inicial === 0 && r.mermaPrevia === 0) continue;
      if (yaContados.has(r.id)) continue; // ya se cerró este producto en este turno
      const arr = map.get(r.tipo) ?? [];
      arr.push(r);
      map.set(r.tipo, arr);
    }
    return map;
  }, [rows, yaContados]);

  const guardar = useMutation({
    mutationFn: async () => {
      if (!responsable.trim()) throw new Error('Cargá tu nombre antes de guardar');
      const payload = Object.values(filas)
        .filter((f) => f.real.trim() !== '')
        .map((f) => {
          const producto = rows.find((r) => r.id === f.productoId);
          if (!producto) throw new Error('Producto no encontrado');
          const vendido = f.vendido ? parseInt(f.vendido, 10) : 0;
          const real = parseInt(f.real, 10);
          if (isNaN(real) || real < 0) throw new Error('Cantidad real inválida');
          if (isNaN(vendido) || vendido < 0) throw new Error('Vendido inválido');
          return {
            fecha,
            turno,
            local,
            producto_id: producto.id,
            cantidad_inicial: producto.disponible,
            cantidad_vendida: vendido,
            cantidad_real: real,
            responsable: responsable.trim(),
          };
        });

      if (payload.length === 0) throw new Error('Cargá al menos un conteo');

      const { error } = await supabase.from('cocina_conteos_mostrador').insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      setExito(true);
      qc.invalidateQueries({ queryKey: ['mostrador-cierre-existente'] });
      qc.invalidateQueries({ queryKey: ['mostrador-mermas'] });
      setTimeout(() => {
        setExito(false);
        setFilas({});
      }, 2000);
    },
  });

  if (isLoading) {
    return <div className="py-12 text-center text-sm text-gray-400">Cargando…</div>;
  }

  return (
    <div className="mx-auto max-w-md space-y-3 p-4">
      {/* Turno + responsable */}
      <div className="rounded-lg border border-gray-200 bg-white p-3">
        <div className="mb-2">
          <label className="mb-1 block text-xs font-medium text-gray-700">Turno</label>
          <div className="flex gap-2">
            {(local === 'vedia'
              ? (['mediodia', 'noche'] as const)
              : (['mediodia', 'noche', 'unico'] as const)
            ).map((t) => (
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
                {t === 'mediodia' ? '🌅 Mediodía' : t === 'noche' ? '🌇 Noche' : '🕐 Único'}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Tu nombre *</label>
          <input
            type="text"
            value={responsable}
            onChange={(e) => setResponsable(e.target.value)}
            placeholder="Ej: Martín"
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      {exito && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-3 text-center text-sm font-semibold text-green-800">
          ✅ Cierre registrado. Las mermas se guardaron automáticamente.
        </div>
      )}

      {porTipo.size === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-center">
          <p className="text-sm text-gray-500">
            {yaContados.size > 0
              ? `Ya cerraste los ${yaContados.size} productos con stock en este turno.`
              : 'No hay productos con stock para contar.'}
          </p>
        </div>
      ) : (
        Array.from(porTipo.entries()).map(([tipo, items]) => (
          <section
            key={tipo}
            className="overflow-hidden rounded-lg border border-surface-border bg-white"
          >
            <div className="border-b border-gray-100 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-800">
              {TIPO_EMOJI[tipo]} {TIPO_LABEL[tipo]}
            </div>
            <ul className="divide-y divide-gray-100">
              {items.map((r) => {
                const f = filas[r.id];
                const vendido = f?.vendido ? parseInt(f.vendido, 10) : 0;
                const real = f?.real ? parseInt(f.real, 10) : null;
                const mermaCalc = real != null ? r.disponible - vendido - real : null;

                return (
                  <li key={r.id} className="space-y-2 px-3 py-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-gray-900">{r.nombre}</p>
                      <span className="rounded bg-rodziny-50 px-2 py-0.5 text-[11px] font-semibold text-rodziny-700">
                        Disp: {r.disponible}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="mb-0.5 block text-[10px] text-gray-500">
                          Vendido (Fudo)
                        </label>
                        <input
                          type="number"
                          inputMode="numeric"
                          min="0"
                          value={f?.vendido ?? ''}
                          onChange={(e) => setFila(r.id, { vendido: e.target.value })}
                          placeholder="0"
                          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                        />
                      </div>
                      <div>
                        <label className="mb-0.5 block text-[10px] text-gray-500">
                          Real (conteo físico)
                        </label>
                        <input
                          type="number"
                          inputMode="numeric"
                          min="0"
                          value={f?.real ?? ''}
                          onChange={(e) => setFila(r.id, { real: e.target.value })}
                          placeholder="0"
                          className="w-full rounded border-2 border-gray-300 px-2 py-1.5 text-sm font-semibold focus:border-rodziny-500"
                        />
                      </div>
                    </div>
                    {mermaCalc != null && (
                      <p
                        className={cn(
                          'text-[11px]',
                          mermaCalc > 0
                            ? 'font-semibold text-amber-700'
                            : mermaCalc < 0
                            ? 'font-semibold text-red-600'
                            : 'text-green-600',
                        )}
                      >
                        {mermaCalc > 0
                          ? `⚠️ Merma: ${mermaCalc}`
                          : mermaCalc < 0
                          ? `❌ Sobra ${Math.abs(mermaCalc)} — revisar carga`
                          : '✓ Cuadra perfecto'}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      {porTipo.size > 0 && (
        <button
          onClick={() => guardar.mutate()}
          disabled={guardar.isPending}
          className="w-full rounded-lg bg-rodziny-800 py-3 text-base font-semibold text-white hover:bg-rodziny-700 disabled:opacity-50"
        >
          {guardar.isPending ? 'Guardando…' : 'Guardar cierre de turno'}
        </button>
      )}

      {guardar.isError && (
        <p className="text-center text-sm text-red-600">
          {(guardar.error as Error).message}
        </p>
      )}

      <p className="pt-2 text-center text-[11px] italic text-gray-400">
        Las mermas se registran automáticamente en Cocina cuando hay diferencias.
      </p>
    </div>
  );
}
