import { cn } from '@/lib/utils';
import type { ItemAgrupado } from './PlanSemanal';

interface Etapa {
  nombre: string;
  hecho: boolean;
  detalle?: React.ReactNode;
}

function fechaLarga(fecha: string): string {
  const d = new Date(fecha + 'T12:00:00');
  const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const meses = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ];
  return `${dias[d.getDay()]} ${d.getDate()} de ${meses[d.getMonth()]}`;
}

function calcularEtapas(grupo: ItemAgrupado): Etapa[] {
  const tieneRelleno = grupo.estado !== 'pendiente';
  const tieneMasa = grupo.masasUsadas.length > 0 || grupo.estado === 'en_bandejas' || grupo.estado === 'ciclo_completo';
  const tieneArmado = grupo.pastasArmadas.length > 0 || grupo.estado === 'en_bandejas' || grupo.estado === 'ciclo_completo';
  const enCamara = grupo.estado === 'ciclo_completo';

  if (grupo.tipo === 'relleno') {
    // Flujo enriquecido de pasta rellena / ñoquis (4-5 etapas).
    const etapas: Etapa[] = [
      {
        nombre: 'Relleno cargado',
        hecho: tieneRelleno,
        detalle: tieneRelleno
          ? `${grupo.totalCantidad > 0 ? `×${grupo.totalCantidad} ` : ''}lote de relleno registrado`
          : undefined,
      },
      {
        nombre: 'Masa cargada',
        hecho: tieneMasa,
        detalle: grupo.masasUsadas.length > 0 ? (
          <div className="space-y-0.5">
            {grupo.masasUsadas.map((m) => (
              <div key={m.loteMasaId} className="text-xs text-gray-600">
                🍝 {m.kg} kg · <span className="text-gray-500">{m.nombre}</span>
              </div>
            ))}
          </div>
        ) : undefined,
      },
      {
        nombre: 'Armado (en bandejas)',
        hecho: tieneArmado,
        detalle: grupo.pastasArmadas.filter((p) => p.ubicacion === 'freezer_produccion').length > 0 ? (
          <div className="space-y-0.5">
            {grupo.pastasArmadas
              .filter((p) => p.ubicacion === 'freezer_produccion')
              .map((p) => (
                <div key={p.loteId} className="text-xs text-gray-600">
                  {p.nombre} · {p.porciones} porc.
                  {p.bandejas > 0 && <span className="text-gray-400"> · ×{p.bandejas} band.</span>}
                </div>
              ))}
          </div>
        ) : undefined,
      },
      {
        nombre: 'Porcionado (en cámara)',
        hecho: enCamara,
        detalle: grupo.pastasArmadas.filter((p) => p.ubicacion === 'camara_congelado').length > 0 ? (
          <div className="space-y-0.5">
            {grupo.pastasArmadas
              .filter((p) => p.ubicacion === 'camara_congelado')
              .map((p) => (
                <div key={p.loteId} className="text-xs text-gray-600">
                  {p.nombre} · {p.porciones} porc.
                </div>
              ))}
          </div>
        ) : undefined,
      },
    ];
    return etapas;
  }

  // Tipos sin flujo (salsa / postre / pastelería / panadería).
  return [
    {
      nombre: 'Lote cargado (en cámara)',
      hecho: enCamara,
      detalle: enCamara
        ? `${grupo.totalCantidad > 0 ? `×${grupo.totalCantidad} ` : ''}registrado · disponible para venta`
        : undefined,
    },
  ];
}

export function TimelineModal({
  grupo,
  onClose,
}: {
  grupo: ItemAgrupado;
  onClose: () => void;
}) {
  const etapas = calcularEtapas(grupo);
  const completo = grupo.estado === 'ciclo_completo';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              {grupo.nombre}
              {grupo.totalCantidad > 0 && (
                <span className="ml-2 text-sm font-normal text-gray-500">
                  ×{grupo.totalCantidad}
                </span>
              )}
            </h3>
            <p className="mt-0.5 text-xs text-gray-500 capitalize">
              Planificado: {fechaLarga(grupo.fechaObjetivo)}
            </p>
            {grupo.destinoNombre && (
              <p className="mt-1 text-xs font-medium text-rodziny-600">
                🎯 Destino: {grupo.destinoNombre}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Cerrar"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M4 4L12 12M12 4L4 12"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="mb-3">
          <span
            className={cn(
              'inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold',
              completo && 'bg-green-100 text-green-800',
              grupo.estado === 'en_bandejas' && 'bg-blue-100 text-blue-800',
              grupo.estado === 'en_produccion' && 'bg-amber-100 text-amber-800',
              grupo.estado === 'pendiente' && 'bg-gray-100 text-gray-700',
            )}
          >
            {completo && '✓ Ciclo completado'}
            {grupo.estado === 'en_bandejas' && '🧊 En bandejas'}
            {grupo.estado === 'en_produccion' && '🥣 En producción'}
            {grupo.estado === 'pendiente' && '⏳ Pendiente'}
          </span>
        </div>

        <div className="space-y-3 border-t border-gray-100 pt-3">
          <div className="text-xs font-medium uppercase text-gray-400">
            Etapas del ciclo
          </div>
          <ol className="space-y-2.5">
            {etapas.map((etapa, i) => (
              <li key={i} className="flex gap-3">
                <span
                  className={cn(
                    'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs',
                    etapa.hecho
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100 text-gray-400',
                  )}
                >
                  {etapa.hecho ? '✓' : i + 1}
                </span>
                <div className="flex-1">
                  <div
                    className={cn(
                      'text-sm font-medium',
                      etapa.hecho ? 'text-gray-900' : 'text-gray-500',
                    )}
                  >
                    {etapa.nombre}
                  </div>
                  {etapa.detalle && (
                    <div className="mt-1">
                      {typeof etapa.detalle === 'string' ? (
                        <p className="text-xs text-gray-600">{etapa.detalle}</p>
                      ) : (
                        etapa.detalle
                      )}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-5 flex justify-end border-t border-gray-100 pt-4">
          <button
            onClick={onClose}
            className="rounded bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
