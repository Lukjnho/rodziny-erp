import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

interface PizarronItem {
  id: string;
  fecha_objetivo: string;
  local: string;
  turno: 'mañana' | 'tarde' | null;
  tipo: 'relleno' | 'masa' | 'salsa' | 'postre' | 'pasteleria' | 'panaderia';
  receta_id: string | null;
  texto_libre: string | null;
  cantidad_recetas: number;
  cantidad_hecha: number | null;
  estado: 'pendiente' | 'hecho' | 'parcial' | 'cancelado';
  notas: string | null;
  completado_en: string | null;
  receta?: { nombre: string } | null;
}

const TIPO_LABEL: Record<PizarronItem['tipo'], string> = {
  relleno: 'Rellenos',
  masa: 'Masas',
  salsa: 'Salsas',
  postre: 'Postres',
  pasteleria: 'Pastelería',
  panaderia: 'Panadería',
};

const TIPO_EMOJI: Record<PizarronItem['tipo'], string> = {
  relleno: '🥟',
  masa: '🍝',
  salsa: '🍅',
  postre: '🍰',
  pasteleria: '🥐',
  panaderia: '🍞',
};

export function PlanProduccionHoy({
  fecha,
  local,
  onAbrirEditor,
}: {
  fecha: string;
  local: 'vedia' | 'saavedra';
  onAbrirEditor: () => void;
}) {
  const { data: items, isLoading } = useQuery({
    queryKey: ['cocina-pizarron-hoy', fecha, local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_pizarron_items')
        .select(
          'id, fecha_objetivo, local, turno, tipo, receta_id, texto_libre, cantidad_recetas, cantidad_hecha, estado, notas, completado_en, receta:cocina_recetas(nombre)',
        )
        .eq('fecha_objetivo', fecha)
        .eq('local', local)
        .order('tipo')
        .order('turno');
      if (error) throw error;
      return (data ?? []) as unknown as PizarronItem[];
    },
  });

  const activos = (items ?? []).filter((it) => it.estado !== 'cancelado');
  const hechos = activos.filter((it) => it.estado === 'hecho' || it.estado === 'parcial').length;
  const total = activos.length;
  const pct = total === 0 ? 0 : Math.round((hechos / total) * 100);

  const porTipo = new Map<PizarronItem['tipo'], PizarronItem[]>();
  for (const it of activos) {
    const arr = porTipo.get(it.tipo) ?? [];
    arr.push(it);
    porTipo.set(it.tipo, arr);
  }

  return (
    <div className="rounded-lg border border-surface-border bg-white">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Plan del día</h3>
          <p className="text-[11px] text-gray-500 capitalize">
            {local} ·{' '}
            {total === 0
              ? 'Sin plan definido'
              : `${hechos} de ${total} cumplidos · ${pct}%`}
          </p>
        </div>
        <button
          onClick={onAbrirEditor}
          className="rounded bg-rodziny-700 px-3 py-1.5 text-sm text-white hover:bg-rodziny-800"
        >
          {total === 0 ? 'Definir plan' : 'Editar plan'}
        </button>
      </div>

      {isLoading ? (
        <div className="px-4 py-6 text-center text-xs text-gray-400">Cargando…</div>
      ) : total === 0 ? (
        <div className="px-4 py-8 text-center text-xs text-gray-400">
          Todavía no cargaste el plan de producción de hoy.
        </div>
      ) : (
        <div className="p-3">
          {/* Barra de progreso */}
          <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full bg-green-500 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {Array.from(porTipo.entries()).map(([tipo, itemsTipo]) => (
              <div key={tipo} className="rounded border border-gray-100 bg-gray-50 p-2">
                <div className="mb-1.5 text-xs font-semibold text-gray-700">
                  {TIPO_EMOJI[tipo]} {TIPO_LABEL[tipo]}
                </div>
                <div className="space-y-1">
                  {itemsTipo.map((it) => {
                    const hecho = it.estado === 'hecho';
                    const parcial = it.estado === 'parcial';
                    const nombre = it.receta?.nombre ?? it.texto_libre ?? '(sin receta)';
                    return (
                      <div
                        key={it.id}
                        className={cn(
                          'flex items-center justify-between rounded bg-white px-2 py-1 text-xs',
                          hecho && 'border-l-2 border-green-400',
                          parcial && 'border-l-2 border-amber-400',
                          !hecho && !parcial && 'border-l-2 border-gray-200',
                        )}
                      >
                        <div className="flex flex-1 items-center gap-1.5 truncate">
                          <span className="text-sm">
                            {hecho ? '✅' : parcial ? '🟡' : '⏳'}
                          </span>
                          <span
                            className={cn(
                              'truncate',
                              hecho ? 'text-gray-500 line-through' : 'text-gray-800',
                            )}
                          >
                            {nombre}
                          </span>
                          <span className="text-gray-400">×{it.cantidad_recetas}</span>
                          {it.turno && (
                            <span className="text-[10px] text-gray-400">
                              {it.turno === 'mañana' ? '🌅' : '🌇'}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
