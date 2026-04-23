import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

interface Pedido {
  id: string;
  producto_nombre: string;
  cantidad: number;
  cliente_nombre: string;
  cliente_telefono: string | null;
  fecha_entrega: string;
  turno: string;
  estado: string;
  observaciones: string | null;
}

const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function getLunesDeSemana(offset: number): Date {
  const hoy = new Date();
  const dia = hoy.getDay();
  // getDay: 0=dom, 1=lun...  Queremos lunes
  const diffLunes = dia === 0 ? -6 : 1 - dia;
  const lunes = new Date(hoy);
  lunes.setDate(hoy.getDate() + diffLunes + offset * 7);
  lunes.setHours(0, 0, 0, 0);
  return lunes;
}

function formatDate(d: Date): string {
  return d.toISOString().substring(0, 10);
}

function formatDiaMes(d: Date): string {
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

const ESTADO_COLORES: Record<string, { bg: string; text: string; dot: string }> = {
  pendiente: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-400' },
  en_preparacion: { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-400' },
  listo: { bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-400' },
  entregado: { bg: 'bg-gray-50', text: 'text-gray-500', dot: 'bg-gray-300' },
  cancelado: { bg: 'bg-red-50', text: 'text-red-400 line-through', dot: 'bg-red-300' },
};

export function CalendarioTab() {
  const [semanaOffset, setSemanaOffset] = useState(0);

  const lunes = getLunesDeSemana(semanaOffset);
  const diasSemana = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(lunes);
    d.setDate(lunes.getDate() + i);
    return d;
  });

  const desde = formatDate(diasSemana[0]);
  const hasta = formatDate(diasSemana[6]);

  const { data: pedidos, isLoading } = useQuery({
    queryKey: ['almacen-calendario', desde, hasta],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('almacen_pedidos')
        .select(
          'id, producto_nombre, cantidad, cliente_nombre, cliente_telefono, fecha_entrega, turno, estado, observaciones',
        )
        .gte('fecha_entrega', desde)
        .lte('fecha_entrega', hasta)
        .neq('estado', 'cancelado')
        .order('turno')
        .order('producto_nombre');
      if (error) throw error;
      return data as Pedido[];
    },
  });

  const hoyStr = formatDate(new Date());

  // Agrupar por fecha
  const porFecha = new Map<string, Pedido[]>();
  for (const p of pedidos ?? []) {
    const arr = porFecha.get(p.fecha_entrega) ?? [];
    arr.push(p);
    porFecha.set(p.fecha_entrega, arr);
  }

  // Resumen para el header: productos a preparar esta semana
  const resumen = new Map<string, number>();
  for (const p of pedidos ?? []) {
    if (p.estado === 'entregado') continue;
    resumen.set(p.producto_nombre, (resumen.get(p.producto_nombre) ?? 0) + p.cantidad);
  }
  const resumenOrdenado = [...resumen.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-4">
      {/* Navegación de semana */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setSemanaOffset(semanaOffset - 1)}
          className="rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-700"
        >
          ← Anterior
        </button>
        <div className="flex-1 text-center">
          <span className="text-sm font-semibold text-gray-700">
            Semana del {formatDiaMes(diasSemana[0])} al {formatDiaMes(diasSemana[6])}
          </span>
          {semanaOffset !== 0 && (
            <button
              onClick={() => setSemanaOffset(0)}
              className="ml-2 text-xs text-rodziny-600 hover:text-rodziny-700"
            >
              Hoy
            </button>
          )}
        </div>
        <button
          onClick={() => setSemanaOffset(semanaOffset + 1)}
          className="rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-700"
        >
          Siguiente →
        </button>
      </div>

      {/* Resumen de la semana */}
      {resumenOrdenado.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <div className="mb-2 text-xs font-medium text-gray-500">
            Resumen de la semana — {pedidos?.filter((p) => p.estado !== 'entregado').length ?? 0}{' '}
            pedidos pendientes
          </div>
          <div className="flex flex-wrap gap-2">
            {resumenOrdenado.map(([nombre, qty]) => (
              <span
                key={nombre}
                className="rounded-full bg-rodziny-50 px-2 py-1 text-xs font-medium text-rodziny-700"
              >
                {qty}x {nombre}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Grilla semanal */}
      {isLoading ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
          Cargando...
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-2">
          {diasSemana.map((dia, i) => {
            const fechaStr = formatDate(dia);
            const pedidosDia = porFecha.get(fechaStr) ?? [];
            const esHoy = fechaStr === hoyStr;
            const esPasado = fechaStr < hoyStr;

            return (
              <div
                key={i}
                className={cn(
                  'flex min-h-[180px] flex-col rounded-lg border',
                  esHoy ? 'border-rodziny-400 bg-rodziny-50/30' : 'border-gray-200 bg-white',
                  esPasado && !esHoy && 'opacity-60',
                )}
              >
                {/* Header del día */}
                <div
                  className={cn(
                    'border-b px-2 py-1.5 text-center',
                    esHoy ? 'border-rodziny-200 bg-rodziny-50' : 'border-gray-100',
                  )}
                >
                  <div
                    className={cn(
                      'text-xs font-semibold',
                      esHoy ? 'text-rodziny-700' : 'text-gray-600',
                    )}
                  >
                    {DIAS_SEMANA[i]}
                  </div>
                  <div
                    className={cn(
                      'text-lg font-bold',
                      esHoy ? 'text-rodziny-800' : 'text-gray-800',
                    )}
                  >
                    {dia.getDate()}
                  </div>
                  {pedidosDia.length > 0 && (
                    <div className="text-[10px] text-gray-400">
                      {pedidosDia.length} pedido{pedidosDia.length > 1 ? 's' : ''}
                    </div>
                  )}
                </div>

                {/* Pedidos del día */}
                <div className="flex-1 space-y-1 overflow-y-auto p-1.5">
                  {pedidosDia.length === 0 && (
                    <div className="mt-4 text-center text-[10px] text-gray-300">Sin pedidos</div>
                  )}
                  {pedidosDia.map((p) => {
                    const colors = ESTADO_COLORES[p.estado] ?? ESTADO_COLORES.pendiente;
                    return (
                      <div
                        key={p.id}
                        className={cn('rounded px-1.5 py-1', colors.bg)}
                        title={`${p.cliente_nombre}${p.observaciones ? ' — ' + p.observaciones : ''}`}
                      >
                        <div className="flex items-center gap-1">
                          <span
                            className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', colors.dot)}
                          />
                          <span className={cn('truncate text-[11px] font-medium', colors.text)}>
                            {p.cantidad > 1 ? `${p.cantidad}x ` : ''}
                            {p.producto_nombre}
                          </span>
                        </div>
                        <div className="truncate pl-2.5 text-[10px] text-gray-400">
                          {p.cliente_nombre} · {p.turno === 'mañana' ? 'AM' : 'PM'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Leyenda */}
      <div className="flex items-center justify-center gap-4 text-[10px] text-gray-400">
        {Object.entries(ESTADO_COLORES)
          .filter(([k]) => k !== 'cancelado')
          .map(([key, val]) => (
            <div key={key} className="flex items-center gap-1">
              <span className={cn('h-2 w-2 rounded-full', val.dot)} />
              <span className="capitalize">
                {key === 'en_preparacion' ? 'En preparación' : key}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}
