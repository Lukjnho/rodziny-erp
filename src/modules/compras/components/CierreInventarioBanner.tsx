import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { CierreInventarioModal } from './CierreInventarioModal';

interface Cierre {
  id: string;
  local: string;
  periodo: string;
  fecha_cierre: string;
  estado: 'pendiente' | 'aprobado' | 'rechazado';
  cerrado_por: string | null;
  observacion_aprobacion: string | null;
}

const NOMBRE_MES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function periodoFromDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function fechaCorta(iso: string) {
  return new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}

// El "cierre que toca tener listo" según el día del mes.
//   - Día 1-23 → el del mes anterior (ya debería estar hecho).
//   - Día 24-31 → el del mes actual (en ventana de cierre).
// Devuelve también si estamos en ventana activa (afecta el copy).
function cierreQueToca(hoy: Date): { periodo: string; mesLabel: string; enVentana: boolean } {
  const dia = hoy.getDate();
  if (dia >= 24) {
    return {
      periodo: periodoFromDate(hoy),
      mesLabel: NOMBRE_MES[hoy.getMonth()],
      enVentana: true,
    };
  }
  const ant = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 15);
  return {
    periodo: periodoFromDate(ant),
    mesLabel: NOMBRE_MES[ant.getMonth()],
    enVentana: dia <= 5,
  };
}

export function CierreInventarioBanner({ local }: { local: 'vedia' | 'saavedra' }) {
  const [modalAbierto, setModalAbierto] = useState(false);
  const toca = cierreQueToca(new Date());

  const { data: cierreToca } = useQuery({
    queryKey: ['edr_cierre_que_toca', local, toca.periodo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('edr_cierres_inventario')
        .select('id, local, periodo, fecha_cierre, estado, cerrado_por, observacion_aprobacion')
        .eq('local', local)
        .eq('periodo', toca.periodo)
        .maybeSingle();
      if (error) throw error;
      return data as Cierre | null;
    },
  });

  // Aprobado → sin banner (Lucas no quiere confirmaciones, solo alertas).
  if (cierreToca?.estado === 'aprobado') return null;

  // Pendiente → gris, alerta de que está trabado en aprobación.
  if (cierreToca?.estado === 'pendiente') {
    return (
      <div className="mb-4 rounded-lg border border-gray-300 bg-gray-50 px-4 py-2">
        <div className="flex items-center gap-2 text-xs text-gray-700">
          <span className="text-base">⏳</span>
          <span>
            Cierre <span className="font-semibold">{toca.mesLabel} {toca.periodo.split('-')[0]}</span>{' '}
            esperando aprobación de Lucas
            {cierreToca.cerrado_por && ` (enviado por ${cierreToca.cerrado_por}`}
            {cierreToca.cerrado_por && ` el ${fechaCorta(cierreToca.fecha_cierre)})`}
          </span>
        </div>
      </div>
    );
  }

  // Rechazado → rojo, hay que re-cerrar.
  if (cierreToca?.estado === 'rechazado') {
    return (
      <>
        <div className="mb-4 rounded-lg border-2 border-red-300 bg-red-50 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="text-2xl">❌</span>
              <div>
                <p className="text-sm font-semibold text-red-900">
                  Cierre {toca.mesLabel} {toca.periodo.split('-')[0]} rechazado por Lucas
                </p>
                {cierreToca.observacion_aprobacion && (
                  <p className="mt-0.5 text-xs text-red-700">
                    Motivo: {cierreToca.observacion_aprobacion}
                  </p>
                )}
                <p className="mt-1 text-xs text-red-800">
                  Revisá lo señalado y hacé un cierre nuevo.
                </p>
              </div>
            </div>
            <button
              onClick={() => setModalAbierto(true)}
              className="shrink-0 rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
            >
              Re-cerrar
            </button>
          </div>
        </div>
        {modalAbierto && (
          <CierreInventarioModal
            local={local}
            periodo={toca.periodo}
            mesLabel={toca.mesLabel}
            cierrePrevioId={cierreToca.id}
            onClose={() => setModalAbierto(false)}
          />
        )}
      </>
    );
  }

  // No hay cierre cargado.
  // En ventana → amarillo (recordatorio anticipado, "esta semana hacelo").
  // Fuera de ventana → rojo "olvido" (ya pasó la ventana, EdR sin Δ).
  const claseColor = toca.enVentana ? 'border-amber-300 bg-amber-50' : 'border-red-400 bg-red-50';
  const claseColorBoton = toca.enVentana
    ? 'bg-amber-600 hover:bg-amber-700'
    : 'bg-red-600 hover:bg-red-700';
  const icono = toca.enVentana ? '📅' : '🚨';
  const titulo = toca.enVentana
    ? `Esta semana: cerrá inventario de ${toca.mesLabel}`
    : `Falta cierre de inventario de ${toca.mesLabel}`;
  const subtitulo = toca.enVentana
    ? 'Hacé el conteo físico y cargá los ajustes en Stock antes de cerrar. Esto fija el stock final del mes en el EdR.'
    : 'Ya pasó la ventana de cierre y no se cargó. Hacelo cuanto antes — el EdR de este mes no va a tener Δ inventario hasta que esté.';
  const claseTituloColor = toca.enVentana ? 'text-amber-900' : 'text-red-900';
  const claseSubtituloColor = toca.enVentana ? 'text-amber-800' : 'text-red-800';
  const claseBorde = toca.enVentana ? 'border' : 'border-2';

  return (
    <>
      <div className={`mb-4 rounded-lg ${claseBorde} ${claseColor} px-4 py-3`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="text-2xl">{icono}</span>
            <div>
              <p className={`text-sm font-semibold ${claseTituloColor}`}>{titulo}</p>
              <p className={`mt-0.5 text-xs ${claseSubtituloColor}`}>{subtitulo}</p>
            </div>
          </div>
          <button
            onClick={() => setModalAbierto(true)}
            className={`shrink-0 rounded-md ${claseColorBoton} px-3 py-1.5 text-xs font-semibold text-white`}
          >
            {toca.enVentana ? 'Hacer cierre' : 'Cerrar ahora'}
          </button>
        </div>
      </div>
      {modalAbierto && (
        <CierreInventarioModal
          local={local}
          periodo={toca.periodo}
          mesLabel={toca.mesLabel}
          onClose={() => setModalAbierto(false)}
        />
      )}
    </>
  );
}
