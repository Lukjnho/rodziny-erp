import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatARS, cn } from '@/lib/utils';

interface Insumo {
  id: string;
  nombre: string;
  marca: string | null;
  categoria: string;
  unidad: string;
  costo_unitario: number | null;
  merma_pct: number;
  proveedor: string | null;
  stock_actual: number | null;
  activo: boolean;
  local: string | null;
  updated_at: string;
}

type FiltroLocal = 'vedia' | 'saavedra';

export function InsumosTab() {
  const qc = useQueryClient();
  const { perfil } = useAuth();
  const localRestringido = (perfil?.local_restringido ?? null) as 'vedia' | 'saavedra' | null;
  const [busqueda, setBusqueda] = useState('');
  const [filtroCategoria, setFiltroCategoria] = useState<string>('todas');
  const [filtroLocal, setFiltroLocal] = useState<FiltroLocal>(
    (localRestringido as FiltroLocal | null) ?? 'vedia',
  );
  const [edit, setEdit] = useState<{ id: string; field: 'costo' | 'merma'; valor: string } | null>(
    null,
  );

  const { data: insumos } = useQuery({
    queryKey: ['productos-insumos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('productos')
        .select(
          'id, nombre, marca, categoria, unidad, costo_unitario, merma_pct, proveedor, stock_actual, activo, local, updated_at',
        )
        .eq('activo', true)
        .order('nombre');
      if (error) throw error;
      return data as Insumo[];
    },
  });

  const actualizar = useMutation({
    mutationFn: async (payload: { id: string; field: 'costo_unitario' | 'merma_pct'; valor: number }) => {
      const { error } = await supabase
        .from('productos')
        .update({ [payload.field]: payload.valor, updated_at: new Date().toISOString() })
        .eq('id', payload.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['productos-insumos'] });
      qc.invalidateQueries({ queryKey: ['productos-costeo'] });
    },
  });

  const categorias = useMemo(() => {
    const set = new Set<string>();
    for (const i of insumos ?? []) if (i.categoria) set.add(i.categoria);
    return Array.from(set).sort();
  }, [insumos]);

  const filtrados = useMemo(() => {
    let lista = (insumos ?? []).filter((i) => (i.local ?? '') === filtroLocal);
    if (filtroCategoria !== 'todas') lista = lista.filter((i) => i.categoria === filtroCategoria);
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase();
      lista = lista.filter(
        (i) =>
          i.nombre.toLowerCase().includes(q) ||
          (i.marca ?? '').toLowerCase().includes(q) ||
          (i.proveedor ?? '').toLowerCase().includes(q),
      );
    }
    return lista;
  }, [insumos, filtroLocal, filtroCategoria, busqueda]);

  function guardar(id: string, field: 'costo' | 'merma', raw: string) {
    const num = parseFloat(raw.replace(',', '.'));
    if (isNaN(num) || num < 0) {
      setEdit(null);
      return;
    }
    const dbField = field === 'costo' ? 'costo_unitario' : 'merma_pct';
    const valor = field === 'merma' ? num / 100 : num;
    actualizar.mutate({ id, field: dbField, valor });
    setEdit(null);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
        <strong>Insumos = materia prima comprada</strong> (cebollas, harinas, packaging, queso
        sardo, etc.). La <strong>merma</strong> es lo que se pierde al usarlo (ej: cebolla pelada =
        15-20%) y se aplica automáticamente al costear recetas. El <strong>costo unitario</strong>{' '}
        se actualiza al cargar un gasto en <strong>Gastos-Compras → Nuevo gasto</strong>: cuando
        el precio difiere del actual, aparece un aviso inline para confirmar la actualización.</div>

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
          placeholder="Buscar por nombre, marca, proveedor..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="w-64 rounded border border-gray-300 px-3 py-1.5 text-sm"
        />
        <select
          value={filtroCategoria}
          onChange={(e) => setFiltroCategoria(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm"
        >
          <option value="todas">Todas las categorías</option>
          {categorias.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <div className="ml-auto text-xs text-gray-400">
          {filtrados.length} de {insumos?.length ?? 0} insumos
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-[10px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">Insumo</th>
              <th className="px-3 py-2">Local</th>
              <th className="px-3 py-2">Categoría</th>
              <th className="px-3 py-2">Unidad</th>
              <th className="px-3 py-2 text-right">Costo unitario</th>
              <th className="px-3 py-2 text-right">Merma %</th>
              <th className="px-3 py-2 text-right">Costo efectivo</th>
              <th className="px-3 py-2">Proveedor</th>
              <th className="px-3 py-2 text-right">Actualizado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtrados.map((i) => {
              const costo = i.costo_unitario ?? 0;
              const merma = i.merma_pct ?? 0;
              const costoEfectivo = costo * (1 + merma);
              const edCosto = edit?.id === i.id && edit.field === 'costo';
              const edMerma = edit?.id === i.id && edit.field === 'merma';
              return (
                <tr key={i.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <div className="font-medium">{i.nombre}</div>
                    {i.marca && <div className="text-[10px] text-gray-400">{i.marca}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] capitalize text-gray-600">
                      {i.local ?? '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[11px] text-gray-600">{i.categoria}</td>
                  <td className="px-3 py-2 text-[11px] text-gray-500">{i.unidad}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {edCosto ? (
                      <input
                        autoFocus
                        type="number"
                        step="0.01"
                        value={edit.valor}
                        onChange={(e) =>
                          setEdit({ id: i.id, field: 'costo', valor: e.target.value })
                        }
                        onBlur={() => guardar(i.id, 'costo', edit.valor)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') guardar(i.id, 'costo', edit.valor);
                          if (e.key === 'Escape') setEdit(null);
                        }}
                        className="w-24 rounded border border-rodziny-400 px-2 py-0.5 text-right"
                      />
                    ) : (
                      <button
                        onClick={() =>
                          setEdit({ id: i.id, field: 'costo', valor: String(costo) })
                        }
                        className="rounded px-2 py-0.5 text-right hover:bg-rodziny-50"
                      >
                        {costo > 0 ? formatARS(costo) : <span className="text-gray-300">—</span>}
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {edMerma ? (
                      <input
                        autoFocus
                        type="number"
                        step="0.5"
                        value={edit.valor}
                        onChange={(e) =>
                          setEdit({ id: i.id, field: 'merma', valor: e.target.value })
                        }
                        onBlur={() => guardar(i.id, 'merma', edit.valor)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') guardar(i.id, 'merma', edit.valor);
                          if (e.key === 'Escape') setEdit(null);
                        }}
                        className="w-16 rounded border border-rodziny-400 px-2 py-0.5 text-right"
                      />
                    ) : (
                      <button
                        onClick={() =>
                          setEdit({ id: i.id, field: 'merma', valor: (merma * 100).toFixed(1) })
                        }
                        className={cn(
                          'rounded px-2 py-0.5 text-right tabular-nums hover:bg-rodziny-50',
                          merma > 0 ? 'text-amber-700' : 'text-gray-400',
                        )}
                      >
                        {(merma * 100).toFixed(1)}%
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {costo > 0 ? (
                      <span className={merma > 0 ? 'font-medium text-amber-700' : 'text-gray-600'}>
                        {formatARS(costoEfectivo)}
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-[11px] text-gray-500">{i.proveedor ?? '—'}</td>
                  <td className="px-3 py-2 text-right text-[10px] text-gray-400">
                    {new Date(i.updated_at).toLocaleDateString('es-AR')}
                  </td>
                </tr>
              );
            })}
            {filtrados.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-gray-400">
                  Sin insumos
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
