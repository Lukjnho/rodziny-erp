import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabaseAnon as supabase } from '@/lib/supabaseAnon';

interface Empleado {
  id: string;
  nombre: string;
  apellido: string;
}

interface Props {
  local: 'vedia' | 'saavedra';
  value: string;
  onChange: (nombre: string) => void;
}

// Dropdown obligatorio con empleados de producción activos del local.
// Recuerda el último elegido por local en localStorage para auto-seleccionarlo
// la próxima vez (los QR son anónimos, no hay sesión).
export function ResponsableSelect({ local, value, onChange }: Props) {
  const storageKey = `cocina-qr-responsable-${local}`;

  const { data: empleados, isLoading } = useQuery({
    queryKey: ['cocina-qr-empleados-produccion', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('empleados')
        .select('id, nombre, apellido')
        .eq('local', local)
        .eq('activo', true)
        .eq('es_produccion', true)
        .order('nombre');
      if (error) throw error;
      return (data ?? []) as Empleado[];
    },
    staleTime: 30 * 60 * 1000,
  });

  // Pre-seleccionar el último responsable usado, si está en la lista actual.
  useEffect(() => {
    if (value || !empleados || empleados.length === 0) return;
    const stored = localStorage.getItem(storageKey);
    if (!stored) return;
    const existe = empleados.some((e) => `${e.nombre} ${e.apellido}`.trim() === stored);
    if (existe) onChange(stored);
  }, [empleados, value, storageKey, onChange]);

  const seleccionar = (nombre: string) => {
    onChange(nombre);
    if (nombre) localStorage.setItem(storageKey, nombre);
  };

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-700">
        Responsable <span className="text-red-600">*</span>
      </label>
      <select
        value={value}
        onChange={(e) => seleccionar(e.target.value)}
        disabled={isLoading}
        className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-rodziny-500 focus:ring-1 focus:ring-rodziny-500 disabled:bg-gray-100"
      >
        <option value="">
          {isLoading ? 'Cargando…' : '— Elegí quién carga —'}
        </option>
        {(empleados ?? []).map((e) => {
          const nombre = `${e.nombre} ${e.apellido}`.trim();
          return (
            <option key={e.id} value={nombre}>
              {nombre}
            </option>
          );
        })}
      </select>
      {empleados && empleados.length === 0 && !isLoading && (
        <p className="mt-1 text-[10px] text-amber-700">
          No hay empleados de producción cargados para este local. Pedile al admin que los agregue en RRHH.
        </p>
      )}
    </div>
  );
}
