import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useAgendaItems, useToggleCompletado } from './useAgenda';
import { NuevoItemModal } from './NuevoItemModal';
import type { AgendaItem } from './types';
import { TIPO_ICONO, PRIORIDAD_COLOR } from './types';

const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function mismaSemana(d1: Date, d2: Date) {
  return ymd(d1) === ymd(d2);
}

function getGrillaMes(anio: number, mes: number): Date[] {
  // mes: 0-11
  const primer = new Date(anio, mes, 1);
  // Empieza el lunes anterior (o el mismo si es lunes)
  const diaSemana = (primer.getDay() + 6) % 7; // 0=Lun, 6=Dom
  const inicio = new Date(anio, mes, 1 - diaSemana);
  // 6 semanas = 42 días
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(inicio);
    d.setDate(inicio.getDate() + i);
    return d;
  });
}

export function CalendarioTab({ usuarioId }: { usuarioId?: string }) {
  const { data: items } = useAgendaItems(usuarioId);
  const toggle = useToggleCompletado();
  const [mesActual, setMesActual] = useState(() => {
    const h = new Date();
    return { anio: h.getFullYear(), mes: h.getMonth() };
  });
  const [diaSeleccionado, setDiaSeleccionado] = useState<string | null>(null);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [editando, setEditando] = useState<AgendaItem | null>(null);
  const [fechaPrellenada, setFechaPrellenada] = useState<string | undefined>();

  const itemsPorDia = useMemo(() => {
    const map = new Map<string, AgendaItem[]>();
    for (const item of items ?? []) {
      const key = ymd(new Date(item.fecha_inicio));
      const arr = map.get(key) ?? [];
      arr.push(item);
      map.set(key, arr);
    }
    return map;
  }, [items]);

  const grilla = useMemo(
    () => getGrillaMes(mesActual.anio, mesActual.mes),
    [mesActual],
  );

  const hoy = new Date();
  const diaSel = diaSeleccionado ?? ymd(hoy);
  const itemsDelDia = itemsPorDia.get(diaSel) ?? [];

  function navegar(delta: number) {
    setMesActual((m) => {
      let mes = m.mes + delta;
      let anio = m.anio;
      while (mes < 0) {
        mes += 12;
        anio--;
      }
      while (mes > 11) {
        mes -= 12;
        anio++;
      }
      return { anio, mes };
    });
  }

  return (
    <div className="space-y-4">
      {/* Header del mes */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navegar(-1)}
            className="rounded border border-gray-200 px-2 py-1 text-sm hover:bg-gray-50"
          >
            ←
          </button>
          <button
            onClick={() => {
              const h = new Date();
              setMesActual({ anio: h.getFullYear(), mes: h.getMonth() });
              setDiaSeleccionado(ymd(h));
            }}
            className="rounded border border-gray-200 px-3 py-1 text-sm hover:bg-gray-50"
          >
            Hoy
          </button>
          <button
            onClick={() => navegar(1)}
            className="rounded border border-gray-200 px-2 py-1 text-sm hover:bg-gray-50"
          >
            →
          </button>
          <h2 className="ml-3 text-lg font-semibold text-gray-900">
            {MESES[mesActual.mes]} {mesActual.anio}
          </h2>
        </div>
        <button
          onClick={() => {
            setEditando(null);
            setFechaPrellenada(diaSel);
            setModalAbierto(true);
          }}
          className="rounded-md bg-rodziny-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-rodziny-700"
        >
          + Nuevo
        </button>
      </div>

      <div className="grid grid-cols-[1fr,320px] gap-4">
        {/* Grilla mensual */}
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          {/* Días de la semana */}
          <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50">
            {DIAS_SEMANA.map((d) => (
              <div
                key={d}
                className="px-2 py-2 text-center text-xs font-semibold uppercase text-gray-600"
              >
                {d}
              </div>
            ))}
          </div>
          {/* 6 semanas */}
          <div className="grid grid-cols-7">
            {grilla.map((d, i) => {
              const key = ymd(d);
              const items = itemsPorDia.get(key) ?? [];
              const esMesActual = d.getMonth() === mesActual.mes;
              const esHoy = mismaSemana(d, hoy);
              const esSeleccionado = key === diaSel;
              const noCompletadas = items.filter((i) => !i.completado);
              return (
                <button
                  key={i}
                  onClick={() => setDiaSeleccionado(key)}
                  className={cn(
                    'flex h-24 flex-col items-stretch border-b border-r border-gray-100 p-1 text-left transition-colors hover:bg-rodziny-50',
                    !esMesActual && 'bg-gray-50/50 text-gray-400',
                    esSeleccionado && 'ring-2 ring-rodziny-500 ring-inset',
                  )}
                >
                  <div
                    className={cn(
                      'mb-1 flex h-6 w-6 items-center justify-center self-end rounded-full text-xs',
                      esHoy && 'bg-rodziny-600 font-bold text-white',
                      !esHoy && esMesActual && 'text-gray-700',
                    )}
                  >
                    {d.getDate()}
                  </div>
                  <div className="flex-1 space-y-0.5 overflow-hidden">
                    {noCompletadas.slice(0, 2).map((item) => {
                      const prio = item.prioridad ? PRIORIDAD_COLOR[item.prioridad] : null;
                      return (
                        <div
                          key={item.id}
                          className={cn(
                            'flex items-center gap-1 truncate rounded px-1 py-0.5 text-[10px]',
                            prio ? `${prio.bg} ${prio.text}` : 'bg-gray-100 text-gray-700',
                          )}
                        >
                          <span>{TIPO_ICONO[item.tipo]}</span>
                          <span className="truncate">{item.titulo}</span>
                        </div>
                      );
                    })}
                    {noCompletadas.length > 2 && (
                      <div className="text-[10px] text-gray-400">+{noCompletadas.length - 2}</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Panel del día seleccionado */}
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold text-gray-700">
            {(() => {
              const [y, m, d] = diaSel.split('-').map(Number);
              const f = new Date(y, m - 1, d);
              return `${DIAS_SEMANA[(f.getDay() + 6) % 7]} ${d} de ${MESES[m - 1]}`;
            })()}
          </h3>
          {itemsDelDia.length === 0 ? (
            <p className="text-sm text-gray-400">Sin items para este día</p>
          ) : (
            <div className="space-y-2">
              {itemsDelDia.map((item) => (
                <div
                  key={item.id}
                  className={cn(
                    'flex items-start gap-2 rounded border border-gray-100 p-2 text-sm',
                    item.completado && 'opacity-50',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={item.completado}
                    onChange={(e) =>
                      toggle.mutate({ id: item.id, completado: e.target.checked })
                    }
                    className="mt-0.5 h-4 w-4 cursor-pointer"
                  />
                  <div
                    className="min-w-0 flex-1 cursor-pointer"
                    onClick={() => {
                      setEditando(item);
                      setModalAbierto(true);
                    }}
                  >
                    <div
                      className={cn(
                        'truncate font-medium',
                        item.completado ? 'line-through' : 'text-gray-900',
                      )}
                    >
                      {TIPO_ICONO[item.tipo]} {item.titulo}
                    </div>
                    {!item.all_day && (
                      <div className="text-xs text-gray-500">
                        {new Date(item.fecha_inicio).toTimeString().substring(0, 5)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {modalAbierto && (
        <NuevoItemModal
          editando={editando}
          fechaInicial={fechaPrellenada}
          usuarioId={usuarioId}
          onClose={() => {
            setModalAbierto(false);
            setEditando(null);
            setFechaPrellenada(undefined);
          }}
        />
      )}
    </div>
  );
}
