import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cn, formatARS } from '@/lib/utils';
import { normalizarTexto } from './utils';

// Vista global de todos los recibos de sueldo (subidos desde Documentos del contador
// o desde el legajo). Filtrable por período, empleado y local. La vista por persona
// vive en el legajo (RRHH → Legajos → editar empleado).

interface ReciboRow {
  id: string;
  empleado_id: string | null;
  cuil_detectado: string | null;
  nombre_detectado: string | null;
  periodo: string | null;
  monto_neto: number | null;
  archivo_path: string;
  created_at: string;
}
interface EmpleadoMin {
  id: string;
  nombre: string;
  apellido: string;
  local: 'vedia' | 'saavedra';
}

async function abrirArchivo(path: string) {
  const { data, error } = await supabase.storage
    .from('correos-contadores')
    .createSignedUrl(path, 300);
  if (!error && data) window.open(data.signedUrl, '_blank');
}

export function RecibosTab() {
  const qc = useQueryClient();
  const [periodo, setPeriodo] = useState<string>('');
  const [local, setLocal] = useState<'todos' | 'vedia' | 'saavedra'>('todos');
  const [busqueda, setBusqueda] = useState('');

  const { data: recibos } = useQuery({
    queryKey: ['recibos_sueldo'],
    queryFn: async (): Promise<ReciboRow[]> => {
      const { data, error } = await supabase
        .from('recibos_sueldo')
        .select('*')
        .order('periodo', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      return data as ReciboRow[];
    },
  });

  const { data: empleados } = useQuery({
    queryKey: ['empleados-min-recibos'],
    queryFn: async (): Promise<EmpleadoMin[]> => {
      const { data, error } = await supabase
        .from('empleados')
        .select('id, nombre, apellido, local')
        .order('apellido');
      if (error) throw error;
      return data as EmpleadoMin[];
    },
  });

  const empMap = useMemo(() => {
    const m = new Map<string, EmpleadoMin>();
    (empleados ?? []).forEach((e) => m.set(e.id, e));
    return m;
  }, [empleados]);

  const periodos = useMemo(() => {
    const set = new Set<string>();
    (recibos ?? []).forEach((r) => r.periodo && set.add(r.periodo));
    return Array.from(set).sort().reverse();
  }, [recibos]);

  const filtrados = useMemo(() => {
    const q = normalizarTexto(busqueda);
    return (recibos ?? []).filter((r) => {
      if (periodo && r.periodo !== periodo) return false;
      const emp = r.empleado_id ? empMap.get(r.empleado_id) : undefined;
      if (local !== 'todos') {
        if (!emp || emp.local !== local) return false;
      }
      if (q) {
        const nombre = emp
          ? `${emp.apellido} ${emp.nombre}`
          : r.nombre_detectado ?? '';
        if (!normalizarTexto(nombre).includes(q)) return false;
      }
      return true;
    });
  }, [recibos, periodo, local, busqueda, empMap]);

  async function asignar(id: string, empleadoId: string) {
    await supabase.from('recibos_sueldo').update({ empleado_id: empleadoId || null }).eq('id', id);
    qc.invalidateQueries({ queryKey: ['recibos_sueldo'] });
  }
  async function borrar(id: string) {
    await supabase.from('recibos_sueldo').delete().eq('id', id);
    qc.invalidateQueries({ queryKey: ['recibos_sueldo'] });
  }

  const totalNeto = filtrados.reduce((s, r) => s + (Number(r.monto_neto) || 0), 0);
  const sinAsignar = filtrados.filter((r) => !r.empleado_id).length;

  return (
    <div className="space-y-3">
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-3">
        <select
          value={periodo}
          onChange={(e) => setPeriodo(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1 text-xs"
        >
          <option value="">Todos los períodos</option>
          {periodos.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          value={local}
          onChange={(e) => setLocal(e.target.value as 'todos' | 'vedia' | 'saavedra')}
          className="rounded border border-gray-300 px-2 py-1 text-xs"
        >
          <option value="todos">Todos los locales</option>
          <option value="vedia">Vedia</option>
          <option value="saavedra">Saavedra</option>
        </select>
        <input
          type="text"
          placeholder="Buscar empleado…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="min-w-[180px] flex-1 rounded border border-gray-300 px-2 py-1 text-xs"
        />
        <span className="text-xs text-gray-500">
          {filtrados.length} recibo{filtrados.length !== 1 ? 's' : ''} · {formatARS(totalNeto)}
          {sinAsignar > 0 && <span className="ml-2 text-amber-600">⚠ {sinAsignar} sin asignar</span>}
        </span>
      </div>

      {/* Tabla */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr className="text-[10px] uppercase tracking-wide text-gray-500">
              <th className="px-3 py-2 text-left font-semibold">Empleado</th>
              <th className="px-2 py-2 text-left font-semibold">Local</th>
              <th className="px-2 py-2 text-left font-semibold">Período</th>
              <th className="px-2 py-2 text-right font-semibold">Neto</th>
              <th className="px-2 py-2 text-center font-semibold">PDF</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtrados.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-xs text-gray-400">
                  {recibos ? 'Sin recibos para mostrar' : 'Cargando…'}
                </td>
              </tr>
            )}
            {filtrados.map((r) => {
              const emp = r.empleado_id ? empMap.get(r.empleado_id) : undefined;
              return (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2">
                    {emp ? (
                      <span className="font-medium text-gray-900">
                        {emp.apellido}, {emp.nombre}
                      </span>
                    ) : (
                      <select
                        defaultValue=""
                        onChange={(e) => asignar(r.id, e.target.value)}
                        className="rounded border border-amber-300 bg-amber-50 px-1.5 py-1 text-[11px] text-amber-800"
                      >
                        <option value="">⚠ Asignar… ({r.nombre_detectado ?? 'sin nombre'})</option>
                        {(empleados ?? []).map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.apellido}, {e.nombre}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="px-2 py-2 text-xs capitalize text-gray-600">{emp?.local ?? '—'}</td>
                  <td className="px-2 py-2 text-xs text-gray-600">{r.periodo ?? '—'}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-800">
                    {r.monto_neto ? formatARS(r.monto_neto) : '—'}
                  </td>
                  <td className="px-2 py-2 text-center">
                    <button
                      onClick={() => abrirArchivo(r.archivo_path)}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      ver
                    </button>
                  </td>
                  <td className="px-2 py-2 text-center">
                    <button
                      onClick={() => window.confirm('¿Borrar este recibo?') && borrar(r.id)}
                      className={cn('text-xs text-gray-400 hover:text-red-600')}
                      title="Borrar"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
