import { useQuery } from '@tanstack/react-query';
import { supabaseAnon as supabase } from '@/lib/supabaseAnon';
import { cn } from '@/lib/utils';

interface Empleado {
  id: string;
  nombre: string;
  apellido: string;
}

/**
 * Quién está cargando, en botones grandes, para una pantalla COMPARTIDA.
 *
 * Es el hermano de `ResponsableSelect` (el del QR, que se usa desde el celular
 * de cada uno) y la diferencia es a propósito:
 *
 * ⚠️ ACÁ NO SE RECUERDA A NADIE. El select del QR guarda el último elegido en
 * `localStorage` y lo pre-selecciona, porque el celular tiene un solo dueño.
 * En una tablet colgada de la pared eso es un bug: se queda pegada al último
 * que la usó y el siguiente carga el conteo a nombre de otro. Acá siempre se
 * pregunta, y al guardar se limpia.
 *
 * Misma `queryKey` que el select del QR: la lista de gente se comparte en la
 * caché y no se pide dos veces.
 */
export function ResponsableBotones({
  local,
  value,
  onChange,
}: {
  local: 'vedia' | 'saavedra';
  value: string;
  onChange: (nombre: string) => void;
}) {
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

  if (isLoading) {
    return <p className="text-lg text-slate-400">Buscando quién está de turno…</p>;
  }

  if (!empleados || empleados.length === 0) {
    return (
      <p className="text-lg text-amber-300">
        No hay nadie de producción cargado en {local === 'vedia' ? 'Vedia' : 'Saavedra'}. Se cargan
        en RRHH, tildando «es producción».
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-3">
      {empleados.map((e) => {
        const nombre = `${e.nombre} ${e.apellido}`.trim();
        const elegido = value === nombre;
        return (
          <button
            key={e.id}
            type="button"
            onClick={() => onChange(elegido ? '' : nombre)}
            className={cn(
              // 64px de alto mínimo: se toca con el dedo, de parado, sin apuntar.
              'min-h-[64px] rounded-xl px-6 text-xl font-semibold transition',
              elegido
                ? 'bg-teal-400 text-slate-900 ring-4 ring-teal-200'
                : 'bg-slate-700 text-slate-100 hover:bg-slate-600',
            )}
          >
            {nombre}
          </button>
        );
      })}
    </div>
  );
}
