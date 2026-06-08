import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import {
  useAgendaItems,
  useToggleCompletado,
  useEliminarItem,
  useCompaneros,
} from './useAgenda';
import { NuevoItemModal } from './NuevoItemModal';
import type { AgendaItem } from './types';
import { TIPO_ICONO, PRIORIDAD_COLOR } from './types';

type Grupo = 'atrasadas' | 'hoy' | 'manana' | 'semana' | 'futuras' | 'hechas';

const GRUPO_TITULO: Record<Grupo, string> = {
  atrasadas: 'Atrasadas',
  hoy: 'Hoy',
  manana: 'Mañana',
  semana: 'Esta semana',
  futuras: 'Más adelante',
  hechas: 'Hechas',
};

const GRUPO_COLOR: Record<Grupo, string> = {
  atrasadas: 'text-red-700 bg-red-50 border-red-200',
  hoy: 'text-rodziny-700 bg-rodziny-50 border-rodziny-200',
  manana: 'text-amber-700 bg-amber-50 border-amber-200',
  semana: 'text-blue-700 bg-blue-50 border-blue-200',
  futuras: 'text-gray-700 bg-gray-50 border-gray-200',
  hechas: 'text-gray-500 bg-gray-50 border-gray-200',
};

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function clasificar(item: AgendaItem, hoy: Date, manana: Date, finSemana: Date): Grupo {
  if (item.completado) return 'hechas';
  const inicio = startOfDay(new Date(item.fecha_inicio));
  if (inicio < hoy) return 'atrasadas';
  if (inicio.getTime() === hoy.getTime()) return 'hoy';
  if (inicio.getTime() === manana.getTime()) return 'manana';
  if (inicio <= finSemana) return 'semana';
  return 'futuras';
}

function formatFechaHora(iso: string, allDay: boolean) {
  const d = new Date(iso);
  const dias = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const dia = `${dias[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  if (allDay) return dia;
  const hora = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${dia} · ${hora}`;
}

export function ListaTab({ usuarioId }: { usuarioId?: string }) {
  const { data: items, isLoading } = useAgendaItems(usuarioId);
  const toggle = useToggleCompletado();
  const eliminar = useEliminarItem();
  const { user } = useAuth();
  const { data: companeros } = useCompaneros();
  const nombrePorId = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of companeros ?? []) m[c.user_id] = c.nombre;
    return m;
  }, [companeros]);
  // A quién pertenece la vista (yo, o el usuario que el admin está mirando).
  const miId = usuarioId ?? user?.id;
  const [modalAbierto, setModalAbierto] = useState(false);
  const [editando, setEditando] = useState<AgendaItem | null>(null);
  const [hechasAbiertas, setHechasAbiertas] = useState(false);

  const grupos = useMemo(() => {
    const hoy = startOfDay(new Date());
    const manana = startOfDay(new Date(hoy.getTime() + 24 * 60 * 60 * 1000));
    const finSemana = startOfDay(new Date(hoy.getTime() + 7 * 24 * 60 * 60 * 1000));

    const buckets: Record<Grupo, AgendaItem[]> = {
      atrasadas: [],
      hoy: [],
      manana: [],
      semana: [],
      futuras: [],
      hechas: [],
    };
    for (const item of items ?? []) {
      buckets[clasificar(item, hoy, manana, finSemana)].push(item);
    }
    // Ordenar hechas por completado_at descendente
    buckets.hechas.sort((a, b) => {
      const ta = a.completado_at ? new Date(a.completado_at).getTime() : 0;
      const tb = b.completado_at ? new Date(b.completado_at).getTime() : 0;
      return tb - ta;
    });
    return buckets;
  }, [items]);

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
        Cargando...
      </div>
    );
  }

  const ordenGrupos: Grupo[] = ['atrasadas', 'hoy', 'manana', 'semana', 'futuras'];
  const totalActivas = ordenGrupos.reduce((s, g) => s + grupos[g].length, 0);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">
          {totalActivas} {totalActivas === 1 ? 'pendiente' : 'pendientes'}
          {grupos.hechas.length > 0 && (
            <span className="ml-2 text-gray-400">· {grupos.hechas.length} hechas</span>
          )}
        </div>
        <button
          onClick={() => {
            setEditando(null);
            setModalAbierto(true);
          }}
          className="rounded-md bg-rodziny-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-rodziny-700"
        >
          + Nuevo
        </button>
      </div>

      {totalActivas === 0 && grupos.hechas.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-12 text-center">
          <div className="mb-3 text-4xl">📅</div>
          <p className="mb-1 font-medium text-gray-700">Tu agenda está vacía</p>
          <p className="text-sm text-gray-500">
            Cargá tareas, eventos o recordatorios con el botón + Nuevo
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {ordenGrupos.map((g) =>
            grupos[g].length === 0 ? null : (
              <SeccionGrupo
                key={g}
                grupo={g}
                items={grupos[g]}
                nombrePorId={nombrePorId}
                miId={miId}
                onToggle={(id, completado) => toggle.mutate({ id, completado })}
                onEditar={(item) => {
                  setEditando(item);
                  setModalAbierto(true);
                }}
                onEliminar={(id) => {
                  if (confirm('¿Eliminar este item?')) eliminar.mutate(id);
                }}
              />
            ),
          )}

          {grupos.hechas.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white">
              <button
                onClick={() => setHechasAbiertas((v) => !v)}
                className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-gray-600 hover:bg-gray-50"
              >
                <span>
                  Hechas <span className="text-gray-400">({grupos.hechas.length})</span>
                </span>
                <span className="text-xs text-gray-400">{hechasAbiertas ? '▲' : '▼'}</span>
              </button>
              {hechasAbiertas && (
                <div className="border-t border-gray-100">
                  {grupos.hechas.map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      nombrePorId={nombrePorId}
                      miId={miId}
                      onToggle={(c) => toggle.mutate({ id: item.id, completado: c })}
                      onEditar={() => {
                        setEditando(item);
                        setModalAbierto(true);
                      }}
                      onEliminar={() => {
                        if (confirm('¿Eliminar este item?')) eliminar.mutate(item.id);
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {modalAbierto && (
        <NuevoItemModal
          editando={editando}
          usuarioId={usuarioId}
          onClose={() => {
            setModalAbierto(false);
            setEditando(null);
          }}
        />
      )}
    </div>
  );
}

function SeccionGrupo({
  grupo,
  items,
  nombrePorId,
  miId,
  onToggle,
  onEditar,
  onEliminar,
}: {
  grupo: Grupo;
  items: AgendaItem[];
  nombrePorId: Record<string, string>;
  miId?: string;
  onToggle: (id: string, completado: boolean) => void;
  onEditar: (item: AgendaItem) => void;
  onEliminar: (id: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border bg-white">
      <div
        className={cn(
          'flex items-center justify-between border-b px-4 py-2 text-sm font-medium',
          GRUPO_COLOR[grupo],
        )}
      >
        <span>{GRUPO_TITULO[grupo]}</span>
        <span className="text-xs">
          {items.length} {items.length === 1 ? 'item' : 'items'}
        </span>
      </div>
      <div>
        {items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            nombrePorId={nombrePorId}
            miId={miId}
            atrasada={grupo === 'atrasadas'}
            onToggle={(c) => onToggle(item.id, c)}
            onEditar={() => onEditar(item)}
            onEliminar={() => onEliminar(item.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ItemRow({
  item,
  nombrePorId,
  miId,
  atrasada,
  onToggle,
  onEditar,
  onEliminar,
}: {
  item: AgendaItem;
  nombrePorId: Record<string, string>;
  miId?: string;
  atrasada?: boolean;
  onToggle: (completado: boolean) => void;
  onEditar: () => void;
  onEliminar: () => void;
}) {
  const prio = item.prioridad ? PRIORIDAD_COLOR[item.prioridad] : null;
  // Si yo soy asignado pero no el creador, la tarea me la compartieron.
  const meLaCompartieron = miId != null && item.usuario_id !== miId;
  const nombreCreador = nombrePorId[item.usuario_id];
  const otrosAsignados = (item.asignados ?? []).filter((id) => id !== miId);
  const nombresCompartido = otrosAsignados
    .map((id) => nombrePorId[id])
    .filter(Boolean);
  return (
    <div
      className={cn(
        'group flex items-center gap-3 border-t border-gray-100 px-4 py-2.5 text-sm transition-colors first:border-t-0 hover:bg-gray-50',
        item.completado && 'opacity-50',
      )}
    >
      <input
        type="checkbox"
        checked={item.completado}
        onChange={(e) => onToggle(e.target.checked)}
        className="h-4 w-4 cursor-pointer rounded border-gray-300 text-rodziny-600 focus:ring-rodziny-500"
      />
      <span className="text-base" title={item.tipo}>
        {TIPO_ICONO[item.tipo]}
      </span>
      <div className="min-w-0 flex-1 cursor-pointer" onClick={onEditar}>
        <div
          className={cn(
            'truncate font-medium',
            item.completado ? 'text-gray-500 line-through' : 'text-gray-900',
          )}
        >
          {item.titulo}
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span className={cn(atrasada && !item.completado && 'font-semibold text-red-600')}>
            {formatFechaHora(item.fecha_inicio, item.all_day)}
          </span>
          {item.recurrencia && <span className="text-rodziny-600">🔁</span>}
          {item.nota && <span className="text-gray-400">· {item.nota.substring(0, 40)}{item.nota.length > 40 ? '…' : ''}</span>}
          {meLaCompartieron && nombreCreador && (
            <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700">
              👤 de {nombreCreador}
            </span>
          )}
          {nombresCompartido.length > 0 && (
            <span
              className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700"
              title={nombresCompartido.join(', ')}
            >
              👥 {nombresCompartido.join(', ')}
            </span>
          )}
        </div>
      </div>
      {prio && !item.completado && (
        <span
          className={cn('rounded-full px-2 py-0.5 text-xs font-medium', prio.bg, prio.text)}
        >
          {item.prioridad}
        </span>
      )}
      <button
        onClick={onEliminar}
        className="text-gray-300 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
        title="Eliminar"
      >
        ✕
      </button>
    </div>
  );
}
