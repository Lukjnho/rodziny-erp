import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cn, formatARS } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { FichaTecnica, type Receta, type Ingrediente } from '@/modules/cocina/RecetasTab';
import { useCostosRecetas } from '@/modules/cocina/hooks/useCostosRecetas';
import { RecetaEditorInline } from './RecetaEditorInline';

// Costeo = recetas y subrecetas (Crema Pastelera, Masa Facturas, salsas base,
// rellenos, etc.). Solo ingredientes + costo. El producto vendible (precio por
// canal, packaging, adicionales, ABM) vive en el tab Menú.
type RecetaFull = Receta & { es_subreceta: boolean };

type FiltroLocal = 'todos' | 'vedia' | 'saavedra';

const TIPO_COLOR: Record<string, string> = {
  relleno: 'bg-green-100 text-green-700',
  masa: 'bg-indigo-100 text-indigo-700',
  salsa: 'bg-orange-100 text-orange-700',
  pasta: 'bg-red-100 text-red-700',
  postre: 'bg-pink-100 text-pink-700',
  pasteleria: 'bg-yellow-100 text-yellow-700',
  panaderia: 'bg-amber-100 text-amber-700',
  subreceta: 'bg-purple-100 text-purple-700',
  otro: 'bg-gray-100 text-gray-700',
};

// Orden y etiqueta de las categorías en el grid de Costeo.
const ORDEN_TIPOS = [
  'masa',
  'relleno',
  'salsa',
  'pasta',
  'postre',
  'pasteleria',
  'panaderia',
  'subreceta',
  'otro',
];

const TIPO_LABEL: Record<string, string> = {
  masa: 'Masas',
  relleno: 'Rellenos',
  salsa: 'Salsas',
  pasta: 'Pastas',
  postre: 'Postres',
  pasteleria: 'Pastelería',
  panaderia: 'Panadería',
  subreceta: 'Subrecetas',
  otro: 'Otros',
};

export function FichaProductoTab() {
  const qc = useQueryClient();
  const { perfil } = useAuth();
  const localRestringido = (perfil?.local_restringido ?? null) as 'vedia' | 'saavedra' | null;

  const [recetaId, setRecetaId] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('todos');
  const [filtroLocal, setFiltroLocal] = useState<FiltroLocal>(
    (localRestringido as FiltroLocal) ?? 'todos',
  );
  const [soloSub, setSoloSub] = useState(false);
  const [editando, setEditando] = useState(false);
  const [nuevaReceta, setNuevaReceta] = useState(false);

  const { data: recetas } = useQuery({
    queryKey: ['cocina-recetas'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_recetas')
        .select('*')
        .eq('activo', true)
        .order('nombre');
      if (error) throw error;
      return data as RecetaFull[];
    },
  });

  const { data: ingredientes } = useQuery({
    queryKey: ['cocina-receta-ingredientes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_receta_ingredientes')
        .select('*')
        .order('orden');
      if (error) throw error;
      return data as Ingrediente[];
    },
  });

  const { costos, ctx } = useCostosRecetas();

  const tipos = useMemo(() => {
    const set = new Set<string>();
    for (const r of recetas ?? []) if (r.tipo) set.add(r.tipo);
    return Array.from(set).sort();
  }, [recetas]);

  const filtradas = useMemo(() => {
    let lista = recetas ?? [];
    if (filtroLocal !== 'todos') lista = lista.filter((r) => r.local === filtroLocal);
    if (filtroTipo !== 'todos') lista = lista.filter((r) => r.tipo === filtroTipo);
    if (soloSub) lista = lista.filter((r) => r.es_subreceta);
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase();
      lista = lista.filter((r) => r.nombre.toLowerCase().includes(q));
    }
    return lista;
  }, [recetas, filtroLocal, filtroTipo, soloSub, busqueda]);

  // Agrupado por categoría (tipo), respetando ORDEN_TIPOS y luego alfabético.
  const grupos = useMemo(() => {
    const map = new Map<string, RecetaFull[]>();
    for (const r of filtradas) {
      const k = r.tipo || 'otro';
      (map.get(k) ?? map.set(k, []).get(k)!).push(r);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      const ia = ORDEN_TIPOS.indexOf(a);
      const ib = ORDEN_TIPOS.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [filtradas]);

  const receta = useMemo(
    () => recetas?.find((r) => r.id === recetaId) ?? null,
    [recetas, recetaId],
  );

  const ingsReceta = useMemo(
    () => (receta ? (ingredientes ?? []).filter((i) => i.receta_id === receta.id) : []),
    [ingredientes, receta],
  );

  const invalidarTodo = () => {
    qc.invalidateQueries({ queryKey: ['cocina-recetas'] });
    qc.invalidateQueries({ queryKey: ['cocina-receta-ingredientes'] });
    qc.invalidateQueries({ queryKey: ['cocina-recetas-costeo'] });
    qc.invalidateQueries({ queryKey: ['cocina-receta-ingredientes-costeo'] });
    qc.invalidateQueries({ queryKey: ['productos-costeo'] });
  };

  // ─── Nueva receta (apartado ancho inline, NO modal) ────────────────────────
  if (nuevaReceta) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => setNuevaReceta(false)}
          className="text-sm text-rodziny-700 hover:text-rodziny-900"
        >
          ← Volver a recetas
        </button>
        <section className="rounded-lg border border-rodziny-200 bg-white p-4">
          <h2 className="text-lg font-semibold text-gray-900">Nueva receta</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            Cargá nombre, tipo, local, rendimiento e ingredientes. El costo se calcula en vivo.
          </p>
        </section>
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <RecetaEditorInline
            receta={null}
            ingredientes={[]}
            todasLasRecetas={recetas ?? []}
            localRestringido={localRestringido}
            ctx={ctx}
            onCancel={() => setNuevaReceta(false)}
            onSaved={() => {
              setNuevaReceta(false);
              invalidarTodo();
            }}
          />
        </section>
      </div>
    );
  }

  // ─── Grid de recetas ───────────────────────────────────────────────────────
  if (!receta) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
          <strong>Recetas y subrecetas.</strong> Acá armás los ingredientes y ves el{' '}
          <strong>costo</strong> (por kg / por porción). Las subrecetas (Crema Pastelera, Masa
          de Facturas, salsas base) se editan acá igual que cualquier receta. El producto
          vendible y su precio van en el tab <strong>Menú</strong>.
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-3">
          <div className="flex gap-1">
            {(['todos', 'vedia', 'saavedra'] as const).map((l) => (
              <button
                key={l}
                disabled={!!localRestringido && l !== localRestringido && l !== 'todos'}
                onClick={() => setFiltroLocal(l)}
                className={cn(
                  'rounded px-3 py-1.5 text-sm font-medium capitalize transition-colors disabled:opacity-30',
                  filtroLocal === l
                    ? 'bg-rodziny-700 text-white'
                    : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
                )}
              >
                {l === 'todos' ? 'Ambos locales' : l}
              </button>
            ))}
          </div>
          <input
            placeholder="Buscar receta…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="w-56 rounded border border-gray-300 px-3 py-1.5 text-sm"
          />
          <select
            value={filtroTipo}
            onChange={(e) => setFiltroTipo(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm capitalize"
          >
            <option value="todos">Todos los tipos</option>
            {tipos.map((t) => (
              <option key={t} value={t} className="capitalize">
                {t}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={soloSub}
              onChange={(e) => setSoloSub(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            Solo subrecetas
          </label>
          <button
            onClick={() => setNuevaReceta(true)}
            className="ml-auto rounded bg-rodziny-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-rodziny-800"
          >
            + Nueva receta
          </button>
          <div className="text-xs text-gray-400">
            {filtradas.length} de {recetas?.length ?? 0}
          </div>
        </div>

        {grupos.length === 0 && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-8 text-center text-sm text-gray-400">
            Sin recetas para este filtro
          </div>
        )}

        {grupos.map(([tipo, items]) => (
          <section key={tipo} className="space-y-2">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'rounded px-2 py-0.5 text-xs font-semibold',
                  TIPO_COLOR[tipo] ?? 'bg-gray-100 text-gray-600',
                )}
              >
                {TIPO_LABEL[tipo] ?? tipo}
              </span>
              <span className="text-xs text-gray-400">{items.length}</span>
              <div className="h-px flex-1 bg-gray-200" />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {items.map((r) => {
                const c = costos.get(r.id);
                const costoUnit = c?.costoPorPorcion ?? c?.costoPorKg ?? null;
                const unidadCosto =
                  c?.costoPorPorcion != null
                    ? '/porción'
                    : c?.costoPorKg != null
                      ? '/kg'
                      : '';
                return (
                  <button
                    key={r.id}
                    onClick={() => setRecetaId(r.id)}
                    className="flex flex-col gap-1 rounded-lg border border-gray-200 bg-white p-3 text-left transition-colors hover:border-rodziny-400 hover:bg-rodziny-50"
                  >
                    <span className="text-sm font-medium leading-tight text-gray-800">
                      {r.nombre}
                    </span>
                    <div className="flex flex-wrap items-center gap-1">
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5 text-[9px] font-medium capitalize',
                          TIPO_COLOR[r.tipo] ?? 'bg-gray-100 text-gray-600',
                        )}
                      >
                        {r.tipo}
                      </span>
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[9px] capitalize text-gray-600">
                        {r.local ?? '—'}
                      </span>
                      {r.es_subreceta && (
                        <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[9px] text-purple-700">
                          subreceta
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs tabular-nums text-gray-500">
                      {costoUnit != null ? (
                        <>
                          {formatARS(costoUnit)}
                          <span className="ml-0.5 text-[10px] text-gray-400">
                            {unidadCosto}
                          </span>
                        </>
                      ) : (
                        <span className="text-gray-300">sin costo</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        ))}

      </div>
    );
  }

  // ─── Ficha de la receta ────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <button
        onClick={() => {
          setEditando(false);
          setRecetaId(null);
        }}
        className="text-sm text-rodziny-700 hover:text-rodziny-900"
      >
        ← Volver a recetas
      </button>

      <section className="rounded-lg border border-rodziny-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-gray-900">{receta.nombre}</h2>
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-[10px] font-medium capitalize',
                  TIPO_COLOR[receta.tipo] ?? 'bg-gray-100 text-gray-600',
                )}
              >
                {receta.tipo}
              </span>
              {receta.es_subreceta && (
                <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] text-purple-700">
                  subreceta
                </span>
              )}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              <span className="capitalize">{receta.local ?? '—'}</span> · solo costo (el precio
              de venta del producto va en el tab <strong>Menú</strong>)
            </div>
          </div>
          {!editando && (
            <button
              onClick={() => setEditando(true)}
              className="rounded bg-rodziny-700 px-3 py-1.5 text-xs text-white hover:bg-rodziny-800"
            >
              ✎ Editar receta
            </button>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        {editando ? (
          <RecetaEditorInline
            key={receta.id}
            receta={receta}
            ingredientes={ingsReceta}
            todasLasRecetas={recetas ?? []}
            localRestringido={localRestringido}
            ctx={ctx}
            onCancel={() => setEditando(false)}
            onSaved={() => {
              setEditando(false);
              invalidarTodo();
            }}
          />
        ) : (
          <FichaTecnica
            receta={receta}
            ingredientes={ingsReceta}
            costo={costos.get(receta.id)}
          />
        )}
      </section>
    </div>
  );
}
