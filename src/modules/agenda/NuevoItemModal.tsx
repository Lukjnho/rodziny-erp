import { useState, useEffect, type FormEvent } from 'react';
import { cn } from '@/lib/utils';
import { useCrearItem, useActualizarItem } from './useAgenda';
import type {
  AgendaItem,
  AgendaItemInput,
  TipoItem,
  Prioridad,
  FrecuenciaRecurrencia,
} from './types';
import { TIPO_LABEL } from './types';

interface Props {
  editando: AgendaItem | null;
  fechaInicial?: string; // YYYY-MM-DD opcional para pre-llenar
  usuarioId?: string; // a quién se le crea el item (admin asignando a otro)
  onClose: () => void;
}

function nowLocalDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function nowLocalTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function isoToParts(iso: string): { fecha: string; hora: string } {
  const d = new Date(iso);
  return {
    fecha: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    hora: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
  };
}

function partsToIso(fecha: string, hora: string | null, allDay: boolean): string {
  if (allDay) {
    return new Date(`${fecha}T12:00:00`).toISOString();
  }
  return new Date(`${fecha}T${hora || '12:00'}:00`).toISOString();
}

export function NuevoItemModal({ editando, fechaInicial, usuarioId, onClose }: Props) {
  const crear = useCrearItem(usuarioId);
  const actualizar = useActualizarItem();

  const [tipo, setTipo] = useState<TipoItem>(editando?.tipo ?? 'tarea');
  const [titulo, setTitulo] = useState(editando?.titulo ?? '');
  const [fecha, setFecha] = useState(() => {
    if (editando) return isoToParts(editando.fecha_inicio).fecha;
    if (fechaInicial) return fechaInicial;
    return nowLocalDate();
  });
  const [hora, setHora] = useState(() => {
    if (editando && !editando.all_day) return isoToParts(editando.fecha_inicio).hora;
    return nowLocalTime();
  });
  const [allDay, setAllDay] = useState(editando?.all_day ?? true);
  const [prioridad, setPrioridad] = useState<Prioridad | ''>(editando?.prioridad ?? '');
  const [nota, setNota] = useState(editando?.nota ?? '');
  const [recurrenciaFreq, setRecurrenciaFreq] = useState<FrecuenciaRecurrencia | ''>(
    editando?.recurrencia?.freq ?? '',
  );

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!titulo.trim()) {
      setError('El título es obligatorio');
      return;
    }
    setGuardando(true);
    setError(null);

    const input: AgendaItemInput = {
      titulo: titulo.trim(),
      tipo,
      fecha_inicio: partsToIso(fecha, hora, allDay),
      fecha_fin: null,
      all_day: allDay,
      prioridad: prioridad || null,
      recurrencia: recurrenciaFreq ? { freq: recurrenciaFreq, interval: 1 } : null,
      nota: nota.trim() || null,
    };

    try {
      if (editando) {
        await actualizar.mutateAsync({ id: editando.id, input });
      } else {
        await crear.mutateAsync(input);
      }
      onClose();
    } catch (e: any) {
      setError(e.message || 'Error al guardar');
      setGuardando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/40" />
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">
            {editando ? 'Editar' : 'Nuevo item'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3">
          {/* Tipo */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Tipo</label>
            <div className="flex gap-2">
              {(['tarea', 'evento', 'recordatorio'] as TipoItem[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTipo(t)}
                  className={cn(
                    'flex-1 rounded border px-3 py-1.5 text-sm transition-colors',
                    tipo === t
                      ? 'border-rodziny-500 bg-rodziny-50 font-medium text-rodziny-700'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50',
                  )}
                >
                  {TIPO_LABEL[t]}
                </button>
              ))}
            </div>
          </div>

          {/* Título */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Título</label>
            <input
              type="text"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              autoFocus
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-rodziny-500 focus:outline-none focus:ring-1 focus:ring-rodziny-500"
              placeholder="Ej: Reunión con Maxi"
            />
          </div>

          {/* Fecha + Hora */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Fecha</label>
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-rodziny-500 focus:outline-none focus:ring-1 focus:ring-rodziny-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Hora {allDay && <span className="text-gray-400">(sin hora)</span>}
              </label>
              <input
                type="time"
                value={hora}
                onChange={(e) => setHora(e.target.value)}
                disabled={allDay}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-rodziny-500 focus:outline-none focus:ring-1 focus:ring-rodziny-500 disabled:bg-gray-100"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
              className="h-4 w-4"
            />
            Todo el día
          </label>

          {/* Prioridad */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Prioridad <span className="text-gray-400">(opcional)</span>
            </label>
            <div className="flex gap-2">
              {(['', 'baja', 'media', 'alta'] as const).map((p) => (
                <button
                  key={p || 'none'}
                  type="button"
                  onClick={() => setPrioridad(p)}
                  className={cn(
                    'flex-1 rounded border px-3 py-1.5 text-sm transition-colors',
                    prioridad === p
                      ? 'border-rodziny-500 bg-rodziny-50 font-medium text-rodziny-700'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50',
                  )}
                >
                  {p || 'ninguna'}
                </button>
              ))}
            </div>
          </div>

          {/* Recurrencia */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Recurrencia <span className="text-gray-400">(opcional)</span>
            </label>
            <select
              value={recurrenciaFreq}
              onChange={(e) => setRecurrenciaFreq(e.target.value as FrecuenciaRecurrencia | '')}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-rodziny-500 focus:outline-none focus:ring-1 focus:ring-rodziny-500"
            >
              <option value="">No se repite</option>
              <option value="daily">Diaria</option>
              <option value="weekly">Semanal</option>
              <option value="monthly">Mensual</option>
            </select>
          </div>

          {/* Nota */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Nota <span className="text-gray-400">(opcional)</span>
            </label>
            <textarea
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              rows={2}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-rodziny-500 focus:outline-none focus:ring-1 focus:ring-rodziny-500"
              placeholder="Detalles adicionales..."
            />
          </div>

          {error && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={guardando}
            className="rounded bg-rodziny-600 px-4 py-2 text-sm font-medium text-white hover:bg-rodziny-700 disabled:opacity-50"
          >
            {guardando ? 'Guardando...' : editando ? 'Guardar cambios' : 'Crear'}
          </button>
        </div>
      </form>
    </div>
  );
}
