import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cn, formatARS } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { FichaTecnica, type Receta, type Ingrediente } from '@/modules/cocina/RecetasTab';
import { useCostosRecetas } from '@/modules/cocina/hooks/useCostosRecetas';
import { RecetaEditorInline } from './RecetaEditorInline';

// Costeo = recetas y subrecetas (Crema Pastelera, Masa Facturas, salsas base,
// rellenos, etc.). Solo ingredientes + costo. El producto vendible (precio por
// canal, packaging, adicionales, ABM) vive en el tab Menú.
type RecetaFull = Receta & { vendible: boolean };

// Agrupa visualmente subrecetas por rol y recetas por categoría, normalizando
// salsa_base/postre_base/bebida_base a sus pares "comerciales" para no duplicar
// secciones en el grid de Costeo.
function tipoEfectivo(r: Receta): string {
  if (r.tipo === 'subreceta') {
    if (r.rol === 'salsa_base') return 'salsa';
    if (r.rol === 'postre_base') return 'postre';
    if (r.rol === 'bebida_base') return 'bebida';
    if (r.rol === 'pasteleria_base') return 'pasteleria';
    return r.rol ?? 'otros';
  }
  return r.categoria ?? 'otros';
}

// Bebidas de reventa (latas, agua, vino sin transformar): no son recetas, son
// cocina_productos con insumo_reventa_id. Se gestionan acá en Costeo (alta/
// edición/eliminación) y van automáticamente al Menú mientras estén activas.
interface BebidaReventa {
  id: string;
  nombre: string;
  local: 'vedia' | 'saavedra';
  insumo_reventa_id: string;
}

interface InsumoBebida {
  id: string;
  nombre: string;
  costo_unitario: number | null;
  unidad: string;
  local: string | null;
}

const CATEGORIAS_INSUMO_BEBIDA = ['Bebidas para venta', 'Bebidas para la venta'];

// Union de lo que se muestra en el grid de Costeo.
type ItemCosteo =
  | { kind: 'receta'; receta: RecetaFull; costoUnit: number | null; unidadCosto: string }
  | { kind: 'reventa'; bebida: BebidaReventa; costoUnit: number | null };

type FiltroLocal = 'vedia' | 'saavedra';

const TIPO_COLOR: Record<string, string> = {
  relleno: 'bg-green-100 text-green-700',
  masa: 'bg-indigo-100 text-indigo-700',
  salsa: 'bg-orange-100 text-orange-700',
  pasta: 'bg-red-100 text-red-700',
  postre: 'bg-pink-100 text-pink-700',
  pasteleria: 'bg-rose-100 text-rose-700',
  panificado: 'bg-amber-100 text-amber-700',
  bebida: 'bg-sky-100 text-sky-700',
  adicional: 'bg-emerald-100 text-emerald-700',
  packaging: 'bg-slate-100 text-slate-700',
  otros: 'bg-gray-100 text-gray-700',
};

// Orden y etiqueta de las categorías en el grid de Costeo.
const ORDEN_TIPOS = [
  'masa',
  'relleno',
  'salsa',
  'pasta',
  'postre',
  'pasteleria',
  'panificado',
  'bebida',
  'adicional',
  'packaging',
  'otros',
];

const TIPO_LABEL: Record<string, string> = {
  masa: 'Masas',
  relleno: 'Rellenos',
  salsa: 'Salsas',
  pasta: 'Pastas',
  postre: 'Postres',
  pasteleria: 'Pastelería',
  panificado: 'Panificados',
  bebida: 'Bebidas',
  adicional: 'Adicionales',
  packaging: 'Packaging',
  otros: 'Otros',
};

export function FichaProductoTab() {
  const qc = useQueryClient();
  const { perfil } = useAuth();
  const localRestringido = (perfil?.local_restringido ?? null) as 'vedia' | 'saavedra' | null;

  const [recetaId, setRecetaId] = useState<string | null>(null);
  const [bebidaRevId, setBebidaRevId] = useState<string | null>(null);
  const [nuevaBebidaRev, setNuevaBebidaRev] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('todos');
  const [filtroLocal, setFiltroLocal] = useState<FiltroLocal>(
    (localRestringido as FiltroLocal | null) ?? 'vedia',
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

  const { data: bebidasReventa } = useQuery({
    queryKey: ['costeo-bebidas-reventa'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_productos')
        .select('id, nombre, local, insumo_reventa_id')
        .eq('tipo', 'bebida')
        .eq('activo', true)
        .not('insumo_reventa_id', 'is', null)
        .order('nombre');
      if (error) throw error;
      return (data ?? []) as BebidaReventa[];
    },
  });

  const { data: insumosBebida } = useQuery({
    queryKey: ['costeo-insumos-bebida'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('productos')
        .select('id, nombre, costo_unitario, unidad, local')
        .in('categoria', CATEGORIAS_INSUMO_BEBIDA)
        .order('nombre');
      if (error) throw error;
      return (data ?? []) as InsumoBebida[];
    },
  });

  const costoInsumo = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of insumosBebida ?? []) {
      if (i.costo_unitario != null) m.set(i.id, Number(i.costo_unitario));
    }
    return m;
  }, [insumosBebida]);

  const { costos, ctx } = useCostosRecetas();

  // Vocabulario unificado para el filtro: usa tipoEfectivo(r) — mismo valor que
  // luego compara `items` al filtrar. Si usáramos r.tipo crudo, el dropdown
  // ofrecería 'receta'/'subreceta' pero el filter compara contra 'masa','salsa',
  // etc. → nunca matchea (bug pre-fix).
  const tipos = useMemo(() => {
    const set = new Set<string>();
    for (const r of recetas ?? []) set.add(tipoEfectivo(r));
    // Ordenar según ORDEN_TIPOS, dejando los desconocidos al final.
    return Array.from(set).sort((a, b) => {
      const ia = ORDEN_TIPOS.indexOf(a);
      const ib = ORDEN_TIPOS.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [recetas]);

  // Items del grid: recetas + bebidas de reventa (en el grupo 'bebida').
  // Bebidas reventa no son recetas, así que el filtro "Solo subrecetas" las oculta.
  const items = useMemo<ItemCosteo[]>(() => {
    const q = busqueda.trim().toLowerCase();
    const out: ItemCosteo[] = [];
    for (const r of recetas ?? []) {
      if (r.local !== filtroLocal) continue;
      if (filtroTipo !== 'todos' && tipoEfectivo(r) !== filtroTipo) continue;
      if (soloSub && r.tipo !== 'subreceta') continue;
      if (q && !r.nombre.toLowerCase().includes(q)) continue;
      const c = costos.get(r.id);
      const costoUnit = c?.costoPorPorcion ?? c?.costoPorKg ?? null;
      const unidadCosto =
        c?.costoPorPorcion != null ? '/porción' : c?.costoPorKg != null ? '/kg' : '';
      out.push({ kind: 'receta', receta: r, costoUnit, unidadCosto });
    }
    if (!soloSub && (filtroTipo === 'todos' || filtroTipo === 'bebida')) {
      for (const b of bebidasReventa ?? []) {
        if (b.local !== filtroLocal) continue;
        if (q && !b.nombre.toLowerCase().includes(q)) continue;
        out.push({
          kind: 'reventa',
          bebida: b,
          costoUnit: costoInsumo.get(b.insumo_reventa_id) ?? null,
        });
      }
    }
    return out;
  }, [recetas, bebidasReventa, costos, costoInsumo, filtroLocal, filtroTipo, soloSub, busqueda]);

  const filtradas = useMemo(
    () => items.filter((i): i is Extract<ItemCosteo, { kind: 'receta' }> => i.kind === 'receta'),
    [items],
  );

  // Agrupado por categoría (tipo), respetando ORDEN_TIPOS y luego alfabético.
  const grupos = useMemo(() => {
    const map = new Map<string, ItemCosteo[]>();
    for (const it of items) {
      const k = it.kind === 'receta' ? tipoEfectivo(it.receta) : 'bebida';
      (map.get(k) ?? map.set(k, []).get(k)!).push(it);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      const ia = ORDEN_TIPOS.indexOf(a);
      const ib = ORDEN_TIPOS.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [items]);

  const receta = useMemo(
    () => recetas?.find((r) => r.id === recetaId) ?? null,
    [recetas, recetaId],
  );

  const ingsReceta = useMemo(
    () => (receta ? (ingredientes ?? []).filter((i) => i.receta_id === receta.id) : []),
    [ingredientes, receta],
  );

  // Vendible = la receta se proyecta al tab Menú (precio + margen). El costo
  // sigue saliendo de Costeo; no se duplica nada.
  const toggleVendible = useMutation({
    mutationFn: async (r: RecetaFull) => {
      const { error } = await supabase
        .from('cocina_recetas')
        .update({ vendible: !r.vendible })
        .eq('id', r.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cocina-recetas'] });
      qc.invalidateQueries({ queryKey: ['menu-recetas-vendibles'] });
    },
  });

  const invalidarTodo = () => {
    qc.invalidateQueries({ queryKey: ['cocina-recetas'] });
    qc.invalidateQueries({ queryKey: ['cocina-receta-ingredientes'] });
    qc.invalidateQueries({ queryKey: ['cocina-recetas-costeo'] });
    qc.invalidateQueries({ queryKey: ['cocina-receta-ingredientes-costeo'] });
    qc.invalidateQueries({ queryKey: ['productos-costeo'] });
  };

  const invalidarBebidaRev = () => {
    qc.invalidateQueries({ queryKey: ['costeo-bebidas-reventa'] });
    qc.invalidateQueries({ queryKey: ['menu-bebidas-reventa'] });
  };

  const bebidaRev = useMemo(
    () => bebidasReventa?.find((b) => b.id === bebidaRevId) ?? null,
    [bebidasReventa, bebidaRevId],
  );

  // ─── Nueva / editar bebida de reventa ──────────────────────────────────────
  if (nuevaBebidaRev || bebidaRev) {
    return (
      <BebidaReventaPanel
        bebida={bebidaRev}
        insumos={insumosBebida ?? []}
        localRestringido={localRestringido}
        onCancel={() => {
          setNuevaBebidaRev(false);
          setBebidaRevId(null);
        }}
        onSaved={() => {
          setNuevaBebidaRev(false);
          setBebidaRevId(null);
          invalidarBebidaRev();
        }}
      />
    );
  }

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
            {(['vedia', 'saavedra'] as const).map((l) => (
              <button
                key={l}
                disabled={!!localRestringido && l !== localRestringido}
                onClick={() => setFiltroLocal(l)}
                className={cn(
                  'rounded px-3 py-1.5 text-sm font-medium capitalize transition-colors disabled:opacity-30',
                  filtroLocal === l
                    ? 'bg-rodziny-700 text-white'
                    : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
                )}
              >
                {l}
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
                {TIPO_LABEL[t] ?? t}
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
            onClick={() => setNuevaBebidaRev(true)}
            className="ml-auto rounded border border-sky-300 bg-white px-3 py-1.5 text-sm font-medium text-sky-700 hover:bg-sky-50"
          >
            + Nueva bebida reventa
          </button>
          <button
            onClick={() => setNuevaReceta(true)}
            className="rounded bg-rodziny-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-rodziny-800"
          >
            + Nueva receta
          </button>
          <div className="text-xs text-gray-400">
            {filtradas.length} receta{filtradas.length === 1 ? '' : 's'}
            {(bebidasReventa ?? []).filter((b) => b.local === filtroLocal).length > 0 &&
              ` + ${(bebidasReventa ?? []).filter((b) => b.local === filtroLocal).length} bebida${
                (bebidasReventa ?? []).filter((b) => b.local === filtroLocal).length === 1
                  ? ''
                  : 's'
              } reventa`}
          </div>
        </div>

        {grupos.length === 0 && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-8 text-center text-sm text-gray-400">
            Sin recetas para este filtro
          </div>
        )}

        {grupos.map(([tipo, grupoItems]) => (
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
              <span className="text-xs text-gray-400">{grupoItems.length}</span>
              <div className="h-px flex-1 bg-gray-200" />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {grupoItems.map((it) => {
                if (it.kind === 'reventa') {
                  return (
                    <button
                      key={`reventa:${it.bebida.id}`}
                      onClick={() => setBebidaRevId(it.bebida.id)}
                      className="flex flex-col gap-1 rounded-lg border border-gray-200 bg-white p-3 text-left transition-colors hover:border-sky-400 hover:bg-sky-50"
                    >
                      <span className="text-sm font-medium leading-tight text-gray-800">
                        {it.bebida.nombre}
                      </span>
                      <div className="flex flex-wrap items-center gap-1">
                        <span
                          className={cn(
                            'rounded px-1.5 py-0.5 text-[9px] font-medium capitalize',
                            TIPO_COLOR.bebida,
                          )}
                        >
                          bebida
                        </span>
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[9px] capitalize text-gray-600">
                          {it.bebida.local}
                        </span>
                        <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[9px] text-sky-700">
                          reventa
                        </span>
                        <span className="rounded bg-green-100 px-1.5 py-0.5 text-[9px] font-medium text-green-700">
                          Menú
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs tabular-nums text-gray-500">
                        {it.costoUnit != null ? (
                          <>
                            {formatARS(it.costoUnit)}
                            <span className="ml-0.5 text-[10px] text-gray-400">/u</span>
                          </>
                        ) : (
                          <span className="text-gray-300">sin costo</span>
                        )}
                      </div>
                    </button>
                  );
                }
                const r = it.receta;
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
                          TIPO_COLOR[tipoEfectivo(r)] ?? 'bg-gray-100 text-gray-600',
                        )}
                      >
                        {TIPO_LABEL[tipoEfectivo(r)] ?? tipoEfectivo(r)}
                      </span>
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[9px] capitalize text-gray-600">
                        {r.local ?? '—'}
                      </span>
                      {r.tipo === 'subreceta' && (
                        <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[9px] text-purple-700">
                          subreceta
                        </span>
                      )}
                      {r.vendible && (
                        <span className="rounded bg-green-100 px-1.5 py-0.5 text-[9px] font-medium text-green-700">
                          Menú
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs tabular-nums text-gray-500">
                      {it.costoUnit != null ? (
                        <>
                          {formatARS(it.costoUnit)}
                          <span className="ml-0.5 text-[10px] text-gray-400">
                            {it.unidadCosto}
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
                  TIPO_COLOR[tipoEfectivo(receta)] ?? 'bg-gray-100 text-gray-600',
                )}
              >
                {TIPO_LABEL[tipoEfectivo(receta)] ?? tipoEfectivo(receta)}
              </span>
              {receta.tipo === 'subreceta' && (
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
            <div className="flex items-center gap-2">
              <button
                onClick={() => toggleVendible.mutate(receta)}
                disabled={toggleVendible.isPending}
                title={
                  receta.vendible
                    ? 'Se está proyectando al tab Menú. Click para sacarla.'
                    : 'Marcar vendible: se proyecta al tab Menú para ponerle precio.'
                }
                className={cn(
                  'rounded px-3 py-1.5 text-xs font-medium ring-1 transition-colors disabled:opacity-50',
                  receta.vendible
                    ? 'bg-green-600 text-white ring-green-700 hover:bg-green-700'
                    : 'bg-white text-gray-600 ring-gray-300 hover:bg-gray-50',
                )}
              >
                {receta.vendible ? '✓ Vendible (va al Menú)' : '+ Marcar vendible'}
              </button>
              <button
                onClick={() => setEditando(true)}
                className="rounded bg-rodziny-700 px-3 py-1.5 text-xs text-white hover:bg-rodziny-800"
              >
                ✎ Editar receta
              </button>
            </div>
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

// ─── Panel alta/edición/eliminación de bebida de reventa ───────────────────
function BebidaReventaPanel({
  bebida,
  insumos,
  localRestringido,
  onCancel,
  onSaved,
}: {
  bebida: BebidaReventa | null;
  insumos: InsumoBebida[];
  localRestringido: 'vedia' | 'saavedra' | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const creando = !bebida;
  const [nombre, setNombre] = useState(bebida?.nombre ?? '');
  const [insumoId, setInsumoId] = useState(bebida?.insumo_reventa_id ?? '');
  const [local, setLocal] = useState<'vedia' | 'saavedra'>(
    bebida?.local ?? (localRestringido ?? 'vedia'),
  );
  const [busca, setBusca] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  // Sugerir nombre desde el insumo elegido si todavía no escribieron uno.
  const insumoSel = insumos.find((i) => i.id === insumoId) ?? null;
  useMemo(() => {
    if (creando && !nombre.trim() && insumoSel) setNombre(insumoSel.nombre);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insumoSel?.id]);

  const insumosFiltrados = useMemo(() => {
    let lista = insumos.filter((i) => !i.local || i.local === local);
    if (busca.trim()) {
      const q = busca.toLowerCase();
      lista = lista.filter((i) => i.nombre.toLowerCase().includes(q));
    }
    return lista.slice(0, 50);
  }, [insumos, local, busca]);

  const guardar = async () => {
    if (!nombre.trim()) {
      setError('Cargá un nombre');
      return;
    }
    if (!insumoId) {
      setError('Elegí el insumo de compra');
      return;
    }
    setError('');
    setGuardando(true);
    try {
      if (creando) {
        const { error: errIns } = await supabase.from('cocina_productos').insert({
          nombre: nombre.trim(),
          tipo: 'bebida',
          unidad: 'unid',
          local,
          activo: true,
          insumo_reventa_id: insumoId,
        });
        if (errIns) throw errIns;
      } else {
        const { error: errUpd } = await supabase
          .from('cocina_productos')
          .update({
            nombre: nombre.trim(),
            insumo_reventa_id: insumoId,
          })
          .eq('id', bebida!.id);
        if (errUpd) throw errUpd;
      }
      onSaved();
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : ((err as { message?: string })?.message ?? 'Error desconocido');
      setError(msg);
      setGuardando(false);
    }
  };

  const eliminar = async () => {
    if (!bebida) return;
    if (!confirm(`¿Eliminar "${bebida.nombre}" del Menú y del Costeo?`)) return;
    setError('');
    setGuardando(true);
    try {
      const { error: errDel } = await supabase
        .from('cocina_productos')
        .update({ activo: false })
        .eq('id', bebida.id);
      if (errDel) throw errDel;
      onSaved();
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : ((err as { message?: string })?.message ?? 'Error desconocido');
      setError(msg);
      setGuardando(false);
    }
  };

  return (
    <div className="space-y-4">
      <button
        onClick={onCancel}
        className="text-sm text-rodziny-700 hover:text-rodziny-900"
      >
        ← Volver a recetas
      </button>
      <section className="rounded-lg border border-sky-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-gray-900">
          {creando ? 'Nueva bebida de reventa' : `Editar "${bebida!.nombre}"`}
        </h2>
        <p className="mt-0.5 text-xs text-gray-500">
          Bebida que se compra terminada y se vende sin transformar. El costo sale del{' '}
          <strong>insumo de compra</strong>; va automáticamente al <strong>Menú</strong> para
          que le pongas precio.
        </p>
      </section>

      <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-gray-500">
              Nombre (como va a aparecer en el Menú)
            </label>
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: Pepsi"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
              autoFocus={creando}
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-gray-500">
              Local
            </label>
            <select
              value={local}
              onChange={(e) => setLocal(e.target.value as 'vedia' | 'saavedra')}
              disabled={!!localRestringido || !creando}
              className="w-full rounded border border-gray-300 px-2 py-2 text-sm capitalize disabled:bg-gray-100"
            >
              <option value="vedia">Vedia</option>
              <option value="saavedra">Saavedra</option>
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-gray-500">
            Insumo de compra
          </label>
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar insumo…"
            className="mb-1 w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
          />
          <select
            value={insumoId}
            onChange={(e) => setInsumoId(e.target.value)}
            size={8}
            className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
          >
            <option value="">— elegí un insumo —</option>
            {insumosFiltrados.map((i) => (
              <option key={i.id} value={i.id}>
                {i.nombre}
                {i.costo_unitario != null
                  ? ` — ${formatARS(Number(i.costo_unitario))}/${i.unidad}`
                  : ''}
                {i.local ? ` · ${i.local}` : ''}
              </option>
            ))}
          </select>
          {insumosFiltrados.length === 50 && (
            <p className="mt-1 text-[10px] text-gray-400">
              Mostrando 50 — afiná la búsqueda para ver más.
            </p>
          )}
          {insumoSel && (
            <p className="mt-1 text-[11px] text-gray-600">
              Costo: <strong>{formatARS(Number(insumoSel.costo_unitario ?? 0))}</strong> por{' '}
              {insumoSel.unidad}
            </p>
          )}
        </div>

        {error && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={guardar}
            disabled={guardando}
            className="rounded bg-rodziny-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-rodziny-800 disabled:opacity-50"
          >
            {creando ? 'Crear bebida' : 'Guardar cambios'}
          </button>
          <button
            onClick={onCancel}
            disabled={guardando}
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          {!creando && (
            <button
              onClick={eliminar}
              disabled={guardando}
              className="ml-auto rounded border border-red-300 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Eliminar
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
