import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import type { CategoriaGasto, TipoEdr } from './types';

const TIPOS_EDR: { value: TipoEdr; label: string; color: string }[] = [
  { value: 'cmv_alimentos', label: 'CMV Alimentos', color: 'bg-amber-100 text-amber-800' },
  { value: 'cmv_bebidas', label: 'CMV Bebidas', color: 'bg-blue-100 text-blue-800' },
  { value: 'cmv_indirectos', label: 'CMV Indirectos', color: 'bg-purple-100 text-purple-800' },
  { value: 'sueldos', label: 'Sueldos', color: 'bg-green-100 text-green-800' },
  { value: 'cargas_sociales', label: 'Cargas Sociales', color: 'bg-emerald-100 text-emerald-800' },
  { value: 'gastos_rrhh', label: 'Gastos RRHH', color: 'bg-teal-100 text-teal-800' },
  { value: 'gastos_op', label: 'Gastos Operativos', color: 'bg-cyan-100 text-cyan-800' },
  { value: 'impuestos_op', label: 'Impuestos', color: 'bg-red-100 text-red-800' },
  { value: 'intereses', label: 'Intereses/Comisiones', color: 'bg-orange-100 text-orange-800' },
  { value: 'inversiones', label: 'Inversiones', color: 'bg-indigo-100 text-indigo-800' },
  { value: 'otros', label: 'Otros', color: 'bg-gray-100 text-gray-700' },
];

const FORM_VACIO: Partial<CategoriaGasto> = {
  nombre: '',
  parent_id: null,
  tipo_edr: 'gastos_op',
  activo: true,
  orden: 100,
};

export function CategoriasPanel() {
  const qc = useQueryClient();
  const [editando, setEditando] = useState<Partial<CategoriaGasto> | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: categorias } = useQuery({
    queryKey: ['categorias_gasto'],
    queryFn: async () => {
      const { data, error } = await supabase.from('categorias_gasto').select('*').order('orden');
      if (error) throw error;
      return (data ?? []) as CategoriaGasto[];
    },
  });

  const padres = useMemo(() => (categorias ?? []).filter((c) => c.parent_id == null), [categorias]);
  const hijosPorPadre = useMemo(() => {
    const m = new Map<string, CategoriaGasto[]>();
    for (const c of categorias ?? []) {
      if (c.parent_id) {
        if (!m.has(c.parent_id)) m.set(c.parent_id, []);
        m.get(c.parent_id)!.push(c);
      }
    }
    return m;
  }, [categorias]);

  async function guardar() {
    if (!editando) return;
    setError(null);
    if (!editando.nombre?.trim()) {
      setError('Nombre requerido');
      return;
    }
    setGuardando(true);
    try {
      // Si tiene padre, hereda tipo_edr del padre por default si no se cambió
      let tipo = editando.tipo_edr ?? 'otros';
      if (editando.parent_id) {
        const padre = (categorias ?? []).find((c) => c.id === editando.parent_id);
        if (padre && !editando.tipo_edr) tipo = padre.tipo_edr;
      }
      const payload = {
        nombre: editando.nombre.trim(),
        parent_id: editando.parent_id ?? null,
        tipo_edr: tipo,
        activo: editando.activo ?? true,
        orden: editando.orden ?? 100,
      };
      let res;
      if (editando.id) {
        res = await supabase.from('categorias_gasto').update(payload).eq('id', editando.id);
      } else {
        res = await supabase.from('categorias_gasto').insert(payload);
      }
      if (res.error) throw res.error;
      qc.invalidateQueries({ queryKey: ['categorias_gasto'] });
      qc.invalidateQueries({ queryKey: ['categorias_gasto_activas'] });
      setEditando(null);
    } catch (e: any) {
      setError(e.message ?? 'Error al guardar');
    } finally {
      setGuardando(false);
    }
  }

  async function toggleActivo(c: CategoriaGasto) {
    await supabase.from('categorias_gasto').update({ activo: !c.activo }).eq('id', c.id);
    qc.invalidateQueries({ queryKey: ['categorias_gasto'] });
    qc.invalidateQueries({ queryKey: ['categorias_gasto_activas'] });
  }

  function nuevaSubcat(padreId: string) {
    const padre = (categorias ?? []).find((c) => c.id === padreId);
    setEditando({
      ...FORM_VACIO,
      parent_id: padreId,
      tipo_edr: padre?.tipo_edr ?? 'gastos_op',
      orden: ((hijosPorPadre.get(padreId)?.length ?? 0) + 1) * 1 + (padre?.orden ?? 0) * 10,
    });
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs text-gray-500">
          La jerarquía es <strong>Categoría → Subcategoría</strong>. Al cargar un gasto se elige la{' '}
          <strong>subcategoría</strong> y el sistema sabe a qué línea del Estado de Resultados va.
        </p>
        <button
          onClick={() => setEditando({ ...FORM_VACIO })}
          className="rounded-md bg-rodziny-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-rodziny-800"
        >
          + Nueva categoría
        </button>
      </div>

      <div className="space-y-3">
        {padres.map((padre) => {
          const hijos = hijosPorPadre.get(padre.id) ?? [];
          const tipo = TIPOS_EDR.find((t) => t.value === padre.tipo_edr);
          return (
            <div
              key={padre.id}
              className="overflow-hidden rounded-lg border border-surface-border bg-white"
            >
              <div className="flex items-center justify-between bg-gray-900 px-4 py-2.5 text-white">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{padre.nombre}</span>
                  {tipo && (
                    <span
                      className={cn(
                        'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase',
                        tipo.color,
                      )}
                    >
                      {tipo.label}
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => nuevaSubcat(padre.id)}
                    className="text-rodziny-200 text-[11px] hover:text-white"
                  >
                    + Subcat
                  </button>
                  <button
                    onClick={() => setEditando({ ...padre })}
                    className="text-[11px] text-gray-300 hover:text-white"
                  >
                    Editar
                  </button>
                </div>
              </div>
              {hijos.length === 0 ? (
                <div className="px-4 py-3 text-xs italic text-gray-400">Sin subcategorías</div>
              ) : (
                <table className="w-full text-xs">
                  <tbody>
                    {hijos.map((h) => {
                      const tipoH = TIPOS_EDR.find((t) => t.value === h.tipo_edr);
                      return (
                        <tr key={h.id} className="border-t border-gray-100 hover:bg-gray-50">
                          <td className="px-4 py-1.5 pl-8 text-gray-800">
                            <span className="mr-2 text-gray-300">└</span>
                            {h.nombre}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            {tipoH && tipoH.value !== padre.tipo_edr && (
                              <span
                                className={cn(
                                  'rounded px-1.5 py-0.5 text-[9px] font-medium',
                                  tipoH.color,
                                )}
                              >
                                {tipoH.label}
                              </span>
                            )}
                          </td>
                          <td className="w-16 px-3 py-1.5 text-center">
                            <button
                              onClick={() => toggleActivo(h)}
                              className={cn(
                                'relative inline-flex h-4 w-8 items-center rounded-full transition-colors',
                                h.activo ? 'bg-rodziny-600' : 'bg-gray-300',
                              )}
                            >
                              <span
                                className={cn(
                                  'inline-block h-3 w-3 transform rounded-full bg-white transition-transform',
                                  h.activo ? 'translate-x-4' : 'translate-x-1',
                                )}
                              />
                            </button>
                          </td>
                          <td className="w-16 px-3 py-1.5 text-right">
                            <button
                              onClick={() => setEditando({ ...h })}
                              className="text-[11px] text-rodziny-700 hover:underline"
                            >
                              Editar
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>

      {/* Modal edición */}
      {editando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <h3 className="font-semibold text-gray-900">
                {editando.id ? 'Editar' : 'Nueva'}{' '}
                {editando.parent_id ? 'subcategoría' : 'categoría'}
              </h3>
              <button
                onClick={() => setEditando(null)}
                className="text-xl leading-none text-gray-400 hover:text-gray-600"
              >
                ×
              </button>
            </div>
            <div className="space-y-3 p-5">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Nombre *</label>
                <input
                  value={editando.nombre ?? ''}
                  onChange={(e) => setEditando({ ...editando, nombre: e.target.value })}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Categoría padre
                </label>
                <select
                  value={editando.parent_id ?? ''}
                  onChange={(e) => setEditando({ ...editando, parent_id: e.target.value || null })}
                  className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">— Es categoría raíz —</option>
                  {padres
                    .filter((p) => p.id !== editando.id)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Tipo EdR *</label>
                <select
                  value={editando.tipo_edr ?? 'gastos_op'}
                  onChange={(e) =>
                    setEditando({ ...editando, tipo_edr: e.target.value as TipoEdr })
                  }
                  className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm"
                >
                  {TIPOS_EDR.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[10px] text-gray-400">
                  A qué línea del EdR suma. Las subcat heredan del padre por default.
                </p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Orden de visualización
                </label>
                <input
                  type="number"
                  value={editando.orden ?? 100}
                  onChange={(e) =>
                    setEditando({ ...editando, orden: parseInt(e.target.value) || 100 })
                  }
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                />
              </div>

              {error && (
                <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-3">
              <button
                onClick={() => setEditando(null)}
                disabled={guardando}
                className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={guardar}
                disabled={guardando}
                className="rounded bg-rodziny-700 px-4 py-2 text-sm font-medium text-white hover:bg-rodziny-800 disabled:bg-gray-300"
              >
                {guardando ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
