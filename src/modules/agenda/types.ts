export type TipoItem = 'evento' | 'tarea' | 'recordatorio';
export type Prioridad = 'alta' | 'media' | 'baja';
export type FrecuenciaRecurrencia = 'daily' | 'weekly' | 'monthly';

export interface Recurrencia {
  freq: FrecuenciaRecurrencia;
  interval: number;
}

export interface AgendaItem {
  id: string;
  usuario_id: string;
  titulo: string;
  tipo: TipoItem;
  fecha_inicio: string; // ISO timestamptz
  fecha_fin: string | null;
  all_day: boolean;
  prioridad: Prioridad | null;
  completado: boolean;
  completado_at: string | null;
  recurrencia: Recurrencia | null;
  nota: string | null;
  asignados: string[]; // user_id de las personas con quienes se comparte
  created_at: string;
}

export interface AgendaItemInput {
  titulo: string;
  tipo: TipoItem;
  fecha_inicio: string;
  fecha_fin: string | null;
  all_day: boolean;
  prioridad: Prioridad | null;
  recurrencia: Recurrencia | null;
  nota: string | null;
  asignados: string[];
}

export const TIPO_LABEL: Record<TipoItem, string> = {
  evento: 'Evento',
  tarea: 'Tarea',
  recordatorio: 'Recordatorio',
};

export const TIPO_ICONO: Record<TipoItem, string> = {
  evento: '📅',
  tarea: '✓',
  recordatorio: '🔔',
};

export const PRIORIDAD_COLOR: Record<Prioridad, { bg: string; text: string; dot: string }> = {
  alta: { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
  media: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
  baja: { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
};
