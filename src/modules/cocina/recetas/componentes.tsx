/**
 * Los tres pedazos de la vieja pantalla de recetas que siguen en uso:
 * el diálogo para duplicar una receta a otro local, la ficha técnica que se
 * despliega en Productos, y el buscador de ingredientes (productos de Compras
 * + subrecetas) del editor.
 *
 * El resto de `RecetasTab.tsx` —la grilla y el modal de alta— se borró: esa
 * pantalla ya no tiene puerta desde que las recetas viven en Productos.
 */
import { useState, useMemo, useRef, useEffect, Fragment } from 'react';
import { cn, formatARS } from '@/lib/utils';
import type { CostoReceta } from '../hooks/useCostosRecetas';
import {
  CATEGORIA_LABEL,
  ROL_LABEL,
  TIPO_LABEL,
  UNIDAD_LABEL,
  formatCantidad,
  type Ingrediente,
  type ProductoCompras,
  type Receta,
} from './modelo';

export function DialogDuplicar({
  receta,
  onCancelar,
  onConfirmar,
  guardando,
  error,
}: {
  receta: Receta;
  onCancelar: () => void;
  onConfirmar: (nuevoLocal: string, nuevoNombre: string) => void;
  guardando: boolean;
  error: string | null;
}) {
  // Sugerir local opuesto al actual
  const localSugerido = receta.local === 'vedia' ? 'saavedra' : 'vedia';
  const [nuevoLocal, setNuevoLocal] = useState<string>(localSugerido);
  const [nuevoNombre, setNuevoNombre] = useState<string>(receta.nombre);
  const mismoNombre = nuevoNombre.trim() === receta.nombre && nuevoLocal === receta.local;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onCancelar} />
      <div className="relative w-full max-w-md rounded-xl bg-white shadow-xl">
        <div className="border-b border-gray-100 px-5 py-4">
          <h3 className="text-base font-semibold text-gray-900">Duplicar receta</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            Copia "{receta.nombre}" con todos sus ingredientes y parámetros.
          </p>
        </div>
        <div className="space-y-3 px-5 py-4">
          <div>
            <label className="mb-1 block text-xs text-gray-500">Local de destino</label>
            <select
              value={nuevoLocal}
              onChange={(e) => setNuevoLocal(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="vedia">Vedia</option>
              <option value="saavedra">Saavedra</option>
            </select>
            {nuevoLocal === receta.local && (
              <p className="mt-1 text-[10px] text-amber-600">
                Atención: mismo local que el original. El nombre tiene que ser distinto.
              </p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">Nombre de la copia</label>
            <input
              value={nuevoNombre}
              onChange={(e) => setNuevoNombre(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
              placeholder={receta.nombre}
            />
            <p className="mt-1 text-[10px] text-gray-400">
              Podés dejar el mismo nombre si es para otro local (la DB lo permite).
            </p>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">
          <button
            onClick={onCancelar}
            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
          >
            Cancelar
          </button>
          <button
            onClick={() => onConfirmar(nuevoLocal, nuevoNombre.trim() || receta.nombre)}
            disabled={guardando || !nuevoNombre.trim() || mismoNombre}
            className="rounded bg-rodziny-700 px-3 py-1.5 text-sm text-white hover:bg-rodziny-800 disabled:opacity-50"
          >
            {guardando ? 'Duplicando...' : 'Crear copia'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Ficha Técnica (expandible) ─────────────────────────────────────────────
export function FichaTecnica({
  receta,
  ingredientes,
  costo,
}: {
  receta: Receta;
  ingredientes: Ingrediente[];
  costo: CostoReceta | undefined;
}) {
  const pasos = (receta.instrucciones ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const detallePorIng = new Map(costo?.detalles.map((d) => [d.id, d]) ?? []);

  return (
    <div className="space-y-4 py-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Ingredientes con costos */}
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Ingredientes y costeo
          </h4>
          {ingredientes.length === 0 ? (
            <p className="text-xs italic text-gray-400">Sin ingredientes cargados</p>
          ) : (
            <div className="overflow-hidden rounded border border-gray-200 bg-white">
              <table className="w-full text-xs">
                <thead className="bg-gray-50">
                  <tr className="text-gray-500">
                    <th className="px-3 py-1.5 text-left font-medium">Ingrediente</th>
                    <th className="px-3 py-1.5 text-right font-medium">Cantidad</th>
                    <th className="px-3 py-1.5 text-left font-medium">Un.</th>
                    <th className="px-3 py-1.5 text-right font-medium">Costo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {ingredientes.map((ing) => {
                    const det = detallePorIng.get(ing.id);
                    return (
                      <tr key={ing.id}>
                        <td className="px-3 py-1.5 text-gray-800">
                          <div className="flex items-center gap-1.5">
                            {det?.esSubreceta && (
                              <span className="rounded bg-purple-100 px-1 py-0.5 text-[9px] font-medium text-purple-700">
                                Sub
                              </span>
                            )}
                            <span className="font-medium">{ing.nombre}</span>
                          </div>
                          {det?.error && (
                            <div className="mt-0.5 text-[10px] text-amber-600">⚠ {det.error}</div>
                          )}
                          {!det?.error &&
                            det?.productoNombre &&
                            det.productoNombre.toLowerCase() !== ing.nombre.toLowerCase() && (
                              <div className="mt-0.5 text-[10px] text-gray-400">
                                → {det.productoNombre}
                              </div>
                            )}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">
                          {formatCantidad(ing.cantidad)}
                        </td>
                        <td className="px-3 py-1.5 text-gray-500">{ing.unidad}</td>
                        <td className="px-3 py-1.5 text-right font-medium tabular-nums text-gray-800">
                          {det?.costoTotal != null ? (
                            formatARS(det.costoTotal)
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {costo && (
                  <tfoot className="border-t-2 border-gray-200 bg-gray-50">
                    <tr>
                      <td colSpan={3} className="px-3 py-1.5 font-semibold text-gray-700">
                        Costo base
                      </td>
                      <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-gray-800">
                        {formatARS(costo.costoBase)}
                      </td>
                    </tr>
                    {costo.margenPct > 0 && (
                      <>
                        <tr>
                          <td colSpan={3} className="px-3 py-1 text-gray-500">
                            Margen de seguridad ({(costo.margenPct * 100).toFixed(1)}%)
                          </td>
                          <td className="px-3 py-1 text-right tabular-nums text-gray-600">
                            +{formatARS(costo.costoConMargen - costo.costoBase)}
                          </td>
                        </tr>
                        <tr>
                          <td colSpan={3} className="px-3 py-1.5 font-bold text-rodziny-700">
                            Total con margen
                          </td>
                          <td className="px-3 py-1.5 text-right font-bold tabular-nums text-rodziny-700">
                            {formatARS(costo.costoConMargen)}
                          </td>
                        </tr>
                      </>
                    )}
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>

        {/* Procedimiento + Rendimiento + Costo unitario */}
        <div className="space-y-4">
          {/* Rendimiento y costo unitario */}
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Rendimiento
            </h4>
            <div className="flex flex-wrap gap-3">
              {receta.rendimiento_kg != null &&
                (() => {
                  const unidad = UNIDAD_LABEL[receta.rendimiento_unidad ?? 'kg'];
                  const label =
                    receta.rendimiento_unidad === 'unidad' ? 'Rendimiento' : 'Rendimiento total';
                  return (
                    <div className="rounded border border-gray-200 bg-white px-3 py-2 text-center">
                      <div className="text-lg font-bold text-gray-800">
                        {receta.rendimiento_kg} {unidad}
                      </div>
                      <div className="text-[10px] uppercase text-gray-400">{label}</div>
                      {costo?.costoPorKg != null && (
                        <div className="mt-1 text-[11px] font-semibold text-rodziny-700">
                          {formatARS(costo.costoPorKg)}/{unidad}
                        </div>
                      )}
                    </div>
                  );
                })()}
              {receta.rendimiento_porciones != null && (
                <div className="rounded border border-gray-200 bg-white px-3 py-2 text-center">
                  <div className="text-lg font-bold text-gray-800">
                    {receta.rendimiento_porciones}
                  </div>
                  <div className="text-[10px] uppercase text-gray-400">Porciones</div>
                  {costo?.costoPorPorcion != null && (
                    <div className="mt-1 text-[11px] font-semibold text-rodziny-700">
                      {formatARS(costo.costoPorPorcion)}/u
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Procedimiento */}
          {pasos.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Procedimiento
              </h4>
              <ol className="space-y-1.5">
                {pasos.map((paso, i) => (
                  <li key={i} className="flex gap-2 text-xs">
                    <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-rodziny-100 text-[10px] font-bold text-rodziny-700">
                      {i + 1}
                    </span>
                    <span className="leading-relaxed text-gray-700">{paso}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Autocomplete de ingredientes (busca en productos de Compras + recetas) ─
interface OpcionAutocomplete {
  id: string;
  nombre: string;
  unidad: string;
  tipo: 'producto' | 'receta';
  detalle: string; // categoría o tipo de receta
  recetaTipo?: string; // tipo real de la receta (masa/relleno/...) para priorizar
}

export function AutocompleteIngrediente({
  valor,
  productos,
  recetas,
  recetaActualId,
  onChange,
  onSelect,
  tiposPrioritarios,
}: {
  valor: string;
  productos: ProductoCompras[];
  recetas: Receta[];
  recetaActualId: string | null;
  onChange: (v: string) => void;
  onSelect: (p: ProductoCompras, tipo: 'receta' | 'producto') => void;
  // Si se pasa (ej: ['masa','relleno'] para recetas tipo Pasta), esas recetas
  // se muestran primero. El resto sigue listándose y buscándose igual.
  tiposPrioritarios?: string[];
}) {
  const [abierto, setAbierto] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 0,
  });
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Combinar productos + recetas en una sola lista
  const opciones = useMemo(() => {
    const lista: OpcionAutocomplete[] = [];

    // Recetas primero (excluyendo la receta actual para evitar referencia circular)
    for (const r of recetas) {
      if (r.id === recetaActualId) continue;
      // El detalle/recetaTipo prioriza rol (subreceta) o categoria (receta) para
      // que el autocomplete pueda priorizar por rol/categoría (ej: 'masa','relleno').
      const rolOCat = r.rol ?? r.categoria ?? r.tipo;
      const labelDetalle =
        r.tipo === 'subreceta' && r.rol
          ? ROL_LABEL[r.rol]
          : r.tipo === 'receta' && r.categoria
            ? CATEGORIA_LABEL[r.categoria]
            : TIPO_LABEL[r.tipo];
      lista.push({
        id: r.id,
        nombre: r.nombre,
        unidad:
          r.rendimiento_kg != null
            ? r.rendimiento_unidad === 'l'
              ? 'l'
              : r.rendimiento_unidad === 'unidad'
                ? 'unid'
                : 'kg'
            : 'unid',
        tipo: 'receta',
        detalle: labelDetalle,
        recetaTipo: rolOCat,
      });
    }

    // Productos de compras (deduplicar por nombre+marca)
    const vistos = new Set<string>();
    for (const p of productos) {
      const clave = `${p.nombre.toLowerCase()}|${(p.marca ?? '').toLowerCase()}`;
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      lista.push({
        id: p.id,
        nombre: p.marca ? `${p.nombre} ${p.marca}` : p.nombre,
        unidad: p.unidad,
        tipo: 'producto',
        detalle: p.categoria ?? '',
      });
    }

    if (tiposPrioritarios && tiposPrioritarios.length > 0) {
      const prio = new Set(tiposPrioritarios);
      const rank = (o: OpcionAutocomplete) =>
        o.tipo === 'receta' && o.recetaTipo && prio.has(o.recetaTipo)
          ? 0
          : o.tipo === 'receta'
            ? 1
            : 2;
      // sort estable: a igual rank se conserva el orden original
      lista.sort((a, b) => rank(a) - rank(b));
    }

    return lista;
  }, [productos, recetas, recetaActualId, tiposPrioritarios]);

  const filtrados = useMemo(() => {
    if (!valor.trim()) {
      // Sin búsqueda: mostrar recetas primero, luego productos
      const recs = opciones.filter((o) => o.tipo === 'receta').slice(0, 8);
      const prods = opciones.filter((o) => o.tipo === 'producto').slice(0, 10);
      return [...recs, ...prods];
    }
    const q = valor.toLowerCase();
    return opciones.filter((o) => o.nombre.toLowerCase().includes(q)).slice(0, 12);
  }, [valor, opciones]);

  // Cerrar al hacer click afuera
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setAbierto(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Posicionar el dropdown con coordenadas de viewport (para escapar overflow:hidden de contenedores padres)
  // Ancho mínimo 360px así los nombres largos se ven completos; si el input está cerca del borde derecho,
  // se desplaza a la izquierda para no salirse del viewport.
  useEffect(() => {
    if (!abierto) return;
    const update = () => {
      if (!inputRef.current) return;
      const rect = inputRef.current.getBoundingClientRect();
      const width = Math.max(rect.width, 360);
      const maxLeft = window.innerWidth - width - 8;
      const left = Math.max(8, Math.min(rect.left, maxLeft));
      setPos({ top: rect.bottom + 4, left, width });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [abierto]);

  return (
    <div className="relative" ref={ref}>
      <input
        ref={inputRef}
        value={valor}
        onChange={(e) => {
          onChange(e.target.value);
          setAbierto(true);
        }}
        onFocus={() => {
          setFocused(true);
          setAbierto(true);
        }}
        onBlur={() => setFocused(false)}
        placeholder="Buscar ingrediente o subreceta..."
        className={cn(
          'w-full rounded border px-2 py-1 text-sm',
          focused ? 'ring-rodziny-200 border-rodziny-400 ring-1' : 'border-gray-300',
        )}
      />
      {abierto && filtrados.length > 0 && (
        <div
          className="fixed z-[100] max-h-56 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
        >
          {filtrados.map((o, i) => {
            // Separador visual entre recetas y productos
            const prevTipo = i > 0 ? filtrados[i - 1].tipo : null;
            const mostrarSeparador = prevTipo && prevTipo !== o.tipo;
            return (
              <Fragment key={`${o.tipo}-${o.id}`}>
                {mostrarSeparador && <div className="mx-2 border-t border-gray-100" />}
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-rodziny-50"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onSelect(
                      {
                        id: o.id,
                        nombre: o.nombre,
                        marca: null,
                        unidad: o.unidad,
                        categoria: o.detalle,
                        local: null,
                      },
                      o.tipo,
                    );
                    setAbierto(false);
                  }}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {o.tipo === 'receta' && (
                      <span className="flex-shrink-0 rounded bg-purple-100 px-1.5 py-0.5 text-[9px] font-medium text-purple-700">
                        Receta
                      </span>
                    )}
                    <span className="truncate text-gray-800">{o.nombre}</span>
                  </div>
                  <span className="flex-shrink-0 text-[10px] text-gray-400">{o.unidad}</span>
                </button>
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
