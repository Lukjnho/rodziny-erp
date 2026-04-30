import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

type Local = 'vedia' | 'saavedra';
type Tipo = 'pasta' | 'salsa' | 'postre';
type Turno = 'mediodia' | 'noche';

interface CierreRow {
  id: string;
  fecha: string;
  local: Local;
  producto_id: string | null;
  receta_id: string | null;
  tipo: Tipo;
  turno: Turno | null;
  cantidad_real: number;
  unidad: 'porciones' | 'kg' | 'unidades';
  inicial: number | null;
  entrega: number | null;
  vendido: number | null;
  responsable: string | null;
  notas: string | null;
  created_at: string;
}

interface ProductoMin {
  id: string;
  nombre: string;
  codigo: string;
  tipo: Tipo;
}

interface RecetaMin {
  id: string;
  nombre: string;
  tipo: string;
}

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function diaAnterior(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}
function diaSiguiente(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function CierresTab() {
  const [local, setLocal] = useState<Local>('vedia');
  const [fecha, setFecha] = useState<string>(hoyISO());

  if (local === 'saavedra') {
    return (
      <div className="space-y-4">
        <CabeceraLocal local={local} setLocal={setLocal} />
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-8 text-center">
          <p className="text-2xl">🚧</p>
          <p className="mt-2 font-semibold text-yellow-800">Próximamente</p>
          <p className="text-sm text-yellow-700">
            Los cierres de Saavedra se habilitan cuando estabilicemos el flujo en Vedia.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <CabeceraLocal local={local} setLocal={setLocal} />
      <SelectorFecha fecha={fecha} setFecha={setFecha} />
      <ResumenDia local={local} fecha={fecha} />
      <DetalleDia local={local} fecha={fecha} />
    </div>
  );
}

function CabeceraLocal({ local, setLocal }: { local: Local; setLocal: (l: Local) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-gray-600">Local:</span>
      <button
        onClick={() => setLocal('vedia')}
        className={cn(
          'rounded-full border px-3 py-1 text-xs font-medium transition',
          local === 'vedia'
            ? 'border-rodziny-500 bg-rodziny-50 text-rodziny-700'
            : 'border-gray-300 text-gray-600 hover:bg-gray-50',
        )}
      >
        Vedia
      </button>
      <button
        onClick={() => setLocal('saavedra')}
        className={cn(
          'rounded-full border px-3 py-1 text-xs font-medium transition',
          local === 'saavedra'
            ? 'border-rodziny-500 bg-rodziny-50 text-rodziny-700'
            : 'border-gray-300 text-gray-600 hover:bg-gray-50',
        )}
      >
        Saavedra
      </button>
    </div>
  );
}

function SelectorFecha({ fecha, setFecha }: { fecha: string; setFecha: (f: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => setFecha(diaAnterior(fecha))}
        className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
      >
        ←
      </button>
      <input
        type="date"
        value={fecha}
        onChange={(e) => setFecha(e.target.value)}
        className="rounded border border-gray-300 px-3 py-1.5 text-sm"
      />
      <button
        onClick={() => setFecha(diaSiguiente(fecha))}
        className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
      >
        →
      </button>
      <button
        onClick={() => setFecha(hoyISO())}
        className="ml-2 rounded border border-rodziny-300 bg-rodziny-50 px-3 py-1.5 text-sm font-medium text-rodziny-700 hover:bg-rodziny-100"
      >
        Hoy
      </button>
    </div>
  );
}

function ResumenDia({ local, fecha }: { local: Local; fecha: string }) {
  const { data: cierres } = useQuery({
    queryKey: ['cocina-cierre-dia', local, fecha],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_cierre_dia')
        .select('*')
        .eq('local', local)
        .eq('fecha', fecha);
      if (error) throw error;
      return (data ?? []) as CierreRow[];
    },
  });

  const requisitos = [
    { tipo: 'pasta' as Tipo, turno: 'mediodia' as Turno, label: 'Pastas · mediodía', emoji: '🍝' },
    { tipo: 'pasta' as Tipo, turno: 'noche' as Turno, label: 'Pastas · noche', emoji: '🍝' },
    { tipo: 'salsa' as Tipo, turno: null, label: 'Salsas (fin de día)', emoji: '🥫' },
    { tipo: 'postre' as Tipo, turno: null, label: 'Postres (fin de día)', emoji: '🍰' },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {requisitos.map((r) => {
        const filas = (cierres ?? []).filter(
          (c) => c.tipo === r.tipo && c.turno === r.turno,
        );
        const cargado = filas.length > 0;
        return (
          <div
            key={`${r.tipo}-${r.turno ?? 'fin'}`}
            className={cn(
              'rounded-lg border p-3',
              cargado
                ? 'border-green-200 bg-green-50'
                : 'border-red-200 bg-red-50',
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-lg">{r.emoji}</span>
              <span
                className={cn(
                  'text-xs font-bold',
                  cargado ? 'text-green-700' : 'text-red-700',
                )}
              >
                {cargado ? '✓ CARGADO' : '✗ FALTA'}
              </span>
            </div>
            <p className="mt-1 text-sm font-semibold text-gray-800">{r.label}</p>
            <p className="mt-0.5 text-[11px] text-gray-500">
              {cargado
                ? `${filas.length} producto${filas.length > 1 ? 's' : ''} · por ${filas[0].responsable ?? 'sin responsable'}`
                : 'Sin cierre registrado'}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function DetalleDia({ local, fecha }: { local: Local; fecha: string }) {
  const [filtroTipo, setFiltroTipo] = useState<'todos' | Tipo>('todos');

  const { data: cierres, isLoading } = useQuery({
    queryKey: ['cocina-cierre-dia-detalle', local, fecha],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_cierre_dia')
        .select('*')
        .eq('local', local)
        .eq('fecha', fecha)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as CierreRow[];
    },
  });

  const productoIds = useMemo(
    () =>
      Array.from(
        new Set((cierres ?? []).map((c) => c.producto_id).filter((x): x is string => !!x)),
      ),
    [cierres],
  );
  const recetaIds = useMemo(
    () =>
      Array.from(
        new Set((cierres ?? []).map((c) => c.receta_id).filter((x): x is string => !!x)),
      ),
    [cierres],
  );

  const { data: productos } = useQuery({
    queryKey: ['cocina-cierre-productos', productoIds.join(',')],
    enabled: productoIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_productos')
        .select('id, nombre, codigo, tipo')
        .in('id', productoIds);
      if (error) throw error;
      return (data ?? []) as ProductoMin[];
    },
  });

  const { data: recetas } = useQuery({
    queryKey: ['cocina-cierre-recetas', recetaIds.join(',')],
    enabled: recetaIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_recetas')
        .select('id, nombre, tipo')
        .in('id', recetaIds);
      if (error) throw error;
      return (data ?? []) as RecetaMin[];
    },
  });

  const productosMap = useMemo(() => {
    const m = new Map<string, ProductoMin>();
    (productos ?? []).forEach((p) => m.set(p.id, p));
    return m;
  }, [productos]);

  const recetasMap = useMemo(() => {
    const m = new Map<string, RecetaMin>();
    (recetas ?? []).forEach((r) => m.set(r.id, r));
    return m;
  }, [recetas]);

  const filtradas = useMemo(
    () =>
      (cierres ?? []).filter((c) => filtroTipo === 'todos' || c.tipo === filtroTipo),
    [cierres, filtroTipo],
  );

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-800">
          Detalle del día ({(cierres ?? []).length})
        </h3>
        <div className="flex gap-1">
          {(['todos', 'pasta', 'salsa', 'postre'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setFiltroTipo(t)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px] font-medium transition',
                filtroTipo === t
                  ? 'border-rodziny-500 bg-rodziny-50 text-rodziny-700'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50',
              )}
            >
              {t === 'todos' ? 'Todos' : t.charAt(0).toUpperCase() + t.slice(1) + 's'}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <p className="py-8 text-center text-sm text-gray-400">Cargando...</p>
      ) : filtradas.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">
          No hay cierres registrados para este día.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-[11px] uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2">Hora</th>
                <th className="px-4 py-2">Producto</th>
                <th className="px-4 py-2">Tipo</th>
                <th className="px-4 py-2">Turno</th>
                <th className="px-4 py-2 text-right">Inicial</th>
                <th className="px-4 py-2 text-right">Entrega</th>
                <th className="px-4 py-2 text-right">Vendido</th>
                <th className="px-4 py-2 text-right">Real</th>
                <th className="px-4 py-2">Responsable</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((c) => {
                const prod = c.producto_id ? productosMap.get(c.producto_id) : null;
                const rec = c.receta_id ? recetasMap.get(c.receta_id) : null;
                const nombre = prod?.nombre ?? rec?.nombre ?? '—';
                const codigo = prod?.codigo ?? '';
                const hora = new Date(c.created_at).toLocaleTimeString('es-AR', {
                  hour: '2-digit',
                  minute: '2-digit',
                });
                return (
                  <tr key={c.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2 font-mono text-xs text-gray-500">{hora}</td>
                    <td className="px-4 py-2">
                      <p className="font-medium text-gray-800">{nombre}</p>
                      {codigo && <p className="font-mono text-[10px] text-gray-400">{codigo}</p>}
                    </td>
                    <td className="px-4 py-2 text-gray-600">{c.tipo}</td>
                    <td className="px-4 py-2 text-gray-600">{c.turno ?? '—'}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-500">
                      {c.inicial ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-500">
                      {c.entrega ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-500">
                      {c.vendido ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums text-gray-800">
                      {c.cantidad_real} {c.unidad === 'kg' ? 'kg' : c.unidad === 'unidades' ? 'u' : 'p'}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500">
                      {c.responsable ?? '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
