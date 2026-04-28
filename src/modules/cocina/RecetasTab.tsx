import { useState, useMemo, useRef, useEffect, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { KPICard } from '@/components/ui/KPICard';
import { cn, formatARS } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { useCostosRecetas, type CostoReceta } from './hooks/useCostosRecetas';

interface Ingrediente {
  id: string;
  receta_id: string;
  nombre: string;
  cantidad: number;
  unidad: string;
  observaciones: string | null;
  orden: number;
  producto_id: string | null;
}

type RendUnidad = 'kg' | 'l' | 'unidad';

interface Receta {
  id: string;
  nombre: string;
  tipo: 'relleno' | 'masa' | 'salsa' | 'subreceta' | 'otro';
  rendimiento_kg: number | null;
  rendimiento_unidad: RendUnidad;
  rendimiento_porciones: number | null;
  instrucciones: string | null;
  activo: boolean;
  margen_seguridad_pct: number | null;
  local: string | null;
  gramos_por_porcion: number | null;
  fudo_productos: string[] | null;
  created_at: string;
}

const UNIDAD_LABEL: Record<RendUnidad, string> = {
  kg: 'kg',
  l: 'L',
  unidad: 'unid.',
};

const TIPOS = [
  'relleno',
  'masa',
  'salsa',
  'postre',
  'pasteleria',
  'panaderia',
  'subreceta',
  'otro',
] as const;
const TIPO_LABEL: Record<string, string> = {
  relleno: 'Relleno',
  masa: 'Masa',
  salsa: 'Salsa',
  postre: 'Postre',
  pasteleria: 'Pastelería',
  panaderia: 'Panadería',
  subreceta: 'Subreceta',
  otro: 'Otro',
};
const TIPO_COLOR: Record<string, string> = {
  relleno: 'bg-green-100 text-green-700',
  masa: 'bg-blue-100 text-blue-700',
  salsa: 'bg-orange-100 text-orange-700',
  postre: 'bg-pink-100 text-pink-700',
  pasteleria: 'bg-yellow-100 text-yellow-700',
  panaderia: 'bg-amber-100 text-amber-700',
  subreceta: 'bg-purple-100 text-purple-700',
  otro: 'bg-gray-100 text-gray-700',
};

const UNIDADES = ['g', 'kg', 'ml', 'lt', 'unid', 'cdta', 'cda'] as const;

export function RecetasTab() {
  const qc = useQueryClient();
  const { perfil } = useAuth();
  const localRestringido = perfil?.local_restringido ?? null;
  const [busqueda, setBusqueda] = useState('');
  const [filtroTipo, setFiltroTipo] = useState<string>('todos');
  const [filtroLocal, setFiltroLocal] = useState<string>(localRestringido ?? 'todos');
  useEffect(() => {
    if (localRestringido && filtroLocal !== localRestringido) setFiltroLocal(localRestringido);
  }, [localRestringido, filtroLocal]);
  const [filtroActivo, setFiltroActivo] = useState<'activas' | 'inactivas' | 'todas'>('activas');
  const [filtroAdvertencia, setFiltroAdvertencia] = useState<'todas' | 'con_adv' | 'sin_adv'>(
    'todas',
  );
  const [filtroCosteo, setFiltroCosteo] = useState<'todos' | 'con_costeo' | 'sin_match'>('todos');
  const [modalAbierto, setModalAbierto] = useState(false);
  const [editando, setEditando] = useState<Receta | null>(null);
  const [duplicando, setDuplicando] = useState<Receta | null>(null);
  const [fichaAbierta, setFichaAbierta] = useState<string | null>(null); // receta_id expandida

  const { data: recetas, isLoading } = useQuery({
    queryKey: ['cocina-recetas'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cocina_recetas').select('*').order('nombre');
      if (error) throw error;
      return data as Receta[];
    },
  });

  const { costos } = useCostosRecetas();

  // Ingredientes de todas las recetas (para mostrar en fichas expandidas)
  const { data: todosIngredientes } = useQuery({
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

  const ingredientesPorReceta = useMemo(() => {
    const mapa = new Map<string, Ingrediente[]>();
    for (const ing of todosIngredientes ?? []) {
      if (!mapa.has(ing.receta_id)) mapa.set(ing.receta_id, []);
      mapa.get(ing.receta_id)!.push(ing);
    }
    return mapa;
  }, [todosIngredientes]);

  const filtrados = useMemo(() => {
    let lista = recetas ?? [];
    if (filtroTipo !== 'todos') lista = lista.filter((r) => r.tipo === filtroTipo);
    if (filtroLocal === 'vedia') lista = lista.filter((r) => r.local === 'vedia');
    else if (filtroLocal === 'saavedra') lista = lista.filter((r) => r.local === 'saavedra');
    if (filtroActivo === 'activas') lista = lista.filter((r) => r.activo);
    else if (filtroActivo === 'inactivas') lista = lista.filter((r) => !r.activo);
    if (filtroAdvertencia === 'con_adv') {
      lista = lista.filter((r) => {
        const c = costos.get(r.id);
        return !!c && c.advertencias.length > 0;
      });
    } else if (filtroAdvertencia === 'sin_adv') {
      lista = lista.filter((r) => {
        const c = costos.get(r.id);
        return !c || c.advertencias.length === 0;
      });
    }
    if (filtroCosteo === 'con_costeo') {
      lista = lista.filter((r) => {
        const c = costos.get(r.id);
        return !!c && c.costoBase > 0;
      });
    } else if (filtroCosteo === 'sin_match') {
      // mismo criterio que el KPI "Sin match": tiene ingredientes pero costoBase no es > 0
      lista = lista.filter((r) => {
        const c = costos.get(r.id);
        const tieneIngs = (ingredientesPorReceta.get(r.id)?.length ?? 0) > 0;
        return tieneIngs && (!c || c.costoBase <= 0);
      });
    }
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase();
      lista = lista.filter((r) => r.nombre.toLowerCase().includes(q));
    }
    return lista;
  }, [
    recetas,
    filtroTipo,
    filtroLocal,
    filtroActivo,
    filtroAdvertencia,
    filtroCosteo,
    busqueda,
    costos,
    ingredientesPorReceta,
  ]);

  const kpis = useMemo(() => {
    let all = recetas ?? [];
    // Si el filtro de local está restringido (perfil con local_restringido o el
    // admin eligió un local), los KPIs deben reflejar solo ese subset.
    if (filtroLocal === 'vedia') all = all.filter((r) => r.local === 'vedia');
    else if (filtroLocal === 'saavedra') all = all.filter((r) => r.local === 'saavedra');
    let conCosto = 0;
    let sinCosto = 0;
    let conAdv = 0;
    for (const r of all) {
      const c = costos.get(r.id);
      if (c && c.costoBase > 0) conCosto++;
      else if ((ingredientesPorReceta.get(r.id)?.length ?? 0) > 0) sinCosto++;
      if (c && c.advertencias.length > 0) conAdv++;
    }
    return {
      total: all.length,
      rellenos: all.filter((r) => r.tipo === 'relleno').length,
      masas: all.filter((r) => r.tipo === 'masa').length,
      salsas: all.filter((r) => r.tipo === 'salsa').length,
      subrecetas: all.filter((r) => r.tipo === 'subreceta').length,
      conCosto,
      sinCosto,
      conAdv,
    };
  }, [recetas, filtroLocal, costos, ingredientesPorReceta]);

  const eliminar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('cocina_recetas').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cocina-recetas'] });
      qc.invalidateQueries({ queryKey: ['cocina-receta-ingredientes'] });
      qc.invalidateQueries({ queryKey: ['cocina-recetas-costeo'] });
      qc.invalidateQueries({ queryKey: ['cocina-receta-ingredientes-costeo'] });
    },
  });

  const toggleActivo = useMutation({
    mutationFn: async ({ id, activo }: { id: string; activo: boolean }) => {
      const { error } = await supabase.from('cocina_recetas').update({ activo }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cocina-recetas'] });
      qc.invalidateQueries({ queryKey: ['cocina-recetas-costeo'] });
    },
  });

  const duplicar = useMutation({
    mutationFn: async ({
      origen,
      nuevoLocal,
      nuevoNombre,
    }: {
      origen: Receta;
      nuevoLocal: string;
      nuevoNombre: string;
    }) => {
      // 1) Insertar nueva receta con mismos atributos pero otro local y (opcional) otro nombre
      const nuevaRow = {
        nombre: nuevoNombre.trim(),
        tipo: origen.tipo,
        rendimiento_kg: origen.rendimiento_kg,
        rendimiento_unidad: origen.rendimiento_unidad ?? 'kg',
        rendimiento_porciones: origen.rendimiento_porciones,
        instrucciones: origen.instrucciones,
        local: nuevoLocal,
        gramos_por_porcion: origen.gramos_por_porcion,
        fudo_productos: origen.fudo_productos,
        activo: true,
      };
      const { data: recetaNueva, error: errReceta } = await supabase
        .from('cocina_recetas')
        .insert(nuevaRow)
        .select('id')
        .single();
      if (errReceta) throw errReceta;

      // 2) Copiar ingredientes
      const { data: ingsOrigen, error: errIngs } = await supabase
        .from('cocina_receta_ingredientes')
        .select('nombre, cantidad, unidad, observaciones, orden, producto_id')
        .eq('receta_id', origen.id);
      if (errIngs) throw errIngs;
      if (ingsOrigen && ingsOrigen.length > 0) {
        const rows = ingsOrigen.map((i) => ({ ...i, receta_id: recetaNueva.id }));
        const { error: errInsIngs } = await supabase
          .from('cocina_receta_ingredientes')
          .insert(rows);
        if (errInsIngs) throw errInsIngs;
      }
      return recetaNueva.id as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cocina-recetas'] });
      qc.invalidateQueries({ queryKey: ['cocina-receta-ingredientes'] });
      qc.invalidateQueries({ queryKey: ['cocina-recetas-costeo'] });
      qc.invalidateQueries({ queryKey: ['cocina-receta-ingredientes-costeo'] });
      setDuplicando(null);
    },
  });

  return (
    <div className="space-y-4">
      {/* KPIs — clickeables para filtrar la tabla */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-7">
        <KPICard
          label="Total recetas"
          value={String(kpis.total)}
          color="blue"
          loading={isLoading}
          onClick={() => {
            setFiltroTipo('todos');
            if (!localRestringido) setFiltroLocal('todos');
            setFiltroActivo('todas');
            setFiltroAdvertencia('todas');
            setFiltroCosteo('todos');
            setBusqueda('');
          }}
        />
        <KPICard
          label="Subrecetas"
          value={String(kpis.subrecetas)}
          color="neutral"
          loading={isLoading}
          active={filtroTipo === 'subreceta'}
          onClick={() => setFiltroTipo(filtroTipo === 'subreceta' ? 'todos' : 'subreceta')}
        />
        <KPICard
          label="Rellenos"
          value={String(kpis.rellenos)}
          color="green"
          loading={isLoading}
          active={filtroTipo === 'relleno'}
          onClick={() => setFiltroTipo(filtroTipo === 'relleno' ? 'todos' : 'relleno')}
        />
        <KPICard
          label="Masas"
          value={String(kpis.masas)}
          color="neutral"
          loading={isLoading}
          active={filtroTipo === 'masa'}
          onClick={() => setFiltroTipo(filtroTipo === 'masa' ? 'todos' : 'masa')}
        />
        <KPICard
          label="Con costeo"
          value={String(kpis.conCosto)}
          color="green"
          loading={isLoading}
          active={filtroCosteo === 'con_costeo'}
          onClick={() => setFiltroCosteo(filtroCosteo === 'con_costeo' ? 'todos' : 'con_costeo')}
        />
        <KPICard
          label="Sin match"
          value={String(kpis.sinCosto)}
          color={kpis.sinCosto > 0 ? 'yellow' : 'neutral'}
          loading={isLoading}
          active={filtroCosteo === 'sin_match'}
          onClick={() => setFiltroCosteo(filtroCosteo === 'sin_match' ? 'todos' : 'sin_match')}
        />
        <KPICard
          label="Con advertencias"
          value={String(kpis.conAdv)}
          color={kpis.conAdv > 0 ? 'yellow' : 'neutral'}
          loading={isLoading}
          active={filtroAdvertencia === 'con_adv'}
          onClick={() =>
            setFiltroAdvertencia(filtroAdvertencia === 'con_adv' ? 'todas' : 'con_adv')
          }
        />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-surface-border bg-white p-3">
        <input
          placeholder="Buscar receta..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="w-56 rounded border border-gray-300 px-3 py-1.5 text-sm"
        />
        <select
          value={filtroTipo}
          onChange={(e) => setFiltroTipo(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm"
        >
          <option value="todos">Todos los tipos</option>
          {TIPOS.map((t) => (
            <option key={t} value={t}>
              {TIPO_LABEL[t]}
            </option>
          ))}
        </select>
        {!localRestringido && (
          <select
            value={filtroLocal}
            onChange={(e) => setFiltroLocal(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="todos">Todos los locales</option>
            <option value="vedia">Vedia</option>
            <option value="saavedra">Saavedra</option>
          </select>
        )}
        <select
          value={filtroActivo}
          onChange={(e) => setFiltroActivo(e.target.value as typeof filtroActivo)}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm"
        >
          <option value="activas">Solo activas</option>
          <option value="inactivas">Solo inactivas</option>
          <option value="todas">Todas</option>
        </select>
        <select
          value={filtroAdvertencia}
          onChange={(e) => setFiltroAdvertencia(e.target.value as typeof filtroAdvertencia)}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm"
          title="Filtrar por estado de advertencias de costeo"
        >
          <option value="todas">Todas las recetas</option>
          <option value="con_adv">⚠ Solo con advertencias</option>
          <option value="sin_adv">Solo sin advertencias</option>
        </select>
        <button
          onClick={() => {
            setEditando(null);
            setModalAbierto(true);
          }}
          className="ml-auto rounded bg-rodziny-700 px-3 py-1.5 text-sm text-white hover:bg-rodziny-800"
        >
          + Nueva receta
        </button>
      </div>

      {/* Tabla */}
      <div className="overflow-x-auto rounded-lg border border-surface-border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border bg-gray-50 text-left text-xs uppercase text-gray-500">
              <th className="w-8 px-4 py-2"></th>
              <th className="px-4 py-2">Nombre</th>
              <th className="px-4 py-2">Local</th>
              <th className="px-4 py-2">Tipo</th>
              <th className="px-4 py-2 text-center">Ingredientes</th>
              <th className="px-4 py-2">Rinde (kg)</th>
              <th className="px-4 py-2">Rinde (porciones)</th>
              <th className="px-4 py-2 text-right">Costo total</th>
              <th className="px-4 py-2 text-right">$/kg</th>
              <th className="px-4 py-2 text-right">$/porción</th>
              <th className="px-4 py-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((r) => {
              const ings = ingredientesPorReceta.get(r.id) ?? [];
              const abierta = fichaAbierta === r.id;
              const costo = costos.get(r.id);
              const tieneAdv = costo?.advertencias && costo.advertencias.length > 0;
              return (
                <Fragment key={r.id}>
                  <tr
                    className={cn(
                      'border-b border-surface-border hover:bg-gray-50',
                      abierta && 'bg-blue-50/30',
                      !r.activo && 'opacity-50',
                    )}
                  >
                    <td className="px-4 py-2">
                      <button
                        onClick={() => setFichaAbierta(abierta ? null : r.id)}
                        className={cn(
                          'flex h-5 w-5 items-center justify-center rounded text-xs transition-colors',
                          abierta
                            ? 'bg-rodziny-100 text-rodziny-700'
                            : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600',
                        )}
                        title="Ver ficha técnica"
                      >
                        {abierta ? '▾' : '▸'}
                      </button>
                    </td>
                    <td className="px-4 py-2 font-medium text-gray-900">
                      <div className="flex items-center gap-1.5">
                        <span>{r.nombre}</span>
                        {tieneAdv && (
                          <span
                            title={costo!.advertencias.join('\n')}
                            className="text-xs text-amber-500"
                          >
                            ⚠
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      {r.local ? (
                        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium capitalize text-gray-700">
                          {r.local}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-xs font-medium',
                          TIPO_COLOR[r.tipo],
                        )}
                      >
                        {TIPO_LABEL[r.tipo]}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-center">
                      {ings.length > 0 ? (
                        <span className="text-xs font-medium text-gray-600">{ings.length}</span>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {r.rendimiento_kg != null
                        ? `${r.rendimiento_kg} ${UNIDAD_LABEL[r.rendimiento_unidad ?? 'kg']}`
                        : '—'}
                    </td>
                    <td className="px-4 py-2">{r.rendimiento_porciones ?? '—'}</td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums text-gray-800">
                      {costo && costo.costoConMargen > 0 ? (
                        formatARS(costo.costoConMargen)
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                      {costo?.costoPorKg != null ? (
                        formatARS(costo.costoPorKg)
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                      {costo?.costoPorPorcion != null ? (
                        formatARS(costo.costoPorPorcion)
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          onClick={() => {
                            setEditando(r);
                            setModalAbierto(true);
                          }}
                          className="text-xs text-blue-600 hover:text-blue-800"
                        >
                          Editar
                        </button>
                        {!localRestringido && (
                          <button
                            onClick={() => setDuplicando(r)}
                            className="text-xs text-purple-600 hover:text-purple-800"
                            title="Crear copia para otro local"
                          >
                            Duplicar
                          </button>
                        )}
                        <button
                          onClick={() => toggleActivo.mutate({ id: r.id, activo: !r.activo })}
                          className={cn(
                            'text-xs',
                            r.activo
                              ? 'text-orange-600 hover:text-orange-800'
                              : 'text-green-600 hover:text-green-800',
                          )}
                          title={r.activo ? 'Desactivar' : 'Activar'}
                        >
                          {r.activo ? 'Desactivar' : 'Activar'}
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm(`¿Eliminar "${r.nombre}"?`)) eliminar.mutate(r.id);
                          }}
                          className="text-xs text-red-500 hover:text-red-700"
                        >
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                  {abierta && (
                    <tr className="bg-blue-50/20">
                      <td colSpan={11} className="px-4 py-0">
                        <FichaTecnica receta={r} ingredientes={ings} costo={costo} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {filtrados.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-8 text-center text-gray-400">
                  {isLoading ? 'Cargando...' : 'No hay recetas'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modalAbierto && (
        <ModalReceta
          receta={editando}
          ingredientes={editando ? (ingredientesPorReceta.get(editando.id) ?? []) : []}
          todasLasRecetas={recetas ?? []}
          localRestringido={localRestringido}
          onClose={() => setModalAbierto(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['cocina-recetas'] });
            qc.invalidateQueries({ queryKey: ['cocina-receta-ingredientes'] });
            qc.invalidateQueries({ queryKey: ['cocina-recetas-costeo'] });
            qc.invalidateQueries({ queryKey: ['cocina-receta-ingredientes-costeo'] });
            setModalAbierto(false);
          }}
        />
      )}

      {duplicando && (
        <DialogDuplicar
          receta={duplicando}
          onCancelar={() => setDuplicando(null)}
          onConfirmar={(nuevoLocal, nuevoNombre) =>
            duplicar.mutate({ origen: duplicando, nuevoLocal, nuevoNombre })
          }
          guardando={duplicar.isPending}
          error={duplicar.error ? String(duplicar.error) : null}
        />
      )}
    </div>
  );
}

// ─── Dialog: Duplicar receta para otro local ───────────────────────────────
function DialogDuplicar({
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
function FichaTecnica({
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

// ─── Modal crear/editar receta con ingredientes ─────────────────────────────
interface ProductoCompras {
  id: string;
  nombre: string;
  marca: string | null;
  unidad: string;
  categoria: string | null;
  local: string | null;
}

interface IngredienteForm {
  tempId: string;
  dbId: string | null; // null = nuevo
  nombre: string;
  cantidad: string;
  unidad: string;
  observaciones: string;
  producto_id: string | null;
}

function ModalReceta({
  receta,
  ingredientes: ingredientesExistentes,
  todasLasRecetas,
  localRestringido,
  onClose,
  onSaved,
}: {
  receta: Receta | null;
  ingredientes: Ingrediente[];
  todasLasRecetas: Receta[];
  localRestringido: 'vedia' | 'saavedra' | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [nombre, setNombre] = useState(receta?.nombre ?? '');
  const [tipo, setTipo] = useState(receta?.tipo ?? 'relleno');
  const [rendKg, setRendKg] = useState(receta?.rendimiento_kg ?? '');
  const [rendUnidad, setRendUnidad] = useState<RendUnidad>(receta?.rendimiento_unidad ?? 'kg');
  const [rendPorciones, setRendPorciones] = useState(receta?.rendimiento_porciones ?? '');
  const [local, setLocal] = useState<string>(receta?.local ?? localRestringido ?? 'vedia');
  const [gramosPorcion, setGramosPorcion] = useState<string>(
    receta?.gramos_por_porcion != null ? String(receta.gramos_por_porcion) : '',
  );
  const [fudoProductos, setFudoProductos] = useState<string>(
    (receta?.fudo_productos ?? []).join(', '),
  );
  const [instrucciones, setInstrucciones] = useState(receta?.instrucciones ?? '');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'general' | 'ingredientes' | 'procedimiento'>('general');

  // Errores por ingrediente (desde el costeo calculado) — se muestran como ⚠ en la grilla de ingredientes
  // Nota: se basa en lo GUARDADO en DB, no en el state del form. Si el usuario edita y corrige, el ⚠ sigue hasta guardar.
  const { costos } = useCostosRecetas();
  const erroresPorIngId = useMemo(() => {
    const m = new Map<string, string>();
    if (!receta) return m;
    const costo = costos.get(receta.id);
    if (!costo) return m;
    for (const d of costo.detalles) {
      if (d.error) m.set(d.id, d.error);
    }
    return m;
  }, [receta, costos]);

  // Productos de compras (para autocomplete), filtrados por local de la receta
  const { data: productosCompras } = useQuery({
    queryKey: ['productos-compras-recetas', local],
    queryFn: async () => {
      let q = supabase
        .from('productos')
        .select('id, nombre, marca, unidad, categoria, local')
        .eq('activo', true)
        .order('nombre');
      if (local === 'vedia') q = q.eq('local', 'vedia');
      else if (local === 'saavedra') q = q.eq('local', 'saavedra');
      const { data, error } = await q;
      if (error) throw error;
      return data as ProductoCompras[];
    },
  });

  // Ingredientes editables
  const [ings, setIngs] = useState<IngredienteForm[]>(() =>
    ingredientesExistentes.map((ing) => ({
      tempId: ing.id,
      dbId: ing.id,
      nombre: ing.nombre,
      cantidad: String(ing.cantidad),
      unidad: ing.unidad,
      observaciones: ing.observaciones ?? '',
      producto_id: ing.producto_id,
    })),
  );

  function agregarIngrediente() {
    setIngs([
      ...ings,
      {
        tempId: crypto.randomUUID(),
        dbId: null,
        nombre: '',
        cantidad: '',
        unidad: 'g',
        observaciones: '',
        producto_id: null,
      },
    ]);
  }

  function actualizarIng(tempId: string, campo: keyof IngredienteForm, valor: string) {
    setIngs(ings.map((i) => (i.tempId === tempId ? { ...i, [campo]: valor } : i)));
  }

  function seleccionarProducto(
    tempId: string,
    producto: ProductoCompras,
    tipo: 'receta' | 'producto',
  ) {
    // Si el usuario eligió una RECETA (subreceta), no asignamos producto_id (es FK a productos, no a cocina_recetas).
    // Se guarda con prefijo "Subreceta " para que el costeo la detecte por nombre.
    setIngs(
      ings.map((i) =>
        i.tempId === tempId
          ? {
              ...i,
              nombre: tipo === 'receta' ? `Subreceta ${producto.nombre}` : producto.nombre,
              producto_id: tipo === 'receta' ? null : producto.id,
              unidad: mapearUnidad(producto.unidad),
            }
          : i,
      ),
    );
  }

  function eliminarIng(tempId: string) {
    setIngs(ings.filter((i) => i.tempId !== tempId));
  }

  function moverIng(tempId: string, dir: -1 | 1) {
    const idx = ings.findIndex((i) => i.tempId === tempId);
    if (idx < 0) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= ings.length) return;
    const copia = [...ings];
    [copia[idx], copia[newIdx]] = [copia[newIdx], copia[idx]];
    setIngs(copia);
  }

  const guardar = async () => {
    if (!nombre.trim()) {
      setError('El nombre es obligatorio');
      return;
    }
    setGuardando(true);
    setError('');

    try {
      // 1. Guardar receta (margen_seguridad_pct se edita desde Finanzas > Costeo)
      const fudoArr = fudoProductos
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const row = {
        nombre: nombre.trim(),
        tipo,
        rendimiento_kg: rendKg !== '' ? Number(rendKg) : null,
        rendimiento_unidad: rendUnidad,
        rendimiento_porciones: rendPorciones !== '' ? Number(rendPorciones) : null,
        local,
        gramos_por_porcion: gramosPorcion !== '' ? Number(gramosPorcion) : null,
        fudo_productos: fudoArr.length > 0 ? fudoArr : null,
        instrucciones: instrucciones.trim() || null,
        updated_at: new Date().toISOString(),
      };

      let recetaId = receta?.id;
      if (receta) {
        const { error: err } = await supabase
          .from('cocina_recetas')
          .update(row)
          .eq('id', receta.id);
        if (err) throw err;
      } else {
        const { data, error: err } = await supabase
          .from('cocina_recetas')
          .insert({ ...row, activo: true })
          .select('id')
          .single();
        if (err) throw err;
        recetaId = data.id;
      }

      // 2. Sync ingredientes
      // Borrar los que ya no están
      const idsActuales = ings.filter((i) => i.dbId).map((i) => i.dbId!);
      const idsOriginales = ingredientesExistentes.map((i) => i.id);
      const idsABorrar = idsOriginales.filter((id) => !idsActuales.includes(id));

      if (idsABorrar.length > 0) {
        const { error: delErr } = await supabase
          .from('cocina_receta_ingredientes')
          .delete()
          .in('id', idsABorrar);
        if (delErr) throw delErr;
      }

      // Upsert ingredientes (update existentes + insert nuevos)
      for (let i = 0; i < ings.length; i++) {
        const ing = ings[i];
        if (!ing.nombre.trim() || !ing.cantidad) continue;

        const payload = {
          receta_id: recetaId!,
          nombre: ing.nombre.trim(),
          cantidad: Number(String(ing.cantidad).replace(',', '.')),
          unidad: ing.unidad,
          observaciones: ing.observaciones.trim() || null,
          orden: i,
          producto_id: ing.producto_id || null,
        };

        if (ing.dbId) {
          const { error: updErr } = await supabase
            .from('cocina_receta_ingredientes')
            .update(payload)
            .eq('id', ing.dbId);
          if (updErr) throw updErr;
        } else {
          const { error: insErr } = await supabase
            .from('cocina_receta_ingredientes')
            .insert(payload);
          if (insErr) throw insErr;
        }
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-gray-200 px-6 pb-3 pt-5">
          <h3 className="text-lg font-bold text-gray-800">
            {receta ? 'Editar receta' : 'Nueva receta'}
          </h3>
          {/* Tabs del modal */}
          <div className="mt-3 flex gap-1">
            {(['general', 'ingredientes', 'procedimiento'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  'rounded-t px-3 py-1.5 text-xs font-medium transition-colors',
                  tab === t
                    ? 'border-rodziny-200 border border-b-0 bg-rodziny-50 text-rodziny-700'
                    : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700',
                )}
              >
                {t === 'general'
                  ? 'General'
                  : t === 'ingredientes'
                    ? `Ingredientes (${ings.length})`
                    : 'Procedimiento'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* Tab General */}
          {tab === 'general' && (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-gray-500">Nombre *</label>
                <input
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
                  placeholder="Relleno Jamón, Queso y Cebolla"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-gray-500">Tipo</label>
                  <select
                    value={tipo}
                    onChange={(e) => setTipo(e.target.value as Receta['tipo'])}
                    className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  >
                    {TIPOS.map((t) => (
                      <option key={t} value={t}>
                        {TIPO_LABEL[t]}
                      </option>
                    ))}
                  </select>
                </div>
                {!localRestringido && (
                  <div>
                    <label className="mb-1 block text-xs text-gray-500">Local</label>
                    <select
                      value={local}
                      onChange={(e) => setLocal(e.target.value)}
                      className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                    >
                      <option value="vedia">Vedia</option>
                      <option value="saavedra">Saavedra</option>
                    </select>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-gray-500">Rendimiento</label>
                  <div className="flex gap-1">
                    <input
                      type="number"
                      step="0.1"
                      value={rendKg}
                      onChange={(e) => setRendKg(e.target.value)}
                      className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
                      placeholder={rendUnidad === 'unidad' ? '1' : '5.5'}
                    />
                    <select
                      value={rendUnidad}
                      onChange={(e) => setRendUnidad(e.target.value as RendUnidad)}
                      className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
                    >
                      <option value="kg">kg</option>
                      <option value="l">L</option>
                      <option value="unidad">unid.</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-500">
                    Rendimiento (porciones)
                  </label>
                  <input
                    type="number"
                    value={rendPorciones}
                    onChange={(e) => setRendPorciones(e.target.value)}
                    className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
                    placeholder="45"
                  />
                </div>
              </div>

              <div className="border-t border-gray-100 pt-3">
                <p className="mb-2 text-[11px] font-medium text-gray-600">
                  Proyección de stock (salsas/postres)
                </p>
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-gray-500">
                      Gramos por porción servida
                    </label>
                    <input
                      type="number"
                      value={gramosPorcion}
                      onChange={(e) => setGramosPorcion(e.target.value)}
                      className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
                      placeholder="200"
                    />
                    <p className="mt-1 text-[10px] text-gray-400">
                      Para salsas ~200g. Dejar vacío si se vende por unidad (postres).
                    </p>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-500">
                      Productos Fudo asociados (opcional)
                    </label>
                    <textarea
                      value={fudoProductos}
                      onChange={(e) => setFudoProductos(e.target.value)}
                      rows={2}
                      className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
                      placeholder="Dejar vacío para auto-detectar por nombre"
                    />
                    <p className="mt-1 text-[10px] text-gray-400">
                      Auto: si el nombre de la receta ("{nombre || '...'}") está en el nombre del
                      producto Fudo, se asocia automáticamente. Llenar solo si el nombre no matchea
                      literal (ej: receta "Bolognesa" pero en Fudo figura "a la bolonia").
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tab Ingredientes */}
          {tab === 'ingredientes' && (
            <div className="space-y-2">
              {ings.length === 0 ? (
                <p className="py-6 text-center text-xs italic text-gray-400">
                  No hay ingredientes todavía. Agregá el primero.
                </p>
              ) : (
                <div className="overflow-hidden rounded-lg border border-gray-200">
                  <div className="grid grid-cols-[28px_18px_minmax(0,1fr)_84px_64px_minmax(0,1fr)_74px] gap-2 border-b border-gray-200 bg-gray-100 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                    <span className="text-center">#</span>
                    <span></span>
                    <span>Ingrediente</span>
                    <span className="pr-2 text-right">Cantidad</span>
                    <span>Unidad</span>
                    <span>Observaciones</span>
                    <span className="text-right">Acciones</span>
                  </div>
                  {ings.map((ing, idx) => {
                    // Solo mostrar ⚠ si la fila NO fue editada respecto a DB — si el usuario cambió algo, el costeo está desactualizado
                    const ingOriginal = ing.dbId
                      ? ingredientesExistentes.find((o) => o.id === ing.dbId)
                      : null;
                    const filaEditada =
                      ingOriginal != null &&
                      (ingOriginal.nombre !== ing.nombre ||
                        String(ingOriginal.cantidad) !== ing.cantidad ||
                        ingOriginal.unidad !== ing.unidad ||
                        (ingOriginal.producto_id ?? null) !== (ing.producto_id ?? null));
                    const errorIng =
                      !filaEditada && ing.dbId ? (erroresPorIngId.get(ing.dbId) ?? null) : null;
                    return (
                      <div
                        key={ing.tempId}
                        className={
                          'grid grid-cols-[28px_18px_minmax(0,1fr)_84px_64px_minmax(0,1fr)_74px] items-center gap-2 border-b border-gray-100 px-2 py-1 last:border-b-0 hover:bg-rodziny-50/40 ' +
                          (idx % 2 === 1 ? 'bg-gray-50/40' : 'bg-white')
                        }
                      >
                        <span className="text-center font-mono text-[10px] text-gray-400">
                          {idx + 1}
                        </span>
                        {errorIng ? (
                          <span
                            title={errorIng}
                            className="cursor-help text-center text-xs text-amber-500"
                          >
                            ⚠
                          </span>
                        ) : (
                          <span />
                        )}
                        <AutocompleteIngrediente
                          valor={ing.nombre}
                          productos={productosCompras ?? []}
                          recetas={todasLasRecetas}
                          recetaActualId={receta?.id ?? null}
                          onChange={(v) => actualizarIng(ing.tempId, 'nombre', v)}
                          onSelect={(p, tipo) => seleccionarProducto(ing.tempId, p, tipo)}
                        />
                        <input
                          type="text"
                          inputMode="decimal"
                          value={ing.cantidad}
                          onChange={(e) => actualizarIng(ing.tempId, 'cantidad', e.target.value)}
                          placeholder="0"
                          className="focus:border-rodziny-300 w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-right text-sm tabular-nums outline-none placeholder:text-gray-300 focus:bg-white"
                        />
                        <select
                          value={ing.unidad}
                          onChange={(e) => actualizarIng(ing.tempId, 'unidad', e.target.value)}
                          className="focus:border-rodziny-300 w-full rounded border border-transparent bg-transparent px-1 py-1 text-sm outline-none hover:bg-white focus:bg-white"
                        >
                          {UNIDADES.map((u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          ))}
                        </select>
                        <input
                          value={ing.observaciones}
                          onChange={(e) =>
                            actualizarIng(ing.tempId, 'observaciones', e.target.value)
                          }
                          placeholder="—"
                          className="focus:border-rodziny-300 w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-xs text-gray-600 outline-none placeholder:text-gray-300 focus:bg-white"
                        />
                        <div className="flex items-center justify-end gap-0.5">
                          <button
                            onClick={() => moverIng(ing.tempId, -1)}
                            disabled={idx === 0}
                            className="px-1 text-[10px] text-gray-400 hover:text-gray-600 disabled:opacity-20"
                            title="Subir"
                          >
                            ▲
                          </button>
                          <button
                            onClick={() => moverIng(ing.tempId, 1)}
                            disabled={idx === ings.length - 1}
                            className="px-1 text-[10px] text-gray-400 hover:text-gray-600 disabled:opacity-20"
                            title="Bajar"
                          >
                            ▼
                          </button>
                          <button
                            onClick={() => eliminarIng(ing.tempId)}
                            className="px-1 text-xs text-red-400 hover:text-red-600"
                            title="Eliminar ingrediente"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <button
                onClick={agregarIngrediente}
                className="hover:border-rodziny-300 w-full rounded-lg border-2 border-dashed border-gray-300 py-2 text-sm text-gray-500 transition-colors hover:text-rodziny-700"
              >
                + Agregar ingrediente
              </button>
            </div>
          )}

          {/* Tab Procedimiento */}
          {tab === 'procedimiento' && (
            <div>
              <label className="mb-1 block text-xs text-gray-500">
                Escribí cada paso en una línea separada. Se van a numerar automáticamente.
              </label>
              <textarea
                value={instrucciones}
                onChange={(e) => setInstrucciones(e.target.value)}
                rows={12}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm leading-relaxed"
                placeholder={
                  'Cortar cebolla en pluma\nPoner a calentar manteca y aceite\nAgregar la cebolla y cocinar 40 min a fuego bajo\n...'
                }
              />
              {instrucciones.trim() && (
                <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <p className="mb-2 text-[10px] font-medium uppercase text-gray-400">
                    Vista previa
                  </p>
                  <ol className="space-y-1">
                    {instrucciones
                      .split('\n')
                      .filter((s) => s.trim())
                      .map((paso, i) => (
                        <li key={i} className="flex gap-2 text-xs">
                          <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-rodziny-100 text-[9px] font-bold text-rodziny-700">
                            {i + 1}
                          </span>
                          <span className="text-gray-700">{paso.trim()}</span>
                        </li>
                      ))}
                  </ol>
                </div>
              )}
            </div>
          )}
        </div>

        {error && <p className="px-6 pb-2 text-xs text-red-500">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-gray-200 px-6 py-4">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-gray-600 hover:text-gray-800"
          >
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={guardando}
            className="rounded bg-rodziny-700 px-4 py-1.5 text-sm text-white hover:bg-rodziny-800 disabled:opacity-50"
          >
            {guardando ? 'Guardando...' : 'Guardar'}
          </button>
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
}

function AutocompleteIngrediente({
  valor,
  productos,
  recetas,
  recetaActualId,
  onChange,
  onSelect,
}: {
  valor: string;
  productos: ProductoCompras[];
  recetas: Receta[];
  recetaActualId: string | null;
  onChange: (v: string) => void;
  onSelect: (p: ProductoCompras, tipo: 'receta' | 'producto') => void;
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
        detalle: TIPO_LABEL[r.tipo] ?? r.tipo,
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

    return lista;
  }, [productos, recetas, recetaActualId]);

  const filtrados = useMemo(() => {
    if (!valor.trim()) {
      // Sin búsqueda: mostrar recetas primero, luego productos
      const recs = opciones.filter((o) => o.tipo === 'receta').slice(0, 5);
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

// ─── Helpers ────────────────────────────────────────────────────────────────
// Mapear unidades de Compras → unidades de receta
function mapearUnidad(unidadCompras: string): string {
  const u = unidadCompras.toLowerCase().trim();
  if (u === 'kg' || u === 'kgs') return 'kg';
  if (u === 'g' || u === 'gr' || u === 'grs' || u === 'gramos') return 'g';
  if (u === 'lt' || u === 'l' || u === 'lts' || u === 'litros' || u === 'litro') return 'lt';
  if (u === 'ml' || u === 'mililitros') return 'ml';
  if (u === 'unid.' || u === 'unid' || u === 'u' || u === 'unidades' || u === 'unidad')
    return 'unid';
  return 'g'; // default
}

function formatCantidad(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toLocaleString('es-AR', { maximumFractionDigits: 2 });
}
