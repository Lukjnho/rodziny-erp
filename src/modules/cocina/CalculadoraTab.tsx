import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { LocalSelector } from '@/components/ui/LocalSelector';
import { formatNum, parseDecimal, normalizarDecimal } from '@/lib/numero';
import type { Receta, Ingrediente } from './RecetasTab';

// ── Calculadora / planificador de recetas ────────────────────────────────────
// Herramienta de REFERENCIA (read-only, no toca stock ni guarda nada).
// Armás una lista de subrecetas con su multiplicador (ej. ×5 Scarparo Base +
// ×5 Bolognesa) y te dice la materia prima total que hace falta para esa tanda.
// Si una subreceta usa otra (Pomodoro dentro de Amatriciana), la explota hasta
// materia prima real. La "lista de compra" suma todo el plan.

const MAX_PROFUNDIDAD = 6; // corta anidamientos cíclicos por las dudas

// Un nodo del árbol de explosión de una subreceta.
interface NodoInsumo {
  clave: string; // producto_id ?? nombre normalizado — para consolidar
  nombre: string;
  cantidad: number;
  unidad: string;
  esSubreceta: boolean; // true → subreceta anidada (tiene hijos)
  expandida: boolean; // subreceta que se pudo bajar a materia prima
  hijos: NodoInsumo[];
}

// Un renglón del plan de producción.
interface ItemPlan {
  key: number;
  subrecetaId: string;
  multStr: string;
}

function normNombre(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// ¿El ingrediente es una subreceta anidada? Convención del ERP: nombre con
// prefijo "Subreceta " y sin producto_id (no engancha a un insumo real).
function esIngredienteSubreceta(ing: Ingrediente): boolean {
  return ing.producto_id == null && /^subreceta\s+/i.test(ing.nombre);
}

export function CalculadoraTab() {
  const [local, setLocal] = useState<'vedia' | 'saavedra'>('saavedra');
  const [busqueda, setBusqueda] = useState('');
  const [seleccionId, setSeleccionId] = useState<string | null>(null);
  const [multStr, setMultStr] = useState('1');
  const [plan, setPlan] = useState<ItemPlan[]>([]);
  const [expandido, setExpandido] = useState<number | null>(null);
  const nextKey = useRef(1);

  // Todas las recetas (necesito TODAS para resolver subrecetas anidadas).
  const { data: recetas, isLoading: cargandoRecetas } = useQuery({
    queryKey: ['calculadora-recetas'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cocina_recetas').select('*').order('nombre');
      if (error) throw error;
      return data as Receta[];
    },
    refetchOnMount: 'always',
  });

  const { data: ingredientes, isLoading: cargandoIngredientes } = useQuery({
    queryKey: ['calculadora-ingredientes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_receta_ingredientes')
        .select('*')
        .order('orden');
      if (error) throw error;
      return data as Ingrediente[];
    },
    refetchOnMount: 'always',
  });

  // Índices para el cálculo.
  const recetaPorId = useMemo(() => {
    const m = new Map<string, Receta>();
    for (const r of recetas ?? []) m.set(r.id, r);
    return m;
  }, [recetas]);

  const ingredientesPorReceta = useMemo(() => {
    const mapa = new Map<string, Ingrediente[]>();
    for (const ing of ingredientes ?? []) {
      const arr = mapa.get(ing.receta_id) ?? [];
      arr.push(ing);
      mapa.set(ing.receta_id, arr);
    }
    return mapa;
  }, [ingredientes]);

  // Lookup de subreceta por nombre (para resolver anidadas). Prefiere activa.
  const subrecetaPorNombre = useMemo(() => {
    const mapa = new Map<string, Receta>();
    for (const r of recetas ?? []) {
      if (r.tipo !== 'subreceta') continue;
      const clave = normNombre(r.nombre);
      const previa = mapa.get(clave);
      if (!previa || (!previa.activo && r.activo)) mapa.set(clave, r);
    }
    return mapa;
  }, [recetas]);

  // Explosión recursiva: insumos de `recetaId` escalados por `factor`.
  const explotar = useMemo(() => {
    function fn(recetaId: string, factor: number, profundidad: number): NodoInsumo[] {
      if (profundidad > MAX_PROFUNDIDAD) return [];
      const ings = ingredientesPorReceta.get(recetaId) ?? [];
      return ings.map((ing) => {
        const cantidad = (Number(ing.cantidad) || 0) * factor;

        if (!esIngredienteSubreceta(ing)) {
          return {
            clave: ing.producto_id ?? normNombre(ing.nombre),
            nombre: ing.nombre,
            cantidad,
            unidad: ing.unidad || 'kg',
            esSubreceta: false,
            expandida: false,
            hijos: [],
          };
        }

        const nombreSub = ing.nombre.replace(/^subreceta\s+/i, '').trim();
        const sub = subrecetaPorNombre.get(normNombre(nombreSub));
        const rinde = sub ? Number(sub.rendimiento_kg) || 0 : 0;

        if (sub && rinde > 0) {
          const subFactor = cantidad / rinde;
          return {
            clave: normNombre(nombreSub),
            nombre: nombreSub,
            cantidad,
            unidad: ing.unidad || sub.rendimiento_unidad || 'kg',
            esSubreceta: true,
            expandida: true,
            hijos: fn(sub.id, subFactor, profundidad + 1),
          };
        }

        return {
          clave: normNombre(nombreSub),
          nombre: nombreSub,
          cantidad,
          unidad: ing.unidad || 'kg',
          esSubreceta: true,
          expandida: false,
          hijos: [],
        };
      });
    }
    return fn;
  }, [ingredientesPorReceta, subrecetaPorNombre]);

  // Subrecetas elegibles en el selector.
  const subrecetasDelLocal = useMemo(() => {
    const q = normNombre(busqueda);
    return (recetas ?? [])
      .filter(
        (r) =>
          r.tipo === 'subreceta' &&
          r.activo &&
          r.local === local &&
          r.nombre.trim() !== '' &&
          r.nombre.trim() !== '.',
      )
      .filter((r) => (q ? normNombre(r.nombre).includes(q) : true))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }, [recetas, local, busqueda]);

  const seleccion = seleccionId ? recetaPorId.get(seleccionId) : null;

  function agregar() {
    if (!seleccionId) return;
    setPlan((prev) => [...prev, { key: nextKey.current++, subrecetaId: seleccionId, multStr }]);
  }

  function quitar(key: number) {
    setPlan((prev) => prev.filter((i) => i.key !== key));
    setExpandido((e) => (e === key ? null : e));
  }

  function editarMult(key: number, valor: string) {
    setPlan((prev) => prev.map((i) => (i.key === key ? { ...i, multStr: valor } : i)));
  }

  // Cálculo por item del plan (árbol + rinde).
  const planCalculado = useMemo(() => {
    return plan.map((item) => {
      const sub = recetaPorId.get(item.subrecetaId);
      const mult = parseDecimal(item.multStr);
      const arbol = sub ? explotar(sub.id, mult, 0) : [];
      const rindeBase = sub ? Number(sub.rendimiento_kg) || 0 : 0;
      return { item, sub, mult, arbol, rindeBase };
    });
  }, [plan, recetaPorId, explotar]);

  const cargando = cargandoRecetas || cargandoIngredientes;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      {/* ══ Columna izquierda: agregar al plan ══ */}
      <div className="space-y-4">
        <div className="rounded-lg border border-surface-border bg-white p-4">
          <h3 className="mb-3 text-sm font-bold text-gray-700">Agregar subreceta al plan</h3>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <LocalSelector
              value={local}
              onChange={(v) => {
                setLocal(v as 'vedia' | 'saavedra');
                setSeleccionId(null);
              }}
            />
            <input
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar…"
              className="min-w-[140px] flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-rodziny-500 focus:outline-none"
            />
          </div>

          {cargando ? (
            <p className="py-6 text-center text-sm text-gray-400">Cargando recetas…</p>
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-md border border-gray-100">
              {subrecetasDelLocal.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-400">Sin coincidencias.</p>
              ) : (
                subrecetasDelLocal.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setSeleccionId(r.id)}
                    className={cn(
                      'flex w-full items-center justify-between border-b border-gray-50 px-3 py-2 text-left text-sm transition-colors last:border-b-0',
                      r.id === seleccionId
                        ? 'bg-rodziny-50 font-medium text-rodziny-800'
                        : 'hover:bg-gray-50',
                    )}
                  >
                    <span>{r.nombre}</span>
                    <span className="whitespace-nowrap text-xs text-gray-400">
                      {r.rendimiento_kg
                        ? `${formatNum(Number(r.rendimiento_kg))} ${r.rendimiento_unidad}`
                        : r.rendimiento_porciones
                          ? `${formatNum(Number(r.rendimiento_porciones))} porc.`
                          : 'sin rinde'}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}

          {/* Multiplicador + botón agregar */}
          <div className="mt-3 flex items-center gap-2">
            <span className="text-sm text-gray-600">×</span>
            <input
              type="text"
              inputMode="decimal"
              value={multStr}
              onChange={(e) => setMultStr(normalizarDecimal(e.target.value))}
              className="w-20 rounded-md border border-gray-300 px-3 py-1.5 text-right text-lg font-semibold focus:border-rodziny-500 focus:outline-none"
            />
            <button
              onClick={agregar}
              disabled={!seleccion}
              className="flex-1 rounded-md bg-rodziny-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rodziny-800 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {seleccion ? `Agregar ${seleccion.nombre}` : 'Elegí una subreceta'}
            </button>
          </div>
        </div>
      </div>

      {/* ══ Columna derecha: plan + lista de compra ══ */}
      <div className="space-y-4">
        {/* Plan de producción */}
        <div className="rounded-lg border border-surface-border bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-700">Plan de producción</h3>
            {plan.length > 0 && (
              <button
                onClick={() => {
                  setPlan([]);
                  setExpandido(null);
                }}
                className="text-xs text-gray-400 hover:text-red-500"
              >
                Vaciar
              </button>
            )}
          </div>

          {plan.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400">
              Agregá subrecetas (ej. ×5 Scarparo Base + ×5 Bolognesa) para ver la materia prima
              total.
            </p>
          ) : (
            <div className="space-y-1">
              {planCalculado.map(({ item, sub, mult, arbol, rindeBase }) => (
                <div key={item.key} className="rounded-md border border-gray-100">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <span className="text-sm text-gray-500">×</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={item.multStr}
                      onChange={(e) => editarMult(item.key, normalizarDecimal(e.target.value))}
                      className="w-14 rounded border border-gray-200 px-2 py-1 text-right text-sm font-semibold focus:border-rodziny-500 focus:outline-none"
                    />
                    <span className="flex-1 text-sm font-medium text-gray-800">
                      {sub?.nombre ?? '—'}
                    </span>
                    {rindeBase > 0 && (
                      <span className="whitespace-nowrap text-xs text-gray-400">
                        = {formatNum(rindeBase * mult)} {sub?.rendimiento_unidad}
                      </span>
                    )}
                    <button
                      onClick={() => setExpandido((e) => (e === item.key ? null : item.key))}
                      className="px-1 text-gray-400 hover:text-gray-700"
                      title="Ver insumos de este ítem"
                    >
                      {expandido === item.key ? '▾' : '▸'}
                    </button>
                    <button
                      onClick={() => quitar(item.key)}
                      className="px-1 text-gray-400 hover:text-red-500"
                      title="Quitar"
                    >
                      ✕
                    </button>
                  </div>
                  {expandido === item.key && arbol.length > 0 && (
                    <div className="border-t border-gray-100 bg-gray-50/50">
                      {arbol.map((n, i) => (
                        <FilaNodo key={`${n.clave}-${i}`} nodo={n} nivel={0} />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Fila del árbol de un ítem. Subrecetas anidadas resaltadas con hijos indentados.
function FilaNodo({ nodo, nivel }: { nodo: NodoInsumo; nivel: number }) {
  const esSubExpandida = nodo.esSubreceta && nodo.expandida;
  return (
    <>
      <div
        className="flex items-center justify-between border-b border-gray-50 px-3 py-1.5 text-sm last:border-b-0"
        style={{ paddingLeft: `${12 + nivel * 20}px` }}
      >
        <span className={cn(nodo.esSubreceta ? 'font-medium text-purple-800' : 'text-gray-600')}>
          {nodo.esSubreceta && '↳ '}
          {nodo.nombre}
          {nodo.esSubreceta && !nodo.expandida && (
            <span className="ml-2 text-xs font-normal text-amber-600">(no se pudo expandir)</span>
          )}
        </span>
        <span
          className={cn(
            'whitespace-nowrap font-semibold',
            nodo.esSubreceta ? 'text-purple-800' : 'text-gray-700',
          )}
        >
          {formatNum(nodo.cantidad)} {nodo.unidad}
        </span>
      </div>
      {esSubExpandida &&
        nodo.hijos.map((h, i) => <FilaNodo key={`${h.clave}-${i}`} nodo={h} nivel={nivel + 1} />)}
    </>
  );
}
