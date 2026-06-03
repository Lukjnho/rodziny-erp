import { useState, useMemo } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatARS, cn } from '@/lib/utils';
import {
  useMenuEngineering,
  type CuadranteME,
  type ProductoME,
} from '../hooks/useMenuEngineering';

// Genera lista de últimos N meses formato YYYY-MM (más reciente primero)
function ultimosMeses(n: number): string[] {
  const out: string[] = [];
  const hoy = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

const CUADRANTES: Record<
  CuadranteME,
  { label: string; icon: string; color: string; descripcion: string; sugerencia: string }
> = {
  estrella: {
    label: 'Estrella',
    icon: '⭐',
    color: 'bg-amber-100 text-amber-900 border-amber-300',
    descripcion: 'Alta venta + alto margen. El corazón del menú.',
    sugerencia: 'Mantener calidad. Posición destacada. Probar subida leve si la demanda lo permite.',
  },
  vaca: {
    label: 'Vaca',
    icon: '🐄',
    color: 'bg-blue-100 text-blue-900 border-blue-300',
    descripcion: 'Alta venta + bajo margen. Mucho trabajo, poca ganancia por unidad.',
    sugerencia: 'Subir precio con cuidado (mucha demanda lo absorbe) o reducir costo sin tocar calidad.',
  },
  puzzle: {
    label: 'Puzzle',
    icon: '🧩',
    color: 'bg-purple-100 text-purple-900 border-purple-300',
    descripcion: 'Baja venta + alto margen. Bueno cuando se vende, pero nadie lo pide.',
    sugerencia: 'Dar visibilidad (carta + recomendación). Probar bajada leve. Eliminar si complica inventario.',
  },
  perro: {
    label: 'Perro',
    icon: '🐶',
    color: 'bg-red-100 text-red-900 border-red-300',
    descripcion: 'Baja venta + bajo margen. Lo peor de ambos mundos.',
    sugerencia: 'Eliminar salvo función estratégica (alérgicos, infantil, temporada).',
  },
};

export function MenuEngineeringTab() {
  const { perfil } = useAuth();
  const localRestringido = (perfil?.local_restringido ?? null) as 'vedia' | 'saavedra' | null;
  const meses = useMemo(() => ultimosMeses(12), []);
  const [periodosSel, setPeriodosSel] = useState<string[]>(meses.slice(0, 1));
  const [local, setLocal] = useState<'vedia' | 'saavedra'>(localRestringido ?? 'vedia');
  const [categoria, setCategoria] = useState<string>('todas');
  const [cuadranteFiltro, setCuadranteFiltro] = useState<CuadranteME | 'todos'>('todos');

  const { productos, isLoading } = useMenuEngineering({
    periodos: periodosSel,
    local,
    categoria,
  });

  // Lista de categorías disponibles para el dropdown. Query independiente para
  // que el dropdown muestre todas las opciones aunque el usuario haya filtrado
  // a una sola. Se llamaba antes useMenuEngineering por segunda vez con
  // categoria='todas', pero la doble llamada en el mismo componente generaba
  // estado inconsistente (header con N productos, tabla con otros).
  const { data: categorias = [] } = useQuery({
    queryKey: ['menu-engineering-categorias', periodosSel, local],
    enabled: periodosSel.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ventas_items')
        .select('categoria')
        .eq('local', local)
        .in('periodo', periodosSel)
        .not('categoria', 'is', null);
      if (error) throw error;
      const set = new Set<string>();
      for (const r of (data ?? []) as { categoria: string | null }[]) {
        if (r.categoria) set.add(r.categoria);
      }
      return Array.from(set).sort();
    },
  });

  // Contar por cuadrante
  const conteo = useMemo(() => {
    const out: Record<CuadranteME | 'sin', number> = {
      estrella: 0,
      vaca: 0,
      puzzle: 0,
      perro: 0,
      sin: 0,
    };
    for (const p of productos) {
      if (p.cuadrante) out[p.cuadrante]++;
      else out.sin++;
    }
    return out;
  }, [productos]);

  const productosVisibles = useMemo(() => {
    if (cuadranteFiltro === 'todos') return productos;
    return productos.filter((p) => p.cuadrante === cuadranteFiltro);
  }, [productos, cuadranteFiltro]);

  // Productos que se vendieron en Fudo pero no tienen costo válido (sin receta
  // vendible costeada, o el match cae en una subreceta). El control de costeos
  // tiene que crear/vincular su receta en el tab Costeo. No entran en la matriz.
  const productosSinCosto = useMemo(
    () =>
      productos
        .filter((p) => p.costoUnitario == null && p.unidadesVendidas > 0)
        .sort((a, b) => b.unidadesVendidas - a.unidadesVendidas),
    [productos],
  );

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
        Matriz Menu Engineering: cruza <strong>popularidad</strong> (unidades vendidas) ×{' '}
        <strong>rentabilidad</strong> (margen <strong>$ por unidad</strong>) para identificar{' '}
        <strong>estrellas, vacas, puzzles y perros</strong>. El margen es la ganancia real por
        plato: precio neto de IVA, menos la comisión bancaria más alta, menos el costo. Las
        medianas de cada eje definen los umbrales. Los productos <strong>ancla</strong> tienen
        badge y reciben sugerencias más conservadoras.
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-3">
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-gray-500">
            Período
          </label>
          <select
            multiple
            value={periodosSel}
            onChange={(e) =>
              setPeriodosSel(Array.from(e.target.selectedOptions).map((o) => o.value))
            }
            className="rounded border border-gray-300 px-2 py-1 text-xs"
            size={3}
          >
            {meses.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <div className="mt-0.5 text-[9px] text-gray-400">Ctrl+click para varios</div>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-gray-500">Local</label>
          <div className="flex gap-1">
            {(['vedia', 'saavedra'] as const).map((l) => (
              <button
                key={l}
                disabled={!!localRestringido && l !== localRestringido}
                onClick={() => setLocal(l)}
                className={cn(
                  'rounded px-3 py-1 text-xs capitalize disabled:opacity-30',
                  local === l
                    ? 'bg-rodziny-700 text-white'
                    : 'border border-gray-300 bg-white text-gray-700',
                )}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-gray-500">
            Categoría
          </label>
          <select
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1 text-xs"
          >
            <option value="todas">Todas (no recomendado)</option>
            {categorias.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <div className="mt-0.5 text-[9px] text-gray-400">
            Las medianas se calculan dentro de la categoría
          </div>
        </div>
        <div className="ml-auto text-xs text-gray-400">
          {productos.length} productos · {productos.filter((p) => p.cuadrante).length} clasificados
        </div>
      </div>

      {/* Resumen por cuadrante */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(Object.keys(CUADRANTES) as CuadranteME[]).map((c) => {
          const cfg = CUADRANTES[c];
          const cant = conteo[c];
          const activo = cuadranteFiltro === c;
          return (
            <button
              key={c}
              onClick={() => setCuadranteFiltro(activo ? 'todos' : c)}
              className={cn(
                'rounded-lg border-2 p-3 text-left transition-all',
                cfg.color,
                activo ? 'ring-2 ring-rodziny-500' : 'hover:scale-[1.02]',
              )}
            >
              <div className="text-lg">{cfg.icon}</div>
              <div className="text-xs font-semibold">{cfg.label}</div>
              <div className="text-2xl font-bold tabular-nums">{cant}</div>
              <div className="mt-1 text-[10px] opacity-80">{cfg.descripcion}</div>
            </button>
          );
        })}
      </div>

      {/* Advertencia: vendidos en Fudo sin costo válido → el control de costeos
          tiene que crear/vincular su receta en el tab Costeo. */}
      {!isLoading && productosSinCosto.length > 0 && (
        <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-3">
          <div className="text-sm font-semibold text-amber-900">
            ⚠ {productosSinCosto.length} producto{productosSinCosto.length === 1 ? '' : 's'}{' '}
            vendido{productosSinCosto.length === 1 ? '' : 's'} sin costo válido
          </div>
          <div className="mb-2 text-[11px] text-amber-700">
            Se venden en Fudo pero no tienen receta vendible costeada (falta crearla o vincularla
            en el tab <strong>Costeo</strong>). No entran en la matriz hasta que tengan costo.
          </div>
          <div className="flex flex-wrap gap-1.5">
            {productosSinCosto.map((p) => (
              <span
                key={`${p.local}|${p.codigo || `n:${p.nombre}`}`}
                className="rounded border border-amber-200 bg-white px-2 py-0.5 text-[11px] text-amber-900"
              >
                {p.nombre}{' '}
                <span className="tabular-nums text-amber-600">· {p.unidadesVendidas} uds</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-8 text-center text-sm text-gray-400">
          Cargando ventas y costos…
        </div>
      ) : (
        <TablaProductosME productos={productosVisibles} />
      )}

      {cuadranteFiltro !== 'todos' && (
        <div
          className={cn(
            'rounded-lg border-2 p-3 text-xs',
            CUADRANTES[cuadranteFiltro as CuadranteME].color,
          )}
        >
          <strong className="text-sm">{CUADRANTES[cuadranteFiltro as CuadranteME].icon}{' '}
            {CUADRANTES[cuadranteFiltro as CuadranteME].label}:</strong>{' '}
          {CUADRANTES[cuadranteFiltro as CuadranteME].sugerencia}
        </div>
      )}
    </div>
  );
}

function TablaProductosME({ productos }: { productos: ProductoME[] }) {
  const qc = useQueryClient();
  const toggleAncla = useMutation({
    mutationFn: async (payload: { id: string; valor: boolean }) => {
      const { error } = await supabase
        .from('cocina_productos')
        .update({ es_ancla: payload.valor })
        .eq('id', payload.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu-engineering-productos'] }),
  });

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="w-full text-xs">
        <thead className="bg-gray-50 text-left text-[10px] uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-3 py-2">Producto</th>
            <th className="px-3 py-2">Cat.</th>
            <th className="px-3 py-2">Local</th>
            <th className="px-3 py-2 text-right">Uds.</th>
            <th className="px-3 py-2 text-right">Precio prom.</th>
            <th className="px-3 py-2 text-right">Costo estim.</th>
            <th className="px-3 py-2 text-right" title="Ganancia $ por unidad (neto de IVA + comisión − costo). Es el eje que define el cuadrante.">
              Margen $/u <span className="text-rodziny-500">◄</span>
            </th>
            <th className="px-3 py-2 text-right">Margen %</th>
            <th className="px-3 py-2 text-right">Contribución $</th>
            <th className="px-3 py-2 text-center">Clase</th>
            <th className="px-3 py-2 text-center">Ancla</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {productos.length === 0 && (
            <tr>
              <td colSpan={11} className="px-3 py-6 text-center text-gray-400">
                Sin datos para los filtros seleccionados
              </td>
            </tr>
          )}
          {productos.map((p) => (
            <tr
              key={`${p.local}|${p.codigo || `n:${p.nombre}`}`}
              className="hover:bg-gray-50"
            >
              <td className="px-3 py-2">
                <div className="font-medium">{p.nombre}</div>
                <div className="text-[9px] text-gray-400">{p.codigo}</div>
              </td>
              <td className="px-3 py-2 text-gray-600">
                {p.categoriaFudo ?? <span className="capitalize">{p.tipo}</span>}
              </td>
              <td className="px-3 py-2 capitalize text-gray-600">{p.local}</td>
              <td className="px-3 py-2 text-right tabular-nums">{p.unidadesVendidas}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatARS(p.precioPromedio)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-500">
                {p.costoUnitario != null ? formatARS(p.costoUnitario) : '—'}
              </td>
              <td
                className={cn(
                  'px-3 py-2 text-right tabular-nums',
                  p.margenUnitario != null && p.margenUnitario < 0 && 'text-red-700',
                )}
              >
                {p.margenUnitario != null ? formatARS(p.margenUnitario) : '—'}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {p.margenPctSobrePrecio != null
                  ? `${(p.margenPctSobrePrecio * 100).toFixed(1)}%`
                  : '—'}
              </td>
              <td className="px-3 py-2 text-right font-medium tabular-nums">
                {p.contribucionAbsoluta != null ? formatARS(p.contribucionAbsoluta) : '—'}
              </td>
              <td className="px-3 py-2 text-center">
                {p.cuadrante ? (
                  <span
                    className={cn(
                      'rounded px-1.5 py-0.5 text-[10px] font-medium',
                      CUADRANTES[p.cuadrante].color,
                    )}
                  >
                    {CUADRANTES[p.cuadrante].icon} {CUADRANTES[p.cuadrante].label}
                  </span>
                ) : (
                  <span className="text-[10px] text-gray-300">sin costo</span>
                )}
              </td>
              <td className="px-3 py-2 text-center">
                {p.cocinaProductoId ? (
                  <input
                    type="checkbox"
                    checked={p.esAncla}
                    onChange={(e) =>
                      toggleAncla.mutate({ id: p.cocinaProductoId!, valor: e.target.checked })
                    }
                    title="Marcar como producto ancla (excluido de sugerencias automáticas)"
                    className="h-4 w-4"
                  />
                ) : (
                  <span className="text-[10px] text-gray-300">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
