import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabaseAnon as supabase } from '@/lib/supabaseAnon';
import { cn } from '@/lib/utils';

interface Empleado {
  id: string;
  nombre: string;
  apellido: string;
  puesto: string | null;
  es_produccion: boolean | null;
}

/**
 * Quién está cargando, en botones grandes, para una pantalla COMPARTIDA.
 *
 * Es el hermano de `ResponsableSelect` (el del QR, que se usa desde el celular
 * de cada uno) y tiene tres diferencias a propósito:
 *
 * ⚠️ 1. NO SE RECUERDA A NADIE. El select del QR guarda el último elegido en
 * `localStorage` y lo pre-selecciona, porque el celular tiene un solo dueño. En
 * una tablet colgada de la pared eso es un bug: se queda pegada al último que
 * la usó y el siguiente carga el conteo a nombre de otro. Acá siempre se
 * pregunta, y al guardar se limpia.
 *
 * 2. NO SOLO PRODUCCIÓN. El QR lo usan los que producen, pero la cámara la
 * puede contar cualquiera que esté en la fábrica: compras, administración, un
 * encargado. Los de producción van adelante (es el caso normal, un toque) y el
 * resto del personal activo del local queda detrás de «Otra persona».
 *
 * 3. LOS DUEÑOS NO SON EMPLEADOS. No están en `empleados` y no tienen que
 * estarlo: agregarlos ahí los mete en las grillas de sueldos y asistencia. Si
 * la pantalla tiene sesión iniciada, se ofrece ese nombre aparte y bien
 * separado. En la tablet de pared ese botón va a decir el nombre del usuario
 * genérico — si alguien lo toca igual, el conteo queda con ese nombre, que es
 * honesto ("nadie dijo quién era") y no falso ("contó Lucas Ferrara").
 *
 * ⚠️ El nombre se guarda TAL CUAL viene de `empleados`, con los espacios dobles
 * incluidos ("Bruno  Cardozo"). No se limpia acá: el QR de producción ya guardó
 * meses de datos con esa forma y normalizar solo en esta pantalla dejaría dos
 * maneras de escribir a la misma persona en los reportes. Se arregla en RRHH.
 *
 * Misma `queryKey` base que el select del QR pero con sufijo propio: el select
 * pide solo producción y esta pide a todos, así que no pueden compartir caché.
 */
export function ResponsableBotones({
  local,
  value,
  onChange,
  nombreSesion,
}: {
  local: 'vedia' | 'saavedra';
  value: string;
  onChange: (nombre: string) => void;
  /** Nombre del perfil logueado, si hay sesión. Ver punto 3 de arriba. */
  nombreSesion?: string | null;
}) {
  const [verTodos, setVerTodos] = useState(false);

  const { data: empleados, isLoading } = useQuery({
    queryKey: ['cocina-empleados-activos', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('empleados')
        .select('id, nombre, apellido, puesto, es_produccion')
        .eq('local', local)
        .eq('activo', true)
        .order('nombre');
      if (error) throw error;
      return (data ?? []) as Empleado[];
    },
    staleTime: 30 * 60 * 1000,
  });

  const { produccion, resto } = useMemo(() => {
    const lista = empleados ?? [];
    return {
      produccion: lista.filter((e) => e.es_produccion === true),
      resto: lista.filter((e) => e.es_produccion !== true),
    };
  }, [empleados]);

  if (isLoading) {
    return <p className="text-lg text-slate-400">Buscando quién está de turno…</p>;
  }

  const boton = (e: Empleado) => {
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
        {/* El puesto solo en los de "otra persona": ahí hace falta para
            distinguir a los tres Lucas y los dos Josés de Vedia. */}
        {e.es_produccion !== true && e.puesto && (
          <span className="ml-2 text-sm font-normal text-slate-400">{e.puesto.trim()}</span>
        )}
      </button>
    );
  };

  const sinNadie = produccion.length === 0 && resto.length === 0;

  return (
    <div className="space-y-4">
      {produccion.length > 0 && <div className="flex flex-wrap gap-3">{produccion.map(boton)}</div>}

      {resto.length > 0 && !verTodos && (
        <button
          type="button"
          onClick={() => setVerTodos(true)}
          className="min-h-[56px] rounded-xl border-2 border-slate-600 px-6 text-lg font-medium text-slate-300 hover:bg-slate-700"
        >
          Otra persona ({resto.length}) ▾
        </button>
      )}
      {resto.length > 0 && verTodos && (
        <div className="space-y-3 rounded-xl border-2 border-slate-700 p-3">
          <p className="text-base uppercase tracking-wider text-slate-500">Resto del personal</p>
          <div className="flex flex-wrap gap-3">{resto.map(boton)}</div>
        </div>
      )}

      {nombreSesion && (
        <div className="border-t border-slate-700 pt-4">
          <button
            type="button"
            onClick={() => onChange(value === nombreSesion ? '' : nombreSesion)}
            className={cn(
              'min-h-[56px] rounded-xl px-6 text-lg font-medium transition',
              value === nombreSesion
                ? 'bg-teal-400 text-slate-900 ring-4 ring-teal-200'
                : 'border-2 border-slate-600 text-slate-300 hover:bg-slate-700',
            )}
          >
            Estoy con mi usuario: {nombreSesion}
          </button>
        </div>
      )}

      {sinNadie && (
        <p className="text-lg text-amber-300">
          No hay nadie activo cargado en {local === 'vedia' ? 'Vedia' : 'Saavedra'}. Se cargan en
          RRHH.
        </p>
      )}
    </div>
  );
}
