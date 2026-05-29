import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabaseAnon as supabase } from '@/lib/supabaseAnon';
import { normalizarDecimal, parseDecimal } from '@/lib/numero';
import { useCostosRecetas } from '../hooks/useCostosRecetas';

export interface IngredienteReal {
  ing_id: string;
  nombre: string;
  cantidad_receta: number;
  cantidad_real: number;
  unidad: string;
  producto_id: string | null;
}

function formatARS(n: number): string {
  return n.toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  });
}

interface IngredienteRow {
  id: string;
  nombre: string;
  cantidad: number;
  unidad: string;
  producto_id: string | null;
}

interface Props {
  recetaId: string | null;
  onChange: (ingredientes: IngredienteReal[]) => void;
  // Cantidad de recetas que se van a producir. Los ingredientes se pre-llenan
  // multiplicados por este número. Default: 1.
  multiplicador?: number;
  // Callback con el estado de validez: true cuando TODOS los ingredientes están
  // tildados como "pesado y agregado" (o cuando la receta no tiene ingredientes
  // cargados, donde no aplica el checklist).
  onValidezChange?: (todosTildados: boolean) => void;
}

// Lista expandida de ingredientes de la receta seleccionada, con checkbox
// obligatorio por cada uno ("pesado y agregado") y cantidad ajustable.
// El padre se entera vía onValidezChange si TODOS están tildados y puede
// bloquear el submit hasta entonces.
export function IngredientesGrilla({
  recetaId,
  onChange,
  multiplicador = 1,
  onValidezChange,
}: Props) {
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [tildados, setTildados] = useState<Set<string>>(new Set());
  const { costos } = useCostosRecetas();
  const factor = multiplicador > 0 ? multiplicador : 1;

  const { data: ingredientes, isLoading } = useQuery({
    queryKey: ['cocina-receta-ingredientes-grilla', recetaId],
    queryFn: async () => {
      if (!recetaId) return [] as IngredienteRow[];
      const { data, error } = await supabase
        .from('cocina_receta_ingredientes')
        .select('id, nombre, cantidad, unidad, producto_id')
        .eq('receta_id', recetaId)
        .order('orden');
      if (error) throw error;
      return data as IngredienteRow[];
    },
    enabled: !!recetaId,
  });

  // Inicializar cantidades + reset de tildados al cambiar receta o factor.
  useEffect(() => {
    if (ingredientes) {
      const initial: Record<string, string> = {};
      // Default con coma decimal (es-AR) — el input no acepta punto, así que
      // mostrar "0,005" en lugar de "0.005".
      for (const i of ingredientes)
        initial[i.id] = String(+(i.cantidad * factor).toFixed(3)).replace('.', ',');
      setCantidades(initial);
      setTildados(new Set());
    }
  }, [ingredientes, factor]);

  // Emitir al padre ante cada cambio. cantidad_receta refleja el total base
  // (multiplicado por factor) — así lo que se guarda en ingredientes_reales
  // representa lo realmente pedido para ese lote.
  const reales: IngredienteReal[] = useMemo(() => {
    if (!ingredientes) return [];
    return ingredientes.map((i) => ({
      ing_id: i.id,
      nombre: i.nombre,
      cantidad_receta: +(i.cantidad * factor).toFixed(3),
      cantidad_real: parseDecimal(cantidades[i.id]) || i.cantidad * factor,
      unidad: i.unidad,
      producto_id: i.producto_id,
    }));
  }, [ingredientes, cantidades, factor]);

  useEffect(() => {
    onChange(reales);
  }, [reales, onChange]);

  // Avisar al padre del estado de validez. Si no hay ingredientes (receta sin
  // detalle cargado), consideramos válido — no hay nada que tildar.
  const todosTildados = useMemo(() => {
    if (!ingredientes || ingredientes.length === 0) return true;
    return ingredientes.every((i) => tildados.has(i.id));
  }, [ingredientes, tildados]);

  useEffect(() => {
    onValidezChange?.(todosTildados);
  }, [todosTildados, onValidezChange]);

  // Costos por ingrediente — escalar según ratio cantidad_real/cantidad_receta
  const costoReceta = recetaId ? costos.get(recetaId) : null;
  const costoPorIng = useMemo(() => {
    const m = new Map<string, number>();
    if (!costoReceta) return m;
    for (const d of costoReceta.detalles) {
      if (d.costoTotal != null) m.set(d.id, d.costoTotal);
    }
    return m;
  }, [costoReceta]);

  const costoBaseTotal = useMemo(() => {
    if (!costoReceta) return null;
    return costoReceta.costoBase * factor;
  }, [costoReceta, factor]);

  const costoAjustadoTotal = useMemo(() => {
    if (!ingredientes || !costoReceta) return null;
    let total = 0;
    for (const i of ingredientes) {
      const base = costoPorIng.get(i.id) ?? 0;
      const real = parseDecimal(cantidades[i.id]) || i.cantidad * factor;
      const ratio = i.cantidad > 0 ? real / i.cantidad : 1;
      total += base * ratio;
    }
    return total;
  }, [ingredientes, cantidades, costoPorIng, costoReceta, factor]);

  if (!recetaId) return null;
  if (isLoading) return <p className="text-[10px] text-gray-400">Cargando ingredientes…</p>;
  if (!ingredientes || ingredientes.length === 0) return null;

  // Detectar si alguna cantidad fue modificada vs el default (receta × factor)
  const ajustados = reales.filter(
    (r) => Math.abs(r.cantidad_real - r.cantidad_receta) > 0.001,
  ).length;
  const hayAjuste =
    ajustados > 0 &&
    costoAjustadoTotal != null &&
    costoBaseTotal != null &&
    Math.abs(costoAjustadoTotal - costoBaseTotal) > 1;

  const total = ingredientes.length;
  const cuenta = ingredientes.filter((i) => tildados.has(i.id)).length;

  const toggleTodos = () => {
    if (cuenta === total) {
      setTildados(new Set());
    } else {
      setTildados(new Set(ingredientes.map((i) => i.id)));
    }
  };

  return (
    <div
      className={
        'rounded-lg border bg-white ' +
        (todosTildados ? 'border-emerald-300' : 'border-amber-300')
      }
    >
      <div className={'flex items-center justify-between px-3 py-2 ' + (todosTildados ? 'bg-emerald-50' : 'bg-amber-50')}>
        <div className="flex-1">
          <p className="text-xs font-semibold text-gray-800">
            Ingredientes ({cuenta} de {total} pesados)
            {todosTildados && <span className="ml-2 text-emerald-700">✓ Listo</span>}
          </p>
          <p className="text-[10px] text-gray-600">
            Tildá cada ingrediente a medida que lo pesás y agregás.
            {factor > 1 && ` Cantidades × ${factor} recetas.`}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {costoAjustadoTotal != null && costoAjustadoTotal > 0 && (
            <div className="text-right">
              <p
                className={
                  'text-xs font-semibold ' + (hayAjuste ? 'text-amber-700' : 'text-emerald-700')
                }
              >
                {formatARS(costoAjustadoTotal)}
              </p>
              {hayAjuste && costoBaseTotal != null && (
                <p className="text-[9px] text-gray-400">base: {formatARS(costoBaseTotal)}</p>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={toggleTodos}
            className="text-[10px] text-rodziny-700 underline hover:text-rodziny-800"
          >
            {cuenta === total ? 'Destildar todos' : 'Tildar todos'}
          </button>
        </div>
      </div>

      <div className="max-h-72 space-y-1.5 overflow-y-auto p-2">
        {ingredientes.map((i) => {
          const esperado = +(i.cantidad * factor).toFixed(3);
          const raw = cantidades[i.id] ?? String(esperado).replace('.', ',');
          const realNum = parseDecimal(raw);
          const ajustado = realNum > 0 && Math.abs(realNum - esperado) > 0.001;
          const costoBaseIng = costoPorIng.get(i.id) ?? null;
          const ratio = i.cantidad > 0 && realNum > 0 ? realNum / i.cantidad : 1;
          const costoIng = costoBaseIng != null ? costoBaseIng * ratio : null;
          const tildado = tildados.has(i.id);
          return (
            <label
              key={i.id}
              className={
                'flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5 transition-colors ' +
                (tildado ? 'border-emerald-200 bg-emerald-50' : 'border-gray-200 bg-white hover:bg-gray-50')
              }
            >
              <input
                type="checkbox"
                checked={tildado}
                onChange={(e) =>
                  setTildados((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(i.id);
                    else next.delete(i.id);
                    return next;
                  })
                }
                className="h-4 w-4 cursor-pointer accent-emerald-600"
              />
              <span
                className={
                  'flex-1 truncate text-xs ' +
                  (ajustado ? 'font-medium text-amber-700' : tildado ? 'text-gray-800' : 'text-gray-700')
                }
              >
                {i.nombre}
              </span>
              <input
                type="text"
                inputMode="decimal"
                pattern="[0-9]*[.,]?[0-9]*"
                value={raw}
                onChange={(e) =>
                  setCantidades((prev) => ({
                    ...prev,
                    [i.id]: normalizarDecimal(e.target.value),
                  }))
                }
                onClick={(e) => e.stopPropagation()}
                className={
                  'w-20 rounded border px-2 py-1 text-right text-xs ' +
                  (ajustado ? 'border-amber-400 bg-amber-50' : 'border-gray-300 bg-white')
                }
              />
              <span className="w-8 text-[10px] text-gray-500">{i.unidad}</span>
              <span className="w-14 text-right text-[10px] tabular-nums text-gray-500">
                {costoIng != null ? formatARS(costoIng) : '—'}
              </span>
            </label>
          );
        })}
        <div className="flex justify-between pt-1 text-[10px] text-gray-400">
          <span>{factor > 1 ? `Base × ${factor} recetas` : 'Base de la receta'}</span>
          <button
            type="button"
            onClick={() => {
              const reset: Record<string, string> = {};
              for (const i of ingredientes)
                reset[i.id] = String(+(i.cantidad * factor).toFixed(3)).replace('.', ',');
              setCantidades(reset);
            }}
            className="underline hover:text-gray-700"
          >
            Resetear cantidades
          </button>
        </div>
      </div>
    </div>
  );
}
